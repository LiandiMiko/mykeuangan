(function (root) {
  'use strict';

  const core = (typeof module !== 'undefined' && module.exports)
    ? require('./finance-analysis-core.js')
    : root.FinanceAnalysisCore;

  function computeFinancialHealthRatios(data, period, payrollDay) {
    const src = data && typeof data === 'object' ? data : {};
    const payload = core.buildAiCashflowPayload(src, period, payrollDay);
    const assets = Array.isArray(src.assets) ? src.assets : [];
    const cashAssetsTotal = assets
      .filter((a) => String(a.type || '').toLowerCase() === 'cash')
      .reduce((sum, a) => sum + (Number(a.value) || 0), 0);
    const liquidCash = Math.max(0, payload.walletsTotal) + Math.max(0, cashAssetsTotal);

    const series = core.monthlyCashflowSeries(src.transactions, period, payrollDay, 3);
    const nonZeroExpenses = series.map((s) => s.expenseTotal).filter((v) => v > 0);
    const avgMonthlyExpense = nonZeroExpenses.length
      ? nonZeroExpenses.reduce((sum, v) => sum + v, 0) / nonZeroExpenses.length
      : payload.expenseTotal;

    const emergencyRunwayMonths = avgMonthlyExpense > 0
      ? Number((liquidCash / avgMonthlyExpense).toFixed(1))
      : null;
    const runwayStatus = emergencyRunwayMonths === null
      ? 'info'
      : emergencyRunwayMonths >= 6 ? 'excellent' : emergencyRunwayMonths >= 3 ? 'good' : 'warning';

    const savingsRatePct = payload.savingsRate;
    const savingsStatus = payload.incomeTotal <= 0
      ? 'info'
      : savingsRatePct >= 20 ? 'excellent' : savingsRatePct >= 10 ? 'good' : 'warning';

    const grossAssets = Math.max(0, payload.walletsTotal) + Math.max(0, payload.assetsTotal) + Math.max(0, payload.piutangTotal);
    const debtToAssetPct = grossAssets > 0
      ? Number(((payload.utangTotal / grossAssets) * 100).toFixed(1))
      : (payload.utangTotal > 0 ? 100 : 0);
    const debtStatus = debtToAssetPct === 0 ? 'excellent' : debtToAssetPct <= 30 ? 'good' : 'danger';

    return {
      liquidCash,
      avgMonthlyExpense: Math.round(avgMonthlyExpense),
      emergencyRunwayMonths,
      runwayStatus,
      savingsRatePct,
      savingsStatus,
      grossAssets,
      utangTotal: payload.utangTotal,
      debtToAssetPct,
      debtStatus
    };
  }

  function recommendCategoryBudgets(transactions, endPeriod, payrollDay, cycleCount) {
    const count = Math.max(1, Math.min(6, Math.trunc(Number(cycleCount) || 3)));
    core.parsePeriod(endPeriod);
    const list = Array.isArray(transactions) ? transactions : [];
    const perCategoryTotals = new Map();

    for (let i = 0; i < count; i += 1) {
      const period = core.shiftPeriod(endPeriod, -i);
      const summary = core.summarizePeriod([], list, period, payrollDay);
      summary.rows.forEach((row) => {
        if (row.actual <= 0) return;
        const entry = perCategoryTotals.get(row.category) || { sum: 0, cycles: 0 };
        entry.sum += row.actual;
        entry.cycles += 1;
        perCategoryTotals.set(row.category, entry);
      });
    }

    return Array.from(perCategoryTotals.entries())
      .map(([category, stats]) => {
        const avg = stats.sum / stats.cycles;
        return {
          category,
          recommendedAmount: Math.max(10000, Math.ceil(avg / 10000) * 10000),
          averageActual: Math.round(avg),
          activeCycles: stats.cycles
        };
      })
      .sort((a, b) => b.recommendedAmount - a.recommendedAmount || a.category.localeCompare(b.category));
  }

  function resolveWalletsLiquidTotal(src) {
    const wallets = Array.isArray(src.wallets) ? src.wallets : [];
    if (!wallets.length) return Math.max(0, Number(src.walletsTotal) || 0);
    if (src.walletBalances && typeof src.walletBalances === 'object') {
      return wallets.reduce((sum, w) => sum + Math.max(0, Number(src.walletBalances[w.id]) || 0), 0);
    }
    const hasDirectBalance = wallets.some((w) => w && w.balance !== undefined && w.balance !== null && Number.isFinite(Number(w.balance)));
    if (hasDirectBalance) {
      return wallets.reduce((sum, w) => sum + Math.max(0, Number(w.balance) || 0), 0);
    }
    const bal = new Map();
    wallets.forEach((w) => { bal.set(w.id, Number(w.openingBalance) || 0); });
    const defId = wallets[0].id;
    (Array.isArray(src.transactions) ? src.transactions : []).forEach((t) => {
      const wid = t.walletId && bal.has(t.walletId) ? t.walletId : defId;
      if (!wid) return;
      const cat = String(t.kategori || '');
      const amount = Number(t.nominal) || 0;
      const isPiutang = cat.startsWith('Piutang');
      const isUtang = !isPiutang && cat.startsWith('Utang');
      const delta = isPiutang
        ? (t.tipe === 'Pengeluaran' ? -amount : amount)
        : isUtang ? (t.tipe === 'Pemasukan' ? 0 : -amount) : (t.tipe === 'Pemasukan' ? amount : -amount);
      bal.set(wid, (bal.get(wid) || 0) + delta);
    });
    (Array.isArray(src.transfers) ? src.transfers : []).forEach((x) => {
      const n = Number(x.nominal) || 0;
      const f = Number(x.fee) || 0;
      if (x.fromWallet && bal.has(x.fromWallet)) bal.set(x.fromWallet, bal.get(x.fromWallet) - (n + f));
      if (x.toWallet && bal.has(x.toWallet)) bal.set(x.toWallet, bal.get(x.toWallet) + n);
    });
    return Array.from(bal.values()).reduce((sum, v) => sum + Math.max(0, v), 0);
  }

  function computeAssetAllocation(data) {
    const src = data && typeof data === 'object' ? data : {};
    const assets = Array.isArray(src.assets) ? src.assets : [];
    const buckets = { cash: resolveWalletsLiquidTotal(src), emas: 0, crypto: 0, usd: 0, other: 0 };

    assets.forEach((a) => {
      if (!a || typeof a !== 'object') return;
      const typeLower = String(a.type || '').trim().toLowerCase();
      const rawVal = Number(a.currentValue) || Number(a.value) || Number(a.amount) ||
        (Number(a.quantity || 0) * Number(a.currentPrice || a.buyPrice || 0));
      const val = Math.max(0, Number.isFinite(rawVal) ? rawVal : 0);
      if (val <= 0) return;
      if (typeLower === 'cash' || typeLower === 'tabungan') buckets.cash += val;
      else if (typeLower === 'emas') buckets.emas += val;
      else if (typeLower === 'crypto') buckets.crypto += val;
      else if (typeLower === 'usd') buckets.usd += val;
      else buckets.other += val;
    });

    const total = buckets.cash + buckets.emas + buckets.crypto + buckets.usd + buckets.other;
    const defs = [
      { key: 'cash', label: 'Kas & Likuid', color: '#10b981' },
      { key: 'emas', label: 'Emas', color: '#f59e0b' },
      { key: 'crypto', label: 'Crypto', color: '#6366f1' },
      { key: 'usd', label: 'Valas USD', color: '#0ea5e9' },
      { key: 'other', label: 'Saham & Lainnya', color: '#ec4899' }
    ];
    const segments = defs.map((d) => {
      const amount = Math.round(buckets[d.key]);
      return {
        key: d.key,
        label: d.label,
        amount,
        sharePct: total > 0 ? Number(((amount / total) * 100).toFixed(1)) : 0,
        color: d.color
      };
    });
    return {
      total: Math.round(total),
      diversificationScore: segments.filter((s) => s.sharePct >= 5).length,
      segments
    };
  }

  function detectSpendingAnomalies(transactions, recurring, period, payrollDay) {
    core.parsePeriod(period);
    const list = Array.isArray(transactions) ? transactions : [];
    const recList = Array.isArray(recurring) ? recurring : [];
    let incomeTotal = 0;
    let expenseTotal = 0;
    const expenseRows = [];

    list.forEach((tx) => {
      if (!tx || core.isDebtCategory(tx.kategori) || !core.isInPeriod(tx.tanggal, period, payrollDay)) return;
      const amount = Number(tx.nominal) || 0;
      if (amount <= 0) return;
      if (tx.tipe === 'Pemasukan') incomeTotal += amount;
      else if (tx.tipe === 'Pengeluaran') {
        expenseTotal += amount;
        expenseRows.push(tx);
      }
    });

    const avgExpenseTx = expenseRows.length > 0 ? expenseTotal / expenseRows.length : 0;
    const threshold = Math.max(250000, avgExpenseTx * 2.5);
    const anomalies = expenseRows
      .filter((tx) => (Number(tx.nominal) || 0) >= threshold)
      .sort((a, b) => (Number(b.nominal) || 0) - (Number(a.nominal) || 0))
      .slice(0, 3)
      .map((tx) => ({
        id: tx.id || '',
        tanggal: String(tx.tanggal || '').slice(0, 10),
        kategori: String(tx.kategori || ''),
        keterangan: String(tx.keterangan || ''),
        nominal: Number(tx.nominal) || 0,
        multipleOfAvg: avgExpenseTx > 0 ? Number(((Number(tx.nominal) || 0) / avgExpenseTx).toFixed(1)) : 1
      }));

    const fixedExpenseTotal = recList
      .filter((r) => r && String(r.active) !== 'false' && r.active !== false && r.tipe === 'Pengeluaran')
      .reduce((sum, r) => sum + Math.max(0, Number(r.nominal) || 0), 0);
    const denominator = incomeTotal > 0 ? incomeTotal : expenseTotal;
    return {
      expenseCount: expenseRows.length,
      avgExpenseTx: Math.round(avgExpenseTx),
      incomeTotal,
      expenseTotal,
      anomalies,
      fixedExpenseTotal,
      fixedCostRatioPct: denominator > 0 ? Number(((fixedExpenseTotal / denominator) * 100).toFixed(1)) : 0,
      fixedCostBasis: incomeTotal > 0 ? 'income' : (expenseTotal > 0 ? 'expense' : 'none')
    };
  }

  function computeNetWorthSeries(data, currentPeriod, payrollDay, count = 6) {
    const numCycles = Math.max(2, Math.min(12, Math.trunc(Number(count) || 6)));
    core.parsePeriod(currentPeriod);
    const src = data && typeof data === 'object' ? data : {};
    const endRange = core.getPeriodRange(currentPeriod, payrollDay);
    const scopedTransactions = (Array.isArray(src.transactions) ? src.transactions : []).filter((t) =>
      t && String(t.tanggal || '').slice(0, 10) <= endRange.end
    );
    const scopedTransfers = (Array.isArray(src.transfers) ? src.transfers : []).filter((x) =>
      x && (!x.tanggal || String(x.tanggal).slice(0, 10) <= endRange.end)
    );
    const flowSeries = core.monthlyCashflowSeries(scopedTransactions, currentPeriod, payrollDay, numCycles);
    const curPayload = core.buildAiCashflowPayload(
      { ...src, transactions: scopedTransactions, transfers: scopedTransfers },
      currentPeriod,
      payrollDay
    );
    const points = Array.from({ length: flowSeries.length });
    let runningNetWorth = curPayload.netWorth;

    for (let i = flowSeries.length - 1; i >= 0; i--) {
      points[i] = {
        period: flowSeries[i].period,
        netCashflow: flowSeries[i].netCashflow,
        incomeTotal: flowSeries[i].incomeTotal,
        expenseTotal: flowSeries[i].expenseTotal,
        estimatedNetWorth: Math.round(runningNetWorth)
      };
      if (i > 0) runningNetWorth -= flowSeries[i].netCashflow;
    }
    return points;
  }

  function compileOnePageFinancialStatement(data, period, payrollDay) {
    core.parsePeriod(period);
    const src = data && typeof data === 'object' ? data : {};
    const payload = core.buildAiCashflowPayload(src, period, payrollDay);
    const ratios = computeFinancialHealthRatios(src, period, payrollDay);
    const allocation = computeAssetAllocation(src);
    const anomalies = detectSpendingAnomalies(src.transactions, src.recurring, period, payrollDay);

    return {
      period,
      range: core.getPeriodRange(period, payrollDay),
      generatedAt: new Date().toISOString(),
      netWorth: payload.netWorth,
      walletsTotal: payload.walletsTotal,
      assetsTotal: payload.assetsTotal,
      piutangTotal: payload.piutangTotal,
      utangTotal: payload.utangTotal,
      incomeTotal: payload.incomeTotal,
      expenseTotal: payload.expenseTotal,
      netCashflow: payload.netCashflow,
      savingsRate: payload.savingsRate,
      topExpenses: payload.topExpenses,
      budgetSummary: payload.budgetSummary,
      ratios: {
        emergencyRunwayMonths: ratios.emergencyRunwayMonths,
        runwayStatus: ratios.runwayStatus,
        savingsRatePct: ratios.savingsRatePct,
        debtToAssetPct: ratios.debtToAssetPct,
        debtStatus: ratios.debtStatus
      },
      portfolioAllocation: allocation.segments,
      fixedCostRatioPct: anomalies.fixedCostRatioPct,
      spendingSpikesCount: anomalies.anomalies.length
    };
  }

  const portfolioApi = {
    computeFinancialHealthRatios, recommendCategoryBudgets,
    computeAssetAllocation, detectSpendingAnomalies,
    computeNetWorthSeries, compileOnePageFinancialStatement
  };
  root.FinanceAnalysisPortfolio = portfolioApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = portfolioApi;
})(typeof window !== 'undefined' ? window : globalThis);
