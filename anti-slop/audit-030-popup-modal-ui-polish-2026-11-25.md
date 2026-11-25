# Audit 030: Update v3.20.3 — Perbaikan Kontras Dark Mode Popup, Layout Bottom Sheet & Polish Modal Form (2026-11-25)

Status: Complete (Seluruh perbaikan CSS popup/bottom sheet dan template modal terverifikasi lewat `npm run check`, `node build.mjs`, `git diff --check`, `konoha:website_ai_detector`, `konoha:file_info`, dan `aislop:aislop_scan`; uji render visual interaktif langsung di browser terautentikasi belum dijalankan karena halaman utama terproteksi login)

## Akar Masalah

1. **Kontras Tombol `.swal2-deny` Berwarna & Kotak Putih Ikon Sukses Mode Gelap (`src/styles.html`)**:
   - Aturan `.swal2-deny` memaksa `color: #be123c !important` sehingga tombol `.swal2-deny` yang diberi `denyButtonColor` solid (`#e11d48` pada `editWallet` & `configureGeminiApiKey`, `#059669` pada `openCalendarDayModal`, serta `#64748b` pada layar kunci PIN) menjadi teks merah tua di atas latar merah/hijau/abu gelap dan hampir tidak terbaca.
   - Masker bawaan SweetAlert2 v11.14.5 pada `.swal2-icon.swal2-success` (`.swal2-success-circular-line-*` & `.swal2-success-fix`) memakai latar putih keras (`rgb(255, 255, 255)`), menimbulkan kotak putih mencolok di atas dialog mode gelap (`#172033`).
2. **Garis Divider Loading, Grid Drag Handle Mobile & Kontrol Native (`src/styles.html`)**:
   - `.swal2-actions` selalu menampilkan `border-top` walaupun sedang menampilkan spinner (`Swal.showLoading()`).
   - Pada mobile bottom sheet (`<= 639px`), pseudo-elemen drag handle `::before` tidak memiliki `grid-column: 1 / -1` pada grid SweetAlert2, dan baris 3 tombol aksi (`Confirm`, `Deny`, `Cancel`) berpotensi menyempitkan tombol.
   - Modal tinggi di desktop belum dibatasi `max-height` + gulir internal (`overflow-y: auto`), `:hover` belum dibatasi ke perangkat pointer halus (`@media (hover: hover) and (pointer: fine)`), `<select>` / `<input type="date">` di mode gelap belum memakai `color-scheme: dark`, dan `#mkCommandPalette` belum memberi ruang aman notch atas serta pembatasan tinggi daftar pada keyboard mobile.
3. **Inkonsistensi Form & Bahasa pada Modal Individual (`web/*.js`)**:
   - `web/ui-pro-insights.js`: input kalkulator majemuk & cicilan hanya mengandalkan placeholder (hilang saat ada nilai default) tanpa `<label>` terlihat, serta dialog target rebalance belum menunjukkan indikator total 100% langsung.
   - `web/ui-pro-palette.js`: `#mkCommandPalette` belum punya tombol tutup sentuh (`X`) yang nyaman di mobile.
   - `web/ui-pro-quick.js`: toast update PWA memakai `max-w-xs` menempel kanan di layar sempit.
   - `web/ui-budget.js`: `copyBudgetFromLastMonth()` masih memakai warna inline light-mode `color:#64748b`.
   - `web/ui-debts.js`, `web/ui-form.js`, `web/ui-assets.js`, `web/ui-wallets.js`, `web/ui-admin.js`, `web/ui-feat-onboarding.js`: beberapa prompt masih memakai label tombol default Inggris (`OK`/`Cancel`), belum mengelompokkan label+input dalam kontainer bidang rapi, atau belum memiliki indikator progres langkah di onboarding.

## Perubahan

