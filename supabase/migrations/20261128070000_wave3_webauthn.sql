-- ============================================================
-- Gelombang 3.1 (S1) — WebAuthn server-side: tabel kredensial &
-- challenge. DIVERIFIKASI Gelombang 7c (2026-11-28): dibaca baris
-- demi baris, `deno check` function pendamping lolos (Deno 2.9.8),
-- unit test handler + verifikasi di tests/webauthn.test.js lolos
-- WIB + UTC, lalu diterapkan ke proyek Supabase `mykeu`.
--
-- Rancangan:
--   * webauthn_credentials: satu baris per kredensial platform yang
--     didaftarkan pengguna. public_key menyimpan JWK EC P-256
--     (bukan kunci privat — privat tidak pernah keluar dari
--     authenticator). counter dipakai untuk mendeteksi kloning:
--     assertion dengan counter <= counter tersimpan ditolak.
--   * webauthn_challenges: challenge sekali pakai, kedaluwarsa 5
--     menit, ditandai used_at saat dipakai. Satu challenge hanya
--     boleh memverifikasi satu assertion.
--   * RLS aktif; Edge Function memakai service role sehingga
--     melewati RLS. Kebijakan di bawah hanya mengizinkan pengguna
--     membaca/menghapus kredensialnya sendiri (tidak ada tulis
--     langsung dari klien: pendaftaran hanya lewat Edge Function).
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ---------- 1. Kredensial WebAuthn per pengguna ----------
create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null,
  public_key jsonb not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint webauthn_credentials_credential_id_unique unique (credential_id),
  constraint webauthn_credentials_public_key_is_ec check (
    (public_key ->> 'kty') = 'EC' and (public_key ->> 'crv') = 'P-256'
  )
);

create index if not exists webauthn_credentials_user_id_idx
  on public.webauthn_credentials (user_id);

-- ---------- 2. Challenge sekali pakai ----------
create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  challenge text not null,
  purpose text not null check (purpose in ('enrollment', 'assertion')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists webauthn_challenges_user_challenge_idx
  on public.webauthn_challenges (user_id, challenge);
create index if not exists webauthn_challenges_expires_at_idx
  on public.webauthn_challenges (expires_at);

-- ---------- 3. RLS ----------
alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;

drop policy if exists webauthn_credentials_select_own on public.webauthn_credentials;
create policy webauthn_credentials_select_own
  on public.webauthn_credentials for select
  using (auth.uid() = user_id);

drop policy if exists webauthn_credentials_delete_own on public.webauthn_credentials;
create policy webauthn_credentials_delete_own
  on public.webauthn_credentials for delete
  using (auth.uid() = user_id);

-- Challenges tidak bisa dibaca/ditulis langsung oleh klien sama sekali:
-- hanya service role (Edge Function) yang menyentuhnya.
drop policy if exists webauthn_challenges_none on public.webauthn_challenges;
create policy webauthn_challenges_none
  on public.webauthn_challenges for all
  using (false);

-- ---------- 4. Pembersihan challenge kedaluwarsa ----------
create or replace function public.purge_expired_webauthn_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.webauthn_challenges
  where expires_at < now() - interval '1 hour';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Gelombang 7c: fungsi SECURITY DEFINER di atas hanya menghapus
-- challenge yang sudah kedaluwarsa >1 jam (tidak ada data pengguna),
-- tetapi EXECUTE default-nya jatuh ke PUBLIC — cabut dari semua peran
-- klien dan beri hanya ke service_role (yang dipakai Edge Function /
-- cron). Pelajaran Wave 4: revoke dari PUBLIC saja TIDAK mencabut
-- grant eksplisit `anon`, jadi revoke dari public, anon, authenticated.
-- Catatan: belum ada cron yang memanggil fungsi ini (lihat audit-044);
-- sampai ada pemanggil, fungsi ini tidak berjalan otomatis.
revoke execute on function public.purge_expired_webauthn_challenges()
  from public, anon, authenticated;
grant execute on function public.purge_expired_webauthn_challenges()
  to service_role;

commit;
