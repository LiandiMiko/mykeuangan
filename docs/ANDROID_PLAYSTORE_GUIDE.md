# Panduan Build Android & Rilis Google Play Store — MyKeuGuech

Panduan ini menyiapkan aplikasi Android **MyKeuGuech** (`com.mykeuguech.app`) berbasis **Capacitor 8** yang menargetkan **Android 16 (API Level 36)** sambil tetap menjaga versi **Web PWA GitHub Pages** berjalan paralel dari satu kode sumber yang sama.

---

## 0. Sinkronisasi Backend & Web Sebelum Build Android (Wave v3.17–v3.18)

Sebelum membangun `.apk` atau `.aab`, pastikan server Supabase & web sudah selaras dengan kode terbaru:

1. **Jalankan migrasi SQL terbaru** di **Supabase Dashboard → SQL Editor** (jika belum):
   - `supabase/migrations/20261124000000_oauth_onboarding_display_name.sql`
   - `supabase/migrations/20261125000000_normalize_categories_and_search.sql` (menormalkan kategori & filter dompet utama)
2. **Deploy ulang Edge Function Telegram Bot** (bila dipakai):
   ```powershell
   npx supabase functions deploy telegram-bot
   ```
3. **Push ke GitHub (`main`)** agar situs web PWA (`privacy.html`, `terms.html`, `delete-account.html`) ikut terbarui.

---

## 1. Prasyarat Lingkungan Lokal (Windows)

Pastikan toolchain berikut sudah terpasang agar Gradle & Capacitor 8 berjalan lancar:

1. **Node.js 22 LTS** atau lebih baru (`node -v`)
2. **Java Development Kit (JDK) 21** (`java -version`)
3. **Android Studio Otter (2025.2.1)** atau lebih baru
4. Di **Android Studio → SDK Manager**, centang & install:
   - **Android 16 (API 36)** SDK Platform
   - **Android SDK Build-Tools 36**
   - **Android SDK Command-line Tools**

---

## 2. Konfigurasi Supabase & Google OAuth untuk Android

Sebelum uji login Google di HP Android:

1. Buka **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs** dan tambahkan:
   ```text
   com.mykeuguech.app://auth-callback
   ```
2. Buka **Supabase Dashboard → Edge Functions → Secrets** (untuk fungsi `admin-password` & `delete-account`):
   Pastikan `ALLOWED_ORIGIN` juga menyertakan asal origin WebView Android (`https://localhost`):
   ```text
   ALLOWED_ORIGIN=https://liandimiko.github.io,https://localhost
   ```

> **Catatan:** WebView Capacitor di Android berjalan pada origin `https://localhost`, sedangkan GitHub Pages berjalan di `https://liandimiko.github.io/mykeuangan/`.

---

## 3. Build Android — Cloud GitHub Actions vs Lokal Windows

### 3A. Opsi Cepat: Cloud Build APK & AAB via GitHub Actions (Tanpa Install Android Studio)

Repository sudah dilengkapi workflow **`.github/workflows/android-build.yml`** (lockfile-free tanpa `cache: npm` + caching Gradle lewat `gradle/actions/setup-gradle@v4`) yang otomatis menyiapkan JDK 21 + Android SDK 36, menghasilkan aset Play Store (`512x512` & `1024x500`), lalu membundel `.apk` / `.aab` dengan nama berversi (`MyKeuGuech-v3.20.4-*.apk`):