1. **Global SweetAlert2, Bottom Sheet & Overlay CSS (`src/styles.html`)**:
   - Menyamakan latar masker `.swal2-icon.swal2-success [class^='swal2-success-circular-line']` & `.swal2-success-fix` dengan `var(--mk-surface-elevated) !important`, serta menajamkan palet ikon sukses/error/warning/info/question untuk mode terang & gelap.
   - Menghapus `color: #be123c !important` pada default `.swal2-deny` (diganti tonal netral terbaca) dan menetapkan `color: #ffffff !important` untuk `.swal2-confirm[style*="background-color"]` & `.swal2-deny[style*="background-color"]`.
   - Menghilangkan `border-top` pada `.swal2-actions.swal2-loading`, menyelaraskan perataan tombol desktop form (`.swal2-popup:has(.text-left)`), membatasi `:hover` dalam `@media (hover: hover) and (pointer: fine)`, serta menambahkan `max-height: 88dvh; overflow-y: auto` pada `.swal2-popup`.
   - Memusatkan drag handle mobile (`grid-column: 1 / -1; justify-self: center`), membungkus tombol ke-3 pada dialog 3-tombol mobile (`flex: 1 0 100%; order: 3`), menormalkan `min-width: 0 !important` pada `.swal2-input` / `.swal2-select`, menetapkan `color-scheme: dark` + warna gelap `<option>` di mode gelap, dan menambah safe-area top padding + `max-height: min(22rem, 55dvh)` pada `#mkCommandPalette` / `#mkCmdList`.
2. **Polish Template Modal & Konsistensi Bahasa (`web/ui-pro-*.js`, `web/ui-budget.js`, `web/ui-debts.js`, `web/ui-form.js`, `web/ui-assets.js`, `web/ui-wallets.js`, `web/ui-admin.js`, `web/ui-feat-onboarding.js`)**:
   - Menambahkan `<label>` terlihat, kartu hasil 2 kolom, tab pill tersegmentasi, dan `#rebTotalBadge` live di `web/ui-pro-insights.js`.
   - Menambahkan `#mkCmdCloseBtn` & menyesuaikan padding safe-area di `web/ui-pro-palette.js`.
   - Menyamakan lebar responsif `#pwaUpdateToast` (`left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm`) di `web/ui-pro-quick.js`.
   - Menghapus inline `color:#64748b` di `web/ui-budget.js` dan menyelaraskan tombol `Simpan`/`Batal`/`Ya, Hapus` + pengelompokan field + indikator 3 langkah onboarding pada modul terkait.
   - Memperbaiki temuan audit pasca-implementasi: memindahkan binding `#mkCmdCloseBtn.onclick` di `web/ui-pro-palette.js` setelah `document.body.appendChild(wrap)` agar tidak melempar `TypeError` saat Command Palette dibuka; membaca `FinanceAnalysisPortfolio` secara lazy di `web/finance-analysis-ai.js` dan memindahkan `finance-analysis-portfolio.js` sebelum `finance-analysis-ai.js` di `build.mjs` agar `buildEnrichedAiSnapshot()` selalu terisi di mode browser; menambah aturan `#swal-payroll.swal2-input` di `src/styles.html`, focus ring input kalkulator/rebalance di `web/ui-pro-insights.js`, serta menyelaraskan penyebutan Gemini 4 Hydrogen di `README.md`.
3. **Versi `3.20.3`, Test Regresi & Sinkronisasi Catatan (`package.json`, `src/Index.html`, `src/updates.html`, `README.md`, `tests/*.test.js`)**:
   - Menaikkan versi ke `3.20.3`, menambah kartu rilis `v3.20.3` di `src/updates.html` (`Menampilkan 24 rilis`) + entri changelog `README.md`, memperbarui assertion versi di `tests/android-m3-ui.test.js` & `tests/pro-web-ui.test.js`, serta menambah test regresi `v3.20.3` (termasuk simulasi DOM `openCommandPalette()` dan uji urutan IIFE browser `buildEnrichedAiSnapshot()`) di `tests/wave-v320-upgrades.test.js`.

## Verifikasi

- **PASS (`npm run check`)**:
  - `node scripts/check-syntax.mjs`: `✅ Syntax verified across 60 JS/MJS files.`
  - `node --test`: **76** tes **PASS**, **0** gagal (mencakup 2 tes runtime baru `v3.20.3` untuk `openCommandPalette()` & urutan bundel browser `buildEnrichedAiSnapshot()`, plus invariant Bottom Sheet `android-m3-ui.test.js` dan `pro-web-ui.test.js`).
