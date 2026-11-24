# Audit 023: Wave v3.17 Normalisasi Kategori Lintas Fitur, Auto-Kategori Kata Utuh & Audit Budgeting - 2026-11-25

Status: Complete (Perbaikan kode klien, analisis, bot Telegram, migrasi SQL, test regresi, serta pemindaian statis `aislop_scan`, `website_ai_detector`, dan `token_efficient_grep` selesai; eksekusi test runtime `node --test`, build lokal, eksekusi SQL di Supabase, dan deploy Edge Function `telegram-bot` dilakukan di lingkungan lokal/Supabase pengguna)

## Cakupan

Audit menyeluruh atas laporan transaksi kategori tertentu (misalnya `Laundry`) tidak masuk atau hilang dari perhitungan **Budgeting**, serta penelusuran masalah serupa di seluruh modul Web UI, inti analisis, Quick-Add, impor CSV, Laporan, Restore JSON, Edge Function `telegram-bot`, dan RPC PostgreSQL Supabase.

## Temuan

1. **HIGH — Pencocokan kategori case-sensitive dan tanpa `trim()` di Budgeting, Analitik, Chart & Bot (`web/ui-budget.js`, `web/finance-analysis-core.js`, `web/finance-analysis-portfolio.js`, `web/finance-pro.js`, `supabase/functions/telegram-bot/*`)**:
   - `actualByCat[tx.kategori]` dan `tx.kategori === b.kategori` di `web/ui-budget.js`, `summarizePeriod()` & `aggregateWalletAndPeriodFlows()` di `web/finance-analysis-core.js`, serta `actualFor()` / `budgetDetail()` di `telegram-bot` melakukan perbandingan ketat terhadap string mentah. Transaksi bertuliskan `laundry`, `LAUNDRY`, atau `Laundry ` masuk ke total pengeluaran siklus, namun hilang dari kartu budget `Laundry`, Donut Chart, peringatan overbudget, `recommendCategoryBudgets()`, Rekap Tahunan, dan Perbandingan Periode.
   - `buildParsedTx()` di `supabase/functions/telegram-bot/ai.ts` memakai `cats.includes(parsed?.kategori)` secara case-sensitive; jika Gemini mengembalikan `laundry` sementara daftar kategori user `Laundry`, transaksi diam-diam dibuang ke kategori `Lainnya`.
2. **HIGH — Auto-Kategori Quick-Add & CSV memakai `.includes()` substring & prioritas salah (`web/finance-pro.js`)**:
   - `applyAutoCategoryRules()` mencocokkan keyword pendek (seperti `kai`, `tol`, `air`, `tj`) tanpa batas kata dan berjalan sebelum pencocokan kategori milik user sendiri. Contoh nyata: input `laundry pakaian 25rb` cocok ke substring `kai` di dalam kata `pa**kai**an` sehingga dikategorikan sebagai `Transportasi`, bukan `Laundry`.
3. **MEDIUM — Silent category overwrite saat edit, ketidakonsistenan filter Dompet & Kategori di Laporan, dan Restore JSON (`web/ui-form.js`, `web/ui-recurring.js`, `web/transaction-import.js`, `web/ui-reports.js`, `web/ui-state.js`, `web/supabase-records.js`, `web/supabase-planning.js`)**:
   - `editTransaction()` langsung mengisi `<select id="tr_kategori">.value = tx.kategori`; jika kapitalisasi berbeda atau kategori telah dihapus dari daftar, dropdown bergeser ke opsi pertama dan menimpa kategori transaksi saat disimpan. Kondisi serupa juga terjadi di `openRecurringForm()`.
   - `getFilteredReportTransactions()` memakai filter ketat `transaction.walletId === walletId`, menjatuhkan transaksi lama bertanda `walletId === ''` saat pengguna memfilter dompet utama (tidak konsisten dengan `filterHistoriView()` dan saldo dompet).
   - `api_addCategory()` tidak menormalkan `tipe` ke huruf kecil (`pemasukan`/`pengeluaran`) sehingga `handleRestoreJsonFile()` yang mengirim `'Pemasukan'`/`'Pengeluaran'` ditolak constraint DB.
   - `promptAddCategory()` di `web/ui-form.js` tidak men-`trim()` nama kategori baru sebelum menambahkan `<option>` ke DOM.
   - `search_user_transactions` dan `rename_category_with_transactions` di Supabase SQL mencocokkan kategori secara case-sensitive dan filter `p_wallet_id` tidak menyertakan transaksi `wallet_id IS NULL` milik dompet utama.

## Perubahan

