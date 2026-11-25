# Audit 031: Perbaikan Update Timpa (In-Place) APK Android (`signingConfigs.debug` + `apksigner` Gate) — 2026-11-26

Status: Complete (`scripts/patch-android-project.mjs`, `.gitignore`, `.github/workflows/android-build.yml`, pembaruan versi `3.20.4` / `versionCode 32004`, unit test di `tests/wave-v320-upgrades.test.js`, serta sinkronisasi dokumentasi selesai; kompilasi APK & pengujian instalasi timpa antarrilis berjalan di runner GitHub Actions & perangkat Android pengguna)

## Cakupan

Menyelidiki dan memperbaiki kegagalan instalasi pembaruan APK Android di mana versi terbaru selalu mewajibkan uninstall aplikasi versi sebelumnya terlebih dahulu alih-alih langsung menimpa (*in-place update*).

## Temuan Forensik (Live GitHub Releases APK Signature v2)

Pemeriksaan sertifikat penandatanganan *APK Signature Scheme v2* pada artefak rilis GitHub memperlihatkan bahwa setiap build sebelumnya menghasilkan sidik jari SHA-256 berbeda meskipun `actions/cache` di `.github/workflows/android-build.yml` sudah menyimpan `~/.android/debug.keystore`:
- `v3.19.1` (`versionCode=31901`): `SHA-256 = D2:FE:25:9D:3E:C2:B5:F5:...`
- `v3.20.0` (`versionCode=32000`): `SHA-256 = F1:31:02:A4:D1:FE:DF:9B:...`
- `v3.20.1` (`versionCode=32001`): `SHA-256 = F7:2B:0F:E0:29:68:DA:6D:...` (`NotBefore=2026-11-25 13:14:30Z`, dibuat tepat saat `./gradlew assembleDebug`)
- `v3.20.3` (`versionCode=32003`): `SHA-256 = 97:6A:6E:A1:7B:B5:DA:87:...` (`NotBefore=2026-11-25 17:23:28Z`, dibuat tepat saat `./gradlew assembleDebug`)

### Akar Masalah
1. **Path `.android` di runner `ubuntu-24.04` vs AGP 8**: Image `ubuntu-latest` (`ubuntu-24.04`) memakai XDG config sehingga AGP 8 membaca/membuat debug keystore acak di `/home/runner/.config/.android/debug.keystore` ketika `ANDROID_USER_HOME` tidak disetel dan `buildTypes.debug` tidak memiliki `signingConfig` eksplisit. Akibatnya `~/.android/debug.keystore` yang di-restore dari cache diabaikan.
2. **Tidak ada verifikasi sertifikat pada APK hasil build**: Langkah CI sebelumnya membaca `DEBUG_CERT_SHA256` dari `~/.android/debug.keystore` tanpa memeriksa sertifikat yang benar-benar tertanam di `app-debug.apk` maupun `app-release.apk`.
3. **Kedaluwarsa cache 7 hari**: Cache GitHub Actions terhapus otomatis setelah 7 hari tanpa akses bila belum ada keepalive atau secret permanen (`ANDROID_KEYSTORE_*` / `ANDROID_DEBUG_KEYSTORE_BASE64`).

## Perubahan yang Diterapkan

1. **Patch Konfigurasi Signing Gradle (`scripts/patch-android-project.mjs`, `.gitignore`)**:
   - Memperluas blok `MYKEU_KEYSTORE_PATCH` di `patchAppBuildGradle()` agar membaca `debug-keystore.properties` (jika tersedia), menambahkan `signingConfigs.debug` dan `signingConfigs.release`, serta menambatkan `signingConfig signingConfigs.debug` secara idempoten baik ketika `buildTypes` belum memiliki blok `debug` maupun saat sudah memilikinya.
   - Menambahkan `android/debug-keystore.properties` ke `.gitignore`.
2. **Hardening Workflow & Gate Verifikasi `apksigner` (`.github/workflows/android-build.yml`)**:
   - Menambahkan jadwal cron `0 3 */5 * *` dan job `keepalive-keystore-cache` untuk menyegarkan TTL cache `android-debug-keystore-v1`, sambil melewati `build-android` saat event `schedule`.
   - Mengekspor `ANDROID_USER_HOME=$HOME/.android` dan mendukung secret opsional `ANDROID_DEBUG_KEYSTORE_BASE64`.
   - Menyalin `$HOME/.android/debug.keystore` ke `android/ci-debug.keystore`, menulis `android/debug-keystore.properties`, lalu memvalidasi sertifikat aktual `app-debug.apk` dan `app-release.apk` menggunakan `apksigner verify --print-certs` sebelum rilis (`exit 1` bila tidak cocok).
   - Membersihkan seluruh file keystore sementara di langkah `always()` dan menampilkan track + SHA-256 sertifikat terverifikasi di release notes & step summary.
3. **Bump Versi `3.20.4` (`versionCode 32004`) & Sinkronisasi Dokumen (`package.json`, `src/Index.html`, `src/updates.html`, `README.md`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, `tests/`)**:
   - Menaikkan versi ke `3.20.4` (`versionCode 32004`), memperbarui riwayat pembaruan & panduan Android, menyesuaikan asersi versi di suite test, dan menambah uji idempoten `patchAndroidProject` untuk template dengan/tanpa blok `buildTypes.debug` serta guard workflow di `tests/wave-v320-upgrades.test.js`.

## Catatan Migrasi Pengguna
- Karena build lama `<= v3.20.3` memakai keystore sementara per run yang sertifikatnya berbeda (`97:6A:6E:A1:...`), Android mewajibkan **1 kali uninstall** aplikasi lama sebelum memasang `v3.20.4`.
- Mulai `v3.20.4` dan seterusnya (`v3.20.5`, dst.), setiap rilis ditandatangani keystore konsisten yang terverifikasi `apksigner` sehingga pembaruan dapat langsung menimpa versi sebelumnya tanpa menghapus data lokal. Disarankan juga mengisi 4 GitHub Secrets `ANDROID_KEYSTORE_*` melalui `npm run cap:keystore` untuk signing rilis permanen.

## Verifikasi

- **PASS (`npm run check` & `node build.mjs`)**: Verifikasi lokal menguji sintaks seluruh berkas JS/MJS, 77 unit test (termasuk idempotensi `patchAndroidProject` untuk template dengan/tanpa blok `buildTypes.debug` serta guard workflow `android-build.yml`), dan membangun bundle `dist/` (`v3.20.4`, `versionCode: 32004`).
- **PASS (`git diff --check`)**: Keluar kode `0` tanpa konflik maupun galat spasi akhir.
- **PASS (`konoha:website_ai_detector` pada `src/` & `aislop:aislop_scan`)**: `src/` mendapat skor **0** (`Human-Built`), dan `aislop_scan` bebas temuan baru pada berkas yang diubah setelah pemecahan helper `patchAppBuildGradle`.
- **Belum diverifikasi lokal (butuh Cloud CI / perangkat fisik Android)**: Kompilasi APK runtime via GitHub Actions (`.github/workflows/android-build.yml`) dan uji instalasi menimpa antarrilis `v3.20.4` → `v3.20.5` secara langsung di perangkat Android.
