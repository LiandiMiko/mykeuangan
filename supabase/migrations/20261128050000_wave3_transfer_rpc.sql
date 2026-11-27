-- ============================================================
-- Gelombang 3.5 (S26-S39) §6: Transfer antar dompet via RPC
--
-- Masalah: api_addTransfer dulu insert langsung ke `transfers`
-- lewat PostgREST tanpa cek saldo, tanpa cek kepemilikan dompet,
-- dan tanpa lock. Saldo dompet hanya diturunkan (derived) di
-- klien (saldo awal + transaksi + transfer), jadi transfer yang
-- melebihi saldo BERHASIL tersimpan dan menampilkan saldo negatif.
-- RLS pada `transfers` hanya memeriksa user_id baris transfer itu
-- sendiri, bukan dompet yang dirujuk (FK hanya membuktikan baris
-- dompet ADA, bukan milik pemanggil).
--
-- Perbaikan: `transfer_between_wallets` — satu transaksi server:
--   1. kunci KEDUA baris dompet FOR UPDATE dalam urutan id
--      (aman dari deadlock; dua transfer bersamaan yang berebut
--      dompet yang sama diserialkan, jadi hanya satu yang lolos
--      bila gabungannya melebihi saldo),
--   2. verifikasi kedua dompet milik auth.uid(),
--   3. verifikasi saldo mencukupi (nominal + fee <= saldo turunan:
--      saldo awal + transaksi + transfer, dengan aturan cashDelta
--      yang sama seperti klien — lihat web/finance-analysis-core.js:
--      kategori Piutang* dan Utang* diperlakukan khusus),
--   4. idempotency: kunci yang sama untuk pengguna yang sama
--      mengembalikan baris yang sudah ada (pola Gelombang 2.5,
--      unique index (user_id, idempotency_key) dari migrasi
--      20261128020000), bukan duplikat,
--   5. MAX_NOMINAL = 999999999999.99 ditegakkan di server juga.
--
-- Klien tetap melakukan pre-check saldo (UX) dari state yang sudah
-- diambil, tapi RPC inilah kontrol yang sebenarnya — ada jeda
-- TOCTOU antara cek klien dan eksekusi server, dan hanya server
-- yang menutupnya (lock + cek dalam satu transaksi).
-- ============================================================
begin;

