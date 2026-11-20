(function (root) {
  'use strict';

  const core = (typeof module !== 'undefined' && module.exports)
    ? require('./finance-analysis-core.js')
    : root.FinanceAnalysisCore;

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
    const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : core.formatDate(new Date());

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
      : core.formatDate(new Date());
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

  const aiApi = {
    buildGeminiCashflowPrompt, parseGeminiCashflowResponse, calculateGoalMonthlySaving,
    buildAppNotifications, buildReceiptOcrPrompt, parseReceiptOcrResponse, buildAiFinancialChatPrompt
  };
  root.FinanceAnalysisAi = aiApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = aiApi;
})(typeof window !== 'undefined' ? window : globalThis);
