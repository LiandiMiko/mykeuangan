# Audit 007: Peningkatan Menyeluruh Keamanan, UI/UX, Fitur, Performa & AI On-Demand - 2026-11-18

## Cakupan

Audit statis menyeluruh terhadap source frontend (`src/`), client API dan Service Worker (`web/`), Edge Functions (`supabase/functions/`), serta skema migrasi (`supabase/migrations/`) sebelum implementasi paket peningkatan v2.0.

## Temuan

### 1. [HIGH] Service Worker mencache endpoint Supabase dan cache tidak dibersihkan saat logout

- `web/sw.js` menggunakan fallback `caches.match(event.request)` untuk `supabase.co` dan `window.logout()` di `web/supabase-api.js` hanya memanggil `sb.auth.signOut()` tanpa menghapus `CacheStorage`. Pada perangkat bersama, respons REST/Auth berisiko tersisa di cache.

### 2. [HIGH] Tidak ada proteksi database terhadap admin self-lockout / demosi admin terakhir

- Pencegahan admin men-suspend atau menurunkan role dirinya sendiri baru dicegah di tampilan tabel `src/script.html` (`loadAdminData`), belum ada trigger di `public.profiles` (`supabase/migrations/20261115000000_admin_panel_hardening.sql`) sehingga permintaan API langsung masih dapat menurunkan satu-satunya admin aktif.

### 3. [HIGH] Tombol aksi di daftar transaksi & aset tersembunyi di layar sentuh dan target sentuh di bawah 44px

- `rItem` dan `renderAssets()` di `src/script.html` memakai `opacity-0 group-hover:opacity-100` dengan ukuran tombol `w-6 h-6` / `w-7 h-7`. Pada perangkat mobile (tanpa hover), kontrol edit/hapus tidak terlihat dan tombol tambah di `src/utang.html` / warna tema di `src/Index.html` berukuran kecil tanpa `aria-label` lengkap.

### 4. [HIGH] Fitur tabel `recurring`, pencairan aset, kelola kategori, dan hapus dompet belum tersedia di Web UI

- `public.recurring` sudah tersedia di skema dan di-fetch `getInitialData()`, tetapi belum memiliki tampilan UI web.
- Pengguna bisa membeli/top-up aset, menambah kategori, dan menambah/mengubah dompet, tetapi belum dapat mencairkan/menjual aset ke dompet, merename/menghapus kategori, menghapus dompet, atau mengalokasikan saldo dompet langsung ke target keuangan (`financial_goals`).

### 5. [HIGH] Mutasi CRUD menjalankan `partialData()` (10 query sekaligus)

- Hampir semua handler mutasi di `web/supabase-api.js` memanggil `partialData()` (`getInitialData({ includeTransactions: false })`), sehingga aksi kecil memicu pembacaan ulang seluruh tabel sekaligus.

### 6. [MEDIUM] Inkonsistensi panjang password, verifikasi secret belum timing-safe, CDN unpinned, & kekurangan filter/ekspor laporan

- `showLogin()` di `web/supabase-api.js` mengizinkan `minlength="6"` saat registrasi, belum mendukung tema gelap maupun tombol lihat/tutup kata sandi; modal Telegram pairing & admin status/role juga belum memakai `getSwalClass()`.
- Header `x-cron-secret` dan `x-telegram-bot-api-secret-token` di `supabase/functions/telegram-bot/index.ts` dibandingkan dengan `===` biasa dan CORS memakai `*` statis.
- Library CDN di `src/styles.html` belum dipin ke versi spesifik.
- Halaman Laporan belum mendukung filter per dompet dan ekspor CSV; kalender harian belum interaktif; statistik Telegram Admin Panel baru menghitung milik admin sendiri; beberapa label baru belum masuk kamus `src/i18n.html`.

### 7. [FEATURE REQUEST] Analisis arus keuangan AI dengan Gemini on-demand

- Pengguna membutuhkan panel analisis arus kas menggunakan Gemini API Key milik pengguna yang hanya berjalan secara eksplisit saat tombol analisis ditekan.
