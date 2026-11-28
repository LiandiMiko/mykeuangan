# Audit 046: Akun Google-only Bisa Hapus Akun Sendiri — 2026-11-28

Status: In progress (pekerja Gelombang 7c Item 3, branch `feat/google-only-delete-account` dari `origin/main 5eaa3fa` / v3.20.13; rancangan ditulis SEBELUM implementasi; deploy produksi + merge menunggu koordinator)

## Cakupan

Permintaan koordinator Gelombang 7c Item 3 (2026-11-28): pengguna yang mendaftar hanya lewat Google TIDAK BISA menghapus akunnya sendiri hari ini, karena edge function `delete-account` mensyaratkan kata sandi (T4, Gelombang 4). Tugas: alur hapus akun yang aman untuk akun Google-only, tanpa melonggarkan apa pun bagi akun ber-password, tanpa menyentuh jalur auto-hapus admin. Batas file: `supabase/functions/delete-account/index.ts` + `web/supabase-admin.js` + `web/ui-feat-account.js` + tes. TIDAK bump versi (koordinator saat integrasi). TIDAK menyentuh `admin-password`, `webauthn`, modul sync/offline, `web/config.js`, Kantor Paijo.

## Temuan / Akar Masalah

- **Server memaksa password untuk semua akun** (`supabase/functions/delete-account/index.ts`, blok T4 ~baris 107-120): tanpa `body.password` → 401 `Kata sandi tidak valid.`; `signInWithPassword` untuk akun Google-only selalu gagal karena akun itu tidak punya kredensial password. Komentar di kode itu sendiri sudah mengantisipasi: pesan generik dipilih "agar tidak membocorkan apakah password yang dikirim kosong, salah, atau akun tidak punya password (mis. akun OAuth-only)".
- **Klien mengunci alur yang sama** (`web/supabase-admin.js:311-322` `api_deleteOwnAccount(confirmation, password)` — password wajib, dilempar bila kosong; `web/ui-feat-account.js:591+` `deleteOwnAccountFlow()` — dialog selalu menampilkan kolom password dan menolak lanjut bila kosong).
- **Halaman standalone ikut buntu** (`web/delete-account.html`): form password + catatan "Jika akun Anda hanya memakai Google Sign-In tanpa kata sandi, Anda belum bisa menghapus akun dari halaman ini". Halaman ini DI LUAR batas file tugas ini — tidak diubah di sini; dicatat sebagai tindak lanjut koordinator (lihat Belum Diverifikasi).
- **Bukan masalah hipotetis — ada pengguna nyata yang terdampak**: hitung agregat produksi 2026-11-28 (tanpa membaca data pribadi): `auth.users` berisi **4 akun Google-only** (`raw_app_meta_data->'providers' = ["google"]`) dan 3 akun email (`["email"]`). Keempat akun Google-only itu hari ini tidak punya jalan apa pun untuk menghapus akunnya sendiri.
- **Jalur auto-hapus admin TIDAK terdampak masalah ini dan tidak boleh ikut berubah**: `supabase/functions/account-cleanup/index.ts` memanggil `admin.deleteUser` langsung dengan service-role + `x-cron-secret`, tanpa melewati `delete-account`. Verifikasi regresi: file tidak diubah + tes `account-cleanup` tetap hijau di suite penuh.
- **Cara klien tahu akun itu Google-only — sudah ada, tidak perlu ditebak**: `sb.auth.getUser()` mengembalikan `user.app_metadata.providers` (cara baku supabase-js; `app_metadata` ditulis server GoTrue dan TIDAK bisa diubah pengguna — berbeda dengan `user_metadata`). Di produksi, akun Google-only membawa `providers: ["google"]`, akun email `["email"]`. Aturan deteksi: Google-only ⟺ `providers` tepat `["google"]`. Bila metadata tidak ada/rusak → fallback ke jalur password (fail-closed ke perilaku lama).

## Rancangan (ditulis sebelum implementasi)

Syarat keras: penghapusan WAJIB dibuktikan dengan autentikasi SEGAR (fresh). Yang diterima sebagai bukti segar untuk akun Google-only adalah **access token sesi Supabase yang baru diterbitkan lewat login ulang Google** — diverifikasi server, bukan dipercaya dari klien.

### Mengapa `amr`, bukan `iat` saja — jebakan refresh token

