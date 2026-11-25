/* global DB, FinanceAnalysis, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, renderHtml, renderSelectOptions, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, localToday, getSwalClass, showActionError, isInPeriod, getPeriodLabel, editTransaction, t */
/* ============================================================
   BUDGETING & ANALYSIS
   ============================================================ */
(function (root) {
  'use strict';

  const expandedBudgets = new Set();

  function normalizeBudgetCatKey(value) {
    if (typeof FinanceAnalysis !== 'undefined' && typeof FinanceAnalysis.normalizeCategoryKey === 'function') {
      return FinanceAnalysis.normalizeCategoryKey(value);
    }
    return String(value || '').trim().toLocaleLowerCase();
  }

  function isDebtBudgetTx(tx) {
    if (typeof FinanceAnalysis !== 'undefined' && typeof FinanceAnalysis.isDebtCategory === 'function') {
      return FinanceAnalysis.isDebtCategory(tx && tx.kategori);
    }
    const val = String((tx && tx.kategori) || '').trim();
    return val.startsWith('Utang') || val.startsWith('Piutang');
  }

  async function saveBudget() {
    const kategori = document.getElementById('budgetKategori').value;
    const jumlah = Math.round(parseFormattedNominal(document.getElementById('budgetJumlah').value));
    if (!kategori || !jumlah || jumlah <= 0) {
      Swal.fire({
        icon: 'warning',
        title: t('alert.invalid_data'),
        text: 'Isi kategori dan jumlah dengan benar.',
        customClass: { popup: getSwalClass() }
      });
      return;
    }
    try {
      const data = await callServer('api_saveBudget', kategori, DB.currentPeriod, jumlah);
      await refreshFromServer(data);
      document.getElementById('budgetJumlah').value = '';
      Swal.fire({ icon: 'success', title: t('alert.saved'), timer: 1000, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: t('alert.failed'), text: String(e.message || e), customClass: { popup: getSwalClass() } });
    }
  }

  function deleteBudget(id, kategori) {
    Swal.fire({
      title: t('alert.confirm_delete'),
      text: 'Budget "' + kategori + '" akan dihapus.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: t('btn.ya_hapus'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        await refreshFromServer(await callServer('api_deleteBudget', id));
      } catch (e) {
        showActionError(e);
      }
    });
  }

  async function copyBudgetFromLastMonth() {
    const parts = DB.currentPeriod.split('-');
    const prevDate = new Date(Number(parts[0]), Number(parts[1]) - 2, 1);
    const prevBulan = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

    const { isConfirmed } = await Swal.fire({
      title: t('budget.btn_copy'),
      html: '<p class="text-sm text-slate-600 dark:text-slate-300">Copy budget dari <b>' + escapeHtmlJS(getPeriodLabel(prevBulan, DB.payrollDay)) + '</b> ke bulan ini?</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!isConfirmed) return;
    try {
      await refreshFromServer(await callServer('api_copyBudget', prevBulan, DB.currentPeriod));
      Swal.fire({ icon: 'success', title: t('alert.success'), timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: t('alert.failed'), text: String(e.message || e), customClass: { popup: getSwalClass() } });
    }
  }

  async function editBudgetInline(id, kategori, currentJumlah) {
    const { value: val } = await Swal.fire({
      title: escapeHtmlJS(kategori),
      html: `<div class="text-left"><label for="swal-budget-nom" class="block text-xs font-semibold mb-1.5">Jumlah Budget (Rp)</label><input id="swal-budget-nom" type="text" inputmode="numeric" value="${escapeHtmlJS(formatNominalInputValue(currentJumlah))}" class="swal2-input tabular-nums" style="margin:0;width:100%"></div>`,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      didOpen: () => bindNominalInputs(['swal-budget-nom']),
      preConfirm: () => {
        const parsed = Math.round(parseFormattedNominal(document.getElementById('swal-budget-nom').value));
        if (isNaN(parsed) || parsed < 0) { Swal.showValidationMessage('Masukkan jumlah budget yang valid.'); return false; }
        return parsed;
      }
    });
    if (val === null || val === undefined) return;
    try { await refreshFromServer(await callServer('api_saveBudget', kategori, DB.currentPeriod, val)); }
    catch (e) { showActionError(e); }
  }

  function toggleBudgetExpand(id) {
    if (expandedBudgets.has(id)) expandedBudgets.delete(id);
    else expandedBudgets.add(id);
    renderBudgeting();
  }

  function renderBudgetForecastCard(period) {
    const el = document.getElementById('budgetForecastCard');
    if (!el || typeof FinanceAnalysis.computeCycleForecast !== 'function') return;
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const fc = FinanceAnalysis.computeCycleForecast(DB.transactions, DB.budgets, period, DB.payrollDay, todayStr);
    const BADGES = {
      over: { label: 'Berisiko Overbudget', cls: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300' },
      warning: { label: 'Mendekati Batas', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
      safe: { label: 'Jalur Aman', cls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' },
      completed: { label: 'Siklus Selesai', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
      upcoming: { label: 'Belum Dimulai', cls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' },
      active: { label: 'Siklus Aktif', cls: 'bg-brand/10 text-brand dark:text-brand-ink' }
    };
    const badge = BADGES[fc.status] || BADGES.active;
    const fmt = (v) => formatRupiah(v).replace(',00', '');
    renderHtml(el, `
      <div class="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Burn Rate &amp; Proyeksi Akhir Siklus</h4>
            <p class="text-[11px] text-slate-400 mt-0.5">Hari ke-${fc.elapsedDays} dari ${fc.totalDays} · ${fc.remainingDays} hari tersisa</p>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.cls}">${badge.label}</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
            <p class="text-[10px] font-bold uppercase text-slate-400">Burn Rate Harian</p>
            <p class="text-sm sm:text-base font-black text-slate-800 dark:text-white mt-0.5 tabular-nums">${fmt(fc.dailyBurnRate)}/hr</p>
          </div>
          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
            <p class="text-[10px] font-bold uppercase text-slate-400">Proyeksi Keluar</p>
            <p class="text-sm sm:text-base font-black ${fc.status === 'over' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'} mt-0.5 tabular-nums">${fmt(fc.projectedExpense)}</p>
          </div>
          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
            <p class="text-[10px] font-bold uppercase text-slate-400">Batas Aman Harian</p>
            <p class="text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">${fc.dailySafeAllowance !== null ? fmt(fc.dailySafeAllowance) + '/hr' : '—'}</p>
          </div>
          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
            <p class="text-[10px] font-bold uppercase text-slate-400">Estimasi Sisa Budget</p>
            <p class="text-sm sm:text-base font-black ${fc.projectedVariance !== null && fc.projectedVariance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'} mt-0.5 tabular-nums">${fc.projectedVariance !== null ? (fc.projectedVariance >= 0 ? '+' : '-') + fmt(Math.abs(fc.projectedVariance)) : '—'}</p>
          </div>
        </div>
      </div>`);
  }

  function renderBudgetAnalysis(period) {
    renderBudgetForecastCard(period);
    const insights = FinanceAnalysis.periodInsights(DB.budgets, DB.transactions, period, DB.payrollDay);
    const analysis = insights.period;
    const summary = document.getElementById('budgetSummary');
    const insightContainer = document.getElementById('budgetInsights');
    const differenceClass = (amount) => amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';

    if (insightContainer) {
      let comparisonText = t('budget.previous_no_data');
      let comparisonTone = 'text-slate-600 dark:text-slate-300';
      if (insights.spendingChangePercent !== null) {
        const direction = insights.spendingChange > 0 ? 'up' : (insights.spendingChange < 0 ? 'down' : 'same');
        comparisonText = `${t('budget.spending_' + direction)} · ${Math.abs(insights.spendingChangePercent).toFixed(0)}%`;
        comparisonTone = insights.spendingChange > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';
      }
      const overBudgetRows = insights.overBudget.slice(0, 3);
      renderHtml(insightContainer, `
        <article class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h4 class="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('budget.insight_title'))}</h4>
          <p class="mt-2 text-sm font-semibold ${comparisonTone}">${escapeHtmlJS(comparisonText)}</p>
          ${insights.spendingChangePercent !== null
            ? `<p class="mt-1 text-xs text-slate-500">${formatRupiah(Math.abs(insights.spendingChange)).replace(',00', '')} · ${escapeHtmlJS(t('budget.previous_period'))} ${escapeHtmlJS(getPeriodLabel(insights.previousPeriod.period, DB.payrollDay))}</p>`
            : ''}
        </article>
        <article class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h4 class="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('budget.highest_category'))}</h4>
          ${insights.highestSpending
            ? `<p class="mt-2 text-sm font-semibold text-slate-800 dark:text-white">${escapeHtmlJS(insights.highestSpending.category)}</p><p class="mt-1 text-xs text-slate-500">${formatRupiah(insights.highestSpending.actual).replace(',00', '')}</p>`
            : `<p class="mt-2 text-sm text-slate-500">${escapeHtmlJS(t('budget.no_activity'))}</p>`}
        </article>
        <article class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h4 class="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('budget.over_budget'))}</h4>
          ${overBudgetRows.length
            ? `<ul class="mt-2 space-y-1">${overBudgetRows.map((row) => `<li class="flex justify-between gap-2 text-xs"><span class="truncate text-slate-700 dark:text-slate-200">${escapeHtmlJS(row.category)}</span><strong class="shrink-0 tabular-nums text-rose-600 dark:text-rose-400">+${formatRupiah(row.actual - row.plan).replace(',00', '')}</strong></li>`).join('')}</ul>`
            : `<p class="mt-2 text-sm text-slate-600 dark:text-slate-300">${escapeHtmlJS(t('budget.no_over_budget'))}</p>`}
        </article>`);
    }

    if (summary) {
      renderHtml(summary, `
        <div class="grid grid-cols-3 gap-3 p-4 bg-slate-50 dark:bg-slate-800/50">
          <div class="min-w-0">
            <p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">${escapeHtmlJS(t('budget.plan'))}</p>
            <p class="text-sm sm:text-lg font-black tabular-nums text-slate-800 dark:text-white truncate">${formatRupiah(analysis.budgetTotal).replace(',00', '')}</p>
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">${escapeHtmlJS(t('budget.actual'))}</p>
            <p class="text-sm sm:text-lg font-black tabular-nums text-slate-800 dark:text-white truncate">${formatRupiah(analysis.actualTotal).replace(',00', '')}</p>
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">${escapeHtmlJS(t('budget.selisih'))}</p>
            <p class="text-sm sm:text-lg font-black tabular-nums ${differenceClass(analysis.remaining)} truncate">${analysis.remaining >= 0 ? '+' : ''}${formatRupiah(analysis.remaining).replace(',00', '')}</p>
          </div>
        </div>`);
    }
  }

  function getBudgetStatusInfo(pct) {
    if (pct > 100) {
      return { text: t('budget.over'), icon: 'warning-circle', iconWrapClass: 'bg-rose-50 dark:bg-rose-500/10 text-rose-500', textClass: 'text-rose-600 dark:text-rose-400', progressClass: 'bg-rose-500' };
    }
    if (pct >= 80) {
      return { text: t('budget.warning'), icon: 'warning', iconWrapClass: 'bg-amber-50 dark:bg-amber-500/10 text-amber-500', textClass: 'text-amber-600 dark:text-amber-400', progressClass: 'bg-amber-500' };
    }
    return { text: t('budget.aman'), icon: 'check-circle', iconWrapClass: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400', progressClass: 'bg-emerald-500' };
  }

  function buildBudgetTxListHtml(catTxns, showCategoryBadge) {
    if (catTxns.length === 0) {
      return `
        <div class="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 text-center">
          <p class="text-[11px] text-slate-400 italic">Belum ada transaksi kategori ini di siklus ini</p>
        </div>`;
    }
    return `
      <div class="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
        <p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">${catTxns.length} Transaksi</p>
        ${catTxns.map((tx) => `
          <div class="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-white dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <div class="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></div>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">${showCategoryBadge ? `<span class="inline-block mr-1.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold text-[10px]">${escapeHtmlJS(tx.kategori || 'Lainnya')}</span>` : ''}${escapeHtmlJS(tx.keterangan || '(tanpa catatan)')}</p>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">${escapeHtmlJS(String(tx.tanggal).substring(5))}</p>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <p class="text-[11px] font-black tabular-nums text-rose-600 dark:text-rose-400">−${formatRupiah(tx.nominal).replace(',00', '')}</p>
              <button type="button" data-budget-transaction="${escapeHtmlJS(tx.id)}" class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center hover:bg-blue-100" aria-label="Edit transaksi" title="Edit">
                <i class="ph ph-pencil text-xs" aria-hidden="true"></i>
              </button>
            </div>
          </div>`).join('')}
      </div>`;
  }

  function buildBudgetItemHtml(b, actualByCat, txs) {
    const plan = Number(b.jumlah) || 0;
    const catKey = normalizeBudgetCatKey(b.kategori);
    const actual = actualByCat[catKey] || 0;
    const selisih = plan - actual;
    const pct = plan > 0 ? (actual / plan * 100) : 0;
    const status = getBudgetStatusInfo(pct);
    const selisihColor = selisih >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const isExpanded = expandedBudgets.has(b.id);
    const catTxns = txs
      .filter((tx) => tx.tipe === 'Pengeluaran' && !isDebtBudgetTx(tx) && normalizeBudgetCatKey(tx.kategori) === catKey)
      .sort((a, bTx) => String(bTx.tanggal).localeCompare(String(a.tanggal)));
    const txnListHtml = isExpanded ? buildBudgetTxListHtml(catTxns, false) : '';

    return `
      <div class="transition-colors ${isExpanded ? 'bg-slate-50 dark:bg-slate-800/20' : ''}">
        <div class="p-4 sm:p-5 transition-colors group">
          <div class="flex items-start justify-between gap-3 mb-3">
            <button type="button" data-budget-expand="${escapeHtmlJS(b.id)}" aria-expanded="${isExpanded}" class="flex items-center gap-3 min-w-0 flex-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/30">
              <span class="w-10 h-10 rounded-xl ${status.iconWrapClass} flex items-center justify-center shrink-0 relative">
                <i class="ph ph-${status.icon} text-lg" aria-hidden="true"></i>
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="font-bold text-slate-800 dark:text-white text-sm truncate">${escapeHtmlJS(b.kategori)}</span>
                  <i class="ph ph-caret-${isExpanded ? 'up' : 'down'} text-xs text-slate-500" aria-hidden="true"></i>
                </span>
                <span class="block text-[11px] ${status.textClass} font-bold uppercase tracking-wider tabular-nums">
                  ${escapeHtmlJS(status.text)} · ${pct.toFixed(0)}% · ${catTxns.length} transaksi
                </span>
              </span>
            </button>
            <div class="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
              <button type="button" data-budget-action="edit" data-budget-id="${escapeHtmlJS(b.id)}" class="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center hover:bg-blue-100" aria-label="Edit budget ${escapeHtmlJS(b.kategori)}" title="Edit">
                <i class="ph ph-pencil text-sm" aria-hidden="true"></i>
              </button>
              <button type="button" data-budget-action="delete" data-budget-id="${escapeHtmlJS(b.id)}" class="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center hover:bg-rose-100" aria-label="Hapus budget ${escapeHtmlJS(b.kategori)}" title="Hapus">
                <i class="ph ph-trash text-sm" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 mb-3 text-xs">
            <div class="min-w-0"><p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">${escapeHtmlJS(t('budget.plan'))}</p><p class="font-black tabular-nums text-slate-800 dark:text-white truncate">${formatRupiah(plan).replace(',00', '')}</p></div>
            <div class="min-w-0"><p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">${escapeHtmlJS(t('budget.actual'))}</p><p class="font-black tabular-nums text-slate-800 dark:text-white truncate">${formatRupiah(actual).replace(',00', '')}</p></div>
            <div class="min-w-0"><p class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">${escapeHtmlJS(t('budget.selisih'))}</p><p class="font-black tabular-nums ${selisihColor} truncate">${selisih >= 0 ? '+' : ''}${formatRupiah(selisih).replace(',00', '')}</p></div>
          </div>
          <div class="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-label="Progres budget ${escapeHtmlJS(b.kategori)}" aria-valuenow="${Math.min(pct, 100).toFixed(0)}" aria-valuemin="0" aria-valuemax="100">
            <div class="${status.progressClass} h-full rounded-full transition-[width] duration-200" style="width: ${Math.min(pct, 100).toFixed(1)}%"></div>
          </div>
        </div>
        ${isExpanded ? `<div class="px-4 sm:px-5 pb-4 sm:pb-5">${txnListHtml}</div>` : ''}
      </div>`;
  }

  function buildUnbudgetedCategoryChips(unbudgetedTxs) {
    const byCat = new Map();
    unbudgetedTxs.forEach((tx) => {
      const label = String((tx && tx.kategori) || '').trim() || 'Lainnya';
      const key = normalizeBudgetCatKey(label) || 'lainnya';
      const entry = byCat.get(key) || { label, total: 0 };
      entry.total += Number(tx.nominal) || 0;
      byCat.set(key, entry);
    });
    return Array.from(byCat.values())
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
      .map((item) => {
        const suggested = Math.max(10000, Math.ceil(item.total / 10000) * 10000);
        return `<button type="button" data-unbudgeted-create-cat="${escapeHtmlJS(item.label)}" data-unbudgeted-suggested="${suggested}" class="min-h-8 px-2.5 py-1 rounded-xl bg-brand/10 text-brand dark:text-brand-ink hover:bg-brand hover:text-white text-[11px] font-bold transition-colors">+ Budget ${escapeHtmlJS(item.label)}</button>`;
      }).join('');
  }

  function buildUnbudgetedSectionHtml(unbudgetedTxs) {
    if (!unbudgetedTxs.length) return '';
    const total = unbudgetedTxs.reduce((sum, tx) => sum + (Number(tx.nominal) || 0), 0);
    const isExpanded = expandedBudgets.has('__unbudgeted__');
    const catsCount = new Set(unbudgetedTxs.map((tx) => normalizeBudgetCatKey(tx.kategori))).size;
    const chipHtml = isExpanded
      ? `<div class="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-1.5">${buildUnbudgetedCategoryChips(unbudgetedTxs)}</div>`
      : '';
    return `
      <div class="transition-colors ${isExpanded ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}">
        <div class="p-4 sm:p-5">
          <button type="button" data-budget-expand="__unbudgeted__" aria-expanded="${isExpanded}" class="w-full flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-xl p-1 -m-1 transition-colors">
            <span class="flex items-center gap-3 min-w-0 flex-1">
              <span class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <i class="ph ph-tray text-lg" aria-hidden="true"></i>
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="font-bold text-slate-800 dark:text-white text-sm truncate">Pengeluaran di Luar Budget</span>
                  <i class="ph ph-caret-${isExpanded ? 'up' : 'down'} text-xs text-slate-500" aria-hidden="true"></i>
                </span>
                <span class="block text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider tabular-nums">
                  ${unbudgetedTxs.length} transaksi · ${catsCount} kategori · Klik untuk periksa
                </span>
              </span>
            </span>
            <span class="text-sm font-black tabular-nums text-slate-800 dark:text-white shrink-0">${formatRupiah(total).replace(',00', '')}</span>
          </button>
        </div>
        ${isExpanded ? `<div class="px-4 sm:px-5 pb-4 sm:pb-5">${chipHtml}${buildBudgetTxListHtml(unbudgetedTxs, true)}</div>` : ''}
      </div>`;
  }

  function bindBudgetListEvents(container, budgets) {
    const budgetsById = new Map((budgets || []).map((budget) => [budget.id, budget]));
    container.querySelectorAll('[data-budget-expand]').forEach((button) => {
      button.addEventListener('click', () => toggleBudgetExpand(button.dataset.budgetExpand));
    });
    container.querySelectorAll('[data-budget-transaction]').forEach((button) => {
      button.addEventListener('click', () => editTransaction(button.dataset.budgetTransaction));
    });
    container.querySelectorAll('[data-unbudgeted-create-cat]').forEach((button) => {
      button.addEventListener('click', () => editBudgetInline('', button.dataset.unbudgetedCreateCat, Number(button.dataset.unbudgetedSuggested) || 0));
    });
    container.querySelectorAll('[data-budget-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const budget = budgetsById.get(button.dataset.budgetId);
        if (!budget) return;
        if (button.dataset.budgetAction === 'edit') editBudgetInline(budget.id, budget.kategori, Number(budget.jumlah) || 0);
        else if (button.dataset.budgetAction === 'delete') deleteBudget(budget.id, budget.kategori);
      });
    });
  }

  function renderBudgeting() {
    const container = document.getElementById('budgetList');
    const formKategori = document.getElementById('budgetKategori');
    const monthLabel = document.getElementById('budgetMonthLabel');
    if (!container) return;

    const period = DB.currentPeriod;
    if (monthLabel) monthLabel.innerText = '(' + getPeriodLabel(period, DB.payrollDay) + ')';
    renderBudgetAnalysis(period);

    if (formKategori) {
      const currentKey = normalizeBudgetCatKey(formKategori.value);
      const pengeluaran = DB.categories.pengeluaran || [];
      const matchedVal = pengeluaran.find((c) => normalizeBudgetCatKey(c) === currentKey) || '';
      renderSelectOptions(formKategori, pengeluaran, '— ' + t('budget.kategori') + ' —', matchedVal);
    }

    const budgets = (DB.budgets || []).filter((b) => String(b.bulan).slice(0, 7) === period);
    const txs = (DB.transactions || []).filter((tx) => isInPeriod(tx.tanggal, period));
    const actualByCat = {};
    txs.forEach((tx) => {
      if (tx.tipe !== 'Pengeluaran' || isDebtBudgetTx(tx)) return;
      const key = normalizeBudgetCatKey(tx.kategori);
      actualByCat[key] = (actualByCat[key] || 0) + (Number(tx.nominal) || 0);
    });

    const budgetedKeys = new Set(budgets.map((b) => normalizeBudgetCatKey(b.kategori)).filter(Boolean));
    const unbudgetedTxs = txs
      .filter((tx) => tx.tipe === 'Pengeluaran' && !isDebtBudgetTx(tx) && !budgetedKeys.has(normalizeBudgetCatKey(tx.kategori)))
      .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));
    const unbudgetedHtml = buildUnbudgetedSectionHtml(unbudgetedTxs);

    if (budgets.length === 0) {
      const emptyHtml = `
        <div class="p-8 text-center">
          <i class="ph ph-piggy-bank text-5xl text-slate-300 dark:text-slate-600 mb-3"></i>
          <p class="text-sm text-slate-500">${escapeHtmlJS(t('budget.empty'))}</p>
        </div>`;
      renderHtml(container, unbudgetedHtml ? `<div class="divide-y divide-slate-100 dark:divide-slate-800">${emptyHtml}${unbudgetedHtml}</div>` : emptyHtml);
      bindBudgetListEvents(container, budgets);
      return;
    }

    budgets.sort((a, b) => String(a.kategori).localeCompare(String(b.kategori)));
    renderHtml(container, '<div class="divide-y divide-slate-100 dark:divide-slate-800">' +
      budgets.map((b) => buildBudgetItemHtml(b, actualByCat, txs)).join('') + unbudgetedHtml + '</div>');
    bindBudgetListEvents(container, budgets);
  }

  Object.assign(root, { saveBudget, deleteBudget, copyBudgetFromLastMonth, editBudgetInline, toggleBudgetExpand, renderBudgetAnalysis, renderBudgeting });
})(typeof window !== 'undefined' ? window : globalThis);
