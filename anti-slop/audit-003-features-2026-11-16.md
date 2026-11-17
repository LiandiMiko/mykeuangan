# Audit 003 - Fitur lanjutan

## Cakupan

Audit perubahan fitur pencarian dan paginasi laporan, impor CSV, insight budgeting, serta target keuangan. Pemeriksaan mencakup kode sumber, aturan akses migrasi baru, teks ID/EN, dan kondisi UI yang dapat diverifikasi secara statis.

## Temuan

### 1. [HIGH · R-02] Tanda em dash pada pratinjau impor

`src/script.html:1972` memakai karakter em dash sebagai pengganti nominal yang tidak valid. Teks UI baru tidak boleh memakai karakter tersebut.

**Perbaikan:** ganti dengan tanda baca yang diizinkan atau teks pengganti yang jelas.

### 2. [HIGH · R-25] Kontras pratinjau impor gagal pada tema gelap

`src/script.html:1975,1982` memberi warna `text-slate-600` pada daftar dan `text-rose-600` pada pesan baris bermasalah. Modal gelap memakai latar `#1e293b` (`src/styles.html:82`); rasio kontras yang dihitung masing-masing 1.93:1 dan 3.11:1, di bawah 4.5:1 untuk teks normal.

**Perbaikan:** gunakan warna teks berbeda untuk tema gelap dan ukur ulang pasangan warna sebelum mengirim.

### 3. [HIGH · R-26] Laporan tidak disegarkan setelah kategori transaksi diganti

`src/script.html:157` hanya menandai hasil laporan kotor untuk payload transaksi tambah, ubah, atau hapus. Payload `renamedTransactionCategory` diproses kemudian (`src/script.html:176-179`), tetapi tidak memaksa query laporan dimuat ulang. Jika filter tetap sama, halaman laporan dapat terus menampilkan nama kategori lama.

**Perbaikan:** tandai laporan perlu dimuat ulang untuk payload rename, lalu uji dengan kategori yang sedang tampil pada laporan.

### 4. [HIGH · R-27] Rincian baris CSV bermasalah bisa tersembunyi

`src/script.html:1973-1975` hanya menampilkan lima baris pertama dari file, bukan lima baris bermasalah pertama. Jika baris tidak valid berada setelah baris kelima, pengguna hanya melihat jumlah kesalahan tanpa nomor baris atau alasannya, sehingga sulit memperbaiki file.

**Perbaikan:** tampilkan semua baris invalid dalam daftar yang dapat digulir, atau sediakan ringkasan kesalahan yang mencakup nomor baris dan alasannya.

## Validasi dan batasan

- `node --test`: 9 tes lulus.
- `node build.mjs`: berhasil.
- Seluruh inline JavaScript hasil build berhasil diparse.
- `git diff --check`: berhasil; Git hanya memberi peringatan konversi akhir baris Windows pada README.
- Browser smoke test mencapai halaman masuk, tetapi tidak ada sesi Supabase untuk menguji klik-through fitur yang memerlukan autentikasi.
- Migrasi Supabase baru belum dijalankan terhadap database uji, sehingga kebijakan RLS dan RPC masih perlu diverifikasi setelah pengguna menerapkannya.
- Pengukuran viewport browser lokal tidak memberikan lebar layout yang konsisten dengan ukuran viewport yang diminta; tidak ada klaim lulus uji mobile penuh.
