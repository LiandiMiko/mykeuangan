# Audit 012: Wave v3.4 Security Hardening, Atomic RPCs, Bug Fixes & Code Hygiene - 2026-11-20

Status: Complete

## Cakupan & Implementasi

### 1. Keamanan Infrastruktur, Privasi Klien & Sanitasi Ekspor (`P0`/`P2`)
- **`supabase/schedule.sql`**: Menghapus 4 URL Supabase produksi hardcoded dan nilai `x-cron-secret` `'27'`, menggantinya dengan placeholder `<PROJECT_REF>` dan `<CRON_SECRET_MIN_32_CHARS>` beserta catatan rotasi rahasia cron.
- **Sesi & Logout (`web/supabase-api.js`)**: Mengganti 11 referensi bare `sessionUser`/`sessionRole` (`eslint/no-undef`) ke `window.sessionUser`/`window.sessionRole` (serta deklarasi `var sessionUser`/`var sessionRole` di `src/script.html`), dan memperluas `window.logout()` untuk membersihkan `mk_gemini_api_key`, `mk_gemini_model`, `mk_app_pin_hash`, `mk_app_pin_salt`, `mk_offline_tx_queue_v1`, `sessionStorage.mk_pin_unlocked`, dan database IndexedDB `mykeuangan_offline_db`.
- **PIN Lock (`src/features-v21.html`)**: Meningkatkan `hashPin`/`verifyPinMatches` dari SHA-256 tanpa salt ke PBKDF2-SHA256 tersalt per-browser (`100.000` iterasi) dengan migrasi otomatis untuk hash legacy.
- **Anti-XSS & Formula Injection (`src/script.html`, `src/features-v21.html`)**: Melakukan HTML escaping via `escapeHtmlJS()` pada judul SweetAlert2 di `manageDebtEntity`, `transactDebt`, `editBudgetInline`, dan berbagai modal `features-v21.html`; menambahkan netralisasi awalan `^[=+\-@\t\r]` di `csvEscapeCell` (`src/script.html`) serta sel ekspor XLS di `exportExcel` (`src/features-v21.html`); memastikan `exportPDF()` menggunakan `_origFormatRupiah` meskipun mode *Hide Nominal* aktif.

### 2. Migrasi Database & Atomicity (`supabase/migrations/20261120000000_hardening_assets_profile_wallets.sql`, `web/supabase-api.js`)
- **`public.update_own_display_name(text)`**: Memungkinkan user non-admin memperbarui `display_name` profil sendiri secara aman tanpa menabrak pembatasan RLS `profiles`.
- **RPC Aset Multi-Tipe Atomik (`create_asset_with_expense`, `top_up_asset`, `liquidate_asset`)**: Menambahkan parameter & pembaruan atomik `unit_label`, `price_per_unit`, dan `buy_price` langsung di PostgreSQL untuk `Crypto`, `Emas`, `USD`, `Saham`, `Cash`, dan `Other`; menghapus client-side second `UPDATE` non-atomik pada `api_addAssetV2`, `api_topUpAsset`, dan `api_withdrawAsset`.
- **Hardening `delete_wallet`**: Menyelamatkan mutasi histori dompet serta mencatat saldo awal pembuka saat dompet dihapus, alih-alih menghapus jejak saldo non-transfer.
- **Penandaan Rutin (`api_markRecurringRun`)**: Helper baru di `web/supabase-api.js` untuk memperbarui `recurring.last_run`.

### 3. Integritas Transaksi, Analitik, Kalender & Cetak (`src/features-v21.html`, `src/script.html`, `src/dashboard.html`, `src/i18n.html`, `src/styles.html`, `web/finance-analysis.js`, `tests/finance-analysis.test.js`)
- **Sinkronisasi Multi-Transaksi (`src/features-v21.html`)**: Memperbarui `flushOfflineQueue` dan *Split Bill* agar seluruh `addedTransactions` dikirim ke `refreshFromServer()` dan menambahkan guard tombol `#btnSubmitTrans`; `submitTransaction` di `src/script.html` juga diberi guard disabled anti double-submit.
- **Tagihan Rutin Jatuh Tempo (`web/finance-analysis.js`, `src/features-v21.html`)**: Memperbaiki `getDueRecurringBills` agar memeriksa tanggal jatuh tempo aktual terhadap siklus gaji (`dueDate <= curDateStr`), memperbarui `last_run` via `api_markRecurringRun` di `recordRecurringFromNotif` dan `batchRecordRecurring`, menambah pilihan dompet `#batch-rec-wallet`, memformat nominal notifikasi `buildAppNotifications` dalam Rupiah (`formatIdrSimple`), serta menjaga teks terjemahan `#recurringDueBanner` menggunakan `<span data-i18n="dash.recurring_due">`.
- **Net Worth Chart & Series (`web/finance-analysis.js`, `src/features-v21.html`)**: Membatasi `computeNetWorthSeries` hingga `endRange.end`, mengganti `new Array(...)` menjadi `Array.from(...)` (`unicorn/no-new-array`), memformat sumbu-Y dengan `formatShortIDR`, menunda render 60ms saat `switchView('aset')`, dan merender ulang chart saat tema berubah (`setTheme`).
- **Ringkasan Cetak 1-Halaman (`src/features-v21.html`, `src/styles.html`)**: Memperbaiki field `topExpenses` menjadi `e.category` & `e.amount`, menampilkan `'—'` saat `runwayMonths` bernilai `null`, dan mencetak lewat `#mkPrintStatementRoot` + `@media print`.
- **Kalender Finansial & Aset (`src/script.html`, `src/dashboard.html`, `src/i18n.html`)**: Menyinkronkan `kalenderYear`/`kalenderMonth` pada `saveCurrentPeriod`, memperluas auto-refresh `INIT` untuk `crypto`/`emas`/`usd`, menghapus duplikasi `grid.innerHTML = ''`, memisahkan `flowIn`/`flowOut` (tanpa `Utang`/`Piutang`) dari hitungan sel kalender serta menampilkan `visibleCount` sesuai filter `all`/`out`/`in`, menambahkan kunci `cal.filter_all`/`cal.filter_out`/`cal.filter_in`, menghapus dead code `addManualAssetUI` & `#budgetAnalysisCategories`/`#budgetTrend` di `src/script.html`, dan memperbarui unit test `tests/finance-analysis.test.js`.

