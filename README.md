# 💰 MyKeuGuech — Personal Finance App (Web PWA & Android)

> **v3.19.0** — Multi-User SaaS · Offline-First PWA · Android App (Capacitor 8 / API 36 · Material 3) · Telegram Bot & Gemini AI · Security Hardened

Aplikasi manajemen keuangan pribadi multi-user berbasis **Web PWA (GitHub Pages)** dan **Aplikasi Android (`.apk` / `.aab` via Capacitor 8)** dari satu codebase yang sama — dibangun dengan **Vanilla JS modular + Static Tailwind CSS + Supabase (PostgreSQL RLS & Deno Edge Functions) + Gemini 2.5 Flash**.

🌐 **Live Web App (PWA):** [liandimiko.github.io/mykeuangan](https://liandimiko.github.io/mykeuangan/)

[![Live PWA](https://img.shields.io/badge/Live%20PWA-GitHub%20Pages-4f46e5?logo=githubpages&logoColor=white)](https://liandimiko.github.io/mykeuangan/)
[![Version](https://img.shields.io/badge/Version-v3.19.0-10b981)](./src/updates.html)
[![Android](https://img.shields.io/badge/Android-Capacitor%208%20%7C%20API%2036-3DDC84?logo=android&logoColor=white)](#-aplikasi-android-apk--aab--capacitor-8)
[![Supabase](https://img.shields.io/badge/Backend-Supabase%20RLS-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![PWA](https://img.shields.io/badge/PWA-Offline--First-blueviolet?logo=googlechrome)](#-pwa--install-sebagai-aplikasi)

---

## 📋 Daftar Isi

- [Fitur](#-fitur)
- [Struktur Proyek](#-struktur-proyek)
- [Quick Start (Lokal)](#-quick-start-lokal)
- [Setup Lengkap untuk Deployment Publik](#-setup-lengkap-untuk-deployment-publik)
  - [1. Supabase — Database & Auth](#1-supabase--database--auth)
  - [2. Jalankan Migrasi SQL](#2-jalankan-migrasi-sql)
  - [3. Konfigurasi Supabase Auth](#3-konfigurasi-supabase-auth)
  - [4. Deploy Edge Functions](#4-deploy-edge-functions)
  - [5. GitHub Pages & Actions](#5-github-pages--actions)
- [Admin Panel](#-admin-panel)
- [Menghubungkan Telegram (Self-Service OTP)](#-menghubungkan-telegram-self-service-otp)
- [PWA — Install sebagai Aplikasi](#-pwa--install-sebagai-aplikasi)
- [Aplikasi Android (.apk / .aab — Capacitor 8)](#-aplikasi-android-apk--aab--capacitor-8)
- [Keamanan & Catatan Penting](#-keamanan--catatan-penting)
- [Changelog — What's New in v2.0](#-changelog--whats-new-in-v20)
- [Roadmap](#-roadmap)
- [Tech Stack](#-tech-stack)

---

## ✨ Fitur

| Kategori | Fitur |
|---|---|
| **Keuangan** | Transaksi + Scan Struk AI, header mobile satu baris, kalender interaktif, pencarian/filter dompet/paginasi laporan, impor CSV & e-statement bank, ekspor CSV/Excel/PDF, kelola kategori & dompet, transaksi rutin, jatuh tempo utang/piutang |
| **Target** | Target tabungan dengan kalkulator rekomendasi setoran bulanan otomatis, alokasi langsung dari dompet, nominal terkumpul, tenggat opsional |
| **Aset** | Portofolio Crypto, Emas (gram), Valas USD, Saham/Reksa Dana dengan auto refresh harga, beli/top-up dari dompet, dan cairkan/jual ke dompet |
| **Multi-User** | Registrasi mandiri (min. 8 karakter), Google Sign-In OAuth, login/register dark mode, lupa password via email, hapus akun mandiri |
| **Admin Panel** | Statistik global platform, cari & filter user, suspend/aktifkan akun, proteksi self-lockout/admin terakhir |
| **PWA & Android** | Web PWA offline + snapshot IndexedDB + bundel vendor lokal; build Android Capacitor 8 (API 36), Back button bertahap, Share Sheet ekspor & deep link OAuth |
| **Telegram** | Notifikasi, query saldo, dan baca foto struk + voice note AI via Gemini 2.5 Flash; pairing via OTP mandiri + tombol salin perintah |
| **AI** | Analisis arus keuangan, Scan Struk Vision, & Tanya Jawab / Simulasi Keuangan on-demand dengan Google Gemini 2.5 Flash |
| **Keamanan** | XSS sanitization, RLS Supabase, constant-time secret verification, purge cache saat logout |

---

## 📁 Struktur Proyek

```
mykeuangan/
├── src/                    # Source frontend (HTML templates)
│   ├── Index.html          # App shell: layout, nav, modals
│   ├── admin.html          # Admin panel UI (di-include ke Index)
│   ├── updates.html        # Halaman Riwayat Pembaruan publik (di-include ke Index)
│   ├── dashboard.html      # View: ringkasan utama (Arus Kas, Dompet, Utang/Piutang, Kalender)
│   ├── aset.html           # View: Tabungan & Investasi (aset, grafik 30 hari & riwayat transfer)
│   ├── histori.html        # View: histori transaksi pemasukan & pengeluaran per siklus
│   ├── ai.html             # View: analisis arus keuangan AI Gemini (on-demand)
│   ├── form.html           # View: tambah transaksi
│   ├── laporan.html        # View: laporan keuangan
│   ├── budgeting.html      # View: anggaran kategori, burn rate forecast, target & transaksi rutin
│   ├── features-v35.html   # Stub referensi fitur pro (modular di web/ui-pro-*.js)
│   ├── styles.html         # Tema CSS, CDN ter-pin & fallback Tailwind config
│   ├── utang.html          # View: utang/piutang
│   └── i18n.html           # Terjemahan (ID/EN)
│
├── web/                    # Static web assets & modular JS
│   ├── config.js           # ⚠️ Supabase URL + Anon Key (lihat catatan keamanan)
│   ├── manifest.webmanifest # PWA manifest
│   ├── privacy.html         # Halaman Kebijakan Privasi publik
│   ├── terms.html           # Halaman Syarat & Ketentuan publik
│   ├── delete-account.html  # Halaman hapus akun mandiri publik
│   ├── tailwind-input.css   # Entry CSS untuk kompilasi statis Tailwind CSS
│   ├── sw.js                # Service Worker (Network-First + SKIP_WAITING & precache vendor)
│   ├── native-bridge.js     # Bridge Capacitor Android (Back, Share Sheet, SystemBars, OAuth)
│   ├── finance-analysis*.js # Analisis siklus, burn rate forecast, AI prompt, portofolio & backup
│   ├── finance-pro.js       # Quick-Add parser, #tag, auto-kategori, rekap tahunan & simulator
│   ├── transaction-import.js# Parser dan validasi impor CSV
│   ├── supabase-*.js        # Core, Auth UI (i18n), Records, Planning, Portfolio, Admin & callServer
│   ├── ui-*.js              # 15 modul UI inti hasil modularisasi script.html
│   ├── ui-feat-*.js         # 11 modul fitur PWA/offline/cache/charts/modals hasil modularisasi
│   ├── ui-pro-*.js          # 5 modul pro hasil modularisasi features-v35 (quick, palette, reports, insights, hooks)
│   └── icons/               # PWA icons (192px, 512px, maskable)
│
├── db/
│   ├── schema.sql          # Skema database awal (jalankan pertama kali)
│   └── 002_wallets.sql     # Tabel dompet dan transfer
│
├── supabase/
│   ├── functions/
│   │   ├── admin-password/ # Admin-only password reset (JWT required)
│   │   │   └── index.ts
│   │   ├── delete-account/ # Self-service permanent account deletion (JWT + confirmation)
│   │   │   └── index.ts
│   │   └── telegram-bot/   # Edge Function Deno (core, wallets, ai, planning, commands, jobs, index)
│   │       └── index.ts
│   └── migrations/
│       ├── 20261114000000_multiuser_onboarding.sql  # profiles, trigger, RLS
│       ├── 20261114000001_telegram_pairings.sql     # telegram_pairings table
│       ├── 20261115000000_admin_panel_hardening.sql # Admin RLS, pairing, onboarding fixes
│       ├── 20261115040200_application_hardening.sql # Active account and transactional safeguards
│       ├── 20261116000000_financial_goals_and_transaction_search.sql
│       ├── 20261117000000_wallets_asset_purchases.sql
│       ├── 20261118000000_comprehensive_upgrade.sql
│       ├── 20261120000000_hardening_assets_profile_wallets.sql
│       ├── 20261124000000_oauth_onboarding_display_name.sql # Google OAuth display_name fallback
│       └── 20261125000000_normalize_categories_and_search.sql # Normalisasi kategori & filter dompet utama
│
├── docs/
│   ├── ANDROID_PLAYSTORE_GUIDE.md # Panduan build Android Capacitor 8 (API 36) & Play Console
│   └── PLAYSTORE_LISTING_KIT.md   # Kit teks Store Listing ID/EN, Data Safety & deklarasi Play Console
│
├── tests/
│   ├── calendar-render.test.js    # Verifikasi grid & inisialisasi kalender
│   ├── finance-analysis.test.js   # Siklus, insight budget, dan progres target
│   ├── finance-pro.test.js        # Quick-Add, #tag, auto-kategori, rekap tahunan & kalkulator lokal
│   ├── i18n-build.test.js         # Paritas ID/EN, logout keys, SW SKIP_WAITING & build config
│   ├── pro-web-ui.test.js         # Bottom nav, Bento dashboard, toolbar, Android bridge & CI
│   ├── transaction-import.test.js # Parsing dan validasi impor CSV
│   └── updates-view.test.js       # Halaman pembaruan publik & pelacakan rilis baru
│
├── scripts/
│   ├── check-syntax.mjs           # Verifikasi syntax seluruh web/*.js & scripts/*.mjs
│   ├── fetch-vendors.mjs          # Unduh aset vendor ter-pin ke web/vendor/ untuk mode offline
│   ├── generate_icons.mjs         # Generator ikon PNG PWA dari Node.js
│   ├── generate-playstore-assets.mjs # Generator ikon Play Store 512x512 & feature graphic 1024x500
│   ├── prepare-native-assets.mjs  # Generator ikon adaptif 1024px & splash screen 2732px Android
│   ├── patch-android-project.mjs  # Patch SDK API 36, deep link OAuth & release keystore gradle
│   └── build-android.mjs          # Build lokal 1-perintah APK/AAB (cap:apk, cap:apk:release, cap:aab)
│
├── capacitor.config.json          # Konfigurasi Capacitor 8 (com.mykeuguech.app, SystemBars, Splash)
├── package.json                   # Skrip npm standar & Play Store Android build (`cap:sync`, `cap:apk`, `vendors:fetch`)
├── tailwind.config.js      # Konfigurasi build Tailwind CSS statis
├── build.mjs               # Build script: src/* + web/*.js → dist/index.html
└── .github/
    └── workflows/
        ├── android-build.yml # Cloud build APK & AAB Android Capacitor 8 (API 36)
        └── deploy.yml        # GitHub Actions: test, build & deploy ke Pages
```

---

## 🚀 Quick Start (Lokal)

Prasyarat: **Node.js 22+**.

```powershell
# Clone repo
git clone https://github.com/LiandiMiko/mykeuangan.git
cd mykeuangan

# Install dependensi (Capacitor 8 + asset generator)
npm install

# Siapkan konfigurasi web/config.js (isi SUPABASE_URL & SUPABASE_ANON_KEY)
# lalu cek syntax JS/MJS + jalankan seluruh unit test
npm run check

# Build produksi Web PWA (unduh vendor lokal + kompilasi Tailwind CSS + bundle dist/)
npm run build:prod

# Jalankan server lokal di http://localhost:4173
npm run dev

# (Opsional) Build Debug APK Android 1-perintah (membutuhkan JDK 21 + Android SDK 36)
npm run cap:apk
```

> **Catatan**: Folder hasil build `dist/`, `web/vendor/`, `assets/`, `playstore-assets/`, dan `release/` otomatis diabaikan Git. Anda juga bisa membangun `.apk`/`.aab` langsung di cloud via GitHub Actions (`.github/workflows/android-build.yml`) tanpa menginstall Android Studio.

---

## 🛠 Setup Lengkap untuk Deployment Publik

### 1. Supabase — Database & Auth

1. Buat project baru di [supabase.com](https://supabase.com)
2. Salin **Project URL** dan **Anon Key** dari *Settings → API*
3. Edit (atau buat) `web/config.js` menggunakan format objek global `window.APP_CONFIG`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGc...'
};
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

#### Step 10 — Hardening Aset Multi-Tipe, Profil Display Name & Hapus Dompet
```sql
-- Jalankan isi file: supabase/migrations/20261120000000_hardening_assets_profile_wallets.sql
```

Migrasi ini menambahkan/memperbarui:
- RPC `public.update_own_display_name(text)` agar seluruh pengguna (non-admin sekalipun) dapat mengubah nama tampilan profil dengan aman
- Pembaruan atomik `create_asset_with_expense()`, `top_up_asset()`, dan `liquidate_asset()` untuk mendukung `Crypto`, `Emas`, `USD`, `Saham`, `Cash`, dan `Other` beserta `unit_label`, `price_per_unit`, dan `buy_price` dalam satu transaksi database
- Hardening `delete_wallet()` untuk mempertahankan saldo awal serta riwayat transaksi/transfer non-internal saat dompet dihapus

#### Step 11 — OAuth Display Name Fallback
```sql
-- Jalankan isi file: supabase/migrations/20261124000000_oauth_onboarding_display_name.sql
```

Memperbarui trigger `handle_new_user()` agar menyertakan fallback `full_name` / `name` dari Google OAuth metadata saat membuat profil baru.

#### Step 12 — Normalisasi Kategori, Search Filter & Rename RPC
```sql
-- Jalankan isi file: supabase/migrations/20261125000000_normalize_categories_and_search.sql
```

Migrasi idempoten ini:
- Memperbarui `search_user_transactions()` agar filter `p_category` bersifat *case-insensitive* (tanpa spasi berlebih) dan filter `p_wallet_id` ikut menyertakan transaksi lama ber-`wallet_id IS NULL` saat memfilter dompet utama
- Memperbarui `rename_category_with_transactions()` agar mencocokkan varian huruf besar-kecil secara menyeluruh di transaksi, budget, dan jadwal rutin
- Membersihkan spasi dan menyelaraskan kapitalisasi kategori historis agar sesuai tabel `categories` milik pengguna

> Untuk project yang sudah berjalan, jangan jalankan ulang `db/002_wallets.sql`. Pastikan tabel dasarnya sudah tersedia, lalu jalankan migrasi baru setelah migrasi hardening.
> **Rotasi Rahasia Cron**: Bila sebelumnya menggunakan nilai contoh di `supabase/schedule.sql`, wajib rotasi `CRON_SECRET` di Supabase Edge Function Secrets dan perbarui job `pg_cron` memakai placeholder `<PROJECT_REF>` serta secret acak minimal 32 karakter.

### Impor transaksi CSV

Unduh template dari **Laporan & Ekspor**. Header yang digunakan adalah `tanggal,tipe,kategori,nominal,keterangan,dompet`; kolom `dompet` dan `keterangan` boleh dikosongkan. Tanggal memakai `YYYY-MM-DD`, tipe `Pemasukan` atau `Pengeluaran`, dan nominal berupa angka tanpa pemisah ribuan. Impor menerima maksimal 500 baris transaksi per file, menampilkan pratinjau, menolak baris yang tidak valid, dan melewati transaksi duplikat yang cocok.

### 3. Konfigurasi Supabase Auth

Di **Supabase → Authentication → URL Configuration & Settings**:

| Setting | Nilai |
|---|---|
| **Allow new users to sign up** | ✅ **ON** (wajib untuk registrasi mandiri) |
| **Email Confirmations** | Sesuai preferensi (ON = verifikasi email, OFF = langsung bisa login) |
| **Site URL** | `https://liandimiko.github.io/mykeuangan/` (atau domain kustom) |
| **Redirect URLs** | `https://liandimiko.github.io/mykeuangan/` (Web PWA) dan `com.mykeuguech.app://auth-callback` (Android APK/AAB) |

> ⚠️ **Berbeda dari setup lama**: versi sebelumnya menyarankan `Allow sign up = OFF`. Untuk multi-user, harus **ON**.
> 💡 **Produksi & Google Play Store**: Aktifkan provider **Google OAuth** (*Authentication → Providers → Google*) dengan Callback/Redirect URL menyertakan `com.mykeuguech.app://auth-callback`, dan pasang **Custom SMTP** gratis (seperti Brevo/Resend) di *Authentication → SMTP Settings* untuk menghilangkan batas 2 email/jam dan pembatasan penerima pada built-in SMTP Free Tier Supabase.

### 4. Deploy Edge Functions

Prasyarat: install [Supabase CLI](https://supabase.com/docs/guides/cli)

```bash
# Login ke Supabase CLI
supabase login

# Link ke project kamu
supabase link --project-ref <PROJECT_REF>

# Set secrets yang dibutuhkan (`https://localhost` wajib untuk origin WebView Android Capacitor)
supabase secrets set TELEGRAM_BOT_TOKEN=<token_dari_@BotFather>
supabase secrets set CRON_SECRET=<random_string_panjang_min_32_char>
supabase secrets set GEMINI_API_KEY=<api_key_gemini>
supabase secrets set ALLOWED_ORIGIN=https://<username>.github.io,https://localhost,http://localhost:4173

# Deploy edge function (--no-verify-jwt agar webhook Telegram bisa diakses server bot)
supabase functions deploy telegram-bot --no-verify-jwt

# Reset password admin & hapus akun mandiri tetap memakai verifikasi JWT bawaan
supabase functions deploy admin-password
supabase functions deploy delete-account
```

Lalu daftarkan webhook bot ke Telegram:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot
```

### 5. GitHub Pages & Actions

1. Push kode ke branch `main`.
2. GitHub → *Settings → Pages → Source*: pilih **GitHub Actions**.
3. Workflow `.github/workflows/deploy.yml` otomatis menjalankan `npm run check`, kompilasi static Tailwind CSS, unduh vendor self-hosted, build `dist/`, dan deploy ke GitHub Pages.
4. *(Opsional jika `web/config.js` belum ada di repo atau memakai Fork)* Isi **GitHub Repository Variables** `SUPABASE_URL` & `SUPABASE_ANON_KEY` (*Settings → Secrets and variables → Actions → Variables*) agar `.github/workflows/deploy.yml` dan `.github/workflows/android-build.yml` dapat menyusun `web/config.js` saat CI berjalan.

---

## 🔧 Admin Panel

Menu **Panel Admin** otomatis muncul di sidebar untuk akun dengan `role = 'admin'` dan `status = 'active'`. Deploy Edge Function `admin-password` (dengan verifikasi JWT aktif) sebelum memakai fitur reset password pengguna.

**Fitur Admin Panel:**
- 📊 **Metrics**: Total pengguna, pengguna aktif, user suspended, dan total akun Telegram terhubung (`get_admin_platform_stats()`)
- 👥 **Tabel & Pencarian Pengguna**: Daftar desktop & kartu mobile lengkap dengan cari nama/email serta filter status (`Aktif`/`Suspended`) dan role (`Admin`/`User`)
- 🚫 **Suspend / Aktifkan Akun**: Memblokir/membuka akses data langsung di level RLS (`is_active_user()`) dengan proteksi self-lockout
- 🔑 **Toggle Role (`user` ↔ `admin`)**: Mengelola hak akses admin disertai proteksi agar tidak menurunkan diri sendiri
- 🔐 **Atur Password Pengguna Lain**: Menetapkan password baru melalui `admin-password`, plus tombol ganti password akun sendiri
- 🗑️ **Penghapusan Akun**: Penghapusan akun mandiri dilakukan user via **Pengaturan Akun & PIN** (memanggil Edge Function `delete-account`), sedangkan penghapusan akun user lain oleh pengelola dilakukan dari **Supabase Dashboard → Authentication → Users**

Catat riwayat rilis di `src/updates.html` dan `README.md` setiap pembaruan; aplikasi tidak menulis ke GitHub saat runtime.

**Cara menjadi admin pertama:**
- User **pertama** yang mendaftar otomatis mendapat role `admin` via trigger `handle_new_user()`
- Akun tambahan (termasuk akun Google OAuth) dapat dipromosikan via Panel Admin atau query `UPDATE public.profiles SET role = 'admin', status = 'active' WHERE email = '...';` di Supabase SQL Editor

---

## 📱 Menghubungkan Telegram (Self-Service OTP)

User bisa menghubungkan akun ke Telegram Bot secara mandiri:

1. Di aplikasi web/Android → klik **"Hubungkan Telegram"** di sidebar
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

Setelah terhubung, kamu bisa mencatat transaksi teks bebas/foto struk/voice note AI, cek `/saldo` & `/budget`, mencari histori via `/cari`, kelola `/recurring`, serta menerima pengingat & laporan otomatis dari cron job.

---

## 📲 PWA — Install sebagai Aplikasi

MyKeuGuech mendukung **Progressive Web App (Offline-First)**:

- **Di Android (Chrome)**: Buka situs → tekan **Install Aplikasi (PWA)** di sidebar atau banner browser
- **Di iOS (Safari)**: Share → **Add to Home Screen**
- **Di Desktop (Chrome/Edge)**: Ikon install di address bar

Fitur PWA:
- ✅ **Offline-First Read Cache**: Snapshot IndexedDB (`mykeuangan_offline_db` v2) menampilkan data terakhir saat dibuka tanpa internet
- ✅ **Offline Write Queue**: Transaksi baru/edit tetap tersimpan di antrean IndexedDB dan otomatis disinkronkan saat koneksi kembali (hingga 3× retry)
- ✅ **Self-Hosted Vendor Assets**: Supabase JS, Chart.js, SweetAlert2, Flatpickr, jsPDF, ikon Phosphor, dan font Inter diprecache ke `dist/vendor/` oleh Service Worker (`web/sw.js` Network-First HTML + SHA-256 cache busting)
- ✅ **Ikon Maskable & Tema Adaptif**: Konsisten di mode terang maupun gelap (`#0f172a`) dengan App Shortcuts (`?action=pengeluaran|pemasukan|scan|budgeting`)

---

## 🤖 Aplikasi Android (.apk / .aab — Capacitor 8)

MyKeuGuech tersedia sebagai aplikasi Android native berbasis **Capacitor 8** (`com.mykeuguech.app`) menargetkan **Android 16 (API 36)** / `minSdk 24`:

- **Cloud Build via GitHub Actions (tanpa Android Studio):** Jalankan workflow **`.github/workflows/android-build.yml`** lewat tab **Actions → Run workflow** dengan pilihan `debug-apk` *(langsung pasang tanpa keystore)*, `release-apk`, `release-aab`, atau `all` untuk mengunduh artifact `MyKeuGuech-v3.19.0-*.apk` / `.aab` & aset Play Store. Aktifkan opsi **`publish_release`** (atau push tag `v*`) untuk otomatis menerbitkan `.apk` ke **GitHub Releases** (`releases/latest`).
- **Build Lokal 1-Perintah (Windows):** Setelah JDK 21 & Android SDK 36 siap, jalankan:
  ```powershell
  npm install
  npm run cap:apk           # hasil: release\MyKeuGuech-v3.19.0-debug.apk
  npm run cap:apk:release   # hasil: release\MyKeuGuech-v3.19.0-release.apk (butuh keystore)
  npm run cap:aab           # hasil: release\MyKeuGuech-v3.19.0-release.aab
  ```
- **Kapabilitas Native (`web/native-bridge.js`) & Popup Update Otomatis:** Tombol *Back* Android bertahap, ekspor CSV/Excel/PDF/Backup JSON via **Android Share Sheet**, Google Sign-In Chrome Custom Tab + pemulihan *cold-start* `App.getLaunchUrl()` (`com.mykeuguech.app://auth-callback`), *SystemBars* safe-area, *SplashScreen* adaptif, serta pengecekan versi jarak jauh (`dist/version.json` & tombol **Cek Pembaruan**) yang memunculkan Bottom Sheet update otomatis (mode opsional & wajib update via `package.json` → `appUpdate.minSupportedVersion`) mengarah ke **GitHub Releases** atau tautan Play Store.
- **Panduan Lengkap & Rilis Play Store:** Lihat [docs/ANDROID_PLAYSTORE_GUIDE.md](./docs/ANDROID_PLAYSTORE_GUIDE.md) dan kit deklarasi [docs/PLAYSTORE_LISTING_KIT.md](./docs/PLAYSTORE_LISTING_KIT.md).

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

### 25 November 2026: Wave v3.19 (Standar Tampilan Android Material Design 3, Bottom Sheet Dialog & Proporsi Mobile 360dp)
- **Material 3 Tonal Surfaces & Native Bottom-Sheet Modals (`src/styles.html`, `src/Index.html`)**: Menambahkan sistem permukaan tonal Material Design 3 (`#f2f5f9` siang / `#080d17` malam OLED), padding *safe-area* atas/bawah penuh, navigation drawer beradius `28px` dengan item kapsul `48dp`, bottom nav indikator pill `56×32dp`, top app bar `56dp`, serta mengubah seluruh modal konfirmasi & input SweetAlert2 menjadi **Android Bottom Sheet** otomatis di layar `< 640px` lengkap dengan *drag handle* dan `prefers-reduced-motion`.
- **Proporsi Dashboard 360dp, Kalender & Form Thumb-Zone (`src/dashboard.html`, `src/form.html`, `web/ui-calendar.js`, `web/ui-wallets.js`, `web/ui-dashboard.js`, `web/ui-budget.js`)**: Menata ulang KPI Strip Hero Net Worth menjadi 2 tingkat agar nominal tidak terpotong di layar 360dp, menambah badge lingkaran hari ini di Kalender + segmented pill 3 bagian, menyusun baris transaksi Dashboard agar judul tetap lega, serta melengkapi Form Transaksi dengan dropdown chevron native, rail chip nominal dapat digulir, dan bar tombol simpan melayang (`sticky bottom-0`).
- **Konsistensi Seluruh Halaman & Auth Sheet (`src/{histori,budgeting,aset,laporan,ai,utang,admin,updates}.html`, `web/supabase-auth*.js`, `tests/android-m3-ui.test.js`)**: Menyeragamkan header kompak, grid tombol 2 kolom simetris, metrik Admin 2×2, menu dropdown Laporan anti-terpotong di HP, kartu login beradius `28px` berkontrol `48px`, pembaruan versi Android ke `3.19.0`, dan suite uji `tests/android-m3-ui.test.js`.
- **Popup Update Otomatis & GitHub Releases (`build.mjs`, `web/ui-feat-updates.js`, `src/updates.html`, `.github/workflows/android-build.yml`)**: Menambahkan pembuatan manifes `dist/version.json` otomatis, pembanding versi semver + popup Material 3 Bottom Sheet (*soft update* dan *force update* lewat `minSupportedVersion`), tombol **Cek Pembaruan**, pengecualian cache SW untuk `/version.json`, CSP `https://liandimiko.github.io`, serta publikasi `.apk` otomatis ke **GitHub Releases** lewat workflow tag `v*` atau input `publish_release`.

### 25 November 2026: Wave v3.18 (Cloud Build Android .apk/.aab, Kit Rilis Play Store, + Buat Budget & Bot /cari)
- **Cloud Build Android CI, Fix Lockfile, 1-Command `.apk` & Cold-Start OAuth (`.github/workflows/android-build.yml`, `scripts/build-android.mjs`, `scripts/patch-android-project.mjs`, `web/native-bridge.js`, `package.json`, `.gitignore`)**: Menambahkan workflow GitHub Actions Android (JDK 21 + Android SDK 36 + Gradle cache) bebas ketergantungan `package-lock.json` (`cache: npm` dihapus agar tidak gagal saat setup) dengan output berversi `MyKeuGuech-v3.18.0-debug.apk`, `-release.apk`, & `-release.aab` serta ringkasan unduh `GITHUB_STEP_SUMMARY`; menambahkan skrip build lokal 1-perintah `npm run cap:apk` / `cap:apk:release` / `cap:aab`, pemulihan cold-start Google OAuth via `App.getLaunchUrl()`, serta memperbaiki Groovy `withInputStream` & `rootProject.file()` di `patch-android-project.mjs`.
- **Generator Aset & Kit Kepatuhan Play Store (`scripts/generate-playstore-assets.mjs`, `docs/PLAYSTORE_LISTING_KIT.md`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, `package.json`)**: Menambahkan perintah `npm run playstore:assets` untuk menghasilkan `playstore-assets/icon-512.png` (512×512) dan `playstore-assets/feature-graphic-1024x500.png` (1024×500), kit teks Store Listing ID/EN + jawaban Data Safety/Financial Features/App Access, serta alur terpadu dari migrasi SQL ke rilis Play Console.
- **1-Klik + Buat Budget & Upgrade Bot Telegram (`web/ui-budget.js`, `supabase/functions/telegram-bot/{planning,commands,index}.ts`)**: Menambahkan chip **`+ Budget <Kategori>`** berprediksi nominal di panel *Pengeluaran di Luar Budget*, mempercantik `/budget` Telegram dengan progres bar `▓░` + ringkasan transaksi luar budget, serta menambahkan perintah **`/cari`** (`handleCari`) untuk mencari riwayat transaksi langsung dari Telegram.

### 25 November 2026: Wave v3.17 (Normalisasi Kategori Lintas Fitur, Auto-Kategori Kata Utuh & Audit Budgeting)
- **Normalisasi Kategori Budgeting & Panel Luar Budget (`web/finance-analysis-core.js`, `web/finance-analysis-portfolio.js`, `web/ui-budget.js`, `web/finance-pro.js`)**: Menyelaraskan pencocokan kategori secara *case-insensitive* dan tanpa spasi di `summarizePeriod()`, `aggregateWalletAndPeriodFlows()`, `recommendCategoryBudgets()`, `computeAnnualRecap()`, `compareTwoPeriods()`, dan `renderBudgeting()` agar varian seperti `laundry` / `Laundry ` otomatis terhitung ke kartu budget `Laundry`, plus kartu lipat **Pengeluaran di Luar Budget** untuk memeriksa dan mengedit transaksi yang keluar dari kategori budget.
- **Perbaikan Auto-Kategori Kata Utuh, Form Edit, CSV, Laporan & Restore (`web/finance-pro.js`, `web/ui-form.js`, `web/ui-recurring.js`, `web/ui-feat-ai.js`, `web/transaction-import.js`, `web/ui-reports.js`, `web/ui-state.js`, `web/supabase-records.js`, `web/supabase-planning.js`, `web/ui-pro-palette.js`)**: Menggunakan batas kata utuh serta memprioritaskan aturan kustom & kategori pengguna di `applyAutoCategoryRules()` (mencegah substring seperti `pakaian` → `kai` atau `botol` → `tol`), mencegah `editTransaction()` & modal jadwal rutin menimpa kategori yang terhapus/beda kapitalisasi, menyamakan filter dompet utama + kategori di Laporan, menormalkan `api_addCategory()` untuk Restore JSON, dan mengkanonisasi kolom kategori impor CSV.
- **Bot Telegram & Migrasi SQL (`supabase/functions/telegram-bot/*.ts`, `supabase/migrations/20261125000000_normalize_categories_and_search.sql`)**: Menambahkan `normalizeCatKey()` & `resolveUserCategory()` pada parsing Gemini AI, `/tambah`, `/batch`, `/budget`, `/recurring`, dan laporan mingguan bot, serta migrasi SQL idempoten untuk `search_user_transactions()`, `rename_category_with_transactions()`, dan pembersihan data kategori historis.

### 25 November 2026: Wave v3.16 (Bundel Vendor Offline 100%, Bridge Native Android & Setup Capacitor 8 API 36)
- **Bundel Vendor Lokal 100% Offline (`scripts/fetch-vendors.mjs`, `build.mjs`, `web/sw.js`, `.github/workflows/deploy.yml`, `.gitignore`)**: Mengunduh versi ter-pin Supabase JS, Chart.js, SweetAlert2, Flatpickr, jsPDF, ikon Phosphor `.woff2`, dan font Inter ke `web/vendor/` lalu disalin ke `dist/vendor/`, ditulis ulang dari tag CDN di `dist/index.html`, dan diprecache ke Service Worker.
- **Bridge Native Android & Kualitas EN (`web/native-bridge.js`, `src/Index.html`, `src/styles.html`, `web/ui-shell.js`, `web/supabase-auth.js`, `web/ui-export.js`, `web/ui-feat-backup.js`, `web/ui-reports.js`, `web/ui-feat-hooks.js`, `web/ui-feat-account.js`)**: Menangani tombol *Back* Android bertahap, ekspor file CSV/Excel/PDF/Backup JSON via Android Share Sheet (`saveOrShareFile()`), deep link Google OAuth `com.mykeuguech.app://auth-callback`, penyembunyian prompt install PWA + skip registrasi SW di native app, CSS `SystemBars` (`--safe-area-inset-*`), serta dukungan bahasa EN pada modal Pengaturan Akun, PIN Lock, Catat Cepat, dan Ekspor.
- **Capacitor 8 Android API 36 & Perbaikan Config (`capacitor.config.json`, `package.json`, `scripts/prepare-native-assets.mjs`, `scripts/patch-android-project.mjs`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, `web/delete-account.html`)**: Menyiapkan konfigurasi & skrip build Android 16 (API 36), generator ikon adaptif & splash screen, panduan upload keystore + rilis Play Store, dan memperbaiki pembacaan `window.APP_CONFIG` pada `web/delete-account.html` & fallback CI workflow.

### 24 November 2026: Wave v3.15 (Google Sign-In OAuth, Kesiapan Legal Play Store, Hapus Akun Mandiri & True Offline Read Cache)
- **Upgrade Auth & Onboarding (`web/supabase-auth-ui.js`, `web/supabase-auth.js`, `supabase/migrations/20261124000000_oauth_onboarding_display_name.sql`)**: Menambahkan tombol **Lanjutkan dengan Google** (`signInWithOAuth`), memperbaiki alur lupa kata sandi (`redirectTo` + `PASSWORD_RECOVERY` modal ganti password), memperbarui trigger `handle_new_user()` agar mengambil `full_name` / `name` dari metadata Google OAuth, serta menyertakan cache profil lokal aman (`mk_cached_profile_v1`) saat membuka aplikasi offline.
- **Kepatuhan Google Play Store (`supabase/functions/delete-account/index.ts`, `web/delete-account.html`, `web/privacy.html`, `web/terms.html`, `web/supabase-admin.js`, `web/ui-feat-account.js`, `build.mjs`, `web/manifest.webmanifest`)**: Menambahkan Edge Function `delete-account` dengan validasi konfirmasi + guard admin aktif terakhir, alur hapus akun mandiri di Pengaturan Akun maupun halaman web publik `delete-account.html`, halaman hukum `privacy.html` & `terms.html` yang dibundel oleh `build.mjs`, serta `"id": "./index.html"` pada `manifest.webmanifest`.
- **True Offline Read Cache, PIN Hardening & Bugfix Audit (`web/ui-feat-offline.js`, `web/ui-feat-cache.js`, `web/ui-shell.js`, `web/ui-state.js`, `web/sw.js`, `web/supabase-records.js`, `web/ui-export.js`, `web/ui-reports.js`)**: Menambahkan IndexedDB snapshot store `offline_snapshot` v2 agar PWA menampilkan data tersimpan terakhir saat dibuka offline (`Mode Offline · Data Cache Lokal`), memperketat PIN lokal (cooldown brute-force 60 detik, verifikasi PIN lama saat hapus/ganti PIN, dan auto-lock setelah 2 menit idle), memisahkan cache HTML halaman legal di Service Worker, serta memperbaiki dedup `keterangan` case-insensitive di `supabase-records.js`, total PDF bebas kategori Utang/Piutang di `ui-export.js`, dan nama file `template-transaksi-mykeuguech.csv`.

### 23 November 2026: Wave v3.14 (Ketahanan PWA Offline, Impor CSV Multi-Bank, Restore JSON 8 Koleksi, Bot Timeout & CI Verify)
- **Bugfix Core Frontend, Chart & Aset (`web/ui-dashboard.js`, `web/ui-feat-hooks.js`, `web/ui-pro-hooks.js`, `web/ui-shell.js`, `web/supabase-auth.js`, `web/ui-assets.js`, `web/ui-feat-charts.js`, `web/ui-feat-ai.js`, `web/ui-asset-ops.js`, `web/ui-pro-quick.js`)**: Mengekspor `buildEmptyTxPlaceholder()` agar state kosong Histori berjalan mulus, memblokir shortcut keyboard huruf saat `#mkCommandPalette` aktif & membatasi `Escape`, membersihkan `mk_last_market_refresh_ts` saat logout, menambahkan dukungan `prefers-reduced-motion` pada `Chart.defaults`, `window.scrollTo`, serta seluruh chart, menempatkan legend donut chart di bawah pada layar HP (`< 640px`), menghapus dead code `runAiFinancialChat()` lama di `ui-feat-ai.js`, memformat nominal IDR di modal Top-Up/Withdraw Aset, serta memfilter kategori & menambah pemilih dompet pada modal Template Cepat.
- **PWA Offline Queue, CSV E-Statement, Debt Cap & Restore 8 Koleksi (`web/sw.js`, `web/ui-feat-offline.js`, `web/ui-feat-updates.js`, `web/transaction-import.js`, `web/finance-pro.js`, `web/ui-pro-insights.js`, `web/finance-analysis-backup.js`, `web/ui-feat-backup.js`)**: Mem-precache `icon-512.png` & `icon-maskable.png`, menormalkan cache HTML `/?action=...` ke `./index.html` dengan `event.waitUntil`, menggunakan ulang koneksi IndexedDB + penanganan item poison-pill maksimal 3 kali retry (**Coba Ulang** / **Buang Gagal** + pill `Gagal (N)`), meningkatkan parser CSV rekening bank (preambel hingga 15 baris, `IDR`, tanda kurung akuntansi, suffix `DB/CR` tanpa spasi, dedup case-insensitive), mendukung token `Rp` di Quick-Add, menandai simulasi utang `capped` 600 bulan beserta peringatan UX, serta memperluas Backup/Restore JSON ke **8 koleksi** (`categories`, `wallets`, `transactions`, `budgets`, `goals`, `recurring`, `assets`, `debtDueDates`) lengkap dengan pemetaan ulang `walletId`.
- **Telegram Bot Hardening & GitHub Actions CI (`supabase/functions/telegram-bot/*.ts`, `.github/workflows/deploy.yml`)**: Menyeragamkan branding `MyKeuGuech Bot` / `MyKeuGuech`, menambahkan `AbortSignal.timeout()` di `tg()`, Gemini AI, media Telegram, dan CoinGecko, memperluas `CRYPTO_MAP` (`POL`, `SUI`, `TON`, `LTC`, `BCH`, `NEAR`, `APT`, `RENDER`), membatasi rentang query transaksi di cron `dailyReminder` (366 hari) & `weeklyReport` (7 hari) via filter server `.gte('tanggal', ...)`, memisahkan CI ke job `verify` (PR + push) & `deploy` di Node 22, serta memperbarui `tests/*.test.js`.

### 22 November 2026: Wave v3.13 (MyKeuGuech Rebrand, Mobile-Native CSS, Motion Craft, Form Inline Validation & WCAG Polish)
- **Branding `MyKeuGuech` & Hierarki WCAG (`web/manifest.webmanifest`, `src/*.html`, `web/ui-*.js`)**: Menyeragamkan nama produk menjadi **MyKeuGuech** across UI chrome, manifest PWA, ekspor PDF (`web/ui-export.js`), Backup JSON (`web/ui-feat-backup.js`), notifikasi browser (`web/ui-pro-hooks.js`), dan bot setup (`web/ui-admin.js`), merapikan hierarki heading `<h1..h3>` di seluruh view, mengganti tombol info `<i class="ph-info">` & toggle nominal Hero menjadi kontrol interaktif aksesibel (`showNetWorthInfo()`, `#heroHideNominalBtn`), menambah `aria-pressed` pada filter & switch tema/bahasa, serta menaikkan kontras badge/teks mode terang dan kolom `tabular-nums`.
- **Mobile-Native, Form UX & Panel Admin Mobile (`src/styles.html`, `tailwind.config.js`, `src/Index.html`, `src/form.html`, `src/admin.html`, `web/ui-form.js`, `web/ui-admin.js`)**: Mengaktifkan `future.hoverOnlyWhenSupported` agar tidak terjadi sticky hover di layar sentuh, menambah `viewport-fit=cover`, `interactive-widget=resizes-content`, `100dvh`, `env(safe-area-inset-*)`, input font-size minimal `16px` pada `pointer: coarse`, `enterkeyhint`, auto-grow note `#tr_keterangan`, validasi inline `novalidate` + `aria-invalid` pada form transaksi & split-bill (`setFormFieldError`), IDR formatted nominal across modals (`bindNominalInputs`), konfirmasi singkat hapus 1 transaksi dengan nama kategori & nominal + informasi Undo 6 detik, tombol **Reset Filter** di Histori/Laporan, serta daftar kartu mobile `#adm-user-mobile-list` di Panel Admin.
- **Motion Craft & Prefers Reduced Motion (`src/styles.html`, `web/ui-form.js`, `web/ui-pro-palette.js`, `web/ui-shell.js`)**: Mengganti seluruh `transition-all` dengan transisi terarah memakai token easing (`--ease-out`, `--ease-drawer`), melengkapi `.mk-toast` Undo 6 detik dengan progress bar yang jeda saat hover/focus/tab tersembunyi, menjaga `#mkCommandPalette` tetap 0ms instan dengan focus trap `Tab` & pemulihan fokus (`previousFocusEl`), fokus balik drawer `#sidebar`, serta dukungan proporsional `prefers-reduced-motion` dan `prefers-reduced-transparency`.

### 21 November 2026: Wave v3.12 (Modularisasi 100% Frontend, Input Nominal IDR, Undo Delete, Burn Rate Forecast & Multi-Origin CORS)
- **Fix Sinkronisasi Bulk Laporan & Ketahanan Startup (`web/ui-pro-reports.js`, `web/ui-state.js`, `web/ui-shell.js`, `web/ui-feat-offline.js`)**: Memperbaiki bug aksi massal Laporan (`addedTransactions` & `deletedTransactionIds` agar seluruh baris ter-update seketika di state lokal), mengganti spinner startup dengan Skeleton Shimmer Dashboard + banner **Muat Ulang Data** saat gagal muat awal (mencegah `Rp 0` palsu), serta menambahkan pill status jaringan `#networkStatusPill` (`Offline` / `Sync (N)`).
- **Modularisasi Total `features-v35.html` → 5 Modul `web/ui-pro-*.js` (`build.mjs`, `web/ui-pro-*.js`)**: Memecah ~1.143 baris JS pro terakhir dari HTML ke `ui-pro-quick.js`, `ui-pro-palette.js`, `ui-pro-reports.js`, `ui-pro-insights.js`, dan `ui-pro-hooks.js` (kini **30 modul UI** penuh bebas `.innerHTML`), membersihkan cache AI saat pindah periode & duplikasi strip rebalance, serta menghapus seluruh `alert()` native di `supabase-core.js` / `supabase-auth.js`.
- **UX Transaksi & Analitik Fintech (`src/form.html`, `src/budgeting.html`, `web/ui-form.js`, `web/ui-budget.js`, `web/finance-analysis-backup.js`)**: Input nominal ribuan otomatis (`1.500.000`) + tombol chip cepat (`+25rb`–`+500rb` & `Reset`), toast **Batalkan (Undo)** 6 detik pasca hapus transaksi, **Burn Rate & Proyeksi Akhir Siklus** (`computeCycleForecast`), layar Auth dwibahasa ID/EN + indikator kekuatan kata sandi, aksesibilitas (`skip_main`, `aria-current`, `prefers-reduced-motion`), multi-origin `ALLOWED_ORIGIN` + `Vary: Origin` di Edge Functions, serta `scripts/check-syntax.mjs` + `npm run check` / `npm run dev`.

### 20 November 2026: Wave v3.11 (Forensic Hardening P0–P2, Full Frontend Modularization 25 Modul UI & Bot Upgrade)
- **Fix Produksi Static Tailwind & Keamanan (`web/ui-budget.js`, `web/ui-state.js`, `src/features-v35.html`, `build.mjs`)**: Menghilangkan kelas dinamis status warna di Budgeting ke lookup kelas statis penuh, memperkuat `escapeAttrJS()` untuk menetralkan HTML entity (`&#39;`) serta newline sebelum render atribut event handler, mengganti pemakaian `escapeAttrJS` pada atribut HTML biasa ke `escapeHtmlJS`, memusatkan rendering HTML ke `renderHtml()` (`DOMParser` + penghapusan `<script>`) dan `<option>` ke `renderSelectOptions()` DOM murni (skor `aislop` naik ke `93/100`, `0 warning`), memperkuat guardrail regex Play CDN + memangkas `'unsafe-eval'` dari CSP hasil build `dist/index.html`.
- **Modularisasi Frontend Total (`web/ui-*.js`, `web/ui-feat-*.js`, `package.json`)**: Memecah `src/script.html` & `src/features-v21.html` menjadi **25 modul fokus (`15 web/ui-*.js` + `10 web/ui-feat-*.js`)** di bawah 330 baris agar seluruh kode JavaScript klien tercakup lint statis `aislop`, menghapus duplikat dead code `openNotificationsModal`, serta menambahkan `package.json`.
- **Performa Startup, PWA Offline & i18n (`web/ui-shell.js`, `web/sw.js`, `src/styles.html`, `src/i18n.html`)**: Memindahkan auto-refresh harga pasar ke background non-blocking ber-cooldown 10 menit + sinkronisasi snapshot, mempersempit bypass Service Worker ke `generativelanguage.googleapis.com` agar Google Fonts ikut ter-cache offline (plus precache `icon-192.png` & respons offline `503`), memindahkan font Inter ke `<link>` + menyamakan `boxShadow.xs` pada fallback `styles.html`, serta memperbaiki `updateDashboardTitle()` agar bahasa EN tetap sinkron.
- **Upgrade Telegram Bot & Test Suite (`supabase/functions/telegram-bot/*.ts`, `tests/i18n-build.test.js`)**: Menambahkan loop fallback model + safe `.json()` parsing pada `/insight` dengan default `gemini-2.5-flash` di bot & web, menambahkan pencocokan dompet pintar `matchWalletFromText` (`ewallet` & nama dompet kustom), membuka `/recurring add` untuk tanggal `1..31`, memperbaiki laporan `/budget copy` (`rows.length`), merapikan note/wallet default cron recurring, serta memperluas guard regresi di `tests/`.

### 20 November 2026: Wave v3.10 (Production-Grade Modularization, Static Tailwind CI, Mobile Laporan Cards, Auth Redesign, Security & PWA Polish)
- **Modularisasi Total Codebase (`web/finance-analysis*.js`, `web/supabase-*.js`, `supabase/functions/telegram-bot/*.ts`)**: Memecah seluruh file besar (>1.100 baris) menjadi modul-modul fokus di bawah 320 baris beserta perbaikan bug latensi `this.finishAssetWalletMutation` di modul portofolio—menghilangkan seluruh peringatan `complexity/file-too-large`.
- **Performa CSS Statis CI & Pembaruan PWA (`tailwind.config.js`, `web/tailwind-input.css`, `.github/workflows/deploy.yml`, `web/sw.js`)**: Mengompilasi CSS Tailwind v3.4.17 secara statis saat build CI (menggantikan CDN runtime JIT ~350 KB dan menjamin tampilan offline penuh), serta melengkapi Service Worker `SKIP_WAITING` + `controllerchange`.
- **Keamanan & Privasi (`web/supabase-auth.js`, `src/Index.html`, `src/styles.html`)**: Menambahkan header meta `Content-Security-Policy` & `Referrer-Policy`, `crossorigin="anonymous"` di seluruh CDN ter-pin, serta memperluas pembersihan `logout()` ke semua **13 key pengguna** di `localStorage` (termasuk Quick Templates, Auto-Cat Rules, Rebalance Targets, dan Browser Notif).
- **Redesign Auth, Laporan Mobile Cards & Polish Interaksi (`web/supabase-auth.js`, `src/laporan.html`, `src/script.html`, `src/features-v35.html`, `src/i18n.html`)**: Memperbarui overlay Login/Register agar selaras dengan brand & tema pengguna, menghadirkan tampilan kartu responsif `#list-laporan-mobile` yang tersinkron dengan bulk checkbox, navigasi keyboard `ArrowUp/ArrowDown/Enter` pada Command Palette (`Ctrl+K`), merapikan sel & label Kalender Bento, membersihkan sisa `console.log`, serta menambah test paritas `tests/i18n-build.test.js`.

### 20 November 2026: Wave v3.9 (UI/UX Cohesion, Mobile Bottom Nav & Perbaikan 13 Ikon Phosphor)
- **Redesign Mobile Bottom Navbar & Aksi Cepat (`src/Index.html`, `src/styles.html`, `src/features-v35.html`, `src/features-v21.html`)**: Menata ulang `#mobileBottomNav` menjadi grid 5 kolom simetris (`grid-cols-5`) dengan indikator pill pada tab aktif, tombol tengah **`+ Catat`** berikon crisp (`ph-bold ph-plus`) + ring border, auto-hide saat membuka Form Transaksi, serta mempercantik popup 4 aksi cepat dan header atas mobile agar sejajar penuh pada layar `>= 360px`.
- **Perbaikan 13 Ikon Phosphor v2.1.1 & Guard Regresi (`src/*.html`, `tests/pro-web-ui.test.js`)**: Mengoreksi seluruh kelas invalid `ph ph-*-bold` menjadi `ph-bold ph-*` (`ph-plus`, `ph-lightning`, `ph-check`, `ph-lock-key`) yang sebelumnya tampil blank pada Quick-Add, Dompet, Aset, Budgeting, Target, Rutin, Form Transaksi, dan Utang/Piutang, lengkap dengan test regresi statis di `tests/pro-web-ui.test.js`.
- **Executive Bento Dashboard (`src/dashboard.html`, `src/script.html`, `src/styles.html`, `src/features-v35.html`)**: Memadatkan 7 blok Dashboard menjadi 3 zona terstruktur—Hero Net Worth menyatu dengan strip 3 KPI Arus Kas, spotlight Quick-Add + template chips 1 baris gulir horizontal (`.no-scrollbar`), serta Bento 2 kolom (`xl:grid-cols-12`) berisi Kalender di kiri dan kartu Dompet berbaris rapat + split compact Utang/Piutang di kanan.
- **Keseragaman Visual Lintas Halaman (`src/dashboard.html`, `src/aset.html`, `src/histori.html`, `src/budgeting.html`, `src/laporan.html`, `src/ai.html`, `src/form.html`, `src/utang.html`, `src/admin.html`, `src/updates.html`)**: Menyelaraskan header ber-tile ikon (`w-11 h-11 rounded-2xl`), tipografi (`font-extrabold`), radius kartu (`rounded-3xl`) & tombol/input (`rounded-xl`), dropdown Laporan agar tidak terpotong di HP (`left-0 sm:left-auto sm:right-0`), padding form mobile + `min-w-0` di `#tr_kategori`, serta pemeliharaan kompatibilitas unit test `tests/finance-pro.test.js` & `tests/transaction-import.test.js`.

### 20 November 2026: Wave v3.5–v3.8 (Mobile Bottom Nav, Quick-Add Kilat, #Tag & Auto-Kategori, Bulk Actions, Rekap Tahunan, Kalkulator Lokal, AI Chat Multi-Turn, Rebalancing & Refactor)
- **Mobile-First UX & Catat Kilat (v3.5)**: Menambahkan Bottom Navigation Bar 5-tab khusus layar kecil (`#mobileBottomNav`), input Quick-Add 1 baris ala Telegram (`parseQuickTxInput`) + template transaksi cepat (`buildFrequentTemplates` & pin manual), merapikan 8 tombol Laporan menjadi dropdown **Impor & Aturan** (`#lapImportMenu`) dan **Ekspor & Backup** (`#lapExportMenu`), toast update PWA otomatis, serta **Command Palette (`Ctrl+K`)**.
- **Fitur Pro Lintas Siklus (v3.6)**: Sistem `#Tag` + filter chip di Histori & Laporan (`#historiTagBar`, `#lapTagBar`), aturan **Auto-Kategori** kustom (`openAutoCatRulesModal`) yang terintegrasi ke Quick-Add dan impor CSV BCA/Mandiri (`TransactionImport.parseTransactionCsv`), checkbox aksi massal Laporan (`#lapBulkBar`), **Rekap Tahunan 12 Siklus & Perbandingan Periode**, serta modal **Kalkulator Finansial Lokal** (*Pelunasan Utang Snowball/Avalanche*, *Bunga Majemuk*, dan *Cicilan vs Tunai*).
- **AI Multi-Turn, Rebalancing Portofolio & Notifikasi Browser (v3.7)**: Mengupgrade **AI Financial Chat** ke percakapan berlanjut multi-turn + cache analisis siklus aktif (`mk_ai_analysis_cache_v1` & `mk_ai_chat_history_v1` ikut dibersihkan saat logout), menambahkan **Target Alokasi & Rebalance Portofolio** (`openRebalanceTargetsModal`), dan pengingat **Web Notification Opt-In**.
- **Performa, Arsitektur & Kualitas Kode (v3.8)**: Menambahkan `<link rel="preconnect">`, `defer` pada `jspdf`, jalur opsional CSS Tailwind terkompilasi lokal (`web/vendor/tailwind.min.css`), memecah fungsi panjang di `web/finance-analysis.js`, `web/supabase-api.js`, & `web/transaction-import.js`, memusatkan logika Pro di `web/finance-pro.js`, menambah suite `tests/finance-pro.test.js` & `tests/pro-web-ui.test.js`, serta menaikkan skor `aislop` menjadi **78/100** (**3 warning tersisa**, nol defect/empty/duplicate/long-function).

### 20 November 2026: Wave v3.4 (Security Hardening, Atomic Asset/Wallet RPCs, Telegram Bot, Print Statement, Calendar & PWA Cache Busting)
- **Hardening Keamanan & Privasi**: Menghapus rahasia cron dan URL produksi hardcoded di `supabase/schedule.sql` (wajib rotasi `CRON_SECRET`), membersihkan seluruh key sensitif (`mk_gemini_*`, PIN Lock, antrean offline, IndexedDB `mykeuangan_offline_db`) saat `logout()`, meng-upgrade PIN Lock ke PBKDF2-SHA256 tersalt, menangkal HTML XSS pada judul dialog SweetAlert2, menetralkan formula injection (`=`, `+`, `-`, `@`, tab) pada ekspor CSV & Excel, dan menjaga `exportPDF()` tetap menampilkan nominal asli saat mode *Hide Nominal* aktif.
- **RPC Atomik Aset Multi-Tipe, Profil & Dompet**: Migrasi `supabase/migrations/20261120000000_hardening_assets_profile_wallets.sql` menambahkan RPC `update_own_display_name(text)` untuk user non-admin, menyatukan update `unit_label`/`price_per_unit`/`buy_price` secara atomik pada `create_asset_with_expense`, `top_up_asset`, dan `liquidate_asset` untuk `Crypto`/`Emas`/`USD`/`Saham`, serta mengamankan `delete_wallet` agar saldo pembuka dan histori non-internal tetap terjaga.
- **Kalender, Analitik, Cetak & Anti-Duplikasi Transaksi**: Menyinkronkan `kalenderYear`/`kalenderMonth` dengan perpindahan siklus periode, memisahkan arus kas bersih (`flowIn`/`flowOut`) dan hitungan filter di Kalender, memperbaiki `getDueRecurringBills`, memperbarui `last_run` lewat `api_markRecurringRun`, memformat nominal Rupiah pada notifikasi, menjaga `#recurringDueBanner` saat ganti bahasa, memperbaiki `topExpenses` (`category`/`amount`), `null` runway (`'—'`), dan container `@media print` pada *1-Page Statement*, memperbarui grafik `#netWorthChart` (skala sumbu-Y, delay render tab, tema), serta menyinkronkan multi-transaksi offline/Split Bill dan guard double-submit `#btnSubmitTrans`.
- **Telegram Bot, PWA & Hygiene Kode**: Mengoreksi kategori `/utang` ke `UtangPerson` + upsert `entities`, menjadikan pairing OTP atomik (`DELETE ... RETURNING`), menyaring user aktif serta tanggal akhir bulan (`29..31`) di cron bot, mendeduplikasi logika AI Gemini dan utang piutang dengan fallback terstruktur, menambahkan Service Worker *Network-First* untuk HTML + cache versioning berbasis SHA-256 build ID di `web/sw.js` & `build.mjs`, serta menuntaskan 11 error `no-undef` (`sessionUser`/`sessionRole` → `window.*`) sehingga skor `aislop` naik dari `48/100` menjadi `67/100` (hanya menyisakan 1 error `security/hardcoded-secret` atas public client anon key pada file konfigurasi lokal gitignored `web/config.js`).
- **Halaman Riwayat Pembaruan Publik (`src/updates.html`)**: Memindahkan catatan rilis dari panel admin ke halaman `#view-updates` yang dapat diakses semua pengguna di sidebar lengkap dengan pencarian kata kunci, filter topik, accordion rilis lama, titik indikator belum dibaca (`mk_last_seen_release`), serta info rilis di Pusat Notifikasi.

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

Fase v1–v3.18 (Multi-User SaaS, Offline-First PWA, Bot Telegram Gemini AI, Audit Budgeting/Kategori, serta Pipeline `.apk`/`.aab` Capacitor 8) telah selesai. Fokus rilis berikutnya:

- [x] Web PWA Offline-First + IndexedDB Snapshot & Antrean Sinkronisasi Otomatis
- [x] Multi-aset (Crypto, Emas, USD, Saham), Bank e-Statement CSV Import & Ekspor PDF/Excel
- [x] Android App Capacitor 8 (API 36) + Cloud Build APK/AAB (`android-build.yml`)
- [ ] Google Play Console Closed Testing (12 tester × 14 hari) & rilis Production — lihat [docs/PLAYSTORE_LISTING_KIT.md](./docs/PLAYSTORE_LISTING_KIT.md)
- [ ] Ekspansi lanjutan di Panel Admin (opsional: hapus akun user & putuskan tautan Telegram langsung dari UI Admin)

---

## 🛠 Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | Vanilla HTML5 & Modular JavaScript ES6+ (`web/*.js`, `src/*.html`, zero runtime framework) |
| Styling & UI | Static Tailwind CSS v3.4.17, Chart.js 4.4, SweetAlert2 11, Flatpickr 4.6, jsPDF + AutoTable, Phosphor Icons 2.1, Inter Variable Font (self-hosted di `dist/vendor/`) |
| Offline & PWA | Custom Service Worker (`web/sw.js` Network-First HTML + SHA-256 build cache) + IndexedDB (`mykeuangan_offline_db`) |
| Mobile Native | Capacitor 8 (`@capacitor/app`, `browser`, `filesystem`, `share`, `splash-screen`) — Android 16 (API 36 / `minSdk 24`) |
| Backend & DB | Supabase (PostgreSQL + Row Level Security + PL/pgSQL RPC + Auth Email/Google OAuth 2.0) |
| Serverless | Deno TypeScript Edge Functions (`telegram-bot`, `admin-password`, `delete-account`) |
| Build & Test | Custom Node.js 22 bundler (`build.mjs`), syntax check (`check-syntax.mjs`), Built-in `node --test` |
| AI & Bot | Google Gemini 2.5 Flash (Receipt OCR, Voice Note, Cashflow Analysis & Chat) + Telegram Bot API |
| Hosting & CI/CD | GitHub Pages + GitHub Actions (`deploy.yml` & `android-build.yml`) + Supabase Cloud |

---

## 👤 Author

**LiandiMiko** — [github.com/LiandiMiko](https://github.com/LiandiMiko)

> Dibuat dengan ❤️ untuk manajemen keuangan pribadi yang lebih baik.
