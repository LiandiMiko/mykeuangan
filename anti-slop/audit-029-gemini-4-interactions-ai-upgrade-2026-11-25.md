# Audit 029: Update v3.20.2 — Upgrade Gemini 4 Hydrogen, Interactions API & Enriched Financial AI (2026-11-25)

Status: Complete (Migrasi seluruh stack AI Web/Android dan Telegram Bot ke Gemini 4 Hydrogen melalui endpoint Interactions API selesai dan terverifikasi lewat `npm run check`, `node build.mjs`, `git diff --check`, serta pemindaian statis; pengujian panggilan live ke API Google Gemini memakai API Key aktif dan deploy ulang Edge Function `telegram-bot` dilakukan pada lingkungan pengguna)

## Akar Masalah

1. **Model Usang & Parameter Bermasalah (`web/ui-ai.js`, `web/ui-feat-ai.js`, `web/ui-pro-insights.js`, `supabase/functions/telegram-bot/core.ts`, `supabase/functions/telegram-bot/ai.ts`)**:
   - Aplikasi dan Bot Telegram masih memakai default `gemini-2.5-flash` (deprecated) dan fallback `gemini-2.0-flash` (shut down), sementara pengguna lama dapat memiliki nilai `gemini-2.5-flash` / `gemini-2.0-flash` tersimpan di `localStorage.mk_gemini_model`.
   - Pemanggilan masih menggunakan endpoint lama `:generateContent` dengan parameter yang tidak didukung / menurunkan kualitas Gemini 4 (`temperature`, `thinkingConfig: { thinkingBudget: 0 }`, serta `maxOutputTokens: 2048` di Telegram Bot `/insight`).
   - Dialog pengaturan API Key memakai input teks bebas tanpa pilihan preset model resmi maupun kedalaman berpikir (`thinking_level`).
2. **Bug Pemotongan Chat & Konteks Dangkal (`web/finance-analysis-ai.js`, `web/ui-pro-insights.js`, `src/ai.html`)**:
   - `runAiFinancialChat()` menggabungkan riwayat chat sebelumnya (`recentTurns`) dan pertanyaan baru menjadi satu string lalu dipotong `safeQuestion.slice(0, 500)` oleh `buildAiFinancialChatPrompt()`, sehingga pertanyaan baru user terpotong saat riwayat melebihi 500 karakter.
   - `buildAiCashflowPayload()` belum menyertakan rasio dana darurat (*emergency runway*), rasio utang terhadap aset, proyeksi *cashflow runway* / *safe daily budget*, anomali pengeluaran, alokasi portofolio, tren 3 siklus, target aktif, maupun daftar utang aktif.
   - Tampilan chat AI hanya mem-parsing `**bold**` dan `\n`, sehingga heading (`###`), daftar bullet (`-`), penomoran (`1.`), dan angka sorotan backtick tampak sebagai markdown mentah.

## Perubahan

1. **Enriched Financial Snapshot, Schema JSON & Stateless Multi-Turn (`web/finance-analysis-ai.js`)**:
   - Menambahkan `CASHFLOW_ANALYSIS_SCHEMA` dan `RECEIPT_OCR_SCHEMA` (snake_case JSON Schema), `buildEnrichedAiSnapshot()`, `buildGeminiSystemInstruction()` (`cashflow`, `chat`, `receipt`), serta `buildAiChatSteps()` (stateless `user_input` / `model_output` steps agar riwayat chat dan pertanyaan hingga 1000 karakter tidak terpotong).
   - Menajamkan prompt OCR struk IDR (memilih Grand Total / Total Bayar dan menginterpretasikan tanda titik sebagai pemisah ribuan) serta menjaga kompatibilitas fungsi lama (`buildGeminiCashflowPrompt`, `buildAiFinancialChatPrompt`).
2. **Client Gemini 4 Hydrogen, Auto-Migrasi, CORS & Markdown Aman (`web/ui-ai.js`, `web/supabase-auth.js`, `web/ui-feat-ai.js`, `web/ui-pro-insights.js`, `src/ai.html`, `src/i18n.html`)**:
   - Memigrasikan `web/ui-ai.js` ke `POST https://generativelanguage.googleapis.com/v1/interactions` dengan `store: false`, default `gemini-4-hydrogen`, fallback `['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-4-argon']`, `normalizeGeminiModel()`, timeout `AbortController` 35 detik, retry eksponensial `429`/`503`, `thinking_level` (`low`/`medium`/`high`), dan pemilih 5 model preset + kustom pada `configureGeminiApiKey()`.
   - Menjaga agar permintaan browser `fetch()` tidak mengirim header `Api-Revision` (empiris terverifikasi lewat preflight `OPTIONS` bahwa browser dengan header `api-revision` mengembalikan `403 Forbidden`, sedangkan tanpa `Api-Revision` mengembalikan `200 OK` dengan `Access-Control-Allow-Origin`).
   - Memperbarui `runReceiptOcrWithImage()` (`web/ui-feat-ai.js`) untuk input blok `{ type: 'image', data, mime_type }` dan `thinkingLevel: 'low'`, memperbarui `runAiFinancialChat()` & `renderAiChatThread()` (`web/ui-pro-insights.js`) menggunakan `formatAiMarkdownSafe()` + badge model + tombol **Salin** ringkasan, menambah chip cepat **Cek dana darurat & runway** + `maxlength="1000"` (`src/ai.html`), memperbarui teks `src/i18n.html` (paritas ID/EN 100%), dan membersihkan `mk_gemini_thinking` saat logout (`web/supabase-auth.js`).
