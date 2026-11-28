-- ============================================================
-- Gelombang 4 — Hardening rendah (R): CHECK nominal & payrollDay,
-- pencabutan EXECUTE cycle_for_date() dari PUBLIC.
-- Migrasi: supabase/migrations/20261128080000_wave4_low_hardening.sql
-- Nomor urut setelah 20261128070000 (WebAuthn DRAF — JANGAN disentuh).
--
-- Sifat: idempotent (semua objek dicek dulu lewat pg_constraint /
-- to_regproc; aman dijalankan ulang). Satu transaksi (begin/commit):
-- gagal di tengah = rollback total, seperti 20261128040000.
--
-- KEPUTUSAN DESAIN (dicatat agar tidak "diperbaiki" diam-diam):
--   * Semua CHECK baru dibuat NOT VALID. Baris lama yang melanggar
--     (mis. nominal recurring negatif dari input lama) dikecualikan
--     (grandfathered) dan dilaporkan lewat RAISE NOTICE di bawah,
--     supaya migrasi TIDAK PERNAH gagal karena data lama. Baris
--     baru / yang diubah tetap harus lolos CHECK. Bila suatu saat
--     data lama sudah dibersihkan, jalankan:
--       alter table <tabel> validate constraint <nama_constraint>;
--   * payrollDay disimpan sebagai text di settings.value, jadi
--     CHECK-nya hanya berlaku bila key = 'payrollDay'. Nilai ''
--     (kosong) tetap diizinkan: v_transactions sudah menanganinya
--     sebagai default 1 (nullif(value,'')::int).
--   * portfolio_snapshots SENGAJA tidak diberi CHECK >= 0: snapshot
--     adalah nilai hitung yang bisa sah negatif pada posisi kas
--     tertentu; memaksanya berisiko memblokir penulisan snapshot.
--   * cycle_for_date() hanya ada di db/schema.sql (bootstrap v1) dan
--     belum pernah dikelola migrasi. Blok DO di bawah bertahan bila
--     fungsi belum ada (mis. database yang dibangun hanya dari
--     migrasi): revoke/alter dilewati dengan NOTICE.
-- ============================================================

begin;

-- ============================================================
-- §1 cycle_for_date(): cabut EXECUTE dari PUBLIC + pin search_path
-- Temuan R: fungsi ini dibuat schema.sql tanpa SECURITY DEFINER dan
-- tanpa pin search_path, dan izin EXECUTE default ke PUBLIC tidak
-- pernah dicabut — satu-satunya fungsi di repo yang masih begitu
-- (semua fungsi migrasi memakai pola revoke-all-from-public, anon).
-- Setelah ini: hanya authenticated yang boleh mengeksekusi, dan
-- fungsi berjalan dengan search_path = public (anti pembajakan
-- search_path). v_transactions (security_invoker) tidak berubah.
-- ============================================================
do $$
begin
  if to_regproc('public.cycle_for_date(date, int)') is not null then
    revoke all on function public.cycle_for_date(date, int) from public;
    grant execute on function public.cycle_for_date(date, int) to authenticated;
    alter function public.cycle_for_date(date, int) set search_path = public;
    raise notice 'cycle_for_date(): EXECUTE dicabut dari PUBLIC, search_path dipin ke public.';
  else
    raise notice 'cycle_for_date() belum ada di database ini — lewati §1.';
  end if;
end $$;

-- ============================================================
-- §2 CHECK nominal negatif & payrollDay bukan angka (NOT VALID)
-- Temuan R: kolom-kolom di bawah tidak punya CHECK sehingga nilai
-- negatif / bukan angka bisa masuk lewat tulis langsung ke tabel
-- (validasi prosedural di RPC/fungsi tidak berlaku untuk tulis
-- langsung). transactions.nominal, transfers.nominal/fee,
-- financial_goals, dan assets SUDAH punya CHECK (Gelombang 3) dan
-- tidak disentuh di sini.
-- ============================================================

-- recurring.nominal >= 0 (nominal transaksi berulang; 0 = placeholder).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recurring_nominal_nonnegative') then
    alter table public.recurring
      add constraint recurring_nominal_nonnegative check (nominal >= 0) not valid;
  end if;
end $$;

-- budgets.jumlah >= 0 (anggaran bulanan tidak boleh negatif).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budgets_jumlah_nonnegative') then
    alter table public.budgets
      add constraint budgets_jumlah_nonnegative check (jumlah >= 0) not valid;
  end if;
