# Google Play Store Listing & Compliance Kit — MyKeuGuech

Panduan siap salin (*copy-paste*) untuk mengisi seluruh kolom di **Google Play Console → Store presence & App content** bagi aplikasi **MyKeuGuech** (`com.mykeuguech.app`).

---

## 1. Metadata Toko — Bahasa Indonesia (`id`, Default)

- **App Name (maks. 30 karakter):**
  `MyKeuGuech: Keuangan & Budget` *(29 karakter)*
- **Short Description (maks. 80 karakter):**
  `Catat pengeluaran, budget siklus gajian, dompet, aset & AI keuangan offline.` *(75 karakter)*
- **Full Description (maks. 4.000 karakter):**

```text
MyKeuGuech membantu Anda mencatat pengeluaran harian, memantau anggaran sesuai tanggal gajian, mengelola saldo banyak dompet, serta melacak tabungan, utang/piutang, dan nilai investasi pribadi dalam satu aplikasi yang cepat dan ramah mode offline.

FITUR UTAMA:
• Budget Siklus Gajian Kustom (Tanggal 1–28): Pantau progres anggaran kategori secara akurat sesuai siklus gajian Anda, lengkap dengan Burn Rate Harian, proyeksi akhir siklus, dan daftar pengeluaran di luar budget agar tidak ada transaksi yang terlewat.
• Catat Cepat & Transaksi Rutin: Input 1 baris instan (mis. "kopi 25rb bca"), deteksi kategori otomatis berbasis kata kunci kustom, pengingat jadwal tagihan rutin jatuh tempo, serta Split Bill otomatis ke Piutang.
• Multi-Dompet, Transfer & Utang/Piutang: Kelola saldo Bank, Tunai, dan E-wallet secara real-time, catat transfer/tarik tunai, serta pantau pinjaman dan jatuh tempo dengan histori lengkap.
• Pelacakan Portofolio & Target Tabungan: Catat progres target dana darurat, portofolio Emas (gram), Crypto, Valas USD, dan Saham/Reksa Dana lengkap dengan grafik alokasi aset & evaluasi Net Worth.
• Offline-First & Ekspor Lengkap: Tetap bisa membuka riwayat dan mencatat transaksi saat internet mati (antrean sinkronisasi IndexedDB otomatis saat online), serta ekspor laporan ke CSV, Excel (.xls), PDF, atau Backup JSON terstruktur.
• Analisis AI Opsional (BYOK): Gunakan Gemini API Key pribadi secara on-demand untuk memindai foto struk belanja atau merangkum skor kesehatan arus kas tanpa proses latar belakang otomatis.

PRIVASI & CATATAN PENTING:
MyKeuGuech adalah aplikasi pencatatan keuangan pribadi (personal bookkeeping & budgeting tool). Aplikasi ini tidak menyediakan layanan perbankan, penyaluran pinjaman/kredit, transfer uang antarbank nyata, maupun layanan investasi/broker berizin. Seluruh catatan keuangan tersimpan terenkripsi saat transit dan dapat diekspor atau dihapus permanen kapan saja oleh pengguna.
```

- **Release Notes v3.18 (`id`, maks. 500 karakter):**
  ```text
  • Tambah tombol cepat + Buat Budget untuk pengeluaran di luar kategori budget.
  • Normalisasi pencocokan kategori & kata utuh pada Quick-Add, Budgeting, CSV, dan Laporan.
  • Dukungan mode offline penuh (vendor lokal + cache snapshot), ekspor Android Share Sheet, dan login Google Sign-In.
  ```

---

## 2. Store Listing — English (`en-US`)

- **App Name (max 30 chars):**
  `MyKeuGuech: Budget & Finance` *(28 chars)*
- **Short Description (max 80 chars):**
  `Track expenses, payroll budgets, wallets, investments & offline finance sync.` *(77 chars)*
- **Full Description (max 4,000 chars):**

```text
MyKeuGuech is an offline-friendly personal finance and budgeting app built around real-world payroll cycles. Track daily spending, organize multiple wallets, manage debts and savings goals, and review your net worth in one clean workspace.

KEY FEATURES:
• Custom Payroll Cycle Budgeting (Days 1–28): Track category limits against your actual payday schedule with daily burn-rate projections, overrun warnings, and an Unbudgeted Expenses inspector so nothing slips through the cracks.
• Quick-Add & Recurring Bills: Log transactions in one line, auto-categorize entries cleanly with custom keyword rules, record due recurring bills in one tap, and track split bills as receivables.
• Multi-Wallet & Debt Ledger: Track Bank, Cash, and E-wallet balances, internal transfers, loans, and receivables with optional due dates and complete audit trails.
• Goals & Manual Portfolio Tracking: Monitor savings milestones alongside your manually tracked Cash, Gold, USD, Stock, and Crypto holdings with net worth history and allocation charts.
• True Offline Cache & Flexible Exports: View your latest snapshot and queue new expenses offline with automatic sync on reconnect, or export filtered reports to CSV, Excel, PDF, and JSON backups via native Android Share.
• On-Demand AI Tools (BYOK): Optionally connect your own Gemini API key for receipt scanning and cashflow insights strictly when requested.

DISCLAIMER:
MyKeuGuech is strictly a personal finance tracker and manual bookkeeping tool. It does not offer banking, lending, credit underwriting, money transmission, or regulated brokerage services.
```

