# Audit 028: Hotfix v3.20.1 — Native Android BiometricPrompt & Refresh Harga Aset Multi-Sumber (2026-11-25)

Status: Complete (Perbaikan kunci sidik jari native Android + WebAuthn serta refresh harga Tabungan & Investasi multi-penyedia dengan fallback klien selesai dan terverifikasi lewat `npm run check`, `node build.mjs`, `git diff --check`, serta pemindaian statis; build APK Android di CI/lokal, deploy ulang Edge Function `telegram-bot`, dan uji di perangkat fisik dijalankan pada tahap rilis pengguna)

## Akar Masalah

1. **Kunci Sidik Jari / Biometrik (`web/ui-feat-native-ux.js`, `web/ui-feat-account.js`, `scripts/patch-android-project.mjs`)**:
   - Proyek Android Capacitor belum memiliki implementasi native `NativeBiometric` (`package.json` maupun folder `android/`), sehingga `getNativeBiometricPlugin()` selalu `null` dan jatuh ke WebAuthn `navigator.credentials.create()` yang gagal di WebView Android (`https://localhost`).
   - `getNativeBiometricPlugin()` tidak memanggil `Capacitor.registerPlugin('NativeBiometric')` saat properti `Capacitor.Plugins.NativeBiometric` belum terisi, dan tidak ada `USE_BIOMETRIC` / `androidx.biometric:biometric` di manifest maupun Gradle Android.
   - Tombol **Aktifkan Sidik Jari** di Pengaturan Akun langsung menutup SweetAlert2 tanpa jeda settlement sebelum dialog status baru, menolak PIN yang baru diketik sebelum klik **Simpan**, dan penghapusan PIN (`acc-clear-pin-btn`) tidak menghapus status biometrik.
   - Layar kunci PIN (`promptAppPinInput()`) belum menyediakan tombol ulang **Buka dengan Sidik Jari**, dan `enrollWebAuthnCredential()` mengirim `rp.id` mentah untuk hostname IP serta tidak menyertakan `transports: ['internal']` / `rpId` saat `credentials.get()`.

2. **Refresh Harga di Tabungan & Investasi (`web/supabase-portfolio.js`, `web/ui-assets.js`, `supabase/functions/telegram-bot/jobs.ts`, `src/Index.html`, `web/sw.js`)**:
   - `api_refreshPrices()` bergantung tunggal pada Edge Function `telegram-bot` (`{ job: 'refresh_prices' }`) dan gagal total saat fungsi belum di-deploy, terblokir CORS WebView Android (`https://localhost`), atau terkena pembatasan CoinGecko (`429`/`401`/`403`).
   - `api_refreshPrices()` tidak mengurai JSON error dari `error.context`, dan `jobs.ts` hanya mendukung 28 simbol Crypto via CoinGecko tanpa fallback penyedia harga lain.
   - Input aset Crypto manual tanpa dompet di `api_addAssetV2()` menyimpan `value: 0` sehingga tetap `Rp 0` jika refresh harga gagal; `refreshAssetPrices()` juga belum membedakan kondisi offline maupun akun tanpa aset harga otomatis.

## Perubahan

1. **Plugin Native Android BiometricPrompt (`scripts/patch-android-project.mjs`)**:
   - Menambahkan izin `android.permission.USE_BIOMETRIC` dan `android.permission.USE_FINGERPRINT` secara idempoten di `patchAndroidManifest()`, serta dependensi `implementation "androidx.biometric:biometric:1.1.0"` di `patchAppBuildGradle()`.
   - Menghasilkan `NativeBiometricPlugin.java` (`@CapacitorPlugin(name = "NativeBiometric")`) dengan `isAvailable()` (`available`, `none_enrolled`, `no_hardware`, `hw_unavailable`, `unavailable`) dan `verifyIdentity()` memakai `BiometricManager.Authenticators.BIOMETRIC_WEAK` + `AtomicBoolean` single-settle guard.
   - Memperbarui `patchMainActivity()` untuk mendaftarkan `registerPlugin(NativeBiometricPlugin.class);` sebelum `super.onCreate(savedInstanceState);` secara idempoten, serta mengekspor `patchAndroidProject()` agar dapat diuji langsung.

2. **Pengerasan Biometrik Frontend & Tombol Ulang di Layar PIN (`web/ui-feat-native-ux.js`, `web/ui-feat-account.js`)**:
   - Memperbarui `getNativeBiometricPlugin()`, menambah `checkBiometricAvailability()`, `resolveWebAuthnRpId()`, `formatBiometricFailureReason()`, `waitSwalClosed()`, dan `decoratePinModalBiometricButton()` + `bindPinModalBiometricRetry()`.
   - Memastikan WebView Android tidak jatuh ke WebAuthn saat sensor belum didaftarkan atau plugin native tidak tersedia, menjaga user-gesture WebAuthn sebelum `credentials.create()`, menyertakan `transports: ['internal']` pada `credentials.get()`, membersihkan `mk_biometric_pin_enabled` dan `mk_biometric_cred_id` saat PIN dihapus, dan mendukung aktivasi langsung saat PIN baru diketik di modal akun (`saveInitialAppPin()`).

