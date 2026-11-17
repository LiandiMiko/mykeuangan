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
