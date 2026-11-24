# Follow-up Audit 024: Perbaikan Error CI `cache: npm` & Pipeline Lengkap Build `.apk` Android — 2026-11-25

Status: Complete (Perbaikan workflow GitHub Actions `android-build.yml`, skrip lokal 1-perintah `scripts/build-android.mjs`, pemulihan cold-start OAuth di `web/native-bridge.js`, unit guard di `tests/pro-web-ui.test.js`, sinkronisasi panduan & riwayat rilis, serta pemeriksaan statis MCP selesai; kompilasi `.apk` dijalankan lewat GitHub Actions Cloud Build atau lokal Windows pengguna)

## Cakupan

Menindaklanjuti kegagalan job GitHub Actions (`Dependencies lock file is not found` karena ketidakhadiran `package-lock.json`) sekaligus menuntaskan jalur build hingga file `.apk` siap pasang untuk HP Android.

## Akar Masalah & Perubahan

1. **Fix Error Setup Node di GitHub Actions (`.github/workflows/android-build.yml`)**:
   - Menghapus `cache: npm` pada `actions/setup-node@v4` karena repository ini tidak menyimpan `package-lock.json`, `npm-shrinkwrap.json`, atau `yarn.lock` (selaras dengan `.github/workflows/deploy.yml`), lalu menambahkan `gradle/actions/setup-gradle@v4` untuk cache dependensi Gradle.
   - Menambahkan langkah `Resolve build config` (`id: cfg`) dan memperluas pilihan `workflow_dispatch.inputs.build_type` menjadi `debug-apk`, `release-apk`, `release-aab`, dan `all`.
   - Menambahkan pengecekan eksplisit keberadaan `web/config.js` setelah fallback `vars.SUPABASE_URL` / `vars.SUPABASE_ANON_KEY`, nama file artefak berversi (`release/MyKeuGuech-v3.18.0-debug.apk`, `-release.apk`, `-release.aab`), dukungan signed `assembleRelease`, serta ringkasan unduh di `$GITHUB_STEP_SUMMARY`.
2. **Skrip Lokal 1-Perintah `.apk` / `.aab` (`scripts/build-android.mjs`, `package.json`, `.gitignore`)**:
   - Membuat `scripts/build-android.mjs` (`resolveAndroidTarget`, `ensureLocalPrereqs`, `runTool`) untuk mengecek `node_modules` & JDK 21, menjalankan `npm run build:prod`, menginisialisasi `android/` bila belum ada, menerapkan `patch-android-project.mjs`, menghasilkan aset Capacitor, menjalankan `cap sync android`, memanggil `gradlew.bat` / `./gradlew`, lalu menyalin hasil ke `release/MyKeuGuech-v3.18.0-*`.
   - Menambahkan skrip `cap:apk`, `cap:apk:release`, dan `cap:aab` di `package.json`, mengganti `cap:assets` agar memakai `npx capacitor-assets generate --android`, dan menambahkan `release/` ke `.gitignore`.
3. **Ketahanan Cold-Start Google OAuth di Android (`web/native-bridge.js`)**:
   - Menambahkan `checkNativeLaunchUrl()` (memanggil `App.getLaunchUrl()` saat `DOMContentLoaded`) dan deduplikasi `lastHandledOAuthUrl` pada `handleNativeAppUrlOpen()` agar callback `com.mykeuguech.app://auth-callback` tetap terproses meski aktivitas aplikasi sempat dimatikan OS saat login Google berlangsung.
4. **Pengujian & Sinkronisasi Dokumentasi (`tests/pro-web-ui.test.js`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, `README.md`, `src/updates.html`)**:
   - Menambahkan guard di `tests/pro-web-ui.test.js` agar `.github/workflows/android-build.yml` bebas `cache: npm` serta memverifikasi `scripts/build-android.mjs`, `cap:apk*`, `.gitignore`, dan `getLaunchUrl`.
   - Memperbarui panduan build Cloud/Lokal di `docs/ANDROID_PLAYSTORE_GUIDE.md`, struktur & changelog di `README.md`, serta butir Wave v3.18 di `src/updates.html`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** across **68 files** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public client anon key) dan **2** info (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**235.836** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep`)**:
  - `.github/workflows/` (`cache:`): **0** kecocokan (`cache: npm` sudah bersih dari seluruh workflow).
  - `scripts/build-android.mjs` & `web/native-bridge.js` (`console\.log\(`): **0** kecocokan.

## Belum Diverifikasi (Dijalankan Pengguna / Cloud CI / Supabase)

- Eksekusi lokal `npm run check` (pengguna di terminal root repo) serta build runtime `.apk` melalui GitHub Actions (`Build Android APK & AAB (Capacitor 8)` → `Run workflow` → `debug-apk`) atau lokal (`npm install && npm run cap:apk`).
- Konfigurasi Redirect URL `com.mykeuguech.app://auth-callback` dan `ALLOWED_ORIGIN` (`https://liandimiko.github.io,https://localhost`) di dashboard Supabase sebelum pengujian login Google & Hapus Akun di HP Android.
