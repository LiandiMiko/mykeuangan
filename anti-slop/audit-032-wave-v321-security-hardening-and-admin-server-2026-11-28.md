# Audit 032: Pengerasan Keamanan Gelombang 1 — PIN sebagai Enkripsi, Gerbang Data & Admin di Sisi Server (Wave v3.21) — 2026-11-28

Status: Complete (3 commit di branch `fix/security-wave-1`, PR #1 merged `013ef17`, migrasi + Edge Function live di produksi Supabase, deploy web & APK sukses, serta bump versi `3.20.5` / `versionCode 32005` di branch `feat/primary-bank-wallet-runway` agar rilis ini terlihat di aplikasi; pengujian manual di perangkat fisik belum dilakukan)

## Cakupan

Menindaklanjuti review read-only 2026-11-28 (91 temuan: 3 kritis/K, 13 tinggi/T, 40 sedang/S, 22 rendah/R, 13 kualitas/Q) untuk enam perbaikan Gelombang 1: K1, K2, K3, T1, T2, T5. Pekerjaan dilakukan di branch + PR untuk review pemilik, tidak pernah langsung ke `main`.

## Temuan Forensik

- **K1 — Otorisasi admin hanya di klien**: `api_setUserRole` / `api_setUserStatus` di `web/supabase-admin.js` memanggil endpoint admin Supabase langsung dari browser dan pemeriksaan admin hanya dilakukan di klien. Pengguna terautentikasi mana pun bisa memanggil REST `profiles` dan mengubah perannya sendiri.
- **K2 — PIN bukan enkripsi**: PIN hanya gerbang tampilan; token Supabase tersimpan di `localStorage` dan snapshot IndexedDB tersimpan plaintext. Tidak ada enkripsi data lokal sama sekali.
- **K3 — Logout menghapus antrean offline**: `logout()` menghapus antrean mutasi offline yang belum tersinkron — transaksi yang dibuat offline hilang permanen bila pengguna logout saat offline.
- **T1 — Data dirender sebelum PIN**: data dimuat dan ditampilkan sebelum PIN dimasukkan, termasuk lewat jalur snapshot offline.
- **T2 — Cooldown PIN bisa direset**: status cooldown PIN tersimpan di `localStorage` dan bisa dihapus dari DevTools, sehingga tebakan PIN praktis tak terbatas.
- **T5 — Pengguna pertama otomatis admin**: `handle_new_user()` menjadikan pengguna pertama yang mendaftar sebagai admin secara otomatis.
- **Temuan probe produksi (28 Nov 2026 03:21 WIB)**: 12 dari 14 file migrasi sudah live; `admin-user-ops` belum ter-deploy sama sekali; `admin-password` ter-deploy dengan slug yang salah, `super-responder` (v3; isi bundle eszip-nya dikonfirmasi sebagai kode admin-password) sementara klien memanggil `admin-password`, sehingga reset kata sandi admin tidak bisa dipakai; `delete-account` memakai `verify_jwt: false` (handler-nya memeriksa JWT sendiri) dan `telegram-bot` `false` by design.

## Perubahan yang Diterapkan

1. **K1 — Otorisasi admin ke Edge Function (commit `2d0906d`, 5 file, +320/−7)**: `api_setUserRole` / `api_setUserStatus` di `web/supabase-admin.js` kini memanggil Edge Function `admin-user-ops` (aksi baru `set_user_role` / `set_user_status`: verifikasi JWT, pemeriksaan admin aktif, validasi input, penjaga self-demotion dan admin aktif terakhir, audit server ke `admin_audit_logs`); `supabase/functions/admin-user-ops/index.ts` diperluas; migrasi baru `supabase/migrations/20261128000000_wave1_admin_hardening.sql` menghapus logika pengguna-pertama-admin dari `handle_new_user()` dan menjalankan `REVOKE UPDATE ON profiles FROM authenticated`; `supabase/README.md` mendapat prosedur manual wajib pengangkatan admin pertama; `tests/wave1-admin-hardening.test.js` (5 tes).
2. **K2/T1/T2 — PIN sebagai kunci enkripsi data lokal (commit `4788442`, 7 file, +1264/−70)**: DEK acak AES-GCM 256-bit; KEK = PBKDF2-SHA256 100.000 iterasi atas PIN ber-domain `mk-data-key:`; DEK terbungkus tersimpan di `localStorage` (`mk_pin_data_key_wrap`), DEK yang sudah dibuka hanya hidup di memori; snapshot IndexedDB dan payload antrean offline terenkripsi; PIN diverifikasi sebelum data apa pun dimuat/dirender, termasuk jalur snapshot offline; status lockout pindah ke IndexedDB (v3, store `pin_lock_state`) dengan backoff 60 detik → 5 → 15 → 60 menit dan verifikasi ulang kata sandi akun setelah 3 kali terkunci; `tests/pin-encryption-gating.test.js` (9 tes).
3. **K3 — Blokir logout bila antrean offline belum tersinkron (commit `b9baf29`, 3 file, +642/−3)**: `window.logout(opts)` dengan `opts.force`; logout ditahan saat antrean offline tidak kosong dan menampilkan dialog (Sinkron Sekarang / Ekspor Darurat JSON / Batal); `deleteOwnAccountFlow` memanggil `logout({ force: true })`; `tests/logout-offline-guard.test.js` (11 tes).
4. **Langkah produksi Supabase (28 Nov 2026 03:21–03:35 WIB)**: probe dulu, lalu diterapkan berurutan lewat `db-query`: `20261125120000_admin_audit_and_telegram_unlink.sql` (membuat `admin_audit_logs`, `admin_log_action`, `admin_unlink_user_telegram`), kemudian `20261128000000_wave1_admin_hardening.sql`. Diverifikasi sesudahnya: logika pengguna-pertama di `handle_new_user` sudah false, hak UPDATE `authenticated` pada `profiles` = NONE, policy tetap `is_admin()`, `admin_audit_logs` ada, dan jumlah admin aktif tetap tepat 1 (pemilik, `lisandi.miko24@gmail.com` — tidak perlu UPDATE pengangkatan). `admin-user-ops` v1 ter-deploy (verify_jwt true, ACTIVE; panggilan tanpa autentikasi mengembalikan 401). `admin-password` ditemukan terpasang dengan slug salah `super-responder` (v3) dan diperbaiki: kode repo `supabase/functions/admin-password/index.ts` ter-deploy dengan slug benar `admin-password` (v1, verify_jwt true, 401 tanpa autentikasi). Deployment `super-responder` yang tersesat dibiarkan apa adanya — penghapusannya menunggu keputusan pemilik. `delete-account` (verify_jwt false) dan `telegram-bot` (false by design) dicatat sebagai kandidat Gelombang 2.
5. **Rilis v3.20.5 — visibilitas (branch `feat/primary-bank-wallet-runway`)**: Gelombang 1 rilis tanpa bump versi, sehingga aplikasi live tetap menampilkan v3.20.4, riwayat pembaruan tidak mencatat apa-apa, dan updater in-app tidak pernah meminta update. Diperbaiki di branch ini: `package.json` → `3.20.5`; `src/Index.html` (meta `app-version` + badge `navUpdatesVersion`); `src/updates.html` (`data-latest-release` `2026-11-28-v3.20.5`, label versi saat ini, kartu rilis baru 28 November 2026, kartu v3.20.4 diturunkan menjadi details, hitungan menjadi 26 rilis); `README.md` (header, badge, entri changelog 28 November 2026); `docs/ANDROID_PLAYSTORE_GUIDE.md` (contoh nama APK); tes yang mengunci versi dipindah ke `3.20.5` / `32005` (`tests/pro-web-ui.test.js`, `tests/wave-v320-upgrades.test.js`, `tests/android-m3-ui.test.js`). `versionCode` 32005 diturunkan otomatis (`major * 10000 + minor * 100 + patch`, `scripts/patch-android-project.mjs:133`); `dist/version.json` dibuat `build.mjs` dari `package.json`.

## Catatan Migrasi Pengguna

- Buka kunci biometrik selalu kembali ke PIN sekali tiap aplikasi dibuka (DEK tidak bisa diturunkan dari biometrik).
- Kunci ulang di tengah sesi hanya mengaburkan data yang sudah dirender di DOM.
- Kehilangan/rusak DEK wrap (`mk_pin_data_key_wrap`) membuat data lokal terenkripsi tidak bisa dipulihkan dari perangkat; pemulihan = sinkron ulang dari server (kecuali item antrean yang belum tersinkron).
- PBKDF2 100.000 iterasi berada di bawah rekomendasi OWASP saat ini (kandidat gelombang berikutnya).
- Token Supabase masih tersimpan di `localStorage` (di luar cakupan Gelombang 1).
- Update ke v3.20.5 menimpa v3.20.4 tanpa uninstall (keystore debug persisten yang sama, `versionCode 32005` > `32004`).

## Verifikasi

- **PASS (`node scripts/check-syntax.mjs`)**: sintaks terverifikasi di 60 file JS/MJS.
- **PASS (`node --test`)**: **107/107 lolos, 0 gagal** — 102 saat merge PR #1 (77 baseline + 25 tes baru Gelombang 1: 5 admin-hardening, 9 pin-encryption-gating, 11 logout-offline-guard) ditambah 5 tes fitur dompet utama di branch ini.
- **PASS (CI `verify` PR #1)**: lolos sebelum merge; merge state CLEAN; merge commit `013ef17`, `2026-11-27T21:00:47Z` (PR https://github.com/LiandiMiko/mykeuangan/pull/1).
- **PASS (deploy produksi)**: "CI & Deploy ke GitHub Pages" (run 46067447875) success; "Build Android APK & AAB (Capacitor 8)" (run 46067447868) success; aset rilis v3.20.4 diunggah ulang 2026-11-27T21:02:40Z dan diverifikasi berisi penanda Wave 1 (19 kecocokan di `assets/public/index.html` di dalam APK).
- **PASS (`konoha:website_ai_detector` pada `src/`)**: skor **0** (`Human-Built`, PASS), 16 file (299.933 byte), 0 temuan, 50 ms, `2026-11-27T21:29:25Z`.
- **`aislop:aislop_scan` tidak dijalankan**: MCP aislop tidak tersedia di lingkungan ini — tidak ada skor yang dicatat.
- **PASS (`git diff --check`)**: keluar kode `0`.
- **Belum diverifikasi (butuh browser/perangkat fisik & sesi admin sungguhan)**: uji manual 6 langkah (gerbang PIN sebelum data, lockout bertingkat, pulih setelah unlock, transaksi offline + penjaga logout, aksi panel admin dengan sesi admin, upgrade IDB v2→v3 dengan data lama); pemanggilan langsung fungsi admin dari panel dengan sesi admin sungguhan.
