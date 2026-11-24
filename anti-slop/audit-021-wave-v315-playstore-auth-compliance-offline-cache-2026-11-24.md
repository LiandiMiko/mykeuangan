# Audit 021: Wave v3.15 Play Store Auth, Legal Compliance, Offline Read Cache & PIN Hardening - 2026-11-24

Status: Partial (Seluruh implementasi Edge Function `delete-account`, migrasi OAuth `handle_new_user()`, Google Sign-In + `PASSWORD_RECOVERY`, halaman hukum publik, True Offline Read Cache IndexedDB v2, hardening PIN Lock, 3 bugfix audit, test regresi, serta catatan rilis telah selesai dan diperiksa lewat scanner statis MCP `aislop`, `website_ai_detector`, dan `token_efficient_grep`; verifikasi runtime lokal `npm run check && npm run build:prod`, migrasi SQL Supabase, deploy Edge Function `delete-account`, serta aktivasi Google OAuth / Custom SMTP dijalankan pengguna secara lokal karena keterbatasan shell environment)

## Cakupan & Peningkatan Wave v3.15

1. **Edge Function Hapus Akun Mandiri & Migrasi OAuth (`supabase/functions/delete-account/index.ts`, `supabase/migrations/20261124000000_oauth_onboarding_display_name.sql`, `web/supabase-admin.js`)**:
   - Menambahkan Edge Function `delete-account` dengan CORS `ALLOWED_ORIGIN` (`Vary: Origin`), verifikasi JWT user pemanggil (`userClient.auth.getUser(token)`), validasi konfirmasi teks (`HAPUS` / `DELETE`), guard mencegah penghapusan administrator aktif terakhir, dan penghapusan user via `adminClient.auth.admin.deleteUser(userId)` (menghapus 14 tabel terkait secara cascade).
   - Memperbarui fungsi `public.handle_new_user()` (mempertahankan `pg_advisory_xact_lock(20261115, 1)` & `set search_path = public`) untuk membaca `full_name` / `name` dari metadata akun Google OAuth sebagai `display_name` bawaan.
   - Mengekstrak helper bersama `invokeEdgeFunction()` di `web/supabase-admin.js` untuk `api_adminSetPassword()` dan `api_deleteOwnAccount()`.

2. **Upgrade Autentikasi: Google Sign-In, Password Recovery & Profile Cache Offline (`web/supabase-auth-ui.js`, `web/supabase-auth.js`)**:
   - Mengekstrak helper UI Auth ke modul terpisah `web/supabase-auth-ui.js` (mempertahankan panjang `supabase-auth.js` tetap ramping), menambahkan tombol **Lanjutkan dengan Google** (`#mkGoogleBtn`), divider, tautan `privacy.html` & `terms.html` pada overlay login/daftar/reset, serta modal `showPasswordRecoveryModal()` untuk mengganti kata sandi saat tautan reset dibuka (`PASSWORD_RECOVERY`).
   - Memperbarui `web/supabase-auth.js` untuk meneruskan `{ redirectTo }` di `resetPasswordForEmail()`, mendaftarkan handler `onAuthStateChange` (`PASSWORD_RECOVERY`), mengikat klik `signInWithOAuth({ provider: 'google' })`, menyimpan `mk_cached_profile_v1` agar PWA tetap mengenali sesi user saat dibuka offline, menunda `checkActiveSession()` ketika `!navigator.onLine`, dan memperluas `LOGOUT_STORAGE_KEYS` dengan `mk_cached_profile_v1` serta `mk_pin_lock_state_v1`.

3. **Kepatuhan Google Play Store, Build Pipeline, Manifest & Service Worker (`web/privacy.html`, `web/terms.html`, `web/delete-account.html`, `build.mjs`, `web/manifest.webmanifest`, `web/sw.js`)**:
   - Menambahkan 3 halaman web publik standalone: `web/privacy.html`, `web/terms.html`, dan `web/delete-account.html` (memuat alur hapus akun mandiri langsung lewat web dengan konfirmasi `HAPUS`, menggunakan injeksi `<!-- __SUPABASE_SCRIPT__ -->` dan `<!-- __MYKEU_CONFIG__ -->` saat build).
   - Memperbarui `build.mjs` untuk menyertakan `ui-feat-cache.js` dan `supabase-auth-ui.js`, menyalin `privacy.html` / `terms.html`, dan merakit `dist/delete-account.html`.
   - Menambahkan `"id": "./index.html"` pada `web/manifest.webmanifest` serta memisahkan `targetCacheKey` halaman legal pada `web/sw.js` agar cache `./index.html` tetap bersih.

