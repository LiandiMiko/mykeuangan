# Bot Telegram (Edge Function) — tahap 3a + 3b-1

Prasyarat: Supabase CLI terpasang (`npm i -g supabase` atau `npx supabase`), sudah `supabase login`.

1. Di folder repo:   `supabase init`  (sekali; folder supabase/ sudah ada, pilih tidak menimpa file)
                     `supabase link --project-ref <PROJECT_REF>`
2. Untuk project baru, jalankan `db/schema.sql` lalu `db/002_wallets.sql` di SQL Editor.
   `supabase db push` hanya menjalankan file di `supabase/migrations/`; skema awal tersebut belum ada di direktori migrasi.
   Jalankan migrasi yang belum diterapkan sesuai urutan nama timestamp, termasuk `20261115040200_application_hardening.sql`.
   Untuk project yang sudah memiliki tabel dompet, jangan jalankan ulang `db/002_wallets.sql`.
3. Secrets (bukan di kode!):
   supabase secrets set TELEGRAM_BOT_TOKEN=<token dari @BotFather>
   supabase secrets set TELEGRAM_WEBHOOK_SECRET=<string acak panjang, huruf/angka/_/- saja>
   supabase secrets set GEMINI_API_KEY=<key Gemini>
   supabase secrets set ALLOWED_ORIGIN=https://<username>.github.io,http://localhost:4173
   (mendukung banyak origin dipisah koma tanpa trailing slash; opsional: APP_TIMEZONE=Asia/Jakarta, GEMINI_MODEL_PARSER=gemini-4-hydrogen, GEMINI_MODEL_INSIGHT=gemini-4-hydrogen)
4. Deploy:           `supabase functions deploy telegram-bot --no-verify-jwt`
   Reset password admin: `supabase functions deploy admin-password` (jangan gunakan `--no-verify-jwt`)
5. Daftarkan webhook (ganti nilai; ini juga otomatis mematikan polling lama):
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot" \
     -d "secret_token=<WEBHOOK_SECRET yang sama>"
6. Matikan trigger polling di Apps Script (jalankan stopPolling()) supaya tidak bentrok.
7. Kirim pesan apa saja ke bot → bot membalas "Chat ini belum terdaftar" + chat_id Anda.
   Daftarkan di SQL Editor:
   insert into public.telegram_chats (chat_id, name, user_id)
   values (<CHAT_ID>, 'Nama Anda', (select id from auth.users where email = 'email@anda'));
8. Kirim "halo" → status keuangan muncul. Coba "kopi 25rb".

Log/debug: Supabase Dashboard → Edge Functions → telegram-bot → Logs.

---
# Penunjukan admin pertama (manual, wajib setelah migrasi Gelombang 1)

Sejak migrasi `20261128000000_wave1_admin_hardening.sql`, pendaftar baru
**tidak pernah** otomatis menjadi admin: `handle_new_user()` selalu memberi
role `'user'`, dan perubahan role/status hanya bisa dilakukan lewat edge
function `admin-user-ops` (service_role). Migrasi ini **tidak membuat admin
baru** — tanpa langkah manual di bawah, sistem tidak punya admin sama sekali
dan panel admin tidak bisa dipakai siapa pun. Lakukan berurutan:

1. Apply migrasi di SQL Editor sesuai urutan timestamp (termasuk
   `20261128000000_wave1_admin_hardening.sql`). Pastikan tidak ada error.
2. Deploy ulang edge function yang berubah:
   `supabase functions deploy admin-user-ops` (jangan gunakan
   `--no-verify-jwt` — endpoint ini memverifikasi JWT pemanggil sendiri).
3. Sebagai pemilik, tunjuk admin pertama lewat SQL Editor (ganti emailnya):
   `update public.profiles set role = 'admin' where email = 'email@pemilik';`
   Hanya akun pemilik yang ditunjuk di langkah ini — jangan menunjuk akun
   lain sebelum admin pertama aktif.
4. Verifikasi hanya admin yang dimaksud yang ada:
   `select email, role, status from public.profiles where role = 'admin';`
   Hasilnya harus tepat satu baris (akun pemilik, status `active`). Bila ada
   admin lain yang tidak dikenal, segera ubah ke `'user'` dan selidiki
   sebelum lanjut.
5. Deploy klien baru (push ke GitHub) supaya `api_setUserRole` /
   `api_setUserStatus` memakai edge function, bukan update langsung.

Catatan: sebelum langkah 3 selesai, tidak ada yang bisa menjadi admin lewat
pendaftaran — ini disengaja. Admin tambahan setelahnya ditunjuk lewat panel
admin (oleh admin aktif), bukan lewat SQL. Edge function menolak demosi /
penonaktifan admin aktif terakhir, begitu pula trigger DB
`prevent_admin_lockout`, jadi selalu sisakan minimal satu admin aktif.

---
# Tahap 3c — otomatisasi (reminder, laporan mingguan, recurring, snapshot, harga crypto)