create or replace function public.transfer_between_wallets(
  p_from uuid,
  p_to uuid,
  p_nominal numeric,
  p_fee numeric,
  p_tanggal date,
  p_keterangan text,
  p_idempotency_key text
)
returns table (
  id uuid,
  tanggal date,
  kind text,
  from_wallet uuid,
  to_wallet uuid,
  nominal numeric,
  fee numeric,
  keterangan text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_nominal numeric := coalesce(p_nominal, 0);
  v_fee numeric := coalesce(p_fee, 0);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing public.transfers%rowtype;
  v_from public.wallets%rowtype;
  v_to public.wallets%rowtype;
  v_default_wallet_id uuid;
  v_from_balance numeric;
  v_first_id uuid;
  v_second_id uuid;
  v_first_row public.wallets%rowtype;
  v_second_row public.wallets%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_from is null then
    raise exception 'Dompet asal wajib diisi.';
  end if;
  if p_from = p_to then
    raise exception 'Pilih dompet asal dan tujuan yang berbeda';
  end if;
  if v_nominal <= 0 or v_nominal > 999999999999.99 then
    raise exception 'Nominal harus lebih dari 0 dan tidak melebihi Rp 999.999.999.999,99.';
  end if;
  if v_fee < 0 or v_fee > 999999999999.99 then
    raise exception 'Biaya transfer tidak valid.';
  end if;
  if p_tanggal is null then
    raise exception 'Tanggal transfer tidak valid.';
  end if;
  v_kind := case when p_to is null then 'investasi' else 'transfer' end;

  -- Idempotency (pola Wave 2.5): retry dengan kunci yang sama adalah
  -- no-op — kembalikan baris yang sudah ada, jangan insert lagi.
  if v_key is not null then
    select * into v_existing
      from public.transfers
     where user_id = v_uid and idempotency_key = v_key;
    if found then
      return query select v_existing.id, v_existing.tanggal, v_existing.kind,
        v_existing.from_wallet, v_existing.to_wallet, v_existing.nominal,
        v_existing.fee, v_existing.keterangan;
      return;
    end if;
  end if;

  -- Kunci kedua dompet FOR UPDATE dalam urutan id (deadlock-safe).
  -- Urutan deterministik: transfer bersamaan atas dompet yang sama
  -- antre pada lock yang sama, jadi cek saldo di bawah ini selalu
  -- melihat transfer lain yang sudah commit.
  if p_to is null then
    select * into v_from from public.wallets where id = p_from for update;
    if not found or v_from.user_id <> v_uid then
      raise exception 'Dompet asal tidak ditemukan atau bukan milik Anda.';
    end if;
  else
    v_first_id := least(p_from, p_to);
    v_second_id := greatest(p_from, p_to);
    select * into v_first_row from public.wallets where id = v_first_id for update;
    if not found then
      raise exception 'Dompet tidak ditemukan atau bukan milik Anda.';
    end if;
    select * into v_second_row from public.wallets where id = v_second_id for update;
    if not found then
      raise exception 'Dompet tidak ditemukan atau bukan milik Anda.';
    end if;
    if v_first_row.user_id <> v_uid or v_second_row.user_id <> v_uid then
      raise exception 'Dompet tidak ditemukan atau bukan milik Anda.';
    end if;
    -- Tetapkan asal/tujuan berdasarkan id, bukan urutan lock.
    if v_first_row.id = p_from then
      v_from := v_first_row;
      v_to := v_second_row;
    else
      v_from := v_second_row;
      v_to := v_first_row;
    end if;
  end if;

  -- Dompet default (dipakai transaksi tanpa wallet_id, mengikuti
  -- trigger set_default_wallet): dompet pertama urutan sort, name.
  select w.id into v_default_wallet_id
    from public.wallets w
   where w.user_id = v_uid
   order by w.sort, w.name
   limit 1;

  -- Saldo turunan dompet asal: saldo awal + transaksi + transfer.
  -- Aturan cashDelta sama seperti klien (finance-analysis-core.js):
  --   Piutang* : Pemasukan +nominal, Pengeluaran -nominal
  --   Utang*   : Pemasukan 0 (uang pinjaman tidak menambah kas di
  --              turunan klien), Pengeluaran -nominal
  --   lainnya  : Pemasukan +nominal, Pengeluaran -nominal
  -- Transaksi tanpa wallet_id jatuh ke dompet default.
  select coalesce(w.opening_balance, 0)
       + coalesce((
           select sum(case
             when t.kategori ilike 'piutang%' then (case when t.tipe = 'Pemasukan' then t.nominal else -t.nominal end)
             when t.kategori ilike 'utang%' then (case when t.tipe = 'Pemasukan' then 0 else -t.nominal end)
             else (case when t.tipe = 'Pemasukan' then t.nominal else -t.nominal end)
           end)
             from public.transactions t
            where t.user_id = v_uid
              and coalesce(t.wallet_id, v_default_wallet_id) = p_from
         ), 0)
       + coalesce((
           select sum(case
             when x.to_wallet = p_from then x.nominal
             when x.from_wallet = p_from then -(x.nominal + x.fee)
             else 0 end)
             from public.transfers x
            where x.user_id = v_uid
              and (x.from_wallet = p_from or x.to_wallet = p_from)
         ), 0)
    into v_from_balance
    from public.wallets w
   where w.id = p_from;

  if v_from_balance is null then
    raise exception 'Dompet asal tidak ditemukan atau bukan milik Anda.';
  end if;
  if v_from_balance < v_nominal + v_fee then
    raise exception 'Saldo dompet asal tidak mencukupi untuk transfer ini.';
  end if;

  insert into public.transfers (user_id, tanggal, kind, from_wallet, to_wallet, nominal, fee, keterangan, idempotency_key)
  values (v_uid, p_tanggal, v_kind, p_from, p_to, v_nominal, v_fee, coalesce(p_keterangan, ''), v_key)
  returning transfers.id, transfers.tanggal, transfers.kind,
    transfers.from_wallet, transfers.to_wallet, transfers.nominal,
    transfers.fee, transfers.keterangan
  into id, tanggal, kind, from_wallet, to_wallet, nominal, fee, keterangan;
  return next;
  return;
exception
  when unique_violation then
    -- Balapan insert dengan kunci idempotency yang sama: ambil baris
    -- yang menang, jangan lempar duplikat ke klien.
    if v_key is not null then
      select * into v_existing
        from public.transfers
       where user_id = v_uid and idempotency_key = v_key;
      if found then
        return query select v_existing.id, v_existing.tanggal, v_existing.kind,
          v_existing.from_wallet, v_existing.to_wallet, v_existing.nominal,
          v_existing.fee, v_existing.keterangan;
        return;
      end if;
    end if;
    raise;
end;
$$;

revoke all on function public.transfer_between_wallets(uuid, uuid, numeric, numeric, date, text, text) from public, anon;
grant execute on function public.transfer_between_wallets(uuid, uuid, numeric, numeric, date, text, text) to authenticated;

commit;
