# Audit 005 Follow-up: Riwayat pembaruan

## Temuan yang disetujui

Temuan #1, hierarki visual riwayat pembaruan, sudah diperbaiki.

- Tanggal rilis menjadi jangkar visual di kolom tersendiri pada layar lebar dan tersusun di atas konten pada layar sempit.
- Rincian rilis memakai baris berlabel agar kategori fitur mudah dipindai.
- Warna tetap memakai sistem panel dan angka tanggal tetap terbaca pada tema terang, gelap, serta pilihan tema aplikasi.

## Validasi

- `node --test`: 9 tes lulus.
- `node build.mjs`: berhasil.
- Pemeriksaan editor: tidak ada error pada `src/admin.html`.
- Browser preview dari hasil build: diperiksa pada lebar CSS 320, 390, 768, dan 1280 piksel. Tidak ditemukan horizontal overflow.
- Tema terang diperiksa pada lebar desktop dan tema gelap pada lebar ponsel.
- Angka tanggal memakai teks tebal 30 piksel. Rasio kontras minimum untuk warna tema terang adalah 3.77:1, di atas ambang 3:1 untuk teks besar. Tema gelap memakai teks putih.
- Riwayat pembaruan tidak memiliki kontrol interaktif baru.
- `git diff --check`: berhasil; Git memberi peringatan konversi akhir baris Windows.
- Preview ini tidak menguji otorisasi admin atau alur data Supabase.
