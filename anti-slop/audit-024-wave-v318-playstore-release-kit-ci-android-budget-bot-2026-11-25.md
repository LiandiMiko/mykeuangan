# Audit 024: Wave v3.18 Cloud Build Android (.apk/.aab), Kit Rilis Play Store, + Buat Budget & Bot /cari - 2026-11-25

Status: Complete (Seluruh kode CI Android, perbaikan patch Gradle, generator aset Play Store, kit metadata & kepatuhan Play Console, tombol cepat `+ Budget <Kategori>`, upgrade bot `/budget` & `/cari`, test regresi, dan pemeriksaan statis MCP selesai; build runtime GitHub Actions / lokal, eksekusi SQL Supabase, dan deploy Edge Function dijalankan pada environment pengguna)

## Cakupan

Menuntaskan Fase 4 (rilis Play Store & cloud build APK/AAB Android), memperbaiki bug skrip patch Gradle sebelum build Android dijalankan, serta melengkapi UX **Budgeting** dan **Telegram Bot**.

## Temuan & Perbaikan

1. **Bug pada Patch Gradle Keystore (`scripts/patch-android-project.mjs`)**:
   - `new FileInputStream(keystorePropsFile)` pada `patchAppBuildGradle()` akan gagal dikompilasi Groovy tanpa `import java.io.FileInputStream`, dan `file(keystoreProps.getProperty("storeFile"))` mencari path relatif di `android/app/` bukan di `android/`. Diperbaiki ke `keystorePropsFile.withInputStream { keystoreProps.load(it) }` serta `rootProject.file(keystoreProps.getProperty("storeFile"))`.
   - Mengganti kecocokan literal `        </activity>` di `patchAndroidManifest()` menjadi regex `/([ \t]*)<\/activity>/` agar indentasi tetap konsisten.
2. **Cloud Build Android APK & Signed AAB (`.github/workflows/android-build.yml`, `.gitignore`)**:
   - Menambahkan workflow `Build Android APK & AAB (Capacitor 8)` yang menginstall JDK 21 Temurin + Android SDK 36 + Build-Tools 36.0.0, menjalankan `npm run build:prod` & `npm run playstore:assets`, menginisialisasi proyek Capacitor (`npx cap add android`, `patch-android-project.mjs`, `cap:assets`, `cap sync android`), lalu membangun **`app-debug.apk`** dan opsional signed **`app-release.aab`** memakai secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, dan `ANDROID_KEY_PASSWORD` (dengan pembersihan file keystore sementara `if: always()`).
   - Mengecualikan folder keluaran `playstore-assets/` di `.gitignore`.
3. **Generator Aset Grafis & Kit Play Store (`scripts/generate-playstore-assets.mjs`, `docs/PLAYSTORE_LISTING_KIT.md`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, `package.json`)**:
   - Membuat skrip murni Node.js (`npm run playstore:assets`) untuk menghasilkan `playstore-assets/icon-512.png` (`512x512`) dan `playstore-assets/feature-graphic-1024x500.png` (`1024x500`) tanpa dependensi eksternal.
   - Menyusun kit deskripsi toko ID/EN (`MyKeuGuech: Keuangan & Budget`), tautan hukum/hapus akun, jawaban *App Access*, *Financial Features Declaration*, *Data Safety*, dan pelacakan *Closed Testing* 12 tester × 14 hari di `docs/PLAYSTORE_LISTING_KIT.md`, sekaligus menyatukan panduan pre-flight SQL/Edge Function & Cloud CI di `docs/ANDROID_PLAYSTORE_GUIDE.md`.
4. **Budgeting 1-Klik `+ Buat Budget` & Upgrade Telegram Bot (`web/ui-budget.js`, `supabase/functions/telegram-bot/{planning,commands,index}.ts`)**:
   - Menambahkan `buildUnbudgetedCategoryChips()` dan binding `[data-unbudgeted-create-cat]` di `web/ui-budget.js` untuk memunculkan chip **`+ Budget <Kategori>`** dengan saran nominal pembulatan ke atas per Rp 10.000 langsung dari panel *Pengeluaran di Luar Budget*.
   - Menambahkan `budgetBar()` dan ringkasan transaksi **`Di luar budget`** pada `showBudgets()` di `planning.ts`, serta perintah **`/cari`** (`handleCari()` di `commands.ts` & routing `cari|search` di `index.ts`) untuk pencarian riwayat transaksi cepat lewat Telegram.
5. **Pengujian & Dokumentasi (`tests/pro-web-ui.test.js`, `package.json`, `src/Index.html`, `src/updates.html`, `README.md`)**:
   - Memperbarui versi ke `3.18.0` / `v3.18`, menyinkronkan rilis ke-19 di `src/updates.html` & `README.md`, dan menambah uji regresi Wave v3.18 di `tests/pro-web-ui.test.js`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** across **67 files** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public client anon key) dan **2** info (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**235.584** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep`)**:
  - `src/`: **0** kelas ikon Phosphor tidak valid.
  - `web/`: **0** `console.log(`, **0** `alert(`, **0** `transition-all`, **0** interpolasi kelas Tailwind dinamis (`bg-${`, `text-${`, dll.), dan `.innerHTML` hanya pada baris pre-existing `web/ui-calendar.js:206`.

## Belum Diverifikasi (Dijalankan Lokal / GitHub Actions / Supabase)

- Eksekusi lokal `npm run check && npm run build:prod && npm run playstore:assets` dan eksekusi runtime workflow GitHub Actions `.github/workflows/android-build.yml` (`assembleDebug` & `bundleRelease`).
- Eksekusi migrasi SQL `20261125000000_normalize_categories_and_search.sql`, penambahan URL redirect `com.mykeuguech.app://auth-callback`, secret `ALLOWED_ORIGIN`, dan deploy `telegram-bot` pada project live Supabase.
- Pendaftaran & pengajuan aplikasi `.aab` ke Google Play Console serta uji coba HP Android fisik.
