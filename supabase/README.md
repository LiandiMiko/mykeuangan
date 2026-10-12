# Bot Telegram (Edge Function) — tahap 3a

Prasyarat: Supabase CLI terpasang (`npm i -g supabase` atau `npx supabase`), sudah `supabase login`.

1. Di folder repo:   `supabase init`  (sekali; folder supabase/ sudah ada, pilih tidak menimpa file)
                     `supabase link --project-ref <PROJECT_REF>`
2. Tabel tambahan:   `supabase db push`   (menjalankan migrations/20261012000000_bot.sql)
                     — atau salin isi file itu ke SQL Editor lalu Run.
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
