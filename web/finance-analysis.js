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

  function calculateGoalMonthlySaving(currentAmount, targetAmount, targetDate, todayStr) {
    const current = Math.max(0, Number(currentAmount) || 0);
    const target = Number(targetAmount);
    const remaining = Number.isFinite(target) && target > 0 ? Math.max(0, target - current) : 0;
    if (remaining <= 0) {
      return { remaining: 0, daysLeft: 0, monthsLeft: 0, monthlySaving: 0, status: 'completed' };
    }

    const cleanDate = String(targetDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      return { remaining, daysLeft: null, monthsLeft: null, monthlySaving: null, status: 'no_date' };
    }
    const targetMs = Date.parse(cleanDate + 'T00:00:00Z');
    if (!Number.isFinite(targetMs)) {
      return { remaining, daysLeft: null, monthsLeft: null, monthlySaving: null, status: 'no_date' };
    }

    const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : formatDate(new Date());
    const todayMs = Date.parse(baseDate + 'T00:00:00Z');
    const daysLeft = Math.ceil((targetMs - todayMs) / 86400000);
    if (daysLeft < 0) {
      return { remaining, daysLeft, monthsLeft: 0, monthlySaving: remaining, status: 'overdue' };
    }
    const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30));
    const monthlySaving = Math.ceil(remaining / monthsLeft);
    return {
      remaining,
      daysLeft,
      monthsLeft,
      monthlySaving,
      status: daysLeft <= 14 ? 'urgent' : 'on_track'
    };
  }

  function monthlyCashflowSeries(transactions, endPeriod, payrollDay, count) {
    const total = Math.max(1, Math.min(24, Math.trunc(Number(count) || 6)));
    parsePeriod(endPeriod);
    const list = Array.isArray(transactions) ? transactions : [];
    return Array.from({ length: total }, (_, index) => {
      const period = shiftPeriod(endPeriod, index - total + 1);
      let incomeTotal = 0;
      let expenseTotal = 0;
      list.forEach((transaction) => {
        if (isDebtCategory(transaction.kategori) || !isInPeriod(transaction.tanggal, period, payrollDay)) {
          return;
        }
        const amount = Number(transaction.nominal) || 0;
        if (transaction.tipe === 'Pemasukan') incomeTotal += amount;
        else if (transaction.tipe === 'Pengeluaran') expenseTotal += amount;
      });
      return {
        period,
        incomeTotal,
        expenseTotal,
        netCashflow: incomeTotal - expenseTotal
      };
    });
  }

  function buildAppNotifications(data, period, payrollDay, todayStr) {
    const src = data && typeof data === 'object' ? data : {};
    const budgets = Array.isArray(src.budgets) ? src.budgets : [];
    const transactions = Array.isArray(src.transactions) ? src.transactions : [];
    const recurring = Array.isArray(src.recurring) ? src.recurring : [];
    const goals = Array.isArray(src.goals) ? src.goals : [];
    const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : formatDate(new Date());
    const notifications = [];

    if (/^\d{4}-\d{2}$/.test(String(period || ''))) {
      const summary = summarizePeriod(budgets, transactions, period, payrollDay);
      summary.rows.forEach((row) => {
        if (row.plan > 0 && row.percent !== null && row.percent >= 80) {
          const isOver = row.percent > 100;
          notifications.push({
            id: 'budget:' + period + ':' + row.category,
            severity: isOver ? 'danger' : 'warning',
            title: isOver ? ('Budget terlampaui: ' + row.category) : ('Budget hampir habis: ' + row.category),
            message: 'Terpakai ' + Math.round(row.percent) + '% (' + row.actual + ' / ' + row.plan + ').',
            actionType: 'view',
            actionPayload: { view: 'budgeting' }
          });
        }
      });
    }

    const baseDateObj = new Date(baseDate + 'T00:00:00Z');
    const year = baseDateObj.getUTCFullYear();
    const month = baseDateObj.getUTCMonth();
    const todayDay = baseDateObj.getUTCDate();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const daysInNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();

    recurring.forEach((item) => {
      if (item.active === false || String(item.active) === 'false') return;
      const rawDay = Math.trunc(Number(item.dayOfMonth ?? item.day_of_month) || 0);
      if (rawDay < 1 || rawDay > 31) return;
      const lastRun = String(item.lastRun ?? item.last_run ?? '').slice(0, 10);
      if (lastRun === baseDate) return;

      const clampedThisMonth = Math.min(rawDay, daysInMonth);
      let diffDays = clampedThisMonth - todayDay;
      if (diffDays < 0) {
        const clampedNextMonth = Math.min(rawDay, daysInNextMonth);
        diffDays = (daysInMonth - todayDay) + clampedNextMonth;
      }

      if (diffDays >= 0 && diffDays <= 3) {
        notifications.push({
          id: 'recurring:' + (item.id || item.kategori + ':' + rawDay),
          severity: diffDays === 0 ? 'warning' : 'info',
          title: 'Jadwal rutin: ' + String(item.kategori || 'Transaksi'),
          message: (diffDays === 0 ? 'Jatuh tempo hari ini' : ('Jatuh tempo ' + diffDays + ' hari lagi')) +
            ' (tgl ' + rawDay + ') · ' + (Number(item.nominal) || 0),
          actionType: 'recurring',
          actionPayload: { id: item.id || null }
        });
      }
    });

    goals.forEach((goal) => {
      const calc = calculateGoalMonthlySaving(goal.currentAmount, goal.targetAmount, goal.targetDate, baseDate);
      if (calc.status === 'overdue' || calc.status === 'urgent') {
        notifications.push({
          id: 'goal:' + (goal.id || goal.name),
          severity: calc.status === 'overdue' ? 'danger' : 'warning',
          title: calc.status === 'overdue'
            ? ('Target melewati tenggat: ' + String(goal.name || 'Target'))
            : ('Target mendekati tenggat: ' + String(goal.name || 'Target')),
          message: 'Sisa ' + calc.remaining + (calc.daysLeft !== null ? ' (' + calc.daysLeft + ' hari)' : '') + '.',
          actionType: 'view',
          actionPayload: { view: 'budgeting' }
        });
      }
    });

    const pendingOffline = Math.max(0, Math.trunc(Number(src.offlineQueueCount) || 0));
    if (pendingOffline > 0) {
      notifications.push({
        id: 'offline:queue',
        severity: 'info',
        title: 'Antrean transaksi offline',
        message: pendingOffline + ' transaksi menunggu sinkronisasi ke Supabase saat online.',
        actionType: 'sync_offline',
        actionPayload: { count: pendingOffline }
      });
    }

    return notifications;
  }

  function stripJsonFences(rawText) {
    let cleaned = String(rawText || '').trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) return fenceMatch[1].trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) return cleaned.slice(start, end + 1);
    return cleaned;
  }

  function buildReceiptOcrPrompt(categories, todayStr, lang) {
    const cats = categories && typeof categories === 'object' ? categories : {};
    const pemasukan = Array.isArray(cats.pemasukan) && cats.pemasukan.length ? cats.pemasukan : ['Gaji', 'Lainnya'];
    const pengeluaran = Array.isArray(cats.pengeluaran) && cats.pengeluaran.length ? cats.pengeluaran : ['Makan', 'Belanja', 'Lainnya'];
    const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : formatDate(new Date());

    if (lang === 'en') {
      return [
        'Extract transaction details from this shopping receipt or bank transfer screenshot.',
        'Return ONLY a valid JSON object with exact keys:',
        '- "tanggal": string YYYY-MM-DD (use "' + fallbackDate + '" if unreadable)',
        '- "tipe": "Pengeluaran" or "Pemasukan"',
        '- "kategori": choose the closest category from PENGELUARAN [' + pengeluaran.join(', ') + '] or PEMASUKAN [' + pemasukan.join(', ') + ']',
        '- "nominal": positive integer amount in IDR without dots/commas',
        '- "keterangan": concise merchant name and item summary',
        'Do not wrap in explanations.'
      ].join('\n');
    }
    return [
      'Ekstrak detail transaksi dari gambar struk belanja atau bukti transfer ini.',
      'Kembalikan HANYA objek JSON valid dengan key persis berikut:',
      '- "tanggal": format YYYY-MM-DD (pakai "' + fallbackDate + '" jika tanggal tidak terbaca)',
      '- "tipe": "Pengeluaran" atau "Pemasukan"',
      '- "kategori": pilih satu kategori paling cocok dari PENGELUARAN [' + pengeluaran.join(', ') + '] atau PEMASUKAN [' + pemasukan.join(', ') + ']',
      '- "nominal": angka bulat positif dalam Rupiah tanpa titik/koma',
      '- "keterangan": ringkasan singkat nama merchant dan item utama',
      'Jangan sertakan teks penjelasan di luar JSON.'
    ].join('\n');
  }

  function parseReceiptOcrResponse(rawText, todayStr) {
    const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : formatDate(new Date());
    const cleaned = stripJsonFences(rawText);
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Respons OCR struk tidak berupa objek JSON.');
    }
    const rawType = String(parsed.tipe || '').trim().toLowerCase();
    const tipe = rawType === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran';
    const rawDate = String(parsed.tanggal || '').slice(0, 10);
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : fallbackDate;
    const nominal = Math.round(Number(parsed.nominal));
    if (!Number.isFinite(nominal) || nominal <= 0) {
      throw new Error('Nominal transaksi pada struk tidak terbaca.');
    }
    return {
      tanggal,
      tipe,
      kategori: String(parsed.kategori || 'Lainnya').trim() || 'Lainnya',
      nominal,
      keterangan: String(parsed.keterangan || '').trim()
    };
  }

  function buildAiFinancialChatPrompt(payload, question, lang) {
    const safeQuestion = String(question || '').trim().slice(0, 500);
    if (!safeQuestion) throw new Error('Pertanyaan AI wajib diisi.');
    const dataJson = JSON.stringify(payload || {});
    if (lang === 'en') {
      return [
        'You are a concise personal finance advisor answering the user\'s question strictly based on their financial summary (in IDR).',
        'Use 2-4 concise paragraphs or bullet points with concrete IDR numbers from the payload. Do not invent numbers.',
        'USER QUESTION: ' + safeQuestion,
        'USER FINANCIAL DATA (JSON):',
        dataJson
      ].join('\n');
    }
    return [
      'Kamu adalah penasihat keuangan pribadi yang menjawab pertanyaan pengguna secara ringkas dan berbasis data keuangan berikut (dalam IDR).',
      'Jawab dalam 2-4 poin atau paragraf singkat yang realistis beserta perhitungan angka Rupiah konkret dari data. Jangan mengarang angka di luar data.',
      'PERTANYAAN PENGGUNA: ' + safeQuestion,
      'DATA KEUANGAN PENGGUNA (JSON):',
      dataJson
    ].join('\n');
  }

  function computeFinancialHealthRatios(data, period, payrollDay) {
    const src = data && typeof data === 'object' ? data : {};
    const payload = buildAiCashflowPayload(src, period, payrollDay);
    const assets = Array.isArray(src.assets) ? src.assets : [];
    const cashAssetsTotal = assets
      .filter((a) => String(a.type || '').toLowerCase() === 'cash')
      .reduce((sum, a) => sum + (Number(a.value) || 0), 0);
    const liquidCash = Math.max(0, payload.walletsTotal) + Math.max(0, cashAssetsTotal);

    const series = monthlyCashflowSeries(src.transactions, period, payrollDay, 3);
    const nonZeroExpenses = series.map((s) => s.expenseTotal).filter((v) => v > 0);
    const avgMonthlyExpense = nonZeroExpenses.length
      ? nonZeroExpenses.reduce((sum, v) => sum + v, 0) / nonZeroExpenses.length
      : payload.expenseTotal;

    const emergencyRunwayMonths = avgMonthlyExpense > 0
      ? Number((liquidCash / avgMonthlyExpense).toFixed(1))
      : null;
    const runwayStatus = emergencyRunwayMonths === null
      ? 'info'
      : emergencyRunwayMonths >= 6
        ? 'excellent'
        : emergencyRunwayMonths >= 3
          ? 'good'
          : 'warning';

    const savingsRatePct = payload.savingsRate;
    const savingsStatus = payload.incomeTotal <= 0
      ? 'info'
      : savingsRatePct >= 20
        ? 'excellent'
        : savingsRatePct >= 10
          ? 'good'
          : 'warning';

    const grossAssets = Math.max(0, payload.walletsTotal) + Math.max(0, payload.assetsTotal) + Math.max(0, payload.piutangTotal);
    const debtToAssetPct = grossAssets > 0
      ? Number(((payload.utangTotal / grossAssets) * 100).toFixed(1))
      : (payload.utangTotal > 0 ? 100 : 0);
    const debtStatus = debtToAssetPct === 0
      ? 'excellent'
      : debtToAssetPct <= 30
        ? 'good'
        : 'danger';

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
    parsePeriod(endPeriod);
    const list = Array.isArray(transactions) ? transactions : [];
    const perCategoryTotals = new Map();

    for (let i = 0; i < count; i += 1) {
      const period = shiftPeriod(endPeriod, -i);
      const summary = summarizePeriod([], list, period, payrollDay);
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
        const rounded = Math.max(10000, Math.ceil(avg / 10000) * 10000);
        return {
          category,
          recommendedAmount: rounded,
          averageActual: Math.round(avg),
          activeCycles: stats.cycles
        };
      })
      .sort((a, b) => b.recommendedAmount - a.recommendedAmount || a.category.localeCompare(b.category));
  }

  function resolveWalletsLiquidTotal(src) {
    const wallets = Array.isArray(src.wallets) ? src.wallets : [];
    if (!wallets.length) {
      return Math.max(0, Number(src.walletsTotal) || 0);
    }
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
      let delta = 0;
      if (isPiutang) delta = t.tipe === 'Pengeluaran' ? -amount : amount;
      else if (isUtang) delta = t.tipe === 'Pemasukan' ? 0 : -amount;
      else delta = t.tipe === 'Pemasukan' ? amount : -amount;
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
    const buckets = {
      cash: resolveWalletsLiquidTotal(src),
      emas: 0,
      crypto: 0,
      usd: 0,
      other: 0
    };

    assets.forEach((a) => {
      if (!a || typeof a !== 'object') return;
      const typeLower = String(a.type || '').trim().toLowerCase();
      const rawVal = Number(a.currentValue) || Number(a.value) || Number(a.amount) ||
        (Number(a.quantity || 0) * Number(a.currentPrice || a.buyPrice || 0));
      const val = Math.max(0, Number.isFinite(rawVal) ? rawVal : 0);
      if (val <= 0) return;

      if (typeLower === 'cash' || typeLower === 'tabungan') {
        buckets.cash += val;
      } else if (typeLower === 'emas') {
        buckets.emas += val;
      } else if (typeLower === 'crypto') {
        buckets.crypto += val;
      } else if (typeLower === 'usd') {
        buckets.usd += val;
      } else {
        buckets.other += val;
      }
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
      const sharePct = total > 0 ? Number(((amount / total) * 100).toFixed(1)) : 0;
      return { key: d.key, label: d.label, amount, sharePct, color: d.color };
    });

    const diversificationScore = segments.filter((s) => s.sharePct >= 5).length;
    return { total: Math.round(total), diversificationScore, segments };
  }

  function detectSpendingAnomalies(transactions, recurring, period, payrollDay) {
    parsePeriod(period);
    const list = Array.isArray(transactions) ? transactions : [];
    const recList = Array.isArray(recurring) ? recurring : [];

    let incomeTotal = 0;
    let expenseTotal = 0;
    const expenseRows = [];

    list.forEach((tx) => {
      if (!tx || isDebtCategory(tx.kategori) || !isInPeriod(tx.tanggal, period, payrollDay)) return;
      const amount = Number(tx.nominal) || 0;
      if (amount <= 0) return;
      if (tx.tipe === 'Pemasukan') {
        incomeTotal += amount;
      } else if (tx.tipe === 'Pengeluaran') {
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
      .map((tx) => {
        const nominal = Number(tx.nominal) || 0;
        return {
          id: tx.id || '',
          tanggal: String(tx.tanggal || '').slice(0, 10),
          kategori: String(tx.kategori || ''),
          keterangan: String(tx.keterangan || ''),
          nominal,
          multipleOfAvg: avgExpenseTx > 0 ? Number((nominal / avgExpenseTx).toFixed(1)) : 1
        };
      });

    const fixedExpenseTotal = recList
      .filter((r) => r && String(r.active) !== 'false' && r.active !== false && r.tipe === 'Pengeluaran')
      .reduce((sum, r) => sum + Math.max(0, Number(r.nominal) || 0), 0);

    const denominator = incomeTotal > 0 ? incomeTotal : expenseTotal;
    const fixedCostRatioPct = denominator > 0 ? Number(((fixedExpenseTotal / denominator) * 100).toFixed(1)) : 0;
    const fixedCostBasis = incomeTotal > 0 ? 'income' : (expenseTotal > 0 ? 'expense' : 'none');

    return {
      expenseCount: expenseRows.length,
      avgExpenseTx: Math.round(avgExpenseTx),
      incomeTotal,
      expenseTotal,
      anomalies,
      fixedExpenseTotal,
      fixedCostRatioPct,
      fixedCostBasis
    };
  }

  function prepareBackupRestorePayload(backupObj, existingData) {
    const empty = {
      valid: false,
      newTransactions: [],
      skippedTransactions: 0,
      newBudgets: [],
      skippedBudgets: 0,
      newGoals: [],
      skippedGoals: 0
    };
    if (!backupObj || typeof backupObj !== 'object') return empty;

    const src = (backupObj.data && typeof backupObj.data === 'object') ? backupObj.data : backupObj;
    const rawTx = Array.isArray(src.transactions)
      ? src.transactions
      : (Array.isArray(src.transaksi) ? src.transaksi : null);
    const rawBudgets = Array.isArray(src.budgets) ? src.budgets : null;
    const rawGoals = Array.isArray(src.goals) ? src.goals : null;

    if (!rawTx && !rawBudgets && !rawGoals) return empty;

    const existing = existingData && typeof existingData === 'object' ? existingData : {};
    const existingTxList = Array.isArray(existing.transactions)
      ? existing.transactions
      : (Array.isArray(existing.transaksi) ? existing.transaksi : []);

    const txSig = (t) => {
      const tanggal = String(t.tanggal || '').slice(0, 10);
      const tipe = String(t.tipe || '').trim();
      const kategori = String(t.kategori || '').trim().toLowerCase();
      const nominal = Math.round(Number(t.nominal) || 0);
      const keterangan = String(t.keterangan || '').trim().toLowerCase();
      return `${tanggal}|${tipe}|${kategori}|${nominal}|${keterangan}`;
    };

    const seenTx = new Set(existingTxList.map(txSig));
    const newTransactions = [];
    let skippedTransactions = 0;

    (rawTx || []).forEach((t) => {
      if (!t || typeof t !== 'object') {
        skippedTransactions += 1;
        return;
      }
      const tanggal = String(t.tanggal || '').slice(0, 10);
      const tipe = String(t.tipe || '').trim();
      const kategori = String(t.kategori || '').trim();
      const nominal = Number(t.nominal);
      const keterangan = String(t.keterangan || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) ||
          (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') ||
          !kategori || !Number.isFinite(nominal) || nominal <= 0) {
        skippedTransactions += 1;
        return;
      }
      const item = { tanggal, tipe, kategori, nominal, keterangan, walletId: t.walletId ? String(t.walletId) : '' };
      const sig = txSig(item);
      if (seenTx.has(sig)) {
        skippedTransactions += 1;
        return;
      }
      seenTx.add(sig);
      newTransactions.push(item);
    });

    const budgetSig = (b) => `${String(b.bulan || '').slice(0, 7)}|${String(b.kategori || '').trim().toLowerCase()}`;
    const seenBudgets = new Set((Array.isArray(existing.budgets) ? existing.budgets : []).map(budgetSig));
    const newBudgets = [];
    let skippedBudgets = 0;

    (rawBudgets || []).forEach((b) => {
      if (!b || typeof b !== 'object') {
        skippedBudgets += 1;
        return;
      }
      const bulan = String(b.bulan || '').slice(0, 7);
      const kategori = String(b.kategori || '').trim();
      const jumlah = Number(b.jumlah);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan) || !kategori || !Number.isFinite(jumlah) || jumlah < 0) {
        skippedBudgets += 1;
        return;
      }
      const item = { bulan, kategori, jumlah };
      const sig = budgetSig(item);
      if (seenBudgets.has(sig)) {
        skippedBudgets += 1;
        return;
      }
      seenBudgets.add(sig);
      newBudgets.push(item);
    });

    const goalSig = (g) => `${String(g.name || '').trim().toLowerCase()}|${Math.round(Number(g.targetAmount) || 0)}`;
    const seenGoals = new Set((Array.isArray(existing.goals) ? existing.goals : []).map(goalSig));
    const newGoals = [];
    let skippedGoals = 0;

    (rawGoals || []).forEach((g) => {
      if (!g || typeof g !== 'object') {
        skippedGoals += 1;
        return;
      }
      const name = String(g.name || '').trim();
      const targetAmount = Number(g.targetAmount);
      const currentAmount = Number(g.currentAmount) || 0;
      const targetDate = String(g.targetDate || '').slice(0, 10);
      if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0) {
        skippedGoals += 1;
        return;
      }
      const item = {
        name: name.slice(0, 80),
        targetAmount,
        currentAmount: Math.max(0, currentAmount),
        targetDate: /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : ''
      };
      const sig = goalSig(item);
      if (seenGoals.has(sig)) {
        skippedGoals += 1;
        return;
      }
      seenGoals.add(sig);
      newGoals.push(item);
    });

    return {
      valid: true,
      newTransactions,
      skippedTransactions,
      newBudgets,
      skippedBudgets,
      newGoals,
      skippedGoals
    };
  }

  const api = {
    getPeriodRange, isInPeriod, shiftPeriod, summarizePeriod, monthlyTrend,
    periodInsights, goalProgress, buildAiCashflowPayload,
    buildGeminiCashflowPrompt, parseGeminiCashflowResponse,
    calculateGoalMonthlySaving, monthlyCashflowSeries, buildAppNotifications,
    buildReceiptOcrPrompt, parseReceiptOcrResponse, buildAiFinancialChatPrompt,
    computeFinancialHealthRatios, recommendCategoryBudgets,
    computeAssetAllocation, detectSpendingAnomalies, prepareBackupRestorePayload
  };
  root.FinanceAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