- **PASS (`node build.mjs`)**: Menghasilkan `dist/index.html` (`1000 KB`), `dist/version.json` (`v3.20.3`, `min v3.19.1`), dan `dist/sw.js` (`cache: mykeuangan-f0537306b8a7`).
- **PASS (`git diff --check`)**: Exit code `0` tanpa konflik maupun trailing whitespace errors.
- **PASS (`konoha:website_ai_detector` pada `src/`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**285.232** bytes), **0** findings.
- **PASS (`konoha:file_info` & `konoha:token_efficient_grep`)**:
  - Seluruh modul JS yang dimodifikasi berada pada `<= 433` baris (`ui-budget.js`: 433, `ui-pro-insights.js`: 428, `finance-analysis-ai.js`: 426, `ui-form.js`: 426, `ui-admin.js`: 401, `ui-wallets.js`: 374, `ui-pro-quick.js`: 338, `ui-assets.js`: 283, `ui-pro-palette.js`: 266, `ui-debts.js`: 216, `ui-feat-onboarding.js`: 140).
  - Nol kecocokan baru untuk `transition-all`, interpolasi dinamis Tailwind (`bg-${` / `text-${` / `border-${`), `console.log(`, maupun `.innerHTML =` pada file yang dimodifikasi.
- **Scoped `aislop:aislop_scan` pada `web/`**: Skor **92/100** (`fileCount: 52`), **0** confirmed defects dan **0** temuan pada seluruh file modal yang dimodifikasi (hanya 2 temuan pre-existing di `supabase-portfolio.js:48` dan `config.js:6`).

## Belum Diverifikasi

- Uji visual dan interaksi langsung di browser desktop/mobile terautentikasi (membuka seluruh varian modal: sukses mode gelap, 3-tombol edit dompet/kalender, kalkulator, rebalance, command palette, onboarding, dan toast PWA).


---

## Follow-Up Audit Mobile & Verifikasi Chrome CDP (2026-11-26)

### Akar Masalah Tambahan yang Ditemukan di Viewport Mobile (`390×844` & `360×800`)
1. **Bottom sheet SweetAlert2 mengambang di tengah layar**: `sweetalert2@11.14.5/dist/sweetalert2.css` memakai `display: grid` dan `grid-column: 2; grid-row: 2; place-self: center center;` pada `.swal2-container.swal2-center`, sehingga aturan `align-items: flex-end !important;` sebelumnya tidak menambatkan modal ke tepi bawah.
2. **Tombol `.swal2-close` mendorong judul turun ~45px**: Tombol silang masih ikut flow grid SweetAlert2 di baris judul.
3. **Bar tombol `.swal2-actions` terdorong keluar layar pada sheet tinggi**: Di modal panjang (`openAnnualRecapModal`), tombol `Tutup` berada di bawah batas `90dvh` sebelum scroll (`top: 867px` di viewport `800px`).
4. **Spasi & overflow template modal mobile**:
   - Command Palette (`#mkCmdList`): saat bar pintasan keyboard desktop disembunyikan di mobile (`hidden sm:flex`), item terbawah menempel tepat di tepi bulat bawah; selain itu `#mkCmdCloseBtn` sempat gagal bind saat dipanggil sebelum `document.body.appendChild(wrap)`.
   - `Rekap 12 Siklus` & perbandingan periode (`web/ui-pro-reports.js`): nominal `+0` kanan mepet scrollbar dan kartu KPI 3 kolom menyempit di `360px`, serta toolbar tanggal tidak membungkus di layar kecil.
   - Ringkasan harian kalender (`web/ui-calendar.js`): nominal masih menampilkan `,00` dan belum `tabular-nums`.
   - Load-order IIFE AI (`web/finance-analysis-ai.js` & `build.mjs`): referensi langsung `FinanceAnalysisPortfolio` rentan saat urutan bundle dimuat ulang.