end $$;

-- wallets.opening_balance >= 0. Jenis dompet di aplikasi hanya
-- bank/cash/ewallet (db/002_wallets.sql) — tidak ada dompet kartu
-- kredit yang saldo awalnya sah negatif.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallets_opening_balance_nonnegative') then
    alter table public.wallets
      add constraint wallets_opening_balance_nonnegative check (opening_balance >= 0) not valid;
  end if;
end $$;

-- asset_value_history: semua kolom nilai riwayat >= 0 (NULL = tidak ada).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asset_value_history_nonnegative') then
    alter table public.asset_value_history
      add constraint asset_value_history_nonnegative check (
        old_quantity >= 0 and new_quantity >= 0 and
        old_buy_price >= 0 and new_buy_price >= 0 and
        old_value >= 0 and new_value >= 0
      ) not valid;
  end if;
end $$;

-- financial_goal_history: semua kolom nilai riwayat >= 0.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'financial_goal_history_nonnegative') then
    alter table public.financial_goal_history
      add constraint financial_goal_history_nonnegative check (
        old_target_amount >= 0 and new_target_amount >= 0 and
        old_current_amount >= 0 and new_current_amount >= 0
      ) not valid;
  end if;
end $$;

-- settings.payrollDay: bila key = 'payrollDay', value harus '' (default)
-- atau bilangan 1..31. Sebelum ini 'abc', '0', '32', '-5' lolos diam-diam
-- lalu memecahkan v_transactions saat ::int di-cast (atau menggeser
-- semua tanggal ke siklus bulan berikutnya untuk nilai 32).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_payrollday_valid') then
    alter table public.settings
      add constraint settings_payrollday_valid check (
        key <> 'payrollDay' or value = '' or value ~ '^([1-9]|[12][0-9]|3[01])$'
      ) not valid;
  end if;
end $$;

-- Laporan baris lama yang dikecualikan (grandfathered) — informasi saja,
-- bukan error. Bersihkan manual bila mau, lalu VALIDATE constraint-nya.
do $$
declare
  v_recurring bigint;
  v_budgets bigint;
  v_wallets bigint;
  v_asset_hist bigint;
  v_goal_hist bigint;
  v_payroll bigint;
begin
  select count(*) into v_recurring from public.recurring where nominal < 0;
  select count(*) into v_budgets from public.budgets where jumlah < 0;
  select count(*) into v_wallets from public.wallets where opening_balance < 0;
  select count(*) into v_asset_hist from public.asset_value_history
    where coalesce(old_quantity, 0) < 0 or coalesce(new_quantity, 0) < 0
       or coalesce(old_buy_price, 0) < 0 or coalesce(new_buy_price, 0) < 0
       or coalesce(old_value, 0) < 0 or coalesce(new_value, 0) < 0;
  select count(*) into v_goal_hist from public.financial_goal_history
    where coalesce(old_target_amount, 0) < 0 or coalesce(new_target_amount, 0) < 0
       or coalesce(old_current_amount, 0) < 0 or coalesce(new_current_amount, 0) < 0;
  select count(*) into v_payroll from public.settings
    where key = 'payrollDay' and value <> '' and value !~ '^([1-9]|[12][0-9]|3[01])$';
  raise notice 'Wave 4 §2 — baris lama yang dikecualikan CHECK (NOT VALID): recurring=% budgets=% wallets=% asset_history=% goal_history=% payrollDay=%',
    v_recurring, v_budgets, v_wallets, v_asset_hist, v_goal_hist, v_payroll;
end $$;

commit;

-- Verifikasi sesudah apply (SQL Editor):
--   select conname, convalidated from pg_constraint
--     where conname in ('recurring_nominal_nonnegative','budgets_jumlah_nonnegative',
--       'wallets_opening_balance_nonnegative','asset_value_history_nonnegative',
--       'financial_goal_history_nonnegative','settings_payrollday_valid');
--   -- convalidated = false (NOT VALID) adalah YANG DIHARAPKAN.
--   select has_function_privilege('anon', 'public.cycle_for_date(date, int)', 'execute');
--   -- diharapkan: false.
--   select has_function_privilege('authenticated', 'public.cycle_for_date(date, int)', 'execute');
--   -- diharapkan: true.