- `iat` (issued-at) token TIDAK membuktikan login ulang: refresh token mencetak access token baru dengan `iat` baru. Sesi curian yang di-refresh akan tampak "segar" bila hanya `iat` yang dicek — itu justru melubangi T4 (sesi curian saja cukup untuk menghapus akun).
- Bukti yang benar adalah klaim **`amr`** (authentication method reference) di JWT: entri `{ method: "oauth", timestamp: <detik login> }`. GoTrue mencatatnya per sesi di tabel `auth.mfa_amr_claims` dan **refresh token TIDAK menggeser timestamp-nya** — hanya login/verifikasi baru yang menggesernya.
- Bukti empiris di proyek ini (2026-11-28, agregat saja): `auth.mfa_amr_claims` berisi baris `authentication_method = 'oauth'` (4 baris, terakhir 2026-11-25) di samping `'password'` (5 baris) — GoTrue proyek ini memang merekam klaim `oauth` tiap sesi Google. Bacaan atas sumber `supabase/auth` (diskusi supabase.com yang membaca `internal/models/amr.go` saat ini) mengonfirmasi hal yang sama: "A token refresh does not move it. Only a new verify does." — pola yang sama dipakai Supabase sendiri untuk step-up auth (MFA).
- Karena itu server memeriksa **keduanya**: `amr` entri `oauth` ≤ 600 detik (bukti utama) DAN `iat` ≤ 600 detik (lapis kedua; pada token yang baru diterbitkan lewat login, keduanya segar bersamaan). Tes kunci yang membuktikan desain ini: token dengan `iat` segar tapi `amr` basi (simulasi sesi curian yang di-refresh) HARUS DITOLAK.

### Server — `supabase/functions/delete-account/index.ts`

- Body baru: `{ confirmation, password?, oauth_token? }`. Bila `oauth_token` terisi → jalur OAuth; bila tidak → jalur password lama, **tidak berubah satu baris perilaku pun** (validasi `HAPUS`/`DELETE`, `signInWithPassword`, pesan `Kata sandi tidak valid.`).
- Jalur OAuth, berurutan (gagal di langkah mana pun → 401 generik `Verifikasi ulang gagal.`, tanpa membocorkan cek mana yang gagal):
  1. **Pemohon harus Google-only**: `authData.user.app_metadata.providers` (dari `getUser` atas token sesi di header Authorization — sudah tervalidasi) harus tepat `["google"]`. Bila mengandung `'email'`/`'phone'` (akun punya kredensial password) → tolak jalur OAuth, pakai password. Ini mencegah akun ber-password mem-bypass password lewat OAuth.
  2. **Token bukti harus asli dan milik pemohon**: `userClient.auth.getUser(oauth_token)` harus sukses dan `id`-nya == pemohon. Token milik user lain / token palsu / token provider lain → tolak. (Tanda tangan JWT divalidasi GoTrue di langkah ini — dekode lokal sesudahnya hanya membaca klaim, bukan memverifikasi.)
  3. **Token bukti harus dari Google**: `app_metadata.providers` dari hasil `getUser` itu harus memuat `'google'`.
  4. **Token bukti harus SEGAR**: dekode payload JWT (base64url, pola `b64ToBytes` yang sudah ada di file); `amr` harus memuat `{ method: "oauth", timestamp }` dengan `now - timestamp ≤ 600` detik dan `timestamp ≤ now + 60` (toleransi skew jam); `iat` juga harus `now - iat ≤ 600` dan `iat ≤ now + 60`.
  5. Token malformed (bukan JWT 3 segmen / payload bukan JSON) → tolak.
- Setelah lolos, alur lanjut **identik** dengan jalur password: cek admin-terakhir (satu-satunya admin aktif tidak boleh hapus diri), cabut webhook bot personal (best-effort), `admin.deleteUser`. Tidak ada jalan pintas di sekitar pengaman itu.
- Jendela 600 detik (10 menit): cukup longgar untuk round-trip redirect Google (biasanya < 1 menit) + ketik HAPUS, cukup sempit untuk membatasi replay token curian.
- Tanpa migrasi DB. Tanpa secret/env baru. Tanpa perubahan CORS (`verify_jwt` tetap true; probe tanpa JWT → 401).
- Yang DITOLAK mentah-mentah: tanpa bukti segar; token basi (`amr`/`iat` > 10 menit); token milik user lain; token provider lain (`amr` method bukan `oauth` / providers tanpa `google`); akun ber-password yang mencoba jalur OAuth; token malformed; `iat` di masa depan.

### Klien — `web/supabase-admin.js` + `web/ui-feat-account.js`