1. **Buat test APK untuk HP Android Anda (`debug-apk`):**
   - Buka repo GitHub → tab **Actions** → pilih **Build Android APK & AAB (Capacitor 8)** → klik **Run workflow** → pilih **`debug-apk`** *(atau cukup push ke `main` untuk trigger `all`)* → tunggu ±3–5 menit → unduh artifact **`mykeuguech-android-debug-apk`** atau langsung dari **GitHub Releases** (`releases/latest`).
   - **Update in-place (timpa tanpa uninstall):** `scripts/patch-android-project.mjs` mengonfigurasi `signingConfigs.debug` secara eksplisit melalui `android/debug-keystore.properties` pada `buildTypes.debug`, workflow mengekspor `ANDROID_USER_HOME=$HOME/.android`, menjaga `~/.android/debug.keystore` tetap aktif dengan jadwal keepalive tiap 5 hari (`keepalive-keystore-cache`), mendukung secret permanen opsional `ANDROID_DEBUG_KEYSTORE_BASE64`, serta memeriksa sertifikat APK hasil build memakai `apksigner verify --print-certs` sebelum rilis. Catatan: build lama sebelum `v3.20.4` ditandatangani keystore sementara berbeda per run CI sehingga perlu **1× uninstall** sebelum memasang `v3.20.4`, lalu seluruh update berikutnya dapat langsung ditimpa.
   - **Agar signing 100% permanen selamanya (disarankan):** Buat keystore release sekali via `npm run cap:keystore` lalu isi 4 GitHub Secrets (`ANDROID_KEYSTORE_*`). Saat secrets tersedia, `Publish APK to GitHub Releases` otomatis mengutamakan `*-release.apk` (dan `.aab` siap Play Store) terverifikasi `apksigner` dengan signature permanen yang independen dari batas ketidakaktifan jadwal CI.
2. **Untuk build Signed Release `.apk` (`release-apk`), `.aab` (`release-aab`), atau `all` di Cloud:**
   - Buat file `.jks` dengan `keytool` (lihat Bagian 5), konversi ke Base64 di PowerShell:
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("android/mykeuguech-upload.jks")) | Set-Clipboard
     ```
   - Tambahkan **4 GitHub Repository Secrets** (*Settings → Secrets and variables → Actions → Secrets*):
     - `ANDROID_KEYSTORE_BASE64` (hasil Base64 dari clipboard)
     - `ANDROID_KEYSTORE_PASSWORD`
     - `ANDROID_KEY_ALIAS` (mis. `mykeuguech-upload`)
     - `ANDROID_KEY_PASSWORD`
   - Jalankan workflow dengan `build_type: release-apk`, `release-aab`, atau `all` (atau push tag `v3.18.0`) lalu unduh artifact **`mykeuguech-android-release-apk`** (`MyKeuGuech-v3.18.0-release.apk`) / **`mykeuguech-android-release-aab`** (`MyKeuGuech-v3.18.0-release.aab`).

> Pastikan GitHub Repository Variables (`SUPABASE_URL` & `SUPABASE_ANON_KEY` di *Settings → Secrets and variables → Actions → Variables*) sudah terisi jika `web/config.js` belum tersedia; workflow akan langsung memberi pesan jelas bila kedua variable tersebut kosong.

### 3B. Opsi Lokal Windows: Build 1-Perintah `.apk` / `.aab`

Setelah prasyarat Bagian 1 (Node.js 22+, JDK 21, Android SDK 36) terpasang, jalankan dari root repository:

```powershell
# 1. Install dependensi Capacitor 8 (cukup sekali atau saat package.json berubah)
npm install

# 2. Build Debug APK 1 perintah (otomatis build:prod + cap add/sync + patch API 36 + gradlew assembleDebug)
npm run cap:apk
```

File APK langsung disalin ke `release\MyKeuGuech-v3.18.0-debug.apk` (folder `release/` otomatis diabaikan Git).

Jika ingin build bertahap secara manual atau membuka proyek di Android Studio:

```powershell
npm run build:prod
npm run playstore:assets
npm run cap:init:android
npm run cap:assets
npm run cap:sync
```

Untuk build signed produksi 1-perintah di Windows setelah menyiapkan `android/keystore.properties` (Bagian 5):

```powershell
npm run cap:apk:release   # hasil: release\MyKeuGuech-v3.18.0-release.apk
npm run cap:aab           # hasil: release\MyKeuGuech-v3.18.0-release.aab
```

---

## 4. Uji Coba di HP Android Fisik (Wajib Sebelum Rilis)

Aktifkan **Developer Options → USB Debugging** di HP Android, sambungkan kabel USB, lalu:

```powershell
npm run cap:open
```

Di Android Studio, pilih perangkat HP Anda lalu tekan **Run (▶)**. Untuk melihat console WebView secara langsung dari PC, buka `chrome://inspect` di Google Chrome.

