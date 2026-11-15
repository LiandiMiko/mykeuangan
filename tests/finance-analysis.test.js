const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPeriodRange,
  isInPeriod,
  monthlyTrend,
  shiftPeriod,
  summarizePeriod
} = require('../web/finance-analysis.js');

test('payroll cycle spans month and year boundaries', () => {
  assert.deepEqual(getPeriodRange('2026-01', 28), {
    start: '2025-12-28',
    end: '2026-01-27'
  });
  assert.equal(isInPeriod('2025-12-28', '2026-01', 28), true);
  assert.equal(isInPeriod('2026-01-28', '2026-01', 28), false);
});

test('budget analysis includes unbudgeted spending and excludes debt entries', () => {
  const result = summarizePeriod(
    [{ bulan: '2026-02', kategori: 'Makan', jumlah: 100000 }],
    [
      { tanggal: '2026-02-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000 },
      { tanggal: '2026-02-06', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 10000 },
      { tanggal: '2026-02-07', tipe: 'Pengeluaran', kategori: 'UtangPerson - A', nominal: 50000 },
      { tanggal: '2026-02-08', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 300000 }
    ],
    '2026-02',
    1
  );

  assert.equal(result.budgetTotal, 100000);
  assert.equal(result.actualTotal, 35000);
  assert.equal(result.remaining, 65000);
  assert.deepEqual(result.rows.map((row) => row.category), ['Makan', 'Transport']);
  assert.equal(result.rows[1].percent, null);
});

test('monthly trend contains consecutive months in chronological order', () => {
  assert.deepEqual(
    monthlyTrend([], [], '2026-01', 1, 3).map((month) => month.period),
    ['2025-11', '2025-12', '2026-01']
  );
  assert.equal(shiftPeriod('2026-01', -1), '2025-12');
});

test('monthly trend compares each payroll cycle with its own budget month', () => {
  const trend = monthlyTrend(
    [{ bulan: '2026-01', kategori: 'Makan', jumlah: 5000 }],
    [
      { tanggal: '2025-12-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 3000 },
      { tanggal: '2026-01-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 2000 }
    ],
    '2026-01',
    28,
    2
  );

  assert.equal(trend[1].period, '2026-01');
  assert.equal(trend[1].budgetTotal, 5000);
  assert.equal(trend[1].actualTotal, 3000);
});