3. **Refresh Harga Aset Multi-Sumber & Fallback Klien (`web/supabase-portfolio.js`, `web/ui-assets.js`, `supabase/functions/telegram-bot/jobs.ts`, `src/Index.html`, `web/sw.js`)**:
   - Menambahkan `fetchDirectMarketPricesIDR()`, `refreshPricesDirect()`, `savePortfolioSnapshotDirect()`, dan `extractEdgeErrorMessage()` di `web/supabase-portfolio.js` untuk fallback otomatis ke `fawazahmed0/currency-api` (jsDelivr + mirror Cloudflare Pages) & CoinGecko saat Edge Function gagal atau simbol tidak tercakup, sekaligus menghitung nilai awal aset Crypto manual (`quantity * buyPrice`).
   - Memperluas `CRYPTO_MAP` (57 simbol), menambah fallback `currency-api` dan `api.binance.com` ticker serta mengizinkan origin native Capacitor (`https://localhost`, `capacitor://localhost`, `http://localhost`) di `supabase/functions/telegram-bot/jobs.ts`.
   - Menangani status offline, nol aset harga pasar (`noMarketAssets`), dan pembaruan parsial di `refreshAssetPrices()` (`web/ui-assets.js`), serta mengizinkan `https://api.coingecko.com` dan `https://latest.currency-api.pages.dev` pada CSP `src/Index.html` dan melewati cache `web/sw.js`.

4. **Versi `3.20.1`, Pengujian & Sinkronisasi Catatan (`package.json`, `src/Index.html`, `src/updates.html`, `README.md`, `tests/*.test.js`)**:
   - Menaikkan versi ke `3.20.1` (`package.json`, `src/Index.html`), memperbarui catatan rilis pada `README.md` dan `src/updates.html` (`Menampilkan 22 rilis`), serta menambah 3 suite uji regresi di `tests/wave-v320-upgrades.test.js` dan menyelaraskan assertion versi di `tests/pro-web-ui.test.js` dan `tests/android-m3-ui.test.js`.

## Verifikasi

- **PASS (`npm run check`)**:
  - `node scripts/check-syntax.mjs`: `✅ Syntax verified across 60 JS/MJS files.`
  - `node --test`: **71** tes **PASS**, **0** gagal (termasuk 3 tes baru `hotfix v3.20.1` untuk patching Android idempoten, verifikasi biometrik native/WebAuthn, dan fallback refresh harga + kalkulasi nilai crypto manual).
- **PASS (`node build.mjs`)**: Menghasilkan `dist/index.html` (`942 KB`), `dist/version.json` (`v3.20.1`, `min v3.19.1`), dan `dist/sw.js` (`cache: mykeuangan-88cd7063b51d`).
- **PASS (`git diff --check`)**: Exit code `0` tanpa konflik maupun trailing whitespace errors.
- **PASS (`konoha:website_ai_detector` pada `src/`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**266.175** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep` & `konoha:file_info`)**:
  - `src/` (`transition-all` & sufiks ikon Phosphor v1): **0** kecocokan; `web/` (`console.log(`, `alert(`, `eval(`, `new Function(`, interpolasi class Tailwind dinamis): **0** kecocokan.
  - Batas baris modul JS/TS terjaga `<= 431` baris (`web/ui-feat-account.js`: 431, `web/ui-feat-native-ux.js`: 405, `web/supabase-portfolio.js`: 385, `supabase/functions/telegram-bot/jobs.ts`: 336, `scripts/patch-android-project.mjs`: 296, `web/ui-assets.js`: 281).
- **Scoped `aislop:aislop_scan`**:
  - `web/` (52 file): skor **92/100**, **0** confirmed defects, **0** warnings pada `ui-feat-account.js`, `ui-feat-native-ux.js`, dan `ui-assets.js`; **1** warning `ai-slop/hardcoded-url` untuk URL CDN publik `@fawazahmed0/currency-api` di `web/supabase-portfolio.js:48`, plus **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` public Supabase anon key).
  - `scripts/` (8 file): skor **79/100**, **0** errors, **0** findings di `scripts/patch-android-project.mjs` (16 temuan pre-existing di `fetch-vendors.mjs` dan `generate_icons.mjs`).
  - `supabase/functions/telegram-bot/` (7 file): **11** error pre-existing `eslint/no-undef` untuk global `Deno` (karena scan direktori tanpa config Deno) dan **1** warning `ai-slop/hardcoded-url` di `jobs.ts:71` untuk URL CDN `@fawazahmed0/currency-api`.

## Belum Diverifikasi (Dijalankan Pengguna)

- Deploy ulang Edge Function `telegram-bot` (`npx supabase functions deploy telegram-bot --no-verify-jwt`) bila memakai refresh harga sisi server / cron.
- Build ulang APK/AAB Android (`npm run cap:apk` / workflow `.github/workflows/android-build.yml`) agar `NativeBiometricPlugin.java`, `MainActivity.java`, dan `androidx.biometric:biometric:1.1.0` masuk ke binary Android.
- Uji langsung di HP Android & browser untuk: aktivasi/buka kunci sidik jari (termasuk tombol **Buka dengan Sidik Jari** di modal PIN) dan tombol **Refresh Harga** di halaman **Tabungan & Investasi**.
