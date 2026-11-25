/* global DB, FinanceAnalysis, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, renderHtml, renderSelectOptions, parseFormattedNominal, getSwalClass, showActionError, cycleOfDate, switchView, openForm, toggleHideNominal, openWalletDetailModal, openDebtDetailModal, renderBudgetCharts, renderBudgetAnomalyBanner, renderFinancialRatios, renderAssetAllocation, renderNetWorthChart, checkAndRenderDueRecurringBanner, filterHistoriView, refreshNotificationBell */
/* ============================================================
   FEATURES — HOOK ORCHESTRATION, SPLIT BILL & GLOBAL SHORTCUTS
   ============================================================ */
(function (root) {
  'use strict';

  function readSplitBillForm() {
    let tanggal = (document.getElementById('tr_tanggal') || {}).value;
    if (!tanggal && root.fpTanggal && root.fpTanggal.selectedDates && root.fpTanggal.selectedDates.length) {
      const d = root.fpTanggal.selectedDates[0];
      tanggal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return {
      tanggal,
      totalNominal: parseFormattedNominal((document.getElementById('tr_nominal') || {}).value),
      friendShare: parseFormattedNominal((document.getElementById('tr_split_amount') || {}).value),
      person: ((document.getElementById('tr_split_person') || {}).value || '').trim(),
      kategori: (document.getElementById('tr_kategori') || {}).value,
      note: ((document.getElementById('tr_keterangan') || {}).value || '').trim(),
      walletId: (document.getElementById('tr_wallet') || {}).value || ''
    };
  }

  async function executeSplitBillSubmit(f) {
    const myPortion = f.totalNominal - f.friendShare;
    const submitBtn = document.getElementById('btnSubmitTrans');
    if (submitBtn && submitBtn.disabled) return;
    const savedBtnNodes = submitBtn ? Array.from(submitBtn.childNodes) : [];
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
      renderHtml(submitBtn, '<span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span><span>Menyimpan...</span>');
    }
    try {
      if (!((DB.entities && DB.entities.Piutang) || []).includes(f.person)) {
        const entData = await callServer('api_addEntity', 'Piutang', f.person);
        if (entData && entData.entities) DB.entities = entData.entities;
      }
      const expensePayload = await callServer('api_addTransaction', {
        tanggal: f.tanggal, tipe: 'Pengeluaran', kategori: f.kategori, nominal: myPortion,
        keterangan: (f.note ? f.note + ' ' : '') + '[Split Bill dengan ' + f.person + ']', walletId: f.walletId
      });
      const receivablePayload = await callServer('api_addTransaction', {
        tanggal: f.tanggal, tipe: 'Pengeluaran', kategori: 'Piutang - ' + f.person, nominal: f.friendShare,
        keterangan: 'Patungan: ' + (f.note || f.kategori), walletId: f.walletId
      });
      const mergedPayload = { addedTransactions: [expensePayload && expensePayload.transaction, receivablePayload && receivablePayload.transaction].filter(Boolean) };
      const txMonth = cycleOfDate(f.tanggal);
      if (txMonth !== DB.currentPeriod) {
        await callServer('api_savePeriod', txMonth);
        mergedPayload.currentPeriod = txMonth;
        if (root.fpMonth) {
          try { root.fpMonth.setDate(txMonth, false); } catch (_) { /* ignore */ }
        }
      }
      await refreshFromServer(mergedPayload);
      Swal.fire({
        icon: 'success',
        title: 'Split Bill Tercatat!',
        html: `Porsi Anda <b>${formatRupiah(myPortion)}</b> + Piutang <b>${escapeHtmlJS(f.person)}</b> sebesar <b>${formatRupiah(f.friendShare)}</b> tersimpan.`,
        timer: 1800,
        showConfirmButton: false,
        customClass: { popup: getSwalClass() }
      });
      switchView('dashboard');
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
        submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        submitBtn.replaceChildren(...savedBtnNodes);
      }
    }
  }

  function wrapFormAndTransactionHooks() {
    if (typeof root.openForm === 'function' && !root._origOpenForm) {
      root._origOpenForm = root.openForm;
      root.openForm = function (action) {
        root._origOpenForm(action);
        const box = document.getElementById('splitBillBox');
        const chk = document.getElementById('tr_split_enable');
        const fields = document.getElementById('tr_split_fields');
        const dl = document.getElementById('tr_split_person_list');
        const tipe = (document.getElementById('tr_tipe') || {}).value;
        if (chk) chk.checked = false;
        if (fields) fields.classList.add('hide');
        if (box) box.classList.toggle('hide', tipe !== 'Pengeluaran');
        renderSelectOptions(dl, ((DB.entities && DB.entities.Piutang) || []).map((p) => ({ value: p, label: '' })), null);
      };
    }

    if (typeof root.editTransaction === 'function' && !root._origEditTransaction) {
      root._origEditTransaction = root.editTransaction;
      root.editTransaction = function (id) {
        root._origEditTransaction(id);
        const chk = document.getElementById('tr_split_enable');
        if (chk) chk.checked = false;
        document.getElementById('splitBillBox')?.classList.add('hide');
      };
    }

    if (typeof root.submitTransaction === 'function' && !root._origSubmitTransaction) {
      root._origSubmitTransaction = root.submitTransaction;
      root.submitTransaction = async function (e) {
        const rowId = (document.getElementById('tr_row') || {}).value;
        const tipe = (document.getElementById('tr_tipe') || {}).value;
        const splitChk = document.getElementById('tr_split_enable');
        if (!rowId && tipe === 'Pengeluaran' && splitChk && splitChk.checked) {
          e.preventDefault();
          if (typeof root.clearFormErrors === 'function') root.clearFormErrors();
          const setErr = typeof root.setFormFieldError === 'function' ? root.setFormFieldError : null;
          const f = readSplitBillForm();
          let firstBad = null;
          if (!f.tanggal || !/^\d{4}-\d{2}-\d{2}/.test(f.tanggal)) {
            if (setErr) setErr('tr_tanggal', 'tr_tanggal_error', 'Isi tanggal dengan format YYYY-MM-DD.');
            firstBad = document.getElementById('tr_tanggal');
          }
          if (!f.totalNominal || f.totalNominal <= 0) {
            if (setErr) setErr('tr_nominal', 'tr_nominal_error', 'Masukkan nominal total lebih dari 0.');
            if (!firstBad) firstBad = document.getElementById('tr_nominal');
          }
          if (firstBad) { firstBad.focus(); return; }
          if (!f.person) {
            if (setErr) setErr('tr_split_person', 'tr_split_error', 'Isi nama teman untuk porsi Split Bill.');
            document.getElementById('tr_split_person')?.focus();
            return;
          }
          if (!f.friendShare || f.friendShare <= 0 || f.friendShare >= f.totalNominal) {
            if (setErr) setErr('tr_split_amount', 'tr_split_error', 'Porsi teman harus > 0 dan lebih kecil dari total.');
            document.getElementById('tr_split_amount')?.focus();
            return;
          }
          await executeSplitBillSubmit(f);
          return;
        }
        return root._origSubmitTransaction(e);
      };
    }
  }

  function decorateGoalBadges() {
    const container = document.getElementById('financialGoals');
    if (!container || !DB.goals || !DB.goals.length) return;
    const articles = container.querySelectorAll('article');
    const todayStr = typeof root.localToday === 'function' ? root.localToday() : new Date().toISOString().slice(0, 10);
    const ratios = typeof FinanceAnalysis !== 'undefined' && typeof FinanceAnalysis.computeFinancialHealthRatios === 'function'
      ? FinanceAnalysis.computeFinancialHealthRatios(DB, DB.currentPeriod, DB.payrollDay) : null;
    const avgSavingRate = ratios ? Math.max(0, ratios.avgMonthlyExpense ? Math.round(ratios.avgMonthlyExpense * 0.2) : 500000) : 500000;

    DB.goals.forEach((goal, idx) => {
      const card = articles[idx];
      if (!card || card.querySelector('.mk-goal-calc')) return;
      const calc = FinanceAnalysis.calculateGoalMonthlySaving(goal.currentAmount, goal.targetAmount, goal.targetDate, todayStr);
      const proj = FinanceAnalysis.projectGoalMilestone(goal.currentAmount, goal.targetAmount, goal.targetDate, calc.monthlySaving, avgSavingRate, todayStr);
      let label = 'Kurang ' + formatRupiah(calc.remaining).replace(',00', '');
      let iconClass = 'ph-bold ph-wallet';
      let tone = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
      if (calc.status === 'completed' || proj.status === 'completed') {
        label = 'Target tercapai!';
        iconClass = 'ph-bold ph-check-circle';
        tone = 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300';
      } else if (calc.status === 'overdue' || proj.status === 'overdue') {
        label = 'Lewat tenggat · Sisa ' + formatRupiah(calc.remaining).replace(',00', '');
        iconClass = 'ph-bold ph-warning-circle';
        tone = 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300';
      } else if (calc.monthlySaving !== null) {
        label = 'Saran: ' + formatRupiah(calc.monthlySaving).replace(',00', '') + '/bln (' + calc.daysLeft + ' hari)';
        iconClass = 'ph-bold ph-lightbulb';
        tone = calc.status === 'urgent' ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-brand/10 text-brand dark:text-brand-ink';
      } else if (proj.projectedDate) {
        label = 'Proyeksi tercapai: ' + proj.projectedDate + ' (~' + proj.projectedMonths + ' bln dg ' + formatRupiah(proj.savingRate).replace(',00', '') + '/bln)';
        iconClass = 'ph-bold ph-target';
        tone = 'bg-brand/10 text-brand dark:text-brand-ink';
      }
      const badge = document.createElement('p');
      badge.className = 'mk-goal-calc mt-2.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 tabular-nums ' + tone;
      renderHtml(badge, `<i class="${iconClass} shrink-0" aria-hidden="true"></i><span>${escapeHtmlJS(label)}</span>`);
      card.appendChild(badge);
    });
  }

  function wrapViewRenderHooks() {
    if (typeof root.renderWallets === 'function' && !root._origRenderWallets) {
      root._origRenderWallets = root.renderWallets;
      root.renderWallets = function () {
        root._origRenderWallets();
        if (typeof root.renderAssetAllocation === 'function') renderAssetAllocation();
      };
    }
    if (typeof root.renderFinancialGoals === 'function' && !root._origRenderFinancialGoals) {
      root._origRenderFinancialGoals = root.renderFinancialGoals;
      root.renderFinancialGoals = function () { root._origRenderFinancialGoals(); decorateGoalBadges(); };
    }
    if (typeof root.renderDebtLists === 'function' && !root._origRenderDebtLists) {
      root._origRenderDebtLists = root.renderDebtLists;
      root.renderDebtLists = function () {
        root._origRenderDebtLists();
        const feat = root.__mkFeat || {};
        const debtKey = feat.debtKey || ((g, n) => g + '::' + n);
        const dueMap = (DB && DB.debtDueDates) || {};
        const todayStr = typeof root.localToday === 'function' ? root.localToday() : new Date().toISOString().slice(0, 10);
        document.querySelectorAll('#view-utang [data-debt-action="edit"]').forEach((editBtn) => {
          const { debtGroup: group, debtName: name } = editBtn.dataset;
          const card = editBtn.closest('div.rounded-2xl');
          if (!card || !group || !name || card.querySelector('.mk-debt-due-row')) return;
          const due = dueMap[debtKey(group, name)] || '';
          const overdue = due && due < todayStr;
          const bar = document.createElement('div');
          bar.className = 'mk-debt-due-row mt-3 pt-2.5 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between gap-2 text-[11px]';
          const dueIcon = overdue ? 'ph-bold ph-warning-circle' : 'ph ph-calendar-blank';
          const dueHtml = due
            ? `<i class="${dueIcon} shrink-0" aria-hidden="true"></i><span class="truncate tabular-nums">${overdue ? 'Lewat tempo: ' : 'Tempo: '}${escapeHtmlJS(due)}</span>`
            : '<span class="truncate">Belum ada jatuh tempo</span>';
          renderHtml(bar, `<span class="flex items-center gap-1 min-w-0 ${due ? (overdue ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-amber-700 dark:text-amber-400 font-semibold') : 'text-slate-500 dark:text-slate-400'}">${dueHtml}</span><button type="button" class="min-h-8 px-1.5 text-brand dark:text-brand-ink font-bold hover:underline shrink-0">Riwayat &amp; Tempo</button>`);
          bar.querySelector('button').addEventListener('click', () => openDebtDetailModal(group, name));
          card.appendChild(bar);
        });
      };
    }
    if (typeof root.renderAssets === 'function' && !root._origRenderAssets) {
      root._origRenderAssets = root.renderAssets;
      root.renderAssets = function () { root._origRenderAssets(); renderAssetAllocation(); };
    }
    if (typeof root.renderBudgeting === 'function' && !root._origRenderBudgeting) {
      root._origRenderBudgeting = root.renderBudgeting;
      root.renderBudgeting = function () { root._origRenderBudgeting(); renderBudgetCharts(); renderBudgetAnomalyBanner(); };
    }
  }

  function wrapNavigationHooks() {
    if (typeof root.switchView === 'function' && !root._origSwitchView) {
      root._origSwitchView = root.switchView;
      root.switchView = function (id) {
        root._origSwitchView(id);
        if (id === 'budgeting') setTimeout(() => { renderBudgetCharts(); renderBudgetAnomalyBanner(); }, 60);
        else if (id === 'aset') { renderFinancialRatios(); renderAssetAllocation(); setTimeout(() => { renderNetWorthChart(); }, 60); }
        else if (id === 'dashboard') checkAndRenderDueRecurringBanner();
        else if (id === 'histori') filterHistoriView();
        document.getElementById('mobileFabBtn')?.classList.toggle('hide', id === 'form-transaction');
      };
    }
    if (typeof root.renderAll === 'function' && !root._origRenderAll) {
      root._origRenderAll = root.renderAll;
      root.renderAll = function () {
        const feat = root.__mkFeat || {};
        root._origRenderAll();
        filterHistoriView();
        renderFinancialRatios();
        renderAssetAllocation();
        renderNetWorthChart();
        checkAndRenderDueRecurringBanner();
        refreshNotificationBell();
        if (typeof root.filterUpdatesList === 'function') root.filterUpdatesList();
        if (typeof feat.verifyAppPinIfEnabled === 'function') feat.verifyAppPinIfEnabled();
        if (typeof feat.handlePwaShortcutAction === 'function') feat.handlePwaShortcutAction();
        if (root.isDataReady && typeof root.checkRemoteAppUpdate === 'function') {
          setTimeout(() => { root.checkRemoteAppUpdate({ manual: false }); }, 2200);
        }
        if (root.isDataReady && typeof root.maybeRunNewUserOnboarding === 'function') {
          setTimeout(() => { root.maybeRunNewUserOnboarding(); }, 1200);
        }
      };
    }
    if (typeof root.setTheme === 'function' && !root._origSetTheme) {
      root._origSetTheme = root.setTheme;
      root.setTheme = function (t) {
        root._origSetTheme(t);
        if (root.isDataReady) {
          try { renderBudgetCharts(); } catch (_) { /* ignore */ }
          try { renderNetWorthChart(); } catch (_) { /* ignore */ }
        }
      };
    }
  }

  function installHooks() {
    const feat = root.__mkFeat || {};
    if (typeof feat.waitAndWrapCallServer === 'function') feat.waitAndWrapCallServer();
    wrapFormAndTransactionHooks();
    wrapViewRenderHooks();
    wrapNavigationHooks();
  }

  const isCapNative = () => typeof root.isNativeApp === 'function' && root.isNativeApp();

  root.addEventListener('beforeinstallprompt', (e) => {
    if (isCapNative()) return;
    e.preventDefault();
    root._deferredPwaPrompt = e;
    document.getElementById('pwaInstallWrap')?.classList.remove('hidden');
  });
  root.addEventListener('appinstalled', () => {
    root._deferredPwaPrompt = null;
    document.getElementById('pwaInstallWrap')?.classList.add('hidden');
  });

  installHooks();
  document.addEventListener('DOMContentLoaded', () => {
    installHooks();
    if (typeof root.refreshUpdatesBadge === 'function') root.refreshUpdatesBadge();
    setTimeout(() => { if (typeof root.filterUpdatesList === 'function') root.filterUpdatesList(); }, 120);
    const isStandalone = (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || root.navigator.standalone === true;
    if (!isStandalone && !isCapNative() && (root._deferredPwaPrompt || /iphone|ipad|ipod/i.test(navigator.userAgent || ''))) {
      document.getElementById('pwaInstallWrap')?.classList.remove('hidden');
    }
    if (navigator.onLine && typeof root.flushOfflineQueue === 'function') {
      setTimeout(() => { root.flushOfflineQueue(true); }, 1500);
    }
  });
  root.addEventListener('online', () => {
    if (typeof root.flushOfflineQueue === 'function') root.flushOfflineQueue(false);
    if (root.isDataReady && typeof root.checkRemoteAppUpdate === 'function') root.checkRemoteAppUpdate({ manual: false });
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (typeof Swal !== 'undefined' && Swal.isVisible()) || document.getElementById('mkCommandPalette')) return;
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable) || !root.isDataReady) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'n') { e.preventDefault(); openForm('Pengeluaran'); }
    else if (k === 'h') { e.preventDefault(); if (typeof toggleHideNominal === 'function') toggleHideNominal(); }
    else if (e.key === '/') {
      e.preventDefault();
      switchView('laporan');
      setTimeout(() => { document.getElementById('lapSearch')?.focus(); }, 80);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