Update dari 3b-1: tempel ulang index.ts + Deploy (Verify JWT tetap MATI), lalu:

1. Secrets baru (Edge Functions → Secrets):
   CRON_SECRET        = string acak panjang (huruf/angka, >= 32 karakter)
   COINGECKO_API_KEY  = key demo CoinGecko BARU (key lama pernah tertulis di kode → rotate)
   (opsional) APP_TIMEZONE=Asia/Jakarta
   Nilai CRON_SECRET yang SAMA wajib juga disimpan di Vault dengan nama
   'cron_secret' (lihat "Rotasi CRON_SECRET" di bawah) — schedule.sql
   membaca secret dari Vault saat job dipicu, bukan dari teks definisi job.
2. Dashboard → Database → Extensions: aktifkan pg_cron, pg_net, dan Vault.
3. Buka schedule.sql, ganti PROJECT_REF saja (tidak ada lagi secret di
   file ini), jalankan di SQL Editor. File ini menghapus dulu jadwal
   lama (mk-daily-reminder, mk-weekly-report, mk-recurring, mk-snapshot)
   lalu membuat ulang keempatnya dengan secret dari Vault.
4. Matikan trigger lama di Apps Script (ikon jam → Triggers → hapus SEMUA:
   dailyReminder, weeklyReport, runRecurring, savePortfolioSnapshot, dan polling bila masih ada).
   Kalau tidak, pesan akan terkirim dobel.
5. Tes manual (SQL Editor), mis. reminder harian sekarang juga — secret
   dibaca dari Vault, jangan pernah menempel nilai aslinya di query:
   select net.http_post(
     url := 'https://PROJECT_REF.supabase.co/functions/v1/telegram-bot',
     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
     body := jsonb_build_object('job','daily'));
6. Website: deploy ulang frontend (push ke GitHub). Tombol refresh harga di dashboard sekarang aktif.

---
# Rotasi CRON_SECRET (Gelombang 2.3, T9)

Sejak Gelombang 2.3, `CRON_SECRET` tidak lagi tertulis di definisi job
`pg_cron` — job membaca secret dari Supabase Vault saat dipicu. Tapi
secret lama yang pernah tertulis di `cron.job` (dan di riwayat git)
harus dianggap sudah bocor: rotasi adalah solusinya, bukan sekadar
menghapusnya dari file. Lakukan urutan ini setiap kali secret diduga
bocor, dan berkala sebagai kebiasaan baik. Nilai secret yang baru
HANYA diketik di SQL Editor / Dashboard — jangan pernah menuliskannya
di file repo, chat, atau tiket.

a) Buat secret baru (>= 32 karakter acak) di terminal lokal:
   `openssl rand -hex 32`
   (menghasilkan 64 karakter hex — simpan sementara di tempat aman
   sampai langkah (b) dan (c) selesai, lalu hapus dari riwayat shell
   bila perlu.)
b) Simpan nilai yang SAMA di Vault (SQL Editor). Pertama kali:
   `select vault.create_secret('<NILAI_CRON_SECRET_BARU>', 'cron_secret');`
   Rotasi berikutnya (secret 'cron_secret' sudah ada — membuat lagi
   dengan nama yang sama akan gagal duplikat, jadi update yang ada
   berdasarkan id-nya):
   `select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<NILAI_CRON_SECRET_BARU>');`
   Tanda `vault.update_secret(secret_id, new_secret, ...)` mengikuti
   dokumentasi resmi Vault (supabase.com/docs/guides/database/vault).
c) Set nilai yang SAMA sebagai secret edge function `CRON_SECRET`
   (nilai inilah yang dibandingkan `handleJob` di
   `supabase/functions/telegram-bot/jobs.ts`):
   Dashboard → Edge Functions → telegram-bot → Secrets, atau lewat CLI:
   `supabase secrets set CRON_SECRET=<NILAI_CRON_SECRET_BARU>`
   lalu deploy ulang fungsinya supaya secret baru dipakai:
   `supabase functions deploy telegram-bot --no-verify-jwt`
   (Verify JWT tetap MATI untuk fungsi ini — autentikasi cron memakai
   header `x-cron-secret`, bukan JWT.)
d) Jadwalkan ulang keempat job dari schedule.sql yang sudah diperbarui
   (file ini menghapus jadwal lama dulu, jadi cukup jalankan ulang
   seluruh file di SQL Editor). Bila ingin menghapus manual:
   `select cron.unschedule('mk-daily-reminder');`
   `select cron.unschedule('mk-weekly-report');`
   `select cron.unschedule('mk-recurring');`
   `select cron.unschedule('mk-snapshot');`
