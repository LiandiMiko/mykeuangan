# Audit 042 — Gelombang 7b: CSP Diperketat — Eksternalisasi JS Inline (T12) — v3.20.14

- **Tanggal:** 28 November 2026
- **Status:** SELESAI (implementasi + verifikasi independen). PR belum dibuka saat dokumen ini ditulis — lihat catatan rebase di bawah.
- **Branch:** `fix/gelombang-7b-csp` (dari `origin/main 41161f9` — PR #13 Gelombang 7a BELUM merge saat pengerjaan)
- **Commit:** `951c8dc` (rebase koordinator ke main `5eaa3fa`) — kemudian di-amend koordinator untuk menambahkan dokumen audit ini (hash final: lihat `git log fix/gelombang-7b-csp`)
- **Versi:** v3.20.13 → **v3.20.14** (`versionCode` 3020014; urutan koordinator 13 → 14 → 15, PR #14 PBKDF2 adalah v3.20.15)

## Cakupan

Item T12 dari rencana perbaikan: kebijakan Content Security Policy (CSP) aplikasi diperketat dengan menghapus `'unsafe-inline'` dan `'unsafe-eval'` dari `script-src`. CSP sebelumnya tidak bisa diketatkan begitu saja karena arsitektur build meng-inline SEMUA modul `web/*.js` sebagai blok `<script>` di dalam `dist/index.html` — jadi pengetatan ini menuntut restrukturisasi build dulu (eksternalisasi), bukan sekadar mengganti satu baris meta.

Yang disentuh: `build.mjs`, `src/Index.html`, `src/updates.html`, `web/sw.js`, `web/sw-register.js` (baru), `src/i18n.html` (sebagai sumber kamus — tidak diubah isinya), tes terkait, dan file bump versi (`package.json`, `README.md`).

Yang TIDAK disentuh: `web/config.js` (isi tidak diubah — tetap verbatim), logika aplikasi apa pun (tidak ada perubahan perilaku fungsional), Edge Function / migrasi DB (tidak ada), Kantor Paijo.

## Temuan Forensik / Akar Masalah

1. **CSP longgar karena arsitektur build, bukan karena kebutuhan runtime.** CSP lama (`src/Index.html:16`, pra-7b): `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. `'unsafe-inline'` dibutuhkan karena build meng-inline >40 blok `<script>` (semua modul `web/*.js`, `config.js`, kamus I18N, registrasi SW, blok Play CDN `tailwind.config`). `'unsafe-eval'` sebenarnya tidak pernah dibutuhkan kode aplikasi — tidak ada `eval()`/`new Function()` di `src/` + `web/` (dicek `grep` sebelum kerja).
2. **Satu-satunya `new Function` ada di vendor SweetAlert2** — di jalur template deklaratif `<swal-function-param>` yang **tidak pernah dipakai aplikasi** (grep `<swal-` di `src/` + `web/` kosong; aplikasi memakai `Swal.fire(...)` imperatif). Jadi menghapus `'unsafe-eval'` aman — tidak ada code path runtime yang butuh eval. Ini kondisi BERHENTI yang ditetapkan koordinator (bila ada runtime path yang butuh eval, kerja dihentikan) — **tidak terpicu**.
3. **Service Worker mem-precache `index.html` + vendor.** Modul app yang dulu ikut ter-cache lewat `index.html` inline kini menjadi file terpisah — bila tidak masuk precache, PWA offline rusak. Ini blocker yang ditangani di `web/sw.js` (placeholder `__APP_ASSETS__` baru).
4. **Tailwind Play CDN inline** (`tailwind.config` sebagai blok `<script>` inline) adalah satu lagi sumber inline yang harus hilang — diganti `<link>` ke `tailwind.min.css` yang sudah self-hosted di `web/vendor/`.

## Perubahan yang Diterapkan

### 1. `build.mjs` (+108/−~)
- Semua modul `web/*.js` (54 file) kini ditulis build ke `dist/app/*.js` (diminifikasi esbuild, **kecuali `web/config.js` yang tetap verbatim** — isinya tidak disentuh) dan dimuat lewat `<script src="./app/...">` **sinkron, tanpa `defer`/`async`**, dengan urutan yang SAMA PERSIS seperti saat masih di-inline (paritas perilaku: `error-messages.js` pertama, `config.js` di antara UI_CORE dan SUPABASE, `password-policy.js` sebelum consumer-nya, `sw-register.js` paling akhir).
- Kamus I18N (`src/i18n.html`, sumber tetap di sana agar tes i18n tidak berubah) diekstrak build ke `dist/app/i18n-dict.js` dan dimuat di `<head>` sebelum semua modul.
- Blok Play CDN (`tailwind.config` inline) diganti `<link rel="stylesheet" href="./vendor/tailwind.min.css">`; `copyVendorDir` tidak lagi melewati `tailwind.min.css` — file itu kini tersalin ke `dist/vendor/` dan ikut ter-precache.
- Placeholder baru `__APP_ASSETS__` untuk precache SW (seperti `__VENDOR_ASSETS__`).
- Bug saat kerja (diperbaiki sebelum commit): `sw-register.js` sempat ter-emit 2× (branch `features-v35` + include) — kini 1× via include.

### 2. `src/Index.html` (+62/−~)
- **CSP baru** (lihat § Kebijakan CSP Final di bawah): `script-src` kini hanya `'self'` — `'unsafe-inline'` dan `'unsafe-eval'` **DIHAPUS**. Tambahan: `form-action 'self'` + `upgrade-insecure-requests`. `img-src` kehilangan `https:` mentah.
- Komentar CSP ditulis ulang menjadi dokumentasi keputusan (apa yang dihapus, apa yang sengaja dipertahankan dan kenapa).
- Blok registrasi Service Worker yang dulu inline di akhir file pindah ke `web/sw-register.js`.
- Bump versi: meta `app-version` 3.20.14, badge nav `v3.20.14` (kelas `text-xs` dari Gelombang 7a dipertahankan — bukan `text-[11px]` pra-U34).

### 3. `web/sw-register.js` (baru, 34 baris)
- Registrasi Service Worker yang dulu berupa blok `<script>` inline di akhir `src/Index.html`, kini file terpisah yang dimuat paling akhir.

### 4. `web/sw.js` (+1)
- Placeholder `__APP_ASSETS__` — Service Worker mem-precache SEMUA file `dist/app/*.js` (55 file) supaya PWA tetap jalan offline.

### 5. `src/updates.html` (+74/−~)
- Kartu rilis baru v3.20.14 (Terbaru); kartu v3.20.13 menjadi `<details>` riwayat; label "Menampilkan 35 rilis" (33 + 3.20.13 + 3.20.14 — diperbaiki koordinator pasca-rebase; kedua branch sama-sama menghitung 34 sendiri-sendiri).

### 6. Tes — file baru `tests/wave7b-csp-tightening.test.js` (182 baris, 6 tes)
- Meta CSP di `src/Index.html` adalah kebijakan ketat (tanpa `unsafe-inline`/`unsafe-eval` di `script-src`).
- NOL blok `<script>` inline di `dist/index.html`.
- Semua tag `<script src>` menunjuk file yang ada.
- Urutan load modul dipertahankan.
- Tidak ada `eval`/`new Function` di `dist/app/`.
- SW precache memuat file app; build gagal bila modul hilang.

### 7. Tes lama — guard dibalik / ditulis ulang
- `tests/wave2-xss-csp.test.js` (2.4): guard yang dulu mengunci blocker inline dibalik menjadi guard pengetatan.
- `tests/wave3-frontend-cdn-build.test.js` (3.4e/3.4g): 3.4g kini membaca urutan load dari tag `<script src>` di `dist/index.html`.
- `tests/wave5-build-reproducibility.test.js` (5.2d): kini membandingkan total ukuran `dist/app/*.js` minified vs tanpa esbuild dan mengassert nol `<script>` inline.
- `tests/wave5-module-order.test.js`: `pageLoadOrder` diperbarui; 2 tes (`isCapNative`, `showPwaUpdateToast`) pindah mengikuti `web/sw-register.js`.
- `tests/i18n-build.test.js`: asersi `unsafe-eval` diperbarui.
- `tests/android-m3-ui.test.js`, `tests/pro-web-ui.test.js`, `tests/wave-v320-upgrades.test.js`: asersi versi → 3.20.14.

### 8. Bump versi — `package.json`, `README.md`
- `package.json`: 3.20.14 / `versionCode` 3020014.
- `README.md`: header, badge, nama APK, seksi changelog baru (entri 3.20.14 + entri 3.20.13 dari main dipertahankan; catatan "menimpa v3.20.13" diperbaiki koordinator pasca-rebase — semula tertulis "menimpa v3.20.12" karena PR #13 belum merge saat branch dibuat).

## Kebijakan CSP Final

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
img-src 'self' data: blob:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co
  https://generativelanguage.googleapis.com https://liandimiko.github.io
  https://cdn.jsdelivr.net https://api.coingecko.com
  https://latest.currency-api.pages.dev;
worker-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
upgrade-insecure-requests;
```

## Yang Masih Dilonggarkan — dan Kenapa

| Longgar | Alasan (terdokumentasi juga di komentar CSP `src/Index.html`) |
|---|---|
| `style-src` tetap `'unsafe-inline'` | Atribut `style="..."` dipakai di 6 tempat `src/*.html` + banyak template `web/*.js` (string `innerHTML`). Menyapunya adalah churn besar dengan nilai keamanan rendah — injeksi CSS tanpa eksekusi script di browser modern. `<style>` di `src/styles.html` juga tetap inline. |
| `img-src` tetap `blob:` | Object URL runtime (mis. pratinjau dari FileReader). Tidak ada gambar remote — `https:` mentah sudah dihapus. |
| `connect-src` tetap `cdn.jsdelivr.net` | Fetch runtime mata uang di `web/supabase-portfolio.js` memakai URL jsdelivr sebagai sumber utama (fallback: `currency-api.pages.dev`); menghapusnya memblokir sumber itu via CSP. |
| `frame-ancestors` TIDAK ditambahkan | Directive itu diabaikan di meta CSP — butuh header HTTP yang tidak bisa diset di GitHub Pages. |
| `web/delete-account.html` di luar cakupan | Halaman itu tetap memuat config + logika sebagai `<script>` inline — tetapi **tidak punya meta CSP**, jadi tidak rusak oleh pengetatan ini. Pengetatan di sana adalah follow-up terpisah, bukan dikerjakan diam-diam di item ini. |

## Catatan Migrasi Pengguna

Tidak ada. Ini perubahan build semata — tidak ada perubahan skema data, format penyimpanan, atau perilaku fungsional. Update ke v3.20.14 menimpa v3.20.13 tanpa uninstall (`versionCode` 3020014 > 3020013 — monoton). Pengguna tidak perlu melakukan apa pun.

## Verifikasi

### Tes otomatis — PASS
- `node --test` (tanpa argumen path): **509/509 lolos di TZ=Asia/Jakarta DAN 509/509 lolos di TZ=UTC** (baseline pasca-PR #13: 503 + 6 tes baru). Perintah dijalankan koordinator pasca-rebase pada head `951c8dc` (worktree `~/workspace/mykeuangan-7b-csp`, `node_modules` symlink read-only dari repo utama + salinan `web/vendor` — keduanya dihapus sebelum push, sesuai pelajaran PR #12).
- `node scripts/check-syntax.mjs`: **PASS — 99 JS/MJS, 14 TypeScript, 3 skrip inline HTML** (dulu 97/14/4 — berkurang 1 karena blok SW inline hilang; sisa: kamus i18n, `tailwind.config`, skrip delete-account).
- `git diff --check`: bersih.

### Build — PASS
- `node build.mjs`: `dist/index.html` **308 KB** (dulu 993 KB inline) + **55 file di `dist/app/`**; **0 blok `<script>` inline**; **63 tag `<script src>` (55 app + 8 vendor)** — semua menunjuk file yang ada (satu kemunculan `./app/...` di hasil `grep` hanyalah teks di dalam komentar HTML CSP, bukan tag); SW `mykeuangan-3334e05b9302` precache **19 vendor + 55 app**; `version.json` **v3.20.14 / 3020014**.

### Konoha AI-detector — PASS
- `website_ai_detector` pada `src/`: skor **0, "Human-Built", verdict PASS** (13 file, 353.278 bytes, 2026-11-28T09:59:26Z). Dijalankan koordinator pasca-rebase. (aislop MCP tidak tersedia — tidak ada skor yang dikarang.)

### Smoke test runtime — PASS dengan 3 catatan yang sudah diurai (lihat bawah)
- Chromium 159.0.8154.6 headless, CDP mentah + WebSocket Node 24, `dist/` via `python3 -m http.server`, skrip `/tmp/smoke-7b-postrebase.mjs` (profil fresh, pasca-rebase): **0 pelanggaran CSP dan 0 page error** di semua tahap (boot, latihan lib, SW, reload offline). Semua 63 script ter-load; SW ter-register + aktif, precache 55 app + 19 vendor + tailwind (80 entri); **reload OFFLINE tetap menampilkan aplikasi** dengan 55 tag app dari cache. flatpickr terbuka, Chart.js render, jsPDF+autotable menghasilkan 3.668 bytes (sintetis via `Runtime.evaluate`). Satu-satunya request gagal: `favicon.ico` 404 (**pre-existing**, tidak ada favicon di dist).
- Hasil langkah: **15/18 lolos**. Tiga langkah yang gagal BUKAN bug aplikasi — ketiganya diurai sampai tuntas:
  1. **Loader profil-fresh tanpa sesi** (`#appLoader` tetap `display:block` s/d t=21 dtk, `isDataReady=false`, tanpa banner error): **DIBUKTIKAN perilaku pra-7b** — perbandingan baseline v3.20.13 (inline) vs 7b v3.20.14 (eksternal) dengan profil Chrome fresh di kedua sisi, skrip `/tmp/compare-loader-7b.mjs`, hasil **IDENTIK** pada sampling 5/9/15/21 dtk (loader block, isDataReady false, tanpa banner, teks login tampil, 0 pelanggaran CSP, 0 page error). Bukan regresi 7b. (Kenapa loader tidak hilang tanpa sesi tetap pertanyaan UX terpisah — di luar cakupan item ini.)
  2. **`window.I18N` undefined**: artefak probe. Kamus memakai `const I18N` top-level yang menurut semantik JS **tidak** menjadi properti `window` — begitu juga di build lama. Verifikasi definitif (skrip `/tmp/probe-i18n-swal-7b.mjs`, kedua build): `typeof I18N` = object, `I18N.id['nav.utama']` = "Menu Utama", `t('nav.utama')` = "Menu Utama" — **identik** di baseline dan 7b.
  3. **`Swal.fire` gagal `.catch`**: artefak probe. SweetAlert2 11.14.5 mengembalikan thenable khusus (`.then` ada, `.catch` TIDAK). Verifikasi definitif (probe yang sama): modal terbuka dengan judul "Tes CSP 7b" dan tertutup bersih — **identik** di baseline dan 7b. Aplikasi memakai `await` di mana-mana, bukan `.catch`.

### Rebase — catatan koordinator
- PR #13 (Gelombang 7a) merge ke main (`5eaa3fa`) saat pekerja bekerja; pekerja berhenti sesuai instruksi dan tidak membuka PR. Koordinator me-rebase `fix/gelombang-7b-csp` ke `5eaa3fa` (commit baru `951c8dc`, 16 file, +574/−165 — identik dengan commit asli). Konflik 7 file diselesaikan: angka versi → 3.20.14 di mana-mana; kelas U34 `text-xs` dari main dipertahankan (bukan `text-[10px]` pra-U34 dari branch lama); kartu rilis 3.20.13 dipertahankan sebagai `<details>` riwayat di `src/updates.html` dan entri changelog di `README.md`; satu perbaikan susulan: label "Menampilkan 34 rilis" → **"Menampilkan 35 rilis"** (33 + 3.20.13 + 3.20.14). Semua verifikasi di atas dijalankan koordinator **pasca-rebase** pada head final.

## Belum Diverifikasi

- **Interaksi dashboard sesungguhnya** (ganti view, date picker asli, render chart asli, export PDF asli, PIN screen) butuh login Supabase — tanpa kredensial uji tidak bisa dilatih end-to-end di smoke test. Yang terlatih: boot, modal Swal, dan ketiga lib secara sintetis. **Cek manual Liandi di perangkat tetap diperlukan** (juga untuk memastikan update ke v3.20.14 tidak mengubah apa pun yang terlihat).
- **Perilaku loader tanpa sesi** (lihat atas) adalah perilaku pra-7b yang sudah ada — bila Liandi menilai itu masalah, itu item perbaikan tersendiri, bukan bagian dari CSP ini.
- **`web/delete-account.html`** masih inline — pengetatan di sana follow-up terpisah.
- **aislop MCP tidak tersedia** — skor detektor AI lain tidak dicatat.
