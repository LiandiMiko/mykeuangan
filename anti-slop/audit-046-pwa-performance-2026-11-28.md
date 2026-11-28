# Audit Performa PWA — MyKeuGuech v3.20.15 → Perbaikan Gelombang 7d (v3.20.21)

> **Nomor: audit-046** (audit-044 WebAuthn dan audit-045 optimistic locking sudah dipakai Gelombang 7c).
> **Status:** SELESAI — audit read-only di v3.20.15 + ukur ulang baseline di v3.20.20 + perbaikan Gelombang 7d diterapkan (v3.20.21), 2026-11-28.
> **Cakupan:** aplikasi live v3.20.15 di https://liandimiko.github.io/mykeuangan/ + kode main `f3ac380` (merge PR #14) untuk audit awal; ukur ulang baseline di main `ad9ebf46` (v3.20.20, merge PR #20); perbaikan di branch `fix/gelombang-7d-performa` (PR Gelombang 7d, v3.20.21).
> **Draf awal audit ini** disimpan di `~/workspace/your_files/audit-performa-pwa-v3-20-15/`; versi repo ini adalah versi final yang diperbarui dengan hasil ukur ulang + perbaikan.

## Ringkasan eksekutif

Aplikasi **sehat di jaringan cepat, lambat di jaringan seluler pelan**. Di jaringan cepat, halaman pertama tampil dalam ~0,9 detik dan tidak ada tugas berat yang memblokir. Tetapi muat pertama membawa **2,35 MB (73 permintaan)** dan semuanya dimuat serentak sebelum layar pertama selesai — begitu jaringan melambat ke 4G pelan, waktu muat membengkak menjadi **21,4 detik** (terukur). Muat ulang pun tidak lebih cepat dari muat pertama (tetap ~0,9 detik) padahal tidak ada byte yang diunduh: biayanya ada di **parse + eksekusi 1,66 MB JavaScript** yang diulang setiap kali buka.

Kabar baiknya: service worker bekerja dengan benar (offline menampilkan aplikasi dalam 0,15 detik), tidak ada permintaan gagal, dan tidak ada long task saat buka aplikasi. Temuan terbesar semuanya soal **apa yang dimuat di awal dan kapan dimuat** — bukan soal bug.

**Tiga perbaikan berdampak terbesar:** (1) muat malas (lazy-load) pustaka berat yang hanya dipakai di layar tertentu (jsPDF, Chart, flatpickr — 710 KB); (2) kurangi skrip sinkron yang memblokir (61 tag `<script>` tanpa `defer`/`async`); (3) pangkas CSS ikon Phosphor (249 KB, 93% CSS tidak terpakai di layar awal).

## Cara mengukur (jujur soal keterbatasan)

- **Browser sungguhan:** Chromium 159 headless (Playwright, `~/.cache/ms-playwright/chromium-1255`), viewport ponsel 390×844. Diukur: cold load (profil segar), warm reload, reload offline, dan cold load dengan emulasi Slow 4G (1,6 Mbps, RTT 150 ms). Setiap skenario dijalankan 2–3 kali; angka di bawah adalah hasil ukur, bukan perkiraan.
- **Salinan lokal yang identik byte-demi-byte:** Chromium di sandbox ini **tidak bisa menembus proxy egress** ke `liandimiko.github.io` (dua varian proxy dicoba, keduanya `ERR_TUNNEL_CONNECTION_FAILED`, termasuk untuk `example.com`). Karena itu pengukuran browser dilakukan terhadap `dist/` hasil build dari `origin/main f3ac380` yang disajikan lewat `http://127.0.0.1:8901/`. Bukti identik: `dist/index.html` lokal **319.891 byte — sama persis** dengan `index.html` live (curl). Ukuran transfer live (gzip) diukur terpisah dengan curl ke situs live.
- **Yang TIDAK bisa diukur di sini:** skor Lighthouse (tidak terinstal di lingkungan ini); waktu muat di HP sungguhan (CPU VM ≠ CPU HP — semua angka milidetik di bawah relatif terhadap VM; HP kelas menengah kemungkinan 2–4× lebih lambat pada tahap parse); muat dashboard setelah login (tidak ada sesi — yang terukur adalah layar awal/login); ukuran IndexedDB/localStorage pengguna sungguhan (yang terukur hanya profil segar).
- **Cakupan JS (coverage):** tidak dapat diukur secara bermakna dengan metode ini — setiap modul menjalankan scope tingkat atasnya saat dimuat, sehingga metrik coverage fungsi melaporkan 100% "terpakai" untuk semua file. Temuan lazy-load di bawah didasarkan pada timing permintaan + referensi kode, bukan pada coverage.
- **Perbandingan v3.20.9:** diambil dari bundle persis yang dikirim — isi `assets/public/` APK v3.20.9 (`~/workspace/apk-v3209/MyKeuGuech-v3.20.9-debug.apk`), bukan dari ingatan.

## Temuan

### P1 — TINGGI — Muat pertama 21,4 detik di Slow 4G