### Checklist Uji Perangkat Fisik
- [ ] **Splash Screen & Status Bar:** Tidak ada teks terpotong notch/punch-hole, warna bar sesuai mode Terang/Gelap (`SystemBars`).
- [ ] **Navigasi Tombol Back:** Menekan *Back* di modal/drawer akan menutup overlay dulu; di menu lain kembali ke Dashboard; tekan *Back* 2× di Dashboard untuk keluar.
- [ ] **Google Sign-In:** Klik **Lanjutkan dengan Google** → login di Chrome Custom Tab → otomatis kembali ke app dan masuk Dashboard.
- [ ] **Mode Offline:** Matikan Wi-Fi & Data Seluler → tutup paksa lalu buka ulang aplikasi → tampilan UI, ikon Phosphor, font Inter, dan cache data terakhir tetap tampil penuh.
- [ ] **Ekspor Native Share Sheet:** Coba ekspor CSV / Excel / PDF / Backup JSON → dialog Share bawaan Android muncul dan file dapat dibagikan/disimpan.
- [ ] **Hapus Akun & Legal:** Tautan *Kebijakan Privasi* / *Syarat & Ketentuan* terbuka di Custom Tab, serta **Hapus Akun & Data Permanen** berfungsi di akun tester.
- [ ] **PIN Auto-Lock:** Keluar ke Home > 2 menit lalu kembali ke app → layar PIN terkunci dan tombol *Back* tidak membypass PIN.

---

## 5. Upload Keystore & Build Signed `.aab`

Jangan pernah meng-commit file `.jks`, `.keystore`, atau `android/keystore.properties` ke Git (sudah masuk `.gitignore`).

1. Buat **Upload Keystore** otomatis lewat helper (atau jalankan `keytool` manual; simpan file & password di tempat aman, misal Password Manager):
   ```powershell
   npm run cap:keystore
   ```
   Perintah di atas membuat `android/mykeuguech-upload.jks`, menyusun `android/keystore.properties`, dan mencetak panduan pengisian 4 GitHub Repository Secrets (`ANDROID_KEYSTORE_*`). Alternatif manual:
   ```powershell
   keytool -genkey -v -keystore android/mykeuguech-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias mykeuguech-upload
   ```
2. Salin `android/keystore.properties.example` menjadi `android/keystore.properties` dan isi sesuai keystore Anda.
3. Jalankan sinkronisasi & build Android App Bundle (`.aab`):
   ```powershell
   npm run cap:sync
   cd android
   .\gradlew bundleRelease
   ```
   Hasil `.aab` siap unggah tersedia di:
   `android\app\build\outputs\bundle\release\app-release.aab`

---

## 6. Checklist Pengajuan Google Play Console (Fase 4)

> Gunakan teks & jawaban siap salin lengkap di **[docs/PLAYSTORE_LISTING_KIT.md](./PLAYSTORE_LISTING_KIT.md)**.

1. **Google Play Console Account** (biaya registrasi satu kali USD 25 + verifikasi identitas KTP/DUNS).
2. **Store Listing:** Nama `MyKeuGuech: Keuangan & Budget`, unggah `playstore-assets/icon-512.png` (`512x512`) & `playstore-assets/feature-graphic-1024x500.png` (`1024x500`), plus minimal 4 screenshot HP Indonesia/English.
3. **App Content & Kepatuhan:**
   - **Privacy Policy URL:** `https://liandimiko.github.io/mykeuangan/privacy.html`
   - **Account Deletion URL:** `https://liandimiko.github.io/mykeuangan/delete-account.html`
   - **Financial Features Declaration:** Pilih *My app does not offer regulated financial services* (*personal expense tracker & manual portfolio book-keeping only*).
   - **Data Safety:** Deklarasikan Email, Nama Tampilan, dan catatan keuangan pengguna terenkripsi in-transit (HTTPS), tidak dijual ke pihak ketiga, dan bisa dihapus mandiri.
   - **App Access:** Sediakan 1 akun email+password demo khusus tim reviewer Google Play.
4. **Closed Testing (Akun Developer Pribadi Baru):** Undang minimal **12 tester** opt-in selama **14 hari berturut-turut** sebelum mengajukan akses rilis *Production*.
