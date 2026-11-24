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

Repository sudah dilengkapi workflow **`.github/workflows/android-build.yml`** yang otomatis menyiapkan JDK 21 + Android SDK 36, menghasilkan aset Play Store (`512x512` & `1024x500`), lalu membundel `.apk` / `.aab` untuk diunduh langsung:

1. **Buat test APK untuk HP Android Anda:**
   - Buka repo GitHub → tab **Actions** → pilih **Build Android APK & AAB (Capacitor 8)** → klik **Run workflow** → pilih `build_type: debug-apk` → tunggu selesai → unduh artifact **`mykeuguech-android-debug-apk`** (`app-debug.apk`) dan **`mykeuguech-playstore-assets`** (`icon-512.png` & `feature-graphic-1024x500.png`).
2. **Untuk build Signed Release `.aab` di Cloud (opsional, untuk upload Play Console):**
   - Buat file `.jks` dengan `keytool` (lihat Bagian 5), konversi ke Base64 di PowerShell:
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("android/mykeuguech-upload.jks")) | Set-Clipboard
     ```
   - Tambahkan **4 GitHub Repository Secrets** (*Settings → Secrets and variables → Actions*):
     - `ANDROID_KEYSTORE_BASE64` (hasil Base64 dari clipboard)
     - `ANDROID_KEYSTORE_PASSWORD`
     - `ANDROID_KEY_ALIAS` (mis. `mykeuguech-upload`)
     - `ANDROID_KEY_PASSWORD`
   - Jalankan workflow dengan `build_type: release-aab` (atau push tag `v3.18.0`) lalu unduh **`mykeuguech-android-release-aab`**.

> Pastikan GitHub Repository Variables (`SUPABASE_URL` & `SUPABASE_ANON_KEY`) sudah terisi jika `web/config.js` tidak di-commit ke Git.

### 3B. Opsi Lokal Windows: Setup Project Android (Android Studio)

Jalankan perintah berikut secara berurutan di root repository:

```powershell
# 1. Install dependensi Capacitor 8
npm install

# 2. Unduh vendor lokal (Chart.js, Phosphor, SweetAlert2, Flatpickr, jsPDF, Inter, Supabase JS)
#    + kompilasi Tailwind CSS + bundle dist/
npm run build:prod

# 3. Buat aset grafis Play Store (playstore-assets/icon-512.png & feature-graphic-1024x500.png)
npm run playstore:assets

# 4. Buat folder android/ dan terapkan patch Target API 36 + deep link + keystore hook
npm run cap:init:android

# 5. Generate ikon adaptif & splash screen Android
npm run cap:assets
```

Untuk pembaruan kode berikutnya, cukup jalankan:

```powershell
npm run cap:sync
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

1. Buat **Upload Keystore** (simpan file & password di tempat aman, misal Password Manager):
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