- `api_deleteOwnAccount(confirmation, password, oauthToken)` (supabase-admin.js): bila `oauthToken` terisi → kirim `{ confirmation, oauth_token: oauthToken }`; bila tidak → perilaku lama (password wajib, error bila kosong). Tanda tangan lama tetap kompatibel (param ketiga opsional).
- `deleteOwnAccountFlow()` (ui-feat-account.js) — deteksi dulu via `sb.auth.getUser()` → `app_metadata.providers`:
  - **Akun ber-password** → dialog lama tidak berubah (kolom password, pesan lama).
  - **Google-only + sesi SUDAH segar** (access token saat ini didekode lokal: entri `amr` `oauth` < 10 menit — cek ini hanya UX, server yang memutuskan) → dialog tanpa kolom password, catatan "Terverifikasi lewat Google", ketik HAPUS → kirim `oauth_token` = access token sesi saat ini. Tanpa redirect.
  - **Google-only + sesi basi** → dialog penjelasan berbahasa Indonesia + ketik HAPUS + tombol "Lanjutkan dengan Google" → simpan penanda di `sessionStorage` (`mk_delete_account_google_pending_v1`, `{ confirmation, startedAt }`, TTL 10 menit) → `sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirectUrl(), queryParams: { prompt: 'select_account' } } })` (native: `window.startNativeOAuth(sb, 'google')` seperti tombol login). `prompt: 'select_account'` memaksa pemilih akun Google supaya re-autentikasi eksplisit dan terlihat — penting untuk aksi destruktif.
  - **Kembali dari Google (resume)**: `onAuthStateChange` `SIGNED_IN` + cek saat modul dimuat → bila penanda ada dan belum kedaluwarsa: tunggu PIN terbuka dulu bila PIN diset (poll 1 detik, dibatasi TTL penanda — supaya dialog tidak menimpa layar kunci PIN), lalu dialog akhir: ketik HAPUS lagi (konfirmasi SESUDAH autentikasi segar — HAPUS yang diketik sebelum redirect tidak dipakai ulang) → kirim `oauth_token` segar → sukses → logout paksa seperti alur lama.
- Penanda dibersihkan saat resume dimulai (tidak ada loop bila halaman di-reload di tengah dialog) dan bila kedaluwarsa.
- Semua label baru lewat `txMsg(id, en)` seperti dialog lama (tidak menambah kunci kamus i18n).

### Yang sengaja TIDAK dilakukan

- Tidak memakai `provider_token` Google (token mentah Google) sebagai bukti: GoTrue bisa me-refresh-nya lewat `provider_refresh_token`, sehingga kesegarannya tidak bisa dijamin dari sisi server; dan memverifikasinya butuh panggilan ke `oauth2.googleapis.com` + `GOOGLE_CLIENT_ID` sebagai secret baru. Klaim `amr` Supabase sendiri sudah cukup dan sudah terbukti di proyek ini.
- Tidak memakai `reauthenticate()` supabase-js: tidak ada jalur OAuth yang bersih untuk itu di klien ini.
- Tidak mengubah `web/delete-account.html` (di luar batas file): halaman itu tetap jalur password + catatan "belum bisa" untuk Google-only — tindak lanjut koordinator.
- Tidak mengubah perilaku akun ber-password sedikit pun — termasuk pesan error dan urutan cek.

## Perubahan yang Diterapkan

_(diisi setelah implementasi)_

## Catatan Migrasi

Tidak ada migrasi database. Tidak ada secret/env baru. Deploy hanya mengunggah ulang `supabase/functions/delete-account/index.ts` (versi function berubah; `verify_jwt` tetap true). Klien baru memanggil field body baru `oauth_token` yang hanya dipahami function baru — urutan deploy yang aman: **function dulu, klien kemudian** (klien lama tidak mengirim `oauth_token`, jadi function baru tetap melayani klien lama tanpa perubahan perilaku).

## Verifikasi

_(diisi setelah implementasi + tes + deploy)_

## Belum Diverifikasi

- Penghapusan akun Google-only end-to-end di perangkat sungguhan (login Google → hapus akun → akun benar-benar hilang) — butuh akun Google-only sungguhan + perangkat Liandi; JANGAN pernah diuji terhadap akun sungguhan dari VM ini.
- `web/delete-account.html` belum diperbarui (di luar batas file): halaman standalone itu tetap meminta password dan tetap menampilkan catatan "belum bisa" untuk Google-only — tindak lanjut koordinator.
- Alur native (Capacitor, `startNativeOAuth` + deep link kembali) belum teruji di perangkat — resume mengandalkan `SIGNED_IN` + `sessionStorage` yang sama; butuh uji manual Liandi.
- Type-check penuh `tsc --noEmit` tidak bisa dipakai di repo ini (import `npm:` + global Deno — catatan Gelombang 5.1); yang dijalankan adalah `scripts/check-syntax.mjs` (strip + kompilasi `vm`).
