# Audit 033: Dompet Bank Utama sebagai Acuan Cashflow Runway — 2026-11-28

Status: Complete (1 commit `bc2f7fa` di branch `feat/primary-bank-wallet-runway`, PR #2 OPEN — belum di-merge; bump versi `3.20.5` / `versionCode 32005` di branch yang sama agar rilis ini terlihat di aplikasi; pengujian manual di perangkat fisik belum dilakukan)

## Cakupan

Menambahkan penanda dompet bank utama sebagai acuan Cashflow Runway: hanya saldo dompet yang ditandai yang dihitung sebagai uang cashflow, sementara saldo dompet bank dan e-wallet lain otomatis dianggap tabungan. Pekerjaan dilakukan di branch + PR untuk review pemilik, tidak pernah langsung ke `main`.

## Temuan Forensik

- `computeCashflowRunway` (`web/finance-analysis-portfolio.js:305`) memakai `flows.walletsTotal` — jumlah saldo SELURUH dompet. Semua uang di bank maupun e-wallet dihitung sebagai cashflow.
- `aggregateWalletAndPeriodFlows` (`web/finance-analysis-core.js:167`) sudah menghitung saldo per dompet secara internal (map `walletBal`: openingBalance + transaksi + transfer) tetapi hanya mengekspos totalnya.
- "Dompet utama" sebelumnya implisit: `DB.wallets[0]` (dompet pertama menurut urutan sort), hanya dipakai sebagai fallback transaksi tanpa dompet — bukan sebagai acuan cashflow.
- Alasan pengguna (Liandi, 28 Nov 2026 04:07 WIB): tidak semua uang di bank/e-wallet adalah cashflow — sebagian adalah tabungan, jadi hanya dompet bank utama yang ditunjuk yang boleh dihitung sebagai uang cashflow.

## Perubahan yang Diterapkan

1. **Pengaturan `primaryBankWalletId` — tanpa migrasi database (`web/supabase-core.js` +1, `web/ui-shell.js` +1, `web/ui-state.js`)**: pengaturan per pengguna di tabel `settings` (mekanisme yang sama dengan pengaturan payday), masuk payload lewat `formatInitialDataPayload`, dimuat ke `DB.primaryBankWalletId` seperti `DB.payrollDay`, default `''`.
2. **`aggregateWalletAndPeriodFlows` mengekspos saldo per dompet (`web/finance-analysis-core.js` +3)**: field baru `walletBalances` (id → saldo), aditif — tidak ada field lama yang berubah.
3. **Logika acuan runway (`web/finance-analysis-portfolio.js` +18/−7)**: resolver baru `resolvePrimaryRunwayWallet` memvalidasi pengaturan (dompet ada, jenisnya `bank`, saldonya ditemukan di `walletBalances`); `liquidCash` = saldo dompet acuan bila valid, bila tidak fallback ke `walletsTotal`. Tanda tangan `computeCashflowRunway` tidak berubah; logika tagihan rutin dan sisa hari tidak berubah; hasil mengembalikan field baru `referenceWalletId` / `referenceWalletName`. `computeFinancialHealthRatios` (Dana Darurat) sengaja TIDAK diubah — tetap berbasis total kas cair.
4. **UI dompet, strip runway & ringkasan AI (`web/ui-wallets.js` +49, `web/supabase-records.js` +15, `web/ui-feat-recurring.js` +2, `web/finance-analysis-ai.js` +3)**: badge "Dompet Utama" dan tombol "Jadikan Utama" hanya di dompet bank; penyimpanan lewat handler baru `api_savePrimaryBankWallet` dengan validasi di sisi server (harus dompet bank milik pengguna). Menghapus dompet utama atau mengubah jenisnya dari bank membersihkan pengaturan otomatis dan runway kembali ke total. Strip runway menampilkan "Acuan: \<nama dompet\>" bila ada dompet utama. Ringkasan AI kini membawa `referenceWalletName` agar Gemini tidak salah mengira angka runway sebagai total kas.
5. **Bug offline ditemukan & diperbaiki sebelum delivery (`web/ui-feat-cache.js` +2)**: `primaryBankWalletId` belum masuk `SNAPSHOT_FIELDS`, sehingga pengaturan hilang saat aplikasi dibuka offline dan strip diam-diam kembali ke total. Diperbaiki dengan 1 baris; commit awal (`5e28367`) di-amend menjadi `bc2f7fa` dan di-force-push ke branch yang sama; tes dan cek sintaks diulang setelah amend — tetap hijau.
6. **Rilis v3.20.5 — visibilitas (branch yang sama)**: bump versi `3.20.4` → `3.20.5` (`package.json`, `src/Index.html`, `src/updates.html` dengan kartu rilis baru 28 November 2026 yang mencakup Gelombang 1 + fitur ini, `README.md`, `docs/ANDROID_PLAYSTORE_GUIDE.md`, tes yang mengunci versi). Tanpa bump ini, rilis tidak terlihat di aplikasi (riwayat pembaruan tetap menampilkan v3.20.4 dan updater in-app tidak pernah meminta update) — persis seperti yang terjadi pada Gelombang 1. `versionCode` 32005 diturunkan otomatis (`major * 10000 + minor * 100 + patch`, `scripts/patch-android-project.mjs:133`).

## Catatan Migrasi Pengguna

- Bila belum ada dompet utama yang ditandai, runway tetap memakai total semua dompet (perilaku lama) — penanda hanya berlaku setelah pengguna memilih satu dompet bank utama di layar Dompet.
- Menghapus dompet utama atau mengubah jenisnya dari bank membersihkan pengaturan otomatis; runway kembali ke total.
- Angka Dana Darurat (bulan darurat) tidak berubah — tetap memakai seluruh kas cair.
- Penanda bekerja per dompet: tabungan harus berada di dompet yang berbeda dari dompet utama agar tidak ikut terhitung.
- Update ke v3.20.5 menimpa v3.20.4 tanpa uninstall (keystore debug persisten yang sama, `versionCode 32005` > `32004`).

## Verifikasi

- **PASS (`node scripts/check-syntax.mjs`)**: sintaks terverifikasi di 60 file JS/MJS.
- **PASS (`node --test`)**: **107/107 lolos, 0 gagal** — 102 baseline (termasuk 25 tes Gelombang 1) + 5 tes baru di `tests/finance-analysis.test.js`: saldo per dompet termasuk transfer; runway memakai dompet utama saja; fallback untuk pengaturan kosong/ID tidak ada/bukan string/null; dompet tunai/e-wallet sebagai acuan diabaikan; rasio Dana Darurat tidak terpengaruh pengaturan ini.
- **PASS (CI `verify` PR #2)**: lolos (14 detik); PR https://github.com/LiandiMiko/mykeuangan/pull/2 berstatus OPEN, MERGEABLE, mergeStateStatus CLEAN — **tidak di-merge**.
- **PASS (`konoha:website_ai_detector` pada `src/`)**: skor **0** (`Human-Built`, PASS), 16 file (299.933 byte), 0 temuan, 50 ms, `2026-11-27T21:29:25Z`.
- **`aislop:aislop_scan` tidak dijalankan**: MCP aislop tidak tersedia di lingkungan ini — tidak ada skor yang dicatat.
- **PASS (`git diff --check`)**: keluar kode `0`.
- **Belum diverifikasi (butuh browser/perangkat fisik & keputusan pemilik)**: uji manual (tandai dompet bank utama, periksa strip runway menampilkan "Acuan: \<nama\>", hapus dompet utama dan pastikan runway kembali ke total, buka aplikasi offline dan pastikan pengaturan tidak hilang); keputusan merge PR #2 oleh Liandi.
