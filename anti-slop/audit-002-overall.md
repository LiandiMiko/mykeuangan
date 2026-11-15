# Audit 002 — Pemeriksaan menyeluruh

## Cakupan dan batasan

Pemeriksaan statis mencakup alur frontend, Supabase API, skema dan migrasi SQL, Edge Functions, service worker, serta workflow deployment. Worktree bersih sebelum audit. Tidak ada source code aplikasi yang diubah.

Validasi yang tersedia: VS Code Problems tidak menemukan diagnostic. Tidak ditemukan file test; workflow GitHub Actions hanya menjalankan `node build.mjs`. Audit ini tidak menjalankan build agar tetap read-only, tidak menguji akun Supabase secara live, dan tidak memverifikasi status deploy Edge Function. Pemindai AI-slop yang diminta SOP tidak tersedia di toolset sesi ini, jadi skor tidak dilaporkan.

## Temuan

### 1. [P1 · Keyakinan tinggi] Setup database baru melewatkan skema dompet

README meminta menjalankan `db/schema.sql` lalu langsung migrasi onboarding (`README.md:134-147`). Namun `wallets` dan `transfers` dibuat terpisah di `db/002_wallets.sql:7-20`, dan file itu tidak disebut pada urutan setup. Trigger onboarding tetap memasukkan dua dompet (`supabase/migrations/20261115000000_admin_panel_hardening.sql:37-40`), sementara frontend juga membaca tabel tersebut (`web/supabase-api.js:260-268`). Pada proyek Supabase baru, pendaftaran pengguna atau pemuatan aplikasi dapat gagal karena tabel belum ada.

**Perbaikan:** masukkan `db/002_wallets.sql` ke urutan setup setelah skema dasar, atau satukan semua skema ke migrasi yang dapat dijalankan dari awal. Verifikasi urutan pada proyek Supabase kosong.

### 2. [P1 · Keyakinan tinggi] Suspend tidak mencabut akses sesi aktif dan bot

Status `suspended` diperiksa saat profil dimuat/login saja (`web/supabase-api.js:40-45`). RLS data pengguna hanya memeriksa `user_id = auth.uid()` (`db/schema.sql:163-166`), dan bot Telegram hanya memeriksa apakah `chat_id` terdaftar (`supabase/functions/telegram-bot/index.ts:1284-1285`). Selain itu, `is_admin()` hanya melihat role, bukan status akun (`supabase/migrations/20261114000000_multiuser_onboarding.sql:20-29`). Jadi perubahan status tidak otomatis menghentikan sesi web yang masih aktif atau akses bot; admin tersuspend juga masih dapat lolos pemeriksaan role di database.

**Perbaikan:** tegakkan status aktif di batas akses server/database dan bot; saat suspend, cabut sesi/token yang ada. Pastikan pemeriksaan admin mensyaratkan role admin sekaligus status aktif.

### 3. [P1 · Keyakinan menengah] Email pengguna dimasukkan ke inline handler admin

`escapeAttrJS()` hanya melakukan escaping JavaScript, bukan encoding aman untuk konteks atribut HTML (`src/script.html:34-37`). Email dari profil pengguna disisipkan langsung ke atribut `onclick` tombol admin (`src/script.html:2186`). Browser mengurai entitas HTML sebelum menjalankan handler, sehingga encoding lintas konteks ini berpotensi membuka stored script injection pada admin panel.

**Perbaikan:** hindari interpolasi data ke inline JavaScript. Buat elemen tombol dan pasang event listener, atau gunakan `data-*` yang diambil sebagai nilai data—bukan kode yang dieksekusi. Uji dengan data profil yang memuat karakter khusus.

### 4. [P1 · Keyakinan tinggi] Kode pairing Telegram pendek dan tidak dibatasi percobaannya

OTP enam digit dibuat dengan `Math.random()` di browser (`web/supabase-api.js:608-610`), berlaku 10 menit (`supabase/migrations/20261114000001_telegram_pairings.sql:6-9`), dan handler bot memeriksa kode tanpa pembatasan percobaan (`supabase/functions/telegram-bot/index.ts:1260-1278`). Ini membuat proses pairing rentan terhadap tebakan otomatis dari pengguna bot.

**Perbaikan:** gunakan generator kriptografis, tambahkan pembatasan percobaan dan jeda/blokir per chat, serta pastikan kode lama segera tidak berlaku setelah kode baru dibuat. Uji bahwa kode tidak dapat dipakai ulang.

### 5. [P2 · Keyakinan tinggi] Validasi nominal hanya di UI, bukan API/database

Form transaksi memeriksa nominal positif (`src/script.html:1499-1506`), tetapi adapter mengubah nilai yang tidak valid menjadi `0` (`web/supabase-api.js:20`, `web/supabase-api.js:332-342`) dan tabel `transactions` mengizinkan nol maupun nominal negatif (`db/schema.sql:41-51`). Pemanggilan API langsung dapat menyimpan nilai yang mengacaukan saldo dan laporan.

