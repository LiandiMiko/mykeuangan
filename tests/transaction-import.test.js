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
