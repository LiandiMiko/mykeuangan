# Audit 025 Follow-Up: Popup Update Otomatis In-App (`version.json`) & GitHub Releases APK — 2026-11-25

Status: Complete (Pembuatan manifes `dist/version.json` otomatis saat build, pembanding versi semver + Bottom Sheet popup mode opsional & wajib update, tombol manual Cek Pembaruan dwibahasa ID/EN, izin CSP + pengecualian Service Worker `/version.json`, guard hardware Back saat force-update, auto-publish APK ke GitHub Releases di `.github/workflows/android-build.yml`, unit test di `tests/android-m3-ui.test.js`, serta pemindaian statis MCP selesai; verifikasi runtime `npm run check` / CI / instalasi APK di perangkat dijalankan pada perangkat & repo pengguna)

## Perubahan

1. **Konfigurasi & Penerbitan Manifes `dist/version.json` (`package.json`, `build.mjs`, `src/Index.html`, `web/sw.js`)**:
   - Menambahkan objek `appUpdate` di `package.json` (`minSupportedVersion`, `androidUrl`, `webUrl`) sambil menjaga versi rilis `3.19.0`.
   - Menambahkan helper `parseVersionCode()`, `extractLatestReleaseMeta()`, dan `buildVersionManifest()` di `build.mjs` untuk menulis `dist/version.json` secara otomatis dan menyinkronkan `<meta name="app-version" content="3.19.0">` ke `dist/index.html`.
   - Menambahkan `https://liandimiko.github.io` pada CSP `connect-src` di `src/Index.html` agar APK Capacitor (`https://localhost`) dapat membaca `version.json`, serta mengecualikan `/version.json` dari cache Service Worker di `web/sw.js`.
2. **Pengecek Versi Jarak Jauh & Material 3 Update Popup (`web/ui-feat-updates.js`, `web/ui-feat-hooks.js`, `web/native-bridge.js`)**:
   - Mengimplementasikan `compareSemver()`, `getInstalledAppVersion()`, `evaluateRemoteVersion()`, `showAppUpdatePopup()`, dan `checkRemoteAppUpdate()` (non-blokir saat online setelah data siap, timeout `AbortController` 5 detik, penyimpanan dismiss per versi `mk_dismissed_update_version`, serta sanitasi tautan HTTPS `safeHttpsUrl()`).
   - Mendukung **Soft Update** (*Update Sekarang* + *Nanti Saja*) dan **Force Update** (`minSupportedVersion` lebih tinggi dari versi terpasang, mengunci dismiss serta tombol *Back* Android melalui `__mkForceUpdateActive`).
3. **Antarmuka Manual "Cek Pembaruan" & Dwibahasa (`src/updates.html`, `src/i18n.html`)**:
   - Menambahkan tombol `#btnCheckAppUpdate`, banner `#remoteUpdateBanner`, serta 13 kunci terjemahan `updates.*` berpasangan persis pada `I18N.id` dan `I18N.en`.
4. **Auto-Publish `.apk` ke GitHub Releases (`.github/workflows/android-build.yml`)**:
   - Mengaktifkan `permissions.contents: write`, input workflow `publish_release`, dan langkah `Publish APK to GitHub Releases` (`gh release create/upload`) otomatis saat push tag `v*` atau saat opsi `publish_release` dicentang, melampirkan berkas `.apk` dan ringkasan rilis dari `dist/version.json`.
5. **Pengujian & Dokumentasi (`tests/android-m3-ui.test.js`, `README.md`)**:
   - Menambahkan test sandbox `node:vm` untuk `compareSemver`, `evaluateRemoteVersion`, dan sanitasi URL `javascript:` plus assertion statis kelengkapan CI/CSP/SW/hooks.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** pada **68 file** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public client anon key) dan **2** info (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**255.571** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep` & `file_info`)**:
  - `src/` (`class="[^"]*\btransition-all\b` & `\bph-[a-z0-9-]+-(bold|fill|duotone|light|thin)\b`): **0** kecocokan.
  - `web/` (`console\.log\(`, `\balert\(`, `\b(?:bg|text|border|ring|from|to)-\$\{`): **0** kecocokan.
  - `web/ui-feat-updates.js`: **421** baris (`0` penggunaan `.innerHTML`); `tests/android-m3-ui.test.js`: **118** baris.

## Belum Diverifikasi (Dijalankan Pengguna)

- Eksekusi `npm run check`, `npm run build:prod` (inspeksi `dist/version.json`), push ke GitHub untuk deploy GitHub Pages, serta uji workflow Android (`publish_release: true` atau tag `v3.19.0`) + uji popup update dengan simulasi `version.json` lebih tinggi di APK.
