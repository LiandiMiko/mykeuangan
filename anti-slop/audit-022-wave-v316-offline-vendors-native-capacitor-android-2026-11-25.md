# Audit 022: Wave v3.16 Bundel Vendor Offline, Bridge Native Android & Setup Capacitor 8 (API 36) - 2026-11-25

Status: Partial (Seluruh implementasi Fase 2 & Fase 3 selesai dan diperiksa lewat scanner statis MCP `aislop_scan`, `website_ai_detector`, dan `token_efficient_grep`; verifikasi runtime lokal `npm run check`, `npm install`, `npm run build:prod`, inisialisasi `android/`, serta uji perangkat Android fisik dan build `.aab` dijalankan pengguna secara lokal karena keterbatasan shell environment)

## Perubahan yang Diterapkan

1. **Perbaikan Config & Pipeline CI (`web/delete-account.html`, `.github/workflows/deploy.yml`)**:
   - Memperbaiki pembacaan konfigurasi Supabase pada `web/delete-account.html` agar mendukung `window.APP_CONFIG` (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) sekaligus tetap kompatibel dengan `window.__MYKEU_CONFIG__`.
   - Memperbaiki writer fallback `web/config.js` di `.github/workflows/deploy.yml` agar menghasilkan `window.APP_CONFIG` yang sesuai `web/supabase-core.js`, serta menambahkan step `node scripts/fetch-vendors.mjs` sebelum `Build dist (Deploy)`.

2. **Bundel Vendor Lokal 100% Offline (`scripts/fetch-vendors.mjs`, `build.mjs`, `web/sw.js`, `.gitignore`)**:
   - Membuat `scripts/fetch-vendors.mjs` (`VENDOR_MANIFEST`) untuk mengunduh versi ter-pin Supabase JS, SweetAlert2, Flatpickr (+ plugin `monthSelect` & lokalisasi `id`), jsPDF + AutoTable, Chart.js, font variable Inter `.woff2` + `inter/inter.css`, serta Phosphor Icons v2.1.1 (`regular`, `bold`, `fill` dengan rewrite `src:` menjadi `.woff2` tunggal agar bebas 404).
   - Memperbarui `build.mjs` untuk menyertakan `web/native-bridge.js` di `WEB_MODULES`, menyalin `web/vendor/` (kecuali `tailwind.min.css`) ke `dist/vendor/`, menulis ulang tag CDN pada `dist/index.html` ke `./vendor/...` saat tersedia, dan menyuntikkan daftar aset vendor ke `ASSETS_TO_CACHE` di `dist/sw.js`.
   - Memperluas `.gitignore` untuk mengecualikan `web/vendor/`, `assets/`, `android/keystore.properties`, `*.jks`, `*.keystore`, dan direktori build Gradle.

3. **Bridge Native Android & Integrasi Aplikasi (`web/native-bridge.js`, `src/Index.html`, `src/styles.html`, `web/ui-shell.js`, `web/supabase-auth.js`, `web/ui-export.js`, `web/ui-feat-backup.js`, `web/ui-reports.js`, `web/ui-feat-hooks.js`, `web/ui-feat-account.js`)**:
   - Menambahkan `web/native-bridge.js` dengan deteksi platform `isNativeApp()`, navigasi tombol *Back* Android bertahap (tutup overlay/Search/Swal → tutup drawer → kembali ke Dashboard → keluar 2× dengan toast, sekaligus aman terhadap PIN lock), ekspor native Share Sheet `saveOrShareFile()` (tulis ke `Directory.CACHE` tanpa encoding agar biner PDF & teks UTF-8 aman), Google OAuth deep link `com.mykeuguech.app://auth-callback` (`startNativeOAuth`, `parseOAuthCallbackParams`, `handleNativeAppUrlOpen`), interceptor tautan eksternal/legal ke `Browser.open()`, kontrol `SystemBars` dan `SplashScreen`.
   - Melewatkan registrasi Service Worker & menyembunyikan prompt install PWA ketika berjalan di shell Capacitor (`src/Index.html`, `src/styles.html`, `web/ui-feat-hooks.js`), memperbarui `var(--safe-area-inset-top/bottom, env(...))` pada `src/styles.html` untuk mode `SystemBars` CSS, menghubungkan ekspor CSV/Excel/PDF/JSON/template ke `saveOrShareFile()`, serta melengkapi terjemahan EN pada modal akun, PIN lock, Catat Cepat, dan ekspor (`web/ui-feat-account.js`, `web/ui-export.js`).

4. **Setup Capacitor 8 Android Target API 36 & Panduan Play Store (`capacitor.config.json`, `package.json`, `scripts/prepare-native-assets.mjs`, `scripts/patch-android-project.mjs`, `docs/ANDROID_PLAYSTORE_GUIDE.md`)**:
   - Menambahkan `capacitor.config.json` (`com.mykeuguech.app`, `webDir: "dist"`, `androidScheme: "https"`, `SplashScreen`, `SystemBars` edge-to-edge CSS).
   - Menambahkan `scripts/prepare-native-assets.mjs` (generator PNG 1024px & 2732px tanpa dependensi eksternal) dan `scripts/patch-android-project.mjs` (mengunci `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36`, `android:allowBackup="false"`, intent-filter OAuth callback, sinkronisasi `versionCode`/`versionName`, serta konfigurasi `signingConfigs.release` via `android/keystore.properties`).
   - Memperbarui `package.json` ke `3.16.0` dengan dependensi `@capacitor/*@^8.0.0` dan skrip `vendors:fetch`, `assets:native`, `cap:init:android`, `cap:assets`, `cap:sync`, `cap:open`, serta menyusun panduan lengkap `docs/ANDROID_PLAYSTORE_GUIDE.md`.

5. **Test Regresi & Dokumentasi (`tests/pro-web-ui.test.js`, `src/updates.html`, `README.md`)**:
   - Menambahkan pengujian VM `web/native-bridge.js` & pemeriksaan file/konfigurasi Wave v3.16 di `tests/pro-web-ui.test.js`, serta menyinkronkan rilis `2026-11-25-v3.16` pada `src/updates.html` dan `README.md`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** across **66 files** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public Supabase client anon key) serta 2 `info` (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector`)**:
  - `src/` (16 file, 228.164 bytes): Score **0** (`Human-Built`, **PASS**).
  - `web/delete-account.html` (7.472 bytes): Score **0** (`Human-Built`, **PASS**).
- **PASS (`konoha:token_efficient_grep`)**:
  - `web/`: **0** `transition-all`, **0** `console.log(`, **0** `bg-${` / `text-${`, **0** `alert(`, dan `.innerHTML` hanya pada `web/ui-calendar.js:206`.
  - `src/`: **0** class aktif `transition-all` / `.innerHTML` / `alert(` / `console.log(`.

## Belum Diverifikasi (Dijalankan Lokal)

- `npm run check` (`node scripts/check-syntax.mjs && node --test`) dan `npm run build:prod` (`npm run vendors:fetch` mengunduh aset CDN + verifikasi offline bundle di browser).
- `npm install`, `npm run cap:init:android`, `npm run cap:assets`, `npm run cap:sync`, uji perangkat Android fisik (`com.mykeuguech.app://auth-callback`, Back button, Share Sheet, edge-to-edge `SystemBars`), serta build `.aab` via `./gradlew bundleRelease`.
