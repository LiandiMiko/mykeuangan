# Audit 010: Implementasi Wave v3.2 (Emas/USD Top-Up & Jual, Alokasi Portofolio, Anomaly Detector, Restore JSON & PWA Shortcuts) - 2026-11-18

Status: Complete

## Cakupan & Implementasi

### 1. Helper Analitik Portofolio, Anomali & Restore JSON (`web/finance-analysis.js`, `tests/finance-analysis.test.js`)
- Menambahkan `computeAssetAllocation(data)` untuk mengelompokkan kas dompet + aset *Cash*, *Emas*, *Crypto*, *Valas USD*, dan *Saham/Lainnya* dengan persentase porsi serta skor diversifikasi (`diversificationScore`).
- Menambahkan `detectSpendingAnomalies(transactions, recurring, period, payrollDay)` untuk mendeteksi transaksi lonjakan ekstrem (`>= max(250.000, 2.5x rata-rata)`) dan menghitung *Fixed Cost Ratio* dari jadwal rutin keluar yang aktif.
- Menambahkan `prepareBackupRestorePayload(backupObj, existingData)` untuk memvalidasi file backup JSON (baik field `transactions` maupun `transaksi`), menghapus `id` lama pada `goals`, dan mendeteksi duplikasi transaksi, budget, dan target keuangan sebelum impor.
- Menambahkan 3 suite unit test baru pada `tests/finance-analysis.test.js`.

### 2. Top-Up/Pencairan Emas & USD, Date Picker Transfer/Utang & 1-Klik Catat Rutin (`src/script.html`, `web/supabase-api.js`)
- Memperluas modal `topUpAsset()` dan `withdrawAsset()` di `src/script.html` agar mendukung unit `gram` (`Emas`) dan `USD` (`Valas USD`) dengan kalkulasi otomatis `nominal <-> unit`, serta sinkronisasi `quantity` & weighted-average `buy_price` pada `api_topUpAsset()` dan `api_withdrawAsset()` di `web/supabase-api.js`.
- Menambahkan pemilih tanggal (`#tf-date` dan `#swal-date`) pada modal `openTransferModal()` dan `transactDebt()`.
- Menambahkan tombol 1-klik `⚡ Catat` (`recordRecurringFromNotif()`) di setiap kartu `#recurringList` pada `renderRecurring()`.

### 3. Alokasi Portofolio, Restore JSON, PWA Shortcuts & Sidebar Install (`src/aset.html`, `src/laporan.html`, `web/manifest.webmanifest`, `src/Index.html`, `src/features-v21.html`, `src/i18n.html`)
- Menambahkan `#assetAllocationPanel` di `src/aset.html` dan renderer `renderAssetAllocation()` di `src/features-v21.html`.
- Menambahkan `renderBudgetAnomalyBanner()` untuk menampilkan rasio biaya rutin dan lonjakan pengeluaran tepat di bawah `#budgetInsights`.
- Menambahkan tombol **Restore JSON** (`triggerRestoreJson()`, `handleRestoreJsonFile()`) di `src/laporan.html` & `src/features-v21.html`.
- Menambahkan 4 *App Shortcuts* (`?action=pengeluaran`, `pemasukan`, `scan`, `budgeting`) di `web/manifest.webmanifest`, container `#pwaInstallWrap` di sidebar `src/Index.html`, listener `beforeinstallprompt` / `appinstalled`, `installPwaApp()`, serta dispatcher `handlePwaShortcutAction()`.
- Menambahkan kunci terjemahan ID & EN (`aset.allocation_title`, `nav.install_pwa`, `lap.restore_json`) di `src/i18n.html` serta menyelaraskan catatan rilis di `README.md` dan `src/admin.html`.

## Verifikasi
- PASS (static inspection via `konoha`): seluruh modifikasi di `web/finance-analysis.js`, `tests/finance-analysis.test.js`, `src/script.html`, `web/supabase-api.js`, `src/aset.html`, `src/laporan.html`, `web/manifest.webmanifest`, `src/Index.html`, `src/features-v21.html`, `src/i18n.html`, `src/admin.html`, dan `README.md` telah ditinjau ulang secara statis untuk konsistensi ID DOM, signature fungsi/RPC, serta skema data JSON backup (`transactions` / `budgets` / `goals`).
- BLOCKED (`node --test`, `node build.mjs`): tidak dapat dieksekusi dari runner terminal sesi karena *working directory* sesi menunjuk ke `c:\Users\Acer\Documents\GitHub\mykeuangan\mykeuangan` yang tidak tersedia di disk.

## Belum diverifikasi
- Eksekusi `node --test` dan `node build.mjs` pada PowerShell lokal di `c:\Users\Acer\Documents\GitHub\mykeuangan`.
- Pengujian runtime di browser (top-up/pencairan parsial aset Emas & USD, date picker Transfer/Utang, restore file JSON backup, serta shortcut PWA setelah build & deploy).
