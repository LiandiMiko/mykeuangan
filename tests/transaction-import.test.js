const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRows, parseTransactionCsv } = require('../web/transaction-import.js');

test('CSV parser handles quoted commas, escaped quotes, and CRLF rows', () => {
  assert.deepEqual(
    parseRows('tanggal,catatan\r\n2026-03-01,"Kopi, ""susu"""\r\n'),
    [['tanggal', 'catatan'], ['2026-03-01', 'Kopi, "susu"']]
  );
});

test('transaction import validates rows and skips existing and in-file duplicates', () => {
  const csv = [
    'tanggal,tipe,kategori,nominal,keterangan,dompet',
    '2026-03-01,Pengeluaran,Makan,15000,"Kopi, susu",Cash',
    '2026-03-01,Pengeluaran,Makan,15000,"Kopi, susu",Cash',
    '2026-02-30,Pengeluaran,Makan,15000,,Cash',
    '2026-03-02,Pemasukan,Gaji,100000,,Cash'
  ].join('\r\n');
  const existing = [{
    tanggal: '2026-03-02', tipe: 'Pemasukan', kategori: 'Gaji',
    nominal: 100000, keterangan: '', walletId: 'cash-id'
  }];
  const result = parseTransactionCsv(csv, existing, [{ id: 'cash-id', name: 'Cash' }]);

  assert.equal(result.valid.length, 1);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.valid[0].keterangan, 'Kopi, susu');
});

test('transaction import requires supported headers and paired quotes', () => {
  assert.throws(() => parseTransactionCsv('date,type,amount', [], []), /Kolom wajib/);
  assert.throws(() => parseRows('a,b\n1,"unfinished'), /tanda kutip/);
});

test('CSV parser supports semicolon delimiters and bank mutation statements (BCA/Mandiri)', () => {
  const semicolonCsv = [
    'tanggal;tipe;kategori;nominal;keterangan;dompet',
    '18/11/2026;Pengeluaran;Makan;Rp 45.000;Sarapan pagi;Cash'
  ].join('\n');
  const parsedSemi = parseTransactionCsv(semicolonCsv, [], [{ id: 'w-cash', name: 'Cash' }]);
  assert.equal(parsedSemi.valid.length, 1);
  assert.equal(parsedSemi.valid[0].tanggal, '2026-11-18');
  assert.equal(parsedSemi.valid[0].nominal, 45000);

  const bankCsv = [
    'Date,Uraian,Mutasi,DB/CR,Dompet',
    '17/11/2026,"QRIS WARUNG KOPI","25000.00",DB,BCA',
    '18/11/2026,"TRANSFER MASUK GAJI","5,000,000.00",CR,BCA'
  ].join('\n');
  const parsedBank = parseTransactionCsv(bankCsv, [], [{ id: 'w-bca', name: 'BCA' }]);
  assert.equal(parsedBank.invalidCount, 0);
  assert.equal(parsedBank.valid.length, 2);
  assert.deepEqual(parsedBank.valid[0], {
    tanggal: '2026-11-17',
    tipe: 'Pengeluaran',
    kategori: 'Lainnya',
    nominal: 25000,
    keterangan: 'QRIS WARUNG KOPI',
    walletId: 'w-bca'
  });
  assert.deepEqual(parsedBank.valid[1], {
    tanggal: '2026-11-18',
    tipe: 'Pemasukan',
    kategori: 'Lainnya',
    nominal: 5000000,
    keterangan: 'TRANSFER MASUK GAJI',
    walletId: 'w-bca'
  });

  const debitCreditCsv = [
    'Tanggal,Uraian,Debit,Kredit',
    '18-11-2026,Listrik PLN,350.000,',
    '18-11-2026,Cashback,,15.500'
  ].join('\n');
  const parsedDC = parseTransactionCsv(debitCreditCsv, [], [{ id: 'w-1', name: 'BCA' }]);
  assert.equal(parsedDC.valid.length, 2);
  assert.equal(parsedDC.valid[0].tipe, 'Pengeluaran');
  assert.equal(parsedDC.valid[0].nominal, 350000);
  assert.equal(parsedDC.valid[1].tipe, 'Pemasukan');
  assert.equal(parsedDC.valid[1].nominal, 15500);
});