### 4. Bot Telegram & Cache Busting PWA (`supabase/functions/telegram-bot/index.ts`, `web/sw.js`, `build.mjs`)
- **Deduplikasi Parser Gemini & Perintah Utang (`supabase/functions/telegram-bot/index.ts`)**: Mengekstrak `TX_AI_SCHEMA`, `callGeminiJson` (fallback `[GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash']` + ekstraksi dinamis seluruh model dari error 404/deprecated + penanganan `finishReason`/`promptFeedback`), dan `buildParsedTx` untuk `parseWithAI` & `parseMediaWithAI`; mengekstrak `handleDebtCommand(c, arg, kind)` menggunakan kategori `UtangPerson - ...` / `Piutang - ...` serta upsert `public.entities`.
- **Cron & Pairing Atomik (`supabase/functions/telegram-bot/index.ts`)**: Menambahkan `getActiveUserIds()` untuk memfilter user aktif pada `runRecurring`, `dailyReminder`, `weeklyReport`, `snapshotAll`, dan `handleJob`; mendukung tanggal akhir bulan `29..31` pada bulan lebih pendek (`.gte('day_of_month', day)` saat `day === lastDayOfMonth`); mengubah pairing OTP menjadi `DELETE ... RETURNING` atomik + pengecekan `upsertError`.
- **PWA Cache Versioning & Network-First HTML (`web/sw.js`, `build.mjs`)**: Mengganti `CACHE_NAME` ke `'mykeuangan-__BUILD_ID__'` yang diinjeksi hash SHA-256 isi `dist/index.html` saat build, dan memakai strategi *Network-First* (fallback cache saat offline) khusus permintaan navigasi/HTML.

## Verifikasi
- **PASS (`aislop:aislop_scan`)**: Skor kualitas meningkat dari **48/100** (12 errors, 17 warnings) menjadi **67/100** (1 error, 16 warnings). Seluruh **11 error `eslint/no-undef`**, **`unicorn/no-new-array`**, dan **`code-quality/duplicate-block` di `supabase/functions/telegram-bot/index.ts`** telah bersih (**0** temuan pada kategori tersebut). Satu-satunya error tersisa berasal dari `web/config.js:6` (`security/hardcoded-secret` atas client `anon` key Supabase pada file konfigurasi lokal yang sengaja di-gitignore dan tidak diedit).
- **PASS (`konoha:token_efficient_grep`)**:
  - `supabase/schedule.sql` bersih dari `usauytablxbiktnepwsi` dan `'27'`.
  - `supabase/functions/telegram-bot/index.ts` bersih dari `` `Utang - ``.
  - `src/features-v21.html` (`openFinancialStatementModal`) bersih dari `e.kategori` dan `e.total`.
  - `src/script.html` tetap memuat seluruh token wajib `tests/calendar-render.test.js` (`function renderKalender()`, regex `periodParts`, `kalenderYear`/`kalenderMonth`, `if (id === 'dashboard')`, `try { renderKalender(); } catch`, `grid.innerHTML = '';`, `grid.classList.add('grid', 'grid-cols-7')`).
- **PASS (`node --test`)**: Seluruh **26 dari 26** unit test lulus (**0 gagal**, durasi `315.87 ms`), termasuk seluruh pengujian kalender, siklus penggajian, budget, proyeksi, notifikasi, net worth series, statement compilation, dan parser CSV/bank.
- **PASS (`node build.mjs`)**: Build produksi berhasil (`dist/sw.js` dengan cache key `mykeuangan-40d4e4606438`, `dist/index.html` ukuran `538 KB`, seluruh aset PWA tersinkronisasi).
- **PASS (`git status` & kebersihan file)**: Ketiga file kosong usang (`src/perencanaan.html`, `src/rutin.html`, `src/target.html`) telah terhapus bersih dari working tree; `CRON_SECRET` telah dirotasi dan jadwal `pg_cron` diperbarui pengguna melalui Supabase Web Dashboard.

## Langkah Lanjutan untuk Pengguna
- Pastikan [20261120000000_hardening_assets_profile_wallets.sql](file:///c:/Users/Acer/Documents/GitHub/mykeuangan/supabase/migrations/20261120000000_hardening_assets_profile_wallets.sql) telah dijalankan di Supabase SQL Editor dan [telegram-bot/index.ts](file:///c:/Users/Acer/Documents/GitHub/mykeuangan/supabase/functions/telegram-bot/index.ts) ter-deploy di Edge Functions.
- Lakukan commit & push ke GitHub (`git add .`, `git commit`, `git push`) lalu uji singkat di browser (Kalender, Ringkasan Cetak, Grafik Net Worth, dan Ubah Nama).
