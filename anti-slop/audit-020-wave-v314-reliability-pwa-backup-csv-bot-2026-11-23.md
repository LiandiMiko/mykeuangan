# Audit 020: Wave v3.14 Reliability, PWA Offline, CSV Bank Import, Backup 8 Koleksi, Telegram Bot & CI/CD - 2026-11-23

Status: Partial (Seluruh perbaikan core frontend, PWA offline, parser CSV, simulator utang/Quick-Add, backup/restore 8 koleksi, Edge Function Telegram Bot, GitHub Actions CI/CD, test regresi, serta catatan rilis telah selesai dan diperiksa dengan scanner statis MCP `aislop`, `website_ai_detector`, dan `token_efficient_grep`; verifikasi runtime lokal `npm run check && npm run build:prod` serta deploy Edge Function `supabase functions deploy telegram-bot --no-verify-jwt` dijalankan pengguna secara lokal karena keterbatasan shell environment)

## Cakupan & Peningkatan Wave v3.14

1. **Bugfix Core Frontend, Chart & UX Modal (`web/ui-dashboard.js`, `web/ui-feat-hooks.js`, `web/ui-pro-hooks.js`, `web/ui-shell.js`, `web/supabase-auth.js`, `web/ui-assets.js`, `web/ui-feat-charts.js`, `web/ui-feat-ai.js`, `web/ui-asset-ops.js`, `web/ui-pro-quick.js`)**:
   - Mengekspor `buildEmptyTxPlaceholder` pada `web/ui-dashboard.js` agar tampilan kosong Histori dapat memanggil helper dari global scope tanpa jatuh ke fallback kosong.
   - Menambahkan guard `document.getElementById('mkCommandPalette')` pada listener keyboard global di `web/ui-feat-hooks.js` dan pada handler `Escape` di `web/ui-pro-hooks.js` agar pengetikan di Command Palette tidak memicu shortcut satu huruf.
   - Menghapus `mk_last_market_refresh_ts` dari `sessionStorage` saat `logout()` di `web/supabase-auth.js`.
   - Menambahkan deteksi `prefers-reduced-motion: reduce` pada `Chart.defaults.animation` dan `window.scrollTo` di `web/ui-shell.js` (serta menormalisasi `#ui-role` ke `.toUpperCase()` di dua titik render), pada `buildPortfolioChartOptions` di `web/ui-assets.js` (sekaligus mengubah display `#portfolioChartPlaceholder` menjadi `'flex'`), dan pada tiga chart (`renderCategoryDonutChart`, `renderCashflowBarChart`, `renderNetWorthChart`) di `web/ui-feat-charts.js` — ditambah legend donut `'bottom'` untuk layar `< 640px` serta peningkatan kontras sumbu Net Worth mode terang (`#475569`) dan warna aksen `--color-brand`.
   - Menghapus dead code single-turn `formatAiTextSafe()` dan `runAiFinancialChat()` di `web/ui-feat-ai.js` (multi-turn `ui-pro-insights.js` menjadi jalur tunggal yang aktif), memformat nominal IDR pada `#tu-amount`, `#tu-price`, `#wd-amount` di `web/ui-asset-ops.js` disertai `<label for>` eksplisit, serta menyaring opsi `#tpl-cat` sesuai `#tpl-tipe` + menambahkan pemilih `#tpl-wallet` di `web/ui-pro-quick.js`.

2. **Ketahanan Service Worker & Antrean Offline (`web/sw.js`, `web/ui-feat-offline.js`, `web/ui-feat-updates.js`, `web/ui-pro-hooks.js`)**:
   - Menambahkan `./icons/icon-512.png` dan `./icons/icon-maskable.png` ke `ASSETS_TO_CACHE`, merangkai `self.clients.claim()` ke dalam `event.waitUntil()` saat `activate`, menormalkan cache HTML `/?action=...` ke `'./index.html'`, dan membungkus `cache.put()` serta revalidasi SWR di `event.waitUntil()`.
   - Menggunakan ulang promise koneksi `openOfflineDb()` (`offlineDbPromise`) dengan handler `onversionchange` / `onclose`, menambahkan penanganan error non-jaringan (poison-pill) dengan `MAX_OFFLINE_RETRIES = 3`, helper `retryFailedOfflineItems()` dan `discardFailedOfflineItems()`, status pill `Gagal (N)` di header, prompt interaktif **Coba Ulang** / **Buang Gagal**, serta notifikasi `offline:failed` (`actionType: 'offline_failed'`) pada Notification Center.

