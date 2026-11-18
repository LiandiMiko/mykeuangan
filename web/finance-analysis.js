(function (root) {
  'use strict';

  function parsePeriod(period) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
    if (!match) throw new Error('Periode harus berformat YYYY-MM.');
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) throw new Error('Bulan periode tidak valid.');
    return { year, month };
  }

  function formatDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function shiftPeriod(period, amount) {
    const parts = parsePeriod(period);
    const shifted = new Date(parts.year, parts.month - 1 + Number(amount || 0), 1);
    return shifted.getFullYear() + '-' + String(shifted.getMonth() + 1).padStart(2, '0');
  }

  function getPeriodRange(period, payrollDay) {
    const parts = parsePeriod(period);
    const payDay = Number(payrollDay) || 1;
    if (payDay <= 1) {
      return {
        start: formatDate(new Date(parts.year, parts.month - 1, 1)),
        end: formatDate(new Date(parts.year, parts.month, 0))
      };
    }

    return {
      start: formatDate(new Date(parts.year, parts.month - 2, payDay)),
      end: formatDate(new Date(parts.year, parts.month - 1, payDay - 1))
    };
  }

  function isInPeriod(tanggal, period, payrollDay) {
    const date = String(tanggal || '').slice(0, 10);
    const range = getPeriodRange(period, payrollDay);
    return date >= range.start && date <= range.end;
  }

  function summarizePeriod(budgets, transactions, period, payrollDay) {
    const monthlyBudgets = (budgets || []).filter((budget) =>
      String(budget.bulan || '').slice(0, 7) === period
    );
    const actualByCategory = new Map();
    let actualTotal = 0;

    (transactions || []).forEach((transaction) => {
      const category = String(transaction.kategori || '');
      if (transaction.tipe !== 'Pengeluaran' ||
          category.startsWith('Utang') ||
          category.startsWith('Piutang') ||
          !isInPeriod(transaction.tanggal, period, payrollDay)) {
        return;
      }

      const amount = Number(transaction.nominal) || 0;
      actualByCategory.set(category, (actualByCategory.get(category) || 0) + amount);
      actualTotal += amount;
    });

    const planByCategory = new Map();
    monthlyBudgets.forEach((budget) => {
      const category = String(budget.kategori || '');
      planByCategory.set(category, (planByCategory.get(category) || 0) + (Number(budget.jumlah) || 0));
    });

    const budgetTotal = Array.from(planByCategory.values()).reduce((sum, amount) => sum + amount, 0);
    const categories = new Set([...planByCategory.keys(), ...actualByCategory.keys()]);
    const rows = Array.from(categories)
      .sort((left, right) => left.localeCompare(right))
      .map((category) => {
        const plan = planByCategory.get(category) || 0;
        const actual = actualByCategory.get(category) || 0;
        return {
          category,
          plan,
          actual,
          remaining: plan - actual,
          percent: plan > 0 ? actual / plan * 100 : null
        };
      });

    return {
      period,
      budgetTotal,
      actualTotal,
      remaining: budgetTotal - actualTotal,
      rows
    };
  }

  function monthlyTrend(budgets, transactions, endPeriod, payrollDay, count) {
    const total = Math.max(1, Math.min(24, Math.trunc(Number(count) || 6)));
    parsePeriod(endPeriod);
    return Array.from({ length: total }, (_, index) => {
      const period = shiftPeriod(endPeriod, index - total + 1);
      return summarizePeriod(budgets, transactions, period, payrollDay);
    });
  }

  function periodInsights(budgets, transactions, period, payrollDay) {
    const current = summarizePeriod(budgets, transactions, period, payrollDay);
    const previousPeriod = shiftPeriod(period, -1);
    const previous = summarizePeriod(budgets, transactions, previousPeriod, payrollDay);
    const highestSpending = current.rows
      .filter((row) => row.actual > 0)
      .sort((left, right) => right.actual - left.actual || left.category.localeCompare(right.category))[0] || null;

    return {
      period: current,
      previousPeriod: previous,
      spendingChange: current.actualTotal - previous.actualTotal,
      spendingChangePercent: previous.actualTotal > 0
        ? (current.actualTotal - previous.actualTotal) / previous.actualTotal * 100
        : null,
      highestSpending,
      overBudget: current.rows
        .filter((row) => row.plan > 0 && row.actual > row.plan)
        .sort((left, right) => (right.actual - right.plan) - (left.actual - left.plan))
    };
  }

  function goalProgress(currentAmount, targetAmount) {
    const current = Math.max(0, Number(currentAmount) || 0);
    const target = Number(targetAmount);
    if (!Number.isFinite(target) || target <= 0) return 0;
    return Math.min(100, current / target * 100);
  }

  function isDebtCategory(category) {
    const value = String(category || '');
    return value.startsWith('Utang') || value.startsWith('Piutang');
  }

  function buildAiCashflowPayload(data, period, payrollDay) {
    const src = data && typeof data === 'object' ? data : {};
    const transactions = Array.isArray(src.transactions) ? src.transactions : [];
    const wallets = Array.isArray(src.wallets) ? src.wallets : [];
    const transfers = Array.isArray(src.transfers) ? src.transfers : [];
    const assets = Array.isArray(src.assets) ? src.assets : [];
    const budgets = Array.isArray(src.budgets) ? src.budgets : [];
    const goals = Array.isArray(src.goals) ? src.goals : [];
    const recurring = Array.isArray(src.recurring) ? src.recurring : [];

    const range = getPeriodRange(period, payrollDay);
    const previousPeriod = shiftPeriod(period, -1);
    const insights = periodInsights(budgets, transactions, period, payrollDay);

    let incomeTotal = 0;
    let expenseTotal = 0;
    const incomeByCat = new Map();
    const expenseByCat = new Map();

    let saldoKasFallback = 0;
    let utangTotal = 0;
    let piutangTotal = 0;
    const walletBal = new Map();
    wallets.forEach((w) => { walletBal.set(w.id, Number(w.openingBalance) || 0); });
    const defaultWalletId = wallets.length ? wallets[0].id : null;

    transactions.forEach((t) => {
      const cat = String(t.kategori || '');
      const amount = Number(t.nominal) || 0;
      const isPiutang = cat.startsWith('Piutang');
      const isUtang = !isPiutang && cat.startsWith('Utang');

      let cashDelta = 0;
      if (isPiutang) {
        if (t.tipe === 'Pengeluaran') {
          piutangTotal += amount;
          cashDelta = -amount;
        } else {
          piutangTotal -= amount;
          cashDelta = amount;
        }
      } else if (isUtang) {
        if (t.tipe === 'Pemasukan') {
          utangTotal += amount;
        } else {
          utangTotal -= amount;
          cashDelta = -amount;
        }
      } else {
        cashDelta = t.tipe === 'Pemasukan' ? amount : -amount;
      }
      saldoKasFallback += cashDelta;

      if (defaultWalletId !== null) {
        const wid = t.walletId && walletBal.has(t.walletId) ? t.walletId : defaultWalletId;
        walletBal.set(wid, (walletBal.get(wid) || 0) + cashDelta);
      }

      if (!isDebtCategory(cat) && isInPeriod(t.tanggal, period, payrollDay)) {
        if (t.tipe === 'Pemasukan') {
          incomeTotal += amount;
          incomeByCat.set(cat, (incomeByCat.get(cat) || 0) + amount);
        } else if (t.tipe === 'Pengeluaran') {
          expenseTotal += amount;
          expenseByCat.set(cat, (expenseByCat.get(cat) || 0) + amount);
        }
      }
    });

    transfers.forEach((x) => {
      const n = Number(x.nominal) || 0;
      const f = Number(x.fee) || 0;
      if (x.fromWallet && walletBal.has(x.fromWallet)) {
        walletBal.set(x.fromWallet, walletBal.get(x.fromWallet) - (n + f));
      }
      if (x.toWallet && walletBal.has(x.toWallet)) {
        walletBal.set(x.toWallet, walletBal.get(x.toWallet) + n);
      }
    });

    const walletsTotal = wallets.length
      ? Array.from(walletBal.values()).reduce((sum, val) => sum + val, 0)
      : saldoKasFallback;
    const assetsTotal = assets.reduce((sum, a) => sum + (Number(a.value) || 0), 0);
    const netWorth = walletsTotal + assetsTotal + piutangTotal - utangTotal;
    const netCashflow = incomeTotal - expenseTotal;
    const savingsRate = incomeTotal > 0 ? Number(((netCashflow / incomeTotal) * 100).toFixed(1)) : 0;

    const topExpenses = Array.from(expenseByCat.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([category, amount]) => ({
        category,
        amount,
        sharePct: expenseTotal > 0 ? Number(((amount / expenseTotal) * 100).toFixed(1)) : 0
      }));

    const topIncomes = Array.from(incomeByCat.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([category, amount]) => ({ category, amount }));

    const activeGoals = goals.filter((g) => Number(g.targetAmount) > 0);
    const totalTarget = activeGoals.reduce((sum, g) => sum + (Number(g.targetAmount) || 0), 0);
    const totalSaved = activeGoals.reduce((sum, g) => sum + (Number(g.currentAmount) || 0), 0);

    const activeRecurring = recurring.filter((r) => String(r.active) !== 'false' && r.active !== false);
    const recIncome = activeRecurring
      .filter((r) => r.tipe === 'Pemasukan')
      .reduce((sum, r) => sum + (Number(r.nominal) || 0), 0);
    const recExpense = activeRecurring
      .filter((r) => r.tipe === 'Pengeluaran')
      .reduce((sum, r) => sum + (Number(r.nominal) || 0), 0);

    return {
      period,
      range,
      previousPeriod,
      incomeTotal,
      expenseTotal,
      netCashflow,
      savingsRate,
      topExpenses,
      topIncomes,
      budgetSummary: {
        budgetTotal: insights.period.budgetTotal,
        actualTotal: insights.period.actualTotal,
        remaining: insights.period.remaining,
        overBudget: insights.overBudget.map((r) => ({
          category: r.category,
          plan: r.plan,
          actual: r.actual,
          overAmount: r.actual - r.plan
        }))
      },
      spendingChange: insights.spendingChange,
      spendingChangePercent: insights.spendingChangePercent !== null
        ? Number(insights.spendingChangePercent.toFixed(1))
        : null,
      walletsTotal,
      assetsTotal,
      utangTotal,
      piutangTotal,
      netWorth,
      goalsSummary: {
        count: activeGoals.length,
        totalTarget,
        totalSaved,
        completionPct: totalTarget > 0 ? Number(Math.min(100, (totalSaved / totalTarget) * 100).toFixed(1)) : 0
      },
      recurringSummary: {
        activeCount: activeRecurring.length,
        monthlyIncome: recIncome,
        monthlyExpense: recExpense
      }
    };
  }

  function buildGeminiCashflowPrompt(payload, lang) {
    const isEn = lang === 'en';
    const dataJson = JSON.stringify(payload);
    if (isEn) {
      return [
        'You are a personal finance advisor analyzing a user cashflow summary (in IDR).',
        'Return ONLY a valid JSON object with exact keys:',
        '- "healthScore": integer 0..100 representing financial health for this cycle',
        '- "statusLabel": short label (e.g. "Healthy", "Need Attention", "Deficit")',
        '- "ringkasan": 2-3 concise sentences summarizing income, expenses, savings rate, and net cashflow',
        '- "sorotan": array of 2-4 concise insight bullet strings with exact IDR numbers from the data',
        '- "bocorAnggaran": array of strings highlighting over-budget or high-spending categories (or empty array if safe)',
        '- "rekomendasi": array of 3 actionable, realistic steps for the next cycle',
        'Do not invent numbers not present in the payload.',
        'DATA:',
        dataJson
      ].join('\n');
    }
    return [
      'Kamu adalah penasihat keuangan pribadi yang menganalisis ringkasan arus kas pengguna (dalam Rupiah/IDR).',
      'Kembalikan HANYA objek JSON yang valid dengan key persis berikut:',
      '- "healthScore": bilangan bulat 0..100 yang menilai kesehatan arus kas periode ini',
      '- "statusLabel": label singkat (contoh: "Sehat", "Waspada", "Defisit")',
      '- "ringkasan": 2-3 kalimat ringkas membahas pemasukan, pengeluaran, rasio tabungan (savings rate), dan surplus/defisit',
      '- "sorotan": array berisi 2-4 poin sorotan utama dengan angka IDR spesifik dari data',
      '- "bocorAnggaran": array berisi peringatan kategori yang melewati budget atau porsi pengeluaran terlalu besar (array kosong jika aman)',
      '- "rekomendasi": array berisi 3 langkah aksi konkret dan realistis untuk siklus berikutnya',
      'Jangan mengarang angka di luar data payload.',
      'DATA:',
      dataJson
    ].join('\n');
  }

  function parseGeminiCashflowResponse(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      return {
        healthScore: null,
        statusLabel: '',
        ringkasan: '',
        sorotan: [],
        bocorAnggaran: [],
        rekomendasi: []
      };
    }

    let cleaned = text;
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    else {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
    }

    const toStringList = (val) => (Array.isArray(val) ? val.map((x) => String(x || '').trim()).filter(Boolean) : []);

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const rawScore = Number(parsed.healthScore);
        const healthScore = Number.isFinite(rawScore)
          ? Math.max(0, Math.min(100, Math.round(rawScore)))
          : null;
        return {
          healthScore,
          statusLabel: String(parsed.statusLabel || '').trim(),
          ringkasan: String(parsed.ringkasan || '').trim(),
          sorotan: toStringList(parsed.sorotan),
          bocorAnggaran: toStringList(parsed.bocorAnggaran),
          rekomendasi: toStringList(parsed.rekomendasi)
        };
      }
    } catch (_) {
      // Fallback to raw text summary
    }

    return {
      healthScore: null,
      statusLabel: '',
      ringkasan: text,
      sorotan: [],
      bocorAnggaran: [],
      rekomendasi: []
    };
  }

  const api = {
    getPeriodRange, isInPeriod, shiftPeriod, summarizePeriod, monthlyTrend,
    periodInsights, goalProgress, buildAiCashflowPayload,
    buildGeminiCashflowPrompt, parseGeminiCashflowResponse
  };
  root.FinanceAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
