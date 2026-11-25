(function (root) {
  'use strict';

  const core = (typeof module !== 'undefined' && module.exports)
    ? require('./finance-analysis-core.js')
    : root.FinanceAnalysisCore;
  const portfolio = (typeof module !== 'undefined' && module.exports)
    ? require('./finance-analysis-portfolio.js')
    : root.FinanceAnalysisPortfolio;

  const CASHFLOW_ANALYSIS_SCHEMA = {
    type: 'object',
    properties: {
      healthScore: { type: 'integer' },
      statusLabel: { type: 'string' },
      ringkasan: { type: 'string' },
      sorotan: { type: 'array', items: { type: 'string' } },
      bocorAnggaran: { type: 'array', items: { type: 'string' } },
      rekomendasi: { type: 'array', items: { type: 'string' } }
    },
    required: ['healthScore', 'statusLabel', 'ringkasan', 'sorotan', 'bocorAnggaran', 'rekomendasi']
  };

  const RECEIPT_OCR_SCHEMA = {
    type: 'object',
    properties: {
      tanggal: { type: 'string' },
      tipe: { type: 'string', enum: ['Pemasukan', 'Pengeluaran'] },
      kategori: { type: 'string' },
      nominal: { type: 'integer' },
      keterangan: { type: 'string' }
    },
    required: ['tanggal', 'tipe', 'kategori', 'nominal', 'keterangan']
  };

  function collectActiveDebtsForAi(transactions) {
    const balMap = new Map();
    (Array.isArray(transactions) ? transactions : []).forEach((tr) => {
      const cat = String((tr && tr.kategori) || '').trim();
      if (!cat.startsWith('UtangApp - ') && !cat.startsWith('UtangPerson - ')) return;
      const amt = Number(tr.nominal) || 0;
      const delta = tr.tipe === 'Pemasukan' ? amt : -amt;
      balMap.set(cat, (balMap.get(cat) || 0) + delta);
    });
    return Array.from(balMap.entries())
      .filter(([, bal]) => bal > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, balance]) => ({ name: name.replace(/^Utang(App|Person)\s*-\s*/, ''), balance: Math.round(balance) }));
  }

  function buildEnrichedAiSnapshot(data, period, payrollDay, todayStr) {
    const src = data && typeof data === 'object' ? data : {};
    const pf = portfolio || root.FinanceAnalysisPortfolio;
    const base = core.buildAiCashflowPayload(src, period, payrollDay);
    const enriched = Object.assign({}, base);
    if (pf && typeof pf.computeFinancialHealthRatios === 'function') {
      const r = pf.computeFinancialHealthRatios(src, period, payrollDay);
      enriched.healthRatios = {
        liquidCash: r.liquidCash, avgMonthlyExpense: r.avgMonthlyExpense,
        emergencyRunwayMonths: r.emergencyRunwayMonths, runwayStatus: r.runwayStatus,
        debtToAssetPct: r.debtToAssetPct, debtStatus: r.debtStatus
      };
    }
    if (pf && typeof pf.computeCashflowRunway === 'function') {
      const rw = pf.computeCashflowRunway(src, period, payrollDay, todayStr);
      enriched.runway = {
        daysLeftInCycle: rw.daysLeftInCycle, upcomingRecurringExpense: rw.upcomingRecurringExpense,
        upcomingRecurringIncome: rw.upcomingRecurringIncome, projectedEndCash: rw.projectedEndCash,
        safeDailyBudget: rw.safeDailyBudget, status: rw.status
      };
    }
    if (pf && typeof pf.detectSpendingAnomalies === 'function') {
      const anom = pf.detectSpendingAnomalies(src.transactions, src.recurring, period, payrollDay);
      enriched.spendingBehavior = {
        expenseCount: anom.expenseCount, avgExpenseTx: anom.avgExpenseTx,
        fixedExpenseTotal: anom.fixedExpenseTotal, fixedCostRatioPct: anom.fixedCostRatioPct,
        anomalies: anom.anomalies
      };
    }
    if (pf && typeof pf.computeAssetAllocation === 'function') {
      const alloc = pf.computeAssetAllocation(src);
      enriched.portfolioAllocation = {
        total: alloc.total, diversificationScore: alloc.diversificationScore,
        segments: alloc.segments.filter((s) => s.amount > 0).map((s) => ({ label: s.label, amount: s.amount, sharePct: s.sharePct }))
      };
    }
    if (typeof core.monthlyCashflowSeries === 'function') {
      enriched.recentTrend = core.monthlyCashflowSeries(src.transactions, period, payrollDay, 3);
    }
    const goals = Array.isArray(src.goals) ? src.goals : [];
    enriched.activeGoals = goals.filter((g) => Number(g && g.targetAmount) > 0).slice(0, 5).map((g) => ({
      name: String(g.name || 'Target'),
      currentAmount: Math.round(Number(g.currentAmount) || 0),
      targetAmount: Math.round(Number(g.targetAmount) || 0),
      pct: core.goalProgress(g.currentAmount, g.targetAmount),
      targetDate: g.targetDate ? String(g.targetDate).slice(0, 10) : ''
    }));
    enriched.activeDebts = collectActiveDebtsForAi(src.transactions);
    return enriched;
  }

  function buildGeminiSystemInstruction(mode, lang) {
    const isEn = lang === 'en';
    if (mode === 'receipt') {
      return isEn
        ? 'You are a high-precision Indonesian receipt & transfer screenshot OCR parser. Always use the final Grand Total (Total Bayar), never Subtotal, discount, cash tender, or change (Kembalian). In Indonesian currency, dots (.) separate thousands (Rp 45.000 = 45000).'
        : 'Kamu adalah parser OCR struk belanja & bukti transfer Indonesia berpresisi tinggi. Selalu ambil Grand Total / Total Bayar akhir, bukan Subtotal, diskon, tunai, atau kembalian. Pada format Rupiah, titik (.) adalah pemisah ribuan (Rp 45.000 = 45000).';
    }
    if (mode === 'chat') {
      return isEn
        ? 'You are an expert personal finance advisor analyzing the user snapshot in IDR. Start with a clear verdict, cite exact numbers from the data (cashflow, safe daily budget, emergency runway, debts, goals), use concise Markdown (### headings, - bullets, **Rp** highlights), and never fabricate missing figures.'
        : 'Kamu adalah penasihat keuangan pribadi berpengalaman yang menjawab dalam Rupiah (IDR). Mulai dengan kesimpulan langsung, hitung menggunakan angka nyata dari data (arus kas, safe daily budget, dana darurat/runway, utang, target), rapikan dengan Markdown (### judul, - poin, **Rp** tebal), dan jangan mengarang angka di luar data.';
    }
    return isEn
      ? 'You are a senior personal finance analyst auditing an IDR cashflow snapshot. Benchmark against: savings rate >= 20%, emergency runway 3-6 months, debt-to-asset <= 30%, fixed costs <= 50%, runway safe daily budget, spending anomalies, and budget overruns. Ground every point in exact numbers from DATA.'
      : 'Kamu adalah analis keuangan pribadi senior yang mengaudit data arus kas dalam Rupiah (IDR). Evaluasi berdasarkan benchmark: savings rate >= 20%, dana darurat 3-6 bulan, rasio utang terhadap aset <= 30%, biaya tetap <= 50%, safe daily budget runway, anomali belanja, serta over-budget. Gunakan angka persis dari DATA tanpa mengarang.';
  }

  function formatIdrSimple(amount) {
    return 'Rp ' + Math.round(Number(amount) || 0).toLocaleString('id-ID');
  }

  function stripJsonFences(rawText) {
    const cleaned = String(rawText || '').trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) return fenceMatch[1].trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) return cleaned.slice(start, end + 1);
    return cleaned;
  }

  function buildGeminiCashflowPrompt(payload, lang) {
    const dataJson = JSON.stringify(payload);
    if (lang === 'en') {
      return [
        'Analyze this personal cashflow & financial health snapshot (in IDR). Factor in healthRatios (emergency runway & debt-to-asset), runway (safeDailyBudget), spendingBehavior (fixed costs & spikes), recentTrend, activeGoals, and activeDebts when present.',
        'Return ONLY a valid JSON object with exact keys:',
        '- "healthScore": integer 0..100 representing financial health for this cycle',
        '- "statusLabel": short label (e.g. "Healthy", "Need Attention", "Deficit")',
        '- "ringkasan": 2-3 concise sentences summarizing income, expenses, savings rate, net cashflow, and cashflow resilience',
        '- "sorotan": array of 2-4 concise insight bullet strings with exact IDR numbers from the data',
        '- "bocorAnggaran": array of strings highlighting over-budget categories, high fixed costs, or spending anomalies (empty array if safe)',
        '- "rekomendasi": array of 3 actionable, realistic steps with concrete IDR targets for the next cycle',
        'Do not invent numbers not present in the payload.',
        'DATA:',
        dataJson
      ].join('\n');
    }
    return [
      'Analisis snapshot arus kas & kesehatan finansial berikut (dalam Rupiah/IDR). Pertimbangkan healthRatios (dana darurat & rasio utang), runway (safeDailyBudget), spendingBehavior (biaya tetap & anomali), recentTrend, activeGoals, dan activeDebts bila tersedia.',
      'Kembalikan HANYA objek JSON yang valid dengan key persis berikut:',
      '- "healthScore": bilangan bulat 0..100 yang menilai kesehatan arus kas periode ini',
      '- "statusLabel": label singkat (contoh: "Sehat", "Waspada", "Defisit")',
      '- "ringkasan": 2-3 kalimat ringkas membahas pemasukan, pengeluaran, savings rate, surplus/defisit, dan ketahanan arus kas',
      '- "sorotan": array berisi 2-4 poin sorotan utama dengan angka IDR spesifik dari data',
      '- "bocorAnggaran": array berisi peringatan kategori yang melewati budget, biaya tetap tinggi, atau lonjakan pengeluaran (array kosong jika aman)',
      '- "rekomendasi": array berisi 3 langkah aksi konkret dan realistis beserta target angka IDR untuk siklus berikutnya',
      'Jangan mengarang angka di luar data payload.',
      'DATA:',
      dataJson
    ].join('\n');
  }

  function parseGeminiCashflowResponse(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      return { healthScore: null, statusLabel: '', ringkasan: '', sorotan: [], bocorAnggaran: [], rekomendasi: [] };
    }
    const cleaned = stripJsonFences(text);
    const toStringList = (val) => (Array.isArray(val) ? val.map((x) => String(x || '').trim()).filter(Boolean) : []);

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const rawScore = Number(parsed.healthScore);
        const healthScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : null;
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

    return { healthScore: null, statusLabel: '', ringkasan: text, sorotan: [], bocorAnggaran: [], rekomendasi: [] };
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
      : core.formatDate(new Date());
    const todayMs = Date.parse(baseDate + 'T00:00:00Z');
    const daysLeft = Math.ceil((targetMs - todayMs) / 86400000);
    if (daysLeft < 0) {
      return { remaining, daysLeft, monthsLeft: 0, monthlySaving: remaining, status: 'overdue' };
    }
    const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30));
    return {
      remaining,
      daysLeft,
      monthsLeft,
      monthlySaving: Math.ceil(remaining / monthsLeft),
      status: daysLeft <= 14 ? 'urgent' : 'on_track'
    };
  }

  function collectBudgetAlerts(budgets, transactions, period, payrollDay) {
    if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return [];
    const alerts = [];
    const summary = core.summarizePeriod(budgets, transactions, period, payrollDay);
    summary.rows.forEach((row) => {
      if (row.plan > 0 && row.percent !== null && row.percent >= 80) {
        const isOver = row.percent > 100;
        alerts.push({
          id: 'budget:' + period + ':' + row.category,
          severity: isOver ? 'danger' : 'warning',
          title: isOver ? ('Budget terlampaui: ' + row.category) : ('Budget hampir habis: ' + row.category),
          message: 'Terpakai ' + Math.round(row.percent) + '% (' + formatIdrSimple(row.actual) + ' / ' + formatIdrSimple(row.plan) + ').',
          actionType: 'view',
          actionPayload: { view: 'budgeting' }
        });
      }
    });
    return alerts;
  }

  function collectRecurringAlerts(recurring, baseDate) {
    const baseDateObj = new Date(baseDate + 'T00:00:00Z');
    const year = baseDateObj.getUTCFullYear();
    const month = baseDateObj.getUTCMonth();
    const todayDay = baseDateObj.getUTCDate();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const daysInNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
    const alerts = [];

    recurring.forEach((item) => {
      if (item.active === false || String(item.active) === 'false') return;
      const rawDay = Math.trunc(Number(item.dayOfMonth ?? item.day_of_month) || 0);
      if (rawDay < 1 || rawDay > 31) return;
      const lastRun = String(item.lastRun ?? item.last_run ?? '').slice(0, 10);
      if (lastRun === baseDate) return;

      const clampedThisMonth = Math.min(rawDay, daysInMonth);
      let diffDays = clampedThisMonth - todayDay;
      if (diffDays < 0) diffDays = (daysInMonth - todayDay) + Math.min(rawDay, daysInNextMonth);
      if (diffDays >= 0 && diffDays <= 3) {
        alerts.push({
          id: 'recurring:' + (item.id || item.kategori + ':' + rawDay),
          severity: diffDays === 0 ? 'warning' : 'info',
          title: 'Jadwal rutin: ' + String(item.kategori || 'Transaksi'),
          message: (diffDays === 0 ? 'Jatuh tempo hari ini' : ('Jatuh tempo ' + diffDays + ' hari lagi')) +
            ' (tgl ' + rawDay + ') · ' + formatIdrSimple(item.nominal),
          actionType: 'recurring',
          actionPayload: { id: item.id || null }
        });
      }
    });
    return alerts;
  }

  function collectGoalAlerts(goals, baseDate) {
    const alerts = [];
    goals.forEach((goal) => {
      const calc = calculateGoalMonthlySaving(goal.currentAmount, goal.targetAmount, goal.targetDate, baseDate);
      if (calc.status === 'overdue' || calc.status === 'urgent') {
        alerts.push({
          id: 'goal:' + (goal.id || goal.name),
          severity: calc.status === 'overdue' ? 'danger' : 'warning',
          title: calc.status === 'overdue'
            ? ('Target melewati tenggat: ' + String(goal.name || 'Target'))
            : ('Target mendekati tenggat: ' + String(goal.name || 'Target')),
          message: 'Sisa ' + formatIdrSimple(calc.remaining) + (calc.daysLeft !== null ? ' (' + calc.daysLeft + ' hari)' : '') + '.',
          actionType: 'view',
          actionPayload: { view: 'budgeting' }
        });
      }
    });
    return alerts;
  }

  function buildAppNotifications(data, period, payrollDay, todayStr) {
    const src = data && typeof data === 'object' ? data : {};
    const budgets = Array.isArray(src.budgets) ? src.budgets : [];
    const transactions = Array.isArray(src.transactions) ? src.transactions : [];
    const recurring = Array.isArray(src.recurring) ? src.recurring : [];
    const goals = Array.isArray(src.goals) ? src.goals : [];
    const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : core.formatDate(new Date());

    const notifications = [
      ...collectBudgetAlerts(budgets, transactions, period, payrollDay),
      ...collectRecurringAlerts(recurring, baseDate),
      ...collectGoalAlerts(goals, baseDate)
    ];

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

  function buildReceiptOcrPrompt(categories, todayStr, lang) {
    const cats = categories && typeof categories === 'object' ? categories : {};
    const pemasukan = Array.isArray(cats.pemasukan) && cats.pemasukan.length ? cats.pemasukan : ['Gaji', 'Lainnya'];
    const pengeluaran = Array.isArray(cats.pengeluaran) && cats.pengeluaran.length ? cats.pengeluaran : ['Makan', 'Belanja', 'Lainnya'];
    const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || '')) ? String(todayStr).slice(0, 10) : core.formatDate(new Date());

    if (lang === 'en') {
      return [
        'Extract 1 transaction from this Indonesian receipt or bank transfer screenshot.',
        'Pick Grand Total / Total Bayar (not Subtotal, discount, tender/cash, or change/kembalian). Treat dot (.) thousand separators as integer IDR (Rp 45.000 -> 45000).',
        'Return ONLY a valid JSON object with exact keys:',
        '- "tanggal": YYYY-MM-DD (use "' + fallbackDate + '" if unreadable)',
        '- "tipe": "Pengeluaran" or "Pemasukan"',
        '- "kategori": choose the closest category from PENGELUARAN [' + pengeluaran.join(', ') + '] or PEMASUKAN [' + pemasukan.join(', ') + ']',
        '- "nominal": positive integer amount in IDR without dots/commas',
        '- "keterangan": concise merchant name and main items'
      ].join('\n');
    }
    return [
      'Ekstrak 1 transaksi dari gambar struk belanja atau bukti transfer Indonesia ini.',
      'Ambil Grand Total / Total Bayar akhir (bukan Subtotal, diskon, uang tunai, atau kembalian). Anggap tanda titik (.) pada Rupiah sebagai pemisah ribuan (Rp 45.000 -> 45000).',
      'Kembalikan HANYA objek JSON valid dengan key persis berikut:',
      '- "tanggal": format YYYY-MM-DD (pakai "' + fallbackDate + '" jika tanggal tidak terbaca)',
      '- "tipe": "Pengeluaran" atau "Pemasukan"',
      '- "kategori": pilih satu kategori paling cocok dari PENGELUARAN [' + pengeluaran.join(', ') + '] atau PEMASUKAN [' + pemasukan.join(', ') + ']',
      '- "nominal": angka bulat positif dalam Rupiah tanpa titik/koma',
      '- "keterangan": ringkasan singkat nama merchant dan item utama'
    ].join('\n');
  }

  function parseReceiptOcrResponse(rawText, todayStr) {
    const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || '')) ? String(todayStr).slice(0, 10) : core.formatDate(new Date());
    const parsed = JSON.parse(stripJsonFences(rawText));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Respons OCR struk tidak berupa objek JSON.');
    }
    const tipe = String(parsed.tipe || '').trim().toLowerCase() === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran';
    const rawDate = String(parsed.tanggal || '').slice(0, 10);
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : fallbackDate;
    const nominal = Math.round(Number(parsed.nominal));
    if (!Number.isFinite(nominal) || nominal <= 0) {
      throw new Error('Nominal transaksi pada struk tidak terbaca.');
    }
    return { tanggal, tipe, kategori: String(parsed.kategori || 'Lainnya').trim() || 'Lainnya', nominal, keterangan: String(parsed.keterangan || '').trim() };
  }

  function buildAiFinancialChatPrompt(payload, question, lang) {
    const safeQuestion = String(question || '').trim().slice(0, 1000);
    if (!safeQuestion) throw new Error('Pertanyaan AI wajib diisi.');
    const dataJson = JSON.stringify(payload || {});
    if (lang === 'en') {
      return [
        'Answer the user\'s question concisely based strictly on their IDR financial snapshot below.',
        'Start with a direct conclusion, then 2-4 bullet points with concrete IDR math from the payload. Do not invent numbers.',
        'USER QUESTION: ' + safeQuestion,
        'USER FINANCIAL DATA (JSON):',
        dataJson
      ].join('\n');
    }
    return [
      'Jawab pertanyaan pengguna secara tajam dan berbasis data keuangan IDR di bawah ini.',
      'Mulai dengan kesimpulan langsung, lalu 2-4 poin realistis beserta hitung-hitungan angka Rupiah konkret dari data. Jangan mengarang angka di luar data.',
      'PERTANYAAN PENGGUNA: ' + safeQuestion,
      'DATA KEUANGAN PENGGUNA (JSON):',
      dataJson
    ].join('\n');
  }

  function buildAiChatSteps(payload, history, question, lang) {
    const safeQuestion = String(question || '').trim().slice(0, 1000);
    if (!safeQuestion) throw new Error('Pertanyaan AI wajib diisi.');
    const dataJson = JSON.stringify(payload || {});
    const prefix = lang === 'en'
      ? 'USER FINANCIAL SNAPSHOT (JSON):\n' + dataJson + '\n\nUSER QUESTION: '
      : 'DATA KEUANGAN PENGGUNA TERKINI (JSON):\n' + dataJson + '\n\nPERTANYAAN PENGGUNA: ';
    const steps = (Array.isArray(history) ? history.slice(-8) : [])
      .filter((m) => m && String(m.text || '').trim())
      .map((m) => ({
        type: m.role === 'user' ? 'user_input' : 'model_output',
        content: [{ type: 'text', text: String(m.text).trim().slice(0, 2000) }]
      }));
    steps.push({ type: 'user_input', content: [{ type: 'text', text: prefix + safeQuestion }] });
    return steps;
  }

  const aiApi = {
    CASHFLOW_ANALYSIS_SCHEMA, RECEIPT_OCR_SCHEMA, buildEnrichedAiSnapshot, buildGeminiSystemInstruction,
    buildGeminiCashflowPrompt, parseGeminiCashflowResponse, calculateGoalMonthlySaving,
    buildAppNotifications, buildReceiptOcrPrompt, parseReceiptOcrResponse, buildAiFinancialChatPrompt, buildAiChatSteps
  };
  root.FinanceAnalysisAi = aiApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = aiApi;
})(typeof window !== 'undefined' ? window : globalThis);
