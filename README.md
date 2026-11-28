# 💰 MyKeuGuech — Personal Finance App (Web PWA & Android)

> **v3.20.21** — Multi-User SaaS · Offline-First PWA · Android App (Capacitor 8 / API 36 · Material 3 · Biometric/Haptics/Camera/Notif) · Telegram Bot & Gemini 4 AI · Security Hardened

Aplikasi manajemen keuangan pribadi multi-user berbasis **Web PWA (GitHub Pages)** dan **Aplikasi Android (`.apk` / `.aab` via Capacitor 8)** dari satu codebase yang sama — dibangun dengan **Vanilla JS modular + Static Tailwind CSS + Supabase (PostgreSQL RLS & Deno Edge Functions) + Gemini 4 Hydrogen**.

🌐 **Live Web App (PWA):** [liandimiko.github.io/mykeuangan](https://liandimiko.github.io/mykeuangan/)

[![Live PWA](https://img.shields.io/badge/Live%20PWA-GitHub%20Pages-4f46e5?logo=githubpages&logoColor=white)](https://liandimiko.github.io/mykeuangan/)
[![Version](https://img.shields.io/badge/Version-v3.20.21-10b981)](./src/updates.html)
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
| **Admin Panel** | Statistik global platform, cari & filter user, suspend/aktifkan akun, atur password, putus Telegram, hapus akun user & log audit |
| **PWA & Android** | Web PWA offline + antrean mutasi penuh + backup AES-GCM; Capacitor 8 (API 36), Camera OCR, Haptics, Local Notifications, Pull-to-Refresh, Biometrik & popup update |
| **Telegram** | Notifikasi, query saldo, dan baca foto struk + voice note AI via Gemini 4 Hydrogen (Interactions API); pairing via OTP mandiri + tombol salin perintah |
| **AI** | Analisis arus keuangan mendalam, Scan Struk Vision, & Tanya Jawab / Simulasi Keuangan on-demand dengan Google Gemini 4 Hydrogen |
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
│   ├── ui-feat-*.js         # 13 modul fitur PWA/offline/native-ux/onboarding/backup hasil modularisasi
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
│   │   ├── admin-user-ops/ # Admin-only hapus akun user & putus Telegram (JWT + audit log)
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
│       ├── 20261125000000_normalize_categories_and_search.sql # Normalisasi kategori & filter dompet utama
│       └── 20261125120000_admin_audit_and_telegram_unlink.sql # Audit log admin & RPC putus Telegram
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

#### Step 13 — Admin Audit Logs & Unlink Telegram RPC (Wave v3.20)
```sql
-- Jalankan isi file: supabase/migrations/20261125120000_admin_audit_and_telegram_unlink.sql
```

Migrasi idempoten ini menambahkan tabel `public.admin_audit_logs` beserta kebijakan RLS admin dan RPC `admin_log_action()` serta `admin_unlink_user_telegram()`.
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

# Reset password, operasi admin (hapus user / putus Telegram) & hapus akun mandiri tetap memakai verifikasi JWT bawaan
supabase functions deploy admin-password
supabase functions deploy admin-user-ops
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
4. *(Opsional jika `web/config.js` belum ada di repo atau memakai Fork)* Isi **GitHub Repository Secrets** `SUPABASE_URL` & `SUPABASE_ANON_KEY` (*Settings → Secrets and variables → Actions → Secrets*) agar `.github/workflows/deploy.yml` dan `.github/workflows/android-build.yml` dapat menyusun `web/config.js` saat CI berjalan.

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

- **Cloud Build via GitHub Actions (otomatis di setiap push ke `main`):** Setiap push ke branch `main` atau tag `v*` otomatis menjalankan **`.github/workflows/android-build.yml`** untuk build `MyKeuGuech-v3.20.21-*.apk` (plus `.aab` jika secrets keystore aktif) dan langsung menerbitkannya ke **GitHub Releases** (`releases/latest`) — atau jalankan manual lewat **Actions → Run workflow** untuk memilih jenis paket spesifik (`debug-apk`, `release-apk`, `release-aab`, `all`).
- **Build Lokal 1-Perintah (Windows):** Setelah JDK 21 & Android SDK 36 siap, jalankan:
  ```powershell
  npm install
  npm run cap:keystore      # opsional: buat release keystore & panduan GitHub Secrets
  npm run cap:apk           # hasil: release\MyKeuGuech-v3.20.21-debug.apk
  npm run cap:apk:release   # hasil: release\MyKeuGuech-v3.20.21-release.apk (butuh keystore)
  npm run cap:aab           # hasil: release\MyKeuGuech-v3.20.21-release.aab
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
- **On-Demand**: AI **hanya** mengirim ringkasan payload arus kas ke Gemini 4 Hydrogen saat pengguna menekan tombol **Analisis Arus Keuangan** — tidak pernah berjalan otomatis di latar belakang.

---

## 📝 Changelog — What's New in v2.0

### 28 November 2026: Update v3.20.21 (Gelombang 7d: Performa PWA — Lazy-load Lib Berat + Defer + Subset Ikon)
- **Lazy-load pustaka berat (`web/lazy-vendors.js` BARU, `web/ui-export.js`, `web/ui-assets.js`, `web/ui-feat-charts.js`, `web/ui-shell.js`, `src/styles.html`)**: jsPDF + autotable (~453 KB), Chart.js (~206 KB), dan flatpickr + monthSelect + locale id (~51 KB) tidak lagi dimuat saat aplikasi dibuka — ketiganya baru diunduh saat fiturnya dipakai (ekspor PDF, grafik, pemilih tanggal), dari file lokal `./vendor/` yang sama (tetap ter-precache service worker → tersedia offline, instan dari cache saat kunjungan ulang). Pemuat `ensureJsPdf()` / `ensureChart()` / `ensureFlatpickr()` memakai SRI yang sama dengan tag statis lama, satu promise per file, dan gagal → bisa dicoba ulang. Ekspor PDF kini async dengan Swal "Memuat modul PDF…" lalu pesan ramah bila gagal; grafik digambar ulang setelah Chart termuat (gagal → canvas disembunyikan, placeholder kembali); pemilih tanggal diinisialisasi saat kolom pertama kali disentuh (focus/pointerdown sekali-pakai) lalu kalender langsung dibuka — sebelum itu kolom tetap input teks biasa yang bisa diketik. CSP 7b utuh (`script-src 'self'`, tanpa `unsafe-inline`/`unsafe-eval`): lazy-load hanya menyuntik file same-origin, tanpa CDN baru.
- **Defer semua modul app + preload aset kritis (`build.mjs`, `src/styles.html`)**: 57 tag `<script src="./app/...">` kini memakai `defer` — unduhan berjalan paralel dengan parsing HTML, eksekusi tetap BERURUTAN (defer menjaga urutan dokumen) sebelum DOMContentLoaded. Preload baru: `supabase.js` (as=script), `tailwind.min.css` (as=style), font Inter (as=font). Pengecualian yang ditemukan saat implementasi: tag `supabase.js` SENGAJA tetap sinkron — `web/delete-account.html` memanggil `window.supabase.createClient(...)` dari skrip inline saat parse, jadi supabase.js harus sudah ada sebelum skrip itu jalan.
- **Subset font ikon Phosphor + `font-display: swap` (`scripts/subset-phosphor.mjs` BARU, `web/phosphor-subset/` BARU, `build.mjs`)**: generator memindai src/ + web/ (termasuk pola dinamis `ph-<awalan>-${...}` seperti `caret-up/down` dan daftar eksplisit `DYNAMIC_ICONS` untuk nama yang dipilih lewat variabel) lalu memangkas tiap bobot dengan fontTools: regular 102 ikon (woff2 147.380 → 11.864 byte, −92%), bold 18 ikon (150.052 → 3.188 byte, −98%), fill 8 ikon (131.744 → 2.000 byte, −98%); total woff2 429.176 → 17.052 byte (−96%); CSS ikon 249 KB → ~7 KB; `font-display: block` → `swap` (ikon tidak lagi hilang sampai font tiba). File Phosphor lengkap TIDAK disalin ke dist/ (tetap diverifikasi sebagai sumber subset); subset ikut ter-precache SW. File `web/vendor/` tidak disentuh (hash-pin `VENDOR_MANIFEST` tetap berlaku). Jalankan ulang generator bila ada ikon baru: `node scripts/subset-phosphor.mjs`.
- **Tes penjaga (`tests/wave7d-performa.test.js` BARU, 10 tes)**: loader di vm sandbox (SRI benar, sekali saja, jalur cepat, gagal bisa dicoba ulang); dist tanpa tag lib berat; SEMUA tag app defer + jumlah = file dist/app + i18n-dict pertama + sw-register terakhir; 3 preload; dist memakai subset + woff2 < 25% aslinya + `font-display: swap`; SETIAP ikon yang dirujuk kode ada di subset CSS (dihitung ulang via `collectUsedIcons()` + jaring pengaman token mentah); SW precache memuat file lazy-vendor + subset. Tes 4.2 diperbaiki (menuntut `'error-messages.js'` langsung diikuti `'native-bridge.js'` di `WEB_MODULES` — pecah sejak `lazy-vendors.js` menjadi modul kedua; kini menegaskan invarian sebenarnya: error-messages.js pertama, lazy-vendors.js kedua). Tes 3.4e/3.4f/3.4g, wave5, dan 7b-c diperbarui untuk tag defer + jalur subset (7b-c kini MENUNTUT defer). Total suite: 626 tes (616 baseline v3.20.20 + 10 baru), lolos di WIB dan UTC.
- **Hasil ukur (Chromium 159 headless, metode sama seperti audit-046; log `~/workspace/7d-work/after-v32021*.log`)**: transfer muat pertama 2.401.544 → 1.138.676 byte (**−53%**); Slow 4G 21,8 dtk → **7,6 dtk** (LCP 8,1 dtk → **2,7 dtk**); warm reload 1.010 ms → 402–600 ms; offline reload 509 ms → 112–353 ms; CSS tak terpakai 334.172 byte (93%) → 76.051 byte (76%); SW precache 81 entri / 3.200.979 byte → 82 entri / 2.554.312 byte. LCP jaringan cepat berisik di VM (388–1.356 ms antar-jalan; baseline 592 ms) — tidak ada kesimpulan defer memperburuknya. Audit: `anti-slop/audit-046-pwa-performance-2026-11-28.md` (diperbarui dengan ukur ulang v3.20.20 + perbaikan + hasil sesudah).
- **Catatan versi**: update ke v3.20.21 menimpa v3.20.20 tanpa uninstall (`versionCode 3020021` > `3020020` — monoton).
- **Catatan jujur / belum diverifikasi**: code-splitting per layar TIDAK dikerjakan (modul klasik berkomunikasi lewat global; warm reload sudah 402–600 ms — ditunda sebagai tindak lanjut); purge Tailwind TIDAK dikerjakan (sisa CSS tak terpakai 76 KB, sebagian besar Tailwind); `<style>` inline 34 KB di `index.html` tidak dipindah; alur pemilih tanggal end-to-end belum terverifikasi live di sandbox (tanpa sesi login, `bootAuth` menampilkan layar login dan `core.ready` tidak pernah resolve sehingga `initPickersAndControls()` tidak jalan — perilaku yang sama di v3.20.20, bukan regresi 7d; mekanisme lazy-load flatpickr TERBUKTI live + kedua ID kolom ada di DOM) — cek manual di perangkat Liandi tetap diperlukan: pemilih tanggal di form, pemilih bulan di dashboard, ekspor PDF, grafik.
### 28 November 2026: Update v3.20.20 (Gelombang 7c Item 4: Impor CSV Bisa Pilih Dompet Tujuan)
- **Pemilih dompet tujuan sebelum impor (`web/ui-reports.js`, `web/transaction-import.js`)**: Saat mengimpor CSV bank, pengguna kini bisa memilih dulu transaksi mau masuk ke dompet mana — dialog pemilih dompet tampil sebelum pemilih file dibuka. Pilihan awal otomatis = dompet utama bank bila sudah ditetapkan dan masih valid; bila belum ada atau tidak valid, dompet pertama (perilaku lama). Batal di dialog = impor tidak jalan sama sekali; bila belum ada dompet, impor ditolak dengan pesan yang jelas (`lap.import_no_wallet`).
- **Aturan penentuan dompet (satu sumber, diekspor dari `web/transaction-import.js`)**: `resolveDefaultImportWalletId` — dompet utama bank bila id-nya cocok dengan dompet di daftar dan berjenis `bank`, bila tidak → dompet pertama; `resolveImportTargetWallet` — pilihan eksplisit yang valid menang atas default, pilihan yang tidak valid (dompet terhapus / id asing) TIDAK menggagalkan impor diam-diam dan TIDAK masuk ke dompet yang salah: fallback ke default + penanda `walletFallback { requested, used }` sehingga pratinjau menampilkan peringatan kuning berisi nama dompet pengganti. Tanpa options sama sekali, hasil parser identik dengan perilaku lama (`wallets[0]`).
- **Pengecualian yang didokumentasikan — kolom dompet di file tetap menang per baris**: Bila file CSV punya kolom `dompet`, dompet per baris dari file tetap dipakai (template CSV resmi memang memakai kolom dompet per baris; menimpanya dengan satu dompet pilihan akan memindahkan transaksi ke dompet yang salah). Pilihan di pemilih hanya mengatur baris TANPA kolom dompet — yaitu setiap baris mutasi bank, kasus yang diperbaiki item ini. Pratinjau menampilkan baris "Dompet tujuan: <nama>" dan catatan bila file punya kolom dompet.
- **Yang tidak berubah**: pemetaan kolom, validasi per baris, dedup, dan batas 500 baris tidak berubah; jalur simpan tetap satu-satunya `api_importTransactions` (tidak ada jalur tulis baru, dikunci tes). Komentar §9c lama ("perlu pemilih dompet di UI impor") diperbarui: pemilih itu kini ada.
- **Tes**: 8 tes baru di `tests/transaction-import.test.js` (7 parser — default dompet utama, pilihan eksplisit, perilaku lama tanpa pilihan, dompet utama tidak valid, fallback pilihan tidak valid, batas 500 baris dengan dompet pilihan, kolom dompet file menang per baris — + 1 wiring UI: pemilih tampil sebelum file, pilihan diteruskan ke parser, jalur simpan tidak berubah). Total suite setelah integrasi: 616 tes (608 baseline v3.20.19 + 8 baru), lolos di WIB dan UTC.
- **Kamus i18n**: 6 kunci baru `lap.import_wallet_*` (ID + EN) — 417 → 423.
- **Catatan versi**: update ke v3.20.20 menimpa v3.20.19 tanpa uninstall (`versionCode 3020020` > `3020019` — monoton).
- **Catatan jujur / belum diverifikasi**: pengujian manual di perangkat Liandi masih diperlukan — impor mutasi bank ke dompet utama vs dompet lain, file dengan kolom dompet, batal di dialog pemilih, dan fallback saat dompet pilihan sudah terhapus. Audit: `anti-slop/audit-049-csv-import-wallet-picker-2026-11-28.md` (dinomori 049: 046 dipakai draf audit performa 7d, 047 hotfix P0, 048 item 3 Google-only delete).
### 28 November 2026: Update v3.20.19 (Gelombang 7c Item 3: Akun Google-only Bisa Hapus Akun Sendiri)
- **Akun Google-only bisa hapus akun (`supabase/functions/delete-account/index.ts`, `web/supabase-admin.js`, `web/ui-feat-account.js`)**: Pengguna yang mendaftar hanya lewat Google akhirnya bisa menghapus akunnya sendiri — dulu edge function `delete-account` mensyaratkan kata sandi (T4) dan akun Google-only tidak punya kata sandi (di produksi ada 4 akun Google-only vs 3 akun email). Jalur baru memakai **bukti OAuth segar**: klien mengirim access token sesi; server memeriksa `getUser(token)` sukses + id sama dengan pemohon, providers token memuat `'google'`, `claims.sub` sama, DAN klaim `amr` memuat `{ method: 'oauth', timestamp }` ≤ 10 menit **dan** `iat` ≤ 10 menit. Mengapa `amr`, bukan `iat` saja: refresh token mencetak access token baru dengan `iat` baru — `iat` segar tidak membuktikan login ulang; `amr[].timestamp` dicatat GoTrue per sesi (`auth.mfa_amr_claims`, terbukti ada baris `oauth` di produksi) dan tidak bergeser saat refresh. Gagal di langkah mana pun → 401 generik `Verifikasi ulang gagal.` (tidak membocorkan cek mana yang gagal). Jalur password tidak berubah; cek admin-terakhir, cabut webhook bot personal, dan `admin.deleteUser` tidak berubah.
- **Alur klien (dua jalur)**: Sesi Google masih segar (< 10 menit) → dialog akhir tanpa kolom password, catatan "login ulang Google", ketik HAPUS → kirim `oauth_token` = access token sesi, tanpa redirect. Sesi basi → dialog penjelasan + ketik HAPUS + tombol "Lanjutkan dengan Google" → penanda `sessionStorage` (TTL 10 menit) → `signInWithOAuth({ provider: 'google', prompt: 'select_account' })` → resume otomatis setelah kembali (cek saat modul dimuat + `onAuthStateChange` `SIGNED_IN`; tunggu PIN terbuka dulu bila PIN diset) → dialog akhir → kirim token segar → sukses → logout paksa seperti alur lama. Penanda dibersihkan saat resume; bila kedaluwarsa/basi → dialog info, tidak menghapus. Akun ber-password: dialog lama tidak berubah.
- **Tantangan WebAuthn kedaluwarsa kini dibersihkan otomatis (`supabase/schedule.sql`, job baru `mk-webauthn-purge`)**: Penutup keputusan yang tertunda sejak PR #16 — `purge_expired_webauthn_challenges()` akhirnya punya pemanggil: pg_cron harian 03:00 WIB yang memanggil fungsi SQL-nya langsung. Dipilih panggilan SQL langsung (bukan edge function baru / menumpang ke account-cleanup / job telegram-bot) karena fungsinya sudah SECURITY DEFINER dan EXECUTE hanya untuk service_role — tidak butuh CRON_SECRET, Vault, atau deploy baru; bila job gagal, risikonya jinak (baris kedaluwarsa hanya menumpuk; alur WebAuthn tetap memvalidasi kedaluwarsa di setiap pemakaian).
- **Tes**: 32 tes baru di `tests/google-only-delete-account.test.js` (server jalur OAuth 16 — termasuk kunci desain `iat` segar + `amr` basi → 401 — jalur password 3, `supabase-admin.js` 5, `ui-feat-account.js` 9, regresi admin auto-hapus 2) + 1 tes baru job purge di `tests/account-cleanup.test.js` (jadwal + panggilan langsung + tanpa HTTP/secret + 5 job lama utuh). Total suite: 608 tes (575 baseline v3.20.18 + 33 baru), lolos di WIB dan UTC.
- **Kamus i18n**: tidak ada kunci kamus baru — 417 = 417. Seluruh kalimat baru di dialog memakai pasangan dwibahasa inline `txMsg(ID, EN)` (pola yang sama dengan dialog akun lainnya), jadi mode Inggris tetap lengkap.
- **Catatan versi**: update ke v3.20.19 menimpa v3.20.18 tanpa uninstall (`versionCode 3020019` > `3020018` — monoton).
- **Catatan jujur / belum diverifikasi**: pengujian ulang manual di perangkat Liandi masih diperlukan — jalur cepat (baru login Google), jalur login ulang (sesi > 10 menit, di browser DAN aplikasi Android), jalur batal, regresi akun ber-password; halaman web `delete-account.html` standalone belum diubah (masih meminta password — tindak lanjut terpisah). Audit: `anti-slop/audit-048-google-only-delete-account-2026-11-28.md` (dinomori 048: 046 dipakai draf audit performa 7d, 047 hotfix P0).
### 28 November 2026: Update v3.20.18 (Hotfix P0: Transfer, Anggaran, dan PIN Kembali Berfungsi)
- **Transfer antar dompet kembali bisa (`supabase/migrations/20261128140000_hotfix_ambiguous_id.sql`)**: Setiap transfer antar dompet/bank di v3.20.16–v3.20.17 selalu gagal dengan pesan mentah `column reference "id" is ambiguous` (Postgres 42702). Akar masalah TERBUKTI di produksi (repro rollback): fungsi PL/pgSQL `transfer_between_wallets` mendeklarasikan `RETURNS TABLE (id, ...)` lalu memakai `id` BARE (`where id = p_from`) di tiga tempat — PL/pgSQL tidak tahu `id` itu variabel OUT atau kolom `wallets.id`, jadi melempar 42702. Diperbaiki dengan kualifikasi `w.id` (tiga baris). Migrasi BARU — migrasi lama yang sudah diterapkan tidak diedit — dan WAJIB diterapkan di produksi SEBELUM merge (klien baru tetap memanggil RPC yang sama).
- **SEMUA simpan anggaran kembali bisa (fungsi yang sama, `save_budget_checked`)**: Anggaran sempat tidak bisa disimpan SAMA SEKALI — bukan hanya yang sudah ada, seperti dugaan awal. Penyebabnya dua lapis: SELECT awal fungsi memakai `kategori`/`bulan` BARE (keduanya kolom OUT dari `RETURNS TABLE` sekaligus kolom `budgets`) sehingga gagal di statement PERTAMA dengan 42702 `column reference "kategori" is ambiguous` (dibuktikan repro rollback #4a; pola terkualifikasi #4b lolos), DAN update-nya memakai `where id = v_row.id` BARE. Keduanya diperbaiki (`from public.budgets as b`, `b.user_id`/`b.kategori`/`b.bulan`, `where b.id = v_row.id`). Situs `kategori`/`bulan` ini sempat lolos dari audit pertama: skrip audit sebenarnya sudah menandainya, tapi triase keliru menggolongkannya false positive bersama daftar kolom INSERT dan target SET yang memang legal — pelajaran yang dicatat di audit-047 dan dijaga oleh tes guard §1.
- **Beli aset kembali bisa (fungsi yang sama, `create_asset_with_expense`)**: Pembelian aset selalu gagal karena `returning id into v_asset_id` BARE — diperbaiki menjadi `returning assets.id into v_asset_id`.
- **Set/ubah PIN kembali bisa (`web/ui-feat-account.js`)**: Setiap set atau ubah PIN selalu gagal dengan `hasPin is not defined` (ReferenceError). Akar masalah: `const hasPin` hanya didefinisikan di `openAccountSettingsModal()`, tapi `applyAccountSettingsUpdate()` memakainya. Diperbaiki dengan menghitung `hasPin` di dalam `applyAccountSettingsUpdate()` (tidak ada perubahan perilaku lain: ubah PIN dengan PIN lama benar tetap membungkus ulang DEK YANG SAMA; bila PIN lama salah/tidak terverifikasi, fallback membuat DEK baru agar aplikasi tetap jalan).
- **Pesan error server tidak lagi tampil mentah (`web/error-messages.js`, celah sanitizer U9)**: Kedua pesan mentah di atas lolos `toUserErrorMessage` karena polanya tidak dikenal (`column reference` tanpa tanda kutip langsung setelah `column `, dan `is not defined` tidak ada di daftar). TECHNICAL_RE diperluas (`column reference|is ambiguous|is not defined|syntax error|42702|42P0|PGRST`) — pesan teknis kini menjadi "Terjadi kesalahan. Coba lagi." (ID) / "Something went wrong. Please try again." (EN), sementara detail mentahnya tetap tercatat di console untuk diagnosis. Pesan ramah aplikasi sendiri (mis. saldo tidak mencukupi) tetap lolos apa adanya.
- **Tes**: 9 tes baru di `tests/hotfix-p0-ambiguous-id.test.js` — §1 guard SQL (definisi EFEKTIF fungsi RETURNS TABLE bebas referensi BARE ke kolom OUT; tiga fungsi efektif dari migrasi hotfix dan terkualifikasi), §2 regresi hasPin di sandbox vm (set PIN baru, ubah PIN dengan PIN lama benar → DEK sama, PIN lama salah → verifikasi gagal + fallback DEK baru, ubah nama tampilan saja), §3 sanitizer (dua pesan mentah P0 digeneralisasi id/en, showActionError ramah + mentah di console, pesan ramah tidak over-generalisasi). Total suite: 575 tes (566 baseline v3.20.17 + 9 baru), lolos di WIB dan UTC.
- **Catatan versi**: update ke v3.20.18 menimpa v3.20.17 tanpa uninstall (`versionCode 3020018` > `3020017` — monoton).
- **Catatan jujur / belum diverifikasi**: pengujian ulang manual di perangkat Liandi masih diperlukan — transfer antar dompet, simpan anggaran BARU dan ubah anggaran yang sudah ada, beli aset, set PIN baru, ubah PIN (dengan PIN lama benar dan salah), serta cek pesan ramah saat server sengaja diganggu. Audit: `anti-slop/audit-047-hotfix-p0-ambiguous-id-haspin.md`.
### 28 November 2026: Update v3.20.17 (Gelombang 7c Item 2: Optimistic Locking — Konflik Dua Perangkat Ditangani Ramah)
- **Optimistic locking — kolom `version` + trigger (`supabase/migrations/20261128130000_optimistic_locking.sql`, `web/supabase-core.js`, `web/supabase-records.js`, `web/supabase-planning.js`, `web/supabase-portfolio.js`)**: Keenam tabel yang punya jalur edit (`transactions`, `financial_goals`, `budgets`, `recurring`, `wallets`, `assets`) kini punya kolom `version` (mulai dari 1) dan trigger `bump_version` yang menaikkan versi +1 di setiap UPDATE — otomatis, tidak peduli jalur tulisnya (PostgREST, RPC, refresh harga). Penegakan ada di sisi server: update/delete memakai `WHERE version = <versi-yang-dilihat-saat-mulai-edit>` (PostgREST), anggaran lewat RPC baru `save_budget_checked` (kunci baris `FOR UPDATE` supaya dua RPC bersamaan diserialisasi), hapus dompet lewat RPC baru `delete_wallet_checked` (mendelegasikan ke `delete_wallet()` lama yang tidak diubah). Kedua RPC hanya bisa dipanggil `authenticated` (revoke dari `public, anon` — pola Gelombang 4). Klien tidak pernah menulis kolom `version` sendiri. Migrasi wajib diterapkan SEBELUM klien ini ter-deploy (klien baru memuat kolom `version` di semua select; PostgREST menolak kolom yang belum ada — PGRST204).
- **Dialog konflik Bahasa Indonesia (`web/sync-conflict.js` baru, `web/ui-feat-offline.js`, `web/ui-form.js`, `web/ui-budget.js`, `web/ui-dashboard.js`, `web/ui-recurring.js`, `web/ui-wallets.js`, `web/ui-pro-reports.js`, 45 kunci `sync.*` baru — kamus 372 → 417)**: Bila tulisan ditolak server karena versi basi, aplikasi menampilkan dialog yang menjelaskan apa yang berubah dengan tiga pilihan — pakai versi saya (force-save, hanya setelah persetujuan), pakai versi terbaru, atau gabungkan bila tidak ada field yang diubah kedua belah pihak. Edit offline yang basi saat sinkronisasi diparkir (bukan di-retry membabi buta / ditimpa) dan ditanyakan lewat dialog yang sama. Jaring pengaman: error `MK_CONFLICT` yang lolos ke mana pun diubah menjadi kalimat ramah (`web/error-messages.js`).
- **Hapus kini idempotent (perubahan perilaku yang disengaja)**: Menghapus catatan yang sudah dihapus di perangkat lain kini mengembalikan `{alreadyDeleted: true}` dan dianggap selesai — dulu melempar "tidak ditemukan". Hapus basi (versi tidak cocok) tetap konflik; hapus dengan versi benar lolos; update atas baris yang sudah dihapus memberi pilihan pulihkan/biarkan (`deletedByOther`).
- **Bug yang ikut diperbaiki**: `fetchRecurringOnly` memetakan `active` ke string `'false'` — `Boolean('false') === true` — sehingga dialog bisa salah menandai field `active`. Kini lewat `recurringActiveValue()` di `web/supabase-planning.js`.
- **Tes**: 33 tes baru di `tests/optimistic-locking.test.js` (migrasi 2, handler 13, helper/dialog 9, flush offline 5, i18n/jaring pengaman 3, impor CSV 1) — termasuk dua perangkat edit data sama → `MK_CONFLICT` dan server tidak tertimpa, edit berurutan tanpa false positive, pemanggil lama tanpa versi tetap terlindungi (fetch-first), hapus ganda idempotent, impor CSV tidak berubah (`addedCount` 1, `skippedCount` 1). Total suite: 566 tes (533 baseline v3.20.16 + 33 baru), lolos di WIB dan UTC.
- **Catatan versi**: update ke v3.20.17 menimpa v3.20.16 tanpa uninstall (`versionCode 3020017` > `3020016` — monoton).
### 28 November 2026: Update v3.20.16 (Gelombang 7c: Login Passkey / WebAuthn — Verifikasi Server)
- **Login Passkey / WebAuthn Server (`supabase/migrations/20261128070000_wave3_webauthn.sql`, `supabase/functions/webauthn/index.ts`, `web/ui-feat-native-ux.js`, `tests/webauthn.test.js` baru)**: Draf server WebAuthn dari Gelombang 3 kini diverifikasi dan diaktifkan. Server menyimpan kredensial per pengguna di `webauthn_credentials` (kunci publik EC P-256 dalam JWK — kunci privat tidak pernah keluar dari perangkat) dan tantangan sekali pakai di `webauthn_challenges` (kedaluwarsa 5 menit, sekali pakai). Verifikasi tanda tangan di server, penghitung (counter) menolak assertion dengan counter ≤ tersimpan (anti-kloning). Klien kini memakai jalur server (`WEBAUTHN_SERVER_ENABLED = true`): enrollment + assertion lewat Edge Function `webauthn`, memakai `rpId` server bila ada. Dua bug nyata dari draf diperbaiki: (1) supabase-js v2 MELEMPAR `FunctionsHttpError` (bukan `{error}`) — pesan Indonesia dari server kini dibaca dari body `{error}` dengan fallback ramah; (2) penolakan server kini dihitung sebagai kegagalan biometrik, sedangkan server yang tidak terjangkau tetap fallback ke PIN. `deno check` lolos (Deno 2.9.8; pengetatan tipe `Uint8Array<ArrayBuffer>` — nol perubahan runtime; perintah yang benar di repo ini `DENO_NO_PACKAGE_JSON=1 deno check`).
- **Perbaikan migrasi sebelum diterapkan**: `purge_expired_webauthn_challenges()` SECURITY DEFINER tadinya memberi EXECUTE ke PUBLIC — dicabut dari `public, anon, authenticated`, hanya `service_role` (+ `postgres`). Jebakan lain diperiksa dan tidak kena (tidak ada `hmac`/`digest` tak berkualifikasi, tidak ada `to_regproc` berargumen). Migrasi diterapkan di produksi sebelum merge: 2 tabel ada, RLS aktif keduanya, policy tepat 3 (`webauthn_challenges_none` ALL `false`; `select_own` + `delete_own` `auth.uid() = user_id`), index 6/6, kedua tabel 0 baris. Function `webauthn` di-deploy v1 (verify_jwt true, ACTIVE); probe tanpa JWT → 401, JWT palsu → 401 (bukan 500 mentah).
- **Catatan jujur / belum diverifikasi**: end-to-end live dengan JWT pengguna asli (enroll + unlock melawan function + tabel live) belum dilakukan — hanya sampai probe gateway 401; pengguna biometrik interim lama harus daftar ulang sekali (kunci lokal `mk_webauthn_pubkey_v1` tidak terbawa ke server); jalur Android/Capacitor (`https://localhost`, rpId `localhost`) hanya dianalisis dari kode, belum dicoba di APK sungguhan; fungsi purge belum dipanggil siapa pun (belum ada cron) — tabel challenge akan tumbuh sampai ada pemanggil.
- **Tes**: 17 tes baru (15 di `tests/webauthn.test.js` + 2 S1); 3 tes lama yang mengunci status DRAF/jalur interim diperbarui ekspektasinya ke status terverifikasi (guard tidak dihapus). Total suite 533 (516 baseline + 17).
- **Catatan versi**: update ke v3.20.16 menimpa v3.20.15 tanpa uninstall (`versionCode 3020016` > `3020015` — monoton).
### 28 November 2026: Update v3.20.15 (Gelombang 7b: PIN Lebih Kuat — PBKDF2 600.000 Iterasi, Migrasi Transparan)
- **PBKDF2 100.000 → 600.000 iterasi (`web/ui-feat-account.js`, `web/ui-feat-offline.js`, `tests/pin-encryption-gating.test.js`, `tests/wave3-auth-profile.test.js`)**: Hash verifikasi PIN (`derivePinHash`) dan KEK pembungkus DEK (`pinCrypto.derivePinKek`) kini memakai 600.000 iterasi PBKDF2-HMAC-SHA256, mengikuti rekomendasi OWASP (sebelumnya 100.000; backup JSON sudah 600.000 sejak lama). Format hash baru membawa jumlah iterasi: `pbkdf2$600000$<hex>`; format lama `pbkdf2$<hex>` dibaca sebagai 100.000. `wrapPinDataKey` baru selalu menulis `iterations: 600000`; `unwrapPinDataKey` menghormati `wrap.iterations` yang tersimpan (fallback 100.000 bila field tidak ada), sehingga wrap lama tetap bisa dibuka.
- **Migrasi transparan tanpa aksi pengguna**: PIN benar yang diverifikasi terhadap hash lama memigrasi hash ke 600.000 (salt baru via `hashPin`, pola yang sama dengan migrasi legacy S6); PIN salah tidak memigrasi apa pun. Setelah unwrap DEK berhasil, `ensurePinDataKeyAfterUnlock` memanggil `migratePinDataKeyWrapIterations` yang membungkus ulang DEK YANG SAMA ke 600.000 (salt + IV baru) — wrap lama tidak pernah dihapus sebelum penggantinya aman tersimpan, dan bila re-wrap gagal aplikasi tetap jalan dengan wrap lama lalu mencoba lagi saat unlock berikutnya (fail-soft, tidak pernah mengunci pengguna keluar). Ganti PIN menghasilkan hash + wrap 600.000 sekaligus (rewrap DEK yang sama + `hashPin` baru); PIN lama ditolak sesudahnya.
- **Perilaku yang dipertahankan**: lockout/backoff PIN (60 detik → 5 → 15 → 60 menit, reset password akun setelah 3 lockout) tidak disentuh — migrasi hanya jalan setelah PIN terverifikasi benar dan lockout di-clear, dan tes membuktikan state lockout tidak berubah oleh migrasi. Wrap rusak tetap ditangani seperti semula (DEK baru, tanpa crash, data lama tak terbaca). Pengguna tanpa PIN / tanpa wrap tidak terpengaruh. Biometrik tetap fallback ke PIN sekali per buka aplikasi (migrasi terjadi di entri PIN itu).
- **Performa yang diukur (jujur, bukan klaim)**: di VM pengujian (Node v24.22.1, 4 CPU), satu PBKDF2-600k memakan median ~680 ms (`deriveBits` 664–750 ms, `deriveKey` 656–817 ms, 5 run) dibanding ~122 ms pada 100k. Jalur unlock menghitung PBKDF2 dua kali berurutan (verifikasi hash + unwrap KEK) ≈ 1,4 detik di VM ini; di WebView Android kelas bawah diperkirakan ~1–3 detik. Angka perangkat fisik sungguhan belum diukur (masuk "Belum Diverifikasi").
- **Tes**: 7 tes baru di `tests/pin-encryption-gating.test.js` ((a) pengguna baru langsung 600rb incl. `saveInitialAppPin` end-to-end; (b) pengguna lama: fixture hash `pbkdf2$<hex>` 100rb + wrap 100rb → unlock PIN benar migrasi hash + wrap ke 600rb; (c) DEK byte-identik sebelum/sesudah migrasi + data lama tetap terdekripsi; (d) PIN salah tidak memigrasi apa pun; (e) lockout/backoff tidak berubah; (f) wrap rusak → DEK baru tanpa crash; plus wrap tanpa field `iterations` dibuka dengan 100rb, dan ganti PIN → hash + wrap 600rb, DEK sama, PIN lama ditolak) dan 1 tes diperbarui di `tests/wave3-auth-profile.test.js` (format `derivePinHash` baru + `parsePinHashIterations`). Tes K2 lama diperbarui ke 600.000 iterasi.
- **Catatan versi**: update ke v3.20.15 menimpa v3.20.14 tanpa uninstall (`versionCode 3020015` > `3020014` — monoton).
### 28 November 2026: Update v3.20.14 (CSP Diperketat — Eksternalisasi JS Inline)
- **Eksternalisasi Modul JS (`build.mjs`, `src/Index.html`, `src/i18n.html`, `web/sw-register.js` baru, `web/sw.js`, `tests/wave7b-csp-tightening.test.js` baru)**: Semua modul `web/*.js` (54 file) kini ditulis build ke `dist/app/*.js` (diminifikasi esbuild, kecuali `web/config.js` yang tetap verbatim) dan dimuat lewat `<script src="./app/...">` sinkron — tanpa `defer`/`async` — dengan urutan yang SAMA PERSIS seperti saat masih di-inline (paritas perilaku: `error-messages.js` pertama, `config.js` di antara UI_CORE dan SUPABASE, `password-policy.js` sebelum consumer-nya, `sw-register.js` paling akhir). Kamus I18N (`src/i18n.html`, sumber tetap di sana agar tes i18n tidak berubah) diekstrak build ke `dist/app/i18n-dict.js` dan dimuat di `<head>` sebelum semua modul. Blok registrasi Service Worker yang dulu inline di akhir `src/Index.html` pindah ke `web/sw-register.js` baru. `dist/index.html` kini NOL blok `<script>` inline (dulu >40 blok, 990 KB → 300 KB; total dist tetap sebanding karena kode pindah ke `dist/app/`).
- **CSP Diperketat (`src/Index.html`)**: `script-src` kini hanya `'self'` — `'unsafe-inline'` dan `'unsafe-eval'` DIHAPUS (verifikasi: tidak ada `eval()`/`new Function()` di kode aplikasi; satu-satunya `new Function` ada di vendor SweetAlert2 untuk template deklaratif `<swal-function-param>` yang tidak pernah dipakai aplikasi — dicek `grep` di `src/` + `web/`). `img-src` kehilangan `https:` mentah (tidak ada gambar remote; semua gambar lokal/data:/blob:). Tambahan: `form-action 'self'` + `upgrade-insecure-requests`. `style-src` SENGAJA tetap `'unsafe-inline'` (atribut `style="..."` di 6 tempat `src/*.html` + banyak template `web/*.js`; menyapunya churn besar dengan nilai keamanan rendah — injeksi CSS tanpa eksekusi script). `frame-ancestors` TIDAK ditambahkan (diabaikan di meta CSP; butuh header HTTP yang tidak bisa diset di GitHub Pages).
- **Tailwind & Offline (`build.mjs`, `src/styles.html`, `web/sw.js`)**: Blok Play CDN (`tailwind.config` inline) diganti `<link rel="stylesheet" href="./vendor/tailwind.min.css">` — `copyVendorDir` tidak lagi melewati `tailwind.min.css`, jadi file itu kini tersalin ke `dist/vendor/` dan ikut ter-precache. Service worker mem-precache SEMUA file `dist/app/*.js` (placeholder baru `__APP_ASSETS__`, seperti `__VENDOR_ASSETS__`) supaya PWA tetap jalan offline — modul app yang dulu ikut ter-cache lewat `index.html` kini harus eksplisit masuk precache.
- **Tes Baru & Tulis Ulang (`tests/wave7b-csp-tightening.test.js` baru, 6 tes; `tests/wave2-xss-csp.test.js` 2.4, `tests/wave3-frontend-cdn-build.test.js` 3.4e/3.4g, `tests/wave5-build-reproducibility.test.js` 5.2d, `tests/i18n-build.test.js`)**: Guard lama yang mengunci blocker inline (2.4) dibalik menjadi guard pengetatan; 5.2d kini membandingkan total ukuran `dist/app/*.js` minified vs tanpa esbuild dan mengassert nol `<script>` inline; 3.4g membaca urutan load dari tag `<script src>` di `dist/index.html`. Total suite: 504 tes (498 baseline + 6 baru).
- **Catatan versi**: update ke v3.20.14 menimpa v3.20.13 tanpa uninstall (`versionCode 3020014` > `3020013` — monoton).
### 28 November 2026: Update v3.20.13 (Gelombang 7a: Tulisan Lebih Mudah Dibaca & Reset Kata Sandi Mencabut Sesi)
- **Teks Kecil Dinaikkan ke 12px — U34 (`src/Index.html`, `src/admin.html`, `src/ai.html`, `src/aset.html`, `src/budgeting.html`, `src/dashboard.html`, `src/form.html`, `src/histori.html`, `src/updates.html`, 25 file `web/ui-*.js`, `tests/wave6a-contrast-a11y.test.js`)**: Semua kelas `text-[10px]` (65 kemunculan) dan `text-[11px]` (215 kemunculan) di `src/` + `web/` (di luar `web/vendor/`) dinaikkan ke `text-xs` (12px), termasuk kombinasi responsif (`text-[10px] sm:text-[11px]` → `text-xs`). Satu pengecualian beralasan: lencana angka notifikasi `src/Index.html:216` tetap 11px — ukuran 12px tidak muat di lencana 16px (didokumentasikan Gelombang 6, dikunci tes Wave 6). U35 ikut tertutup di label statistik dashboard (kini 12px + `slate-600`). Inline `font-size:10/11px` di cabang print `web/ui-feat-backup.js` bukan kelas Tailwind sehingga tidak disentuh.
- **Tombol Hapus Kini Mengikuti Bahasa (`web/ui-assets.js`, `tests/wave-v320-upgrades.test.js`)**: Hardcode `confirmButtonText: 'Ya, Hapus'` saat menghapus aset diganti kunci i18n `btn.ya_hapus` (sudah ada di kamus); mode Inggris menampilkan "Yes, Delete" (dibuktikan lewat `node:vm`). `web/ui-wallets.js` sudah memakai kunci yang sama di kedua tempat, jadi tidak diubah. Tes lama yang mengunci hardcode diperbarui menjadi mengunci pemakaian i18n + ketiadaan literal.
- **Reset Kata Sandi Admin Kini Mencabut Sesi Target (`supabase/migrations/20261128120000_admin_revoke_user_sessions.sql`, `supabase/functions/admin-password/index.ts`, `supabase/README.md`, `tests/wave3-edge-functions.test.js`, `tests/wave2-sessions.test.js`)**: Penyelidikan di supabase-js 2.119.2 membuktikan `auth.admin.signOut` tetap membutuhkan JWT target (tidak dimiliki server) dan tidak ada metode admin berbasis user-id — jadi pencabutan dilakukan lewat RPC baru `admin_revoke_user_sessions(p_target_user_id)` (SECURITY DEFINER, `search_path = ''`, hanya `DELETE FROM auth.sessions`, ACL hanya `service_role`, penjaga `to_regprocedure`). Setelah `updateUserById` berhasil, `admin-password` memanggil RPC ini; hasilnya masuk audit (`sessions_revoked`, `sessions_revoke_error`) dan respons. Fail-soft: bila RPC gagal, reset tetap 200 tetapi kegagalan tercatat di console + audit + respons. Batasan jujur: access token JWT yang sudah diterbitkan tetap valid sampai `exp` (±1 jam) — yang mati adalah refresh token-nya, sehingga target tidak bisa masuk lagi tanpa login ulang. Import edge function tetap `npm:@supabase/supabase-js@2.45.4` (tidak ada API penolong di 2.119.2 yang membenarkan bump).
- **Pembersihan Server (operasional, tanpa PR kode)**: Deployment edge function nyasar `super-responder` (tercatat v6 di API) dihapus — grep membuktikan 0 pemanggil di `src/`/`web/`/`supabase/functions/`; probe sesudahnya 404. Edge secret `RESEND_API_KEY` dihapus — grep membuktikan 0 kode membacanya; daftar secret 16 → 15 nama. Kredensial Resend di Vault TIDAK disentuh. Probe pasca-hapus: `account-cleanup` tanpa secret tetap 403, `admin-password` tanpa JWT tetap 401.
- **Catatan versi**: update ke v3.20.13 menimpa v3.20.12 tanpa uninstall (`versionCode 3020013` > `3020012` — monoton).

### 28 November 2026: Update v3.20.12 (Notifikasi Admin di Dalam Aplikasi)
- **Notifikasi Admin di Dalam Aplikasi (`supabase/migrations/20261128110000_admin_notifications.sql`, `supabase/functions/account-cleanup/logic.ts`, `supabase/functions/account-cleanup/index.ts`, `src/admin.html`, `web/ui-admin.js`, `web/supabase-admin.js`, `src/i18n.html`)**: PR #11 (head `fe1abd6`, 8 commit, merge `fdcb003`; tes 497/497 WIB+UTC). Migrasi baru menambah tabel `admin_notifications` (hanya admin yang bisa membaca, lewat RLS + 2 RPC admin-only) untuk menggantikan email Resend. Panel admin kini punya bagian Notifikasi dengan lencana "belum dibaca" dan tombol tandai sudah dibaca (kunci i18n `adm.notif_*`). Akun yang sudah 6 hari tidak ada perubahan memunculkan notifikasi peringatan "akun ini akan dihapus besok"; hari ke-7 akun dihapus otomatis beserta seluruh datanya dan admin mendapat notifikasi konfirmasi. Penghapusan tetap otomatis dan tetap fail-closed: akun hari ke-7 HANYA dihapus bila notifikasi peringatan hari ke-6 sudah dibuat (`deletion_warning_sent_at` kini berarti "notifikasi peringatan admin dibuat"); akun ≥ 7 hari yang belum diperingatkan mendapat peringatan dulu dan baru dihapus pada run berikutnya; bila insert notifikasi gagal, akun TIDAK dihapus.
- **Email Resend Dihentikan**: Rencana email peringatan/konfirmasi via Resend dicoret atas keputusan Liandi 2026-11-28 ~15:04 WIB ("gausah by email, terlalu ribet") — domain `lisandimiko.web.id` terdelegasi ke 4 nameserver JogjaCamp yang semuanya menolak query zona (lame delegation), sehingga Resend tidak bisa memverifikasi domain tanpa perbaikan di registrar. Jalur Resend dihapus dari `account-cleanup`; secret `RESEND_API_KEY` tetap terpasang di Supabase tetapi TIDAK terpakai lagi, dan tidak ada lagi langkah produksi yang membutuhkan `RESEND_FROM_EMAIL`. Tidak ada perubahan jadwal: job `mk-account-cleanup` yang sudah ada tetap berjalan harian pukul 02:00 WIB (`0 19 * * *`).
- **Catatan versi**: update ke v3.20.12 menimpa v3.20.11 tanpa uninstall (`versionCode 3020012` > `3020011` — monoton).

### 28 November 2026: Update v3.20.11 (Tampilan & Pengalaman Pakai: Navigasi Lebih Lengkap, Tulisan Lebih Jelas)
- **Navigasi & Alur (`src/Index.html`, `src/dashboard.html`, `src/aset.html`, `src/laporan.html`, `src/form.html`, `web/ui-shell.js`, `web/ui-wallets.js`, `tests/wave6b-nav-forms-flows.test.js`)**: Layar Utang & Piutang kini ada di sidebar dan menggantikan tab Budget di navigasi bawah HP (Budget tetap satu ketukan dari sidebar dan Command Palette); penanda halaman aktif kini menunjuk Utang saat layar utang dibuka, bukan lagi Dashboard. Command Palette kini bisa dibuka dari HP lewat tombol kaca pembesar di header. Modal transfer menampilkan saldo dompet asal di tiap pilihan dan memperingatkan sebelum submit bila nominal melebihi saldo. Kolom nominal utama memakai keypad angka (`inputmode="decimal"`) di HP. Tombol "Transfer Antar Dompet" dan "Tarik Tunai" kini terpisah (sebelumnya satu label ganda). Entri "Restore Backup JSON" kini ada di menu "Ekspor & Backup" juga, berdampingan dengan "Unduh Backup JSON".
- **Kontras & Aksesibilitas (`src/styles.html`, `src/Index.html`, `web/ui-calendar.js`, `web/ui-budget.js`, `web/ui-pro-palette.js`, `tests/wave6a-contrast-a11y.test.js`)**: Tema Emerald digelapkan dari `#059669` (3,77:1) ke `#047857` (5,48:1) agar lolos WCAG AA; 32 situs teks `text-slate-400` (2,56:1) diganti `text-slate-500` (4,76:1) di mode terang; status budget "Aman"/"Peringatan" memakai `emerald-700`/`amber-700`. Kelima tombol tema kini menampilkan cincin fokus keyboard; tombol "Hapus" aturan auto-kategori dinaikkan ke 36px plus konfirmasi dua ketuk; klaster tombol aksi (kalender, budget, palette, filter, bahasa) dinaikkan ke 44px. Kolom cari Histori punya `aria-label`; Command Palette memakai `role="listbox"`/`option`/`aria-activedescendant`; keempat grafik canvas punya `role="img"` + `aria-label` yang diperbarui tiap render; sel kalender mengumumkan tanggal dalam format lokal ("Jumat, 28 November 2026, 3 transaksi"); input pencarian di HP memakai font 16px agar iOS tidak auto-zoom; label nav dan angka kalender naik ke 12px dan label kecil ke `slate-600`.
- **Pesan Error, Bahasa & Konsistensi (`web/error-messages.js`, `web/ui-wallets.js`, `web/ui-shell.js`, `src/i18n.html`, `tests/wave6c-ui-copy-consistency.test.js`)**: 17 situs pesan error mentah (plus 10 lagi yang ditemukan saat sapuan di `ui-admin.js`) kini melewati sanitizer `toUserErrorMessage()` — pengguna tidak lagi melihat pesan teknis database; banner gagal muat memakai judul generik tanpa kata "Supabase" dan diterjemahkan. 25 label tombol modal ("Simpan"/"Batal") yang di-hardcode Indonesia kini memakai kunci i18n, begitu pula judul/toast dompet dan teks kosong; kamus kini 347 kunci ID = 347 EN. Tombol utama "Tambah Dompet" dan "+" kategori kini memakai warna brand indigo (emerald hanya untuk hal semantik pemasukan); ikon dompet diseragamkan ke `ph ph-wallet`; teks terpotong kini punya `title` lengkap; dua kunci terjemahan Inggris yang bertabrakan diperbaiki (`budget.warning` → 'Approaching', `budget.lebih` → 'Over by'); "Reset" menjadi "Atur Ulang"; panel dompet dan layar utang kini punya empty state berikon + tombol tambah; template CSV kini berisi 2 baris contoh dan kalimat format.
- **Privasi & Instalasi (`web/ui-feat-account.js`, `web/ui-feat-native-ux.js`, `web/ui-feat-hooks.js`, `web/ui-feat-offline.js`)**: Re-lock otomatis kini menampilkan layar kunci penuh yang menutupi konten (bukan sekadar blur); label biometrik kini jujur ("Buka dengan Sidik Jari + PIN sekali") saat PIN masih diperlukan sekali. Firefox Android kini mendapat tombol install dengan petunjuk manual (sebelumnya tidak ada jalan install sama sekali). Saat pertama kali offline, toast menjelaskan bahwa transaksi tersimpan di perangkat dan terkirim otomatis saat online.

### 28 November 2026: Update v3.20.10 (Panel Admin: Aktivitas Terakhir & Pembersihan Akun Dormant)
- **Perubahan Terakhir di Panel Admin (`supabase/migrations/20261128100000_admin_last_activity_cleanup.sql`, `web/supabase-admin.js`, `web/ui-admin.js`, `src/admin.html`, `src/i18n.html`, `tests/admin-last-activity.test.js`, `tests/admin-last-activity-cleanup.test.js`)**: Migrasi baru menambah kolom `profiles.last_activity_at` dan `deletion_warning_sent_at` plus dua RPC: `touch_own_activity()` (SECURITY DEFINER — satu-satunya jalan karena UPDATE profiles sudah dicabut dari `authenticated` sejak Gelombang 1) dan `get_admin_user_activity()` (hanya admin, via `is_admin()`; mengembalikan 12 kolom termasuk `last_change_at`, `days_inactive`, `deletion_due_in_days`). "Perubahan terakhir" dihitung sebagai yang terbaru dari login (`last_sign_in_at` auth) atau perubahan data — memakai epoch absolut, bukan potongan tanggal, sehingga batas hari benar di WIB (tes membuktikan potongan tanggal UTC maupun WIB sama-sama salah memberi 7 untuk kasus 00:30 WIB). Panel admin kini menampilkan kolom Perubahan Terakhir (tanggal + "baru saja/hari ini/kemarin/N hari lalu") di tabel desktop dan kartu mobile, badge Dormant + hitung mundur "dihapus dalam N hari", serta filter Aktivitas Aktif (inaktif < 4 hari) / Dormant (≥ 4 hari). Bila RPC gagal, panel menampilkan error yang jelas, bukan daftar tanpa data aktivitas.
- **Pembersihan Otomatis Akun Dormant + Notifikasi Admin (`supabase/functions/account-cleanup/index.ts`, `supabase/functions/account-cleanup/logic.ts`, `supabase/schedule.sql`, `tests/account-cleanup.test.js`)**: Edge function baru `account-cleanup` (verify_jwt false; autentikasi via `x-cron-secret` timing-safe meniru telegram-bot, CORS fail-closed) berjalan harian pukul 02:00 WIB lewat job cron baru `mk-account-cleanup` (`0 19 * * *`, secret dibaca dari Vault seperti 4 job lama). Tiap jalan: akun aktif non-admin yang inaktif ≥ 6 hari dan belum diperingatkan memunculkan notifikasi peringatan H-1 di panel admin (flag `deletion_warning_sent_at` hanya diset bila notifikasi benar-benar dibuat, jadi kegagalan dicoba lagi besok); akun yang inaktif ≥ 7 hari dihapus — webhook bot personal dicabut dulu (best-effort), lalu `admin.deleteUser` (ON DELETE CASCADE menghapus seluruh data), lalu notifikasi konfirmasi dibuat untuk admin. Akun admin/pemilik dan akun suspended DIKECUALIKAN. (Rencana awal memakai email peringatan/konfirmasi via Resend — dicoret di v3.20.12 atas keputusan pemilik karena verifikasi domain Resend tidak mungkin dilakukan; tidak ada email yang pernah terkirim untuk fitur ini karena langkah produksi Resend belum pernah dijalankan. SMTP Supabase tidak terkonfigurasi (dicek: host/port/user/pass null) sehingga tidak dipakai.)
- **Pencatatan Aktivitas (`web/supabase-auth.js`, `web/ui-feat-offline.js`)**: `touchOwnActivity()` memanggil RPC setelah login/session restore berhasil dan setelah sinkronisasi antrean offline berhasil (bila ada item yang tersinkronisasi) — best-effort, tidak pernah memblokir login/sinkronisasi, throttle maksimal 1x/jam per perangkat via localStorage, kunci throttle dibersihkan saat logout.
- **Catatan versi**: branch fitur ini dan Gelombang 6 (perbaikan 41 temuan audit UI/UX) sempat memakai 3.20.10 di branch masing-masing — PR #9 merge duluan (62666ce), jadi Gelombang 6 naik ke 3.20.11 saat rebase ke main.

### 28 November 2026: Update v3.20.9 (Kualitas: Tes Eksekusi, Build Reproduksibel & Aplikasi Lebih Ringan)
- **Tes Eksekusi yang Menangkap Regresi (`tests/wave5-execution-tests.test.js` baru, `tests/wave5-build-reproducibility.test.js` baru, `tests/wave5-module-order.test.js` baru, `tests/wave5-version-consistency.test.js` baru)**: Inventarisasi 326 tes lama: ±215 eksekusi vs ±111 string-match. 56 tes baru ditambahkan (total 382): 31 tes eksekusi untuk webhook Telegram T7/T8 (10: `?bot` tak dikenal → 404, secret salah → 403, OTP lintas-bot ditolak, dedup `update_id`, `/saldo` via token pemilik), cron 2.3 (5: cap 200, log `cron_job_runs`, tanpa secret → 403 tanpa log), kebijakan password/PIN S5 (7: urutan, karakter sama, kata umum, local-part email), service worker (4: bypass host API, stale-while-revalidate), dan filter restore S26–S28 (5: transfer unmapped tidak dialihkan diam-diam, dedup id/signature). 9 uji mutasi dilakukan (hapus filter `user_id`, matikan cek secret, cap 200→1.000.000, dst.) — semuanya membuat tes jadi merah lalu dikembalikan. Tes urutan modul membuktikan dependensi pemuatan (bukti negatif: memindah `error-messages.js` ke akhir membuat 2 tes gagal); tes konsistensi versi menjadikan `package.json` satu-satunya sumber versi.
- **Dependensi & Build Reproduksibel (`package.json`, `package-lock.json` baru, `scripts/fetch-vendors.mjs`, `scripts/patch-android-project.mjs`, `build.mjs`, `src/styles.html`, `tests/wave-v320-upgrades.test.js`)**: `package-lock.json` baru (257 paket, dari `npm install`) dan semua dependensi di-pin eksak (tanpa caret `^`). Vendor diperbarui satu per satu dengan suite penuh di antaranya: `@supabase/supabase-js` 2.45.4 → **2.119.2**, `jspdf` 2.5.1 → **4.2.1**, `jspdf-autotable` 3.5.28 → **5.0.9** (URL + hash sha256/sha384 baru di manifest; kompatibilitas `doc.autoTable` dibuktikan lewat `node:vm` dengan pola pemakaian `web/ui-export.js`; tag `<script>` + SRI di `src/styles.html` ikut diperbarui). `build.mjs` kini membersihkan `dist/` secara penuh sebelum build (sebelumnya hanya `dist/vendor/` yang dihapus) dan mendukung `SOURCE_DATE_EPOCH` untuk `builtAt` deterministik — dua build dengan SDE yang sama menghasilkan `dist/` identik byte-per-byte (dibuktikan tes + manual). Skema `versionCode` baru `major*1000000+minor*1000+patch` di `build.mjs` dan `patch-android-project.mjs` (3.20.8 = 3020008; 3.100.0 vs 3.0.100 tidak lagi bertabrakan seperti skema lama). Minifikasi esbuild 0.28.2 (devDependency ter-pin, bukan npx) hanya pada modul `web/*.js` yang di-inline: `dist/index.html` 1.288 KB → 943 KB (−27%); 55/55 blok `<script>` inline lolos kompilasi sintaks dan penanda global tetap ada.
- **Struktur Kode & Tanggal (`web/error-messages.js`, 42 file `web/*.js`, `src/features-v21.html`, `src/features-v35.html`, `src/script.html` dihapus)**: Tiga file stub mati dihapus (hanya berisi 1 baris komentar; `build.mjs` mengintersep nama `include()`-nya, bukan membaca file-nya). Helper bersama baru di `web/error-messages.js` (dimuat pertama): `escapeHtml()`, `localToday()`, `localDateKey()`, `isValidIsoDate()` — 4 rantai escape dan validasi tanggal di berbagai modul kini mendelegasikan ke sana. **Perbaikan bug tanggal**: `localToday()` ternyata didefinisikan di `ui-wallets.js` (urutan muat ke-9) sementara 17 situs memakai fallback UTC `toISOString().slice(0,10)` yang salah di WIB sebelum 07:00 (tanggal UTC masih kemarin — kelas bug yang sama dengan bug validasi Gelombang 3); definisi dipindah ke modul pertama dan ke-17 fallback dihapus, begitu juga fallback bulan `toISOString().slice(0,7)` pada `currentPeriod`/`curPeriod`. Setiap modul `web/*.js` kini membawa header `// @depends-on:` dan urutannya ditegakkan tes topologis.
- **Pemeriksaan Sintaks & CI (`scripts/check-syntax.mjs`, `.github/workflows/deploy.yml`)**: `check-syntax.mjs` kini memeriksa 90 file JS/MJS (`node --check`, termasuk `tests/*.js`), 12 file TypeScript Edge Function (strip tipe + kompilasi `vm`; `tsc --noEmit` tidak dipakai karena import `npm:` + global Deno tak bisa di-resolve — type-check penuh tetap Belum Diverifikasi), dan 4 skrip inline HTML (kompilasi `vm`); uji negatif membuktikan tiap kategori yang rusak membuat check exit 1. CI `verify` kini menjalankan `npm ci` (lockfile) sebelum build agar dist yang diuji/di-deploy sama dengan build lokal (tanpa install, build fallback tanpa minifikasi); `Build dist` di PR kini tanpa syarat `config.js`; langkah baru "Smoke test dist" menegaskan `dist/index.html` >100 KB, meta `app-version` == `package.json`, `version.json` cocok, tanpa tag resource CDN, vendor lokal lengkap, dan `sw.js` tanpa placeholder.
- **Tindak lanjut migrasi Wave 4 (`supabase/migrations/20261128090000_wave4_cycle_for_date_revoke_fix.sql` baru, `db/schema.sql`, PR #7)**: Verifikasi produksi PR #6 menemukan §1 migrasi 080000 tidak pernah berjalan — penjaganya memakai `to_regproc('public.cycle_for_date(date, int)')` yang SELALU NULL (to_regproc tidak menerima daftar argumen; yang benar `to_regprocedure`), dan revoke dari PUBLIC saja tidak menghapus grant eksplisit ke `anon`. Produksi diperbaiki manual (ACL kini hanya postgres/authenticated/service_role; RPC anon → 401 permission denied) dan migrasi 090000 membuat perbaikan itu permanen di repo, `schema.sql` diselaraskan (revoke `public, anon`), plus guard test yang menolak `to_regproc` berargumen di semua file SQL.

### 28 November 2026: Update v3.20.8 (Hardening Kecil: Biometrik, Pesan Error & Cache Lebih Aman)
- **Biometrik Punya Batas Percobaan & Verifikasi Saat Dimatikan (`web/ui-feat-native-ux.js`, `web/ui-feat-account.js`, `tests/wave4-low-hardening.test.js`)**: Percobaan sidik jari/biometrik yang gagal kini dibatasi — 5 kali gagal beruntun mengunci biometrik 60 detik, lalu 5 menit, 15 menit, dan 60 menit (durasi yang sama dengan lockout PIN); selama terkunci, authenticator tidak dipanggil sama sekali dan tombol coba-lagi nonaktif dengan label yang jelas. Mematikan biometrik kini wajib memverifikasi PIN saat ini (fail closed bila verifier tidak tersedia). Sukses biometrik kini hanya menandai sesi unlocked (`markBiometricUnlocked`) — sebelumnya `markPinUnlocked()` mereset state lockout PIN, sehingga PIN yang sedang terkunci bisa dilewati lewat biometrik. State throttle disimpan di localStorage `mk_biometric_lock_state_v1` (lapisan tambahan; pembatas utama tetap di OS/authenticator) dan ikut terhapus saat logout.
- **Pesan Error Aman untuk Pengguna (`web/error-messages.js` baru, `web/ui-state.js`, `web/supabase-auth.js`, `web/supabase-auth-ui.js`, `web/ui-feat-account.js`, `web/ui-reports.js`, `build.mjs`, `tests/wave4-low-hardening.test.js`)**: Modul baru `toUserErrorMessage(error, lang)` memetakan pola Supabase/auth/jaringan/DB ke pesan ramah ID/EN, mengganti pesan berpenanda teknis (SQL, RLS, JWT, stack) dengan pesan umum, dan meneruskan pesan yang memang ditulis untuk pengguna (`error.userMessage` / validasi klien) apa adanya; pesan mentah tetap masuk `console.error`. `showActionError` memakai sanitizer dengan fallback generik bila helper belum termuat. Situs login/daftar/lupa/Google, modal recovery, ganti kata sandi, hapus akun, dan status laporan tidak lagi menempelkan `error.message` mentah; dialog logout tidak lagi menampilkan alasan gagal pertama antrean.
- **Pemulihan Kata Sandi, Logout & Hapus Akun (`web/supabase-auth-ui.js`, `web/supabase-auth.js`, `web/delete-account.html`, `tests/wave4-low-hardening.test.js`)**: Tombol batal di modal pemulihan kata sandi kini memanggil `endRecoverySession` — signOut best-effort, modal ditutup, pengguna diberi tahu untuk meminta tautan baru; sebelumnya tombol hanya `wrap.remove()` sehingga pengguna diam-diam tetap login di bawah sesi recovery (label tombol kini "Akhiri Sesi & Tutup"). `LOGOUT_STORAGE_KEYS` kini mencakup `mk_dismissed_update_version` (penanda pembaruan yang ditunda) dan `mk_biometric_lock_state_v1`. Halaman hapus akun kini selalu meminta kata sandi (bidang selalu terlihat, wajib diisi) dan mengirimkannya ke `delete-account` sebagai `{ confirmation: 'HAPUS', password }` sesuai verifikasi ulang server (T4) — sebelumnya halaman tidak pernah mengirim kata sandi, sehingga dengan sesi aktif penghapusan berjalan tanpa verifikasi ulang sama sekali. Catatan akun Google-only kini jujur: tanpa kata sandi akun, penghapusan belum bisa dilakukan dari halaman ini (server memang menolak akun OAuth-only — follow-up).
- **Database & Skrip (`supabase/migrations/20261128080000_wave4_low_hardening.sql` baru, `db/schema.sql`, `.github/workflows/deploy.yml`, `.github/workflows/android-build.yml`, `README.md`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, `.gitignore`, `tests/wave4-low-hardening.test.js`)**: Migrasi baru (satu transaksi, idempotent, NOT VALID CHECK agar tidak pernah gagal pada data lama) menolak nominal negatif di `recurring`/`budgets`/`wallets.opening_balance` dan riwayat aset/target, serta memvalidasi `payrollDay` di `settings` (1–31); `cycle_for_date()` dicabut dari PUBLIC dan di-pin `search_path`. `db/schema.sql` (bootstrap v1 yang usang) kini menolak dijalankan ulang bila objek hardening sudah ada, memakai `IF NOT EXISTS`/`DROP POLICY IF EXISTS`, dan mem-pin `search_path` pada `cycle_for_date`. `SUPABASE_URL`/`SUPABASE_ANON_KEY` di kedua workflow CI kini dibaca dari GitHub **Secrets** (bukan Variables) — kedua Secret wajib dibuat di repo sebelum merge, karena `android-build.yml` berjalan saat push ke `main`. `.gitignore` kini mencakup `*.pem`/`*.key`/`*.p12`/`*.cer`, `google-services.json`, `GoogleService-Info.plist`, `*.apk`, `*.aab`. CRON_SECRET sudah keluar dari definisi job sejak Wave 2.3 (hanya dibaca dari Vault) — dicatat sebagai sudah selesai.
- **Bot Telegram & Frontend (`supabase/functions/telegram-bot/index.ts`, `web/sw.js`, `web/native-bridge.js`, `web/ui-export.js`, `web/ui-feat-backup.js`, `web/ui-feat-native-ux.js`, `tests/wave4-low-hardening.test.js`, `tests/wave3-edge-functions.test.js`)**: Endpoint `telegram-bot` kini menjawab 405 `Method Not Allowed` untuk metode non-POST (sebelumnya 200 `ok`); `telegram-setup` sudah 405. Cache service worker kini dibatasi 200 entri (tertua dihapus dulu) dan tidak diisi bila pemakaian storage melewati 80% kuota; kunci cache HTML kini menyertakan query string (`?v=2` vs `?v=3` tidak lagi berbagi kunci) sementara fallback offline tetap memakai precache. `openExternalUrl` kini memakai `isSafeExternalUrl` (hanya http/https; `javascript:`/`data:`/`file:` ditolak). Sanitasi formula spreadsheet kini juga menangkap spasi di depan pemicu (`= + - @`) dan karakter `| %` (OWASP) di CSV dan Excel (`safeExcelCell` dipindah ke lingkup modul dan diekspor). Dialog ekspor backup JSON kini memperingatkan bahwa JSON biasa **tidak terenkripsi** dan tombolnya bernama "JSON Biasa (Tidak Terenkripsi)". Selektor mati `[onclick*="addQuickNominalAmount"]` diganti `data-action` yang hidup. Tidak ada inline handler tersisa (verifikasi ulang Wave 2.4) dan judul notifikasi sistem sudah dipastikan teks polos, bukan HTML.

### 28 November 2026: Update v3.20.7 (Integritas Data: Restore Lengkap, Transfer Dicek Saldo & Validasi Menyeluruh)
- **Restore Kembali Utuh & Atomik (`web/finance-analysis-backup.js`, `web/ui-feat-backup.js`, `supabase/migrations/20261128060000_wave3_restore_rpc.sql`, `tests/wave3-restore-transfer.test.js`)**: Backup yang dibuat lalu di-restore kini mengembalikan semua 10 koleksi, termasuk transfer antar-dompet dan daftar utang/piutang yang sebelumnya hilang diam-diam. Bila dompet asal sebuah transaksi tidak ditemukan, restore berhenti dan melaporkan dompetnya — tidak lagi diam-diam memindahkan transaksi ke dompet pertama. Restore kini berjalan lewat RPC `restore_backup()` dalam satu transaksi database: semua masuk atau tidak sama sekali, dan restore yang diulang menjadi no-op berkat idempotency. Deduplikasi kini memakai ID transaksi yang stabil, jadi dua pembelian yang sama persis (mis. kopi tiap pagi) tidak lagi dianggap duplikat.
- **Transfer Antar-Dompet Dicek Saldo di Server (`supabase/migrations/20261128050000_wave3_transfer_rpc.sql`, `web/supabase-portfolio.js`, `tests/wave3-restore-transfer.test.js`)**: Transfer kini diproses RPC `transfer_between_wallets()` yang mengunci kedua dompet (`FOR UPDATE`), memeriksa kepemilikan dompet, dan menolak bila saldo tidak mencukupi (nominal + biaya) — saldo tidak bisa lagi minus, termasuk saat dua transfer bersamaan. Klien juga memeriksa saldo dulu dari data yang sudah dimuat dan menolak dengan pesan yang jelas. Batas nominal wajar Rp 999.999.999.999,99 ditegakkan di klien, server, dan database (`CHECK`).
- **Masuk & Kata Sandi Lebih Ketat (`web/native-bridge.js`, `web/supabase-auth.js`, `web/password-policy.js`, `web/ui-feat-account.js`, `supabase/functions/webauthn/index.ts`, `tests/wave3-auth-profile.test.js`)**: Login lewat aplikasi Android kini memeriksa kode pengaman `state` sekali pakai dan tidak lagi menerima token mentah dari tautan (cabang `setSession()` dihapus). Kata sandi baru di semua jalur (daftar, pemulihan, reset admin, ganti password) kini menolak pola mudah ditebak — 3 huruf sama berulang, urutan 4 karakter, kata sandi umum, dan kata sandi yang mengandung email — lewat validator bersama `web/password-policy.js` (aturan yang sama ditegakkan server di `admin-password`). PIN lama yang tersimpan dengan hash tanpa salt kini ditolak mentah sejak v3.20.7 (sebelumnya masih diterima dan dimigrasi diam-diam). Aplikasi kini mengunci sendiri setelah 2 menit tidak disentuh, bukan hanya saat tab disembunyikan. Profil yang hilang kini fail-closed (tidak lagi memakai cache offline untuk peran admin; cache kedaluwarsa 24 jam). Alur WebAuthn server-side (tabel `webauthn_credentials` + Edge Function `webauthn`) disiapkan sebagai draf yang belum diverifikasi — **jangan deploy dulu** — sementara verifikasi challenge client-side menjadi penahan interim.
- **Cadangan, Impor & Antrean Offline Lebih Ketat (`web/ui-feat-backup.js`, `web/transaction-import.js`, `web/ui-feat-offline.js`, `web/ui-feat-cache.js`, `tests/wave3-restore-transfer.test.js`)**: Cadangan terenkripsi kini memakai PBKDF2 600.000 iterasi (dari 150.000, sesuai OWASP) dan kata sandi minimal 12 karakter; cadangan lama 150.000 iterasi tetap bisa dibuka. Impor CSV kini menegakkan batas 500 baris data di dalam parser (bukan hanya di UI), menolak kategori tak dikenal, dompet kosong, dan nominal negatif dengan pesan yang menyebut barisnya. Antrean offline kini punya nomor urut (flush sesuai urutan), pemblokiran per target bila satu item gagal, cakupan operasi yang lebih luas (dompet, anggaran, target, recurring, aset, dll.), dan `api_savePeriod` tidak lagi pura-pura sukses saat offline. Snapshot offline kini menyimpan UID pengguna (bukan nama tampilan) dan kedaluwarsa 7 hari; snapshot akun lama dihapus saat akun berganti.
- **Database: Audit Tak Bisa Dipalsukan, Riwayat Aset & Pengaman Saldo (`supabase/migrations/20261128040000_wave3_database.sql`, `tests/wave3-database.test.js`)**: Catatan audit `admin_audit_logs` kini hanya bisa ditulis lewat RPC `admin_log_action()` dengan daftar aksi yang diizinkan, plus trigger append-only (UPDATE/DELETE selalu ditolak, termasuk oleh `service_role`) dan hash-chain yang bisa diverifikasi (`verify_admin_audit_log_chain()`). Celah `prevent_admin_lockout()` pada jalur DELETE (penghapusan admin terakhir lewat `service_role` lolos) ditutup. Tabel riwayat baru `asset_value_history` dan `financial_goal_history` mencatat setiap perubahan nilai/target aset — termasuk jalur dompet NULL dan edit langsung dari klien — lewat trigger. `create_asset_with_expense()` kini menolak quantity/harga beli negatif untuk semua tipe aset (sebelumnya hanya Crypto), didukung `CHECK` di tabel `assets`. OTP Telegram kini memakai HMAC-SHA256 dengan pepper dari Vault (bukan SHA-256 polos atas kode 8 digit) dan dibatasi 5 pembuatan per 10 menit.
- **Edge Function & Vendor Terverifikasi (`supabase/functions/admin-password/index.ts`, `supabase/functions/admin-user-ops/index.ts`, `supabase/functions/telegram-bot/*`, `supabase/functions/delete-account/index.ts`, `scripts/fetch-vendors.mjs`, `build.mjs`, `tests/wave3-edge-functions.test.js`, `tests/wave3-frontend-cdn-build.test.js`)**: CORS semua Edge Function kini fail-closed (default `*` dihapus; `telegram-setup` disatukan ke `ALLOWED_ORIGIN`); `delete-account` ikut diperbaiki saat final assembly. Reset kata sandi oleh admin kini tercatat di audit (`reset_password`) dan pemilik akun diberitahu lewat Telegram; hal yang sama untuk perubahan peran/status dan penghapusan akun. Kunci CoinGecko kini dikirim lewat header (bukan query string) dan `currency-api` di-pin ke `@2026.11.27` di Edge Function dan klien. Tanggal batch Telegram kini divalidasi terhadap kalender nyata, `/batch` dibatasi 50 baris + 1 per menit, ID recurring wajib UUID lengkap dengan konfirmasi hapus dua langkah, dan panggilan Gemini dibatasi per pengguna (10 OCR/jam, 3 insight/jam). Semua vendor kini terverifikasi hash-nya (sha256/sha384 di manifest) saat diunduh maupun dari cache; build gagal terbuka bila vendor hilang/rusak, tanpa lagi fallback diam-diam ke CDN (termasuk `document.write` Supabase yang dihapus); PR kini ikut mengunduh vendor agar artefak yang diverifikasi sama dengan yang di-deploy. CSP masih `unsafe-inline`/`unsafe-eval` (lihat audit-035 bagian Belum Diverifikasi).

### 28 November 2026: Update v3.20.6 (Bot Telegram Pribadi, Sesi Lebih Ketat & Antrean Offline Anti-Duplikat)
- **Bot Telegram Pribadi — Bring Your Own Bot (`supabase/migrations/20261128030000_wave2_personal_telegram_bots.sql`, `supabase/functions/telegram-setup/index.ts`, `supabase/functions/telegram-bot/core.ts`, `supabase/functions/telegram-bot/index.ts`, `supabase/functions/telegram-bot/ai.ts`, `web/supabase-admin.js`, `web/ui-admin.js`, `tests/wave2-telegram-personal-bot.test.js`)**: Tiap pengguna kini membuat botnya sendiri via @BotFather dan menghubungkannya lewat menu **Bot Telegram Saya** (panduan langkah demi langkah di aplikasi). Token divalidasi ke Telegram (`getMe`), dienkripsi AES-GCM 256-bit dengan kunci server (`TELEGRAM_TOKEN_ENCRYPTION_KEY`) sebelum disimpan di tabel baru `telegram_bots` (RLS aktif, tanpa akses klien), lalu webhook dipasang per pengguna dengan `link_secret` acak di URL dan `secret_token` acak di header. Semua pesan, pengingat, dan laporan dikirim lewat token bot pemilik chat (`resolveBotTokenForChat`, cache 60 detik; token env bersama hanya fallback transisi); unduhan foto/voice note juga memakai token bot pemilik request. Putus bot / hapus akun ikut memanggil `deleteWebhook`. OTP pairing kini disimpan sebagai hash SHA-256 (`otp_hash`) dan lookup-nya difilter `user_id` pemilik bot (T7); tulis langsung `telegram_chats`/`telegram_pairings` dari klien dicabut (T6, `telegram_chats` kini SELECT-only baris sendiri); dedup `update_id` webhook kini per bot.
- **Sesi & Kata Sandi Lebih Ketat (`web/supabase-admin.js`, `web/supabase-auth.js`, `web/ui-ai.js`, `web/ui-feat-offline.js`, `supabase/functions/delete-account/index.ts`, `supabase/functions/admin-password/index.ts`, `tests/wave2-sessions.test.js`)**: Ganti kata sandi kini wajib memverifikasi kata sandi lama (`signInWithPassword`) dan mencabut semua sesi lain (`signOut({ scope: 'others' })`). Hapus akun wajib autentikasi ulang dengan kata sandi saat ini (server memverifikasi sebelum menghapus). Keluar saat offline tetap menghapus token lokal (`signOut({ scope: 'local' })` + sapu kunci `sb-*-auth-token`) sehingga sesi lama tidak bisa masuk sendiri. Kunci Gemini pengguna kini dienkripsi dengan kunci PIN (Wave 1) saat disimpan, tidak lagi plaintext.
- **Antrean Offline Anti-Duplikat (`supabase/migrations/20261128020000_wave2_offline_idempotency.sql`, `web/ui-feat-offline.js`, `web/supabase-records.js`, `web/supabase-portfolio.js`, `tests/wave2-idempotency.test.js`)**: Setiap operasi antrean offline kini membawa `idempotency_key` yang dibuat sekali saat transaksi dibuat (tidak pernah dibuat ulang saat retry) dan disimpan di server dengan unique index `(user_id, idempotency_key)` pada `transactions` dan `transfers`. Bila pengiriman gagal di tengah jalan (lost response) lalu diulang, server mengembalikan baris yang sudah ada (konflik `23505`) alih-alih membuat duplikat. **Urutan deploy: migrasi ini wajib diterapkan SEBELUM klien baru ter-deploy, karena insert dengan kolom yang belum ada akan gagal.**
- **Sanitizer Allowlist & Migrasi Inline Handler (`web/ui-state.js`, `web/ui-delegated-actions.js`, `src/*.html`, `tests/wave2-xss-csp.test.js`)**: `renderHtml()` yang dulu hanya membuang `<script>` kini memakai sanitizer allowlist (`sanitizeHtml`/`sanitizeDocument`) yang membuang event handler, `<iframe srcdoc>`, dan vektor SVG. 183 inline handler (`onclick` dll.) dipindah ke delegated listener (`data-action`). CSP belum diperketat (masih `unsafe-inline`/`unsafe-eval`) karena build masih meng-inline semua JS — lihat audit-034 bagian Belum Diverifikasi.
- **Cron Terjaga: Batas Per-Run, Log & Vault (`supabase/migrations/20261128010000_wave2_cron_job_runs.sql`, `supabase/functions/telegram-bot/jobs.ts`, `supabase/schedule.sql`, `supabase/README.md`, `tests/wave2-cron.test.js`)**: `runRecurring` dibatasi 200 transaksi per jalan (sisanya dilewati tanpa diklaim, diambil run berikutnya). Setiap pemanggilan job tercatat di tabel baru `cron_job_runs` (job, pemicu, status, jumlah dibuat/dikirim/dilewati). `CRON_SECRET` keluar dari definisi pg_cron plaintext dan dibaca dari Supabase Vault (`vault.decrypted_secrets`); prosedur rotasi ada di `supabase/README.md`.

### 28 November 2026: Update v3.20.5 (Keamanan Data Lokal & Dompet Bank Utama untuk Cashflow Runway)
- **PIN sebagai Kunci Enkripsi & Gerbang Data (`web/ui-feat-account.js`, `web/ui-feat-cache.js`, `web/ui-feat-offline.js`, `web/ui-feat-hooks.js`, `web/ui-shell.js`, `tests/pin-encryption-gating.test.js`)**: PIN kini diminta *sebelum* data apa pun dimuat atau ditampilkan — termasuk dari snapshot offline — dan data lokal dienkripsi dengan DEK acak AES-GCM 256-bit yang dibungkus KEK turunan PIN (PBKDF2-SHA256 100.000 iterasi, domain `mk-data-key:`). Kunci yang sudah dibuka hanya hidup di memori; antrean offline dan snapshot IndexedDB tersimpan terenkripsi. Salah PIN berulang kini benar-benar mengunci: status lockout pindah ke IndexedDB (v3, store `pin_lock_state`) dengan jeda bertingkat 60 detik → 5 → 15 → 60 menit, dan setelah 3 kali terkunci pengguna wajib verifikasi ulang kata sandi akun.
- **Logout Aman & Admin di Sisi Server (`web/supabase-auth.js`, `web/supabase-admin.js`, `web/delete-account.html`, `supabase/functions/admin-user-ops/index.ts`, `supabase/migrations/20261128000000_wave1_admin_hardening.sql`, `tests/logout-offline-guard.test.js`, `tests/wave1-admin-hardening.test.js`)**: Logout kini ditahan bila antrean offline belum tersinkron — pengguna bisa sinkron sekarang, mengekspor cadangan darurat JSON, atau batal — sehingga transaksi offline tidak lagi hilang diam-diam. Aksi admin (ubah peran/status, putus Telegram, hapus akun) dipindah ke Edge Function `admin-user-ops` dengan verifikasi JWT, pemeriksaan admin aktif, dan audit server ke `admin_audit_logs`; pengguna pertama yang mendaftar tidak lagi otomatis menjadi admin, dan `UPDATE` langsung pada `profiles` dicabut dari peran `authenticated`. Reset kata sandi admin yang sebelumnya tidak bisa dipakai karena fungsinya terpasang dengan slug yang salah (`super-responder`) kini sudah diperbaiki dan terpasang sebagai `admin-password`.
- **Dompet Bank Utama sebagai Acuan Cashflow Runway (`web/finance-analysis-core.js`, `web/finance-analysis-portfolio.js`, `web/ui-wallets.js`, `web/ui-feat-recurring.js`, `web/finance-analysis-ai.js`, `web/supabase-core.js`, `tests/finance-analysis.test.js`)**: Pengguna kini bisa menandai satu dompet bank sebagai **Dompet Utama** (pengaturan `primaryBankWalletId` per pengguna, tanpa migrasi database). Strip Cashflow Runway lalu hanya memakai saldo dompet itu — dompet bank dan e-wallet lain otomatis dianggap tabungan dan tidak ikut menghitung — lengkap dengan label `Acuan: <nama dompet>` dan nama dompet acuan di ringkasan AI. Bila pengaturan kosong, dompetnya dihapus, atau bukan bank, perhitungan kembali ke total semua dompet seperti sebelumnya; angka Dana Darurat tetap memakai seluruh kas cair.

### 26 November 2026: Update v3.20.4 (Perbaikan Update Timpa In-Place APK Android & Polish Popup Mobile)
- **Signing Persisten APK & Verifikasi `apksigner` (`.github/workflows/android-build.yml`, `scripts/patch-android-project.mjs`, `.gitignore`)**: Memperbaiki masalah APK baru tidak bisa menimpa versi lama karena `ubuntu-24.04` (`XDG_CONFIG_HOME=/home/runner/.config`) membuat keystore acak berbeda di tiap run CI. `patch-android-project.mjs` kini menambatkan `signingConfigs.debug` secara eksplisit ke `android/debug-keystore.properties`; CI mengekspor `ANDROID_USER_HOME=$HOME/.android`, mendukung secret opsional `ANDROID_DEBUG_KEYSTORE_BASE64`, menyegarkan cache `android-debug-keystore-v1` tiap 5 hari lewat job keepalive, serta memverifikasi SHA-256 sertifikat APK dengan `apksigner verify --print-certs` sebelum publikasi ke GitHub Releases (`versionCode 32004`; APK lama `<= v3.20.3` perlu 1x uninstall sebelum memasang `v3.20.4`, lalu rilis berikutnya dapat langsung ditimpa).
- **Polish Popup & Floating Sheet Mobile (`src/styles.html`, `web/ui-pro-palette.js`, `web/ui-pro-reports.js`, `web/ui-calendar.js`, `web/ui-pro-insights.js`)**: Menyesuaikan bottom sheet mobile agar mengambang dengan 4 sudut membulat `28px` (bebas terpotong bezel melengkung & gesture/nav bar bawah pada perangkat iQOO 15R via `--safe-area-inset-bottom` & `overflow: hidden`), memosisikan `.swal2-close` absolut agar judul tidak terdorong turun, menambahkan bar aksi `.swal2-actions` sticky bersudut membulat pada sheet tinggi, merapikan spasi bawah `#mkCmdList` & penautan `#mkCmdCloseBtn` Command Palette, memberi spasi scrollbar & grid responsif pada Rekap Tahunan, meringkas nominal kalender tanpa `,00` (`tabular-nums`), serta memperkuat urutan inisialisasi AI & cincin fokus input.

### 25 November 2026: Update v3.20.3 (Perbaikan Kontras Dark Mode Popup, Layout Bottom Sheet & Polish Modal Form)
- **Kontras Tombol, Ikon Dark Mode & Bottom Sheet Mobile (`src/styles.html`)**: Menambatkan bottom sheet mobile ke tepi bawah viewport (`display: flex !important; justify-content: flex-end !important;` & `place-self: end stretch !important;`), memosisikan `.swal2-close` absolut di pojok kanan atas agar tidak mendorong judul turun, dan menempelkan bar `.swal2-actions` (`position: sticky; bottom: 0;`) pada bottom sheet tinggi. Memperbaiki kontras `.swal2-deny`, menghilangkan kotak putih masker ikon sukses mode gelap (`var(--mk-surface-elevated)`), menyembunyikan garis atas spinner `Swal.showLoading()`, merapikan grid drag handle & tata letak 1/2/3 tombol mobile, membatasi tinggi modal desktop `88dvh`, gating `:hover` desktop, serta menambah `color-scheme: dark`.
- **Polish Modal Pro, Kalender, Onboarding & Bahasa Indonesia (`web/ui-pro-insights.js`, `web/ui-pro-palette.js`, `web/ui-pro-reports.js`, `web/ui-calendar.js`, `web/ui-pro-quick.js`, `web/ui-budget.js`, `web/ui-debts.js`, `web/ui-form.js`, `web/ui-assets.js`, `web/ui-wallets.js`, `web/ui-admin.js`, `web/ui-feat-onboarding.js`)**: Menautkan `#mkCmdCloseBtn` setelah append, menambah padding bawah mobile `#mkCmdList` & `min-w-0 truncate` di Command Palette; menjadikan filter & kartu banding Rekap Tahunan responsif lengkap dengan spasi scrollbar (`pr-2`) di `Rekap 12 Siklus`; merapikan nominal kalender tanpa `,00` dengan `tabular-nums`; menambahkan label eksplisit, tab tersegmentasi, cincin fokus & badge total 100% di Kalkulator/Rebalance; serta menyeragamkan toast PWA, salin budget, onboarding, dan tombol aksi berbahasa Indonesia.

### 25 November 2026: Update v3.20.2 (Upgrade Gemini 4 Hydrogen, Interactions API, Enriched Financial AI & Redesign Popup)
- **Migrasi Gemini 4 Hydrogen & Interactions API (`web/ui-ai.js`, `web/supabase-auth.js`, `supabase/functions/telegram-bot/core.ts`, `supabase/functions/telegram-bot/ai.ts`, `supabase/README.md`)**: Mengganti model usang `gemini-2.5-flash` / `gemini-2.0-flash` menjadi default `gemini-4-hydrogen` (dengan auto-migrasi model tersimpan lama + fallback `gemini-3.5-flash-lite` & `gemini-4-argon`) melalui `POST /v1/interactions`, mode privat `store: false`, `thinking_level` resmi tanpa parameter usang (`temperature` / `thinkingBudget: 0` / `maxOutputTokens < 32768`), serta dialog konfigurasi AI lengkap (pemilih preset model Gemini 4 / Flash-Lite 3.5 + opsi kustom + kedalaman thinking).
- **Konteks Finansial Kaya, Fix Multi-Turn Chat & Markdown Aman (`web/finance-analysis-ai.js`, `web/ui-pro-insights.js`, `web/ui-feat-ai.js`, `src/ai.html`, `src/i18n.html`)**: Menambahkan `buildEnrichedAiSnapshot()` (rasio dana darurat, rasio utang, *cashflow runway*, *safe daily budget*, anomali belanja, alokasi aset, tren 3 siklus, target, dan utang aktif), `system_instruction` khusus analisis/chat/OCR, JSON Schema terstruktur (`CASHFLOW_ANALYSIS_SCHEMA` & `RECEIPT_OCR_SCHEMA`), perbaikan bug terpotongnya pertanyaan chat di atas 500 karakter lewat stateless `steps` (`buildAiChatSteps()`), renderer Markdown aman XSS untuk chat & ringkasan AI + tombol **Salin**, serta pembersihan `mk_gemini_thinking` saat logout.
- **Redesign Popup, Modal & Bottom Sheet (`src/styles.html`, `web/ui-asset-ops.js`, `web/ui-wallets.js`, `web/ui-feat-modals.js`, `web/ui-dashboard.js`, `web/ui-recurring.js`, `web/ui-pro-reports.js`, `web/ui-pro-palette.js`)**: Memperbaiki bug spesifisitas tombol `.swal2-confirm` agar menggunakan warna brand aplikasi tanpa menimpa aksen kontekstual, menambahkan backdrop blur, dark mode komprehensif, pil close & validasi, chevron `<select>` kustom, animasi masuk/keluar desktop ringan (`mkModalIn`/`mkModalOut`) serta sheet mobile (<= 639px), label aksesibel + grid responsif 2 kolom pada modal aset/dompet/target/jadwal rutin/rekap, dan footer shortcut bar pada Command Palette.

### 25 November 2026: Hotfix v3.20.1 (Native Android BiometricPrompt & Refresh Harga Aset Multi-Sumber)
- **Native Android BiometricPrompt & Perbaikan Sidik Jari (`scripts/patch-android-project.mjs`, `web/ui-feat-native-ux.js`, `web/ui-feat-account.js`)**: Menambahkan plugin Capacitor native `NativeBiometricPlugin.java` (`androidx.biometric:biometric:1.1.0`) dengan pendaftaran di `MainActivity.java` sebelum `super.onCreate()`, izin `USE_BIOMETRIC`/`USE_FINGERPRINT` di `AndroidManifest.xml`, registrasi `Capacitor.registerPlugin('NativeBiometric')`, pembersihan status biometrik saat PIN dihapus, tombol ulang **Buka dengan Sidik Jari** di layar kunci PIN, serta pemisahan jalur error WebView Android vs WebAuthn.
- **Refresh Harga Aset Multi-Sumber & Fallback Klien (`web/supabase-portfolio.js`, `web/ui-assets.js`, `supabase/functions/telegram-bot/jobs.ts`, `src/Index.html`, `web/sw.js`)**: Menambahkan fallback klien langsung (`fawazahmed0/currency-api` + CoinGecko) dan perluasan 50+ simbol crypto, Binance USDT ticker, serta origin Capacitor (`https://localhost`) di Edge Function `telegram-bot`, memperbaiki kalkulasi nilai awal crypto manual, mengizinkan endpoint pasar di CSP & bypass cache SW, serta menampilkan pesan informatif saat offline atau belum ada aset harga otomatis.

### 25 November 2026: Wave v3.20 (Native Android Stack, Cashflow Runway, Kalkulator Nominal, Offline Queue Penuh & Admin Panel v2)
- **Fix Tema Android, Notifikasi Native, Kamera OCR, Haptics, Pull-to-Refresh, Biometrik & Keystore (`web/ui-shell.js`, `web/native-bridge.js`, `web/ui-feat-ai.js`, `web/ui-feat-native-ux.js`, `web/ui-pro-hooks.js`, `web/ui-feat-account.js`, `scripts/patch-android-project.mjs`, `scripts/setup-android-keystore.mjs`)**: Memperbaiki `setTheme()` agar tidak menghapus kelas `mk-native-app`, menambahkan pengingat Android 20:00 & tagihan jatuh tempo (`@capacitor/local-notifications`), kamera Scan Struk native (`@capacitor/camera`), getaran taktil (`@capacitor/haptics`), *Pull-to-Refresh* + buka kunci biometrik sidik jari/WebAuthn, serta skrip helper `npm run cap:keystore`.
- **Cashflow Runway, Auto-Catat Rutin, Kalkulator Nominal, Onboarding 3-Langkah & Offline Mutasi Penuh (`web/finance-analysis-portfolio.js`, `web/ui-feat-recurring.js`, `web/ui-state.js`, `src/form.html`, `src/dashboard.html`, `web/ui-feat-onboarding.js`, `web/ui-feat-offline.js`)**: Menghitung proyeksi saldo akhir siklus & batas aman harian (`computeCashflowRunway()`), opsi *Auto-Catat Tagihan Rutin*, wizard onboarding pengguna baru 3 langkah, ekspresi aritmatika aman (`+`, `-`, `*`, `/`) langsung di kolom nominal, serta antrean offline untuk edit transaksi, hapus transaksi, dan transfer dompet.
- **Admin Panel v2 & Backup JSON AES-GCM (`supabase/migrations/20261125120000_admin_audit_and_telegram_unlink.sql`, `supabase/functions/admin-user-ops/index.ts`, `web/supabase-admin.js`, `web/ui-admin.js`, `src/admin.html`, `web/ui-feat-backup.js`)**: Menambahkan hapus akun user, putus tautan Telegram, dan log aktivitas admin, serta enkripsi/dekripsi opsional backup JSON berstandar **PBKDF2-SHA256 + AES-GCM 256-bit** dilengkapi suite uji `tests/wave-v320-upgrades.test.js`.

### 25 November 2026: Wave v3.19 (Standar Tampilan Android Material Design 3, Bottom Sheet Dialog & Proporsi Mobile 360dp)
- **Material 3 Tonal Surfaces & Native Bottom-Sheet Modals (`src/styles.html`, `src/Index.html`)**: Menambahkan sistem permukaan tonal Material Design 3 (`#f2f5f9` siang / `#080d17` malam OLED), padding *safe-area* atas/bawah penuh, navigation drawer beradius `28px` dengan item kapsul `48dp`, bottom nav indikator pill `56×32dp`, top app bar `56dp`, serta mengubah seluruh modal konfirmasi & input SweetAlert2 menjadi **Android Bottom Sheet** otomatis di layar `< 640px` lengkap dengan *drag handle* dan `prefers-reduced-motion`.
- **Proporsi Dashboard 360dp, Kalender & Form Thumb-Zone (`src/dashboard.html`, `src/form.html`, `web/ui-calendar.js`, `web/ui-wallets.js`, `web/ui-dashboard.js`, `web/ui-budget.js`)**: Menata ulang KPI Strip Hero Net Worth menjadi 2 tingkat agar nominal tidak terpotong di layar 360dp, menambah badge lingkaran hari ini di Kalender + segmented pill 3 bagian, menyusun baris transaksi Dashboard agar judul tetap lega, serta melengkapi Form Transaksi dengan dropdown chevron native, rail chip nominal dapat digulir, dan bar tombol simpan melayang (`sticky bottom-0`).
- **Konsistensi Seluruh Halaman & Auth Sheet (`src/{histori,budgeting,aset,laporan,ai,utang,admin,updates}.html`, `web/supabase-auth*.js`, `tests/android-m3-ui.test.js`)**: Menyeragamkan header kompak, grid tombol 2 kolom simetris, metrik Admin 2×2, menu dropdown Laporan anti-terpotong di HP, kartu login beradius `28px` berkontrol `48px`, pembaruan versi Android ke `3.19.1`, dan suite uji `tests/android-m3-ui.test.js`.
- **Popup Update Otomatis & GitHub Releases (`build.mjs`, `web/ui-feat-updates.js`, `src/updates.html`, `.github/workflows/android-build.yml`)**: Menambahkan pembuatan manifes `dist/version.json` otomatis, pembanding versi semver + popup Material 3 Bottom Sheet (*soft update* dan *force update* lewat `minSupportedVersion`), tombol **Cek Pembaruan**, pengecualian cache SW untuk `/version.json`, CSP `https://liandimiko.github.io`, serta publikasi `.apk` otomatis ke **GitHub Releases** lewat workflow tag `v*` atau input `publish_release`.
- **Hotfix v3.19.1 — Fix Freeze Penutupan Bottom Sheet Dialog (`src/styles.html`, `web/native-bridge.js`)**: Membatasi animasi `mkSheetUp` pada status `.swal2-popup.swal2-show` dan memetakan animasi tutup `.swal2-popup.swal2-hide` ke `mkSheetDown` (serta `animation: none !important` di `prefers-reduced-motion: reduce`) agar event `animationend` SweetAlert2 selalu terpanggil saat tombol **Tutup** / hardware **Back** ditekan pada Android (`< 640px`), disertai pemulihan kontainer `.swal2-hide` macet di `handleAndroidBackButton()`.

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

Fase v1–v3.20 (Multi-User SaaS, Offline-First PWA, Native Android Capacitor 8, Admin Panel v2, & Enkripsi Backup AES-GCM) telah selesai. Fokus rilis berikutnya:

- [x] Web PWA Offline-First + IndexedDB Snapshot & Antrean Sinkronisasi Mutasi Penuh
- [x] Multi-aset (Crypto, Emas, USD, Saham), Bank e-Statement CSV Import & Ekspor PDF/Excel/AES-GCM JSON
- [x] Android App Capacitor 8 (API 36), Native Plugins (Camera/Haptics/LocalNotifications) & Cloud Build APK/AAB (`android-build.yml`)
- [x] Ekspansi Panel Admin (hapus akun user, putus tautan Telegram & audit log)
- [ ] Google Play Console Closed Testing (12 tester × 14 hari) & rilis Production — lihat [docs/PLAYSTORE_LISTING_KIT.md](./docs/PLAYSTORE_LISTING_KIT.md)

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
| AI & Bot | Google Gemini 4 Hydrogen (Interactions API: Receipt OCR, Voice Note, Cashflow Analysis & Chat) + Telegram Bot API |
| Hosting & CI/CD | GitHub Pages + GitHub Actions (`deploy.yml` & `android-build.yml`) + Supabase Cloud |

---

## 👤 Author

**LiandiMiko** — [github.com/LiandiMiko](https://github.com/LiandiMiko)

> Dibuat dengan ❤️ untuk manajemen keuangan pribadi yang lebih baik.