test('CSV parser skips bank statement preamble rows and parses IDR, accounting parens, no-space DB/CR, and case-insensitive dedup', () => {
  const bankPreambleCsv = [
    'Rekening: 1234567890',
    'Periode: November 2026',
    'Mata Uang: IDR',
    '',
    'Tanggal;Uraian;Mutasi',
    '19/11/2026;TARIK TUNAI ATM;"(150.000)"',
    '19/11/2026;BAYAR QRIS MART;IDR 25.000DB',
    '19/11/2026;BAYAR qris mart;IDR 25.000DB',
    '20/11/2026;TOPUP BONUS;IDR 500000CR'
  ].join('\n');

  const existing = [{
    tanggal: '2026-11-20',
    tipe: 'Pemasukan',
    kategori: 'Lainnya',
    nominal: 500000,
    keterangan: 'topup bonus',
    walletId: 'w-bca'
  }];

  const res = parseTransactionCsv(bankPreambleCsv, existing, [{ id: 'w-bca', name: 'BCA' }]);
  assert.equal(res.invalidCount, 0);
  assert.equal(res.duplicateCount, 2);
  assert.equal(res.valid.length, 2);
  assert.equal(res.valid[0].tipe, 'Pengeluaran');
  assert.equal(res.valid[0].nominal, 150000);
  assert.equal(res.valid[0].line, undefined);
  assert.equal(res.rows[0].line, 6);
  assert.equal(res.rows[1].line, 7);
  assert.equal(res.valid[1].nominal, 25000);
  assert.equal(res.valid[1].tipe, 'Pengeluaran');
});

test('CSV parser canonicalizes explicit category casing and matches user categories without substring collisions', () => {
  const csv = [
    'tanggal,tipe,kategori,nominal,keterangan,dompet',
    '2026-11-20,Pengeluaran,laundry,25000,Cuci baju,Cash',
    '2026-11-21,Pengeluaran,LAUNDRY,30000,Cuci selimut,Cash'
  ].join('\n');
  const res = parseTransactionCsv(csv, [], [{ id: 'w-cash', name: 'Cash' }], {
    categories: { pengeluaran: ['Laundry', 'Transportasi', 'Lainnya'], pemasukan: ['Gaji'] }
  });
  assert.equal(res.valid.length, 2);
  assert.equal(res.valid[0].kategori, 'Laundry');
  assert.equal(res.valid[1].kategori, 'Laundry');

  const bankCsv = [
    'Tanggal,Uraian,Debit,Kredit',
    '2026-11-22,QRIS LAUNDRY PAKAIAN KILAT,45000,',
    '2026-11-23,BAYAR REPAIR SEPATU,60000,'
  ].join('\n');
  const bankRes = parseTransactionCsv(bankCsv, [], [{ id: 'w-bca', name: 'BCA' }], {
    categories: { pengeluaran: ['Laundry', 'Tagihan', 'Transportasi', 'Lainnya'], pemasukan: ['Gaji'] }
  });
  assert.equal(bankRes.valid.length, 2);
  assert.equal(bankRes.valid[0].kategori, 'Laundry');
  assert.equal(bankRes.valid[1].kategori, 'Lainnya');
});

