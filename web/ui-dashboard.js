/* global DB, FinanceAnalysis, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, getSwalClass, showActionError, isInPeriod, getPeriodLabel, walletBalances, walletOptions, localToday, openForm, renderAssets, t */
/* ============================================================
   DASHBOARD & FINANCIAL GOALS
   ============================================================ */
(function (root) {
  'use strict';

  function computeDashboardTotals() {
    let saldoKas = 0;
    let utangTotal = 0;
    let piutangTotal = 0;

    DB.transactions.forEach((tx) => {
      const isPiutang = String(tx.kategori).startsWith('Piutang');
      const isUtang = !isPiutang && String(tx.kategori).startsWith('Utang');
      if (isUtang) {
        if (tx.tipe === 'Pemasukan') {
          utangTotal += tx.nominal;
        } else {
          utangTotal -= tx.nominal;
          saldoKas -= tx.nominal;
        }
      } else if (isPiutang) {
        if (tx.tipe === 'Pengeluaran') {
          piutangTotal += tx.nominal;
          saldoKas -= tx.nominal;
        } else {
          piutangTotal -= tx.nominal;
          saldoKas += tx.nominal;
        }
      } else if (tx.tipe === 'Pemasukan') {
        saldoKas += tx.nominal;
      } else {
        saldoKas -= tx.nominal;
      }
    });

    if (DB.wallets && DB.wallets.length) {
      const wb = walletBalances();
      saldoKas = Object.keys(wb).reduce((a, k) => a + wb[k], 0);
    }

    const totalInvestasi = DB.assets.reduce((a, b) => a + Number(b.value || 0), 0);
    const netWorth = saldoKas + totalInvestasi + piutangTotal - utangTotal;
    return { saldoKas, utangTotal, piutangTotal, totalInvestasi, netWorth };
  }

  function buildDashTxItemHtml(tx, colClass, iconCol, iconBG) {
    const safeCatHtml = escapeHtmlJS(tx.kategori);
    const safeIdAttr = escapeAttrJS(tx.id);
    return `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 mb-2 hover:border-slate-300 dark:hover:border-slate-600 transition-colors group">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconCol} ${iconBG}">
            <i class="ph ph-receipt text-lg" aria-hidden="true"></i>
          </div>
          <div class="truncate">
            <p class="text-sm font-bold text-slate-800 dark:text-white truncate">${safeCatHtml}</p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtmlJS(String(tx.tanggal).substring(5))} · ${escapeHtmlJS(tx.keterangan || '-')}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-2">
          <p class="${colClass} font-bold text-sm tabular-nums">${formatRupiah(tx.nominal).replace(',00', '')}</p>
          <div class="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
            <button type="button" onclick="editTransaction('${safeIdAttr}')" aria-label="Edit transaksi ${safeCatHtml}" title="Edit" class="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-500/30">
              <i class="ph ph-pencil text-base" aria-hidden="true"></i>
            </button>
            <button type="button" onclick="deleteTransaction('${safeIdAttr}')" aria-label="Hapus transaksi ${safeCatHtml}" title="Hapus" class="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 flex items-center justify-center hover:bg-rose-200 dark:hover:bg-rose-500/30">
              <i class="ph ph-trash text-base" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  function showNetWorthInfo() {
    Swal.fire({
      icon: 'info',
      title: t('dash.networth'),
      text: t('dash.networth_tip'),
      confirmButtonText: t('btn.tutup'),
      customClass: { popup: getSwalClass() }
    });
  }

  function buildEmptyTxPlaceholder(tipe) {
    const isIn = tipe === 'Pemasukan';
    return `
      <div class="py-8 px-4 text-center">
        <i class="ph ph-${isIn ? 'tray-arrow-down' : 'tray-arrow-up'} text-3xl text-slate-300 dark:text-slate-600 mb-2 block" aria-hidden="true"></i>
        <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">Belum ada ${isIn ? 'pemasukan' : 'pengeluaran'} pada siklus ini.</p>
        <button type="button" onclick="openForm('${tipe}')" class="mt-3 min-h-10 px-3.5 py-2 rounded-xl bg-brand/10 text-brand dark:text-brand-ink text-xs font-bold hover:bg-brand/20 transition-colors">
          + Catat ${isIn ? 'Pemasukan' : 'Pengeluaran'}
        </button>
      </div>`;
  }

  function renderDashboard() {
    const period = DB.currentPeriod;
    const totals = computeDashboardTotals();

    const txs = DB.transactions
      .map((tx, i) => ({ ...tx, _idx: i }))
      .filter((tx) => isInPeriod(tx.tanggal, period))
      .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || (b._idx - a._idx));

    let monthIn = 0;
    let monthOut = 0;
    txs.forEach((tx) => {
      if (tx.kategori.startsWith('Utang') || tx.kategori.startsWith('Piutang')) return;
      if (tx.tipe === 'Pemasukan') monthIn += tx.nominal;
      else monthOut += tx.nominal;
    });

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.innerText = val;
    };

    setText('dash-total-aset', formatRupiah(totals.netWorth));
    setText('dash-saldo-aktif', formatRupiah(totals.saldoKas));
    setText('dash-cash-in', '+' + formatRupiah(monthIn));
    setText('dash-cash-out', '-' + formatRupiah(monthOut));
    setText('dash-hutang', formatRupiah(totals.utangTotal));
    setText('dash-piutang', formatRupiah(totals.piutangTotal));
    setText('dash-total-investasi', formatRupiah(totals.totalInvestasi));

    const periodLabel = getPeriodLabel(period, DB.payrollDay);
    document.querySelectorAll('.chartMonthLabel').forEach((el) => {
      el.innerText = '(' + periodLabel + ')';
    });

    const listIn = document.getElementById('listViewIn');
    const listOut = document.getElementById('listViewOut');
    if (listIn) {
      const inData = txs.filter((tx) => tx.tipe === 'Pemasukan' && !tx.kategori.startsWith('Utang') && !tx.kategori.startsWith('Piutang'));
      renderHtml(listIn, inData.map((tx) => buildDashTxItemHtml(tx, 'text-emerald-700 dark:text-emerald-400', 'text-emerald-600 dark:text-emerald-400', 'bg-emerald-50 dark:bg-emerald-500/10')).join('') ||
        buildEmptyTxPlaceholder('Pemasukan'));
    }
    if (listOut) {
      const outData = txs.filter((tx) => tx.tipe === 'Pengeluaran' && !tx.kategori.startsWith('Utang') && !tx.kategori.startsWith('Piutang'));
      renderHtml(listOut, outData.map((tx) => buildDashTxItemHtml(tx, 'text-rose-600 dark:text-rose-400', 'text-rose-600 dark:text-rose-400', 'bg-rose-50 dark:bg-rose-500/10')).join('') ||
        buildEmptyTxPlaceholder('Pengeluaran'));
    }

    renderAssets();
    renderFinancialGoals();
  }

  function renderFinancialGoals() {
    const container = document.getElementById('financialGoals');
    if (!container) return;
    const goals = DB.goals || [];
    if (!goals.length) {
      renderHtml(container, `<p class="md:col-span-2 p-6 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500">${escapeHtmlJS(t('goal.empty'))}</p>`);
    } else {
      renderHtml(container, goals.map((goal) => {
        const progress = FinanceAnalysis.goalProgress(goal.currentAmount, goal.targetAmount);
        const name = escapeHtmlJS(goal.name);
        const id = escapeHtmlJS(goal.id);
        return `
        <article class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h4 class="font-bold text-slate-800 dark:text-white break-words">${name}</h4>
              <p class="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">${escapeHtmlJS(t('goal.target'))}: ${formatRupiah(goal.targetAmount).replace(',00', '')}</p>
            </div>
            <div class="flex shrink-0 gap-1">
              <button type="button" data-goal-action="edit" data-goal-id="${id}" aria-label="${escapeHtmlJS(t('goal.edit'))}: ${name}" class="w-11 h-11 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10">
                <i class="ph ph-pencil" aria-hidden="true"></i>
              </button>
              <button type="button" data-goal-action="delete" data-goal-id="${id}" aria-label="${escapeHtmlJS(t('goal.delete'))}: ${name}" class="w-11 h-11 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                <i class="ph ph-trash" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <div class="mt-4 flex items-center justify-between gap-2 text-xs">
            <span class="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">${formatRupiah(goal.currentAmount).replace(',00', '')}</span>
            <span class="font-bold text-brand dark:text-brand-ink tabular-nums">${progress.toFixed(0)}%</span>
          </div>
          <div class="mt-2 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-label="${escapeHtmlJS(t('goal.progress'))}: ${name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.toFixed(0)}">
            <div class="h-full rounded-full bg-brand transition-[width] duration-200" style="width:${progress}%"></div>
          </div>
          <div class="mt-3 flex items-center justify-between gap-3">
            <p class="text-xs text-slate-500 dark:text-slate-400">${goal.targetDate ? `${escapeHtmlJS(t('goal.date'))}: ${escapeHtmlJS(goal.targetDate)}` : ''}</p>
            <button type="button" data-goal-action="progress" data-goal-id="${id}" class="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700">${escapeHtmlJS(t('goal.update_progress'))}</button>
          </div>
        </article>`;
      }).join(''));
    }

    if (container.dataset.bound !== 'true') {
      container.dataset.bound = 'true';
      container.addEventListener('click', (event) => {
        const button = event.target.closest('[data-goal-action]');
        if (!button) return;
        const id = button.dataset.goalId;
        if (button.dataset.goalAction === 'delete') deleteGoal(id);
        else if (button.dataset.goalAction === 'progress') openGoalForm(id, true);
        else openGoalForm(id, false);
      });
    }
  }

  function buildGoalFormHtml(current, progressOnly, hasWallets) {
    const fmtVal = (v) => (Number(v) > 0 ? formatNominalInputValue(Math.round(Number(v))) : (Number(v) === 0 ? '0' : ''));
    if (progressOnly) {
      return `<div class="text-left space-y-2 text-sm">
        <label for="goalAddAmount" class="block font-semibold">Tambah tabungan baru (Rp)</label>
        <input id="goalAddAmount" type="text" inputmode="numeric" placeholder="Contoh: 500.000" class="swal2-input tabular-nums" style="margin:0 0 8px 0;width:100%">
        ${hasWallets ? `
          <label for="goalWallet" class="block font-semibold">Ambil dari dompet (opsional)</label>
          <select id="goalWallet" class="swal2-input" style="margin:0 0 8px 0;width:100%">
            <option value="">Catat progres saja (tanpa potong dompet)</option>
            ${walletOptions('')}
          </select>` : ''}
        <hr class="my-2 border-slate-200 dark:border-slate-700">
        <label for="goalCurrent" class="block text-xs text-slate-500">Atau atur ulang total terkumpul langsung (Rp)</label>
        <input id="goalCurrent" type="text" inputmode="numeric" value="${escapeHtmlJS(fmtVal(current.currentAmount))}" class="swal2-input tabular-nums" style="margin:0;width:100%" aria-label="${escapeHtmlJS(t('goal.current'))}">
      </div>`;
    }
    return `<label for="goalName" class="block text-left text-sm font-semibold mb-1">${escapeHtmlJS(t('goal.name'))}</label>
      <input id="goalName" maxlength="80" value="${escapeHtmlJS(current.name)}" class="swal2-input" aria-label="${escapeHtmlJS(t('goal.name'))}">
      <label for="goalTarget" class="block text-left text-sm font-semibold mb-1">${escapeHtmlJS(t('goal.target'))}</label>
      <input id="goalTarget" type="text" inputmode="numeric" value="${escapeHtmlJS(fmtVal(current.targetAmount))}" class="swal2-input tabular-nums" aria-label="${escapeHtmlJS(t('goal.target'))}">
      <label for="goalCurrent" class="block text-left text-sm font-semibold mb-1">${escapeHtmlJS(t('goal.current'))}</label>
      <input id="goalCurrent" type="text" inputmode="numeric" value="${escapeHtmlJS(fmtVal(current.currentAmount))}" class="swal2-input tabular-nums" aria-label="${escapeHtmlJS(t('goal.current'))}">
      <label for="goalDate" class="block text-left text-sm font-semibold mb-1">${escapeHtmlJS(t('goal.date'))}</label>
      <input id="goalDate" type="date" value="${escapeHtmlJS(current.targetDate)}" class="swal2-input" aria-label="${escapeHtmlJS(t('goal.date'))}">`;
  }

  async function openGoalForm(id, progressOnly) {
    const goal = (DB.goals || []).find((item) => item.id === id);
    if (id && !goal) return;
    const current = goal || { name: '', targetAmount: '', currentAmount: 0, targetDate: '' };
    const hasWallets = (DB.wallets || []).length > 0;
    const result = await Swal.fire({
      title: progressOnly ? t('goal.update_progress') : goal ? t('goal.edit') : t('goal.add'),
      html: buildGoalFormHtml(current, progressOnly, hasWallets),
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      didOpen: () => bindNominalInputs(['goalAddAmount', 'goalCurrent', 'goalTarget']),
      preConfirm: () => {
        if (progressOnly) {
          const addAmount = parseFormattedNominal((document.getElementById('goalAddAmount') || {}).value);
          const walletId = (document.getElementById('goalWallet') || {}).value || '';
          if (Number.isFinite(addAmount) && addAmount > 0) {
            return { mode: 'contribute', goalId: current.id, amount: addAmount, walletId, tanggal: localToday() };
          }
        }
        const name = progressOnly ? current.name : document.getElementById('goalName').value.trim();
        const targetAmount = progressOnly ? Number(current.targetAmount) : parseFormattedNominal(document.getElementById('goalTarget').value);
        const rawCur = document.getElementById('goalCurrent').value;
        const currentAmount = String(rawCur || '').trim() === '' ? 0 : parseFormattedNominal(rawCur);
        const targetDate = progressOnly ? current.targetDate : document.getElementById('goalDate').value;
        if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0 ||
          !Number.isFinite(currentAmount) || currentAmount < 0) {
          Swal.showValidationMessage(t('goal.form_invalid'));
          return false;
        }
        return { mode: 'save', id: current.id, name, targetAmount, currentAmount, targetDate };
      }
    });
    if (!result.isConfirmed) return;
    try {
      const response = result.value.mode === 'contribute'
        ? await callServer('api_contributeGoal', result.value)
        : await callServer('api_saveGoal', result.value);
      await refreshFromServer(response);
      await Swal.fire({ icon: 'success', title: t('goal.saved'), customClass: { popup: getSwalClass() } });
    } catch (error) {
      showActionError(error);
    }
  }

  async function deleteGoal(id) {
    const result = await Swal.fire({
      icon: 'warning',
      title: t('goal.confirm_delete'),
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: t('btn.hapus'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!result.isConfirmed) return;
    try {
      await refreshFromServer(await callServer('api_deleteGoal', id));
    } catch (error) {
      showActionError(error);
    }
  }

  Object.assign(root, {
    renderDashboard,
    showNetWorthInfo,
    renderFinancialGoals,
    openGoalForm,
    deleteGoal,
    buildEmptyTxPlaceholder
  });
})(typeof window !== 'undefined' ? window : globalThis);