**Perbaikan:** validasi tipe, tanggal, kategori, dan nominal di adapter serta tambahkan constraint database setelah memeriksa data lama yang mungkin terdampak.

### 6. [P2 · Keyakinan tinggi] Perubahan finansial multi-langkah tidak selalu atomik

`api_updateEntity()` mengubah entitas lalu transaksi terkait lewat dua request terpisah (`web/supabase-api.js:377-385`). Jika request kedua gagal, data menjadi tidak konsisten. Top-up aset juga menyimpan aset dan transfer secara terpisah serta mencoba rollback tanpa memeriksa apakah rollback berhasil (`web/supabase-api.js:485-529`).

**Perbaikan:** pindahkan operasi yang harus konsisten ke satu transaksi database/RPC; kembalikan error yang jelas dan uji kegagalan di tiap tahap.

### 7. [P2 · Keyakinan tinggi] Beberapa kegagalan aksi hanya masuk ke console

Sejumlah handler aksi menangkap error lalu hanya memanggil `console.error`, misalnya tambah transaksi cepat, tambah kategori, hapus transaksi, dan hapus budget (`src/script.html:1421`, `1473`, `1583`, `1792`, `1848`). Pengguna dapat mengira perubahan berhasil padahal gagal.

**Perbaikan:** tampilkan notifikasi gagal yang konsisten, pertahankan input saat gagal, dan sediakan retry bila aman.

### 8. [P2 · Keyakinan tinggi] Setiap perubahan memuat ulang seluruh riwayat

`getInitialData()` mengambil semua transaksi dengan pagination (`web/supabase-api.js:215-222`, `258-268`), dan banyak operasi CRUD memanggilnya lagi setelah setiap mutasi (`web/supabase-api.js:345-361` dan seterusnya). Biaya jaringan dan waktu tunggu meningkat seiring panjangnya riwayat transaksi.

**Perbaikan:** kirim payload perubahan atau ambil data yang berubah saja; gunakan rentang tanggal/paginasi untuk layar riwayat dan agregasi di database untuk metrik yang tidak perlu seluruh data.

### 9. [P2 · Keyakinan tinggi] Klaim offline PWA lebih luas daripada implementasinya

Service worker hanya melakukan precache untuk root, `index.html`, dan manifest (`web/sw.js:1-5`); request Supabase tetap bergantung pada jaringan (`web/sw.js:28-37`). Tidak ada cache data keuangan atau antrean mutasi offline. Aplikasi mungkin membuka shell, tetapi fitur utamanya tidak berfungsi tanpa koneksi.

**Perbaikan:** pilih dan jelaskan batas dukungan offline; jika ingin benar-benar mendukungnya, tambahkan indikator offline, penyimpanan lokal yang aman, sinkronisasi antrean, dan aturan konflik. Jika tidak, ubah klaim dokumentasi agar tidak menjanjikan fallback penuh.

### 10. [P2 · Keyakinan tinggi] Dasar aksesibilitas belum konsisten

Form autentikasi memakai placeholder tanpa `<label>` yang terhubung dan pesan error tanpa `aria-live` (`web/supabase-api.js:82-108`, `124`). Tombol ikon penting seperti menu, sembunyikan nominal, dan tema tidak memiliki nama aksesibel (`src/Index.html:109-120`).

**Perbaikan:** hubungkan setiap input dengan label, umumkan pesan status/error ke pembaca layar, beri `aria-label`/state pada tombol ikon, lalu cek navigasi keyboard dan fokus modal.

### 11. [P2 · Keyakinan tinggi] Tidak ada automated test gate

Tidak ditemukan file test. Workflow `.github/workflows/deploy.yml:24-25` hanya membangun dan deploy, sehingga regresi pada hitungan saldo, RLS, pairing, admin, dan transaksi tidak tertangkap otomatis.

**Perbaikan:** mulai dengan tes unit untuk siklus gaji dan perhitungan saldo, lalu tes integrasi terfokus untuk alur transaksi dan kebijakan akses; jalankan tes sebelum deploy.

## Ringkasan tindakan

Urutan yang disarankan: (1) tutup celah suspend dan pairing, (2) perbaiki encoding email di admin, (3) benahi setup database baru, (4) lindungi konsistensi transaksi serta validasi nominal, lalu (5) tingkatkan feedback, performa, PWA, aksesibilitas, dan pengujian.

## Hal yang belum diverifikasi

- Status deploy `admin-password` belum dapat dilihat dari repository; verifikasi di Supabase dan tetap aktifkan verifikasi JWT.
- Belum ada uji runtime dengan akun Supabase atau bot Telegram.
- Tidak ada perubahan kode yang diterapkan dari temuan audit ini.
