/* global DB, Swal, callServer, refreshFromServer, getSwalClass, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, openAccountSettingsModal, openTelegramPairingModal, openForm */
/* ============================================================
   FEATURES — 3-STEP NEW USER ONBOARDING WIZARD
   ============================================================ */
(function (root) {
  'use strict';

  const ONBOARDING_DONE_KEY = 'mk_onboarding_done_v1';
  let wizardScheduled = false;

  const isEn = () => typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'en';
  const msg = (idStr, enStr) => (isEn() ? enStr : idStr);

  async function runStepOneWallet(wallet) {
    const startBal = wallet ? Number(wallet.openingBalance) || 0 : 0;
    const res = await Swal.fire({
      title: msg('Langkah 1/3 · Saldo Awal Dompet', 'Step 1/3 · Starting Balance'),
      html: `<div class="text-left space-y-2.5 text-xs">
        <p class="text-slate-600 dark:text-slate-300">${msg('Sesuaikan saldo awal dompet utama agar arus kas & Net Worth langsung akurat.', 'Set your primary wallet starting balance so Net Worth & Cashflow are accurate right away.')}</p>
        <p class="font-bold text-slate-800 dark:text-white">${wallet ? `${wallet.name}` : msg('Dompet Utama', 'Primary Wallet')}</p>
        <input id="ob-wallet-bal" type="text" inputmode="numeric" class="swal2-input tabular-nums" value="${formatNominalInputValue(startBal)}" placeholder="0">
      </div>`,
      showCancelButton: true,
      confirmButtonText: msg('Lanjut', 'Next'),
      cancelButtonText: msg('Lewati', 'Skip'),
      customClass: { popup: getSwalClass() },
      didOpen: () => bindNominalInputs(['ob-wallet-bal']),
      preConfirm: () => {
        const raw = (document.getElementById('ob-wallet-bal') || {}).value || '0';
        const val = parseFormattedNominal(raw);
        return Number.isFinite(val) && val >= 0 ? val : 0;
      }
    });
    if (!res.isConfirmed || !wallet) return Boolean(res.isConfirmed || res.dismiss === Swal.DismissReason.cancel);
    if (res.value !== startBal) {
      const data = await callServer('api_updateWallet', wallet.id, { name: wallet.name, kind: wallet.kind, openingBalance: res.value });
      await refreshFromServer(data);
    }
    return true;
  }

  async function runStepTwoPayrollDay() {
    const curDay = Math.max(1, Math.min(28, Number(DB.payrollDay) || 28));
    const res = await Swal.fire({
      title: msg('Langkah 2/3 · Tanggal Gajian', 'Step 2/3 · Payroll Cycle Day'),
      html: `<div class="text-left space-y-2.5 text-xs">
        <p class="text-slate-600 dark:text-slate-300">${msg('Siklus bulanan & Cashflow Runway dihitung mulai tanggal gajian pilihan Anda (1–28).', 'Your monthly cycle and Cashflow Runway start from your chosen payday (1–28).')}</p>
        <label for="ob-payroll-day" class="block font-bold text-slate-500">${msg('Tanggal mulai siklus (1–28)', 'Cycle start day (1–28)')}</label>
        <input id="ob-payroll-day" type="number" min="1" max="28" inputmode="numeric" class="swal2-input tabular-nums" value="${curDay}">
      </div>`,
      showCancelButton: true,
      confirmButtonText: msg('Simpan & Lanjut', 'Save & Next'),
      cancelButtonText: msg('Lewati', 'Skip'),
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const d = Math.trunc(Number((document.getElementById('ob-payroll-day') || {}).value));
        if (!Number.isFinite(d) || d < 1 || d > 28) {
          Swal.showValidationMessage(msg('Masukkan tanggal antara 1 sampai 28.', 'Enter a day between 1 and 28.'));
          return false;
        }
        return d;
      }
    });
    if (res.isConfirmed && Number.isFinite(res.value) && res.value !== curDay) {
      await callServer('api_savePayrollDay', res.value);
      DB.payrollDay = res.value;
      await refreshFromServer();
    }
    return Boolean(res.isConfirmed || res.dismiss === Swal.DismissReason.cancel);
  }

  async function runStepThreeQuickActions() {
    const res = await Swal.fire({
      icon: 'success',
      title: msg('Langkah 3/3 · Siap Digunakan!', 'Step 3/3 · All Set!'),
      html: `<div class="text-left space-y-2.5 text-xs">
        <p class="text-slate-600 dark:text-slate-300">${msg('Pilih langkah cepat berikutnya atau mulai jelajahi Dashboard:', 'Pick an optional quick setup or start exploring your Dashboard:')}</p>
        <div class="grid grid-cols-1 gap-2 pt-1">
          <button type="button" id="ob-btn-pin" class="w-full min-h-11 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2"><i class="ph ph-lock-key text-base" aria-hidden="true"></i><span>${msg('Atur PIN / Biometrik Lokal', 'Set Local PIN / Biometrics')}</span></button>
          <button type="button" id="ob-btn-tg" class="w-full min-h-11 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-800/50 font-bold text-blue-700 dark:text-blue-300 flex items-center justify-center gap-2"><i class="ph ph-telegram-logo text-base" aria-hidden="true"></i><span>${msg('Hubungkan Bot Telegram', 'Connect Telegram Bot')}</span></button>
        </div>
      </div>`,
      showCancelButton: true,
      confirmButtonText: msg('Catat Transaksi Pertama', 'Add First Transaction'),
      cancelButtonText: msg('Ke Dashboard', 'Go to Dashboard'),
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        document.getElementById('ob-btn-pin')?.addEventListener('click', () => {
          Swal.close();
          if (typeof openAccountSettingsModal === 'function') openAccountSettingsModal();
        });
        document.getElementById('ob-btn-tg')?.addEventListener('click', () => {
          Swal.close();
          if (typeof openTelegramPairingModal === 'function') openTelegramPairingModal();
        });
      }
    });
    if (res.isConfirmed && typeof openForm === 'function') openForm('Pengeluaran');
  }

  async function openOnboardingWizard(force) {
    if (!root.isDataReady || typeof Swal === 'undefined') return;
    if (!force && localStorage.getItem(ONBOARDING_DONE_KEY) === '1') return;
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      const primaryWallet = (DB.wallets && DB.wallets[0]) || null;
      const go2 = await runStepOneWallet(primaryWallet);
      if (!go2) return;
      const go3 = await runStepTwoPayrollDay();
      if (!go3) return;
      await runStepThreeQuickActions();
    } catch (_) { /* silent fallback */ }
  }

  function maybeRunNewUserOnboarding() {
    if (wizardScheduled || !root.isDataReady || typeof localStorage === 'undefined') return;
    if (localStorage.getItem(ONBOARDING_DONE_KEY) === '1') return;
    const isFresh = !(DB.transactions && DB.transactions.length) && !(DB.budgets && DB.budgets.length) && !(DB.goals && DB.goals.length);
    if (!isFresh) {
      try { localStorage.setItem(ONBOARDING_DONE_KEY, '1'); } catch (_) { /* ignore */ }
      return;
    }
    const mainEl = document.getElementById('mainContent');
    const busy = (typeof Swal !== 'undefined' && Swal.isVisible()) || (mainEl && mainEl.classList.contains('blur-md'));
    if (busy) return;
    wizardScheduled = true;
    setTimeout(() => openOnboardingWizard(false), 900);
  }

  Object.assign(root, { openOnboardingWizard, maybeRunNewUserOnboarding });
})(typeof window !== 'undefined' ? window : globalThis);