4. **True Offline Read Cache (`web/ui-feat-offline.js`, `web/ui-feat-cache.js`, `web/ui-shell.js`, `web/ui-state.js`)**:
   - Menaikkan `IDB_VERSION = 2` pada `mykeuangan_offline_db` dengan object store tambahan `offline_snapshot`, dan mengekspor `openOfflineDb`, `IDB_SNAPSHOT_STORE`, `buildOfflineTransactionResponse` lewat `root.__mkFeat`.
   - Menambahkan `web/ui-feat-cache.js` (`saveOfflineSnapshot()`, `loadOfflineSnapshot()`, `mergeQueuedOfflineTx()`) dengan debounce 350ms agar data terakhir terus terbarui ke IndexedDB.
   - Memperbarui `loadInitialAppData()` di `web/ui-shell.js` dan `refreshFromServer()` di `web/ui-state.js`: saat gagal memuat dari server, dashboard tetap terbuka memakai snapshot lokal + antrean offline disertai banner informatif **Mode Offline · Data Cache Lokal** dan tombol **Coba Sinkronkan**.

5. **Hardening PIN Lock, Hapus Akun In-App & 3 Bugfix Audit (`web/ui-feat-account.js`, `web/supabase-records.js`, `web/ui-export.js`, `web/ui-reports.js`)**:
   - Memperkuat PIN Lock lokal: cooldown 60 detik setelah 5 kali salah PIN (`mk_pin_lock_state_v1`), verifikasi PIN lama via `promptVerifyCurrentPin()` sebelum menghapus atau mengganti PIN, auto-lock otomatis setelah tab/aplikasi ditinggal idle `>= 120` detik (`visibilitychange`), serta menambah tombol **Hapus Akun & Data Permanen** (`deleteOwnAccountFlow()`) di Pengaturan Akun.
   - Menyelaraskan deduplikasi `keterangan` CSV server secara case-insensitive (`toLocaleLowerCase()`) di `web/supabase-records.js`, menyaring transaksi `Utang`/`Piutang` dari total summary card PDF di `web/ui-export.js`, dan mengubah nama file unduhan template CSV di `web/ui-reports.js` menjadi `template-transaksi-mykeuguech.csv`.

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** across **62 files** (`typescript`, `javascript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public Supabase client anon key) serta 2 `info` (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector`)**:
  - `src/`: Score **0** (`Human-Built`, **PASS**, **16 files**, **224.152 bytes**).
  - `web/privacy.html`, `web/terms.html`, `web/delete-account.html`: masing-masing Score **0** (`Human-Built`, **PASS**).
- **CATATAN (`konoha:anti_slop` `strict: true`)**: Melaporkan status `failed` (**85/100**) karena environment sandbox (`scanner_nonzero_exit` — `MODULE_NOT_FOUND` untuk `npm-prefix.js` & `npx-cli.js` di Node `v24.19.0`), **0** temuan AI-slop pada kode sumber.
- **PASS (`konoha:token_efficient_grep`)**:
  - `web/`: **0** `transition-all`, **0** `ph-*-bold|fill|...`, **0** `console.log(`, **0** `bg-${`, **0** `alert(`, dan **1** `.innerHTML = ''` hanya di `web/ui-calendar.js:206`.
  - `src/`: **0** active `transition-all` class (hanya teks dokumentasi di `src/updates.html:145,170`), **0** `ph-*-bold|fill|...`, **0** `console.log(`, **0** `.innerHTML`, **0** `bg-${`, **0** `alert(`.
- **BELUM DIVERIFIKASI LOKAL (Memerlukan Lingkungan Pengguna)**: `npm run check && npm run build:prod`, eksekusi migrasi SQL, deploy Edge Function `delete-account`, dan konfigurasi Google OAuth + Custom SMTP.
