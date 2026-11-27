-- ============================================================
-- Gelombang 1 (K1): Admin hardening — otorisasi admin ke server
-- Jalankan di Supabase -> SQL Editor, SETELAH migrasi
-- 20261125120000_admin_audit_and_telegram_unlink.sql.
--
-- PERHATIAN — PENUNJUKAN ADMIN PERTAMA (MANUAL, WAJIB):
-- Migrasi ini TIDAK membuat admin baru. Setelah migrasi diterapkan,
-- pemilik harus menunjuk admin pertama secara manual lewat SQL Editor:
--   update public.profiles set role = 'admin' where email = 'email@pemilik';
-- lalu verifikasi (lihat supabase/README.md, bagian "Penunjukan admin
-- pertama"). Sebelum langkah itu, TIDAK ADA yang bisa menjadi admin lewat
-- pendaftaran: pendaftar baru selalu mendapat role 'user'.
-- ============================================================
begin;

-- 1. Hapus logika first-user-admin dari handle_new_user().
--    Definisi ini mengikuti definisi terbaru (migrasi
--    20261124000000_oauth_onboarding_display_name.sql): penanganan display
--    name OAuth (full_name -> name -> local-part email), dompet bawaan,
--    kategori standar, dan settings awal dipertahankan apa adanya.
--    Satu-satunya perubahan: role selalu 'user', tanpa pengecualian untuk
--    pendaftar pertama. Advisory lock ikut dihapus karena tidak ada lagi
--    logika yang butuh serialisasi antar-pendaftar.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_name text;
begin
  resolved_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    60
  );

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    resolved_name,
    'user'
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id, name, kind, sort) values
    (new.id, 'BCA (m-banking)', 'bank', 1),
    (new.id, 'Cash', 'cash', 2)
  on conflict (user_id, name) do nothing;

  insert into public.categories (user_id, tipe, name) values
    (new.id, 'pemasukan', 'Gaji'),
    (new.id, 'pemasukan', 'Investasi'),
    (new.id, 'pemasukan', 'Bonus & Hadiah'),
    (new.id, 'pemasukan', 'Lainnya'),
    (new.id, 'pengeluaran', 'Makanan & Minuman'),
    (new.id, 'pengeluaran', 'Transportasi'),
    (new.id, 'pengeluaran', 'Tagihan & Langganan'),
    (new.id, 'pengeluaran', 'Belanja & Kebutuhan'),
    (new.id, 'pengeluaran', 'Hiburan'),
    (new.id, 'pengeluaran', 'Kesehatan'),
    (new.id, 'pengeluaran', 'Lainnya')
  on conflict (user_id, tipe, name) do nothing;

  insert into public.settings (user_id, key, value) values
    (new.id, 'payrollDay', '28'),
    (new.id, 'currentPeriod', to_char(now(), 'YYYY-MM'))
  on conflict (user_id, key) do nothing;

  return new;
end;
$$;

-- 2. Kunci kolom: cabut hak UPDATE profiles dari role authenticated.
--    Perubahan role/status kini HANYA bisa lewat service_role (edge function
--    admin-user-ops). Grep seluruh web/ sebelum migrasi ini menunjukkan
--    tidak ada lagi update langsung profiles yang sah dari klien: dua
--    pemakaian terakhir (api_setUserRole/api_setUserStatus) sudah dipindah
--    ke edge function, display_name diubah lewat RPC security-definer
--    update_own_display_name, dan sisanya hanya SELECT. Karena itu tidak
--    ada GRANT UPDATE kolom yang dipertahankan — bila suatu saat klien
--    butuh update langsung satu kolom non-sensitif, tambahkan GRANT
--    UPDATE(kolom) eksplisit di sini dan catat alasannya.
--    SELECT tetap dipertahankan (klien membaca profil sendiri / daftar
--    pengguna untuk admin lewat RLS).
revoke update on public.profiles from authenticated;

-- 3. Pastikan policy admin untuk UPDATE profiles tetap ada (defense in
--    depth bersama pencabutan hak kolom di atas, dan pengaman bila hak
--    UPDATE suatu saat diberikan kembali). Policy ini berasal dari migrasi
--    20261115000000_admin_panel_hardening.sql; is_admin() versi final
--    (20261115040200) mensyaratkan role='admin' AND status='active'.
drop policy if exists "admins_update_profiles" on public.profiles;
create policy "admins_update_profiles" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