**Bukti:**
- Cold load localhost (tanpa throttling): `domContentLoaded` 754–914 ms, `load` 757–916 ms, LCP 400–520 ms (3 kali jalan).
- Cold load emulasi Slow 4G (1,6 Mbps, RTT 150 ms): `domContentLoaded` **21,4 detik**, `load` **21,4 detik**, **LCP 8,0 detik**. `responseEnd` index.html saja 3.961 ms.
- Total yang diunduh saat pertama buka: **73 permintaan, 2.354.352 byte transfer (2.332.452 byte decoded)** + navigasi `index.html` 320.191 byte → **~2,65 MB tanpa kompresi**. Dengan gzip live, totalnya **~838 KB** (489.709 byte aset teks terkompresi + 345.876 byte font yang tidak bisa dikompresi + ~2 KB `sw.js`).
- Penyebabnya terukur: 73 permintaan × RTT 150 ms dengan batas ~6 koneksi per host + 2,35 MB yang harus lewat pipa 1,6 Mbps (teoritis minimal ~11,7 detik untuk byte-nya saja).

**Dampak:** pengguna dengan sinyal seluler biasa (bukan Wi-Fi) menunggu >20 detik sebelum aplikasi bisa dipakai. Di jaringan cepat masalah ini tidak terasa, tapi mayoritas pengguna HP Indonesia tidak selalu di Wi-Fi.

**Usulan perbaikan (perkiraan dampak):**
1. Lazy-load pustaka berat (lihat P2) — memangkas ~710 KB dari jalur muat pertama; di Slow 4G itu ~4–5 detik lebih cepat.
2. `preload` untuk aset kritis + `defer` untuk skrip non-kritis (lihat P4) — LCP bisa turun beberapa detik di jaringan pelan.
3. Pertimbangkan `content-encoding` Brotli di GitHub Pages — tidak bisa (GitHub Pages hanya gzip); alternatifnya adalah memangkas byte, bukan mengandalkan kompresi.

### P2 — TINGGI — Pustaka berat dimuat di awal padahal hanya dipakai di layar tertentu

**Bukti (dari daftar permintaan + kode):**
- `jspdf.umd.min.js` **420.165 byte** + `jspdf.plugin.autotable.min.js` 32.791 byte — hanya dipakai ekspor PDF (`web/ui-export.js`). Tidak ada di tag `<script>` statis; disuntikkan JS saat boot (terukur mulai diunduh pada **110 ms**, selesai 148 ms — masih di jalur muat pertama).
- `chart.umd.min.js` **205.749 byte** — hanya dipakai layar grafik (`web/ui-feat-charts.js`), tapi dimuat lewat tag statis di awal.
- `flatpickr.min.js` 50.679 byte + `flatpickr-id.js` + CSS-nya — hanya dipakai pemilih tanggal.
- Total ketiganya: **~710 KB (30% dari semua byte yang diunduh saat buka)** — semuanya tidak dibutuhkan untuk menampilkan layar awal.
- Sebaliknya, `supabase.js` 221.417 byte memang dibutuhkan sejak awal (autentikasi + data).

**Usulan perbaikan:** muat `jspdf`/`autotable`/`chart`/`flatpickr` secara dinamis hanya saat fitur yang memakainya dibuka (pola `import()` atau suntik `<script>` di dalam handler, bukan saat boot). Perkiraan dampak: muat pertama berkurang ~710 KB decoded (~230 KB setelah gzip — jsPDF 133.639 byte + Chart 70.460 byte terkompresi) dan puluhan milidetik waktu parse; di Slow 4G hemat ~3,5 detik waktu transfer pada skenario tanpa gzip yang terukur di sini, dan ~1–2 detik + waktu parse pada live yang memakai gzip. Risiko rendah — ketiganya sudah terisolasi di modul fitur masing-masing. **Mungkin basi setelah 7c:** tidak — 7c tidak menyentuh pemuatan pustaka ini.

### P3 — TINGGI — Muat ulang sama lambatnya dengan muat pertama (biaya parse, bukan jaringan)

**Bukti:**
- Warm reload (profil sama, SW + cache sudah ada): **transfer 0 byte** (semua 73 aset dari cache SW), tetapi `domContentLoaded` **914 ms** dan `load` **916 ms** — sama dengan cold load (838–908 ms). LCP warm reload malah 1.064 ms (vs 400–520 ms saat cold) — loader menunggu pengecekan sesi.
- Artinya: setelah cache bekerja sempurna pun, setiap buka aplikasi tetap membayar ~0,9 detik untuk **parse + eksekusi 1,66 MB JavaScript + 320 KB HTML**. 61 tag `<script>` sinkron dieksekusi berurutan setiap kali.
- 0 long task terukur saat buka (tidak ada satu tugas >50 ms) — biayanya tersebar dalam banyak tugas kecil, bukan satu gumpalan.

**Usulan perbaikan:** `defer`/`async` untuk modul yang tidak dibutuhkan sebelum first paint; pecah modul per layar (code-splitting) sehingga layar awal hanya memuat yang dibutuhkannya; pertimbangkan menggabungkan 55 file `dist/app/` menjadi beberapa bundel (mengurangi 55× overhead parse + evaluasi per file). Perkiraan dampak: warm reload bisa turun ke ~0,3–0,5 detik di VM ini. **Mungkin basi setelah 7c:** angka pastinya bisa bergeser (WebAuthn menambah modul login), tetapi struktur masalahnya tetap.

