# Audit 002 — Tindak lanjut perbaikan P1/P2

## Status temuan

| No. | Status | Perubahan |
|---|---|---|
| 1 | Selesai | Urutan setup database baru kini mencakup skema dompet sebelum migrasi onboarding. |
| 2 | Diperbaiki dengan batasan | RLS dan `is_admin()` mensyaratkan akun aktif, bot memeriksa status akun, dan web menutup sesi nonaktif saat pemeriksaan status. Token tidak dicabut langsung ketika status berubah; akses data tetap ditolak oleh RLS. |
| 3 | Selesai | Aksi admin dan kartu utang memakai `data-*` serta event listener, bukan interpolasi email/nama ke inline handler. |
| 4 | Selesai | OTP memakai 8 digit acak kriptografis, rotasi kode atomik, dan batas lima percobaan per chat setiap 10 menit. |
| 5 | Selesai | Validasi transaksi ada di adapter, constraint nominal positif ada pada skema baru dan migrasi. Constraint migrasi belum divalidasi terhadap seluruh data lama. |
| 6 | Selesai | Rename entitas dan top-up aset dipindahkan ke RPC atomik. |
| 7 | Selesai | Kegagalan pada aksi yang sebelumnya hanya masuk console kini menampilkan pesan error. |
| 8 | Sebagian | Mutasi memakai payload parsial dan transaksi tidak diunduh ulang; initial load masih mengambil seluruh riwayat, jadi paginasi layar tetap perlu dikerjakan. |
| 9 | Selesai | Dokumentasi kini menyatakan shell dapat dibuka offline, tetapi autentikasi dan data memerlukan internet. Tidak ada antrean mutasi offline. |
| 10 | Selesai dengan validasi terbatas | Form auth memiliki label dan live status; tombol ikon memiliki nama aksesibel; kontrol budget yang sebelumnya berupa `div` kini memakai tombol native. |
| 11 | Selesai sebagian | Tes unit siklus payroll dan analisis budget dijalankan pada workflow sebelum build. Tes integrasi RLS dan alur admin/bot belum tersedia. |

## Fitur budgeting

Pemilih periode dipindahkan ke header di sebelah kiri tombol sembunyikan nominal, bersama pengaturan tanggal gajian. Budgeting dapat dinavigasi per bulan dan menampilkan perbandingan rencana vs pengeluaran per kategori serta tren enam bulan. Tren menghitung pengeluaran berdasarkan siklus payday yang dipilih, termasuk kategori tanpa budget.

## Validasi

- `node --test`: 4 tes lulus.
- `node build.mjs`: berhasil menghasilkan `dist/index.html`.
- `git diff --check`: berhasil; hanya peringatan konversi akhir baris Windows dari Git.
- Browser smoke test lokal: halaman dan navigasi login/registrasi termuat; header tidak mengalami overflow pada lebar CSS 320, 375, 768, dan 1280 piksel. Browser melaporkan peringatan penggunaan Tailwind CDN yang sudah ada sebelumnya.
- Belum diuji dengan akun Supabase aktif, database live, atau bot Telegram.

## Langkah deploy

Jalankan `20261115040200_application_hardening.sql` satu kali di Supabase, lalu deploy ulang fungsi `telegram-bot` dan frontend. Fungsi `admin-password` tetap menggunakan verifikasi JWT; jangan deploy fungsi itu dengan `--no-verify-jwt`.