3. **Parser CSV E-Statement Bank, Quick-Add `Rp`, Debt Cap & Backup/Restore 8 Koleksi (`web/transaction-import.js`, `web/finance-pro.js`, `web/ui-pro-insights.js`, `web/finance-analysis-backup.js`, `web/ui-feat-backup.js`)**:
   - Memperkuat `detectDelimiter()` hingga 10 baris awal, menambah `findHeaderRowIndex()` untuk melewati preambel header hingga 15 baris dengan menjaga pesan error `'Kolom wajib...'`, mendukung awalan `IDR`, angka kurung akuntansi `(150.000)`, suffix `DB`/`CR` tanpa spasi (`25.000DB`), dan deduplikasi `keterangan` case-insensitive pada `fingerprint()`.
   - Mendukung awalan `Rp` / `Rp.` pada `parseQuickAmountToken()` di `web/finance-pro.js`, menambah properti `capped` pada `simulateDebtPayoff()` saat cicilan mencapai batas 600 bulan beserta catatan peringatan dan `<label for="calc-extra">` di `web/ui-pro-insights.js`.
   - Menghapus emoji dekoratif pada `projectGoalMilestone()`, memperluas `prepareBackupRestorePayload()` secara aditif ke 8 koleksi (`categories`, `wallets` + `walletNameByOldId`, `transactions`, `budgets`, `goals`, `recurring`, `assets`, `debtDueDates`), menaikkan `version: '3.14'` di `exportBackupJson()`, mengimplementasikan restore berurutan ketergantungan dengan pemetaan ulang `walletId` di `applyBackupRestorePlan()`, serta menyelaraskan warna `--color-brand` dan menghapus emoji print di `openFinancialStatementModal()`.

4. **Hardening Telegram Bot & GitHub Actions CI/CD (`supabase/functions/telegram-bot/*.ts`, `.github/workflows/deploy.yml`)**:
   - Menyeragamkan teks sapaan/pairing ke `MyKeuGuech Bot` / `MyKeuGuech` pada `index.ts` dan `ai.ts`, menambahkan `AbortSignal.timeout()` di `tg()` (`core.ts`), Gemini AI (`callGeminiJson`, `askInsight`) dan unduh media Telegram (`ai.ts`), serta CoinGecko (`fetchPricesIDR` di `jobs.ts`).
   - Memperluas `CRYPTO_MAP` (`POL`, `SUI`, `TON`, `LTC`, `BCH`, `NEAR`, `APT`, `RENDER`) dan menambahkan filter tanggal server `gteFilter` pada `fetchAll()` untuk memangkas beban kueri `dailyReminder()` (366 hari) dan `weeklyReport()` (7 hari).
   - Memisah `.github/workflows/deploy.yml` menjadi job `verify` (jalan di PR + push ke `main`, Node 22) dan `deploy` (`needs: verify`, `if: github.event_name != 'pull_request'`, Node 22, fallback `vars.SUPABASE_URL`/`vars.SUPABASE_ANON_KEY` bila `web/config.js` belum ada).

5. **Unit Test & Sinkronisasi Catatan Rilis (`tests/*.test.js`, `package.json`, `src/Index.html`, `src/updates.html`, `README.md`)**:
   - Memperluas unit test di `tests/transaction-import.test.js`, `tests/finance-pro.test.js`, `tests/finance-analysis.test.js`, dan `tests/pro-web-ui.test.js`, serta memperbarui versi ke `3.14.0` / `v3.14` (`Menampilkan 15 rilis`) pada `package.json`, `src/Index.html`, `src/updates.html`, dan `README.md`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **93/100** across **59 files** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, **1 error** pre-existing di `web/config.js:6` (`security/hardcoded-secret` untuk public Supabase client anon key), serta 2 `info` (`knip/skipped`, `security/dependency-audit-skipped` karena `npm` tidak tersedia di sandbox MCP).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Score **0** (`Human-Built`, verdict **PASS** across **16 files**, **220.583 bytes**).
- **CATATAN (`konoha:anti_slop` `strict: true`)**: Melaporkan status `failed` (**85/100**) karena 1 temuan lingkungan `scanner_nonzero_exit` (`MODULE_NOT_FOUND` pada `npm-prefix.js` & `npx-cli.js` di sandbox MCP Node `v24.19.0`); **0** temuan AI-slop pada kode sumber.
- **PASS (`konoha:token_efficient_grep`)**:
  - `web/`: **0** `transition-all`, **0** `ph-*-bold|fill|...`, **0** `console.log(`, **0** `bg-${`, hanya **1** `.innerHTML = ''` di `web/ui-calendar.js:206`.
  - `src/`: **0** `<article` di `src/admin.html`, **0** active `transition-all` class (hanya teks dokumentasi di `src/updates.html:112`), **0** `ph-*-bold|fill|...`, **0** `console.log(`, **0** `.innerHTML`, **0** `bg-${`.
  - Branding: **0** string user-facing `MyKeuangan`/`MyKeuanganGuech` di `src/`, `web/`, serta `supabase/functions/telegram-bot/`.
- **BELUM DIVERIFIKASI LOKAL (Memerlukan Lingkungan Pengguna)**: `npm run check && npm run build:prod` dan `supabase functions deploy telegram-bot --no-verify-jwt`.
