const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPeriodRange,
  isInPeriod,
  monthlyTrend,
  periodInsights,
  goalProgress,
  shiftPeriod,
  summarizePeriod,
  buildAiCashflowPayload,
  buildGeminiCashflowPrompt,
  parseGeminiCashflowResponse
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

test('period insights compare spending and identify actual budget overruns', () => {
  const insights = periodInsights(
    [
      { bulan: '2026-02', kategori: 'Makan', jumlah: 100 },
      { bulan: '2026-02', kategori: 'Transport', jumlah: 50 }
    ],
    [
      { tanggal: '2026-01-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 100 },
      { tanggal: '2026-02-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 150 },
      { tanggal: '2026-02-06', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 75 }
    ],
    '2026-02',
    1
  );

  assert.equal(insights.spendingChange, 125);
  assert.equal(insights.spendingChangePercent, 125);
  assert.equal(insights.highestSpending.category, 'Makan');
  assert.deepEqual(insights.overBudget.map((row) => row.category), ['Makan', 'Transport']);
});

test('goal progress is bounded and ignores invalid targets', () => {
  assert.equal(goalProgress(125, 100), 100);
  assert.equal(goalProgress(-5, 100), 0);
  assert.equal(goalProgress(50, 0), 0);
});

test('buildAiCashflowPayload computes net cashflow, savings rate, wallets, debts, and top categories', () => {
  const payload = buildAiCashflowPayload({
    wallets: [
      { id: 'w1', name: 'BCA', openingBalance: 1000000 },
      { id: 'w2', name: 'Cash', openingBalance: 200000 }
    ],
    transfers: [
      { fromWallet: 'w1', toWallet: 'w2', nominal: 100000, fee: 2500 }
    ],
    transactions: [
      { tanggal: '2026-03-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 10000000, walletId: 'w1' },
      { tanggal: '2026-03-02', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 3000000, walletId: 'w1' },
      { tanggal: '2026-03-03', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 1000000, walletId: 'w2' },
      { tanggal: '2026-03-04', tipe: 'Pemasukan', kategori: 'UtangPerson - Budi', nominal: 500000, walletId: 'w1' }
    ],
    assets: [{ name: 'BTC', value: 2000000 }],
    budgets: [{ bulan: '2026-03', kategori: 'Makan', jumlah: 2500000 }],
    goals: [{ name: 'Dana Darurat', targetAmount: 10000000, currentAmount: 4000000 }],
    recurring: [{ tipe: 'Pengeluaran', nominal: 200000, active: true }]
  }, '2026-03', 1);

  assert.equal(payload.incomeTotal, 10000000);
  assert.equal(payload.expenseTotal, 4000000);
  assert.equal(payload.netCashflow, 6000000);
  assert.equal(payload.savingsRate, 60);
  assert.equal(payload.walletsTotal, 7197500);
  assert.equal(payload.utangTotal, 500000);
  assert.equal(payload.assetsTotal, 2000000);
  assert.equal(payload.netWorth, 7197500 + 2000000 - 500000);
  assert.equal(payload.topExpenses[0].category, 'Makan');
  assert.equal(payload.topExpenses[0].sharePct, 75);
  assert.equal(payload.budgetSummary.overBudget[0].category, 'Makan');
  assert.equal(payload.goalsSummary.completionPct, 40);
  assert.equal(payload.recurringSummary.monthlyExpense, 200000);
});

test('buildGeminiCashflowPrompt and parseGeminiCashflowResponse handle JSON fences and fallback text', () => {
  const promptId = buildGeminiCashflowPrompt({ period: '2026-03' }, 'id');
  const promptEn = buildGeminiCashflowPrompt({ period: '2026-03' }, 'en');
  assert.match(promptId, /"healthScore"/);
  assert.match(promptEn, /Return ONLY a valid JSON object/);

  const fenced = parseGeminiCashflowResponse('```json\n{"healthScore": 140, "statusLabel": "Sehat", "ringkasan": "Surplus bagus", "sorotan": ["A"], "bocorAnggaran": [], "rekomendasi": ["B"]}\n```');
  assert.equal(fenced.healthScore, 100);
  assert.equal(fenced.statusLabel, 'Sehat');
  assert.equal(fenced.ringkasan, 'Surplus bagus');
  assert.deepEqual(fenced.sorotan, ['A']);
  assert.deepEqual(fenced.rekomendasi, ['B']);

  const plain = parseGeminiCashflowResponse('Kondisi keuangan cukup baik.');
  assert.equal(plain.healthScore, null);
  assert.equal(plain.ringkasan, 'Kondisi keuangan cukup baik.');
});
