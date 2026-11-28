-- ============================================================
-- HOTFIX P0 (2026-11-28): "column reference \"id\" is ambiguous" (42702)
--
-- Akar masalah (TERBUKTI di produksi, repro rollback 2026-11-28):
-- fungsi PL/pgSQL RETURNS TABLE mendeklarasikan parameter OUT bernama
-- `id`, `kategori`, `bulan` (dst.), lalu badannya memakai nama itu BARE
-- di klausa SQL ("where id = ...", "and kategori = ...", "returning id",
-- "update ... where id = ..."). PL/pgSQL default (#variable_conflict
-- error) melempar 42702 karena nama itu bisa berarti variabel PL/pgSQL
-- ATAU kolom tabel. Kelas bugnya: NAMA KOLOM OUT APA PUN, bukan hanya
-- `id` — situs keempat (`kategori`/`bulan` di SELECT awal
-- save_budget_checked) lolos dari audit pertama karena triase hasil
-- audit keliru menggolongkannya false positive bersama daftar kolom
-- INSERT dan target SET yang memang legal.
-- Dampak live v3.20.16/17: transfer antar dompet SELALU gagal;
-- SEMUA simpan anggaran SELALU gagal (save_budget_checked — SELECT
-- awalnya yang gagal duluan, jadi anggaran BARU pun tidak bisa
-- disimpan, bukan hanya yang sudah ada); beli aset SELALU gagal
-- (create_asset_with_expense).
--
-- Perbaikan: kualifikasi kolom saja (w.id / b.id / b.kategori /
-- b.bulan / assets.id) — TIDAK ada perubahan logika, TIDAK ada
-- perubahan signature, TIDAK ada perubahan grants. Tiga fungsi di
-- bawah diambil utuh dari definisi terakhirnya di main, hanya baris
-- yang ditandai yang berubah (lihat komentar §1-§3). Migrasi BARU:
-- migrasi lama yang sudah diterapkan (050000, 130000, 040000) TIDAK
-- diedit.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + REVOKE/GRANT aman diulang.
-- Satu transaksi (begin/commit).
-- ============================================================

begin;

-- §1 transfer_between_wallets: 3x "where id =" BARE -> "w.id" terkualifikasi.
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
    select * into v_from from public.wallets as w where w.id = p_from for update;
    if not found or v_from.user_id <> v_uid then
      raise exception 'Dompet asal tidak ditemukan atau bukan milik Anda.';
    end if;
  else
    v_first_id := least(p_from, p_to);
    v_second_id := greatest(p_from, p_to);
    select * into v_first_row from public.wallets as w where w.id = v_first_id for update;
    if not found then
      raise exception 'Dompet tidak ditemukan atau bukan milik Anda.';
    end if;
    select * into v_second_row from public.wallets as w where w.id = v_second_id for update;
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

