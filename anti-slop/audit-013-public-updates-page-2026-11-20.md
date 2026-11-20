# Audit 013: Halaman Riwayat Pembaruan Publik (`#view-updates`) - 2026-11-20

Status: Partial (Implementasi kode, lokalisasi, test regresi statis, dan sinkronisasi skill selesai; eksekusi lokal `node --test`, `node build.mjs`, dan verifikasi visual browser dijalankan oleh pengguna)

## Cakupan & Implementasi

### 1. Sumber Tunggal Halaman Pembaruan (`src/updates.html`, `src/styles.html`)
- Membuat [updates.html](file:///c:/Users/Acer/Documents/GitHub/mykeuangan/src/updates.html) (`#view-updates`) dengan atribut `data-latest-release="2026-11-20-v3.4"` dan `data-latest-version="v3.4"`.
- Merapikan tata letak riwayat rilis agar tidak memanjang:
  - Rilis terbaru (**Wave v3.4**) tampil terbuka penuh dengan badge **Terbaru** dan highlight tema aktif (`border-brand/30`).
  - Seluruh 7 rilis sebelumnya (`v3.3` s/d `v1.1` / `17 Nov 2026`) dipindahkan ke komponen `<details data-release-details>` yang ringkas & bisa dibuka-tutup per item maupun sekaligus melalui tombol **Buka Semua / Tutup Semua** (`#btnToggleAllReleases`).
  - Menambahkan kolom pencarian `#updatesSearchInput` (`oninput="filterUpdatesList()"`) dan filter 5 topik (`all`, `security`, `assets`, `reports`, `ai`) beserta penanda jumlah hasil `#updatesCountLabel` dan `#updatesEmptyState`.
- Menambahkan `.release-summary::-webkit-details-marker { display: none; }` pada `src/styles.html`.

### 2. Akses Semua Pengguna & Pembersihan Panel Admin (`src/Index.html`, `src/admin.html`)
- Menambahkan tombol sidebar `#nav-updates` (**Pembaruan**) di `src/Index.html` tepat di atas `#nav-admin` agar terlihat oleh seluruh pengguna (non-admin maupun admin), dilengkapi pill versi `#navUpdatesVersion` (`v3.4`) dan titik indikator belum dibaca `#navUpdatesDot`.
- Menambahkan `<?!= include('updates'); ?>` pada container view utama di `src/Index.html`.
- Menghapus duplikasi ~250 baris blok `<article>` riwayat rilis dari `src/admin.html` dan menggantinya dengan kartu tautan ringkas **Buka Riwayat Pembaruan** (`switchView('updates')`).

### 3. Pelacakan Rilis Baru, Notifikasi, i18n & Skill (`src/script.html`, `src/features-v21.html`, `src/i18n.html`, `.agents/skills/change-notes-sync/SKILL.md`, `README.md`)
- Menambahkan pemanggilan `markLatestReleaseSeen()` di `switchView('updates')` (`src/script.html`).
- Menambahkan `LAST_SEEN_RELEASE_KEY` (`mk_last_seen_release`), `refreshUpdatesBadge()`, `markLatestReleaseSeen()`, `setUpdatesTopic()`, `filterUpdatesList()`, `toggleAllReleaseDetails()`, serta 1 item info rilis belum dibaca di `getCurrentNotifications()` (`src/features-v21.html`) dan pembaruan daftar saat `renderAll()` / `DOMContentLoaded`.
- Menambahkan kunci terjemahan `ID`/`EN` (`nav.updates`, `updates.*`) di `src/i18n.html`.
- Memperbarui `.agents/skills/change-notes-sync/SKILL.md` dan `README.md` agar rilis mendatang otomatis disinkronkan ke `src/updates.html`.
- Menambahkan test regresi statis [updates-view.test.js](file:///c:/Users/Acer/Documents/GitHub/mykeuangan/tests/updates-view.test.js).

## Verifikasi
- **PASS (`aislop:aislop_scan`)**: Skor tetap **67/100** (**1 error**, **16 warning**); nol error/warning baru pada file tambahan `tests/updates-view.test.js` maupun modul JS lain (1 error tersisa tetap dari `web/config.js:6` gitignored).
- **PASS (`konoha:token_efficient_grep`)**:
  - `src/Index.html` memuat `#nav-updates` (tanpa `display:none`) dan `include('updates')`.
  - `src/updates.html` memuat `#view-updates`, `data-latest-release`, `data-latest-version`, `#updatesSearchInput`, `#updatesList`, 1 `<article>` rilis terbaru + 7 `<details>` rilis lama.
  - `src/admin.html` tidak lagi memuat `<article>` dan menautkan tombol ke `switchView('updates')`.
  - `src/script.html` memuat seluruh 8 token wajib `tests/calendar-render.test.js` dan `markLatestReleaseSeen()`.
- **BLOCKED (`node --test`, `node build.mjs`)**: Shell runner agen mengarah ke subfolder `mykeuangan/mykeuangan` yang tidak ada, sehingga eksekusi test unit & build `dist/` dijalankan oleh pengguna di terminal lokal.

## Langkah Lanjutan untuk Pengguna
- Jalankan `node --test` dan `node build.mjs` di root repo untuk memvalidasi test baru (`updates-view.test.js`) serta membundel `dist/index.html` dan `dist/sw.js`.
- Commit & push seluruh perubahan ke GitHub lalu uji tampilan **Pembaruan** di sidebar (mode terang/gelap & mobile).
