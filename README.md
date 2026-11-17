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
| **Keuangan** | Transaksi, pencarian/filter/paginasi laporan, impor CSV dengan pratinjau dan deteksi duplikasi, kategori, budget bulanan, insight dan tren 6 bulan, utang/piutang |
| **Target** | Target tabungan dengan nominal terkumpul, tenggat opsional, dan progres |
| **Aset** | Portofolio saham & kripto dengan harga real-time |
| **Multi-User** | Registrasi mandiri, login, lupa password via email |
| **Admin Panel** | Kelola user, suspend/aktifkan akun, ubah role |
| **PWA** | Bisa di-install di HP/desktop; shell dapat dibuka offline, data tetap memerlukan internet |
| **Telegram** | Notifikasi & query saldo via bot, pairing via OTP mandiri |
| **AI** | Analisis keuangan & prediksi dengan Gemini 2.5 Flash |
| **Keamanan** | XSS sanitization, RLS Supabase, RBAC admin/user |

---

## 📁 Struktur Proyek

```
mykeuangan/
├── src/                    # Source frontend (HTML templates)
│   ├── Index.html          # App shell: layout, nav, modals
│   ├── script.html         # Semua logika JS (1 file besar)
│   ├── admin.html          # Admin panel UI (di-include ke Index)
│   ├── dashboard.html      # View: dashboard utama
│   ├── form.html           # View: tambah transaksi
│   ├── laporan.html        # View: laporan keuangan
│   ├── budgeting.html      # View: anggaran
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
│       └── 20261116000000_financial_goals_and_transaction_search.sql
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

---

## 📝 Changelog — What's New in v2.0

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
- [ ] GitHub Actions workflow untuk auto-deploy ke Pages
- [ ] Export laporan ke PDF
- [ ] Notifikasi push via FCM (Web Push API)
- [ ] Multi-currency support
- [ ] Import transaksi dari CSV/Excel

---

## 🛠 Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | Vanilla HTML5, CSS3, JavaScript (no framework) |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| Runtime | Deno (Edge Functions) |
| Build | Node.js (`build.mjs` — no bundler) |
| AI | Google Gemini 2.5 Flash |
| Bot | Telegram Bot API |
| Hosting | GitHub Pages + Supabase Cloud |

---

## 👤 Author

**LiandiMiko** — [github.com/LiandiMiko](https://github.com/LiandiMiko)

> Dibuat dengan ❤️ untuk manajemen keuangan pribadi yang lebih baik.