-- §2 save_budget_checked: "where id = v_row.id" BARE -> "b.id"
-- terkualifikasi, DAN "and kategori = / and bulan =" BARE di SELECT
-- awal -> "b.kategori / b.bulan" (alias "as b" ditambahkan pada FROM).
-- SELECT awal adalah statement PERTAMA fungsi: tanpa perbaikan ini
-- SEMUA simpan anggaran gagal (baru maupun yang sudah ada), bukan
-- hanya yang sudah ada. Dibuktikan repro-ambig-4a/4b di produksi
-- (rollback): pola BARE -> 42702 "kategori is ambiguous", pola
-- terkualifikasi -> baris dikembalikan.
create or replace function public.save_budget_checked(
  p_kategori text,
  p_bulan text,
  p_jumlah numeric,
  p_expected_version integer default null
)
returns table (
  id uuid,
  kategori text,
  bulan text,
  jumlah numeric,
  version integer,
  conflict boolean,
  current_jumlah numeric,
  current_version integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.budgets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_kategori is null or btrim(p_kategori) = '' then
    raise exception 'Kategori anggaran wajib diisi.';
  end if;
  if p_bulan is null or p_bulan !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periode anggaran tidak valid.';
  end if;
  if p_jumlah is null or p_jumlah < 0 then
    raise exception 'Nominal anggaran tidak valid.';
  end if;

  -- Kunci baris (bila ada) supaya dua RPC bersamaan atas anggaran
  -- yang sama diserialisasi: yang kedua membaca versi SETELAH yang
  -- pertama commit, sehingga cek di bawah menolaknya dengan benar.
  -- Tanpa FOR UPDATE, cek-lalu-tulis di dalam RPC pun balapan.
  select * into v_row
    from public.budgets as b
   where b.user_id = auth.uid()
     and b.kategori = btrim(p_kategori)
     and b.bulan = p_bulan
     for update;

  if not found then
    insert into public.budgets (user_id, kategori, bulan, jumlah)
    values (auth.uid(), btrim(p_kategori), p_bulan, p_jumlah)
    returning * into v_row;
    return query select
      v_row.id, v_row.kategori, v_row.bulan, v_row.jumlah, v_row.version,
      false, null::numeric, null::integer;
    return;
  end if;

  if p_expected_version is not null and v_row.version <> p_expected_version then
    return query select
      v_row.id, v_row.kategori, v_row.bulan, v_row.jumlah, v_row.version,
      true, v_row.jumlah, v_row.version;
    return;
  end if;

  -- Trigger bump_version menaikkan version +1 secara otomatis.
  update public.budgets as b
     set jumlah = p_jumlah
   where b.id = v_row.id
  returning * into v_row;
  return query select
    v_row.id, v_row.kategori, v_row.bulan, v_row.jumlah, v_row.version,
    false, null::numeric, null::integer;
end;
$$;

revoke all on function public.save_budget_checked(text, text, numeric, integer) from public, anon;
grant execute on function public.save_budget_checked(text, text, numeric, integer) to authenticated;

-- §3 create_asset_with_expense: "returning id" BARE -> "returning assets.id".
create or replace function public.create_asset_with_expense(
  p_name text,
  p_type text,
  p_symbol text,
  p_quantity numeric,
  p_buy_price numeric,
  p_amount numeric,
  p_wallet_id uuid,
  p_date date default null
)
returns table (
  id uuid,
  tanggal date,
  tipe text,
  kategori text,
  nominal numeric,
  keterangan text,
  wallet_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  asset_name text := nullif(btrim(p_name), '');
  asset_symbol text := upper(btrim(coalesce(p_symbol, '')));
  type_lower text := lower(coalesce(p_type, ''));
  purchase_amount numeric;
  asset_qty numeric := 0;
  asset_buy_price numeric := 0;
  v_asset_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if asset_name is null then
    raise exception 'Asset name is required';
  end if;
  if p_type is null or p_type not in ('Crypto', 'Emas', 'USD', 'Saham', 'Cash', 'Other') then
    raise exception 'Invalid asset type';
  end if;

  -- S13: guard negatif di depan — berlaku untuk SEMUA tipe. Sebelumnya
  -- Emas/USD diam-diam membuang buy_price negatif (dihitung ulang) dan
  -- cabang Saham/Cash/Other meloloskan quantity/buy_price negatif
  -- (nullif hanya menyaring nol).
  if (p_quantity is not null and p_quantity < 0)
      or (p_buy_price is not null and p_buy_price < 0) then
    raise exception 'Quantity dan harga beli aset tidak boleh negatif.';
  end if;

  perform 1
    from public.wallets
   where public.wallets.id = p_wallet_id and user_id = auth.uid()
   for key share;
  if not found then
    raise exception 'Wallet not found';
  end if;

  if type_lower = 'crypto' then
    if asset_symbol = '' or p_quantity is null or p_quantity <= 0
        or p_buy_price is null or p_buy_price <= 0 then
      raise exception 'Crypto symbol, quantity, and purchase price are required';
    end if;
    purchase_amount := round(p_quantity * p_buy_price, 2);
    asset_qty := p_quantity;
    asset_buy_price := p_buy_price;
  elsif type_lower in ('emas', 'usd') then
    if p_amount is null or p_amount <= 0 or p_quantity is null or p_quantity <= 0 then
      raise exception 'Unit quantity and purchase amount are required';
    end if;
    purchase_amount := round(p_amount, 2);
    if asset_symbol = '' then
      asset_symbol := case when type_lower = 'emas' then 'XAU' else 'USD' end;
    end if;
    asset_qty := p_quantity;
    asset_buy_price := case
      when p_buy_price is not null and p_buy_price > 0 then p_buy_price
      else round(purchase_amount / p_quantity, 4)
    end;
  else
    if p_amount is null or p_amount <= 0 then
      raise exception 'Purchase amount must be greater than zero';
    end if;
    purchase_amount := round(p_amount, 2);
    asset_qty := coalesce(nullif(p_quantity, 0), 0);
    asset_buy_price := coalesce(nullif(p_buy_price, 0), 0);
  end if;

  if purchase_amount <= 0 then
    raise exception 'Purchase amount must be greater than zero';
  end if;

  -- S12: trigger riwayat di-skip untuk INSERT ini; baris riwayat
  -- 'purchase' dicatat langsung di bawah (selalu, tidak tergantung wallet).
  perform set_config('app.asset_history_skip', '1', true);
  perform set_config('app.asset_history_source', 'purchase', true);

  insert into public.assets
    (user_id, name, type, symbol, quantity, buy_price, value)
  values
    (auth.uid(), asset_name, p_type, asset_symbol, asset_qty, asset_buy_price, purchase_amount)
  returning assets.id into v_asset_id;

  insert into public.asset_value_history
    (user_id, asset_id, asset_name, source,
     old_quantity, new_quantity, old_buy_price, new_buy_price,
     old_value, new_value, wallet_id)
  values
    (auth.uid(), v_asset_id, asset_name, 'purchase',
     null, asset_qty, null, asset_buy_price,
     null, purchase_amount, p_wallet_id);

  insert into public.categories (user_id, tipe, name)
  values (auth.uid(), 'pengeluaran', 'Investasi')
  on conflict (user_id, tipe, name) do nothing;

  return query
    insert into public.transactions as inserted_transaction
      (user_id, tanggal, tipe, kategori, nominal, keterangan, source, wallet_id)
    values
      (auth.uid(), coalesce(p_date, current_date), 'Pengeluaran', 'Investasi',
       purchase_amount, 'Pembelian aset: ' || asset_name, 'web', p_wallet_id)
    returning inserted_transaction.id, inserted_transaction.tanggal,
      inserted_transaction.tipe, inserted_transaction.kategori,
      inserted_transaction.nominal, inserted_transaction.keterangan,
      inserted_transaction.wallet_id;
end;
$$;

revoke all on function public.create_asset_with_expense(text, text, text, numeric, numeric, numeric, uuid, date)
  from public, anon;
grant execute on function public.create_asset_with_expense(text, text, text, numeric, numeric, numeric, uuid, date)
  to authenticated;

commit;
