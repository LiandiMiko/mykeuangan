# MyKeuanganGuech (Supabase + GitHub Pages)

Struktur
- `src/`   — frontend lama (Index, dashboard, utang, form, laporan, budgeting, script, i18n) + **styles.html (wajib ditambahkan, ambil dari project Apps Script lama)**
- `web/`   — `config.js` (URL + anon key Supabase) dan `supabase-api.js` (pengganti google.script.run)
- `db/`    — `schema.sql` (jalankan di Supabase) dan `ExportToSQL.gs` (migrasi sekali dari Sheets)
- `build.mjs` — gabungkan semuanya jadi `dist/index.html`

Jalankan lokal
1. Salin `styles.html` ke `src/`. Salin `web/config.example.js` menjadi `web/config.js` lalu isi (file ini tidak ada di zip supaya tidak tertimpa saat Anda memperbarui kode).
2. `node build.mjs` lalu buka `dist/index.html` (atau `npx serve dist`).

Deploy
1. Push ke GitHub (branch `main`), Settings → Pages → Source: **GitHub Actions**.
2. Supabase → Authentication → URL Configuration: tambahkan URL Pages Anda.
3. Supabase → Authentication → matikan pendaftaran publik (Allow new users to sign up = off).

JANGAN commit `Code.gs` / `Telegram.gs` lama ke repo publik: ada API key tertulis di dalamnya.
