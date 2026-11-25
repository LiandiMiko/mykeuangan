/* global DB, FinancePro, FinanceAnalysis, Swal, callServer, refreshFromServer, formatRupiah, formatShortIDR, escapeHtmlJS, renderHtml, showActionError, t */
/* ============================================================
   PRO FEATURES — BULK REPORT ACTIONS, ANNUAL RECAP & COMPARISON
   ============================================================ */
(function (root) {
  'use strict';

  function getCheckedReportIds() {
    const mobileOnly = document.getElementById('list-laporan-mobile');
    const isMobileVisible = mobileOnly && window.getComputedStyle(mobileOnly).display !== 'none';
    const selector = isMobileVisible ? '.lap-row-check-mobile:checked' : '.lap-row-check:checked';
    const checked = Array.from(document.querySelectorAll(selector)).map((el) => el.value);
    if (checked.length) return checked;
    return Array.from(new Set(
      Array.from(document.querySelectorAll('.lap-row-check:checked, .lap-row-check-mobile:checked')).map((el) => el.value)
    ));
  }

  function syncReportRowCheck(id, checked) {
    const val = String(id || '');
    const flag = Boolean(checked);
    document.querySelectorAll('.lap-row-check, .lap-row-check-mobile').forEach((el) => {
      if (String(el.value) === val) el.checked = flag;
    });
    updateReportBulkBar();
  }

  function toggleSelectAllReport(checked) {
    const flag = Boolean(checked);
    const allTop = document.getElementById('lapSelectAll');
    const allMob = document.getElementById('lapSelectAllMobile');
    if (allTop) allTop.checked = flag;
    if (allMob) allMob.checked = flag;
    document.querySelectorAll('.lap-row-check, .lap-row-check-mobile').forEach((el) => { el.checked = flag; });
    updateReportBulkBar();
  }

  function updateReportBulkBar() {
    const bar = document.getElementById('lapBulkBar');
    const countEl = document.getElementById('lapBulkCount');
    if (!bar || !countEl) return;
    const count = getCheckedReportIds().length;
    countEl.textContent = String(count);
    bar.classList.toggle('hide', count === 0);
    bar.classList.toggle('mk-bulk-enter', count > 0);
  }

  async function finalizeBulkMutation(payload, okCount, failedCount, verb) {
    const pro = root.__mkPro || {};
    try {
      if (okCount > 0) await refreshFromServer(payload);
      Swal.fire(pro.swalOpt({
        icon: failedCount > 0 ? 'warning' : 'success',
        title: failedCount > 0
          ? `${okCount} ${verb}, ${failedCount} gagal`
          : `${okCount} transaksi ${verb}`,
        timer: failedCount > 0 ? 2200 : 1300,
        showConfirmButton: failedCount > 0
      }));
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  async function runBulkTransactionUpdate(buildPatch) {
    const pro = root.__mkPro || {};
    const ids = getCheckedReportIds();
    if (!ids.length) return;
    const txMap = new Map((DB.transactions || []).map((tx) => [String(tx.id), tx]));
    Swal.fire(pro.swalOpt({ title: 'Memperbarui transaksi...', allowOutsideClick: false, didOpen: () => Swal.showLoading() }));
    const addedTransactions = [];
    let latestPeriod = '';
    let failedCount = 0;

    for (const id of ids) {
      const orig = txMap.get(String(id));
      if (!orig) continue;
      const nextPayload = Object.assign({
        tanggal: orig.tanggal,
        tipe: orig.tipe,
        kategori: orig.kategori,
        nominal: orig.nominal,
        keterangan: orig.keterangan || '',
        walletId: orig.walletId || ''
      }, buildPatch(orig));
      try {
        const res = await callServer('api_updateTransaction', id, nextPayload);
        if (res && res.transaction) addedTransactions.push(res.transaction);
        if (res && res.currentPeriod && (!latestPeriod || res.currentPeriod > latestPeriod)) {
          latestPeriod = res.currentPeriod;
        }
      } catch (_) {
        failedCount += 1;
      }
    }

    await finalizeBulkMutation(
      { addedTransactions, ...(latestPeriod ? { currentPeriod: latestPeriod } : {}) },
      addedTransactions.length,
      failedCount,
      'diperbarui'
    );
  }

  async function bulkEditReportCategory() {
    const pro = root.__mkPro || {};
    const ids = getCheckedReportIds();
    if (!ids.length) return;
    const cats = Array.from(new Set([...(DB.categories?.pengeluaran || []), ...(DB.categories?.pemasukan || [])]));
    const inputOptions = {};
    cats.forEach((c) => { inputOptions[c] = c; });
    const res = await Swal.fire(pro.swalOpt({
      title: `Ubah kategori (${ids.length} transaksi)`,
      input: 'select',
      inputOptions,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal')
    }));
    if (res.isConfirmed && res.value) {
      await runBulkTransactionUpdate(() => ({ kategori: res.value }));
    }
  }

  async function bulkEditReportWallet() {
    const pro = root.__mkPro || {};
    const ids = getCheckedReportIds();
    if (!ids.length) return;
    const inputOptions = {};
    (DB.wallets || []).forEach((w) => { inputOptions[w.id] = w.name; });
    const res = await Swal.fire(pro.swalOpt({
      title: `Pindah dompet (${ids.length} transaksi)`,
      input: 'select',
      inputOptions,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal')
    }));
    if (res.isConfirmed && res.value) {
      await runBulkTransactionUpdate(() => ({ walletId: res.value }));
    }
  }

  async function bulkDeleteReportRows() {
    const pro = root.__mkPro || {};
    const ids = getCheckedReportIds();
    if (!ids.length) return;
    const conf = await Swal.fire(pro.swalOpt({
      icon: 'warning',
      title: `Hapus ${ids.length} transaksi?`,
      text: 'Data yang dihapus tidak bisa dikembalikan.',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: t('btn.ya_hapus'),
      cancelButtonText: t('btn.batal')
    }));
    if (!conf.isConfirmed) return;
    Swal.fire(pro.swalOpt({ title: 'Menghapus transaksi...', allowOutsideClick: false, didOpen: () => Swal.showLoading() }));
    const deletedTransactionIds = [];
    let failedCount = 0;

    for (const id of ids) {
      try {
        const res = await callServer('api_deleteTransaction', id);
        deletedTransactionIds.push((res && res.deletedTransactionId) || id);
      } catch (_) {
        failedCount += 1;
      }
    }

    await finalizeBulkMutation({ deletedTransactionIds }, deletedTransactionIds.length, failedCount, 'dihapus');
  }

  function renderAnnualRecapBody(year) {
    const box = document.getElementById('annualRecapBody');
    if (!box || typeof FinancePro === 'undefined') return;
    const recap = FinancePro.computeAnnualRecap(DB.transactions || [], DB.budgets || [], year, DB.payrollDay, FinanceAnalysis);
    const fmt = (n) => formatRupiah(n).replace(',00', '');
    const monthRows = recap.months.map((m) => `
      <tr class="border-b border-slate-100 dark:border-slate-800 text-xs">
        <td class="py-1.5 font-semibold">${escapeHtmlJS(m.period)}</td>
        <td class="py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">+${escapeHtmlJS(formatShortIDR(m.income))}</td>
        <td class="py-1.5 text-right tabular-nums text-rose-600 dark:text-rose-400">-${escapeHtmlJS(formatShortIDR(m.expense))}</td>
        <td class="py-1.5 text-right tabular-nums font-bold">${m.net >= 0 ? '+' : '-'}${escapeHtmlJS(formatShortIDR(Math.abs(m.net)))}</td>
      </tr>
    `).join('');
    renderHtml(box, `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs mb-3">
        <div class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10"><p class="text-[11px] text-slate-600 dark:text-slate-400">Masuk ${escapeHtmlJS(recap.year)}</p><p class="font-black tabular-nums text-emerald-700 dark:text-emerald-400">${escapeHtmlJS(fmt(recap.totalIncome))}</p></div>
        <div class="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10"><p class="text-[11px] text-slate-600 dark:text-slate-400">Keluar ${escapeHtmlJS(recap.year)}</p><p class="font-black tabular-nums text-rose-600 dark:text-rose-400">${escapeHtmlJS(fmt(recap.totalExpense))}</p></div>
        <div class="p-3 rounded-xl bg-brand/10"><p class="text-[11px] text-slate-600 dark:text-slate-400">Tabungan Bersih</p><p class="font-black tabular-nums text-brand dark:text-brand-ink">${escapeHtmlJS(fmt(recap.netSavings))}</p></div>
        <div class="p-3 rounded-xl bg-slate-100 dark:bg-slate-800"><p class="text-[11px] text-slate-600 dark:text-slate-400">Savings Rate</p><p class="font-black tabular-nums">${recap.savingsRatePct}%</p></div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
          <p class="font-bold mb-2">Rekap 12 Siklus</p>
          <div class="max-h-52 overflow-y-auto"><table class="w-full"><tbody>${monthRows}</tbody></table></div>
        </div>
        <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
          <p class="font-bold">Top Pengeluaran ${escapeHtmlJS(recap.year)}</p>
          ${recap.topCategories.map((c) => `<div class="flex justify-between gap-2"><span>${escapeHtmlJS(c.category)}</span><strong class="tabular-nums">${escapeHtmlJS(fmt(c.amount))} (${c.sharePct}%)</strong></div>`).join('') || '<p class="text-slate-500">Belum ada pengeluaran.</p>'}
          ${recap.bestSavingMonth ? `<p class="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] flex items-center gap-1.5"><i class="ph-bold ph-trophy text-amber-500" aria-hidden="true"></i><span>Paling hemat: <strong class="tabular-nums">${escapeHtmlJS(recap.bestSavingMonth.period)}</strong></span></p>` : ''}
        </div>
      </div>
    `);
  }

  function renderPeriodCompareBody() {
    const pA = (document.getElementById('cmpPeriodA') || {}).value;
    const pB = (document.getElementById('cmpPeriodB') || {}).value;
    const box = document.getElementById('annualRecapBody');
    if (!box || !pA || !pB || typeof FinancePro === 'undefined') return;
    const cmp = FinancePro.compareTwoPeriods(DB.transactions || [], DB.budgets || [], pA, pB, DB.payrollDay, FinanceAnalysis);
    const fmt = (n) => formatRupiah(n).replace(',00', '');
    renderHtml(box, `
      <div class="grid grid-cols-3 gap-2 text-xs mb-3">
        <div class="p-3 rounded-xl bg-slate-100 dark:bg-slate-800"><p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtmlJS(pA)} Keluar</p><p class="font-black tabular-nums">${escapeHtmlJS(fmt(cmp.expenseA))}</p></div>
        <div class="p-3 rounded-xl bg-slate-100 dark:bg-slate-800"><p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtmlJS(pB)} Keluar</p><p class="font-black tabular-nums">${escapeHtmlJS(fmt(cmp.expenseB))}</p></div>
        <div class="p-3 rounded-xl bg-brand/10"><p class="text-[11px] text-slate-600 dark:text-slate-400">Selisih Keluar</p><p class="font-black tabular-nums">${cmp.expenseB - cmp.expenseA >= 0 ? '+' : '-'}${escapeHtmlJS(fmt(Math.abs(cmp.expenseB - cmp.expenseA)))}</p></div>
      </div>
      <div class="max-h-56 overflow-y-auto space-y-1.5 text-xs">
        ${cmp.categories.map((r) => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
            <span class="font-semibold truncate">${escapeHtmlJS(r.category)}</span>
            <span class="shrink-0 tabular-nums">${escapeHtmlJS(formatShortIDR(r.amountA))} → <strong>${escapeHtmlJS(formatShortIDR(r.amountB))}</strong> <span class="${r.delta > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}">(${r.delta >= 0 ? '+' : ''}${escapeHtmlJS(formatShortIDR(r.delta))})</span></span>
          </div>`).join('') || '<p class="text-slate-500">Tidak ada transaksi untuk dibandingkan.</p>'}
      </div>
    `);
  }

  async function openAnnualRecapModal() {
    const pro = root.__mkPro || {};
    const curPeriod = DB.currentPeriod || new Date().toISOString().slice(0, 7);
    const curYear = curPeriod.slice(0, 4);
    const prevPeriod = typeof FinanceAnalysis !== 'undefined' ? FinanceAnalysis.shiftPeriod(curPeriod, -1) : curPeriod;
    const years = Array.from(new Set([curYear, ...(DB.transactions || []).map((tx) => String(tx.tanggal || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y))])).sort().reverse();

    await Swal.fire(pro.swalOpt({
      title: 'Rekap Tahunan & Perbandingan',
      width: 680,
      html: `
        <div class="text-left space-y-3">
          <div class="flex flex-wrap items-center gap-2 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs">
            <select id="recapYearSel" aria-label="Pilih Tahun Rekap" class="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-brand" onchange="renderAnnualRecapBody(this.value)">
              ${years.map((y) => `<option value="${escapeHtmlJS(y)}" ${y === curYear ? 'selected' : ''}>Tahun ${escapeHtmlJS(y)}</option>`).join('')}
            </select>
            <span class="text-slate-500 dark:text-slate-400 font-medium px-1">atau bandingkan:</span>
            <input id="cmpPeriodA" aria-label="Periode pertama" type="month" value="${escapeHtmlJS(prevPeriod)}" class="h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-brand">
            <span class="text-slate-500 dark:text-slate-400 font-semibold">vs</span>
            <input id="cmpPeriodB" aria-label="Periode kedua" type="month" value="${escapeHtmlJS(curPeriod)}" class="h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:border-brand">
            <button type="button" onclick="renderPeriodCompareBody()" class="h-9 px-3.5 rounded-xl bg-brand text-white font-bold hover:opacity-95 transition-opacity">Bandingkan</button>
          </div>
          <div id="annualRecapBody"></div>
        </div>
      `,
      confirmButtonText: t('btn.tutup'),
      didOpen: () => renderAnnualRecapBody(curYear)
    }));
  }

  Object.assign(root, {
    syncReportRowCheck,
    toggleSelectAllReport,
    updateReportBulkBar,
    bulkEditReportCategory,
    bulkEditReportWallet,
    bulkDeleteReportRows,
    renderAnnualRecapBody,
    renderPeriodCompareBody,
    openAnnualRecapModal
  });
})(typeof window !== 'undefined' ? window : globalThis);
