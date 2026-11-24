(function (root) {
  'use strict';

  const DEFAULT_AUTO_CATEGORY_RULES = [
    { keyword: 'gofood|grabfood|shopeefood|kopi|coffee|starbucks|kfc|mcd|warteg|resto|cafe|bakso|mie|nasi|makan', category: 'Makanan', tipe: 'Pengeluaran' },
    { keyword: 'pln|listrik|pdam|air|indihome|biznet|telkomsel|xl|indosat|wifi|pulsa|paket data|bpjs|token|tagihan', category: 'Tagihan', tipe: 'Pengeluaran' },
    { keyword: 'gojek|grab|maxim|uber|bensin|pertamina|shell|spbu|tol|parkir|kereta|kai|krl|mrt|tj|transjakarta|tiket', category: 'Transportasi', tipe: 'Pengeluaran' },
    { keyword: 'tokopedia|shopee|lazada|blibli|indomaret|alfamart|superindo|hypermart|uniqlo|mall|belanja', category: 'Belanja', tipe: 'Pengeluaran' },
    { keyword: 'apotek|kimia farma|halodoc|klinik|dokter|rs|rumah sakit|obat|vitamin|lab', category: 'Kesehatan', tipe: 'Pengeluaran' },
    { keyword: 'netflix|spotify|youtube|bioskop|xxi|cgv|steam|game|gym|liburan|hotel|wisata', category: 'Hiburan', tipe: 'Pengeluaran' },
    { keyword: 'gaji|payroll|salary|thr|bonus|fee proyek|dividen|komisi|refund|cashback', category: 'Gaji', tipe: 'Pemasukan' }
  ];

  function extractTags(text) {
    const seen = new Set();
    const str = String(text || '');
    const re = /#([a-z0-9_-]{2,32})/gi;
    let m;
    while ((m = re.exec(str)) !== null) {
      seen.add('#' + m[1].toLowerCase());
    }
    return Array.from(seen);
  }

  function summarizeTags(transactions, period, payrollDay, analysisLib) {
    const rows = Array.isArray(transactions) ? transactions : [];
    const checkPeriod = period && analysisLib && typeof analysisLib.isInPeriod === 'function';
    const map = new Map();

    rows.forEach((tx) => {
      if (!tx) return;
      if (checkPeriod && !analysisLib.isInPeriod(tx.tanggal, period, payrollDay)) return;
      const tags = extractTags(tx.keterangan);
      if (!tags.length) return;
      const amt = Number(tx.nominal) || 0;
      const isInc = tx.tipe === 'Pemasukan';
      tags.forEach((tag) => {
        if (!map.has(tag)) map.set(tag, { tag, count: 0, income: 0, expense: 0, net: 0 });
        const item = map.get(tag);
        item.count += 1;
        if (isInc) item.income += amt; else item.expense += amt;
        item.net = item.income - item.expense;
      });
    });

    return Array.from(map.values())
      .sort((a, b) => (b.expense + b.income) - (a.expense + a.income) || a.tag.localeCompare(b.tag));
  }

  function resolveAlignedCategory(target, availableList) {
    const list = Array.isArray(availableList) ? availableList : [];
    const targetLower = String(target || '').trim().toLowerCase();
    if (!targetLower) return '';
    const exact = list.find((c) => String(c).trim().toLowerCase() === targetLower);
    if (exact) return exact;
    const partial = list.find((c) => String(c).trim().toLowerCase().includes(targetLower));
    return partial || (list.length ? '' : String(target || '').trim());
  }

  function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchesKeywordToken(text, kw) {
    const clean = String(kw || '').trim().toLowerCase();
    return Boolean(clean) && new RegExp('(?:^|[^a-z0-9])' + escapeRegex(clean) + '(?:[^a-z0-9]|$)', 'i').test(text);
  }

  function matchRulesPool(text, tipe, rules, cats) {
    for (const rule of rules) {
      if (!rule || !rule.keyword || !rule.category || (rule.tipe && tipe && rule.tipe !== tipe)) continue;
      const parts = String(rule.keyword).toLowerCase().split('|').map((s) => s.trim()).filter(Boolean);
      if (!parts.some((kw) => matchesKeywordToken(text, kw))) continue;
      const matched = cats.length ? resolveAlignedCategory(rule.category, cats) : rule.category;
      if (matched) return matched;
    }
    return '';
  }

  function matchDirectUserCategory(text, cats) {
    const sorted = cats
      .filter((c) => { const k = String(c || '').trim().toLowerCase(); return k && k !== 'lainnya'; })
      .sort((a, b) => String(b).trim().length - String(a).trim().length);
    return sorted.find((c) => matchesKeywordToken(text, String(c).trim())) || '';
  }

  function applyAutoCategoryRules(description, tipe, customRules, availableCategories) {
    const text = String(description || '').toLowerCase();
    if (!text.trim()) return '';
    const custom = Array.isArray(customRules) ? customRules : [];
    const cats = Array.isArray(availableCategories)
      ? availableCategories
      : (availableCategories && typeof availableCategories === 'object'
        ? (tipe === 'Pemasukan' ? availableCategories.pemasukan : availableCategories.pengeluaran) || []
        : []);
    return matchRulesPool(text, tipe, custom, cats) ||
      matchDirectUserCategory(text, cats) ||
      matchRulesPool(text, tipe, DEFAULT_AUTO_CATEGORY_RULES, cats);
  }

  function parseQuickAmountToken(rawStr) {
    const unitMatch = /(?:^|\s)(\+?)\s*(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|m)\b/i.exec(rawStr);
    if (unitMatch) {
      const val = Number(unitMatch[2].replace(',', '.'));
      const unit = unitMatch[3].toLowerCase();
      const mult = (unit === 'jt' || unit === 'juta' || unit === 'm') ? 1000000 : 1000;
      return { amount: Math.round(val * mult), token: unitMatch[0], hasPlus: unitMatch[1] === '+' };
    }
    const plainMatch = /(?:^|\s)(\+?)\s*(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{3,9})(?=\s|$)/i.exec(rawStr);
    if (plainMatch) {
      const digits = Number(plainMatch[2].replace(/[.,]/g, ''));
      return { amount: Math.round(digits), token: plainMatch[0], hasPlus: plainMatch[1] === '+' };
    }
    return { amount: 0, token: '', hasPlus: false };
  }

  function matchWalletFromText(text, wallets) {
    const list = Array.isArray(wallets) ? wallets : [];
    if (!list.length) return { walletId: '', walletName: '', matchedToken: '' };
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    for (const w of list) {
      const fullLower = String(w.name || '').trim().toLowerCase();
      const shortWord = fullLower.split(/[\s(/]+/)[0];
      const hit = words.find((tok) => tok.length >= 2 && (tok === fullLower || tok === shortWord));
      if (hit) return { walletId: String(w.id || ''), walletName: w.name, matchedToken: hit };
    }
    return { walletId: String(list[0].id || ''), walletName: String(list[0].name || ''), matchedToken: '' };
  }

  function parseQuickTxInput(text, categories, wallets, customRules, todayStr) {
    const raw = String(text || '').trim();
    const { amount, token, hasPlus } = parseQuickAmountToken(raw);
    const tipe = (hasPlus || /(?:^|\s)(\+|gaji|bonus|thr|dividen|refund|terima|masuk)(?=\s|$)/i.test(raw))
      ? 'Pemasukan'
      : 'Pengeluaran';

    let cleaned = token ? raw.replace(token, ' ') : raw;
    const walletMatch = matchWalletFromText(cleaned, wallets);
    if (walletMatch.matchedToken) {
      cleaned = cleaned.replace(new RegExp('\\b' + walletMatch.matchedToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), ' ');
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    const catsObj = categories && typeof categories === 'object' ? categories : {};
    const catList = Array.isArray(tipe === 'Pemasukan' ? catsObj.pemasukan : catsObj.pengeluaran)
      ? (tipe === 'Pemasukan' ? catsObj.pemasukan : catsObj.pengeluaran)
      : [];

    const kategori = applyAutoCategoryRules(cleaned || raw, tipe, customRules, catList) ||
      (catList.find((c) => String(c).trim().toLowerCase() === 'lainnya') || catList[0] || 'Lainnya');

    const tags = extractTags(raw);
    return {
      valid: Number.isFinite(amount) && amount > 0 && Boolean(cleaned || kategori),
      tipe,
      nominal: amount,
      kategori,
      walletId: walletMatch.walletId,
      walletName: walletMatch.walletName,
      keterangan: cleaned || kategori,
      tags,
      tanggal: /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || '')) ? String(todayStr).slice(0, 10) : new Date().toISOString().slice(0, 10)
    };
  }

  function buildFrequentTemplates(transactions, maxCount) {
    const limit = Math.max(1, Number(maxCount) || 6);
    const list = Array.isArray(transactions) ? transactions : [];
    const groups = new Map();

    list.forEach((tx) => {
      if (!tx || !tx.kategori || !(Number(tx.nominal) > 0)) return;
      const cat = String(tx.kategori);
      if (cat.startsWith('Utang') || cat.startsWith('Piutang')) return;
      const note = String(tx.keterangan || '').trim();
      const key = `${tx.tipe}|${cat.toLowerCase()}|${Math.round(Number(tx.nominal))}|${note.toLowerCase()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          label: note ? `${cat}: ${note}` : cat,
          tipe: tx.tipe,
          kategori: cat,
          nominal: Math.round(Number(tx.nominal)),
          keterangan: note,
          walletId: String(tx.walletId || ''),
          count: 0
        });
      }
      groups.get(key).count += 1;
    });

    return Array.from(groups.values())
      .sort((a, b) => b.count - a.count || a.nominal - b.nominal)
      .slice(0, limit);
  }

  function computePeriodIncome(transactions, period, payrollDay, analysisLib) {
    return (Array.isArray(transactions) ? transactions : []).reduce((total, tx) => {
      const cat = String((tx && tx.kategori) || '');
      if (!tx || tx.tipe !== 'Pemasukan' || cat.startsWith('Utang') || cat.startsWith('Piutang')) return total;
      if (!analysisLib.isInPeriod(tx.tanggal, period, payrollDay)) return total;
      return total + (Number(tx.nominal) || 0);
    }, 0);
  }

  function pickCategoryLabel(existing, candidate) {
    const clean = String(candidate || '').trim();
    if (!clean) return existing || '';
    if (!existing) return clean;
    if (existing === existing.toLocaleLowerCase() && clean !== clean.toLocaleLowerCase()) return clean;
    return existing;
  }

  function computeAnnualRecap(transactions, budgets, year, payrollDay, analysisLib) {
    const targetYear = String(year || new Date().getFullYear()).slice(0, 4);
    const months = [];
    const catTotals = new Map();
    const catLabels = new Map();
    let totalIncome = 0;
    let totalExpense = 0;
    let txCount = 0;

    for (let m = 1; m <= 12; m += 1) {
      const period = `${targetYear}-${String(m).padStart(2, '0')}`;
      const sum = analysisLib.summarizePeriod(budgets || [], transactions || [], period, payrollDay);
      const income = computePeriodIncome(transactions, period, payrollDay, analysisLib);
      const net = income - sum.actualTotal;
      totalIncome += income;
      totalExpense += sum.actualTotal;
      sum.rows.forEach((r) => {
        if (r.actual <= 0) return;
        const key = String(r.category || '').trim().toLocaleLowerCase();
        catLabels.set(key, pickCategoryLabel(catLabels.get(key), r.category));
        catTotals.set(key, (catTotals.get(key) || 0) + r.actual);
      });
      const periodTxCount = (transactions || []).filter((t) => analysisLib.isInPeriod(t.tanggal, period, payrollDay)).length;
      txCount += periodTxCount;
      months.push({ period, income, expense: sum.actualTotal, net, txCount: periodTxCount });
    }

    const activeMonths = months.filter((m) => m.income > 0 || m.expense > 0);
    const bestSavingMonth = activeMonths.length
      ? activeMonths.slice().sort((a, b) => b.net - a.net)[0]
      : null;
    const highestExpenseMonth = activeMonths.length
      ? activeMonths.slice().sort((a, b) => b.expense - a.expense)[0]
      : null;
    const topCategories = Array.from(catTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([catKey, amount]) => ({
        category: catLabels.get(catKey) || catKey,
        amount,
        sharePct: totalExpense > 0 ? Number(((amount / totalExpense) * 100).toFixed(1)) : 0
      }));

    return {
      year: targetYear,
      totalIncome,
      totalExpense,
      netSavings: totalIncome - totalExpense,
      savingsRatePct: totalIncome > 0 ? Number((((totalIncome - totalExpense) / totalIncome) * 100).toFixed(1)) : 0,
      txCount,
      months,
      bestSavingMonth,
      highestExpenseMonth,
      topCategories
    };
  }

  function compareTwoPeriods(transactions, budgets, periodA, periodB, payrollDay, analysisLib) {
    const sumA = analysisLib.summarizePeriod(budgets || [], transactions || [], periodA, payrollDay);
    const sumB = analysisLib.summarizePeriod(budgets || [], transactions || [], periodB, payrollDay);
    const incomeA = computePeriodIncome(transactions, periodA, payrollDay, analysisLib);
    const incomeB = computePeriodIncome(transactions, periodB, payrollDay, analysisLib);
    const mapA = new Map();
    const mapB = new Map();
    const labels = new Map();
    const collectRows = (rows, target) => {
      rows.forEach((r) => {
        const key = String(r.category || '').trim().toLocaleLowerCase();
        labels.set(key, pickCategoryLabel(labels.get(key), r.category));
        target.set(key, (target.get(key) || 0) + (Number(r.actual) || 0));
      });
    };
    collectRows(sumA.rows, mapA);
    collectRows(sumB.rows, mapB);
    const cats = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));

    const categories = cats.map((key) => {
      const amountA = mapA.get(key) || 0;
      const amountB = mapB.get(key) || 0;
      const delta = amountB - amountA;
      const deltaPct = amountA > 0 ? Number(((delta / amountA) * 100).toFixed(1)) : null;
      return { category: labels.get(key) || key, amountA, amountB, delta, deltaPct };
    }).filter((row) => row.amountA > 0 || row.amountB > 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return {
      periodA, periodB, incomeA, incomeB,
      expenseA: sumA.actualTotal, expenseB: sumB.actualTotal,
      netA: incomeA - sumA.actualTotal, netB: incomeB - sumB.actualTotal,
      categories
    };
  }

  function simulateDebtPayoff(debts, extraMonthlyBudget, strategy) {
    const mode = strategy === 'avalanche' ? 'avalanche' : 'snowball';
    const items = (Array.isArray(debts) ? debts : [])
      .map((d) => ({
        name: String(d.name || 'Utang'),
        balance: Math.max(0, Number(d.balance) || 0),
        rate: Math.max(0, Number(d.annualRatePct) || 0),
        minPayment: Math.max(0, Number(d.minPayment) || 0)
      }))
      .filter((d) => d.balance > 0);

    if (!items.length) return { strategy: mode, months: 0, totalPaid: 0, totalInterest: 0, payoffOrder: [], capped: false };

    items.sort((a, b) => mode === 'avalanche'
      ? (b.rate - a.rate) || (b.balance - a.balance)
      : (a.balance - b.balance) || (b.rate - a.rate));

    const extra = Math.max(0, Number(extraMonthlyBudget) || 0);
    let months = 0;
    let totalPaid = 0;
    let totalInterest = 0;
    const payoffOrder = [];

    while (items.some((d) => d.balance > 0) && months < 600) {
      months += 1;
      let pool = extra;
      items.forEach((d) => {
        if (d.balance <= 0) return;
        const interest = d.balance * (d.rate / 100 / 12);
        totalInterest += interest;
        d.balance += interest;
        const baseMin = d.minPayment > 0 ? d.minPayment : Math.max(50000, d.balance * 0.03);
        const pay = Math.min(d.balance, baseMin);
        d.balance -= pay;
        totalPaid += pay;
        if (baseMin > pay) pool += (baseMin - pay);
        if (d.balance <= 0.01) { d.balance = 0; payoffOrder.push({ name: d.name, month: months }); }
      });
      for (const d of items) {
        if (d.balance <= 0 || pool <= 0) continue;
        const addPay = Math.min(d.balance, pool);
        d.balance -= addPay;
        pool -= addPay;
        totalPaid += addPay;
        if (d.balance <= 0.01) { d.balance = 0; payoffOrder.push({ name: d.name, month: months }); }
      }
    }
    return {
      strategy: mode,
      months,
      totalPaid: Math.round(totalPaid),
      totalInterest: Math.round(totalInterest),
      payoffOrder,
      capped: items.some((d) => d.balance > 0)
    };
  }

  function simulateCompoundGrowth(initial, monthlyContrib, annualRatePct, years) {
    const start = Math.max(0, Number(initial) || 0);
    const monthly = Math.max(0, Number(monthlyContrib) || 0);
    const annualRate = Math.max(0, Number(annualRatePct) || 0);
    const horizon = Math.max(1, Math.min(50, Math.round(Number(years) || 1)));
    const r = annualRate / 100 / 12;

    let balance = start;
    const yearlyPoints = [];
    for (let y = 1; y <= horizon; y += 1) {
      for (let m = 0; m < 12; m += 1) {
        balance = (balance * (1 + r)) + monthly;
      }
      const contributed = start + (monthly * 12 * y);
      yearlyPoints.push({ year: y, balance: Math.round(balance), contributed: Math.round(contributed) });
    }
    const finalValue = Math.round(balance);
    const totalContributed = Math.round(start + (monthly * 12 * horizon));
    return { finalValue, totalContributed, totalGain: finalValue - totalContributed, yearlyPoints };
  }

  function simulateInstallmentVsCash(cashPrice, downPayment, monthlyPayment, months) {
    const cash = Math.max(0, Number(cashPrice) || 0);
    const dp = Math.max(0, Number(downPayment) || 0);
    const monthly = Math.max(0, Number(monthlyPayment) || 0);
    const count = Math.max(1, Math.round(Number(months) || 1));
    const totalInstallment = Math.round(dp + (monthly * count));
    const extraCost = totalInstallment - cash;
    const effectiveMarkupPct = cash > 0 ? Number(((extraCost / cash) * 100).toFixed(1)) : 0;
    return { cashPrice: Math.round(cash), totalInstallment, extraCost: Math.round(extraCost), effectiveMarkupPct };
  }

  function computePortfolioRebalance(segments, targetWeights) {
    const list = Array.isArray(segments) ? segments : [];
    const targets = targetWeights && typeof targetWeights === 'object' ? targetWeights : {};
    const total = list.reduce((sum, s) => sum + Math.max(0, Number(s.amount) || 0), 0);
    let targetSum = 0;

    const rows = list.map((seg) => {
      const key = String(seg.label || seg.key || 'Lainnya');
      const currentAmount = Math.max(0, Number(seg.amount) || 0);
      const currentPct = total > 0 ? Number(((currentAmount / total) * 100).toFixed(1)) : 0;
      const targetPct = Math.max(0, Number(targets[key]) || 0);
      targetSum += targetPct;
      const targetAmount = Math.round(total * (targetPct / 100));
      const deltaAmount = targetAmount - Math.round(currentAmount);
      const action = deltaAmount > 50000 ? 'Tambah' : (deltaAmount < -50000 ? 'Kurangi' : 'Seimbang');
      return { key, label: key, color: seg.color || '#64748b', currentAmount: Math.round(currentAmount), currentPct, targetPct, targetAmount, deltaAmount, action };
    });

    return { total: Math.round(total), targetSum: Number(targetSum.toFixed(1)), rows };
  }

  const api = {
    DEFAULT_AUTO_CATEGORY_RULES, extractTags, summarizeTags, applyAutoCategoryRules,
    parseQuickTxInput, buildFrequentTemplates, computeAnnualRecap, compareTwoPeriods,
    simulateDebtPayoff, simulateCompoundGrowth, simulateInstallmentVsCash, computePortfolioRebalance
  };
  root.FinancePro = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
