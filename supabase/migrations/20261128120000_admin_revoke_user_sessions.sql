-- ============================================================
-- Gelombang 7a (admin-reset) — RPC pencabut sesi pengguna.
-- Migrasi: supabase/migrations/20261128120000_admin_revoke_user_sessions.sql
--
-- Latar: reset password oleh admin (edge function admin-password)
-- selama ini TIDAK mencabut sesi target. Di Wave 2 hal itu
-- sengaja tidak diimplementasikan karena supabase-js 2.45.4
-- `auth.admin.signOut` membutuhkan JWT target — server hanya
-- memegang JWT admin pemanggil, dan memanggilnya akan mencabut
-- sesi admin sendiri. Penyelidikan Gelombang 7a (2026-11-28)
-- pada supabase-js 2.119.2 yang ter-vendor
-- (web/vendor/supabase.js, kelas GoTrueAdminApi) membuktikan
-- keterbatasan itu MASIH berlaku:
--   * GoTrueAdminApi.signOut(jwt, scope = 'global') — argumen
--     PERTAMA adalah JWT sesi yang mau dicabut; ia POST ke
--     /logout?scope=<scope> dengan jwt tersebut. Tanpa JWT
--     target, server tidak bisa memakainya.
--   * TIDAK ADA metode admin berbasis user-id untuk mencabut
--     sesi: tidak ada signOutUser / deleteSession(s), dan tidak
--     ada endpoint /admin/users/{id}/sessions di seluruh bundle
--     (0 kemunculan kata "sessions"). Metode admin yang ada:
--     signOut, inviteUserByEmail, generateLink, createUser,
--     listUsers, getUserById, updateUserById, deleteUser,
--     mfa list/delete factor, oauth clients, custom providers,
--     passkey list/delete.
--   * Dokumentasi resmi Supabase menegaskan: "There is no way
--     to revoke a user's access token jwt until it expires."
--
-- Alternatif yang BENAR-BENAR mencabut sesi tanpa JWT target:
-- DELETE FROM auth.sessions WHERE user_id = <target>. Inilah
-- yang dilakukan GoTrue sendiri saat /logout: baris sesi
-- dihapus, refresh token ikut tercabut, dan pengguna tidak bisa
-- lagi memperbarui access token-nya — ia harus login ulang.
-- Supabase sendiri (dokumen managing-user-data + jawaban
-- dukungan) menunjuk cara ini sebagai jalan mematikan sesi
-- ketika token tidak tersedia.
--
-- Keterbatasan yang JUJUR harus dicatat (sama seperti
-- signOut resmi, bukan kelemahan implementasi ini):
--   1. Access token adalah JWT stateless: token yang SUDAH
--      diterbitkan tetap valid sampai `exp`-nya lewat (default
--      1 jam) untuk PostgREST/RLS, yang tidak memeriksa
--      auth.sessions. Jendela sisa ini dibatasi, bukan ditutup.
--      Hanya endpoint Auth (/user, /logout, dst.) yang menolak
--      token yang sesinya sudah dihapus.
--   2. Supabase resmi tidak menganjurkan modifikasi langsung
--      tabel auth.* (skema milik GoTrue). Karena itu fungsi ini
--      SEMPIT: hanya DELETE dari auth.sessions, hanya untuk
--      satu user_id, tanpa menyentuh auth.users /
--      auth.identities / auth.refresh_tokens, dan hanya bisa
--      dipanggil service_role (edge function admin-password
--      setelah memverifikasi pemanggil adalah admin aktif).
--      Tidak ada jalur dari klien (anon/authenticated ditolak).
--
-- Isi:
--   §1  RPC public.admin_revoke_user_sessions(p_target_user_id
--       uuid) RETURNS integer — hapus SEMUA baris sesi target
--       di auth.sessions, kembalikan jumlah sesi yang dihapus.
--       SECURITY DEFINER + search_path dipin ke '' (semua objek
--       dikualifikasi skemanya) + REVOKE ALL FROM public, anon,
--       authenticated + GRANT EXECUTE TO service_role saja.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT aman
-- diulang. Satu transaksi (begin/commit). TIDAK menyentuh
-- migrasi lain, edge function lain, atau UI. TIDAK memakai
-- hmac/digest — bila kelak dipakai, kualifikasi
-- extensions.hmac/extensions.digest (pgcrypto Supabase ada di
-- schema extensions, bukan public). Penjaga memakai
-- to_regprocedure — JANGAN to_regproc dengan daftar argumen
-- (selalu NULL; pelajaran Wave 4 / PR #7).
-- ============================================================

begin;

-- §1 — RPC: cabut semua sesi satu pengguna (hapus baris
-- auth.sessions miliknya). Dipanggil edge function
-- admin-password SETELAH password target berhasil diubah,
-- fail-soft (lihat index.ts): bila RPC ini gagal, reset
-- password tetap berhasil tetapi kegagalannya tercatat di
-- audit + console, bukan diam-diam.
create or replace function public.admin_revoke_user_sessions(p_target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if p_target_user_id is null then
    raise exception 'admin_revoke_user_sessions: p_target_user_id wajib diisi.';
  end if;

  -- Hanya auth.sessions yang disentuh: inilah tabel yang
  -- dihapus GoTrue sendiri saat /logout (refresh token ikut
  -- tercabut). JANGAN tambah DELETE ke auth.users /
  -- auth.identities di sini — penghapusan akun punya jalurnya
  -- sendiri (auth.admin.deleteUser, cascade).
  delete from auth.sessions where user_id = p_target_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Hanya service_role (edge function). REVOKE dari public saja
-- TIDAK cukup — grant eksplisit ke anon harus dicabut juga
-- (pelajaran Wave 4: revoke dari public, anon).
revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;

-- Penjaga: pastikan fungsi terpasang dengan tanda tangan yang
-- tepat (to_regprocedure, bukan to_regproc — lihat header).
do $$
begin
  if to_regprocedure('public.admin_revoke_user_sessions(uuid)') is null then
    raise exception 'admin_revoke_user_sessions(uuid) tidak terpasang setelah migrasi.';
  end if;
  raise notice 'admin_revoke_user_sessions(uuid) terpasang; EXECUTE hanya service_role.';
end $$;

commit;
