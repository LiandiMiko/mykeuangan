# Audit 008: Implementasi Roadmap v2.1–v3.0 (AI Multimodal, Grafik Budgeting, Notifikasi, Offline Queue, Bank Import & Aset Multi-Instrumen) - 2026-11-18

Status: Complete

## Cakupan & Implementasi

### 1. AI Multimodal & Tanya Jawab Keuangan On-Demand
- Menambahkan helper `buildReceiptOcrPrompt()`, `parseReceiptOcrResponse()`, dan `buildAiFinancialChatPrompt()` di `web/finance-analysis.js`, beserta unit test di `tests/finance-analysis.test.js`.
- Menambahkan tombol **Scan Struk (AI)** (`#btnScanReceipt`, `triggerReceiptOcr()`, `handleReceiptOcrFile()`) di `src/form.html` & `src/features-v21.html` yang mengompresi foto di canvas dan mengirimkannya on-demand ke Gemini 2.5 Flash untuk mengisi form transaksi otomatis.
- Menambahkan kartu **Tanya & Simulasi Keuangan AI** (`#ai-chat-card`, `runAiFinancialChat()`) di `src/ai.html` & `src/features-v21.html`.
- Mengaktifkan **Tahap 3b-2 Bot Telegram** di `supabase/functions/telegram-bot/index.ts` (`handleMediaMessage()`, `parseMediaWithAI()`, `bytesToBase64()`): foto struk dan voice note diproses lewat Gemini 2.5 Flash dan langsung masuk alur konfirmasi transaksi.

### 2. Grafik Budgeting, Kalkulator Target & Utang Jatuh Tempo
- Menambahkan helper `calculateGoalMonthlySaving()` dan `monthlyCashflowSeries()` di `web/finance-analysis.js`.
- Menambahkan Donut Chart kategori (`#budgetCategoryChart`) & Bar Chart arus kas 6 bulan vs budget (`#budgetCashflowChart`) di `src/budgeting.html` (`renderBudgetCharts()` di `src/features-v21.html`).
- Memperkaya kartu **Target Keuangan** (`#financialGoals`) dengan saran setoran bulanan otomatis dan status tenggat (`on_track`, `urgent`, `overdue`, `completed`).
- Menambahkan fitur **Jatuh Tempo & Riwayat Cicilan** utang/piutang (`openDebtDetailModal()`, `api_saveDebtDueDates()`) yang tersimpan di `public.settings` (`debtDueDates`).

### 3. Pusat Notifikasi In-App & Antrean Transaksi Offline PWA
- Menambahkan helper `buildAppNotifications()` di `web/finance-analysis.js`.
- Menambahkan ikon lonceng **Pusat Notifikasi** (`#notifBellBtn`, `#notifBadge`, `openNotificationsModal()`) di header `src/Index.html` (menampilkan alert budget $\ge 80\%$, tagihan rutin H-3 dengan tombol *Catat Sekarang*, target mendesak/lewat tenggat, serta status antrean offline).
- Menambahkan **Offline Transaction Queue** berbasis IndexedDB + localStorage mirror di `src/features-v21.html` (`flushOfflineQueue()`) dengan sinkronisasi otomatis saat kembali online (`window.addEventListener('online', ...)`).

### 4. Investasi Emas/USD/Saham, Bank CSV Parser, Ekspor Excel & Header Mobile
- Memperbarui `web/transaction-import.js` + `tests/transaction-import.test.js` agar mendukung delimiter `;` / TSV, format tanggal `DD/MM/YYYY` / `DD-MM-YYYY`, serta e-statement mutasi bank (`DB/CR`, kolom `Debit`/`Kredit`, `Uraian`, `Mutasi`).
- Menambahkan dukungan aset `Emas` (gram, kurs spot PAXG/31.1034768), `USD` (kurs USDT/IDR), dan `Saham / Reksa Dana` pada `src/aset.html`, `src/script.html` (`renderAssets`), `src/features-v21.html` (`addManualAssetUI`), `web/supabase-api.js` (`api_addAssetV2`), serta `supabase/functions/telegram-bot/index.ts` (`refreshPrices`).
- Menambahkan tombol **Ekspor Excel (`.xls`)** (`exportExcel()`) di `src/laporan.html` & `src/features-v21.html`.
- Merapikan header mobile di `src/Index.html` agar tombol pilih bulan, payday, notifikasi, sembunyikan nominal, dan dark/light mode sejajar satu baris dengan logo `MyKeuGuech`.

## Verifikasi
- PASS (static inspection via `konoha`): seluruh `<?!= include(...) ?>` di `src/Index.html` (`styles`, `i18n`, `dashboard`, `aset`, `histori`, `utang`, `form`, `laporan`, `budgeting`, `ai`, `admin`, `scripts`, `features-v21`) terselesaikan tanpa ID DOM duplikat; seluruh fungsi baru di `web/finance-analysis.js` dan `web/transaction-import.js` telah diekspor dan ditambahkan unit test di `tests/`.
- BLOCKED (`node --test`, `node build.mjs`): tidak dapat dijalankan di runner shell sesi agent karena working directory sesi mengarah ke folder lama yang tidak ada; verifikasi runtime harus dijalankan langsung di terminal workspace `c:\Users\Acer\Documents\GitHub\mykeuangan`.

## Belum diverifikasi
- Eksekusi `node --test` dan `node build.mjs` pada terminal lokal di `c:\Users\Acer\Documents\GitHub\mykeuangan`.
- Deploy ulang Supabase Edge Function `telegram-bot` (`supabase functions deploy telegram-bot --no-verify-jwt`) untuk mengaktifkan handler foto/voice note & harga Emas/USD.
- Pengujian end-to-end di browser (Chrome DevTools mobile & desktop), termasuk tes offline mode dan pemanggilan live Gemini Vision/Chat.
