-- ============================================================
-- MyKeuanganGuech — Skema Supabase (v1)
-- Jalankan sekali di Supabase → SQL Editor, HANYA untuk database
-- KOSONG (bootstrap awal).
--
-- PERINGATAN (Gelombang 4): JANGAN jalankan ulang file ini di
-- database yang sudah dimigrasi. Skema di sini adalah snapshot v1
-- dan TIDAK mengandung hardening dari migrasi (Wave 1: admin &
-- PIN, Wave 2: bot personal & cron, Wave 3: HMAC & RPC atomik,
-- Wave 4: CHECK nominal & pencabutan EXECUTE cycle_for_date).
-- Menjalankan ulang TIDAK akan menghapus objek migrasi, tetapi
-- definisi lama di sini (mis. cycle_for_date tanpa pin
-- search_path) bisa menimpa versi yang sudah diperkeras. Blok
-- penjaga di bawah ini MENOLAK eksekusi bila penanda hardening
-- terdeteksi. Untuk database yang sudah berjalan, perubahan skema
-- HANYA lewat file baru di supabase/migrations/.
-- Prinsip:
--   * Satu tabel transactions (tidak ada lagi sheet per siklus).
--     Siklus gaji dihitung dari tanggal + payrollDay (lihat cycle_for_date).
--   * Utang/piutang tetap berupa transaksi dengan kategori
--     "UtangApp - Nama" / "UtangPerson - Nama" / "Piutang - Nama",
--     sama seperti sekarang, jadi logika frontend bisa dipakai ulang.
--   * Semua tabel dilindungi Row Level Security: hanya pemilik (auth.uid()).
--   * Bot Telegram hanya melayani chat_id yang ada di telegram_chats.
-- ============================================================

-- Penjaga Gelombang 4: tolak bila database sudah dimigrasi.
-- is_admin() dibuat migrasi 20261115040200; admin_audit_logs dibuat
-- migrasi 20261125120000. Di database kosong keduanya tidak ada.
do $$
begin
  if to_regproc('public.is_admin()') is not null
     or to_regclass('public.admin_audit_logs') is not null then
    raise exception 'schema.sql adalah bootstrap v1 — JANGAN dijalankan ulang di database yang sudah dimigrasi. Perubahan skema hanya lewat file baru di supabase/migrations/.';
  end if;
end $$;

-- ---------- Settings (key/value; saat ini hanya payrollDay) ----------
create table if not exists public.settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key     text not null,
  value   text not null,
  primary key (user_id, key)
);

-- ---------- Kategori ----------
create table if not exists public.categories (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipe    text not null check (tipe in ('pemasukan', 'pengeluaran')),
  name    text not null,
  unique (user_id, tipe, name)
);

-- ---------- Entitas utang/piutang ----------
create table if not exists public.entities (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  grp     text not null check (grp in ('UtangApp', 'UtangPerson', 'Piutang')),
  name    text not null,
  unique (user_id, grp, name)
);

-- ---------- Transaksi ----------
create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  legacy_id  text,                                   -- id lama dari Google Sheets
  tanggal    date not null,
  tipe       text not null check (tipe in ('Pemasukan', 'Pengeluaran')),
  kategori   text not null,
  nominal    numeric(20, 2) not null default 0 check (nominal > 0),
  keterangan text not null default '',
  source     text not null default 'web',            -- web | telegram | recurring | import
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_tanggal_idx  on public.transactions (user_id, tanggal desc);
create index if not exists transactions_user_kategori_idx on public.transactions (user_id, kategori);
create index if not exists transactions_legacy_idx        on public.transactions (user_id, legacy_id);

-- ---------- Aset ----------
create table if not exists public.assets (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name      text not null,
  type      text not null default 'Other',           -- Crypto | Cash | Other
  symbol    text not null default '',
  quantity  numeric(30, 12) not null default 0,
  buy_price numeric(20, 4)  not null default 0,
  value     numeric(20, 2)  not null default 0
);

-- ---------- Budget (bulan = nama periode 'yyyy-MM') ----------
create table if not exists public.budgets (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kategori text not null,
  bulan    text not null check (bulan ~ '^\d{4}-\d{2}$'),
  jumlah   numeric(20, 2) not null default 0,
  unique (user_id, kategori, bulan)
);

-- ---------- Snapshot portofolio harian ----------
create table if not exists public.portfolio_snapshots (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tanggal      date not null,
  total_value  numeric(20, 2) not null default 0,
  crypto_value numeric(20, 2) not null default 0,
  cash_value   numeric(20, 2) not null default 0,
  other_value  numeric(20, 2) not null default 0,
  primary key (user_id, tanggal)
);

-- ---------- Transaksi berulang ----------
create table if not exists public.recurring (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipe         text not null check (tipe in ('Pemasukan', 'Pengeluaran')),
  kategori     text not null,
  nominal      numeric(20, 2) not null default 0,
  keterangan   text not null default '',
  day_of_month int not null check (day_of_month between 1 and 31),
  last_run     date,
  active       boolean not null default true
);

-- ---------- Bot Telegram: daftar chat yang DIIZINKAN ----------
-- Bot hanya merespons chat_id yang terdaftar di sini (menutup celah
-- "siapa pun yang chat ke bot bisa memakainya" pada versi Apps Script).
create table if not exists public.telegram_chats (
  chat_id    bigint primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- Bot Telegram: dedup update_id (webhook bisa dikirim ulang) ----------
create table if not exists public.telegram_updates (
  update_id   bigint primary key,
  received_at timestamptz not null default now()
);
alter table public.telegram_updates enable row level security;  -- tanpa policy = hanya service role

-- ============================================================
-- Hitung siklus gaji (setara getCycleForDate di Code.gs)
--   payroll_day <= 1  → bulan kalender biasa
--   tanggal >= payroll_day → siklus bulan berikutnya
-- ============================================================
create or replace function public.cycle_for_date(d date, payroll_day int)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(payroll_day, 1) <= 1 then to_char(d, 'YYYY-MM')
    when extract(day from d) >= payroll_day then to_char(d + interval '1 month', 'YYYY-MM')
    else to_char(d, 'YYYY-MM')
  end
$$;

-- View transaksi + kolom cycle (mengikuti payrollDay di settings, default 1)
create or replace view public.v_transactions
with (security_invoker = true) as
select
  t.*,
  public.cycle_for_date(
    t.tanggal,
    coalesce(
      (select nullif(s.value, '')::int
         from public.settings s
        where s.user_id = t.user_id and s.key = 'payrollDay'),
      1
    )
  ) as cycle
from public.transactions t;

-- ============================================================
-- Row Level Security: hanya pemilik baris
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'categories', 'entities', 'transactions',
    'assets', 'budgets', 'portfolio_snapshots', 'recurring', 'telegram_chats'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- Gelombang 4: DROP dulu supaya jalankan ulang file ini (database
    -- kosong / bootstrap) tidak gagal di policy yang sudah ada.
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant select on public.v_transactions to authenticated;
-- Gelombang 4: EXECUTE default ke PUBLIC dicabut — pola yang sama
-- dengan semua fungsi migrasi (revoke-all-from-public, anon).
-- Sebelum ini cycle_for_date() adalah satu-satunya fungsi yang
-- masih bisa dieksekusi PUBLIC/anon.
revoke all on function public.cycle_for_date(date, int) from public, anon;
grant execute on function public.cycle_for_date(date, int) to authenticated;
