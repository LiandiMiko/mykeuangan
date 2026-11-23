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
  parseGeminiCashflowResponse,
  calculateGoalMonthlySaving,
  monthlyCashflowSeries,
  buildAppNotifications,
  buildReceiptOcrPrompt,
  parseReceiptOcrResponse,
  buildAiFinancialChatPrompt,
  computeFinancialHealthRatios,
  recommendCategoryBudgets,
  computeAssetAllocation,
  detectSpendingAnomalies,
  prepareBackupRestorePayload,
  projectGoalMilestone,
  getDueRecurringBills,
  computeNetWorthSeries,
  compileOnePageFinancialStatement,
  computeCycleForecast
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

test('calculateGoalMonthlySaving handles completed, overdue, urgent, and normal targets', () => {
  assert.deepEqual(calculateGoalMonthlySaving(5000000, 5000000, '2026-12-31', '2026-11-18'), {
    remaining: 0, daysLeft: 0, monthsLeft: 0, monthlySaving: 0, status: 'completed'
  });

  const onTrack = calculateGoalMonthlySaving(2000000, 8000000, '2027-02-16', '2026-11-18');
  assert.equal(onTrack.remaining, 6000000);
  assert.equal(onTrack.daysLeft, 90);
  assert.equal(onTrack.monthsLeft, 3);
  assert.equal(onTrack.monthlySaving, 2000000);
  assert.equal(onTrack.status, 'on_track');

  const urgent = calculateGoalMonthlySaving(100000, 500000, '2026-11-28', '2026-11-18');
  assert.equal(urgent.status, 'urgent');
  assert.equal(urgent.monthsLeft, 1);

  const overdue = calculateGoalMonthlySaving(100000, 500000, '2026-11-10', '2026-11-18');
  assert.equal(overdue.status, 'overdue');
  assert.equal(overdue.monthlySaving, 400000);
});

