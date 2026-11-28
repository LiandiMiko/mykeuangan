// @depends-on: ui-state.js
/* global DB, FinanceAnalysis, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, renderSelectOptions, buildEmptyTxPlaceholder, isInPeriod, walletName, walletBalances, t, mkActionAttrs */
/* ============================================================
   FEATURES — HISTORI FILTER, FINANCIAL RATIOS, ALLOCATION & ANOMALIES
   ============================================================ */
(function (root) {
  'use strict';

  function filterHistoriView() {
    const listIn = document.getElementById('listViewIn');
    const listOut = document.getElementById('listViewOut');
    if (!listIn && !listOut) return;

    const wSelect = document.getElementById('historiWalletFilter');
    if (wSelect) {
      const prev = wSelect.value;
      const ws = DB.wallets || [];
      renderSelectOptions(
        wSelect,
        ws.map((w) => ({ value: w.id, label: w.name })),
        t('lap.all_wallets'),
        prev && ws.some((w) => String(w.id) === String(prev)) ? prev : ''
      );
    }

    const q = ((document.getElementById('historiSearch') || {}).value || '').trim().toLowerCase();
    const wFilter = (wSelect && wSelect.value) || '';
    const resetBtn = document.getElementById('historiResetFilterBtn');
    if (resetBtn) resetBtn.classList.toggle('hide', !(q || wFilter));
    const defaultWid = (DB.wallets && DB.wallets[0] && DB.wallets[0].id) || '';

    const cycleTxs = (DB.transactions || [])
      .map((item, i) => Object.assign({}, item, { _idx: i }))
      .filter((tx) => isInPeriod(tx.tanggal, DB.currentPeriod))
      .filter((tx) => {
        if (tx.kategori.startsWith('Utang') || tx.kategori.startsWith('Piutang')) return false;
        if (wFilter && String(tx.walletId || defaultWid) !== String(wFilter)) return false;
        if (!q) return true;
        return String(tx.kategori || '').toLowerCase().includes(q) ||
          String(tx.keterangan || '').toLowerCase().includes(q) ||
          String(tx.tanggal || '').toLowerCase().includes(q);
      })
      .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || (b._idx - a._idx));

    const buildRow = (tx, colClass, iconCol, iconBG) => {
      const catHtml = escapeHtmlJS(tx.kategori);
      const idAttr = escapeAttrJS(tx.id);
      return `
        <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 mb-2 hover:border-slate-300 dark:hover:border-slate-600 transition-colors group">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconCol} ${iconBG}">
              <i class="ph ph-receipt text-lg" aria-hidden="true"></i>
            </div>
            <div class="truncate">
              <p class="text-sm font-bold text-slate-800 dark:text-white truncate">${catHtml}</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtmlJS(String(tx.tanggal).substring(5))} · ${escapeHtmlJS(tx.keterangan || '-')} · ${escapeHtmlJS(walletName(tx.walletId))}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 ml-2">
            <p class="${colClass} font-bold text-sm tabular-nums">${formatRupiah(tx.nominal).replace(',00', '')}</p>
            <div class="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
              <button type="button" ${mkActionAttrs('editTransaction', [tx.id])} aria-label="Edit transaksi ${catHtml}" title="Edit" class="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-500/30">
                <i class="ph ph-pencil text-base" aria-hidden="true"></i>
              </button>
              <button type="button" ${mkActionAttrs('deleteTransaction', [tx.id])} aria-label="Hapus transaksi ${catHtml}" title="Hapus" class="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 flex items-center justify-center hover:bg-rose-200 dark:hover:bg-rose-500/30">
                <i class="ph ph-trash text-base" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>`;
    };

    const emptyFor = (tipe) => (typeof buildEmptyTxPlaceholder === 'function' && !q && !wFilter)
      ? buildEmptyTxPlaceholder(tipe)
      : `<p class="text-center text-xs text-slate-500 dark:text-slate-400 p-4">${escapeHtmlJS(t('dash.kosong'))}</p>`;

    if (listIn) {
      const inRows = cycleTxs.filter((tx) => tx.tipe === 'Pemasukan');
      renderHtml(listIn, inRows.map((tx) => buildRow(tx, 'text-emerald-700 dark:text-emerald-400', 'text-emerald-700 dark:text-emerald-400', 'bg-emerald-50 dark:bg-emerald-500/10')).join('') || emptyFor('Pemasukan'));
    }
    if (listOut) {
      const outRows = cycleTxs.filter((tx) => tx.tipe === 'Pengeluaran');
      renderHtml(listOut, outRows.map((tx) => buildRow(tx, 'text-rose-600 dark:text-rose-400', 'text-rose-600 dark:text-rose-400', 'bg-rose-50 dark:bg-rose-500/10')).join('') || emptyFor('Pengeluaran'));
    }
  }

  function renderFinancialRatios() {
    const panel = document.getElementById('financialRatiosPanel');
    if (!panel || !root.isDataReady) return;
    const r = FinanceAnalysis.computeFinancialHealthRatios(DB, DB.currentPeriod, DB.payrollDay);
    const badgeColor = (s) => s === 'excellent'
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
      : s === 'good' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
        : s === 'danger' ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300'
          : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300';

    renderHtml(panel, `
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">Dana Darurat (Runway)</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor(r.runwayStatus)}">${r.emergencyRunwayMonths !== null ? (r.emergencyRunwayMonths >= 6 ? 'Aman 6+ bln' : r.emergencyRunwayMonths >= 3 ? 'Cukup' : 'Perlu ditambah') : 'Info'}</span>
        </div>
        <p class="text-2xl font-black text-slate-900 dark:text-white">${r.emergencyRunwayMonths !== null ? (r.emergencyRunwayMonths + ' bln') : '—'}</p>
        <p class="text-[11px] text-slate-400 mt-1">Kas likuid ${formatRupiah(r.liquidCash).replace(',00', '')} / rata-rata keluar ${formatRupiah(r.avgMonthlyExpense).replace(',00', '')}</p>
      </div>
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">Savings Rate Siklus Ini</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor(r.savingsStatus)}">${r.savingsRatePct >= 20 ? 'Ideal ≥20%' : r.savingsRatePct >= 10 ? 'Baik' : 'Rendah'}</span>
        </div>
        <p class="text-2xl font-black ${r.savingsRatePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${r.savingsRatePct}%</p>
        <p class="text-[11px] text-slate-400 mt-1">Porsi pemasukan yang tersisa setelah pengeluaran</p>
      </div>
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">Rasio Utang vs Aset</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor(r.debtStatus)}">${r.debtToAssetPct === 0 ? 'Bebas Utang' : r.debtToAssetPct <= 30 ? 'Sehat ≤30%' : 'Tinggi >30%'}</span>
        </div>
        <p class="text-2xl font-black text-slate-900 dark:text-white">${r.debtToAssetPct}%</p>
        <p class="text-[11px] text-slate-400 mt-1">Utang ${formatRupiah(r.utangTotal).replace(',00', '')} dari aset kotor ${formatRupiah(r.grossAssets).replace(',00', '')}</p>
      </div>`);
  }

  function renderAssetAllocation() {
    const panel = document.getElementById('assetAllocationPanel');
    if (!panel || !root.isDataReady) return;
    if (typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.computeAssetAllocation !== 'function') return;

    const wb = typeof walletBalances === 'function' ? walletBalances() : null;
    const alloc = FinanceAnalysis.computeAssetAllocation({
      wallets: DB.wallets || [],
      assets: DB.assets || [],
      transactions: DB.transactions || [],
      transfers: DB.transfers || [],
      walletBalances: wb
    });

    if (!alloc.total || alloc.total <= 0) {
      renderHtml(panel, `<div class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm text-center"><p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Belum ada saldo dompet atau nilai aset untuk menghitung alokasi portofolio.</p></div>`);
      return;
    }

    const score = alloc.diversificationScore;
    const divLabel = score >= 3 ? 'Terdiversifikasi Baik' : score === 2 ? 'Cukup Terdiversifikasi' : 'Terkonsentrasi';
    const divBadgeClass = score >= 3
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
      : score === 2 ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
        : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300';

    const barsHtml = alloc.segments.filter((s) => s.amount > 0)
      .map((s) => `<div style="width:${Math.max(2, s.sharePct)}%;background-color:${s.color};" title="${escapeHtmlJS(s.label)}: ${s.sharePct}%" class="h-full transition-[width] duration-200"></div>`)
      .join('');
    const legendHtml = alloc.segments.map((s) => `
      <div class="rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3 min-w-0">
        <div class="flex items-center justify-between gap-1.5 mb-1">
          <span class="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color:${s.color};"></span>
            <span class="truncate">${escapeHtmlJS(s.label)}</span>
          </span>
          <span class="text-[11px] font-black tabular-nums text-slate-800 dark:text-white shrink-0">${s.sharePct}%</span>
        </div>
        <p class="text-xs font-extrabold tabular-nums text-slate-900 dark:text-white truncate">${formatRupiah(s.amount).replace(',00', '')}</p>
      </div>`).join('');

    const titleText = typeof t === 'function' ? t('aset.allocation_title') : 'Alokasi & Diversifikasi Portofolio';
    renderHtml(panel, `
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="font-bold text-sm text-slate-800 dark:text-white flex items-center gap-2">
              <i class="ph ph-chart-pie-slice text-brand dark:text-brand-ink" aria-hidden="true"></i>
              <span>${escapeHtmlJS(titleText)}</span>
            </h3>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Total portofolio bruto: <strong class="tabular-nums text-slate-700 dark:text-slate-200">${formatRupiah(alloc.total).replace(',00', '')}</strong></p>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums ${divBadgeClass}">${divLabel} (${score}/5 kelas)</span>
        </div>
        <div class="h-3.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 flex gap-0.5 mb-4" role="img" aria-label="Diagram alokasi portofolio">${barsHtml}</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">${legendHtml}</div>
      </div>`);
  }

  function renderBudgetAnomalyBanner() {
    if (!root.isDataReady || typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.detectSpendingAnomalies !== 'function') return;
    let banner = document.getElementById('budgetAnomalyBanner');
    if (!banner) {
      const insightsEl = document.getElementById('budgetInsights');
      if (!insightsEl || !insightsEl.parentNode) return;
      banner = document.createElement('div');
      banner.id = 'budgetAnomalyBanner';
      banner.className = 'mb-4';
      insightsEl.insertAdjacentElement('afterend', banner);
    }

    const info = FinanceAnalysis.detectSpendingAnomalies(DB.transactions || [], DB.recurring || [], DB.currentPeriod, DB.payrollDay);
    const isFixedHigh = info.fixedCostRatioPct > 50;
    const fixedBadgeClass = info.fixedExpenseTotal === 0
      ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300'
      : isFixedHigh ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300';
    const fixedStatusText = info.fixedExpenseTotal === 0 ? 'Belum ada tagihan rutin' : (isFixedHigh ? 'Perlu perhatian (>50%)' : 'Sehat (≤50%)');
    const fixedBasisLabel = info.fixedCostBasis === 'income' ? 'dari pemasukan siklus' : (info.fixedCostBasis === 'expense' ? 'dari pengeluaran siklus' : 'belum ada arus kas');
    const anomalyBadge = info.anomalies.length
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300">${info.anomalies.length} Lonjakan Terdeteksi</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">Pengeluaran Stabil</span>`;
    const anomalyBody = info.anomalies.length
      ? `<ul class="mt-2 space-y-1.5">${info.anomalies.map((tx) => `
          <li class="flex items-center justify-between gap-2 text-xs">
            <span class="truncate text-slate-700 dark:text-slate-200"><strong>${escapeHtmlJS(tx.kategori)}</strong>${tx.keterangan ? ' · ' + escapeHtmlJS(tx.keterangan) : ''} <span class="text-[10px] text-slate-400">(${escapeHtmlJS(tx.tanggal)})</span></span>
            <span class="shrink-0 font-bold text-rose-600 dark:text-rose-400">${formatRupiah(tx.nominal).replace(',00', '')} · ${tx.multipleOfAvg}x rata2</span>
          </li>`).join('')}</ul>`
      : `<p class="mt-2 text-xs text-slate-500 dark:text-slate-400">${info.expenseCount > 0 ? `Rata-rata transaksi keluar ${formatRupiah(info.avgExpenseTx).replace(',00', '')}. Tidak ada lonjakan ekstrem siklus ini.` : 'Belum ada transaksi pengeluaran untuk dianalisis pada siklus ini.'}</p>`;

    renderHtml(banner, `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <article class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div class="flex items-center justify-between gap-2"><h4 class="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Beban Biaya Rutin (Fixed Cost)</h4><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${fixedBadgeClass}">${fixedStatusText}</span></div>
          <div class="mt-2 flex items-baseline gap-2"><span class="text-xl font-black text-slate-900 dark:text-white">${info.fixedCostRatioPct}%</span><span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtmlJS(fixedBasisLabel)}</span></div>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Total jadwal rutin keluar aktif: <strong>${formatRupiah(info.fixedExpenseTotal).replace(',00', '')}</strong> / siklus</p>
        </article>
        <article class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div class="flex items-center justify-between gap-2"><h4 class="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Deteksi Lonjakan Pengeluaran</h4>${anomalyBadge}</div>
          ${anomalyBody}
        </article>
      </div>`);
  }

  function toggleSplitBillFields() {
    const chk = document.getElementById('tr_split_enable');
    const fields = document.getElementById('tr_split_fields');
    if (fields) fields.classList.toggle('hide', !(chk && chk.checked));
  }

  function resetHistoriFilters() {
    const s = document.getElementById('historiSearch');
    const w = document.getElementById('historiWalletFilter');
    if (s) s.value = '';
    if (w) w.value = '';
    filterHistoriView();
  }

  Object.assign(root, { filterHistoriView, resetHistoriFilters, renderFinancialRatios, renderAssetAllocation, renderBudgetAnomalyBanner, toggleSplitBillFields });
})(typeof window !== 'undefined' ? window : globalThis);
