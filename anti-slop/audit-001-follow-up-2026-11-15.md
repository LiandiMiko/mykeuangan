# Audit 001 Follow-up - 2026-11-15

## Perbaikan yang disetujui

1. Tombol reset data demo, fungsi UI/API, dan string terjemahannya dihapus. Cache PWA dinaikkan ke v2 agar deployment baru membuang cache lama.
2. Panel admin kini memeriksa error query, menampilkan pesan gagal beserta tombol coba lagi, dan tidak menampilkan sukses jika pemuatan ulang gagal.
3. Policy update profil diubah menjadi admin-only pada migrasi baru.
4. `telegram_pairings.user_id` mendapat default `auth.uid()` pada migrasi baru.
5. Kegagalan membaca profil saat login sekarang ditampilkan.
6. Metrik Telegram diperjelas sebagai jumlah untuk akun admin yang sedang login.
7. Trigger pendaftar pertama diserialisasi dan backfill migrasi onboarding membatasi admin pertama. Database yang sudah menjalankan backfill lama tetap perlu ditinjau manual; role tidak diturunkan otomatis.
8. Pembatasan zoom dihapus agar pengguna dapat memperbesar halaman.

## Perubahan password admin

Admin dapat mengganti password sendiri melalui Supabase Auth. Admin juga dapat mengatur password akun lain melalui Edge Function `admin-password`, yang memvalidasi JWT, role admin aktif, target akun, dan panjang password. Service role hanya digunakan di server.

## Verifikasi

- PASS: `node build.mjs`.
- PASS: 7 inline script hasil build lolos parse JavaScript.
- PASS: `node --check supabase/functions/admin-password/index.ts`.
- PASS: `git diff --check`.
- PASS: pencarian source dan hasil build tidak menemukan kontrol atau handler reset demo lama.
- BLOCKED: uji Edge Function dengan Deno karena Deno tidak tersedia di lingkungan ini.
- BLOCKED: uji klik end-to-end karena Playwright tidak tersedia dan belum ada sesi akun Supabase untuk mereproduksi panel admin.

## Langkah deploy yang masih diperlukan

1. Jalankan `supabase/migrations/20261115000000_admin_panel_hardening.sql`.
2. Deploy `supabase/functions/admin-password` dengan verifikasi JWT tetap aktif.
3. Jika migrasi onboarding lama sudah dijalankan, tinjau role admin yang ada sebelum menurunkan role yang tidak semestinya.
4. Uji login, daftar pengguna, suspend/role, pairing Telegram, dan kedua alur password pada project Supabase.
