-- ============================================================
-- Gelombang 3.5 (S26-S39) §3: Restore backup atomik via RPC
--
-- Masalah: restore klien lama adalah loop N panggilan PostgREST
-- terpisah tanpa transaksi — gagal di tengah jalan meninggalkan
-- akun setengah ter-restore, dan retry bisa double-insert pada
-- koleksi yang dedup-nya lemah (dompet/transfer/entitas).
-- "Compensating deletes" di klien BUKAN atomik dan tidak diterima
-- sebagai perbaikan.
--
-- Perbaikan: `restore_backup(p_payload jsonb)` — SEMUA 10 koleksi
-- (categories, wallets, entities, transactions, transfers,
-- budgets, goals, recurring, assets, debtDueDates) di-insert
-- dalam SATU transaksi fungsi ini. Kegagalan validasi apa pun
-- (dompet tak dikenal, bulan budget 2026-13, nominal > MAX,
-- grup entitas tak dikenal) me-raise dan me-rollback SEMUANYA.
--
-- Idempotency / retry-aman (pola Wave 2.5): setiap koleksi
-- didedup berdasarkan kunci stabilnya sebelum insert —
-- transaksi & transfer memakai `legacy_id` (= id asli dari backup;
-- kolom legacy_id ditambahkan ke `transfers` di sini, dan
-- `transactions` mendapat unique index (user_id, legacy_id)),
-- sisanya memakai unique constraint / NOT EXISTS fingerprint.
-- Menjalankan restore yang sama dua kali meng-insert 0 baris.
--
-- Urutan insert di dalam RPC: dompet -> kategori -> entitas ->
-- transaksi -> transfer (cek saldo SETELAH transaksi masuk, karena
-- saldo turunan transfer dihitung dari saldo awal + transaksi) ->
-- budget -> goal -> recurring -> aset -> debtDueDates (settings).
-- Dompet dipetakan BERDASARKAN NAMA (id lama dari backup tidak
-- berlaku lintas akun); transaksi/transfer yang merujuk dompet
-- yang tidak ada di payload MAUPUN di akun akan menggagalkan
-- seluruh restore — klien sudah membatalkan lebih dulu (§2), ini
-- adalah pertahanan lapis kedua di server.
--
-- Catatan: fungsi ini security invoker (RLS tetap berlaku) dan
-- hanya dapat dipanggil authenticated. Payload diharapkan sudah
-- difilter klien (prepareBackupRestorePayload); RPC memvalidasi
-- ulang semuanya dan tidak percaya begitu saja pada klien.
-- ============================================================
begin;

-- 1. legacy_id untuk transfer (transaksi sudah punya kolomnya).
alter table public.transfers
  add column if not exists legacy_id text;

-- Dedup berbasis id stabil: satu id backup hanya boleh masuk sekali
-- per pengguna. NULL tetap berbeda dengan NULL (baris lama tanpa
-- legacy_id tidak saling bertabrakan).
create unique index if not exists transfers_user_legacy_id_uidx
  on public.transfers (user_id, legacy_id);
create unique index if not exists transactions_user_legacy_id_uidx
  on public.transactions (user_id, legacy_id);

