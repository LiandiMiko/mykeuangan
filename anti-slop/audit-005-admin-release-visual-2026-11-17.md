# Audit 005: Tampilan riwayat pembaruan

## Cakupan

Pemeriksaan statis pada bagian riwayat pembaruan di `src/admin.html`.

## Temuan

### 1. [LOW · R-31] Hierarki visual riwayat pembaruan kurang kuat

`src/admin.html:84-96` menampilkan tanggal, judul rilis, dan seluruh rincian dalam satu kartu dengan bobot visual yang hampir sama. Bentuknya mudah terbaca sebagai daftar teks biasa, bukan riwayat rilis yang bisa dipindai cepat.

**Perbaikan yang disarankan:** pertegas tanggal dan judul sebagai jangkar, lalu susun rincian rilis menjadi kelompok ringkas. Pertahankan warna dan dukungan tema yang dipakai panel, serta susun ulang ke satu kolom pada layar sempit.

## Batasan pemeriksaan

Halaman browser yang tersedia memakai build lama dan tidak memuat `adm-release-title`. Temuan ini berdasarkan pemeriksaan source, belum dikonfirmasi melalui tampilan build terbaru.
