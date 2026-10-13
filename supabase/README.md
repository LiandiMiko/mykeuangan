# Bot Telegram (Edge Function) — tahap 3a + 3b-1

Prasyarat: Supabase CLI terpasang (`npm i -g supabase` atau `npx supabase`), sudah `supabase login`.

1. Di folder repo:   `supabase init`  (sekali; folder supabase/ sudah ada, pilih tidak menimpa file)
                     `supabase link --project-ref <PROJECT_REF>`
2. Tabel tambahan:   `supabase db push`   (menjalankan SEMUA file di migrations/)
                     — atau salin isi tiap file migrations/ ke SQL Editor lalu Run, berurutan
                       (20261012000000_bot.sql lalu 20261013000000_bot_lock.sql).
   Update dari 3a ke 3b-1: cukup jalankan 20261013000000_bot_lock.sql, lalu tempel ulang index.ts dan Deploy.
3. Secrets (bukan di kode!):
   supabase secrets set TELEGRAM_BOT_TOKEN=<token dari @BotFather>
   supabase secrets set TELEGRAM_WEBHOOK_SECRET=<string acak panjang, huruf/angka/_/- saja>
   supabase secrets set GEMINI_API_KEY=<key Gemini>
   (opsional) APP_TIMEZONE=Asia/Jakarta, GEMINI_MODEL_PARSER=gemini-3.5-flash-lite
4. Deploy:           `supabase functions deploy telegram-bot --no-verify-jwt`
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