create or replace function public.restore_backup(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_wallets jsonb := coalesce(p_payload -> 'wallets', '[]'::jsonb);
  v_categories jsonb := coalesce(p_payload -> 'categories', '[]'::jsonb);
  v_entities jsonb := coalesce(p_payload -> 'entities', '[]'::jsonb);
  v_transactions jsonb := coalesce(p_payload -> 'transactions', '[]'::jsonb);
  v_transfers jsonb := coalesce(p_payload -> 'transfers', '[]'::jsonb);
  v_budgets jsonb := coalesce(p_payload -> 'budgets', '[]'::jsonb);
  v_goals jsonb := coalesce(p_payload -> 'goals', '[]'::jsonb);
  v_recurring jsonb := coalesce(p_payload -> 'recurring', '[]'::jsonb);
  v_assets jsonb := coalesce(p_payload -> 'assets', '[]'::jsonb);
  v_due jsonb := coalesce(p_payload -> 'debtDueDates', '{}'::jsonb);
  v_ins_wallets int := 0;
  v_ins_categories int := 0;
  v_ins_entities int := 0;
  v_ins_tx int := 0;
  v_ins_transfers int := 0;
  v_ins_budgets int := 0;
  v_ins_goals int := 0;
  v_ins_recurring int := 0;
  v_ins_assets int := 0;
  v_n int;
  v_wallet_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_balance numeric;
  v_default_wallet_id uuid;
  r record;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload restore tidak valid.';
  end if;

  -- ---- Dompet: insert (ON CONFLICT nama -> pakai yang sudah ada) ----
  -- Peta nama -> id disimpan di tabel temporer transaksi ini.
  create temp table if not exists _restore_wallet_map (wallet_name text primary key, wallet_id uuid) on commit drop;
  truncate _restore_wallet_map;
  for r in select * from jsonb_array_elements(v_wallets) loop
    if btrim(coalesce(r.value ->> 'name', '')) = '' then
      raise exception 'Nama dompet pada backup tidak valid.';
    end if;
    if coalesce((r.value ->> 'kind'), 'bank') not in ('bank', 'cash', 'ewallet') then
      raise exception 'Jenis dompet tidak valid: %', coalesce(r.value ->> 'kind', '');
    end if;
    if coalesce((r.value ->> 'openingBalance')::numeric, 0) < 0
       or coalesce((r.value ->> 'openingBalance')::numeric, 0) > 999999999999.99 then
      raise exception 'Saldo awal dompet tidak valid.';
    end if;
    insert into public.wallets (user_id, name, kind, opening_balance)
    values (v_uid, btrim(r.value ->> 'name'), coalesce(r.value ->> 'kind', 'bank'),
            coalesce((r.value ->> 'openingBalance')::numeric, 0))
    on conflict (user_id, name) do nothing;
    get diagnostics v_n = row_count;
    v_ins_wallets := v_ins_wallets + v_n;
    select w.id into v_wallet_id from public.wallets w
     where w.user_id = v_uid and w.name = btrim(r.value ->> 'name');
    insert into _restore_wallet_map (wallet_name, wallet_id)
    values (btrim(r.value ->> 'name'), v_wallet_id)
    on conflict (wallet_name) do nothing;
  end loop;
  -- Dompet yang sudah ada di akun (tidak ada di payload) tetap bisa
  -- dirujuk transaksi backup bila namanya cocok.
  insert into _restore_wallet_map (wallet_name, wallet_id)
  select w.name, w.id from public.wallets w where w.user_id = v_uid
  on conflict (wallet_name) do nothing;
  select m.wallet_id into v_default_wallet_id
    from _restore_wallet_map m
    join public.wallets w on w.id = m.wallet_id
   order by w.sort, w.name limit 1;

  -- ---- Kategori ----
  for r in select * from jsonb_array_elements(v_categories) loop
    if coalesce(r.value ->> 'tipe', '') not in ('Pemasukan', 'Pengeluaran', 'pemasukan', 'pengeluaran') then
      raise exception 'Tipe kategori tidak valid.';
    end if;
    if btrim(coalesce(r.value ->> 'name', '')) = '' then
      raise exception 'Nama kategori pada backup tidak valid.';
    end if;
    insert into public.categories (user_id, tipe, name)
    values (v_uid, lower(btrim(r.value ->> 'tipe')), btrim(r.value ->> 'name'))
    on conflict (user_id, tipe, name) do nothing;
    get diagnostics v_n = row_count;
    v_ins_categories := v_ins_categories + v_n;
  end loop;

  -- ---- Entitas (registry utang/piutang) ----
  for r in select * from jsonb_array_elements(v_entities) loop
    if coalesce(r.value ->> 'grp', '') not in ('UtangApp', 'UtangPerson', 'Piutang') then
      raise exception 'Grup entitas tidak valid: %', coalesce(r.value ->> 'grp', '');
    end if;
    if btrim(coalesce(r.value ->> 'name', '')) = '' then
      raise exception 'Nama entitas pada backup tidak valid.';
    end if;
    insert into public.entities (user_id, grp, name)
    values (v_uid, r.value ->> 'grp', btrim(r.value ->> 'name'))
    on conflict (user_id, grp, name) do nothing;
    get diagnostics v_n = row_count;
    v_ins_entities := v_ins_entities + v_n;
  end loop;

  -- ---- Transaksi (dedup: legacy_id, lalu fingerprint lengkap) ----
  for r in select * from jsonb_array_elements(v_transactions) loop
    if coalesce(r.value ->> 'tanggal', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(r.value ->> 'tipe', '') not in ('Pemasukan', 'Pengeluaran')
       or btrim(coalesce(r.value ->> 'kategori', '')) = ''
       or coalesce((r.value ->> 'nominal')::numeric, 0) <= 0
       or coalesce((r.value ->> 'nominal')::numeric, 0) > 999999999999.99 then
      raise exception 'Transaksi pada backup tidak valid (tanggal/tipe/kategori/nominal).';
    end if;
    -- Resolusi dompet BERDASARKAN NAMA; nama yang tidak dikenal
    -- menggagalkan SELURUH restore (atomic), bukan dialihkan diam-diam.
    if coalesce(r.value ->> 'walletName', '') <> '' then
      select m.wallet_id into v_wallet_id from _restore_wallet_map m
       where m.wallet_name = btrim(r.value ->> 'walletName');
      if v_wallet_id is null then
        raise exception 'Dompet tidak ditemukan: %', btrim(r.value ->> 'walletName');
      end if;
    else
      v_wallet_id := v_default_wallet_id;
    end if;
    insert into public.transactions (user_id, tanggal, tipe, kategori, nominal, keterangan, wallet_id, legacy_id, source)
    select v_uid, (r.value ->> 'tanggal')::date, r.value ->> 'tipe',
           btrim(r.value ->> 'kategori'), (r.value ->> 'nominal')::numeric,
           coalesce(r.value ->> 'keterangan', ''), v_wallet_id,
           nullif(btrim(coalesce(r.value ->> 'legacyId', '')), ''), 'import'
    where not exists (
      select 1 from public.transactions t where t.user_id = v_uid
        and ((r.value ->> 'legacyId') is not null and btrim(r.value ->> 'legacyId') <> ''
             and t.legacy_id = btrim(r.value ->> 'legacyId'))
    )
    and not exists (
      select 1 from public.transactions t where t.user_id = v_uid
        and t.tanggal = (r.value ->> 'tanggal')::date
        and t.tipe = r.value ->> 'tipe'
        and lower(btrim(t.kategori)) = lower(btrim(r.value ->> 'kategori'))
        and t.nominal = (r.value ->> 'nominal')::numeric
        and lower(btrim(t.keterangan)) = lower(btrim(coalesce(r.value ->> 'keterangan', '')))
        and coalesce(t.wallet_id, v_default_wallet_id) = coalesce(v_wallet_id, v_default_wallet_id)
    );
    get diagnostics v_n = row_count;
    v_ins_tx := v_ins_tx + v_n;
  end loop;

  -- ---- Transfer (dedup: legacy_id, lalu fingerprint; cek saldo) ----
  for r in select * from jsonb_array_elements(v_transfers) loop
    if coalesce(r.value ->> 'tanggal', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(r.value ->> 'kind', 'transfer') not in ('transfer', 'tarik_tunai', 'investasi')
       or coalesce((r.value ->> 'nominal')::numeric, 0) <= 0
       or coalesce((r.value ->> 'nominal')::numeric, 0) > 999999999999.99
       or coalesce((r.value ->> 'fee')::numeric, 0) < 0 then
      raise exception 'Transfer pada backup tidak valid (tanggal/jenis/nominal/biaya).';
    end if;
    v_from_id := null;
    v_to_id := null;
    if coalesce(r.value ->> 'fromWalletName', '') <> '' then
      select m.wallet_id into v_from_id from _restore_wallet_map m
       where m.wallet_name = btrim(r.value ->> 'fromWalletName');
      if v_from_id is null then
        raise exception 'Dompet asal transfer tidak ditemukan: %', btrim(r.value ->> 'fromWalletName');
      end if;
    end if;
    if coalesce(r.value ->> 'toWalletName', '') <> '' then
      select m.wallet_id into v_to_id from _restore_wallet_map m
       where m.wallet_name = btrim(r.value ->> 'toWalletName');
      if v_to_id is null then
        raise exception 'Dompet tujuan transfer tidak ditemukan: %', btrim(r.value ->> 'toWalletName');
      end if;
    end if;
    if v_from_id is null then
      raise exception 'Transfer pada backup tanpa dompet asal.';
    end if;
    if v_from_id = v_to_id and (r.value ->> 'kind') <> 'investasi' then
      raise exception 'Transfer dengan dompet asal dan tujuan yang sama.';
    end if;
    -- Cek saldo SETELAH transaksi backup masuk (saldo turunan).
    select coalesce(w.opening_balance, 0)
         + coalesce((select sum(case
             when t.kategori ilike 'piutang%' then (case when t.tipe = 'Pemasukan' then t.nominal else -t.nominal end)
             when t.kategori ilike 'utang%' then (case when t.tipe = 'Pemasukan' then 0 else -t.nominal end)
             else (case when t.tipe = 'Pemasukan' then t.nominal else -t.nominal end) end)
             from public.transactions t where t.user_id = v_uid
              and coalesce(t.wallet_id, v_default_wallet_id) = v_from_id), 0)
         + coalesce((select sum(case
             when x.to_wallet = v_from_id then x.nominal
             when x.from_wallet = v_from_id then -(x.nominal + x.fee) else 0 end)
             from public.transfers x where x.user_id = v_uid
              and (x.from_wallet = v_from_id or x.to_wallet = v_from_id)), 0)
      into v_balance from public.wallets w where w.id = v_from_id;
    if v_balance is null or v_balance < (r.value ->> 'nominal')::numeric + coalesce((r.value ->> 'fee')::numeric, 0) then
      raise exception 'Saldo dompet asal tidak mencukupi untuk transfer pada backup.';
    end if;
    insert into public.transfers (user_id, tanggal, kind, from_wallet, to_wallet, nominal, fee, keterangan, legacy_id)
    select v_uid, (r.value ->> 'tanggal')::date, coalesce(r.value ->> 'kind', 'transfer'),
           v_from_id, v_to_id, (r.value ->> 'nominal')::numeric,
           coalesce((r.value ->> 'fee')::numeric, 0), coalesce(r.value ->> 'keterangan', ''),
           nullif(btrim(coalesce(r.value ->> 'legacyId', '')), '')
    where not exists (
      select 1 from public.transfers x where x.user_id = v_uid
        and ((r.value ->> 'legacyId') is not null and btrim(r.value ->> 'legacyId') <> ''
             and x.legacy_id = btrim(r.value ->> 'legacyId'))
    )
    and not exists (
      select 1 from public.transfers x where x.user_id = v_uid
        and x.tanggal = (r.value ->> 'tanggal')::date
        and x.kind = coalesce(r.value ->> 'kind', 'transfer')
        and coalesce(x.from_wallet, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_from_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(x.to_wallet, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_to_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and x.nominal = (r.value ->> 'nominal')::numeric
        and x.fee = coalesce((r.value ->> 'fee')::numeric, 0)
        and lower(btrim(x.keterangan)) = lower(btrim(coalesce(r.value ->> 'keterangan', '')))
    );
    get diagnostics v_n = row_count;
    v_ins_transfers := v_ins_transfers + v_n;
  end loop;

  -- ---- Budget ----
  for r in select * from jsonb_array_elements(v_budgets) loop
    if coalesce(r.value ->> 'bulan', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or btrim(coalesce(r.value ->> 'kategori', '')) = ''
       or coalesce((r.value ->> 'jumlah')::numeric, -1) < 0
       or coalesce((r.value ->> 'jumlah')::numeric, 0) > 999999999999.99 then
      raise exception 'Budget pada backup tidak valid (bulan/kategori/jumlah).';
    end if;
    insert into public.budgets (user_id, kategori, bulan, jumlah)
    values (v_uid, btrim(r.value ->> 'kategori'), r.value ->> 'bulan', (r.value ->> 'jumlah')::numeric)
    on conflict (user_id, kategori, bulan) do nothing;
    get diagnostics v_n = row_count;
    v_ins_budgets := v_ins_budgets + v_n;
  end loop;

  -- ---- Target keuangan (goals) ----
  for r in select * from jsonb_array_elements(v_goals) loop
    if btrim(coalesce(r.value ->> 'name', '')) = ''
       or coalesce((r.value ->> 'targetAmount')::numeric, 0) <= 0
       or coalesce((r.value ->> 'targetAmount')::numeric, 0) > 999999999999.99
       or coalesce((r.value ->> 'currentAmount')::numeric, 0) < 0 then
      raise exception 'Target keuangan pada backup tidak valid.';
    end if;
    insert into public.financial_goals (user_id, name, target_amount, current_amount, target_date)
    select v_uid, btrim(r.value ->> 'name'), (r.value ->> 'targetAmount')::numeric,
           coalesce((r.value ->> 'currentAmount')::numeric, 0),
           case when coalesce(r.value ->> 'targetDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
                then (r.value ->> 'targetDate')::date else null end
    where not exists (
      select 1 from public.financial_goals g where g.user_id = v_uid
        and lower(btrim(g.name)) = lower(btrim(r.value ->> 'name'))
        and g.target_amount = (r.value ->> 'targetAmount')::numeric
    );
    get diagnostics v_n = row_count;
    v_ins_goals := v_ins_goals + v_n;
  end loop;

  -- ---- Jadwal rutin (recurring) ----
  for r in select * from jsonb_array_elements(v_recurring) loop
    if coalesce(r.value ->> 'tipe', '') not in ('Pemasukan', 'Pengeluaran')
       or btrim(coalesce(r.value ->> 'kategori', '')) = ''
       or coalesce((r.value ->> 'nominal')::numeric, 0) <= 0
       or coalesce((r.value ->> 'dayOfMonth')::int, 0) < 1
       or coalesce((r.value ->> 'dayOfMonth')::int, 0) > 31 then
      raise exception 'Jadwal rutin pada backup tidak valid.';
    end if;
    insert into public.recurring (user_id, tipe, kategori, nominal, keterangan, day_of_month, active)
    select v_uid, r.value ->> 'tipe', btrim(r.value ->> 'kategori'),
           (r.value ->> 'nominal')::numeric, coalesce(r.value ->> 'keterangan', ''),
           (r.value ->> 'dayOfMonth')::int, coalesce((r.value ->> 'active')::boolean, true)
    where not exists (
      select 1 from public.recurring x where x.user_id = v_uid
        and x.tipe = r.value ->> 'tipe'
        and lower(btrim(x.kategori)) = lower(btrim(r.value ->> 'kategori'))
        and x.nominal = (r.value ->> 'nominal')::numeric
        and x.day_of_month = (r.value ->> 'dayOfMonth')::int
    );
    get diagnostics v_n = row_count;
    v_ins_recurring := v_ins_recurring + v_n;
  end loop;

  -- ---- Aset ----
  for r in select * from jsonb_array_elements(v_assets) loop
    if btrim(coalesce(r.value ->> 'name', '')) = '' then
      raise exception 'Nama aset pada backup tidak valid.';
    end if;
    insert into public.assets (user_id, name, type, symbol, quantity, buy_price, value)
    select v_uid, btrim(r.value ->> 'name'),
           case when coalesce(r.value ->> 'type', '') in ('Crypto', 'Emas', 'USD', 'Saham', 'Cash', 'Other')
                then r.value ->> 'type' else 'Other' end,
           upper(btrim(coalesce(r.value ->> 'symbol', ''))),
           greatest(0, coalesce((r.value ->> 'quantity')::numeric, 0)),
           greatest(0, coalesce((r.value ->> 'buyPrice')::numeric, 0)),
           greatest(0, coalesce((r.value ->> 'value')::numeric, 0))
    where not exists (
      select 1 from public.assets a where a.user_id = v_uid
        and lower(btrim(a.type)) = lower(btrim(coalesce(r.value ->> 'type', 'Other')))
        and lower(btrim(a.name)) = lower(btrim(r.value ->> 'name'))
        and upper(btrim(a.symbol)) = upper(btrim(coalesce(r.value ->> 'symbol', '')))
    );
    get diagnostics v_n = row_count;
    v_ins_assets := v_ins_assets + v_n;
  end loop;

  -- ---- Jatuh tempo utang (settings.debtDueDates, digabung) ----
  if jsonb_typeof(v_due) = 'object' and v_due <> '{}'::jsonb then
    -- Validasi: setiap nilai harus tanggal valid.
    for r in select * from jsonb_each(v_due) loop
      if coalesce(r.value #>> '{}', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Tanggal jatuh tempo utang tidak valid.';
      end if;
    end loop;
    insert into public.settings (user_id, key, value)
    values (v_uid, 'debtDueDates', v_due::text)
    on conflict (user_id, key) do update
      set value = (coalesce((settings.value)::jsonb, '{}'::jsonb) || excluded.value::jsonb)::text;
  end if;

  return jsonb_build_object(
    'inserted', jsonb_build_object(
      'wallets', v_ins_wallets, 'categories', v_ins_categories,
      'entities', v_ins_entities, 'transactions', v_ins_tx,
      'transfers', v_ins_transfers, 'budgets', v_ins_budgets,
      'goals', v_ins_goals, 'recurring', v_ins_recurring,
      'assets', v_ins_assets),
    'total', jsonb_build_object(
      'wallets', jsonb_array_length(v_wallets),
      'categories', jsonb_array_length(v_categories),
      'entities', jsonb_array_length(v_entities),
      'transactions', jsonb_array_length(v_transactions),
      'transfers', jsonb_array_length(v_transfers),
      'budgets', jsonb_array_length(v_budgets),
      'goals', jsonb_array_length(v_goals),
      'recurring', jsonb_array_length(v_recurring),
      'assets', jsonb_array_length(v_assets))
  );
end;
$$;

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

commit;
