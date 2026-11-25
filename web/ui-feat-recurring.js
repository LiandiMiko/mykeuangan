/* global DB, FinanceAnalysis, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, renderHtml, getSwalClass, showActionError, localToday, walletOptions, t */
/* ============================================================
   FEATURES — DUE RECURRING BILLS BANNER & BATCH RECORD
   ============================================================ */
(function (root) {
  'use strict';

  const AUTO_POST_KEY = 'mk_auto_post_recurring';
  const AUTO_POST_DATE_KEY = 'mk_auto_post_last_date';

  function renderCashflowRunwayStrip() {
    const strip = document.getElementById('cashflowRunwayStrip');
    if (!strip || !root.isDataReady || typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.computeCashflowRunway !== 'function') {
      if (strip) { strip.classList.add('hide'); strip.textContent = ''; }
      return;
    }
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const rw = FinanceAnalysis.computeCashflowRunway(DB, DB.currentPeriod, DB.payrollDay, todayStr);
    const toneCls = rw.status === 'deficit'
      ? 'border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
      : (rw.status === 'caution'
        ? 'border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
        : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 mk-card-surface');
    const fmt = (n) => formatRupiah(n).replace(',00', '');
    strip.classList.remove('hide');
    renderHtml(strip, `
      <div class="rounded-2xl sm:rounded-3xl border ${toneCls} px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-9 h-9 rounded-xl bg-brand/10 text-brand dark:text-brand-ink flex items-center justify-center shrink-0">
            <i class="ph ph-gauge text-lg" aria-hidden="true"></i>
          </span>
          <div class="min-w-0">
            <p class="text-xs font-extrabold truncate">Cashflow Runway · Sisa ${rw.daysLeftInCycle} hari siklus ini</p>
            <p class="text-[11px] opacity-85 truncate tabular-nums">Proyeksi akhir siklus ${fmt(rw.projectedEndCash)}${rw.upcomingCount ? ` (termasuk ${rw.upcomingCount} jadwal rutin mendatang)` : ''}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <span class="px-3 py-1 rounded-full bg-brand/10 text-brand dark:text-brand-ink text-xs font-black tabular-nums">Aman: ${fmt(rw.safeDailyBudget)}/hari</span>
        </div>
      </div>`);
  }

  function checkAndRenderDueRecurringBanner() {
    renderCashflowRunwayStrip();
    const banner = document.getElementById('recurringDueBanner');
    if (!banner) return;
    if (!root.isDataReady || typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.getDueRecurringBills !== 'function') {
      banner.classList.add('hide');
      banner.textContent = '';
      return;
    }

    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const due = FinanceAnalysis.getDueRecurringBills(DB.recurring || [], DB.transactions || [], todayStr, DB.currentPeriod, DB.payrollDay);
    if (!due || due.count === 0) {
      banner.classList.add('hide');
      banner.textContent = '';
      return;
    }
    if (typeof root.syncNativeBillReminders === 'function') root.syncNativeBillReminders(due.dueBills);
    const autoOn = localStorage.getItem(AUTO_POST_KEY) === '1';

    banner.classList.remove('hide');
    const previewChips = due.dueBills.slice(0, 3).map((b) => {
      const isInc = b.tipe === 'Pemasukan';
      const color = isInc ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/20' : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/20';
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold tabular-nums ${color}">${escapeHtmlJS(b.kategori)}: ${isInc ? '+' : '-'}${formatRupiah(b.nominal).replace(',00', '')}</span>`;
    }).join('');
    const moreText = due.dueBills.length > 3 ? `<span class="text-xs text-amber-800 dark:text-amber-300 font-semibold">+${due.dueBills.length - 3} lainnya</span>` : '';

    renderHtml(banner, `
      <div class="rounded-3xl border border-amber-200 dark:border-amber-500/30 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30 p-4 sm:p-5 shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
              <i class="ph-bold ph-calendar-check text-xl" aria-hidden="true"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-extrabold text-slate-800 dark:text-white">${due.count} <span data-i18n="dash.recurring_due">${escapeHtmlJS(t('dash.recurring_due'))}</span></h3>
                <span class="px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-200 dark:bg-amber-500/30 text-amber-900 dark:text-amber-300">Siap Catat</span>
              </div>
              <p class="text-xs text-slate-700 dark:text-slate-300 mt-1 tabular-nums">Total tagihan: <strong>${formatRupiah(due.totalDueAmount).replace(',00', '')}</strong> pada siklus ini dan belum tercatat.</p>
              <div class="flex flex-wrap items-center gap-1.5 mt-2.5">${previewChips}${moreText}</div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-center">
            <button type="button" onclick="toggleAutoPostRecurring()" class="min-h-11 px-3 py-2 rounded-2xl border ${autoOn ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 text-amber-900 dark:text-amber-200' : 'bg-white/80 dark:bg-slate-800 border-amber-200 dark:border-amber-700 text-slate-600 dark:text-slate-300'} text-xs font-bold transition-colors">
              Auto-Catat: ${autoOn ? 'ON' : 'OFF'}
            </button>
            <button type="button" onclick="batchRecordRecurring()" class="min-h-11 px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs flex items-center gap-2 shadow-md shadow-amber-600/20 transition-colors">
              <i class="ph-bold ph-lightning" aria-hidden="true"></i>
              <span data-i18n="dash.batch_record">Catat Semua Sekaligus</span>
            </button>
          </div>
        </div>
      </div>`);
    maybeAutoPostDueRecurring();
  }

  async function postRecurringBillsBatch(bills, targetWalletId, todayStr) {
    const addedTransactions = [];
    const recordedIds = [];
    let latestPeriod = '';
    for (const bill of bills) {
      const txRes = await callServer('api_addTransaction', {
        tanggal: todayStr, tipe: bill.tipe, kategori: bill.kategori, nominal: Number(bill.nominal) || 0,
        keterangan: (bill.keterangan ? bill.keterangan + ' ' : '') + '(rutin)', walletId: targetWalletId
      });
      if (txRes && txRes.transaction) addedTransactions.push(txRes.transaction);
      if (txRes && txRes.currentPeriod && (!latestPeriod || txRes.currentPeriod > latestPeriod)) latestPeriod = txRes.currentPeriod;
      if (bill.id) recordedIds.push(bill.id);
    }
    let recRes = null;
    if (recordedIds.length) {
      try { recRes = await callServer('api_markRecurringRun', recordedIds, todayStr); } catch (_) { /* ignore */ }
    }
    await refreshFromServer({
      addedTransactions,
      ...(latestPeriod ? { currentPeriod: latestPeriod } : {}),
      ...(recRes && recRes.recurring ? { recurring: recRes.recurring } : {})
    });
  }

  function toggleAutoPostRecurring() {
    const next = localStorage.getItem(AUTO_POST_KEY) !== '1';
    localStorage.setItem(AUTO_POST_KEY, next ? '1' : '0');
    checkAndRenderDueRecurringBanner();
    Swal.fire({
      icon: next ? 'success' : 'info',
      title: next ? 'Auto-Catat Tagihan Rutin Aktif' : 'Auto-Catat Tagihan Rutin Dimatikan',
      text: next ? 'Tagihan rutin jatuh tempo akan otomatis dicatat saat online.' : 'Tagihan rutin menunggu konfirmasi manual.',
      timer: 1600,
      showConfirmButton: false,
      customClass: { popup: getSwalClass() }
    });
  }

  async function maybeAutoPostDueRecurring() {
    if (!root.isDataReady || !navigator.onLine || localStorage.getItem(AUTO_POST_KEY) !== '1') return;
    if (typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.getDueRecurringBills !== 'function') return;
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(AUTO_POST_DATE_KEY) === todayStr) return;
    const due = FinanceAnalysis.getDueRecurringBills(DB.recurring || [], DB.transactions || [], todayStr, DB.currentPeriod, DB.payrollDay);
    if (!due || !due.count) return;
    localStorage.setItem(AUTO_POST_DATE_KEY, todayStr);
    const walletId = (DB.wallets && DB.wallets[0] && DB.wallets[0].id) || '';
    try {
      await postRecurringBillsBatch(due.dueBills, walletId, todayStr);
    } catch (_) { /* keep manual fallback banner intact on error */ }
  }

  async function batchRecordRecurring() {
    if (!root.isDataReady || typeof FinanceAnalysis === 'undefined') return;
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const due = FinanceAnalysis.getDueRecurringBills(DB.recurring || [], DB.transactions || [], todayStr, DB.currentPeriod, DB.payrollDay);
    if (!due || due.count === 0) {
      Swal.fire({ icon: 'info', title: 'Semua Sudah Dicatat', text: 'Tidak ada tagihan rutin yang jatuh tempo untuk dicatat.', customClass: { popup: getSwalClass() } });
      return;
    }

    const itemsHtml = due.dueBills.map((b) => {
      const isInc = b.tipe === 'Pemasukan';
      return `<div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-xs">
        <span class="font-bold text-slate-800 dark:text-white truncate">${escapeHtmlJS(b.kategori)}${b.keterangan ? ' · ' + escapeHtmlJS(b.keterangan) : ''}</span>
        <span class="font-black tabular-nums ${isInc ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} shrink-0">${isInc ? '+' : '-'}${formatRupiah(b.nominal).replace(',00', '')}</span>
      </div>`;
    }).join('');
    const walletSelectHtml = (typeof walletOptions === 'function' && (DB.wallets || []).length)
      ? `<div class="mt-3 text-left"><label for="batch-rec-wallet" class="block text-xs font-bold text-slate-500 mb-1">Dompet pencatatan</label><select id="batch-rec-wallet" class="swal2-input" style="margin:0;width:100%">${walletOptions('')}</select></div>`
      : '';

    const res = await Swal.fire({
      title: 'Catat Semua Tagihan Jatuh Tempo?',
      html: `<p class="text-xs text-slate-600 dark:text-slate-300 mb-3 text-left tabular-nums">Terdapat <strong>${due.count} tagihan</strong> dengan total <strong>${formatRupiah(due.totalDueAmount).replace(',00', '')}</strong> yang akan langsung dicatat sebagai transaksi hari ini (${todayStr}).</p><div class="space-y-1.5 max-h-52 overflow-y-auto text-left mb-2">${itemsHtml}</div>${walletSelectHtml}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Catat Semua',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#d97706',
      customClass: { popup: getSwalClass() },
      preConfirm: () => ({ walletId: (document.getElementById('batch-rec-wallet') || {}).value || (DB.wallets && DB.wallets[0] && DB.wallets[0].id) || '' })
    });
    if (!res.isConfirmed) return;

    Swal.fire({ title: 'Mencatat Jadwal Rutin...', text: 'Menyimpan transaksi ke database', allowOutsideClick: false, didOpen: () => Swal.showLoading(), customClass: { popup: getSwalClass() } });
    try {
      const targetWalletId = (res.value && res.value.walletId) || (DB.wallets && DB.wallets[0] && DB.wallets[0].id) || '';
      await postRecurringBillsBatch(due.dueBills, targetWalletId, todayStr);
      Swal.fire({ icon: 'success', title: 'Berhasil Dicatat!', text: `${due.count} tagihan rutin berhasil dicatat ke siklus ini.`, timer: 1500, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
      else Swal.fire({ icon: 'error', title: 'Gagal', text: String(err.message || err), customClass: { popup: getSwalClass() } });
    }
  }

  Object.assign(root, { checkAndRenderDueRecurringBanner, batchRecordRecurring, toggleAutoPostRecurring, renderCashflowRunwayStrip });
})(typeof window !== 'undefined' ? window : globalThis);
