# Audit 026: Hotfix v3.19.1 Freeze Penutupan Bottom Sheet Dialog (Pusat Notifikasi & Semua Modal Mobile) — 2026-11-25

Status: Complete (Perbaikan animasi `.swal2-show`/`.swal2-hide` pada Bottom Sheet SweetAlert2 di `src/styles.html`, fallback pembersihan dialog `.swal2-hide` macet pada hardware Back di `web/native-bridge.js`, bump hotfix `3.19.1` & `minSupportedVersion: "3.19.1"`, penambahan unit test regresi di `tests/android-m3-ui.test.js`, sinkronisasi `updates.html` & `README.md`, serta pemindaian statis MCP selesai; uji interaksi langsung pada APK `v3.19.1` di perangkat Android dijalankan oleh pengguna)

## Akar Masalah

1. Di `src/styles.html` (aturan `@media (max-width: 639px)`), properti `animation: mkSheetUp 220ms var(--ease-drawer) forwards;` dipasang langsung pada selektor dasar `.swal2-container.swal2-center > .swal2-popup:not(.swal2-toast)` (spesifisitas `0,4,0`), dan hal serupa di `@media (prefers-reduced-motion: reduce)` (`mkFadeOnly !important`).
2. Saat SweetAlert2 v11 menutup modal (menekan **Tutup**, mengetuk area luar dialog, atau memanggil `Swal.close()` lewat tombol *Back* Android), library menghapus kelas `.swal2-show` dan memasang `.swal2-hide` lalu menunggu event `animationend` pada `.swal2-popup` selama `getComputedStyle(popup).animationName !== 'none'`.
3. Karena selektor dasar tetap mengunci `animation-name: mkSheetUp` / `mkFadeOnly` ketika `.swal2-hide` aktif, browser tidak pernah memulai animasi tutup baru sehingga `animationend` tidak pernah terpanggil — menyebabkan `.swal2-container` dan `body.swal2-shown` membekukan layar Pusat Notifikasi maupun modal Bottom Sheet lainnya di HP Android.

## Perubahan

1. **Scope Animasi Buka/Tutup Bottom Sheet (`src/styles.html`)**:
   - Menghapus `animation: mkSheetUp ...` dari selektor dasar `.swal2-container.swal2-center > .swal2-popup:not(.swal2-toast)` sehingga hanya mengatur dimensi/posisi sheet.
   - Menambahkan aturan khusus `.swal2-container.swal2-center > .swal2-popup.swal2-show:not(.swal2-toast)` (`mkSheetUp`) dan `.swal2-container.swal2-center > .swal2-popup.swal2-hide:not(.swal2-toast)` (`mkSheetDown` + `@keyframes mkSheetDown`).
   - Memperbarui `@media (prefers-reduced-motion: reduce)` agar `.swal2-show` memakai `mkFadeOnly` dan `.swal2-hide` memakai `animation: none !important;` sehingga SweetAlert2 langsung menghapus container secara sinkron saat *reduced motion* aktif.
2. **Pemulihan Defensif Hardware Back (`web/native-bridge.js`)**:
   - Menambahkan pengecekan `popup.classList.contains('swal2-hide')` di `handleAndroidBackButton()` agar jika WebView perangkat gagal memancarkan `animationend`, tombol *Back* Android membersihkan container modal macet beserta kelas `swal2-shown` / `swal2-height-auto` secara paksa.
3. **Hotfix Versi `3.19.1` & Test Regresi (`package.json`, `src/Index.html`, `tests/pro-web-ui.test.js`, `tests/android-m3-ui.test.js`, `src/updates.html`, `README.md`)**:
   - Menaikkan `version` dan `appUpdate.minSupportedVersion` di `package.json` serta `<meta name="app-version">` ke `3.19.1` sehingga APK `v3.19.0` sebelumnya otomatis menerima prompt pembaruan wajib menuju rilis `v3.19.1`.
   - Menambahkan blok test regresi di `tests/android-m3-ui.test.js` dan menyinkronkan catatan perubahan pada `src/updates.html` dan `README.md`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** pada **68 file** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public client anon key) dan **2** info (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**256.306** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep` & `file_info`)**:
  - `src/` (`class="[^"]*\btransition-all\b` & `\bph-[a-z0-9-]+-(bold|fill|duotone|light|thin)\b`): **0** kecocokan.
  - `web/` (`console\.log\(`, `\balert\(`, `\b(?:bg|text|border|ring|from|to)-\$\{`): **0** kecocokan.
  - `web/native-bridge.js`: **311** baris.

## Belum Diverifikasi (Dijalankan Pengguna)

- Eksekusi `npm run check`, `npm run build:prod`, deploy GitHub Pages (`v3.19.1`), serta uji langsung buka/tutup **Pusat Notifikasi** lewat tombol **Tutup** dan tombol *Back* fisik Android pada build `MyKeuGuech-v3.19.1-debug.apk`.
