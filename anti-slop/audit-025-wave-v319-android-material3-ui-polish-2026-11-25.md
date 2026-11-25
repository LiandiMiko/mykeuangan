# Audit 025: Wave v3.19 Standar Tampilan Android Material Design 3, Bottom Sheet Dialog & Proporsi Mobile 360dp — 2026-11-25

Status: Complete (Seluruh token Material Design 3, sistem Bottom Sheet SweetAlert2 di layar kecil, penyelarasan shell Android `Index.html`, penataan proporsi 360dp Dashboard/Kalender/Dompet, form sticky thumb-zone, konsistensi seluruh halaman fitur, tes regresi baru `tests/android-m3-ui.test.js`, sinkronisasi `updates.html` & `README.md`, serta pemindaian statis MCP selesai; uji visual runtime di browser / APK fisik dijalankan pada perangkat pengguna)

## Cakupan

Menindaklanjuti permintaan penyesuaian antarmuka aplikasi agar memenuhi standar UX/UI aplikasi Android modern (Material Design 3), proporsional pada lebar layar `360dp`, dan konsisten di mode Terang maupun Gelap tanpa mengubah logika bisnis atau struktur ID/event aplikasi.

## Perubahan Utama

1. **Material 3 Tonal Surfaces & Native Bottom-Sheet Modals (`src/styles.html`)**:
   - Menambahkan token permukaan Material 3 (`--mk-surface-canvas` `#f2f5f9` siang / `#080d17` malam OLED, `--mk-surface-elevated`, `--mk-outline-subtle`, `--mk-card-shadow`, `.mk-card-surface`) serta padding *safe-area* atas pada `#appLoader`, `#sidebar`, dan `#appHeader`.
   - Mengubah seluruh dialog/modal SweetAlert2 (`.swal2-popup` 28dp) menjadi **Android Material 3 Bottom Sheet** di layar `< 640px` (`align-items: flex-end`, sudut atas `28px 28px 0 0`, bilah pegangan atas `::before`, animasi `mkSheetUp`, serta penyesuaian input 48px penuh dan aksi tombol simetris; tetap patuh pada `@media (prefers-reduced-motion: reduce)`).
2. **App Shell, Navigation Drawer, Top App Bar & Bottom Nav (`src/Index.html`)**:
   - Memberikan sudut `rounded-r-[28px] lg:rounded-none` dan item `min-h-12` (48dp) berpill kapsul (`rounded-full`) pada `#sidebar`.
   - Menyamakan tinggi `#appHeader` (56dp) dengan tombol `rounded-full` & pemilih periode kapsul, menyembunyikan ikon merek sekunder di `< 430px` agar header 360dp tidak sempit, menambah ruang gulir bawah `6.75rem + safe-area-inset-bottom`, serta membesarkan indikator pill Navigation Bar `#mobileBottomNav` ke ukuran M3 **56×32dp** (`w-14 h-8 rounded-full`).
3. **Proporsi Dashboard 360dp, Kalender, Dompet & Form (`src/dashboard.html`, `src/form.html`, `web/ui-calendar.js`, `web/ui-wallets.js`, `web/ui-dashboard.js`, `web/ui-budget.js`)**:
   - Memecah KPI strip Hero Net Worth (`rounded-[28px]`) pada HP menjadi `Uang Aktif` lebar penuh di atas kartu Pemasukan/Pengeluaran agar nominal Rupiah terbaca penuh.
   - Merapikan kontrol filter Kalender menjadi *segmented pill* penuh 3 bagian, badge lingkaran tanggal hari ini (`w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-brand`), menyusun nominal & tombol edit/hapus transaksi Dashboard secara vertikal rapi di layar sempit, dan menambah `min-w-0` + `truncate` pada ringkasan `web/ui-budget.js`.
   - Menambahkan ikon caret native pada dropdown kategori/dompet, rail chip nominal dapat digulir, dan bar simpan melayang (`sticky bottom-0`) di zona ibu jari pada `src/form.html`.
4. **Konsistensi Semua View, Overlay Login & Versi `3.19.0` (`src/{histori,budgeting,aset,laporan,ai,utang,admin,updates}.html`, `web/supabase-auth*.js`, `package.json`, `README.md`, `tests/android-m3-ui.test.js`)**:
   - Menyeragamkan header kompak, kartu `rounded-2xl sm:rounded-3xl`, tombol aksi simetris 2 kolom, metrik Admin 2×2, panel dropdown Laporan (`right-0` pada Ekspor agar tidak terpotong di tepi kanan HP), kartu login beradius `28px` + kontrol `48px`, serta sinkronisasi rilis `Wave v3.19` (`version: 3.19.0`).

## Verifikasi

- **PASS (`aislop:aislop_scan` pada `c:/Users/Acer/Documents/GitHub/mykeuangan`)**: Skor **94/100** pada **68 file** (`javascript`, `typescript`), **0 warnings**, **0 confirmed defects**, **0 AI-slop indicators**, hanya **1** error pre-existing pada `web/config.js:6` (`security/hardcoded-secret` untuk public client anon key) dan **2** info (`knip/skipped`, `security/dependency-audit-skipped`).
- **PASS (`konoha:website_ai_detector` pada `c:/Users/Acer/Documents/GitHub/mykeuangan/src`)**: Skor **0** (`Human-Built`, **PASS**), **16** file (**251.185** bytes), **0** findings.
- **PASS (`konoha:token_efficient_grep`)**:
  - `src/` (`class="[^"]*\btransition-all\b` & `\bph-[a-z0-9-]+-(bold|fill|duotone|light|thin)\b`): **0** kecocokan (`updates.html:273` hanya menyebut `<code>transition-all</code>` pada teks riwayat rilis lama).
  - `web/` (`console\.log\(|alert\(|(?:bg|text|border|ring|from|to)-\$\{`): **0** kecocokan, dan `.innerHTML` hanya pada baris pre-existing `web/ui-calendar.js:205` (`grid.innerHTML = '';`).

## Belum Diverifikasi (Dijalankan Pengguna)

- Eksekusi runtime unit test `npm run check` serta inspeksi visual langsung pada `360dp` dan `1280px` di HP Android melalui build `MyKeuGuech-v3.19.0-debug.apk`.
