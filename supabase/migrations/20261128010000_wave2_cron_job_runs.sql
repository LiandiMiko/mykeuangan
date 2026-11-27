-- ============================================================
-- Gelombang 2.3 (T9): Log pemanggilan job cron — tabel cron_job_runs
--
-- Masalah: tidak ada pencatatan pemanggilan job di mana pun. Bila
-- sebuah job dipicu pihak luar (atau gagal diam-diam), tidak ada
-- jejak kapan dipicu, oleh apa (cron pg_cron atau pengguna), dan
-- berapa baris yang dibuat. Tabel ini dicatat oleh handleJob() di
-- supabase/functions/telegram-bot/jobs.ts pada setiap pemanggilan:
-- satu baris saat job mulai (status 'running'), diperbarui saat
-- job selesai (status 'ok'/'error', jumlah created/notified/
-- skipped, dan pesan error bila gagal).
--
-- Akses: HANYA service_role (edge function). RLS aktif dan tidak
-- ada policy untuk anon/authenticated, plus REVOKE eksplisit, jadi
-- tidak ada jalur klien yang bisa membaca atau memalsukan log ini.
-- Verifikasi setelah run berikutnya:
--   select * from cron_job_runs order by started_at desc limit 5;
--
-- Konvensi PK mengikuti tabel lain di repo (mis. admin_audit_logs,
-- financial_goals): id uuid primary key default gen_random_uuid().
--
-- Semua pernyataan memakai IF NOT EXISTS / DO block sehingga
-- migrasi aman dijalankan ulang (idempotent).
-- ============================================================
begin;

create table if not exists public.cron_job_runs (
  id             uuid primary key default gen_random_uuid(),
  job            text not null,
  invoked_by     text not null default 'cron',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running',
  created_count  integer not null default 0,
  notified_count integer not null default 0,
  skipped_count  integer not null default 0,
  error          text
);

-- invoked_by hanya 'cron' (pg_cron) atau 'user' (refresh_prices manual).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cron_job_runs_invoked_by_check'
      and conrelid = 'public.cron_job_runs'::regclass
  ) then
    alter table public.cron_job_runs
      add constraint cron_job_runs_invoked_by_check
      check (invoked_by in ('cron', 'user'));
  end if;
end $$;

-- status hanya 'running' (masih jalan), 'ok', atau 'error'.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cron_job_runs_status_check'
      and conrelid = 'public.cron_job_runs'::regclass
  ) then
    alter table public.cron_job_runs
      add constraint cron_job_runs_status_check
      check (status in ('running', 'ok', 'error'));
  end if;
end $$;

-- Hitungan tidak boleh negatif.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cron_job_runs_counts_check'
      and conrelid = 'public.cron_job_runs'::regclass
  ) then
    alter table public.cron_job_runs
      add constraint cron_job_runs_counts_check
      check (created_count >= 0 and notified_count >= 0 and skipped_count >= 0);
  end if;
end $$;

-- Kueri verifikasi (run terbaru dulu) memakai index ini.
create index if not exists cron_job_runs_started_at_idx
  on public.cron_job_runs (started_at desc);

create index if not exists cron_job_runs_job_started_at_idx
  on public.cron_job_runs (job, started_at desc);

alter table public.cron_job_runs enable row level security;

-- Tanpa policy apa pun + REVOKE eksplisit: hanya service_role
-- (yang melewati RLS) yang bisa membaca/menulis tabel ini.
-- Edge function memakai klien service_role, jadi pencatatan tetap jalan.
revoke all on public.cron_job_runs from anon, authenticated;
grant all on public.cron_job_runs to service_role;

commit;
