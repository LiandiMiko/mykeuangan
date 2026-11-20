# Audit 015: Wave v3.9 UI/UX Cohesion, Redesign Mobile Navbar & Perbaikan 13 Ikon Phosphor - 2026-11-20

Status: Partial (Perbaikan markup UI/UX, 13 ikon Phosphor, test regresi statis, dan sinkronisasi catatan rilis selesai; eksekusi lokal `node --test`, `node build.mjs`, dan verifikasi visual browser dijalankan oleh pengguna)

## Cakupan & Temuan

1. **[HIGH] Tombol tengah tambah transaksi (`#mobileFabBtn`) pada Mobile Bottom Navbar blank & tidak simetris**:
   - `src/Index.html` memakai kelas invalid `ph ph-plus-bold` untuk `@phosphor-icons/web@2.1.1` (yang mewajibkan weight sebagai kelas terpisah `ph-bold ph-plus`), sehingga ikon `+` tidak ter-render.
   - Layout `flex justify-around` antara 4 tab `flex-1` dan 1 tombol `w-12 h-12 -mt-4` membuat jarak antar slot tidak rata tanpa label penyeimbang di kolom tengah.
2. **[HIGH] 12 ikon aksi lainnya di seluruh aplikasi juga memakai sintaks suffix invalid `ph-*-bold`**:
   - Ditemukan di `src/dashboard.html` (`quickAddCard` & `Tambah Dompet`), `src/aset.html` (`Tambah Aset`), `src/budgeting.html` (`Simpan`, `Tambah target`, `Tambah Jadwal Rutin`), `src/form.html` (`Tambah kategori`, `Enkripsi & Simpan`), `src/utang.html` (3 tombol tambah entitas utang/piutang), dan `src/script.html` (`topUpAsset`).
3. **[MEDIUM] Inkonistensi UI/UX lintas halaman & responsivitas mobile**:
   - Header atas mobile memiliki ukuran tombol tidak seragam (`w-8 h-9` vs `w-7 h-8`) dan merek berpotensi terpotong di layar sempit (`360px`).
   - Page header pada `dashboard.html`, `laporan.html`, `utang.html`, `updates.html`, dan `admin.html` belum seragam dengan pola tile ikon `w-11 h-11 rounded-2xl` + tipografi `font-extrabold` seperti `aset.html`/`histori.html`/`budgeting.html`.
   - Dropdown `#lapImportMenu` & `#lapExportMenu` di `src/laporan.html` memakai `absolute right-0` yang rawan terpotong di tepi kiri pada viewport sempit; `select#tr_kategori` di `src/form.html` belum memiliki `min-w-0` dan padding form terlalu besar (`p-8 md:p-12`) di HP.
   - `#mobileBottomNav` tetap tampil di atas tombol simpan `#btnSubmitTrans` saat membuka `form-transaction`.

## Perubahan yang Diimplementasikan

- **Mobile Bottom Navbar & Header (`src/Index.html`, `src/styles.html`, `src/features-v35.html`, `src/features-v21.html`, `src/i18n.html`)**:
  - Mengubah `#mobileBottomNav` ke `grid grid-cols-5 items-end` agar seluruh 5 kolom tepat simetris 20%, menata ulang `#mobileFabBtn` (`w-12 h-12 -mt-6 rounded-2xl ring-4` + `<i class="ph-bold ph-plus text-xl"></i>` + label `Catat`/`Add` via `nav.add_short`), menambahkan pill indikator `.mobile-nav-icon` untuk tab aktif (`aria-current="page"`), dan menyembunyikan `#mobileBottomNav` saat `viewId === 'form-transaction'`.
  - Memoles `openQuickAddMenu()` dengan tile ikon `ph-bold` berbadging & sub-keterangan yang rata.
  - Menyeragamkan tinggi & radius seluruh kontrol `<header>` serta menampilkan teks brand secara bersih mulai `min-[460px]`.
  - Memperbarui fallback `#navUpdatesVersion` ke `v3.9` dan menambahkan kunci terjemahan `nav.add_short` serta `utang.subtitle` (`ID`/`EN`).
- **Perbaikan 13 Ikon Phosphor & Penyeragaman View (`src/dashboard.html`, `src/aset.html`, `src/histori.html`, `src/budgeting.html`, `src/laporan.html`, `src/ai.html`, `src/form.html`, `src/utang.html`, `src/script.html`, `src/admin.html`, `src/updates.html`)**:
  - Mengganti seluruh `ph ph-*-bold` menjadi `ph-bold ph-*` (`ph-plus`, `ph-lightning`, `ph-check`, `ph-lock-key`).
  - Menyeragamkan tile ikon header (`w-11 h-11 rounded-2xl`), ukuran judul (`text-2xl sm:text-3xl font-extrabold tracking-tight`), border kartu (`rounded-3xl border-slate-200/80`), tinggi tombol (`min-h-11 rounded-xl`), padding mobile `src/form.html` + `min-w-0` di `#tr_kategori`, mengangkat header `src/laporan.html` ke luar kartu filter dengan dropdown `left-0 sm:left-auto sm:right-0`, serta merilis entri `Wave v3.9` di `src/updates.html`.
- **Refactor Executive Bento Dashboard (`src/dashboard.html`, `src/script.html`, `src/features-v35.html`, `src/styles.html`)**:
  - Memadatkan 7 seksi vertikal menjadi 3 zona (Hero Net Worth + strip 3 KPI Arus Kas, spotlight Quick-Add + `.no-scrollbar` template chips 1 baris, dan Bento grid `xl:grid-cols-12`: Kalender kiri 7 kolom + Dompet baris rapat & split compact Utang/Piutang kanan 5 kolom) dengan tetap mempertahankan seluruh ID DOM dan hook klik kartu dompet (`#wallet-panel > div` + `button[onclick^="editWallet("]`).
- **Perbaikan CI Test Sebelumnya (`web/finance-pro.js`, `web/transaction-import.js`) & Regression Guard (`tests/pro-web-ui.test.js`)**:
  - `computeAnnualRecap`/`compareTwoPeriods` sudah memakai `computePeriodIncome` dan `resolveImportAutoCategory` mempertahankan kompatibilitas 3 argumen (`kategori: 'Lainnya'`).
  - Menambahkan test regresi pada `tests/pro-web-ui.test.js` untuk melarang sintaks suffix invalid `ph-[a-z0-9-]+-(bold|fill|duotone|light|thin)` di seluruh `src/*.html` sekaligus memverifikasi `grid-cols-5`, `#mobileFabBtn`, `left-0 sm:left-auto sm:right-0`, `min-w-0` pada `#tr_kategori`, `xl:grid-cols-12`, dan `.no-scrollbar`.

## Verifikasi

- **PASS (`konoha:token_efficient_grep`)**: `0` kemunculan pola `ph-[a-z0-9-]+-(bold|fill|duotone|light|thin)` di seluruh `src/` maupun `web/`.
- **PASS (`aislop:aislop_scan`)**: Skor kualitas bertahan di **78/100** dengan total temuan tetap **4** (**1 error** pre-existing pada `web/config.js:6` `security/hardcoded-secret`, dan **3 warning** pre-existing `complexity/file-too-large` pada `supabase/functions/telegram-bot/index.ts`, `web/finance-analysis.js`, `web/supabase-api.js`); **0** temuan baru di `tests/pro-web-ui.test.js` maupun berkas yang diubah.
- **BLOCKED (`node --test`, `node build.mjs`)**: Shell runner agen mengarah ke subfolder `mykeuangan/mykeuangan` yang tidak ada, sehingga eksekusi lokal dijalankan pengguna lewat PowerShell.