### P4 — SEDANG — 61 skrip sinkron memblokir parser, tanpa `defer`/`async`/`preload`

**Bukti:**
- `dist/index.html` memuat **61 tag `<script src>` sinkron** (55 `app/*.js` + 6 vendor) — **0 `defer`, 0 `async`, 0 `preload`** di seluruh halaman. (Satu "tag" ke-62 yang sempat terlihat — `<script src="./app/...">` — ternyata hanya teks di dalam komentar HTML, bukan tag sungguhan.)
- Semua skrip dieksekusi berurutan sebelum `DOMContentLoaded`; CSS juga render-blocking (7 stylesheet).
- `version.json` **tidak** diambil saat boot (0 permintaan `fetch` saat muat) — bagus, tidak menambah penundaan.

**Usulan perbaikan:** tandai skrip non-kritis dengan `defer` (urutan tetap terjaga); `preload` untuk `tailwind.min.css` + `supabase.js` + font Inter; `preconnect` tidak relevan (semua aset same-origin). Perkiraan dampak: first paint lebih awal, LCP turun. Risiko: `defer` mengubah urutan eksekusi relatif terhadap skrip inline — tidak ada skrip inline lagi pasca-7b, jadi risikonya kecil; tetap perlu smoke test.

### P5 — SEDANG — 93% CSS tidak terpakai di layar awal

**Bukti (CSS coverage Chromium, layar awal/login):**
- Total CSS: **358.136 byte, hanya 23.964 byte (7%) terpakai** — **334.172 byte (93%) tidak terpakai**.
- Per file: `phosphor/fill/style.css` 85.656 byte → **0 byte terpakai**; `phosphor/bold/style.css` 85.656 → 849 byte; `phosphor/regular/style.css` 77.986 → 2.408 byte; `tailwind.min.css` 60.110 → 16.366 byte (27%); `flatpickr.min.css` 16.166 → 0 byte; `monthSelect-style.css` 2.822 → 0 byte; `<style>` inline 29.570 → 4.341 byte.
- **Catatan jujur:** ini diukur di layar awal saja. Layar lain (dashboard, laporan, dsb.) memakai lebih banyak class Tailwind dan ikon — angka 93% adalah **batas atas**, bukan pemborosan murni. Tetapi 249 KB CSS ikon Phosphor (tiga file @font-face + ribuan definisi class ikon) tetap dominan dan sebagian besar ikon tidak pernah tampil di layar mana pun dalam satu sesi.

