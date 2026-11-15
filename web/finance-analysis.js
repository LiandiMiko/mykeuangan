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

  const api = { getPeriodRange, isInPeriod, shiftPeriod, summarizePeriod, monthlyTrend };
  root.FinanceAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
