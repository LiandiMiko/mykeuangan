# 💰 MyKeuangan — Personal Finance App

> **v2.0** — Multi-User SaaS · PWA-Ready · Admin Panel · Telegram OTP Pairing · Security Hardened

Aplikasi keuangan pribadi berbasis web yang dibangun dengan **Vanilla JS + Supabase**, mendukung multi-user, Progressive Web App (PWA), dan integrasi Telegram Bot.

[![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-black?logo=github)](https://github.com/LiandiMiko/mykeuangan)
[![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?logo=supabase)](https://supabase.com)
[![PWA](https://img.shields.io/badge/PWA-Ready-blueviolet?logo=googlechrome)](#pwa)

---

## 📋 Daftar Isi

- [Fitur](#-fitur)
- [Struktur Proyek](#-struktur-proyek)
- [Quick Start (Lokal)](#-quick-start-lokal)
- [Setup Lengkap untuk Deployment Publik](#-setup-lengkap-untuk-deployment-publik)
  - [1. Supabase — Database & Auth](#1-supabase--database--auth)
  - [2. Jalankan Migrasi SQL](#2-jalankan-migrasi-sql)
  - [3. Konfigurasi Supabase Auth](#3-konfigurasi-supabase-auth)
  - [4. Deploy Edge Function Telegram Bot](#4-deploy-edge-function-telegram-bot)
  - [5. GitHub Pages & Actions](#5-github-pages--actions)
- [Admin Panel](#-admin-panel)
- [Menghubungkan Telegram (Self-Service OTP)](#-menghubungkan-telegram-self-service-otp)
- [PWA — Install sebagai Aplikasi](#-pwa--install-sebagai-aplikasi)
- [Keamanan & Catatan Penting](#-keamanan--catatan-penting)
- [Changelog — What's New in v2.0](#-changelog--whats-new-in-v20)
- [Roadmap](#-roadmap)

---

## ✨ Fitur

| Kategori | Fitur |
|---|---|
| **Keuangan** | Transaksi + Scan Struk AI, header mobile satu baris, kalender interaktif, pencarian/filter dompet/paginasi laporan, impor CSV & e-statement bank, ekspor CSV/Excel/PDF, kelola kategori & dompet, transaksi rutin, jatuh tempo utang/piutang |
| **Target** | Target tabungan dengan kalkulator rekomendasi setoran bulanan otomatis, alokasi langsung dari dompet, nominal terkumpul, tenggat opsional |
| **Aset** | Portofolio Crypto, Emas (gram), Valas USD, Saham/Reksa Dana dengan auto refresh harga, beli/top-up dari dompet, dan cairkan/jual ke dompet |
| **Multi-User** | Registrasi mandiri (min. 8 karakter), login/register dark mode, lupa password via email |
| **Admin Panel** | Statistik global platform, cari & filter user, suspend/aktifkan akun, proteksi self-lockout/admin terakhir |
| **PWA** | Bisa di-install di HP/desktop; shell statis offline + antrean transaksi offline IndexedDB auto-sync saat online, Pusat Notifikasi Lonceng in-app |
| **Telegram** | Notifikasi, query saldo, dan baca foto struk + voice note AI via Gemini 2.5 Flash; pairing via OTP mandiri + tombol salin perintah |
| **AI** | Analisis arus keuangan, Scan Struk Vision, & Tanya Jawab / Simulasi Keuangan on-demand dengan Google Gemini 2.5 Flash |
| **Keamanan** | XSS sanitization, RLS Supabase, constant-time secret verification, purge cache saat logout |

---

## 📁 Struktur Proyek

```
mykeuangan/
├── src/                    # Source frontend (HTML templates)
│   ├── Index.html          # App shell: layout, nav, modals
│   ├── script.html         # Semua logika JS (1 file besar)
│   ├── admin.html          # Admin panel UI (di-include ke Index)
│   ├── dashboard.html      # View: ringkasan utama (Arus Kas, Dompet, Utang/Piutang, Kalender)
│   ├── aset.html           # View: Tabungan & Investasi (aset, grafik 30 hari & riwayat transfer)
│   ├── histori.html        # View: histori transaksi pemasukan & pengeluaran per siklus
│   ├── ai.html             # View: analisis arus keuangan AI Gemini (on-demand)
│   ├── form.html           # View: tambah transaksi
│   ├── laporan.html        # View: laporan keuangan
│   ├── budgeting.html      # View: anggaran kategori, target keuangan & transaksi rutin
│   ├── features-v21.html   # Modul JS lanjutan: OCR struk, AI chat, chart budget, offline sync
│   ├── utang.html          # View: utang/piutang
│   └── i18n.html           # Terjemahan (ID/EN)
│
├── web/                    # Static web assets
│   ├── config.js           # ⚠️ Supabase URL + Anon Key (lihat catatan keamanan)
│   ├── supabase-api.js     # Auth, CRUD, Admin API wrapper
│   ├── finance-analysis.js # Perhitungan siklus dan analisis budget
│   ├── transaction-import.js # Parser dan validasi impor CSV
│   ├── manifest.webmanifest # PWA manifest
│   ├── sw.js               # Service Worker (Stale-While-Revalidate + Network-First)
│   └── icons/              # PWA icons (192px, 512px, maskable)
│
├── db/
│   ├── schema.sql          # Skema database awal (jalankan pertama kali)
│   └── 002_wallets.sql     # Tabel dompet dan transfer
│
├── supabase/
│   ├── functions/
│   │   ├── admin-password/ # Admin-only password reset (JWT required)
│   │   │   └── index.ts
│   │   └── telegram-bot/   # Supabase Edge Function (Deno)
│   │       └── index.ts
│   └── migrations/
│       ├── 20261114000000_multiuser_onboarding.sql  # profiles, trigger, RLS
│       ├── 20261114000001_telegram_pairings.sql     # telegram_pairings table
│       ├── 20261115000000_admin_panel_hardening.sql # Admin RLS, pairing, onboarding fixes
│       ├── 20261115040200_application_hardening.sql # Active account and transactional safeguards
│       ├── 20261116000000_financial_goals_and_transaction_search.sql
│       ├── 20261117000000_wallets_asset_purchases.sql
│       └── 20261118000000_comprehensive_upgrade.sql
│
├── tests/
│   ├── finance-analysis.test.js # Siklus, insight budget, dan progres target
│   └── transaction-import.test.js # Parsing dan validasi impor CSV
│
├── scripts/
│   └── generate_icons.mjs  # Generator ikon PNG dari Node.js
│
├── build.mjs               # Build script: src/* + web/*.js → dist/index.html
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Actions: test, build & deploy ke Pages
```

---

## 🚀 Quick Start (Lokal)

```bash
# Clone repo
git clone https://github.com/LiandiMiko/mykeuangan.git
cd mykeuangan

# (Opsional) Generate ulang ikon PWA
node scripts/generate_icons.mjs

# Build — hasilkan dist/index.html
node build.mjs

# Uji perhitungan siklus dan analisis budget
node --test

# Buka di browser
npx serve dist
# atau buka dist/index.html langsung
```

> **Catatan**: `dist/` di-gitignore. Hasil build tidak di-push ke GitHub; CI/CD yang akan build ulang saat deploy.

---

## 🛠 Setup Lengkap untuk Deployment Publik

### 1. Supabase — Database & Auth

1. Buat project baru di [supabase.com](https://supabase.com)
2. Salin **Project URL** dan **Anon Key** dari *Settings → API*
3. Edit `web/config.js`:

```js
const SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGc...';
```

### 2. Jalankan Migrasi SQL

Di **Supabase → SQL Editor**, jalankan file berikut **secara berurutan**:

#### Step 1 — Skema dasar
```sql
-- Jalankan isi file: db/schema.sql
```

#### Step 2 — Dompet dan Transfer
```sql
-- Jalankan isi file: db/002_wallets.sql
```

Jalankan setelah skema dasar dan sebelum onboarding, karena trigger pendaftaran membuat dompet bawaan.

#### Step 3 — Multi-User Onboarding
```sql
-- Jalankan isi file: supabase/migrations/20261114000000_multiuser_onboarding.sql
```

Migrasi ini akan membuat:
- Tabel `profiles` (data user: username, role, status suspended)
- Fungsi `is_admin()` untuk RBAC
- Trigger `handle_new_user()` — otomatis seed wallet, kategori default, settings saat user baru daftar
- **User pertama** yang mendaftar otomatis mendapat role `admin`
- RLS policies untuk semua tabel

#### Step 4 — Telegram Pairings
```sql
-- Jalankan isi file: supabase/migrations/20261114000001_telegram_pairings.sql
```

Membuat tabel `telegram_pairings` untuk OTP pairing (expire 10 menit).

#### Step 5 — Admin Panel Hardening
```sql
-- Jalankan isi file: supabase/migrations/20261115000000_admin_panel_hardening.sql
```

Migrasi ini membatasi perubahan profil hanya untuk admin, mengisi `user_id` pairing secara otomatis, dan memastikan hanya satu pendaftar pertama yang mendapat role admin.
Jika migrasi onboarding sebelumnya sudah dijalankan, tinjau role di `profiles`: backfill lama dapat memberi role admin ke semua akun yang sudah ada. Migrasi hardening tidak menurunkan role otomatis agar admin yang memang ditunjuk tidak kehilangan akses.

#### Step 6 — Perlindungan akses, pairing, dan transaksi
```sql
-- Jalankan isi file: supabase/migrations/20261115040200_application_hardening.sql
```

Migrasi ini menolak akses data untuk akun suspended, membatasi percobaan pairing Telegram, dan menambahkan operasi finansial atomik. Constraint nominal transaksi berlaku untuk perubahan baru. Bersihkan data lama yang tidak valid sebelum memvalidasi constraint penuh.

#### Step 7 — Target keuangan dan pencarian laporan
```sql
-- Jalankan isi file: supabase/migrations/20261116000000_financial_goals_and_transaction_search.sql
```

Migrasi ini membuat tabel target keuangan dengan RLS akun aktif dan fungsi pencarian transaksi berhalaman yang dibatasi rentang tanggal. Jalankan satu kali setelah migrasi sebelumnya; fitur target dan laporan baru memerlukannya.

#### Step 8 — Dompet e-wallet dan pembelian aset
```sql
-- Jalankan isi file: supabase/migrations/20261117000000_wallets_asset_purchases.sql
```

Migrasi ini mengizinkan jenis dompet e-wallet dan menambahkan fungsi atomik untuk menyimpan pembelian aset bersama transaksi pengeluaran kategori Investasi. Jalankan satu kali setelah migrasi sebelumnya. Pembelian dari dompet mengurangi saldo dompet dan menambah nilai aset.

#### Step 9 — Comprehensive Upgrade (Security, Stats, Category/Wallet RPC, Cairkan Aset, Target & Filter Dompet)
```sql
-- Jalankan isi file: supabase/migrations/20261118000000_comprehensive_upgrade.sql
```

Migrasi ini menambahkan:
- Trigger `prevent_admin_lockout` untuk mencegah admin men-suspend/mendemosi diri sendiri maupun admin aktif terakhir
- RPC `get_admin_platform_stats()` untuk statistik global admin panel
- RPC `rename_category_with_transactions()`, `delete_category()`, `delete_wallet()`, `liquidate_asset()`, `contribute_to_goal()`
- Pembaruan `search_user_transactions()` dengan filter opsional `p_wallet_id`

> Untuk project yang sudah berjalan, jangan jalankan ulang `db/002_wallets.sql`. Pastikan tabel dasarnya sudah tersedia, lalu jalankan migrasi baru setelah migrasi hardening.

### Impor transaksi CSV

Unduh template dari **Laporan & Ekspor**. Header yang digunakan adalah `tanggal,tipe,kategori,nominal,keterangan,dompet`; kolom `dompet` dan `keterangan` boleh dikosongkan. Tanggal memakai `YYYY-MM-DD`, tipe `Pemasukan` atau `Pengeluaran`, dan nominal berupa angka tanpa pemisah ribuan. Impor menerima maksimal 500 baris transaksi per file, menampilkan pratinjau, menolak baris yang tidak valid, dan melewati transaksi duplikat yang cocok.

### 3. Konfigurasi Supabase Auth

Di **Supabase → Authentication → Settings**:

| Setting | Nilai |
|---|---|
| **Allow new users to sign up** | ✅ **ON** (wajib untuk registrasi mandiri) |
| **Email Confirmations** | Sesuai preferensi (ON = verifikasi email, OFF = langsung bisa login) |
| **Site URL** | `https://liandiMiko.github.io/mykeuangan` (atau domain kustom) |
| **Redirect URLs** | Tambahkan URL Pages/domain kamu |

> ⚠️ **Berbeda dari setup lama**: versi sebelumnya menyarankan `Allow sign up = OFF`. Untuk multi-user, harus **ON**.

### 4. Deploy Edge Function Telegram Bot

Prasyarat: install [Supabase CLI](https://supabase.com/docs/guides/cli)

```bash
# Login ke Supabase CLI
supabase login

# Link ke project kamu
supabase link --project-ref <PROJECT_REF>

# Set secrets yang dibutuhkan
supabase secrets set TELEGRAM_BOT_TOKEN=<token_dari_@BotFather>
supabase secrets set CRON_SECRET=<random_string_panjang_min_32_char>
supabase secrets set GEMINI_API_KEY=<api_key_gemini>

# Deploy edge function (--no-verify-jwt agar bot bisa akses tanpa auth header)
supabase functions deploy telegram-bot --no-verify-jwt

# Reset password pengguna harus tetap memakai verifikasi JWT bawaan
supabase functions deploy admin-password
```

Lalu daftarkan webhook bot ke Telegram:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot
```

### 5. GitHub Pages & Actions

1. Push kode ke branch `main`
2. GitHub → *Settings → Pages → Source*: pilih **GitHub Actions**
3. Workflow `.github/workflows/deploy.yml` akan otomatis menjalankan tes, build & deploy saat push ke `main`

---

## 🔧 Admin Panel

Admin Panel hanya muncul di sidebar untuk user dengan role `admin`.
Deploy juga Edge Function `admin-password` dengan verifikasi JWT tetap aktif sebelum memakai reset password untuk akun pengguna lain.

**Fitur Admin Panel:**
- 📊 Metrics: total user, user aktif, user tersuspend
- 👥 Tabel user: email, username, role, status, tanggal daftar
- 🚫 Suspend / Aktifkan akun user
- 🔑 Toggle role: `user` ↔ `admin`
- 🔐 Atur ulang password pengguna lain; admin juga dapat mengganti password akunnya sendiri
- Riwayat pembaruan fitur yang dirilis

Catatan rilis dikelola di kode aplikasi dan README. Perbarui keduanya bersama setiap rilis; aplikasi tidak menulis ke GitHub saat runtime.

**Cara menjadi admin pertama:**
- User **pertama** yang mendaftar ke aplikasi otomatis mendapat role `admin` via trigger database
- Selanjutnya, admin bisa promote user lain via Admin Panel

---

## 📱 Menghubungkan Telegram (Self-Service OTP)

User bisa menghubungkan akun ke Telegram Bot secara mandiri:

1. Di aplikasi web → klik **"Hubungkan Telegram"** di sidebar
2. Sistem generate **OTP 8 digit** (berlaku 10 menit). Kode baru menggantikan kode pairing sebelumnya.
3. Buka Telegram, chat ke bot, kirim perintah:
   ```
   /link 12345678
   ```
   atau jika baru pertama kali pakai bot:
   ```
   /start PAIR_12345678
   ```
4. Bot akan konfirmasi: *"✅ Akun kamu berhasil dihubungkan!"*

Setelah terhubung, kamu bisa:
- Tanya saldo: `/saldo`
- Minta laporan bulanan
- Terima notifikasi otomatis dari cron job

---

## 📲 PWA — Install sebagai Aplikasi

MyKeuangan mendukung **Progressive Web App**:

- **Di Android (Chrome)**: Buka site → banner "Add to Home Screen" muncul otomatis
- **Di iOS (Safari)**: Share → "Add to Home Screen"
- **Di Desktop (Chrome/Edge)**: Ikon install di address bar

Fitur PWA:
- ✅ Shell halaman tersedia dari cache offline; autentikasi dan data keuangan memerlukan internet
- ✅ Ikon maskable (tampil bagus di semua launcher Android)
- ✅ Standalone mode (tanpa browser bar)
- ✅ Tema gelap (#0f172a) konsisten dengan UI

---

## 🔐 Keamanan & Catatan Penting

### web/config.js
File ini berisi Supabase URL dan **Anon Key**. Anon key **aman** untuk dipublikasikan karena:
- Dilindungi oleh **Row Level Security (RLS)** di semua tabel
- Hanya bisa baca/tulis data milik user yang sedang login

Namun jika kamu ingin repo **fully private**, pertimbangkan:
- Jadikan repo private di GitHub, atau
- Gunakan environment variable via GitHub Actions secrets (inject ke `config.js` saat build)

### CRON_SECRET
Nilai default `'27'` di versi lama **sangat lemah**. Ganti dengan string acak min 32 karakter:
```bash
supabase secrets set CRON_SECRET=$(openssl rand -base64 32)
```

### RLS (Row Level Security)
Semua tabel diproteksi RLS. User hanya bisa akses data miliknya. Admin aktif mendapat akses melalui fungsi `is_admin()` di tabel `profiles`. Akun suspended ditolak oleh kebijakan akses database.

### XSS Prevention
Data teks di-escape untuk konteks HTML. Event handler tidak boleh dibentuk dengan menginterpolasi data pengguna ke dalam kode inline.

### 🤖 Analisis Arus Keuangan AI (On-Demand Gemini)
- Di menu **Analisis AI** (`src/ai.html`) terdapat panel **Analisis Arus Keuangan AI (Gemini)**.
- Pengguna memasukkan **Gemini API Key** sendiri melalui tombol **Atur API Key Gemini** (key disimpan lokal di browser `localStorage` dan dikirim melalui header `x-goog-api-key`).
- **On-Demand**: AI **hanya** mengirim ringkasan payload arus kas ke Gemini 2.5 Flash saat pengguna menekan tombol **Analisis Arus Keuangan** — tidak pernah berjalan otomatis di latar belakang.

---

## 📝 Changelog — What's New in v2.0

### 18 November 2026: Wave v3.3 (Batch Catat Rutin, Net Worth Evolution, Bot Telegram Transfer/Utang, Ringkasan Cetak & Filter Kalender)
- **Batch Eksekusi Tagihan Rutin Jatuh Tempo**: Banner peringatan cerdas `#recurringDueBanner` di Dashboard mendeteksi seluruh tagihan rutin yang jatuh tempo pada siklus berjalan (`getDueRecurringBills`), dilengkapi tombol **`⚡ Catat Semua Sekaligus`** (`batchRecordRecurring`) dengan dialog konfirmasi sekali klik.
- **Grafik Riwayat Pertumbuhan Kekayaan Bersih (Net Worth Evolution)**: Visualisasi Chart.js 6 siklus ke belakang (`computeNetWorthSeries`, `#netWorthChart`) di Tabungan & Investasi berbasis saldo kas riil, aset, piutang, dan utang historis.
- **Ekstensi Bot Telegram (`/transfer`, `/utang`, `/piutang`)**: Perintah baru untuk transfer antar dompet (`/transfer [dari] [ke] [nominal]`), pencatatan pinjaman/pembayaran cicilan (`/utang pinjam|bayar [nama] [nominal]`), serta peminjaman/pelunasan pihak lain (`/piutang beri|terima [nama] [nominal]`) langsung dari chat Telegram.
- **Lembar Ringkasan Finansial Eksekutif Siap Cetak (1-Page Financial Statement)**: Tombol **Ringkasan Cetak** (`openFinancialStatementModal`) di header Laporan & Ekspor untuk menyusun dan mencetak preview posisi neraca, arus kas, metrik rasio, dan top pengeluaran secara elegan.
- **Filter Kalender Finansial & Proyeksi Target**: Filter pill cepat (*Semua / 🔴 Keluar / 🟢 Masuk*) pada Kalender Finansial Dashboard serta kalkulator proyeksi pencapaian target keuangan cerdas (*Milestone Projection*) pada kartu Target Keuangan.

### 18 November 2026: Wave v3.2 (Top-Up/Jual Emas &amp; USD, Alokasi Portofolio, Anomaly Detector, Restore JSON &amp; PWA Shortcuts)
- **Top-Up & Pencairan Parsial Emas (gram) & Valas USD**: Modal `topUpAsset` dan `withdrawAsset` (`src/script.html` + `web/supabase-api.js`) kini menghitung konversi unit dan menyinkronkan `quantity` & rata-rata tertimbang `buy_price` ke Supabase.
- **Pemilih Tanggal & Catat Cepat Rutin**: Tambah input tanggal pada modal **Transfer Antar Dompet** dan **Utang/Piutang** (`src/script.html`), serta tombol 1-klik **`⚡ Catat`** di setiap kartu jadwal `#recurringList`.
- **Alokasi Portofolio & Anomaly Detector**: Panel bar bertumpuk 5 kelas aset (`computeAssetAllocation` di `web/finance-analysis.js`, `#assetAllocationPanel` di `src/aset.html`) plus banner **Beban Biaya Rutin & Lonjakan Pengeluaran** (`detectSpendingAnomalies`) di `Budgeting`.
- **Restore JSON Anti-Duplikat & PWA Shortcuts**: Tambah tombol **Restore JSON** (`prepareBackupRestorePayload`) di `src/laporan.html`, **App Shortcuts** (`?action=pengeluaran|pemasukan|scan|budgeting`) di `web/manifest.webmanifest`, tombol **Install Aplikasi (PWA)** di sidebar `src/Index.html`, serta migrasi model default AI ke `gemini-3.8-flash` dengan auto-fallback.

### 18 November 2026: Wave v3.1 (Rincian Dompet, Rasio Finansial, Split Bill, Backup JSON &amp; PIN Lock)
- **Rincian Dompet & Filter Histori**: Klik kartu dompet di `src/dashboard.html` untuk modal ringkasan mutasi + transaksi terakhir (`openWalletDetailModal()`), tambah cari & filter dompet di `src/histori.html`, Mobile FAB (`#mobileFabBtn`), serta shortcut keyboard (`N`, `H`, `/`).
- **Rasio Kesehatan, Auto-Budget & Split Bill**: Panel 3 rasio otomatis (*Dana Darurat Runway*, *Savings Rate*, *Rasio Utang vs Aset*) di `src/aset.html`, Generator **Rekomendasi Budget Otomatis** 3 siklus di `src/budgeting.html`, dan **Split Bill / Patungan** otomatis ke `Piutang` di `src/form.html`.
- **Laporan Dompet & Backup JSON**: Tambah kolom `Dompet` di tabel `#table-laporan` dan `exportPDF()`, plus unduh **Backup JSON** penuh di `src/laporan.html`.
- **Profil & PIN Lock Semua User**: Semua pengguna (bukan admin saja) kini memiliki tombol pengaturan di sidebar untuk ubah nama tampilan (`api_updateOwnProfile`), ganti password, dan kunci layar PIN 4–6 digit SHA-256 lokal (`openAccountSettingsModal()`).

### 18 November 2026: Roadmap v2.1–v3.0 (AI Multimodal, Grafik Budgeting, Notifikasi & Offline Sync)
- **Scan Struk AI & Tanya Jawab Keuangan**: Tombol **Scan Struk (AI)** di Form Transaksi (`src/form.html`), handler foto struk & *voice note* Gemini 2.5 Flash pada bot Telegram (`supabase/functions/telegram-bot/index.ts`), serta panel **Tanya & Simulasi Keuangan AI** on-demand (`src/ai.html`).
- **Grafik Budgeting & Kalkulator Target**: Donut Chart pengeluaran per kategori + Bar Chart arus kas 6 bulan vs budget dan saran setoran bulanan target di `src/budgeting.html`.
- **Pusat Notifikasi & Offline Queue**: Ikon lonceng `#notifBellBtn` di header `src/Index.html` dan antrean transaksi offline IndexedDB di `src/features-v21.html` dengan sinkronisasi otomatis saat kembali online.
- **Investasi Emas/USD, Bank Mutation CSV & Ekspor Excel**: Dukungan aset Emas (gram), Valas USD, Saham/Reksa Dana (`refreshPrices()`), parser e-statement bank BCA/Mandiri (`web/transaction-import.js`), ekspor `.xls` (`src/laporan.html`), jatuh tempo & riwayat utang (`debtDueDates`), serta header mobile satu baris.

### 18 November 2026: Comprehensive Upgrade, Tata Letak Modular & On-Demand Gemini AI
- **AI Cashflow Analyzer (On-Demand)**: Halaman khusus analisis arus kas (`src/ai.html`) memakai Google Gemini 2.5 Flash (`buildAiCashflowPayload`, `buildGeminiCashflowPrompt`, `parseGeminiCashflowResponse` di `web/finance-analysis.js`) dengan input API key di browser dan eksekusi hanya saat tombol ditekan.
- **Budgeting, Target Keuangan & Transaksi Rutin**: Halaman `Budgeting` (`src/budgeting.html`) kini menggabungkan anggaran kategori & tren 6 bulan bersama *Target Keuangan* (alokasi tabungan dari dompet via `contribute_to_goal`) dan *Tagihan & Transaksi Rutin* bulanan (tambah, edit, jeda/aktifkan, hapus).
- **Tabungan & Investasi (Savings & Investment)**: Halaman khusus `Tabungan & Investasi` (`src/aset.html`) mengelola portofolio aset (beli maupun cairkan/jual ke dompet via `liquidate_asset`), grafik pertumbuhan 30 hari, serta *Riwayat Transfer Terakhir* dompet.
- **Laporan, Histori & Kalender Interaktif**: Halaman khusus `Histori Transaksi` (`src/histori.html`), filter dompet pada laporan, ekspor CSV terfilter, dan klik tanggal pada kalender untuk melihat/menambah transaksi di tanggal tersebut.
- **Tata Letak Dashboard & Sistem Tema Menyeluruh**: Dashboard (`src/dashboard.html`) difokuskan pada urutan *Arus Kas & Saldo* → *Dompet* → *Utang & Piutang* → *Kalender*. Sistem tema warna (`Indigo`, `Pink`, `Violet`, `Blue`, `Emerald`) di `src/styles.html` & `src/script.html` kini mengubah banner Hero, navigasi aktif, tombol utama, fokus ring, dan grafik portofolio secara menyeluruh di mode terang maupun gelap, disertai pembaruan logo dan detail UI.
- **Admin Panel & UX Mobile**: Statistik global platform, pencarian & filter daftar pengguna, proteksi DB self-lockout admin, dark mode pada form login & seluruh modal, tombol salin perintah `/link` Telegram, tombol aksi selalu tampil di layar sentuh, serta target klik ≥40–44px dengan `aria-label`.
- **Security & Performance Hardening**: Service Worker (`web/sw.js`) tidak lagi mencache endpoint `supabase.co` atau `googleapis.com`, Cache Storage dibersihkan saat logout, verifikasi secret constant-time SHA-256 pada `telegram-bot`, pin versi library CDN di `src/styles.html`, seragamkan password minimal 8 karakter, dan mutasi API hanya mengambil tabel yang berubah.
- Migrasi `supabase/migrations/20261118000000_comprehensive_upgrade.sql`.

### 17 November 2026: Dompet dan pembelian aset
- Tambah dompet dengan jenis bank, e-wallet, atau tunai beserta saldo awal, lalu transfer saldo antar dompet.
- Pembelian aset dapat memakai dompet sumber. Aset dan transaksi pengeluaran kategori Investasi tersimpan bersama dalam satu operasi.
- Tombol tambah kategori diberi warna hijau dan tanda plus. Header mobile ditata ulang agar kontrol utama tidak bertumpuk.
- Migrasi `20261117000000_wallets_asset_purchases.sql` menambahkan jenis dompet e-wallet dan pencatatan pembelian aset.

### 17 November 2026: Laporan dan fitur keuangan
- Laporan kini memiliki filter tanggal, tipe, kategori, pencarian, dan paginasi. Ekspor PDF memakai hasil filter.
- Impor CSV menyediakan pratinjau, validasi baris, deteksi duplikasi, dan batas 500 transaksi per file.
- Target keuangan menyimpan nominal terkumpul, nominal tujuan, dan tenggat opsional.
- Insight budgeting membandingkan pengeluaran dengan periode sebelumnya, serta menampilkan kategori terbesar dan yang melewati anggaran.
- Panel admin menampilkan catatan rilis yang sama dengan pembaruan di README.
- Migrasi `20261116000000_financial_goals_and_transaction_search.sql` menyiapkan tabel target keuangan dan pencarian transaksi berhalaman.

### 🔒 Security Hardening
- **Fix XSS**: Semua template literal yang render data user kini menggunakan `escapeHtmlJS()` / `escapeAttrJS()` — mencakup kartu utang, daftar transaksi, laporan, dropdown kategori & budget
- **Fix `.gitignore`**: Tambah `.env`, `.env.*`, `*.local` agar file environment tidak ter-commit
- **Fix AI Model**: Ganti model tidak-valid `gemini-3.5-flash-lite` ke `gemini-2.5-flash`
- **Fix null dereference**: Cron job refresh harga aset tidak lagi crash saat tidak ada user JWT (batch refresh semua user yang punya aset)

### 📲 Progressive Web App (PWA)
- **`web/manifest.webmanifest`**: Web App Manifest lengkap (name, short_name, icons, display: standalone, theme_color, background_color)
- **`web/sw.js`**: Service Worker dengan strategi:
  - *Stale-While-Revalidate* untuk aset statis (JS, CSS, HTML)
  - *Network-First* untuk request ke Supabase API
  - Offline fallback ke cache
- **`web/icons/`**: Set ikon PNG (192px, 512px, maskable) + SVG fallback
- **`scripts/generate_icons.mjs`**: Script Node.js untuk regenerate ikon dari scratch
- **`build.mjs`**: Sinkronisasi otomatis PWA assets ke `dist/` saat build

### 👥 Multi-User & Authentication
- **Register / Login / Lupa Password**: UI multi-mode di modal login (tab: Masuk | Daftar | Lupa Password)
- **Supabase Auth integration**: `signUp()`, `signInWithPassword()`, `resetPasswordForEmail()`
- **Auto-onboarding**: Trigger `handle_new_user()` otomatis seed:
  - Wallet default (Kas & BCA)
  - Kategori transaksi default (8 pengeluaran + 3 pemasukan)
  - Settings awal (mata uang IDR, bahasa ID)
- **Profile & Role**: Tabel `profiles` menyimpan username, role (`user`/`admin`), status `suspended`
- **Suspend check**: User suspended ditolak oleh RLS, fungsi admin, dan Telegram Bot, termasuk untuk sesi yang masih aktif
- **First-user admin**: User pertama otomatis jadi admin via trigger

### 🔧 Admin Panel
- **`src/admin.html`**: UI Admin Panel lengkap
- **Metrics cards**: Total user, user aktif, user tersuspend
- **User table**: Kolom email, username, role, status, tanggal daftar, aksi
- **Actions**: Suspend/Aktifkan akun, toggle role user ↔ admin
- **Password**: Admin dapat mengganti password sendiri atau mengatur ulang password akun lain melalui Edge Function yang memverifikasi sesi dan role admin
- **Visibility**: Nav "Admin" hanya muncul jika role = `admin`

### 🤖 Telegram Pairing OTP
- **Self-service pairing**: User bisa hubungkan akun sendiri tanpa bantuan admin
- **Flow OTP**: Web generate OTP 8 digit → user kirim `/link OTP` di bot → bot verifikasi & bind dengan pembatasan percobaan
- **Expire 10 menit**: OTP kadaluarsa otomatis (kolom `expires_at` di `telegram_pairings`)
- **Command `/start PAIR_OTP`**: Support deep link untuk user baru yang belum pernah pakai bot
- **`supabase/migrations/20261114000001_telegram_pairings.sql`**: Tabel `telegram_pairings` dengan RLS
- **`supabase/migrations/20261115040200_application_hardening.sql`**: Pembatasan akun aktif, percobaan pairing, dan operasi transaksi atomik
- **`web/finance-analysis.js`**: Perhitungan tren budget dan siklus gajian yang diuji otomatis

### 🗄️ Database Migrations
- **`20261114000000_multiuser_onboarding.sql`**: Profiles, RBAC, trigger, RLS lengkap untuk semua tabel
- **`20261114000001_telegram_pairings.sql`**: Tabel OTP pairing Telegram

---

## 🗺 Roadmap

Lihat [PWA_MULTIUSER_ROADMAP.md](./PWA_MULTIUSER_ROADMAP.md) untuk rencana pengembangan lengkap.

Prioritas berikutnya:
- [ ] Notifikasi push via FCM (Web Push API)
- [x] Multi-currency USD, Emas & Bank CSV import
- [x] Ekspor laporan ke Excel (.xls) & Scan Struk Gemini Vision

---

## 🛠 Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | Vanilla HTML5, CSS3, JavaScript (no framework) |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| Runtime | Deno (Edge Functions) |
| Build | Node.js (`build.mjs` — no bundler) |
| AI | Google Gemini 3.8 Flash (auto-fallback) |
| Bot | Telegram Bot API |
| Hosting | GitHub Pages + Supabase Cloud |

---

## 👤 Author

**LiandiMiko** — [github.com/LiandiMiko](https://github.com/LiandiMiko)

> Dibuat dengan ❤️ untuk manajemen keuangan pribadi yang lebih baik.
