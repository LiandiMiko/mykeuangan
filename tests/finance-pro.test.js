const test = require('node:test');
const assert = require('node:assert/strict');

const FinanceAnalysis = require('../web/finance-analysis.js');
const FinancePro = require('../web/finance-pro.js');
const TransactionImport = require('../web/transaction-import.js');

test('extractTags and summarizeTags extract unique tags and aggregate totals per period', () => {
  assert.deepEqual(FinancePro.extractTags('Hotel #Liburan-Bali dan makan #liburan-bali #kantor'), ['#liburan-bali', '#kantor']);

  const txs = [
    { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Hiburan', nominal: 500000, keterangan: 'Tiket #liburan' },
    { tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 150000, keterangan: 'Dinner #liburan #kantor' },
    { tanggal: '2026-11-12', tipe: 'Pemasukan', kategori: 'Lainnya', nominal: 100000, keterangan: 'Reimburse #kantor' },
    { tanggal: '2026-10-02', tipe: 'Pengeluaran', kategori: 'Hiburan', nominal: 900000, keterangan: 'Lama #liburan' }
  ];

  const summary = FinancePro.summarizeTags(txs, '2026-11', 1, FinanceAnalysis);
  assert.equal(summary.length, 2);
  assert.equal(summary[0].tag, '#liburan');
  assert.equal(summary[0].count, 2);
  assert.equal(summary[0].expense, 650000);
  const kantor = summary.find((s) => s.tag === '#kantor');
  assert.equal(kantor.income, 100000);
  assert.equal(kantor.expense, 150000);
  assert.equal(kantor.net, -50000);
});

test('parseQuickTxInput resolves amounts, wallets, categories, tags, and custom auto-rules', () => {
  const categories = {
    pemasukan: ['Gaji', 'Bonus', 'Lainnya'],
    pengeluaran: ['Makanan', 'Tagihan', 'Transportasi', 'Lainnya']
  };
  const wallets = [
    { id: 'w-bca', name: 'BCA (m-banking)' },
    { id: 'w-cash', name: 'Cash' }
  ];
  const customRules = [{ keyword: 'token listrik', category: 'Tagihan', tipe: 'Pengeluaran' }];

  const q1 = FinancePro.parseQuickTxInput('kopi 25rb bca #kantor', categories, wallets, customRules, '2026-11-20');
  assert.equal(q1.valid, true);
  assert.equal(q1.tipe, 'Pengeluaran');
  assert.equal(q1.nominal, 25000);
  assert.equal(q1.kategori, 'Makanan');
  assert.equal(q1.walletId, 'w-bca');
  assert.deepEqual(q1.tags, ['#kantor']);

  const q2 = FinancePro.parseQuickTxInput('+8.5jt gaji', categories, wallets, customRules, '2026-11-20');
  assert.equal(q2.valid, true);
  assert.equal(q2.tipe, 'Pemasukan');
  assert.equal(q2.nominal, 8500000);
  assert.equal(q2.kategori, 'Gaji');

  const q3 = FinancePro.parseQuickTxInput('isi token listrik 100k', categories, wallets, customRules, '2026-11-20');
  assert.equal(q3.valid, true);
  assert.equal(q3.kategori, 'Tagihan');
  assert.equal(q3.nominal, 100000);
});

test('buildFrequentTemplates mines top repeated non-debt entries', () => {
  const txs = [
    { tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 25000, keterangan: 'Kopi', walletId: 'w1' },
    { tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 25000, keterangan: 'Kopi', walletId: 'w1' },
    { tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 25000, keterangan: 'Kopi', walletId: 'w1' },
    { tipe: 'Pemasukan', kategori: 'UtangPerson - Budi', nominal: 100000, keterangan: 'Pinjam', walletId: 'w1' },
    { tipe: 'Pengeluaran', kategori: 'Transportasi', nominal: 50000, keterangan: 'Bensin', walletId: 'w1' }
  ];
  const templates = FinancePro.buildFrequentTemplates(txs, 5);
  assert.equal(templates.length, 2);
  assert.equal(templates[0].label, 'Makanan: Kopi');
  assert.equal(templates[0].count, 3);
});

test('computeAnnualRecap and compareTwoPeriods summarize cycles accurately', () => {
  const txs = [
    { tanggal: '2026-01-10', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 5000000, keterangan: '' },
    { tanggal: '2026-01-15', tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 1200000, keterangan: '' },
    { tanggal: '2026-02-10', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 5000000, keterangan: '' },
    { tanggal: '2026-02-12', tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 2000000, keterangan: '' }
  ];
  const recap = FinancePro.computeAnnualRecap(txs, [], '2026', 1, FinanceAnalysis);
  assert.equal(recap.totalIncome, 10000000);
  assert.equal(recap.totalExpense, 3200000);
  assert.equal(recap.netSavings, 6800000);
  assert.equal(recap.bestSavingMonth.period, '2026-01');
  assert.equal(recap.highestExpenseMonth.period, '2026-02');

  const cmp = FinancePro.compareTwoPeriods(txs, [], '2026-01', '2026-02', 1, FinanceAnalysis);
  assert.equal(cmp.expenseA, 1200000);
  assert.equal(cmp.expenseB, 2000000);
  assert.equal(cmp.categories[0].delta, 800000);
});

test('financial simulators and portfolio rebalance produce finite structured projections', () => {
  const debts = [
    { name: 'Kartu A', balance: 3000000, annualRatePct: 24, minPayment: 300000 },
    { name: 'Cicilan B', balance: 6000000, annualRatePct: 10, minPayment: 500000 }
  ];
  const snow = FinancePro.simulateDebtPayoff(debts, 500000, 'snowball');
  const aval = FinancePro.simulateDebtPayoff(debts, 500000, 'avalanche');
  assert.ok(snow.months > 0 && snow.months < 20);
  assert.equal(aval.payoffOrder.length, 2);

  const comp = FinancePro.simulateCompoundGrowth(1000000, 500000, 12, 3);
  assert.equal(comp.totalContributed, 19000000);
  assert.ok(comp.finalValue > comp.totalContributed);

  const inst = FinancePro.simulateInstallmentVsCash(10000000, 1000000, 900000, 12);
  assert.equal(inst.totalInstallment, 11800000);
  assert.equal(inst.extraCost, 1800000);

  const reb = FinancePro.computePortfolioRebalance(
    [
      { label: 'Kas / Dompet', color: '#3b82f6', amount: 8000000 },
      { label: 'Emas', color: '#eab308', amount: 2000000 }
    ],
    { 'Kas / Dompet': 50, Emas: 50 }
  );
  assert.equal(reb.total, 10000000);
  assert.equal(reb.rows[0].action, 'Kurangi');
  assert.equal(reb.rows[1].action, 'Tambah');
});

test('TransactionImport applies custom autoCategoryRules on empty bank mutation rows', () => {
  const csv = [
    'Tanggal,Uraian,Debit,Kredit',
    '2026-11-18,QRIS KOPI KENANGAN JAKARTA,35000,',
    '2026-11-19,TOPUP LISTRIK PREPAID PLN,100000,'
  ].join('\n');

  const res = TransactionImport.parseTransactionCsv(csv, [], [{ id: 'w1', name: 'BCA' }], {
    autoCategoryRules: [{ keyword: 'kopi kenangan', category: 'Kopi & Jajan', tipe: 'Pengeluaran' }],
    categories: { pengeluaran: ['Kopi & Jajan', 'Tagihan', 'Lainnya'], pemasukan: ['Gaji', 'Lainnya'] }
  });
  assert.equal(res.valid.length, 2);
  assert.equal(res.valid[0].kategori, 'Kopi & Jajan');
  assert.equal(res.valid[1].kategori, 'Tagihan');
});

test('parseQuickTxInput handles Rp tokens and simulateDebtPayoff reports capped flag', () => {
  const categories = { pemasukan: ['Bonus', 'Lainnya'], pengeluaran: ['Makanan', 'Lainnya'] };
  const qRp = FinancePro.parseQuickTxInput('makan siang Rp 35rb', categories, [], [], '2026-11-23');
  assert.equal(qRp.valid, true);
  assert.equal(qRp.nominal, 35000);

  const qRpPlain = FinancePro.parseQuickTxInput('+Rp 1.500.000 bonus', categories, [], [], '2026-11-23');
  assert.equal(qRpPlain.valid, true);
  assert.equal(qRpPlain.tipe, 'Pemasukan');
  assert.equal(qRpPlain.nominal, 1500000);

  const negAmort = FinancePro.simulateDebtPayoff([
    { name: 'Pinjol Tinggi', balance: 100000000, annualRatePct: 48, minPayment: 500000 }
  ], 0, 'avalanche');
  assert.equal(negAmort.capped, true);
  assert.equal(negAmort.months, 600);

  const normalPay = FinancePro.simulateDebtPayoff([
    { name: 'Cicilan Ringan', balance: 1000000, annualRatePct: 0, minPayment: 500000 }
  ], 0, 'snowball');
  assert.equal(normalPay.capped, false);
  assert.equal(normalPay.months, 2);
});

test('auto-categorization uses word boundaries, prioritizes user categories, and recap merges case variants', () => {
  const categories = {
    pemasukan: ['Gaji', 'Lainnya'],
    pengeluaran: ['Makanan', 'Tagihan', 'Transportasi', 'Laundry', 'Lainnya']
  };
  const wallets = [{ id: 'w1', name: 'Cash' }];

  const laundryTx = FinancePro.parseQuickTxInput('laundry pakaian 25rb', categories, wallets, [], '2026-11-25');
  assert.equal(laundryTx.valid, true);
  assert.equal(laundryTx.kategori, 'Laundry');

  const bottleTx = FinancePro.parseQuickTxInput('cuci botol 20rb', categories, wallets, [], '2026-11-25');
  assert.equal(bottleTx.kategori, 'Lainnya');

  const repairTx = FinancePro.parseQuickTxInput('repair sepatu 50rb', categories, wallets, [], '2026-11-25');
  assert.equal(repairTx.kategori, 'Lainnya');

  const customRuleOverride = FinancePro.parseQuickTxInput(
    'laundry kilat 30rb',
    categories,
    wallets,
    [{ keyword: 'laundry kilat', category: 'Tagihan', tipe: 'Pengeluaran' }],
    '2026-11-25'
  );
  assert.equal(customRuleOverride.kategori, 'Tagihan');

  const crossMonthTxs = [
    { tanggal: '2026-10-12', tipe: 'Pengeluaran', kategori: 'laundry', nominal: 40000 },
    { tanggal: '2026-11-12', tipe: 'Pengeluaran', kategori: 'Laundry', nominal: 90000 }
  ];
  const recap = FinancePro.computeAnnualRecap(crossMonthTxs, [], '2026', 1, FinanceAnalysis);
  assert.equal(recap.topCategories.length, 1);
  assert.equal(recap.topCategories[0].category, 'Laundry');
  assert.equal(recap.topCategories[0].amount, 130000);

  const cmp = FinancePro.compareTwoPeriods(crossMonthTxs, [], '2026-10', '2026-11', 1, FinanceAnalysis);
  assert.equal(cmp.categories.length, 1);
  assert.equal(cmp.categories[0].category, 'Laundry');
  assert.equal(cmp.categories[0].delta, 50000);
});