3. **Telegram Bot Edge Function (`supabase/functions/telegram-bot/core.ts`, `supabase/functions/telegram-bot/ai.ts`, `supabase/README.md`)**:
   - Memperbarui default `GEMINI_MODEL` dan `GEMINI_INSIGHT_MODEL` ke `gemini-4-hydrogen` (`core.ts`) dan `normalizeBotGeminiModel()` + `GEMINI_FALLBACK_MODELS` (`ai.ts`) ke endpoint `/v1/interactions` (`Api-Revision: 2026-05-20`, `store: false`, `thinking_level`, tanpa `temperature` maupun `thinkingBudget: 0`), serta mendukung input gambar/audio Interactions dan `/insight` yang menyertakan savings rate + persentase pengeluaran terbesar.
4. **Versi `3.20.2`, Unit Test & Sinkronisasi Catatan (`package.json`, `src/Index.html`, `src/updates.html`, `README.md`, `tests/*.test.js`)**:
   - Menaikkan versi ke `3.20.2`, menambah kartu rilis `v3.20.2` di `src/updates.html` (`Menampilkan 23 rilis`) + changelog & tech stack `README.md`, dan menambah test suite `hotfix v3.20.2` di `tests/wave-v320-upgrades.test.js` serta menyelaraskan assertion versi di `tests/pro-web-ui.test.js` dan `tests/android-m3-ui.test.js`.

## Verifikasi

- **PASS (`npm run check`)**:
  - `node scripts/check-syntax.mjs`: `✅ Syntax verified across 60 JS/MJS files.`
  - `node --test`: **72** tes **PASS**, **0** gagal (mencakup test baru `hotfix v3.20.2` untuk migrasi model, request Interactions API bebas header CORS `Api-Revision` di browser, pemisahan multi-turn tanpa pemotongan 500 karakter, `buildEnrichedAiSnapshot`, `formatAiMarkdownSafe`, serta kontrak `telegram-bot`).
- **PASS (`node build.mjs`)**: Menghasilkan `dist/index.html` (`969 KB`), `dist/version.json` (`v3.20.2`, `min v3.19.1`), dan `dist/sw.js` (`cache: mykeuangan-c0b8687c2580`).
- **PASS (`git diff --check`)**: Exit code `0` tanpa konflik maupun trailing whitespace errors.
- **PASS (`konoha:website_ai_detector` pada `src/`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**270.036** bytes), **0** findings.
- **PASS (`konoha:file_info` & `konoha:token_efficient_grep`)**:
  - Ukuran seluruh modul JS/TS yang dimodifikasi `<= 429` baris (`web/ui-ai.js`: 429, `web/finance-analysis-ai.js`: 425, `web/ui-pro-insights.js`: 352, `supabase/functions/telegram-bot/ai.ts`: 286, `web/ui-feat-ai.js`: 171).
  - Nol kecocokan runtime pada pola terlarang AI lama (`gemini-2.0`/`gemini-2.5`, `thinkingBudget`, `temperature`) di `web/` dan `supabase/functions/telegram-bot/`.
- **Scoped `aislop:aislop_scan` pada `web/`**: Skor **94/100** (`fileCount: 72`), **0** confirmed defects dan **0** temuan pada seluruh file AI yang dimodifikasi (hanya 1 error pre-existing Supabase public anon key di `web/config.js:6` dan 2 warning URL pre-existing di `web/supabase-portfolio.js:48` serta `supabase/functions/telegram-bot/jobs.ts:71`).

## Belum Diverifikasi (Dijalankan Pengguna)

- Pengujian end-to-end dengan Google Gemini API Key pengguna langsung di menu **Analisis AI**, **Scan Struk (AI)**, dan **Tanya Gemini**.
- Deploy ulang Edge Function Telegram Bot (`npx supabase functions deploy telegram-bot --no-verify-jwt`) jika memakai Supabase Telegram Bot serta memperbarui secret opsional `GEMINI_MODEL_PARSER` / `GEMINI_MODEL_INSIGHT` (jika sebelumnya di-set ke model lama).
