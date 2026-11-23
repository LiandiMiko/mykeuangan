/* global DB, FinanceAnalysis, Chart, formatRupiah, formatShortIDR, getMonthShort */
/* ============================================================
   FEATURES — BUDGET CHARTS & NET WORTH EVOLUTION CHART
   ============================================================ */
(function (root) {
  'use strict';

  let budgetCategoryChartInstance = null;
  let budgetCashflowChartInstance = null;

  function renderCategoryDonutChart(theme) {
    const catCanvas = document.getElementById('budgetCategoryChart');
    const catEmpty = document.getElementById('budgetCategoryChartEmpty');
    if (!catCanvas) return;

    const summary = FinanceAnalysis.summarizePeriod(DB.budgets, DB.transactions, DB.currentPeriod, DB.payrollDay);
    const nonZero = summary.rows.filter((r) => r.actual > 0).sort((a, b) => b.actual - a.actual);

    if (budgetCategoryChartInstance) {
      budgetCategoryChartInstance.destroy();
      budgetCategoryChartInstance = null;
    }
    if (!nonZero.length) {
      catCanvas.style.display = 'none';
      if (catEmpty) catEmpty.classList.remove('hidden');
      return;
    }

    catCanvas.style.display = 'block';
    if (catEmpty) catEmpty.classList.add('hidden');
    const top = nonZero.slice(0, 6);
    const restSum = nonZero.slice(6).reduce((s, r) => s + r.actual, 0);
    if (restSum > 0) top.push({ category: 'Lainnya', actual: restSum });

    const palette = [theme.brandHex, '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#64748b'];
    budgetCategoryChartInstance = new Chart(catCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: top.map((r) => r.category),
        datasets: [{
          data: top.map((r) => r.actual),
          backgroundColor: top.map((_, i) => palette[i % palette.length]),
          borderWidth: 2,
          borderColor: theme.isDark ? '#0f172a' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { animation: false } : {}),
        cutout: '62%',
        plugins: {
          legend: { position: (typeof window !== 'undefined' && window.innerWidth < 640) ? 'bottom' : 'right', labels: { color: theme.textColor, boxWidth: 10, font: { family: 'Inter', size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + formatRupiah(ctx.parsed).replace(',00', '') } }
        }
      }
    });
  }

  function renderCashflowBarChart(theme) {
    const cfCanvas = document.getElementById('budgetCashflowChart');
    const cfEmpty = document.getElementById('budgetCashflowChartEmpty');
    if (!cfCanvas) return;

    const series = FinanceAnalysis.monthlyCashflowSeries(DB.transactions, DB.currentPeriod, DB.payrollDay, 6);
    const trend = FinanceAnalysis.monthlyTrend(DB.budgets, DB.transactions, DB.currentPeriod, DB.payrollDay, 6);
    const hasAny = series.some((s) => s.incomeTotal > 0 || s.expenseTotal > 0) || trend.some((m) => m.budgetTotal > 0);

    if (budgetCashflowChartInstance) {
      budgetCashflowChartInstance.destroy();
      budgetCashflowChartInstance = null;
    }
    if (!hasAny) {
      cfCanvas.style.display = 'none';
      if (cfEmpty) cfEmpty.classList.remove('hidden');
      return;
    }

    cfCanvas.style.display = 'block';
    if (cfEmpty) cfEmpty.classList.add('hidden');
    budgetCashflowChartInstance = new Chart(cfCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: series.map((s) => getMonthShort(Number(s.period.slice(5, 7)) - 1) + ' ' + s.period.slice(2, 4)),
        datasets: [
          { label: 'Pemasukan', data: series.map((s) => s.incomeTotal), backgroundColor: '#10b981', borderRadius: 6 },
          { label: 'Pengeluaran', data: series.map((s) => s.expenseTotal), backgroundColor: '#f43f5e', borderRadius: 6 },
          { label: 'Budget', data: trend.map((m) => m.budgetTotal), backgroundColor: theme.brandHex + '66', borderColor: theme.brandHex, borderWidth: 1.5, borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { animation: false } : {}),
        plugins: {
          legend: { position: 'bottom', labels: { color: theme.textColor, boxWidth: 10, font: { family: 'Inter', size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + formatRupiah(ctx.parsed.y).replace(',00', '') } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: theme.textColor, font: { family: 'Inter', size: 10 } } },
          y: {
            grid: { color: theme.gridColor },
            ticks: {
              color: theme.textColor,
              font: { family: 'Inter', size: 10 },
              callback: (val) => typeof formatShortIDR === 'function' ? formatShortIDR(val) : val
            }
          }
        }
      }
    });
  }

  function renderBudgetCharts() {
    if (typeof Chart === 'undefined' || !root.isDataReady) return;
    const isDark = document.documentElement.classList.contains('dark');
    const theme = {
      isDark,
      textColor: isDark ? '#cbd5e1' : '#475569',
      gridColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.2)',
      brandHex: getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim() || '#4f46e5'
    };
    renderCategoryDonutChart(theme);
    renderCashflowBarChart(theme);
  }

  function renderNetWorthChart() {
    const canvas = document.getElementById('netWorthChart');
    if (!canvas || !root.isDataReady || typeof Chart === 'undefined') return;
    if (typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.computeNetWorthSeries !== 'function') return;

    const series = FinanceAnalysis.computeNetWorthSeries(DB, DB.currentPeriod, DB.payrollDay, 6);
    if (!series || !series.length) return;
    if (root._netWorthChartInstance) {
      root._netWorthChartInstance.destroy();
      root._netWorthChartInstance = null;
    }

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.24)';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const brandColor = (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim() : '') || '#10b981';

    root._netWorthChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: series.map((s) => s.period),
        datasets: [{
          label: 'Kekayaan Bersih (Net Worth)',
          data: series.map((s) => s.estimatedNetWorth),
          borderColor: brandColor,
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: brandColor,
          pointBorderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { animation: false } : {}),
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            titleColor: isDark ? '#ffffff' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            callbacks: { label: (ctx) => ' ' + formatRupiah(ctx.parsed.y).replace(',00', '') }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11, weight: '600' } } },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { size: 10 },
              callback: (val) => typeof formatShortIDR === 'function' ? formatShortIDR(val) : val
            }
          }
        }
      }
    });
  }

  Object.assign(root, { renderBudgetCharts, renderNetWorthChart });
})(typeof window !== 'undefined' ? window : globalThis);