1. **Inti Analisis & Budgeting (`web/finance-analysis-core.js`, `web/finance-analysis-portfolio.js`, `web/ui-budget.js`)**:
   - Menambahkan & mengekspor `normalizeCategoryKey()` dan `cleanCategoryLabel()` serta helper `pickDisplayLabel()`, lalu memperbarui `isDebtCategory()`, `summarizePeriod()`, `aggregateWalletAndPeriodFlows()`, dan `recommendCategoryBudgets()` agar seluruh varian spasi dan kapitalisasi digabung menjadi satu baris kanonik.
   - Memperbarui `web/ui-budget.js` (`normalizeBudgetCatKey()`, `isDebtBudgetTx()`, `buildBudgetTxListHtml()`, `buildBudgetItemHtml()`, `bindBudgetListEvents()`, `renderBudgeting()`) untuk mencocokkan pengeluaran & transaksi secara case-insensitive serta mengecualikan `Utang`/`Piutang` secara konsisten.
   - Menambahkan seksi lipat **`Pengeluaran di Luar Budget`** (`buildUnbudgetedSectionHtml()`, kunci expand `__unbudgeted__`) yang menampilkan seluruh pengeluaran di siklus aktif yang kategorinya tidak memiliki budget lengkap dengan badge kategori dan tombol **Edit**.
2. **Quick-Add, Form, CSV, Laporan, Restore & State (`web/finance-pro.js`, `web/ui-form.js`, `web/ui-recurring.js`, `web/ui-feat-ai.js`, `web/transaction-import.js`, `web/ui-reports.js`, `web/ui-state.js`, `web/supabase-records.js`, `web/supabase-planning.js`, `web/ui-pro-palette.js`)**:
   - Memperbaiki `applyAutoCategoryRules()` (`escapeRegex()`, `matchesKeywordToken()`, `matchRulesPool()`, `matchDirectUserCategory()`) dengan pencocokan batas kata utuh serta prioritas: aturan kustom user -> kategori milik user -> aturan bawaan, plus penggabungan `computeAnnualRecap()` dan `compareTwoPeriods()` berbasis kunci normalisasi.
   - Memperbaiki `editTransaction()` via `selectCategorySafely()` agar kategori beda kapitalisasi tetap terpilih dan kategori non-daftar/terhapus dibuatkan `<option>` sementara; menambahkan `cleanName` + `syncFormCategorySelect()` pada `promptAddCategory()`.
   - Menyamakan kapitalisasi & fallback kategori di `openRecurringForm()`, `applyParsedReceiptToForm()`, `canonicalizeImportCategory()` (`transaction-import.js`), `renderReportCategories()`, `getFilteredReportTransactions()` (termasuk `defaultWalletId`), `mergeUpdatedTransactions()`, `api_addCategory()`, `api_copyBudget()`, dan `openAutoCatRulesModal()`.
3. **Telegram Bot & Migrasi SQL (`supabase/functions/telegram-bot/{core,ai,commands,planning,jobs}.ts`, `supabase/migrations/20261125000000_normalize_categories_and_search.sql`)**:
   - Menambahkan `normalizeCatKey()` dan `resolveUserCategory()` pada `core.ts`, lalu memakainya di `actualFor()`, `buildParsedTx()`, `handleInsight()`, `handleTambah()`, `handleBatch()` (termasuk fallback `wallet_id` dompet utama), `budgetDetail()`, `setBudget()`, `deleteBudget()`, `copyBudget()`, `checkBudgetAlert()`, `handleRecurring()`, dan `weeklyReport()`.
   - Menambahkan migrasi idempoten `20261125000000_normalize_categories_and_search.sql` untuk memperbarui `search_user_transactions()`, `rename_category_with_transactions()`, membersihkan spasi kategori, serta menyelaraskan data transaksi, jadwal rutin, dan budget lama dengan kapitalisasi tabel `categories`.
4. **Pengujian & Sinkronisasi Rilis (`tests/*.test.js`, `package.json`, `src/Index.html`, `src/updates.html`, `README.md`)**:
   - Menambahkan test regresi Wave v3.17 di `tests/finance-analysis.test.js`, `tests/finance-pro.test.js`, `tests/transaction-import.test.js`, dan `tests/pro-web-ui.test.js`, menaikkan versi ke `3.17.0` / `v3.17`, dan menyinkronkan catatan rilis di `src/updates.html` serta `README.md`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** across **66 files** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public client anon key) dan **2** info (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**232.034** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep`)**:
  - `src/`: **0** kelas ikon Phosphor tidak valid (`\bph-[a-z0-9-]+-(bold|fill|duotone|light|thin)\b`).
  - `web/`: **0** `console.log(`, **0** `alert(`, **0** `transition-all`, **0** interpolasi kelas Tailwind dinamis (`bg-${`, `text-${`, dll.), dan `.innerHTML` hanya pada baris pre-existing `web/ui-calendar.js:206`.

## Belum Diverifikasi (Dijalankan Lokal / Supabase)

- Eksekusi runtime `npm run check && npm run build:prod` (`node scripts/check-syntax.mjs && node --test` serta build `dist/`) tidak dijalankan dari agent karena shell environment workspace selalu mengarah ke direktori yang tidak ada; pengguna memverifikasi langsung secara lokal.
- Eksekusi SQL `supabase/migrations/20261125000000_normalize_categories_and_search.sql` pada Supabase SQL Editor serta deploy ulang Edge Function `telegram-bot` (`supabase functions deploy telegram-bot`) belum dijalankan pada instance live Supabase.