test('monthlyCashflowSeries aggregates income and expense excluding debt transactions', () => {
  const series = monthlyCashflowSeries([
    { tanggal: '2026-02-05', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 5000000 },
    { tanggal: '2026-02-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 1200000 },
    { tanggal: '2026-03-01', tipe: 'Pemasukan', kategori: 'UtangPerson - Andi', nominal: 1000000 },
    { tanggal: '2026-03-02', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 300000 }
  ], '2026-03', 1, 2);

  assert.equal(series.length, 2);
  assert.deepEqual(series[0], { period: '2026-02', incomeTotal: 5000000, expenseTotal: 1200000, netCashflow: 3800000 });
  assert.deepEqual(series[1], { period: '2026-03', incomeTotal: 0, expenseTotal: 300000, netCashflow: -300000 });
});

test('buildAppNotifications detects budget alerts, upcoming recurring rules, urgent goals, and offline queue', () => {
  const alerts = buildAppNotifications({
    budgets: [
      { bulan: '2026-11', kategori: 'Makan', jumlah: 1000000 },
      { bulan: '2026-11', kategori: 'Transport', jumlah: 500000 }
    ],
    transactions: [
      { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 1200000 },
      { tanggal: '2026-11-06', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 420000 }
    ],
    recurring: [
      { id: 'r1', kategori: 'Internet', nominal: 350000, dayOfMonth: 20, lastRun: '', active: 'true' },
      { id: 'r2', kategori: 'Listrik', nominal: 200000, dayOfMonth: 18, lastRun: '2026-11-18', active: 'true' }
    ],
    goals: [
      { id: 'g1', name: 'Darurat', targetAmount: 1000000, currentAmount: 500000, targetDate: '2026-11-25' }
    ],
    offlineQueueCount: 2
  }, '2026-11', 1, '2026-11-18');

  assert.equal(alerts.some((a) => a.id === 'budget:2026-11:Makan' && a.severity === 'danger'), true);
  assert.equal(alerts.some((a) => a.id === 'budget:2026-11:Transport' && a.severity === 'warning'), true);
  assert.equal(alerts.some((a) => a.id === 'recurring:r1'), true);
  assert.equal(alerts.some((a) => a.id === 'recurring:r2'), false);
  assert.equal(alerts.some((a) => a.id === 'goal:g1' && a.severity === 'warning'), true);
  assert.equal(alerts.some((a) => a.id === 'offline:queue' && a.actionType === 'sync_offline'), true);
});

test('receipt OCR helpers and AI chat prompt builder format and validate correctly', () => {
  const prompt = buildReceiptOcrPrompt({ pengeluaran: ['Makan', 'Belanja'], pemasukan: ['Gaji'] }, '2026-11-18', 'id');
  assert.match(prompt, /Makan, Belanja/);

  const parsed = parseReceiptOcrResponse('```json\n{"tanggal":"2026-11-17","tipe":"Pengeluaran","kategori":"Makan","nominal":45500,"keterangan":"Indomaret - Kopi & Roti"}\n```', '2026-11-18');
  assert.deepEqual(parsed, {
    tanggal: '2026-11-17',
    tipe: 'Pengeluaran',
    kategori: 'Makan',
    nominal: 45500,
    keterangan: 'Indomaret - Kopi & Roti'
  });

  const chatPrompt = buildAiFinancialChatPrompt({ netWorth: 10000000 }, 'Bisa nabung berapa?', 'id');
  assert.match(chatPrompt, /Bisa nabung berapa\?/);
  assert.throws(() => buildAiFinancialChatPrompt({}, '   ', 'id'), /wajib/);
});

test('computeFinancialHealthRatios and recommendCategoryBudgets calculate runway, debt ratio, and averages', () => {
  const sampleData = {
    wallets: [{ id: 'w1', name: 'BCA', openingBalance: 10000000 }],
    assets: [{ name: 'Tabungan Darurat', type: 'Cash', value: 2000000 }, { name: 'BTC', type: 'Crypto', value: 4000000 }],
    transactions: [
      { tanggal: '2026-09-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 2000000, walletId: 'w1' },
      { tanggal: '2026-10-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 3000000, walletId: 'w1' },
      { tanggal: '2026-11-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 10000000, walletId: 'w1' },
      { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 4000000, walletId: 'w1' },
      { tanggal: '2026-11-08', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 123000, walletId: 'w1' },
      { tanggal: '2026-11-10', tipe: 'Pemasukan', kategori: 'UtangPerson - Andi', nominal: 2000000, walletId: 'w1' }
    ]
  };

  const ratios = computeFinancialHealthRatios(sampleData, '2026-11', 1);
  // liquidCash = (10M + 10M - 2M - 3M - 4M - 0.123M) + 2M = 12,877,000; avg 3 cycles = (2M + 3M + 4.123M)/3 = 3,041,000
  assert.equal(ratios.liquidCash, 12877000);
  assert.equal(ratios.avgMonthlyExpense, 3041000);
  assert.equal(ratios.emergencyRunwayMonths, 4.2);
  assert.equal(ratios.runwayStatus, 'good');
  // 2026-11 income=10M, expense=4,123,000 -> net=5,877,000 -> savingsRate=58.8%
  assert.equal(ratios.savingsRatePct, 58.8);
  assert.equal(ratios.savingsStatus, 'excellent');
  // grossAssets = 10,877,000 + 6,000,000 = 16,877,000; debt = 2,000,000 -> ~11.9%
  assert.equal(ratios.debtToAssetPct, 11.9);
  assert.equal(ratios.debtStatus, 'good');

  const recs = recommendCategoryBudgets(sampleData.transactions, '2026-11', 1, 3);
  assert.equal(recs[0].category, 'Makan');
  assert.equal(recs[0].recommendedAmount, 3000000);
  assert.equal(recs[0].activeCycles, 3);
  assert.equal(recs[1].category, 'Transport');
  assert.equal(recs[1].recommendedAmount, 130000);
});

test('computeAssetAllocation groups wallets and asset classes with shares and diversification score', () => {
  const alloc = computeAssetAllocation({
    wallets: [{ id: 'w1', balance: 5000000 }, { id: 'w2', balance: -100000 }],
    assets: [
      { name: 'Tabungan', type: 'Cash', value: 5000000 },
      { name: 'Antam', type: 'Emas', value: 4000000 },
      { name: 'BTC', type: 'Crypto', value: 3000000 },
      { name: 'USD', type: 'USD', value: 2000000 },
      { name: 'BBCA', type: 'Saham', value: 1000000 }
    ]
  });

  assert.equal(alloc.total, 20000000);
  assert.equal(alloc.diversificationScore, 5);
  assert.deepEqual(
    alloc.segments.map((s) => [s.key, s.amount, s.sharePct]),
    [
      ['cash', 10000000, 50],
      ['emas', 4000000, 20],
      ['crypto', 3000000, 15],
      ['usd', 2000000, 10],
      ['other', 1000000, 5]
    ]
  );
});

test('detectSpendingAnomalies identifies spending spikes and computes fixed cost ratio', () => {
  const result = detectSpendingAnomalies(
    [
      { id: 't1', tanggal: '2026-11-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 10000000 },
      { id: 't2', tanggal: '2026-11-02', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Sarapan' },
      { id: 't3', tanggal: '2026-11-03', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 60000, keterangan: 'Siang' },
      { id: 't4', tanggal: '2026-11-04', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 40000, keterangan: 'Ojek' },
      { id: 't5', tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Elektronik', nominal: 2500000, keterangan: 'Servis Laptop' },
      { id: 't6', tanggal: '2026-11-06', tipe: 'Pengeluaran', kategori: 'UtangPerson - Andi', nominal: 3000000 }
    ],
    [
      { id: 'r1', tipe: 'Pengeluaran', nominal: 1500000, active: true },
      { id: 'r2', tipe: 'Pengeluaran', nominal: 500000, active: 'true' },
      { id: 'r3', tipe: 'Pengeluaran', nominal: 800000, active: false },
      { id: 'r4', tipe: 'Pemasukan', nominal: 10000000, active: true }
    ],
    '2026-11',
    1
  );

  assert.equal(result.expenseCount, 4);
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].id, 't5');
  assert.equal(result.anomalies[0].nominal, 2500000);
  assert.equal(result.fixedExpenseTotal, 2000000);
  assert.equal(result.fixedCostRatioPct, 20);
  assert.equal(result.fixedCostBasis, 'income');
});

test('prepareBackupRestorePayload deduplicates transactions, budgets, and goals', () => {
  const payload = prepareBackupRestorePayload(
    {
      transactions: [
        { tanggal: '2026-11-01', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Bakso' },
        { tanggal: '2026-11-02', tipe: 'Pemasukan', kategori: 'Bonus', nominal: 500000, keterangan: 'Project' }
      ],
      budgets: [
        { bulan: '2026-11', kategori: 'Makan', jumlah: 1000000 },
        { bulan: '2026-11', kategori: 'Hobi', jumlah: 300000 }
      ],
      goals: [
        { id: 'old-id-1', name: 'Dana Darurat', targetAmount: 10000000, currentAmount: 2000000, targetDate: '2027-01-01' },
        { id: 'old-id-2', name: 'Laptop Baru', targetAmount: 15000000, currentAmount: 1000000, targetDate: '2027-06-01' }
      ]
    },
    {
      transactions: [{ tanggal: '2026-11-01', tipe: 'Pengeluaran', kategori: 'makan', nominal: 50000, keterangan: 'Bakso' }],
      budgets: [{ bulan: '2026-11', kategori: 'Makan', jumlah: 1000000 }],
      goals: [{ name: 'Dana Darurat', targetAmount: 10000000 }]
    }
  );

  assert.equal(payload.valid, true);
  assert.equal(payload.newTransactions.length, 1);
  assert.equal(payload.skippedTransactions, 1);
  assert.equal(payload.newTransactions[0].kategori, 'Bonus');
  assert.equal(payload.newBudgets.length, 1);
  assert.equal(payload.skippedBudgets, 1);
  assert.equal(payload.newGoals.length, 1);
  assert.equal(payload.skippedGoals, 1);
  assert.equal(payload.newGoals[0].id, undefined);
});

test('projectGoalMilestone calculates months remaining and projected completion date', () => {
  const result = projectGoalMilestone(4000000, 10000000, '2027-05-01', 1000000, 0, '2026-11-18');
  assert.equal(result.status, 'in_progress');
  assert.equal(result.remaining, 6000000);
  assert.equal(result.percent, 40);
  assert.equal(result.projectedMonths, 6);
  assert.equal(result.projectedDate, '2027-05');

  const completed = projectGoalMilestone(10000000, 10000000, '', 0, 0, '2026-11-18');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.remaining, 0);
});

test('getDueRecurringBills finds active bills due this cycle and excludes upcoming or recorded ones', () => {
  const recurring = [
    { id: 'r1', tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 350000, dayOfMonth: 5, active: true },
    { id: 'r2', tipe: 'Pengeluaran', kategori: 'Internet', nominal: 400000, dayOfMonth: 15, active: true },
    { id: 'r3', tipe: 'Pengeluaran', kategori: 'Gym', nominal: 250000, dayOfMonth: 1, active: false },
    { id: 'r4', tipe: 'Pengeluaran', kategori: 'Sewa', nominal: 1500000, dayOfMonth: 25, active: true },
    { id: 'r5', tipe: 'Pengeluaran', kategori: 'Air', nominal: 100000, dayOfMonth: 2, lastRun: '2026-11-02', active: true }
  ];
  const transactions = [
    { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 350000 }
  ];

  const due = getDueRecurringBills(recurring, transactions, '2026-11-18', '2026-11', 1);
  assert.equal(due.count, 1);
  assert.equal(due.dueBills[0].id, 'r2');
  assert.equal(due.dueBills[0].dueDate, '2026-11-15');
  assert.equal(due.totalDueAmount, 400000);

  // Split payroll cycle (2026-10-28 .. 2026-11-27): day 29 belongs to 2026-10-29 (due by Nov 18)
  const splitDue = getDueRecurringBills([
    { id: 's1', tipe: 'Pengeluaran', kategori: 'BPJS', nominal: 150000, dayOfMonth: 29, active: true },
    { id: 's2', tipe: 'Pengeluaran', kategori: 'Cloud', nominal: 200000, dayOfMonth: 24, active: true }
  ], [], '2026-11-18', '2026-11', 28);
  assert.equal(splitDue.count, 1);
  assert.equal(splitDue.dueBills[0].id, 's1');
  assert.equal(splitDue.dueBills[0].dueDate, '2026-10-29');
});

test('computeNetWorthSeries and compileOnePageFinancialStatement reconstruct history and statement', () => {
  const sample = {
    wallets: [{ id: 'w1', openingBalance: 10000000 }],
    assets: [{ name: 'Emas', type: 'Emas', value: 5000000 }],
    transactions: [
      { tanggal: '2026-10-05', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 10000000 },
      { tanggal: '2026-10-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 3000000 },
      { tanggal: '2026-11-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 10000000 },
      { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 4000000 },
      { tanggal: '2026-12-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 9000000 }
    ]
  };

  // Viewing 2026-10 must exclude 2026-11 and 2026-12 transactions from historical net worth
  const pastSeries = computeNetWorthSeries(sample, '2026-10', 1, 2);
  assert.equal(pastSeries[1].period, '2026-10');
  assert.equal(pastSeries[1].estimatedNetWorth, 10000000 + 7000000 + 5000000);

  const series = computeNetWorthSeries(sample, '2026-11', 1, 2);
  assert.equal(series.length, 2);
  assert.equal(series[1].period, '2026-11');
  assert.equal(series[1].netCashflow, 6000000);

  const stmt = compileOnePageFinancialStatement(sample, '2026-11', 1);
  assert.equal(stmt.period, '2026-11');
  assert.equal(stmt.incomeTotal, 10000000);
  assert.equal(stmt.expenseTotal, 4000000);
  assert.equal(stmt.netCashflow, 6000000);
  assert.equal(stmt.topExpenses[0].category, 'Makan');
  assert.equal(stmt.topExpenses[0].amount, 4000000);
  assert.equal(typeof stmt.ratios.savingsRatePct, 'number');
});

test('computeCycleForecast estimates burn rate, safe daily allowance, and end-of-cycle status', () => {
  const budgets = [{ bulan: '2026-11', kategori: 'Makan', jumlah: 3000000 }];
  const txs = [
    { tanggal: '2026-11-01', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 600000 },
    { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Transport', nominal: 400000 },
    { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'UtangPerson - Andi', nominal: 900000 }
  ];

  // Mid-cycle on 2026-11-15 (15 elapsed of 30 days): burn 66.667/day -> projected 2.000.000 (< 85% -> safe)
  const safeForecast = computeCycleForecast(txs, budgets, '2026-11', 1, '2026-11-15');
  assert.equal(safeForecast.totalDays, 30);
  assert.equal(safeForecast.elapsedDays, 15);
  assert.equal(safeForecast.remainingDays, 15);
  assert.equal(safeForecast.actualExpense, 1000000);
  assert.equal(safeForecast.projectedExpense, 2000010);
  assert.equal(safeForecast.status, 'safe');

  // Mid-cycle on 2026-11-10 (10 elapsed of 30 days): burn 100k/day -> projected 3.000.000 (warning)
  const warnForecast = computeCycleForecast(txs, budgets, '2026-11', 1, '2026-11-10');
  assert.equal(warnForecast.dailyBurnRate, 100000);
  assert.equal(warnForecast.projectedExpense, 3000000);
  assert.equal(warnForecast.dailySafeAllowance, 100000);
  assert.equal(warnForecast.status, 'warning');

  // Early high burn -> over budget projection
  const overForecast = computeCycleForecast(txs, budgets, '2026-11', 1, '2026-11-05');
  assert.equal(overForecast.elapsedDays, 5);
  assert.equal(overForecast.dailyBurnRate, 200000);
  assert.equal(overForecast.projectedExpense, 6000000);
  assert.equal(overForecast.status, 'over');

  // Completed cycle with custom payrollDay = 28 (2026-10-28 .. 2026-11-27)
  const doneForecast = computeCycleForecast(txs, budgets, '2026-11', 28, '2026-12-01');
  assert.equal(doneForecast.status, 'completed');
  assert.equal(doneForecast.remainingDays, 0);
  assert.equal(doneForecast.projectedExpense, 1000000);
});

test('prepareBackupRestorePayload supports 8 collections additively and removes goal emoji', () => {
  const plan = prepareBackupRestorePayload(
    {
      categories: { pemasukan: ['Gaji', 'Dividen'], pengeluaran: ['Makan', 'Internet'] },
      wallets: [
        { id: 'old-bca', name: 'BCA Utama', kind: 'bank', openingBalance: 1000000 },
        { id: 'old-ovo', name: 'OVO', kind: 'ewallet', openingBalance: 250000 }
      ],
      transactions: [
        { tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Internet', nominal: 350000, keterangan: 'Fiber', walletId: 'old-ovo' }
      ],
      recurring: [
        { tipe: 'Pengeluaran', kategori: 'Internet', nominal: 350000, dayOfMonth: 10, keterangan: 'Fiber', active: true },
        { tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 200000, dayOfMonth: 5, keterangan: 'PLN', active: true }
      ],
      assets: [
        { name: 'Bitcoin', type: 'Crypto', symbol: 'btc', quantity: 0.01, buyPrice: 1200000000, value: 15000000 },
        { name: 'Antam', type: 'Emas', symbol: 'XAU', quantity: 5, buyPrice: 1400000, value: 7500000 }
      ],
      debtDueDates: {
        'UtangPerson - Budi': '2026-12-01',
        'UtangPerson - Ani': '2026-12-15',
        InvalidDate: 'not-a-date'
      }
    },
    {
      categories: { pemasukan: ['Gaji'], pengeluaran: ['makan'] },
      wallets: [{ id: 'new-bca', name: 'bca utama' }],
      transactions: [],
      recurring: [{ tipe: 'Pengeluaran', kategori: 'internet', nominal: 350000, dayOfMonth: 10, keterangan: 'fiber' }],
      assets: [{ name: 'bitcoin', type: 'Crypto', symbol: 'BTC' }],
      debtDueDates: { 'UtangPerson - Budi': '2026-11-30' }
    }
  );

  assert.equal(plan.valid, true);
  assert.deepEqual(plan.newCategories, [
    { tipe: 'Pemasukan', name: 'Dividen' },
    { tipe: 'Pengeluaran', name: 'Internet' }
  ]);
  assert.equal(plan.skippedCategories, 2);
  assert.deepEqual(plan.newWallets, [{ name: 'OVO', kind: 'ewallet', openingBalance: 250000 }]);
  assert.equal(plan.skippedWallets, 1);
  assert.equal(plan.walletNameByOldId['old-ovo'], 'OVO');
  assert.equal(plan.newRecurring.length, 1);
  assert.equal(plan.newRecurring[0].kategori, 'Listrik');
  assert.equal(plan.newAssets.length, 1);
  assert.equal(plan.newAssets[0].symbol, 'XAU');
  assert.deepEqual(plan.newDebtDueDates, { 'UtangPerson - Ani': '2026-12-15' });
  assert.equal(plan.skippedDebtDueDates, 2);

  const partialOnlyWallets = prepareBackupRestorePayload({ wallets: [{ name: 'Dana Baru', kind: 'ewallet' }] }, {});
  assert.equal(partialOnlyWallets.valid, true);
  assert.equal(partialOnlyWallets.newWallets.length, 1);

  const goalDone = projectGoalMilestone(1000000, 1000000);
  assert.equal(goalDone.status, 'completed');
  assert.equal(goalDone.label, 'Target sudah tercapai!');
});
