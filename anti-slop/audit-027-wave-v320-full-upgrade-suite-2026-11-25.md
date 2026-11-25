# Audit 027: Wave v3.20 Full Upgrade Suite (Prioritas 1–4) — 2026-11-25

Status: Complete (Seluruh peningkatan Prioritas 1–4 telah diterapkan: fix `setTheme()` + notifikasi native Android, helper keystore `cap:keystore`, Camera/Haptics/LocalNotifications/Pull-to-Refresh/Biometrik, Onboarding 3-langkah, Kalkulator Nominal aman, Offline Queue untuk edit/hapus/transfer, Cashflow Runway + Auto-Catat rutin, Admin Panel v2 + migrasi SQL + Edge Function `admin-user-ops`, Backup AES-GCM 256-bit, unit test `tests/wave-v320-upgrades.test.js`, serta pemindaian statis MCP; `npm install` lockfile, `npm run check`, `npm run build:prod`, deploy Supabase SQL/Edge Function, dan uji APK di perangkat fisik dijalankan pada perangkat pengguna)

## Perubahan

1. **Prioritas 1 — Bug Tema, Notifikasi Android & Yayasan Release Keystore**:
   - Memperbaiki `setTheme()` di `web/ui-shell.js` agar tidak mereset `document.documentElement.className` dan menghapus `mk-native-app`/`mk-platform-android`.
   - Menambahkan `@capacitor/camera`, `@capacitor/haptics`, `@capacitor/local-notifications`, dan skrip `cap:keystore` (`scripts/setup-android-keystore.mjs`) ke `package.json` serta izin `POST_NOTIFICATIONS` di `scripts/patch-android-project.mjs`.
2. **Prioritas 2 — Rasa Native Android (`web/native-bridge.js`, `web/ui-feat-native-ux.js`, `web/ui-pro-hooks.js`, `web/ui-feat-ai.js`, `web/ui-feat-account.js`)**:
   - Menambahkan `triggerHaptic()`, `captureReceiptNative()`, `scheduleNativeDailyReminder()` (pengingat harian 20:00), dan `syncNativeBillReminders()`.
   - Mengganti toggle Notifikasi Browser menjadi **Pengingat Android (20:00)** di modal Pusat Notifikasi saat dijalankan pada mode native.
   - Menghubungkan Scan Struk AI ke kamera native, Pull-to-Refresh lintas 5 view utama + umpan balik haptic, serta opsi buka kunci biometrik sidik jari/WebAuthn di Pengaturan Akun.
3. **Prioritas 3 — Upgrade Finansial & UX Harian (`web/ui-state.js`, `src/form.html`, `web/ui-feat-offline.js`, `web/finance-analysis-portfolio.js`, `web/ui-feat-recurring.js`, `src/dashboard.html`, `web/ui-feat-onboarding.js`)**:
   - Menambahkan parser aritmatika aman `evaluateNominalExpression()` + pratinjau hasil `= Rp ...` dan baris tombol `+ − × ÷ =` di Form Transaksi.
   - Memperluas antrean offline (`queueOfflineMutation()`) agar `api_updateTransaction`, `api_deleteTransaction`, dan `api_addTransfer` aman dicatat offline dan tersinkronkan berurutan saat online.
   - Menambahkan `computeCashflowRunway()`, strip proyeksi **Cashflow Runway** + batas aman harian di Dashboard, opsi **Auto-Catat Tagihan Rutin**, dan Onboarding Wizard 3 langkah bagi akun baru.
4. **Prioritas 4 — Admin Panel v2, Backup AES-GCM & Dokumentasi**:
   - Menambahkan migrasi idempoten `supabase/migrations/20261125120000_admin_audit_and_telegram_unlink.sql`, Edge Function `supabase/functions/admin-user-ops/index.ts`, handler `web/supabase-admin.js`, aksi **Putus Telegram** / **Hapus Akun** & **Log Aktivitas Admin** di `web/ui-admin.js` + `src/admin.html`.
   - Menambahkan enkripsi/dekripsi opsional **PBKDF2-SHA256 + AES-GCM 256-bit** (`encryptBackupPayload()` / `decryptBackupPayload()`) pada ekspor & restore JSON di `web/ui-feat-backup.js`.
   - Memperbarui registrasi modul `build.mjs`, pembersihan `localStorage` saat logout (`web/supabase-auth.js`), `src/Index.html`, `src/updates.html`, `README.md`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, serta `tests/wave-v320-upgrades.test.js`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** pada **72 file** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public client anon key) dan **2** info (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**263.007** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep` & `file_info`)**:
  - `src/` (`class="[^"]*\btransition-all\b` & `\bph-[a-z0-9-]+-(bold|fill|duotone|light|thin)\b`): **0** kecocokan.
  - `web/` (`console\.log\(`, `\balert\(`, `\beval\(`, `\bnew Function\(`, `\b(?:bg|text|border|ring|from|to)-\$\{`): **0** kecocokan.
  - Seluruh modul baru/terubah memenuhi batas `<= 435` baris (`ui-feat-account.js`: 435, `ui-feat-backup.js`: 428, `ui-feat-offline.js`: 421, `ui-state.js`: 419, `native-bridge.js`: 404, `ui-admin.js`: 395, `ui-feat-native-ux.js`: 265, `ui-feat-recurring.js`: 198, `ui-feat-onboarding.js`: 131, `admin-user-ops/index.ts`: 111).

## Belum Diverifikasi (Dijalankan Pengguna)

- Menjalankan `npm install` (untuk memperbarui `node_modules` & menghasilkan `package-lock.json` dengan 3 plugin Capacitor baru), `npm run check`, `npm run build:prod`.
- Menjalankan migrasi SQL `supabase/migrations/20261125120000_admin_audit_and_telegram_unlink.sql` & `supabase functions deploy admin-user-ops`.
- Menjalankan `npm run cap:keystore` (jika belum punya keystore produksi) + uji APK `v3.20.0` di perangkat Android.
