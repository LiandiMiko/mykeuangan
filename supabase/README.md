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
   CRON_SECRET        = string acak panjang (huruf/angka)
   COINGECKO_API_KEY  = key demo CoinGecko BARU (key lama pernah tertulis di kode → rotate)
   (opsional) APP_TIMEZONE=Asia/Jakarta
2. Dashboard → Database → Extensions: aktifkan pg_cron dan pg_net.
3. Buka schedule.sql, ganti PROJECT_REF dan CRON_SECRET_ANDA, jalankan di SQL Editor.
4. Matikan trigger lama di Apps Script (ikon jam → Triggers → hapus SEMUA:
   dailyReminder, weeklyReport, runRecurring, savePortfolioSnapshot, dan polling bila masih ada).
   Kalau tidak, pesan akan terkirim dobel.
5. Tes manual (SQL Editor), mis. reminder harian sekarang juga:
   select net.http_post(
     url := 'https://PROJECT_REF.supabase.co/functions/v1/telegram-bot',
     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CRON_SECRET_ANDA'),
     body := jsonb_build_object('job','daily'));
6. Website: deploy ulang frontend (push ke GitHub). Tombol refresh harga di dashboard sekarang aktif.