/* ============================================================
   Gelombang 7c Item 4 — pemilih dompet impor CSV
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const { resolveDefaultImportWalletId, resolveImportTargetWallet } = require('../web/transaction-import.js');

const WALLETS_7C = [
  { id: 'w-cash', name: 'Cash', kind: 'cash' },
  { id: 'w-bca', name: 'BCA', kind: 'bank' },
  { id: 'w-dana', name: 'DANA', kind: 'ewallet' }
];

const BANK_CSV_7C = [
  'Tanggal,Uraian,Debit,Kredit',
  '2026-11-22,QRIS WARUNG KOPI,25000,',
  '2026-11-23,TRANSFER MASUK GAJI,,5000000'
].join('\n');

test('7c/CSV dompet default = dompet utama bank bila diset dan valid', () => {
  const res = parseTransactionCsv(BANK_CSV_7C, [], WALLETS_7C, { primaryBankWalletId: 'w-bca' });
  assert.equal(res.valid.length, 2);
  assert.equal(res.targetWalletId, 'w-bca');
  assert.equal(res.walletFallback, null);
  assert.equal(res.hasWalletColumn, false);
  assert.ok(res.valid.every((tx) => tx.walletId === 'w-bca'));
});

test('7c/CSV pilihan eksplisit dipakai untuk semua baris impor', () => {
  const res = parseTransactionCsv(BANK_CSV_7C, [], WALLETS_7C, {
    primaryBankWalletId: 'w-bca',
    targetWalletId: 'w-dana'
  });
  assert.equal(res.valid.length, 2);
  assert.equal(res.targetWalletId, 'w-dana');
  assert.equal(res.walletFallback, null);
  assert.ok(res.valid.every((tx) => tx.walletId === 'w-dana'));
});

test('7c/CSV tanpa pilihan berperilaku seperti dulu (dompet pertama)', () => {
  // Tanpa options sama sekali: persis perilaku lama (wallets[0]).
  const legacy = parseTransactionCsv(BANK_CSV_7C, [], WALLETS_7C);
  assert.equal(legacy.targetWalletId, 'w-cash');
  assert.equal(legacy.walletFallback, null);
  assert.ok(legacy.valid.every((tx) => tx.walletId === 'w-cash'));
  // primaryBankWalletId tidak diset / kosong juga kembali ke dompet pertama.
  const noPrimary = parseTransactionCsv(BANK_CSV_7C, [], WALLETS_7C, { primaryBankWalletId: '' });
  assert.equal(noPrimary.targetWalletId, 'w-cash');
  assert.ok(noPrimary.valid.every((tx) => tx.walletId === 'w-cash'));
});

test('7c/CSV dompet utama tidak valid (terhapus / bukan bank) → dompet pertama', () => {
  assert.equal(resolveDefaultImportWalletId(WALLETS_7C, 'w-hilang'), 'w-cash');
  assert.equal(resolveDefaultImportWalletId(WALLETS_7C, 'w-dana'), 'w-cash');
  assert.equal(resolveDefaultImportWalletId(WALLETS_7C, 'w-cash'), 'w-cash');
  assert.equal(resolveDefaultImportWalletId(WALLETS_7C, 123), 'w-cash');
  assert.equal(resolveDefaultImportWalletId(WALLETS_7C, null), 'w-cash');
  assert.equal(resolveDefaultImportWalletId([], 'w-bca'), '');
  assert.equal(resolveDefaultImportWalletId(WALLETS_7C, 'w-bca'), 'w-bca');
  const res = parseTransactionCsv(BANK_CSV_7C, [], WALLETS_7C, { primaryBankWalletId: 'w-hilang' });
  assert.equal(res.targetWalletId, 'w-cash');
  assert.ok(res.valid.every((tx) => tx.walletId === 'w-cash'));
});

test('7c/CSV dompet pilihan tidak valid → fallback aman + penanda fallback', () => {
  const res = parseTransactionCsv(BANK_CSV_7C, [], WALLETS_7C, {
    primaryBankWalletId: 'w-bca',
    targetWalletId: 'w-terhapus'
  });
  // Tidak gagal diam-diam dan tidak masuk ke dompet yang salah:
  // semua baris masuk ke default (dompet utama) dan fallback dilaporkan.
  assert.equal(res.targetWalletId, 'w-bca');
  assert.deepEqual(res.walletFallback, { requested: 'w-terhapus', used: 'w-bca' });
  assert.ok(res.valid.every((tx) => tx.walletId === 'w-bca'));
  // Tanpa dompet utama pun fallback tetap aman (dompet pertama).
  const noPrimary = parseTransactionCsv(BANK_CSV_7C, [], WALLETS_7C, { targetWalletId: 'w-asing' });
  assert.equal(noPrimary.targetWalletId, 'w-cash');
  assert.deepEqual(noPrimary.walletFallback, { requested: 'w-asing', used: 'w-cash' });
  assert.ok(noPrimary.valid.every((tx) => tx.walletId === 'w-cash'));
  // Pilihan eksplisit yang valid tidak menghasilkan fallback.
  assert.equal(resolveImportTargetWallet(WALLETS_7C, { targetWalletId: 'w-dana' }).walletFallback, null);
});

test('7c/CSV batas 500 baris tetap ditegakkan dengan dompet pilihan', () => {
  const rows = ['Tanggal,Uraian,Debit,Kredit'];
  for (let i = 0; i < 500; i += 1) rows.push(`2026-11-22,TRANSAKSI ${i},1000,`);
  const ok = parseTransactionCsv(rows.join('\n'), [], WALLETS_7C, { targetWalletId: 'w-bca' });
  assert.equal(ok.valid.length, 500);
  assert.ok(ok.valid.every((tx) => tx.walletId === 'w-bca'));
  rows.push('2026-11-22,TRANSAKSI 500,1000,');
  assert.throws(
    () => parseTransactionCsv(rows.join('\n'), [], WALLETS_7C, { targetWalletId: 'w-bca' }),
    /melebihi batas 500 baris data \(ditemukan 501 baris data setelah header\)/
  );
});

test('7c/CSV kolom dompet di file tetap menang per baris (pengecualian terdokumentasi)', () => {
  const csv = [
    'tanggal,tipe,kategori,nominal,keterangan,dompet',
    '2026-11-20,Pengeluaran,Makan,25000,Cuci baju,Cash',
    '2026-11-21,Pengeluaran,Makan,30000,Cuci selimut,DANA'
  ].join('\n');
  const res = parseTransactionCsv(csv, [], WALLETS_7C, { targetWalletId: 'w-bca' });
  assert.equal(res.hasWalletColumn, true);
  assert.equal(res.valid.length, 2);
  assert.equal(res.valid[0].walletId, 'w-cash');
  assert.equal(res.valid[1].walletId, 'w-dana');
  assert.equal(res.walletFallback, null);
});

test('7c/UI impor: pemilih dompet tampil sebelum file, pilihan diteruskan ke parser, jalur simpan tidak berubah', () => {
  const reports = fs.readFileSync(path.join(__dirname, '..', 'web', 'ui-reports.js'), 'utf8');
  // Pemilih (dialog Swal + select dompet) ada dan dibuka dari tombol impor
  // SEBELUM pemilih file — bukan sesudah parse.
  assert.match(reports, /async function promptImportWallet\(\)/);
  assert.match(reports, /csvImportWalletSelect/);
  assert.match(reports, /walletOptions\(defaultId, true\)/);
  assert.match(reports, /const walletId = await promptImportWallet\(\);/);
  assert.match(reports, /pendingImportWalletId = walletId;/);
  // Pilihan + dompet utama diteruskan ke parser; parser yang memvalidasi.
  assert.match(reports, /targetWalletId: selectedWalletId \|\| ''/);
  assert.match(reports, /primaryBankWalletId: DB\.primaryBankWalletId \|\| ''/);
  // Pratinjau menampilkan dompet tujuan + pesan fallback yang jelas.
  assert.match(reports, /t\('lap\.import_wallet'\)/);
  assert.match(reports, /t\('lap\.import_wallet_fallback'\)/);
  assert.match(reports, /t\('lap\.import_wallet_per_row'\)/);
  // Jalur simpan tetap yang sudah ada: satu-satunya pengiriman impor
  // adalah api_importTransactions dengan result.valid — tidak ada jalur
  // tulis baru, tidak ada api_addTransaction di alur impor.
  assert.equal((reports.match(/callServer\('api_importTransactions'/g) || []).length, 1);
  assert.doesNotMatch(reports, /api_addTransaction/);
  // Semua kunci i18n baru dipakai di UI dan ada di kamus ID + EN.
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.html'), 'utf8');
  for (const key of [
    'lap.import_wallet', 'lap.import_wallet_title', 'lap.import_wallet_hint',
    'lap.import_wallet_fallback', 'lap.import_wallet_per_row', 'lap.import_no_wallet'
  ]) {
    assert.match(reports, new RegExp(`t\\('${key.replace(/\./g, '\\.')}'\\)`), `kunci ${key} tidak dipakai di ui-reports.js`);
    const occurrences = (i18n.match(new RegExp(`'${key.replace(/\./g, '\\.')}':`, 'g')) || []).length;
    assert.equal(occurrences, 2, `kunci ${key} harus ada tepat 2x di i18n.html (ID + EN), ditemukan ${occurrences}x`);
  }
});