- **Release Notes v3.18 (`en-US`, max 500 chars):**
  ```text
  • Added 1-tap budget creation chips from Unbudgeted Expenses in Budgeting.
  • Fixed case/whitespace category matching and whole-word auto-categorization across Quick-Add, CSV, and Reports.
  • Bundled offline assets, Google Sign-In deep links, Android Share exports, and Indonesian/English UI polish.
  ```

---

## 3. Aset Grafis Play Console & Screenshot Checklist

1. **App Icon (`512 × 512` PNG):**
   - Hasil otomatis dari `npm run playstore:assets` (atau unduh artifact `mykeuguech-playstore-assets` dari GitHub Actions): `playstore-assets/icon-512.png`.
2. **Feature Graphic (`1024 × 500` PNG):**
   - Hasil otomatis: `playstore-assets/feature-graphic-1024x500.png`.
3. **Phone Screenshots (minimal 4, disarankan 6–8 screenshot `9:16` / `1080×2400` dari HP uji):**
   - Dashboard Hero (Net Worth, Arus Kas & Quick-Add)
   - Budgeting (Progres Budget Siklus, Burn Rate Forecast & Pengeluaran di Luar Budget)
   - Kalender Finansial & Kartu Dompet
   - Tabungan, Rasio Kesehatan & Alokasi Portofolio
   - Laporan & Ekspor (Filter Dompet + Grafik)
   - Analisis Keuangan AI / Mode Gelap (*Dark Mode*)
4. **Klasifikasi Toko:**
   - **App / Game:** App
   - **Category:** Finance (*Keuangan*)
   - **Paid / Free:** Free (tanpa Iklan & tanpa In-App Purchase)
   - **Support Email:** gunakan email developer aktif Anda sendiri di Play Console

---

## 4. Lembar Jawab Kepatuhan (*App Content* Declarations)

| Bagian Play Console | Jawaban / Nilai yang Diisi |
|---|---|
| **Privacy Policy URL** | `https://liandimiko.github.io/mykeuangan/privacy.html` |
| **Account Deletion URL** | `https://liandimiko.github.io/mykeuangan/delete-account.html` |
| **Ads Declaration** | **No**, my app does not contain ads. |
| **App Access** | **All or some functionality is restricted** → sediakan 1 akun demo Reviewer Google Play (email + password khusus test yang statusnya `active` & berisi data contoh non-sensitif). |
| **Financial Features Declaration** | Pilih **My app doesn't provide any financial features** / personal expense & budget tracking only (jelaskan aplikasi adalah *manual personal expense & budget ledger*, bukan layanan pinjaman, dompet elektronik berizin, kripto exchange, atau penasihat investasi berizin). |
| **Target Audience** | **18 and over** (atau **16–17 and 18+**, hindari menargetkan anak-anak agar terbebas dari kebijakan *Families*). |
| **News / COVID-19 / Gov Apps** | **No** pada seluruh deklarasi khusus. |
| **Content Rating (IARC)** | Semua ages (`3+` / `Everyone`) — tidak ada konten kekerasan, judi, maupun UGC publik. |

### Ringkasan Formulir **Data Safety**

- **Collects or shares required user data?** Yes (Collects; **Does NOT share** with third parties for ads/analytics).
- **Encrypted in transit?** Yes (HTTPS / TLS via Supabase & GitHub Pages).
- **Data deletion mechanism?** Yes (In-app **Pengaturan Akun → Hapus Akun & Data Permanen** & URL web publik `delete-account.html`).
- **Tipe data yang dideklarasikan (*Collected, Required for app functionality, Not Shared*):**
  1. **Personal info → Email address & Name:** untuk autentikasi akun (Email/Google Sign-In) dan sapaan profil.
  2. **Financial info / User-generated financial records** *(catatan transaksi/budget/dompet yang diinput sendiri oleh pengguna — bukan akses rekening bank otomatis)*: untuk sinkronisasi multi-perangkat dan laporan pengguna.
  3. *(Opsional jika mengaktifkan Gemini / OCR Struk)* **Photos:** hanya diproses on-demand ke Google Gemini API ketika pengguna secara eksplisit memilih gambar struk memakai API key miliknya sendiri; tidak disimpan permanen di server MyKeuGuech.

---

## 5. Checklist Closed Testing (Akun Developer Pribadi)

1. Buat release di track **Closed testing** dengan mengunggah `app-release.aab`.
2. Tambahkan minimal **12 email Gmail tester** (atau Google Group berisi tester tepercaya) yang benar-benar menekan tautan *opt-in* dan meng-install aplikasi.
3. Jaga tester tetap opt-in dan membuka/menguji aplikasi selama **14 hari berturut-turut** (jangan hapus daftar tester sebelum hitung mundur 14 hari selesai).
4. Setelah 14 hari selesai, isi kuesioner uji tertutup Google Play (*Feedback & Testing Summary*) lalu ajukan akses rilis **Production**.
