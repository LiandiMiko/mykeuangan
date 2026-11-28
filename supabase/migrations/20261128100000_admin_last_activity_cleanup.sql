-- ============================================================
-- Fitur admin — Status "Perubahan Terakhir" per user +
-- auto-hapus akun dormant (BAGIAN DATABASE, Worker A).
-- Migrasi: supabase/migrations/20261128100000_admin_last_activity_cleanup.sql
--
-- Isi:
--   §1  Kolom baru di public.profiles:
--         last_activity_at          — terakhir user beraktivitas
--                                      (disentuh klien via RPC §2).
--         deletion_warning_sent_at  — kapan email peringatan H-1
--                                      penghapusan dikirim (diisi
--                                      edge function / cron, bukan
--                                      klien; kolom ini hanya
--                                      tempat simpan + dibaca RPC §3).
--   §2  RPC touch_own_activity() — klien memanggil ini setelah
--       login dan setelah sinkronisasi berhasil. SECURITY DEFINER
--       karena UPDATE profiles sudah dicabut dari role
--       authenticated (Gelombang 1), jadi update langsung dari
--       klien DITOLAK RLS; satu-satunya jalan adalah RPC ini.
--       Hanya menyentuh baris milik pemanggil (id = auth.uid()).
--   §3  RPC get_admin_user_activity() — satu baris per user untuk
--       panel admin (kontrak kolom PERSIS dengan worker UI, jangan
--       ubah nama kolom). Hanya admin (public.is_admin(), pola
--       yang sama dengan get_admin_platform_stats di migrasi
--       20261118000000).
--   §4  Index profiles(last_activity_at) untuk seleksi cleanup.
--
-- Fakta yang mendasari (ditegaskan koordinator):
--   * Tabel user (transactions, wallets, dst.) mereferensi
--     auth.users(id) ON DELETE CASCADE — admin.deleteUser sudah
--     menghapus semua data user; migrasi ini TIDAK membuat
--     penghapusan sendiri.
--   * profiles.updated_at hanya berubah saat baris profil berubah,
--     BUKAN sinyal aktivitas yang andal — karena itu ada kolom
--     last_activity_at yang disentuh eksplisit oleh klien.
--   * last_sign_in_at dibaca dari auth.users (kolom bawaan Auth).
--
-- Definisi last_change_at (satu-satunya "perubahan terakhir"):
--   GREATEST(COALESCE(last_activity_at, created_at),
--            last_sign_in_at)
--   — dengan satu pengaman: bila last_sign_in_at NULL (user belum
--   pernah sign-in tercatat), GREATEST(...) murni akan NULL.
--   Karena itu NULL diganti dulu dengan nilai dasar
--   COALESCE(last_activity_at, created_at); hasilnya IDENTIK
--   dengan rumus di atas bila last_sign_in_at terisi.
-- days_inactive      = floor((now() - last_change_at) / 1 hari),
--                      dipotong di 0 bila last_change_at di masa
--                      depan (jam klien/server miring).
-- deletion_due_in_days = GREATEST(0, 7 - days_inactive):
--                      7 = ambang dorman (auto-hapus setelah 7 hari
--                      tanpa perubahan); 0 berarti sudah jatuh tempo.
-- Semua hitung memakai epoch (waktu absolut), BUKAN potongan
-- tanggal kalender — jadi batas hari benar di WIB maupun UTC
-- (pelajaran Gelombang 3/5: toISOString().slice(0,10) salah
-- sebelum 07:00 WIB).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION, REVOKE/GRANT aman diulang.
-- Satu transaksi (begin/commit). TIDAK menyentuh migrasi
-- 20261128070000 (WebAuthn draf), edge function, UI, atau
-- web/config.js. TIDAK memakai hmac/digest — bila kelak dipakai,
-- kualifikasi extensions.hmac/extensions.digest (pgcrypto
-- Supabase ada di schema extensions, bukan public).
-- JANGAN memakai to_regproc dengan daftar argumen (selalu NULL);
-- yang benar to_regprocedure — migrasi ini tidak memerlukannya.
-- ============================================================

begin;

-- §1 — Kolom baru di public.profiles.
alter table public.profiles
  add column if not exists last_activity_at timestamptz;
alter table public.profiles
  add column if not exists deletion_warning_sent_at timestamptz;

-- §4 — Index untuk seleksi cleanup (dormant paling lama dulu).
create index if not exists idx_profiles_last_activity_at
  on public.profiles (last_activity_at);

-- §2 — RPC: sentuh aktivitas milik sendiri.
create or replace function public.touch_own_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Hanya baris pemanggil. Bila baris profil belum ada (balapan
  -- dengan trigger handle_new_user), update tidak mengenai baris
  -- apa pun; pemanggilan berikutnya (setelah login/sinkronisasi)
  -- akan berhasil.
  update public.profiles
     set last_activity_at = now()
   where id = auth.uid();
end;
$$;

revoke all on function public.touch_own_activity() from public, anon;
grant execute on function public.touch_own_activity() to authenticated;

-- §3 — RPC: daftar aktivitas user untuk panel admin.
create or replace function public.get_admin_user_activity()
returns table (
  user_id              uuid,
  email                text,
  display_name         text,
  role                 text,
  status               text,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  last_activity_at     timestamptz,
  last_change_at       timestamptz,
  days_inactive        int,
  deletion_due_in_days int,
  warning_sent_at      timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;

  return query
    with base as (
      select
        p.id                         as user_id,
        p.email                      as email,
        p.display_name               as display_name,
        p.role                       as role,
        p.status                     as status,
        p.created_at                 as created_at,
        u.last_sign_in_at            as sign_in_at,
        p.last_activity_at           as last_activity_at,
        p.deletion_warning_sent_at   as warning_sent_at,
        coalesce(p.last_activity_at, p.created_at) as base_at
      from public.profiles p
      left join auth.users u on u.id = p.id
    ),
    computed as (
      select
        base.*,
        greatest(base.base_at, coalesce(base.sign_in_at, base.base_at))
          as last_change_at,
        greatest(0,
          floor(extract(epoch from
            (v_now - greatest(base.base_at,
                              coalesce(base.sign_in_at, base.base_at)))
          ) / 86400))::int as days_inactive
      from base
    )
    select
      c.user_id,
      c.email,
      c.display_name,
      c.role,
      c.status,
      c.created_at,
      c.sign_in_at,
      c.last_activity_at,
      c.last_change_at,
      c.days_inactive,
      greatest(0, 7 - c.days_inactive) as deletion_due_in_days,
      c.warning_sent_at
    from computed c
    order by c.days_inactive desc, c.created_at asc;
end;
$$;

revoke all on function public.get_admin_user_activity() from public, anon;
grant execute on function public.get_admin_user_activity() to authenticated;

commit;