e) Verifikasi setelah run berikutnya (setiap pemanggilan job yang lolos
   autentikasi tercatat di `cron_job_runs` — lihat migrasi
   `20261128010000_wave2_cron_job_runs.sql`):
   `select * from cron_job_runs order by started_at desc limit 5;`
   Harus muncul baris baru dengan status 'ok' dan invoked_by 'cron'.
   Bila status 'error' atau tidak ada baris baru, cek
   `cron.job_run_details` dan log Edge Functions — kemungkinan Vault
   dan secret edge function berisi nilai yang berbeda (langkah (b)
   dan (c) harus sama persis).

Catatan: Vault menutup kebocoran lewat definisi `cron.job`, tetapi
selama request menunggu di antrean `net.http_request_queue`, header
yang sudah didekripsi masih bisa dibaca role database yang punya
akses ke antrean itu (lihat catatan di schedule.sql). Jadi batasi
akses SQL langsung hanya untuk operator tepercaya, dan rotasi lagi
bila akses itu pernah jatuh ke tangan yang salah.

---
# Gelombang 3.3 — Edge Functions (S14–S19)

## ALLOWED_ORIGIN fail-closed (semua fungsi)
Sejak Gelombang 3.3, CORS **tidak lagi fail-open**: nilai default `*`
dihapus dari `admin-password`, `admin-user-ops`, `telegram-setup`, dan
`telegram-bot` (jobs.ts). Atur secret ini eksplisit per environment:

`supabase secrets set ALLOWED_ORIGIN=https://<username>.github.io,http://localhost:4173`

- Daftar origin dipisah koma, tanpa trailing slash. `*` di dalam daftar
  **ditolak** (bukan wildcard).
- Origin request yang tidak ada di daftar TIDAK mendapat header
  `Access-Control-Allow-Origin` sama sekali — browser menolak respons.
- Bila secret belum diisi: request tanpa header `Origin` memakai default
  aman `https://liandimiko.github.io`; request dengan origin lain
  ditolak.
- `telegram-setup` sebelumnya membaca `ALLOWED_ORIGINS` (jamak) — sejak
  3.3 diseragamkan ke `ALLOWED_ORIGIN` (tunggal). Bila Anda masih
  menyimpan `ALLOWED_ORIGINS` di secrets, hapus dan isi `ALLOWED_ORIGIN`.
- Pengecualian eksplisit: WebView native (Capacitor) dari
  `https://localhost`, `capacitor://localhost`, `http://localhost`
  selalu diizinkan (lihat jobs.ts).

## CoinGecko + currency-api (telegram-bot/jobs.ts)
- Kunci `COINGECKO_API_KEY` dikirim sebagai **header**
  `x-cg-demo-api-key`, tidak pernah lagi di query string URL.
- currency-api di-pin ke versi stabil **2026.11.27** (diverifikasi dari
  registry npm; konstanta `CURRENCY_API_VERSION` di jobs.ts, dan versi
  yang sama ditulis di `wave3-currency-api-version.txt` di root repo
  supaya web memakai versi identik). Jangan kembalikan `@latest`.

## Audit admin lewat RPC + notifikasi Telegram
- `admin-password` dan `admin-user-ops` mencatat audit HANYA lewat RPC
  `admin_log_action(p_action, p_target_user_id, p_target_email,
  p_details)` — INSERT langsung ke `admin_audit_logs` dicabut migrasi
  Gelombang 3. RPC dipanggil lewat klien yang membawa JWT admin peminta
  (actor diturunkan dari `auth.uid()`).
- Reset password gagal audit → respons **500** yang menyatakan password
  sudah berubah tapi audit gagal (jangan diam-diam).
- Reset password admin (Gelombang 7a) juga mencabut SEMUA sesi target
  lewat RPC `admin_revoke_user_sessions(p_target_user_id)` (migrasi
  `20261128120000`, SECURITY DEFINER, hanya service_role; terapkan
  migrasi SEBELUM deploy `admin-password`, atau pencabutan gagal
  fail-soft). Kegagalan pencabutan TIDAK membatalkan reset, tetapi
  tercatat di `details` audit (`sessions_revoked` /
  `sessions_revoke_error`) dan di respons (`sessionsRevokeFailed`).
  Batasan jujur: access token yang sudah diterbitkan tetap valid
  sampai `exp` (±1 jam); hanya refresh token-nya yang mati — sama
  seperti `auth.admin.signOut` resmi, yang tetap butuh JWT target
  (tidak dimiliki server) dan karena itu tidak dipakai di sini.
- Reset password, hapus user, dan ubah role/status mengirim notifikasi
  Telegram ke pemilik akun (bot personal dulu, fallback token env).
  Bila tidak ada chat tertaut, hasilnya dicatat di `details` audit
  (`telegram_notified: false`, `telegram_reason: 'no_linked_chat'`).

## Purge pairing OTP kedaluwarsa
Setiap pemanggilan cron (`handleJob`, jalur cron saja) memanggil RPC
`purge_expired_telegram_pairings()` (migrasi Gelombang 3). Best-effort:
bila fungsi belum ada / RPC gagal, error hanya masuk log dan job tetap
jalan.