### Perubahan Lanjutan
- `src/styles.html`: Menambahkan `display: flex !important; flex-direction: column !important; justify-content: flex-end !important;` serta `place-self: end stretch !important; margin: auto 0 0 0 !important;` di `@media (max-width: 639px)`, `position: absolute !important` pada `.swal2-close`, bar `.swal2-actions` `position: sticky; bottom: 0; background: var(--mk-surface-elevated);` dengan `:has(> .swal2-actions:not([style*="display: none"])) { padding-bottom: 0 !important; }`, serta `min-width: 0; overflow-x: clip !important` pada `.swal2-html-container` dan lebar/padding responsif `#swal-payroll`.
- `web/ui-pro-palette.js`: Memasang handler `#mkCmdCloseBtn.onclick` setelah `appendChild`, menambah `min-w-0` + `truncate`, `hidden sm:flex` pada bar pintasan keyboard desktop, serta `p-2 pb-3 sm:pb-2` pada `#mkCmdList`.
- `web/ui-pro-reports.js`: Mengubah toolbar filter ke `grid-cols-2 sm:flex`, menambah `pr-2` pada pembungkus gulir `Rekap 12 Siklus`, dan mengubah grid kartu perbandingan ke `grid-cols-1 sm:grid-cols-3`.
- `web/ui-calendar.js`: Memangkas akhiran `,00` dan menambahkan `tabular-nums` pada tampilan nominal kalender harian.
- `web/ui-pro-insights.js`: Menambahkan cincin fokus eksplisit (`focus:outline-none focus:ring-2 focus:ring-brand`) pada input kalkulator & rebalance.
- `web/finance-analysis-ai.js` & `build.mjs`: Lazy-resolve `FinanceAnalysisPortfolio` dan menaikkan `finance-analysis-portfolio.js` sebelum `finance-analysis-ai.js` di `WEB_MODULES`.
- `tests/wave-v320-upgrades.test.js`: Menambah pengujian DOM runtime `openCommandPalette()`, urutan IIFE `buildEnrichedAiSnapshot()`, dan asersi CSS mobile bottom-sheet / sticky actions.

### Verifikasi Visual Chrome Headless CDP (`dist/index.html`)
Diperiksa via Chrome Headless (`390×844` dan `360×800`) setelah build ulang:
- Semua 11 skenario bottom sheet (`qa-1` s/d `qa-4`, `qa-6` s/d `qa-12`): `bottomGap: 0`, `scrollOverflowX: false`.
- `qa-1-3btn-form-390.png`: Sheet tertambat penuh di tepi bawah (`390×502`), drag handle terpusat, tombol silang tidak mendorong judul, 2 tombol sejajar (`Batal`, `Simpan`) + 1 tombol penuh (`Hapus Dompet`).
- `qa-2-dark-success-360.png`: Animasi centang hijau mode gelap bersih tanpa kotak masker putih pada `900ms`.
- `qa-4-loading-360.png`: Spinner loading bersih tanpa garis pembatas atas.
- `qa-5-palette-360.png`: Command Palette berjarak aman dari notch atas (`top: 56px`), tombol tutup sejajar, daftar bersih dengan spasi bawah (`pb-3`) dan tanpa footer pintasan keyboard di mobile.
- `qa-11-recap-360.png`: Filter 2 kolom + tombol penuh `Bandingkan`, jarak aman antara `+0` dan scrollbar (`pr-2`), dan tombol sticky `Tutup` tetap terlihat di tepi bawah viewport (`top: 736px` pada sheet `720px` di layar `800px`).

---

## Penyesuaian Floating Sheet 4-Sudut Membulat iQOO 15R (`v3.20.4`)
- **Masalah perangkat edge-to-edge**: Pada HP berlayar melengkung dengan gesture/nav bar bawah (iQOO 15R 6.59" `1260×2750` / 19.5:9 Android 15/16), sheet menempel `bottom: 0` dengan `border-radius: 28px 28px 0 0` dan `overflow-y: auto` pada `.swal2-container` terpotong di sudut bawah layar.
- **Perbaikan (`src/styles.html`)**: Mengubah `.swal2-container.swal2-center` mobile ke `overflow: hidden !important;` + padding 4 sisi memakai `--safe-area-inset-*` + floor native `.mk-native-app`, mengubah `.swal2-popup:not(.swal2-toast)` ke kartu mengambang `border-radius: 28px !important; border: 1px solid var(--mk-outline-subtle) !important; max-height: min(86dvh, 100%) !important;`, membundel sudut bawah sticky `.swal2-actions` (`border-radius: 0 0 28px 28px;`), membulatkan tombol `16px`, serta memberi `padding-bottom` safe-area pada `#mkCommandPalette`.