**Usulan perbaikan:** subset font ikon Phosphor hanya ke ikon yang benar-benar dipakai (atau ganti ke SVG inline untuk ikon yang sering tampil); purge Tailwind per layar atau terima 60 KB-nya (sudah kecil setelah gzip: 10.620 byte); muat CSS flatpickr/monthSelect bersama JS-nya secara malas (lihat P2). Perkiraan dampak: ~250 KB CSS tidak lagi diunduh di awal (~15 KB setelah gzip — kecil) tetapi waktu parse CSS dan jumlah permintaan berkurang. **Mungkin basi setelah 7c:** sebagian — WebAuthn (#16) dan CSV picker (#19) menambah layar baru yang memakai class Tailwind/ikon tambahan; hitung ulang coverage setelah 7c.

### P6 — SEDANG — Font 346 KB di layar pertama; Phosphor memakai `font-display: block`

**Bukti:**
- Tiga font woff2 diunduh saat pertama buka: Inter 48.444 byte + Phosphor Regular 147.380 byte + Phosphor Bold 150.052 byte = **345.876 byte** (tidak bisa dikompresi lebih lanjut — woff2 sudah terkompresi).
- **Phosphor-Fill (131.744 byte) TIDAK diunduh di layar awal** (`document.fonts` status `unloaded`) — bagus, hemat 132 KB; font ini baru diunduh saat ikon fill pertama kali tampil.
- `font-display: swap` untuk Inter (bagus), tetapi **ketiga file Phosphor memakai `font-display: block`** — ikon tidak tampil sama sekali sampai font selesai diunduh (blokir hingga 3 detik di jaringan pelan), lalu muncul serentak.
- Tidak ada `preload` font.

**Usulan perbaikan:** ubah Phosphor ke `font-display: swap` (ikon tampil sebagai kotak kosong sebentar, lalu terganti — lebih baik daripada layar tanpa ikon selama 3 detik); `preload` Inter + satu bobot Phosphor yang paling dipakai; subset Phosphor ke glif yang dipakai. Perkiraan dampak: menghilangkan jeda ikon-hilang di jaringan pelan; hemat ~130 KB bila fill tidak pernah dipakai dalam sesi. **Mungkin basi setelah 7c:** tidak — 7c tidak mengubah font.

### P7 — RENDAH — Semua aset `Cache-Control: max-age=600`, tanpa `immutable`

**Bukti (header live, curl):** `index.html`, `vendor/supabase.js`, `app/*.js`, `tailwind.min.css`, `*.woff2`, `sw.js`, `manifest.webmanifest` — semuanya `Cache-Control: max-age=600` (10 menit) + ETag, tanpa `immutable`. GitHub Pages tidak mengizinkan pengaturan header kustom.
**Dampak nyata kecil:** service worker sudah menutupi — aset non-HTML disajikan dari cache (stale-while-revalidate) dan HTML network-first. Kunjungan ulang setelah 10 menit hanya melakukan revalidasi ETag (304) di latar belakang, bukan unduh ulang.
**Usulan:** tidak ada yang bisa diubah di sisi GitHub Pages; pastikan SW tetap menjadi garis pertahanan (sudah). Bila suatu hari pindah hosting, beri `immutable` pada `vendor/*` dan `app/*` yang namanya mengandung hash/konten stabil.

### P8 — RENDAH — `index.html` masih 320 KB (4.627 baris, 34 KB `<style>` inline)

**Bukti:** `dist/index.html` 319.891 byte, 4.627 baris, 1.609 atribut `class`, 3 blok `<style>` (total ~34 KB), 1 tag `<img>`, 6 URI `data:`. Setelah gzip hanya **54.995 byte** — transfernya tidak masalah; biayanya ada di parse HTML.
**Usulan:** bukan prioritas. Bila P3 dikerjakan (code-splitting), ukuran HTML ikut mengecil dengan sendirinya karena sebagian markup bisa dimuat per layar.

### P9 — INFO (baik) — Service worker bekerja dengan benar

**Bukti:**
- SW aktif (`state: activated`, `controller: true`) setelah cold load + 4 detik.
- Precache **tepat 80 entri** (6 shell: `./`, `index.html`, manifest, 3 ikon + 19 vendor + 55 app) = **3.114.569 byte** di cache `mykeuangan-66e0d8cdbfb3`. Verifikasi terhadap build nyata: jumlah entri dan isi daftar precache cocok dengan klaim build (`19 vendor assets, 55 app assets`).
- Strategi (dibaca dari `sw.js`): navigasi HTML **network-first** + fallback cache; aset lain **stale-while-revalidate**; host API (supabase.co, generativelanguage, coingecko, currency-api, `version.json`) **tidak** melewati SW; batas runtime 200 entri (tertua dihapus dulu) + tidak mengisi cache bila pemakaian >80% kuota.
- **Reload offline: 150 ms**, shell aplikasi tampil lengkap (judul, menu utama, `v3.20.15`, 1.144 karakter teks) — hanya loader yang tetap menunggu sesi (wajar tanpa login).
- Penyimpanan: kuota ~10 GB, pemakaian ~6,6 MB (cache dilaporkan browser 6.521.007 byte — sekitar 2× jumlah badan entri 3.114.569 byte; ini angka akuntansi browser, dicatat apa adanya). IndexedDB `mykeuangan_offline_db` v3: 3 store (kunci PIN, snapshot, antrean offline ber-`localId`), 73.728 byte pada profil segar. localStorage: 1 key, 5 byte (profil segar, belum login).
- **0 permintaan gagal** selama semua skenario.

### P10 — INFO (baik) — Tidak ada long task; LCP bagus di jaringan cepat

**Bukti:** 0 long task (>50 ms) di semua skenario muat; LCP 400–520 ms (cold, jaringan cepat); tidak ada gambar besar yang memblokir (hanya 1 tag `<img>`, ikon PNG total ~10 KB).

## Perbandingan dengan v3.20.9

| | v3.20.9 (dari APK) | v3.20.15 (terukur) |
|---|---|---|
| `index.html` | 969.870 byte (semua JS inline) | **319.891 byte** (−67%) |
| `dist/app/*.js` | tidak ada (JS di dalam HTML) | 55 file, 640.940 byte |
| `vendor/*` | 1.763.146 byte (tanpa Tailwind lokal — dulu CDN Play) | 1.823.256 byte (termasuk `tailwind.min.css` 60.110 byte) |
| Total dist / `assets/public` | 2.772.977 byte | 2.825.541 byte (+52.564 byte ≈ Tailwind lokal + SW yang membesar) |
| Perkiraan byte decoded saat pertama buka | ~2.603.168 byte (tanpa skrip CDN Tailwind) | **2.652.343 byte** (terukur) |
| Struktur | satu HTML raksasa | HTML + 55 file app + 19 vendor (cache terpisah) |

**Kesimpulan perbandingan:** total byte saat pertama buka **praktis tidak berubah** (+~2%). Kemenangan Gelombang 7b bersifat struktural, bukan ukuran: HTML bisa di-cache terpisah dari JS, perubahan kecil pada satu modul tidak lagi membatalkan cache seluruh 970 KB HTML, dan CSP bisa diperketat. Penghematan byte yang sesungguhnya harus datang dari lazy-load (P2) dan pemangkasan CSS/font (P5–P6), bukan dari eksternalisasi.

## Ukur ulang baseline di v3.20.20 (sebelum perbaikan 7d)

Audit di atas diukur di v3.20.15. Sebelum mengubah apa pun, angka kunci diukur ulang di build v3.20.20 (main `ad9ebf46`, PR #20) dengan skrip ukur yang sama (`measure.mjs`, Chromium 159 headless, viewport 390×844, salinan lokal byte-identik — `dist/index.html` 339.650 byte). Log lengkap: `~/workspace/7d-work/baseline-v32020.log`.

| Metrik | v3.20.15 (audit) | v3.20.20 (baseline) | Penilaian |
|---|---|---|---|
| Cold load DCL / load | 754–914 / 757–916 ms | 1.318 / 1.328 ms | Lebih lambat — konsisten dengan kode tambahan 7c (WebAuthn, locking, dsb.); juga ada variasi antar-jalan di VM |
| Cold LCP | 400–520 ms | 592 ms | Sama orde |
| Permintaan / transfer cold | 73 / 2.354.352 B | 74 / 2.401.544 B | Praktis sama (+1 file app dari 7c) |
| CSS tak terpakai | 334.172 B (93%) | 334.172 B (93%), total 358.136 B | **IDENTIK** — P5 TIDAK basi |
| Warm reload DCL / load | 914 / 916 ms | 991 / 993 ms, transfer 0 B | Masih ~1 detik — P3 TIDAK basi |
| Offline reload | 150 ms | 509 ms (shell tampil, v3.20.20) | Lebih lambat dari audit, tetap cepat |
| Slow 4G DCL / load | 21,4 dtk | 21.837 ms | Sama — P1 TIDAK basi |
| Slow 4G LCP | 8,0 dtk | 8.116 ms | Sama |
| SW precache | 80 entri / 3.114.569 B | 81 entri / 3.200.979 B | +1 file app dari 7c |
| Long task / request gagal | 0 / 0 | 0 / 0 | Sama |

**Kesimpulan ukur ulang:** kedua temuan yang ditandai "mungkin basi setelah 7c" **tetap berlaku** — P3 (warm reload ~1 detik) dan P5 (CSS tak terpakai 93%, angka persis sama) tidak berubah oleh 7c. Semua temuan P1–P6 masih berlaku di v3.20.20; tidak ada masalah yang diperbaiki yang sudah tidak ada.

**Inventaris ikon (untuk subset Phosphor, P5/P6):** 100 nama ikon statis `ph-<nama>` di src/*.html + web/*.js (bobot regular 89, bold 8, fill 1); ditambah nama dinamis yang tidak tertangkap grep statis — `resolveAssetPresentation` (currency-btc, currency-dollar, chart-line-up, bank, coins), utang/piutang (user-circle, device-mobile, hand-coins), menu cepat akun bold (minus-circle, plus-circle, camera, arrows-left-right), status anggaran (warning-circle, warning, check-circle), histori kosong (tray-arrow-down, tray-arrow-up), recurring (pause, play), dompet (money, device-mobile, bank), lihat password (eye, eye-slash), `ph-magic-wand` (ui-pro-palette.js), dan pola dinamis `ph-caret-${...}` (caret-up, caret-down, ui-budget.js).

## Perbaikan Gelombang 7d (v3.20.21) — yang diterapkan dan hasil ukurnya

Perbaikan mengikuti urutan yang diusulkan audit. Satu tema per commit (branch `fix/gelombang-7d-performa`):

**Commit 1 — lazy-load jsPDF/autotable/Chart/flatpickr (P2).** Modul baru `web/lazy-vendors.js`: `ensureJsPdf()` / `ensureChart()` / `ensureFlatpickr()` — menyuntik `<script>`/`<link>` same-origin dari `./vendor/` (tetap ter-precache SW → tersedia offline, instan dari cache saat kunjungan ulang), SRI sama dengan tag statis lama, satu promise per file, gagal → entri dihapus supaya bisa dicoba ulang. 8 tag berat dihapus dari `src/styles.html` (sweetalert2 tetap). Konsumen diperbarui: `web/ui-export.js` (`exportPDF` kini async — tampilkan Swal "Memuat modul PDF…" lalu `ensureJsPdf()`, gagal → pesan ramah; body dibungkus try/catch), `web/ui-assets.js` (`renderPortfolioChart` menggambar setelah `ensureChart()`, gagal → canvas disembunyikan, placeholder kembali), `web/ui-feat-charts.js` (render ulang setelah `ensureChart()`), `web/ui-shell.js` (`initPickersAndControls` tidak lagi memanggil flatpickr langsung — `attachLazyPicker` memasang listener focus/pointerdown sekali-pakai yang memuat flatpickr lalu init + `.open()`; sebelum init, kolom tetap input teks biasa yang bisa diketik).

**Commit 2 — defer semua modul app + preload aset kritis (P4).** `build.mjs` `emitAppScript` kini mengeluarkan `<script defer src="./app/...">` (57 tag) — unduhan paralel dengan parsing, eksekusi tetap BERURUTAN (defer menjaga urutan dokumen) sebelum DOMContentLoaded. **Pengecualian yang ditemukan saat implementasi dan dicatat:** tag `supabase.js` SENGAJA tetap sinkron — `web/delete-account.html` baris 65–82 memanggil `window.supabase.createClient(...)` dari skrip inline saat parse; bila tag itu di-defer, halaman hapus-akun rusak. `src/styles.html` mendapat 3 preload: `supabase.js` (as=script), `tailwind.min.css` (as=style), font Inter (as=font). Tes yang membaca urutan tag (3.4g, wave5, 7b-c) diperbarui: 7b-c kini MENUNTUT defer di semua tag app + melarang async (bukan melarang defer).

**Commit 3 — subset Phosphor + `font-display: swap` (P5, P6).** Skrip generator baru `scripts/subset-phosphor.mjs` (dev-time saja, dijalankan manual): memindai src/ + web/ (termasuk pola dinamis `ph-<awalan>-${...}` dan daftar eksplisit `DYNAMIC_ICONS`), memangkas tiap bobot dengan `fontTools.subset`, menulis `web/phosphor-subset/{regular,bold,fill}/` (ter-commit — CI tidak butuh fontTools). Hasil: regular 102 ikon (woff2 147.380 → 11.864 byte, −92%), bold 18 ikon (150.052 → 3.188 byte, −98%), fill 8 ikon (131.744 → 2.000 byte, −98%); total woff2 429.176 → 17.052 byte (−96%); CSS ikon 249 KB → ~7 KB total; `font-display: block` → `swap`. `build.mjs`: link Phosphor di dist kini ke subset; file Phosphor lengkap TIDAK disalin ke dist/ (tetap diverifikasi sebagai sumber subset); subset ikut ter-precache SW. File vendor TIDAK disentuh (hash-pin di `VENDOR_MANIFEST` tetap berlaku).

**Commit 4 — tes penjaga performa.** File baru `tests/wave7d-performa.test.js` (10 tes): loader di vm sandbox (SRI benar, sekali saja, jalur cepat, gagal bisa dicoba ulang); dist tanpa tag lib berat; semua tag app defer + jumlah = file dist/app + i18n-dict pertama + sw-register terakhir; 3 preload; dist memakai subset + woff2 < 25% aslinya + `font-display: swap`; SETIAP ikon yang dirujuk kode ada di subset CSS (dihitung ulang via `collectUsedIcons()` + jaring pengaman token mentah); SW precache memuat file lazy-vendor + subset. **Perbaikan tes lama yang ikut pecah:** tes 4.2 menuntut `'error-messages.js'` LANGSUNG diikuti `'native-bridge.js'` di `WEB_MODULES` — asumsi itu pecah sejak commit 1 menyisipkan `lazy-vendors.js` sebagai modul kedua (error-messages.js tetap pertama). Tes kini menegaskan invarian yang sebenarnya (pertama + kedua). Total suite: **626 tes (616 baseline v3.20.20 + 10 baru), lolos 626/626 di WIB DAN UTC**; `node scripts/check-syntax.mjs` lolos; `git diff --check` bersih.

### Hasil ukur SESUDAH perbaikan (metode sama, 2 kali jalan)

| Metrik | Baseline v3.20.20 | Sesudah run 1 | Sesudah run 2 | Perubahan |
|---|---|---|---|---|
| Cold load DCL / load | 1.318 / 1.328 ms | 1.212 / 1.236 ms | ~640 ms wall | Lebih cepat (angka VM berisik) |
| Cold LCP (jaringan cepat) | 592 ms | 1.356 ms | 468 ms | **Berisik — lihat catatan jujur di bawah** |
| Permintaan cold | 74 | 67 | 67 | −7 |
| Transfer cold | 2.401.544 B | 1.138.676 B | 1.138.676 B | **−53% (−1,26 MB)** |
| Script transfer | 1.724.102 B | 780.600 B | 780.600 B | −55% (jsPDF/Chart/flatpickr hilang dari jalur awal) |
| CSS transfer | 346.776 B | 15.652 B | 15.652 B | **−95%** |
| CSS tak terpakai | 334.172 B (93%) | 76.051 B (76%) | 76.051 B (76%) | −258 KB (sisa terbesar: Tailwind 60 KB) |
| Warm reload wall / DCL | 1.010 / 991 ms | 600 / 585 ms | 402 ms | **−41% s.d. −60%** |
| Warm LCP | 1.124 ms | 724 ms | 524 ms | −36% s.d. −53% |
| Offline reload wall | 509 ms | 353 ms | 112 ms | Lebih cepat |
| **Slow 4G wall / DCL** | **21.837 / 21.830 ms** | **7.574 / 7.570 ms** | **7.575 ms** | **−65% (21,8 dtk → 7,6 dtk)** |
| **Slow 4G LCP** | **8.116 ms** | **2.724 ms** | **2.700 ms** | **−67% (8,1 dtk → 2,7 dtk)** |
| SW precache | 81 entri / 3.200.979 B | 82 entri / 2.554.312 B | 82 entri | +1 entri, −647 KB |
| Long task / request gagal | 0 / 0 | 0 / 0 | 0 / 0 | Sama |
| `dist/index.html` | 339.650 byte | 339.737 byte | — | Praktis sama (+87 byte: 3 preload, −6 tag skrip) |

Log lengkap: `~/workspace/7d-work/after-v32021.log` (run 1), `~/workspace/7d-work/after-v32021-run2.log` (run 2).

**Catatan jujur soal LCP jaringan cepat:** LCP cold di jaringan cepat BERISIK di VM ini — 592 ms (baseline), 1.356 ms (run 1 sesudah), 468 ms (run 2 sesudah), 388 ms (ulangan ketiga). Rentang sesudah (388–1.356 ms) tumpang tindih dengan baseline, jadi **tidak ada kesimpulan bahwa defer memperburuk LCP**; probe elemen LCP (`~/workspace/7d-work/lcp-probe.mjs`) menunjukkan LCP-nya adalah teks dashboard ("Kelola arus kas, dompet, dan portofolio Anda") yang ter-paint 312–576 ms pada jalan yang cepat — waktunya mengikuti beban CPU VM saat itu, bukan defer. Angka yang stabil dan penting adalah Slow 4G (7.574 vs 7.575 ms — praktis identik antar-jalan) dan transfer (−53%, deterministik).

### Verifikasi tambahan di Chromium asli

- **Subset ikon:** `document.fonts.load()` + `check()` untuk 128/128 ikon subset lolos; 42 ikon terlihat di layar awal, 0 tak terlihat; 0 pageerror (`~/workspace/7d-work/subset-check.mjs`).
- **Lazy-load end-to-end:** boot bersih (dashboard tampil, 0 console error, 0 request gagal); SEBELUM dipakai, `window.Chart` / `window.jspdf` / `window.flatpickr` semuanya `undefined` (bukti ketiganya tidak lagi di jalur awal); setelah `ensureChart()` → `Chart` ada + `Chart.defaults.font.family` diterapkan; setelah `ensureJsPdf()` → `jsPDF` ada + `autoTable` ada; setelah `ensureFlatpickr()` → `flatpickr` + `monthSelectPlugin` ada (`~/workspace/7d-work/smoke-lazy.mjs`).
- **CSP 7b utuh:** `script-src 'self'` tanpa `unsafe-inline`/`unsafe-eval` — lazy-load hanya menyuntik file same-origin dari `./vendor/`; tidak ada CDN baru; `web/config.js` tidak disentuh; tidak ada migrasi/fungsi Supabase yang disentuh.
- **Konoha `website_ai_detector` di src/: skor 0 = Human-Built, PASS** — 13 file, 386.760 byte, dipindai 2026-11-28T13:02:02Z via `konoha_mcp.py call-tool website_ai_detector` pada worktree 7d (src/ sudah berisi kartu rilis v3.20.21). Tidak ada temuan.

### Yang TIDAK dikerjakan di Gelombang 7d (tindak lanjut, dicatat jujur)

- **Code-splitting per layar / gabung 55 file app (P3, usulan 5): TIDAK dikerjakan.** Modul-modul klasik berkomunikasi lewat global dan urutan load-nya dikunci banyak tes; pemecahan per layar berisiko merusak perilaku dan butuh desain terpisah. Setelah (1)–(4), warm reload sudah 402–600 ms (dari 1.010 ms) — cukup untuk gelombang ini. Bila suatu hari warm reload masih dirasa lambat di HP, kerjakan sebagai gelombang tersendiri dengan desain bundel yang aman.
- **Purge Tailwind (sisa CSS tak terpakai 76 KB, sebagian besar Tailwind 60 KB): TIDAK dikerjakan.** Butuh PurgeCSS di `build:css`; 60 KB → ~10 KB setelah gzip, dampaknya kecil dibanding risiko class yang terlewat purge (class dinamis dari JS). Dicatat sebagai tindak lanjut.
- **`<style>` inline 34 KB di `index.html` (P8): TIDAK dikerjakan.** Bukan prioritas; transfernya kecil setelah gzip (55 KB) dan biayanya parse — pemindahan ke file eksternal berisiko mengubah urutan render. `dist/index.html` praktis sama besarnya (339.737 vs 339.650 byte).
- **P7 (Cache-Control `max-age=600` tanpa `immutable`): TIDAK BISA diubah** — GitHub Pages tidak mengizinkan header kustom; SW tetap menjadi garis pertahanan (terbukti: warm reload transfer 0 byte, offline reload 112–353 ms).
- **Alur pemilih tanggal end-to-end di browser (klik kolom → kalender terbuka): BELUM terverifikasi live di sandbox.** Penyebabnya BUKAN 7d: tanpa sesi login, `bootAuth` memanggil `showLogin()` dan `core.ready` tidak pernah resolve, sehingga `loadInitialAppData` → `finishReadyUiState()` → `initPickersAndControls()` tidak pernah jalan — perilaku yang sama persis di v3.20.20 (pra-7d). Upaya seed snapshot offline IndexedDB juga tidak mencapai boot penuh karena `callServer` menggantung menunggu `core.ready` (request Supabase tidak pernah keluar dari sandbox — proxy egress menahan koneksi tanpa gagal). Yang TERBUKTI live: mekanisme lazy-load flatpickr (global muncul setelah `ensureFlatpickr()`), wiring `attachLazyPicker` (kode + tes vm), dan kedua ID kolom (`tr_tanggal`, `dashMonthPicker`) ada di DOM. **Cek manual di perangkat Liandi (sudah login) tetap diperlukan** — ada di checklist tes manual v3.20.21: buka form transaksi → sentuh kolom tanggal → kalender terbuka; ubah periode di dashboard → pemilih bulan terbuka; ekspor PDF; grafik portofolio/anggaran tampil.

## Yang belum terverifikasi

- Skor Lighthouse (tidak terinstal di lingkungan ini — perlu dijalankan di mesin dengan Lighthouse/Chrome DevTools).
- Waktu muat di HP sungguhan kelas menengah (angka milidetik di atas relatif terhadap CPU VM; perkiraan kasar: 2–4× lebih lambat pada tahap parse). Perkiraan dampak di HP: Slow 4G 7,6 dtk di VM bisa menjadi ~15–20 dtk di HP kelas menengah — tetap jauh lebih baik dari ~40+ dtk sebelum perbaikan.
- Muat dashboard setelah login + ukuran IndexedDB/localStorage pengguna sungguhan (butuh sesi nyata; tidak bisa diukur agen).
- Alur pemilih tanggal end-to-end live (lihat catatan di atas) + ekspor PDF lewat tombol UI + grafik dashboard setelah login — perlu cek manual di perangkat Liandi.
- ~~Angka pasti setelah Gelombang 7c~~ — SUDAH diukur ulang di v3.20.20 (lihat tabel di atas); P3 dan P5 terbukti tetap berlaku.

## Usulan urutan perbaikan (untuk PR 7d, setelah 7c selesai)

1. **Lazy-load jsPDF + autotable + Chart + flatpickr** (P2) — dampak terbesar di jaringan pelan, risiko rendah. ✅ DIKERJAKAN (commit 1) — transfer cold −53%, Slow 4G 21,8 dtk → 7,6 dtk.
2. **`defer` untuk modul non-kritis + `preload` aset kritis** (P4) — murah, risiko kecil (perlu smoke test karena urutan eksekusi berubah). ✅ DIKERJAKAN (commit 2) — 57 tag app defer, 3 preload; `supabase.js` tetap sinkron karena `delete-account.html` (lihat catatan commit 2).
3. **Subset Phosphor + `font-display: swap`** (P5, P6) — hemat byte dan hilangkan jeda ikon-hilang. ✅ DIKERJAKAN (commit 3) — woff2 −96%, CSS ikon 249 KB → ~7 KB, `font-display: swap`.
4. **Pangkas CSS yang tidak terpakai / muat CSS fitur bersama JS-nya** (P5) — setelah (1). ✅ SEBAGIAN — CSS flatpickr/monthSelect kini dimuat malas bersama JS-nya (commit 1); CSS ikon dipangkas via subset (commit 3). Purge Tailwind TIDAK dikerjakan (tindak lanjut — risiko class dinamis terlewat purge).
5. **Code-splitting per layar / gabungkan 55 file app menjadi beberapa bundel** (P3) — dampak besar pada warm reload, tetapi pekerjaan terbesar; pertimbangkan setelah (1)–(4) terukur. ⏭️ DITUNDA — warm reload sudah 402–600 ms setelah (1)–(4); pemecahan per layar berisiko (modul klasik berkomunikasi lewat global) dan butuh gelombang tersendiri.

## Lampiran — data mentah

- Build audit: `~/workspace/7d-audit-tmp/` (salinan `origin/main f3ac380`, skrip ukur `measure.mjs`, `cov-js2.mjs`, `res-list.mjs`, `timing-probe.mjs`, `proxy-probe.mjs`, log `measure.log`). Server lokal sudah dimatikan; jalankan ulang dengan `cd ~/workspace/7d-audit-tmp/dist && python3 -m http.server 8901 --bind 127.0.0.1`.
- Cold load (3 jalan, localhost): wall 844–923 ms; DCL 754–914 ms; load 757–916 ms; LCP 400–520 ms; 73 permintaan; transfer 2.354.352 byte; decoded 2.332.452 byte.
- Warm reload: transfer 0 byte; DCL 914 ms; load 916 ms; LCP 1.064 ms.
- Offline reload: 150 ms; shell tampil.
- Slow 4G: DCL/load 21,4 detik; LCP 8,0 detik.
- Live gzip (curl, aset teks): 489.709 byte; font 345.876 byte; total wire live ~838 KB.
- CSS coverage (layar awal): total 358.136 byte, terpakai 23.964 byte (7%).
- Cache SW: 80 entri, 3.114.569 byte; kuota ~10 GB, pemakaian ~6,6 MB.
- Header live: `Cache-Control: max-age=600` untuk semua aset; `ETag` ada; gzip aktif.
- 0 permintaan gagal; 0 long task saat muat; `version.json` tidak diambil saat boot.
