/* global Swal, callServer, getSwalClass, escapeHtmlJS, showActionError, updateDashboardTitle, openForm, openTransferModal, triggerReceiptOcr, switchView, t */
/* ============================================================
   FEATURES — ACCOUNT SETTINGS, PIN LOCK, QUICK MENU & PWA INSTALL
   ============================================================ */
(function (root) {
  'use strict';

  const PIN_LOCK_STATE_KEY = 'mk_pin_lock_state_v1';
  const MAX_PIN_ATTEMPTS = 5;
  const PIN_COOLDOWN_MS = 60000;
  const AUTO_LOCK_IDLE_MS = 120000;
  let pinPromptShown = false;
  let pinLastHiddenAt = 0;

  const isEn = () => localStorage.getItem('lang') === 'en';
  const txMsg = (idStr, enStr) => (isEn() ? enStr : idStr);

  function readPinLockState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PIN_LOCK_STATE_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        return { attempts: Number(parsed.attempts) || 0, lockedUntil: Number(parsed.lockedUntil) || 0 };
      }
    } catch (_) { /* ignore */ }
    return { attempts: 0, lockedUntil: 0 };
  }

  function writePinLockState(state) {
    try { localStorage.setItem(PIN_LOCK_STATE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
  }

  function markPinUnlocked() {
    writePinLockState({ attempts: 0, lockedUntil: 0 });
    sessionStorage.setItem('mk_pin_unlocked', '1');
  }

  function recordFailedPinAttempt() {
    const prev = readPinLockState();
    const attempts = prev.attempts + 1;
    const next = { attempts, lockedUntil: attempts >= MAX_PIN_ATTEMPTS ? Date.now() + PIN_COOLDOWN_MS : 0 };
    writePinLockState(next);
    return next;
  }

  function getPinCooldownSeconds() {
    const { lockedUntil } = readPinLockState();
    return lockedUntil > Date.now() ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0;
  }

  async function promptVerifyCurrentPin(title) {
    const savedHash = localStorage.getItem('mk_app_pin_hash');
    if (!savedHash) return true;
    const waitSec = getPinCooldownSeconds();
    if (waitSec > 0) {
      await Swal.fire({
        icon: 'warning',
        title: txMsg('PIN Terkunci Sementara', 'PIN Temporarily Locked'),
        text: txMsg(`Coba lagi dalam ${waitSec} detik.`, `Try again in ${waitSec} seconds.`),
        customClass: { popup: getSwalClass() }
      });
      return false;
    }
    const res = await Swal.fire({
      title,
      input: 'password',
      inputAttributes: { inputmode: 'numeric', maxlength: '6', autocomplete: 'off' },
      inputPlaceholder: txMsg('Masukkan PIN saat ini', 'Enter current PIN'),
      showCancelButton: true,
      confirmButtonText: txMsg('Verifikasi', 'Verify'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!res.isConfirmed) return false;
    if (await verifyPinMatches(String(res.value || '').trim(), savedHash)) {
      writePinLockState({ attempts: 0, lockedUntil: 0 });
      return true;
    }
    const next = recordFailedPinAttempt();
    const left = Math.max(0, MAX_PIN_ATTEMPTS - next.attempts);
    const hint = next.lockedUntil
      ? txMsg('Terlalu banyak percobaan salah. Tunggu 60 detik.', 'Too many wrong attempts. Wait 60 seconds.')
      : txMsg(`PIN saat ini salah (sisa ${left} percobaan).`, `Incorrect current PIN (${left} attempts left).`);
    await Swal.fire({ icon: 'error', title: txMsg('Verifikasi Gagal', 'Verification Failed'), text: hint, customClass: { popup: getSwalClass() } });
    return false;
  }

  function createPinSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function derivePinHash(pin, saltHex) {
    const enc = new TextEncoder();
    if (root.crypto && root.crypto.subtle && typeof root.crypto.subtle.deriveBits === 'function') {
      const keyMat = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(String(saltHex || '')), iterations: 100000, hash: 'SHA-256' },
        keyMat,
        256
      );
      return 'pbkdf2$' + Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(saltHex || '') + ':' + String(pin)));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashPin(pin) {
    const salt = createPinSalt();
    localStorage.setItem('mk_app_pin_salt', salt);
    return derivePinHash(pin, salt);
  }

  async function verifyPinMatches(pin, savedHash) {
    if (String(savedHash).startsWith('pbkdf2$')) {
      const salt = localStorage.getItem('mk_app_pin_salt') || '';
      return (await derivePinHash(pin, salt)) === savedHash;
    }
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mkpin:' + String(pin)));
    const legacyHex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (legacyHex === savedHash) {
      localStorage.setItem('mk_app_pin_hash', await hashPin(pin));
      return true;
    }
    return false;
  }

  function buildAccountSettingsHtml(hasPin) {
    const pinStatus = hasPin ? txMsg('Aktif', 'Active') : txMsg('Belum diatur', 'Not set');
    const pinPlaceholder = hasPin
      ? txMsg('Kosongkan jika tetap / ketik PIN baru', 'Leave blank to keep / enter new PIN')
      : txMsg('Contoh: 1234', 'Example: 1234');
    return `
      <div class="text-left space-y-3 text-xs">
        <div>
          <label for="acc-display-name" class="block font-bold text-slate-500 mb-1">${txMsg('Nama Tampilan', 'Display Name')}</label>
          <input id="acc-display-name" class="swal2-input" style="margin:0;width:100%" maxlength="60" value="${escapeHtmlJS(root.sessionUser || '')}">
        </div>
        <div class="pt-2 border-t border-slate-200 dark:border-slate-700">
          <label for="acc-pin-input" class="block font-bold text-slate-500 mb-1">${txMsg('PIN Kunci Aplikasi Lokal (4–6 digit,', 'Local App Lock PIN (4–6 digits,')} ${pinStatus})</label>
          <input id="acc-pin-input" type="password" inputmode="numeric" maxlength="6" class="swal2-input" style="margin:0;width:100%" placeholder="${pinPlaceholder}">
        </div>
        <div class="flex flex-wrap gap-2 pt-2">
          <button type="button" onclick="Swal.close();changeOwnPassword()" class="flex-1 min-h-11 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5"><i class="ph ph-key" aria-hidden="true"></i> <span>${txMsg('Ganti Password', 'Change Password')}</span></button>
          ${hasPin ? `<button type="button" id="acc-clear-pin-btn" class="min-h-11 py-2.5 px-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold inline-flex items-center justify-center gap-1.5"><i class="ph ph-lock-open" aria-hidden="true"></i> <span>${txMsg('Hapus PIN', 'Remove PIN')}</span></button>` : ''}
        </div>
        <div class="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            ${txMsg('Dokumen legal:', 'Legal documents:')}
            <a href="privacy.html" target="_blank" rel="noopener noreferrer" class="text-brand dark:text-brand-ink font-semibold underline">${txMsg('Kebijakan Privasi', 'Privacy Policy')}</a> ·
            <a href="terms.html" target="_blank" rel="noopener noreferrer" class="text-brand dark:text-brand-ink font-semibold underline">${txMsg('Syarat &amp; Ketentuan', 'Terms &amp; Conditions')}</a>
          </p>
          <button type="button" id="acc-delete-account-btn" class="w-full min-h-11 py-2 px-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 font-bold inline-flex items-center justify-center gap-1.5 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors">
            <i class="ph ph-trash" aria-hidden="true"></i> <span>${txMsg('Hapus Akun &amp; Data Permanen', 'Delete Account &amp; Data Permanently')}</span>
          </button>
        </div>
      </div>`;
  }

  function bindAccountModalEvents() {
    const clr = document.getElementById('acc-clear-pin-btn');
    if (clr) {
      clr.addEventListener('click', async () => {
        Swal.close();
        if (!(await promptVerifyCurrentPin(txMsg('Verifikasi PIN untuk Menghapus', 'Verify PIN to Remove')))) return;
        localStorage.removeItem('mk_app_pin_hash');
        localStorage.removeItem('mk_app_pin_salt');
        localStorage.removeItem('mk_biometric_pin_enabled');
        localStorage.removeItem('mk_biometric_cred_id');
        writePinLockState({ attempts: 0, lockedUntil: 0 });
        sessionStorage.removeItem('mk_pin_unlocked');
        Swal.fire({ icon: 'info', title: txMsg('PIN aplikasi dihapus', 'App PIN removed'), timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      });
    }
    const delBtn = document.getElementById('acc-delete-account-btn');
    if (delBtn) delBtn.addEventListener('click', () => { Swal.close(); deleteOwnAccountFlow(); });
    if (root.__mkFeat && typeof root.__mkFeat.decorateAccountBiometricRow === 'function') {
      root.__mkFeat.decorateAccountBiometricRow(Boolean(localStorage.getItem('mk_app_pin_hash')));
    }
  }

  async function openAccountSettingsModal() {
    const hasPin = Boolean(localStorage.getItem('mk_app_pin_hash'));
    const res = await Swal.fire({
      title: txMsg('Pengaturan Akun & Keamanan', 'Account & Security Settings'),
      html: buildAccountSettingsHtml(hasPin),
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      didOpen: bindAccountModalEvents,
      preConfirm: () => {
        const displayName = (document.getElementById('acc-display-name').value || '').trim();
        const pin = (document.getElementById('acc-pin-input').value || '').trim();
        if (displayName.length < 2) {
          Swal.showValidationMessage(txMsg('Nama tampilan minimal 2 karakter.', 'Display name must be at least 2 characters.'));
          return false;
        }
        if (pin && !/^\d{4,6}$/.test(pin)) {
          Swal.showValidationMessage(txMsg('PIN harus 4 sampai 6 angka.', 'PIN must be 4 to 6 digits.'));
          return false;
        }
        return { displayName, pin };
      }
    });
    if (!res.isConfirmed || !res.value) return;
    if (res.value.pin && hasPin && !(await promptVerifyCurrentPin(txMsg('Verifikasi PIN Saat Ini', 'Verify Current PIN')))) return;
    await applyAccountSettingsUpdate(res.value);
  }

  async function applyAccountSettingsUpdate(val) {
    try {
      if (val.displayName !== root.sessionUser) {
        const out = await callServer('api_updateOwnProfile', val.displayName);
        if (out && out.displayName) {
          root.sessionUser = out.displayName;
          const uEl = document.getElementById('ui-username');
          if (uEl) uEl.innerText = root.sessionUser;
          if (typeof updateDashboardTitle === 'function') updateDashboardTitle();
        }
      }
      if (val.pin) {
        localStorage.setItem('mk_app_pin_hash', await hashPin(val.pin));
        markPinUnlocked();
      }
      Swal.fire({ icon: 'success', title: txMsg('Pengaturan akun tersimpan', 'Account settings saved'), timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  async function deleteOwnAccountFlow() {
    const keyword = txMsg('HAPUS', 'DELETE');
    const confirmRes = await Swal.fire({
      icon: 'warning',
      title: txMsg('Hapus Akun Permanen?', 'Delete Account Permanently?'),
      html: `
        <div class="text-left text-xs space-y-2 text-slate-600 dark:text-slate-300">
          <p>${txMsg('Seluruh transaksi, dompet, aset, anggaran, jadwal rutin, dan profil Anda akan <strong>dihapus permanen</strong> dan tidak bisa dipulihkan.', 'All your transactions, wallets, assets, budgets, recurring items, and profile will be <strong>permanently deleted</strong> and cannot be recovered.')}</p>
          <label for="del-acc-confirm" class="block font-bold pt-1">${txMsg('Ketik', 'Type')} <span class="text-rose-600">${keyword}</span> ${txMsg('untuk konfirmasi', 'to confirm')}</label>
          <input id="del-acc-confirm" type="text" autocomplete="off" class="swal2-input" style="margin:0;width:100%" placeholder="${keyword}">
        </div>`,
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: txMsg('Hapus Akun Permanen', 'Delete Permanently'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const v = String((document.getElementById('del-acc-confirm') || {}).value || '').trim().toUpperCase();
        if (v !== 'HAPUS' && v !== 'DELETE') {
          Swal.showValidationMessage(txMsg('Ketik HAPUS terlebih dahulu.', 'Type DELETE first to confirm.'));
          return false;
        }
        return v;
      }
    });
    if (!confirmRes.isConfirmed || !confirmRes.value) return;
    Swal.fire({ title: txMsg('Menghapus akun...', 'Deleting account...'), text: txMsg('Mohon tunggu sebentar.', 'Please wait a moment.'), allowOutsideClick: false, didOpen: () => Swal.showLoading(), customClass: { popup: getSwalClass() } });
    try {
      await callServer('api_deleteOwnAccount', confirmRes.value);
      await Swal.fire({ icon: 'success', title: txMsg('Akun Dihapus', 'Account Deleted'), text: txMsg('Seluruh data Anda telah dihapus permanen.', 'All of your data has been permanently deleted.'), timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      if (typeof root.logout === 'function') await root.logout();
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
      else Swal.fire({ icon: 'error', title: txMsg('Gagal Menghapus Akun', 'Failed to Delete Account'), text: String((err && err.message) || err), customClass: { popup: getSwalClass() } });
    }
  }

  const basePinLockAlertOpts = () => ({
    allowOutsideClick: false,
    allowEscapeKey: false,
    showDenyButton: true,
    denyButtonText: txMsg('Keluar', 'Sign Out'),
    denyButtonColor: '#64748b',
    customClass: { popup: getSwalClass() }
  });

  function showPinCooldownAlert(waitSec) {
    return Swal.fire({
      ...basePinLockAlertOpts(),
      icon: 'warning',
      title: txMsg('PIN Terkunci Sementara', 'PIN Temporarily Locked'),
      text: txMsg(`Terlalu banyak percobaan salah. Coba lagi dalam ${waitSec} detik.`, `Too many wrong attempts. Try again in ${waitSec} seconds.`),
      confirmButtonText: txMsg('Coba Lagi', 'Try Again')
    });
  }

  function promptAppPinInput(onBiometricSuccess) {
    const feat = root.__mkFeat || {};
    return Swal.fire({
      ...basePinLockAlertOpts(),
      title: txMsg('Masukkan PIN Aplikasi', 'Enter App PIN'),
      input: 'password',
      inputAttributes: { inputmode: 'numeric', maxlength: '6', autocomplete: 'off' },
      inputPlaceholder: txMsg('PIN 4–6 digit', '4–6 digit PIN'),
      confirmButtonText: txMsg('Buka Kunci', 'Unlock'),
      didOpen: () => {
        if (typeof feat.decoratePinModalBiometricButton === 'function') feat.decoratePinModalBiometricButton(onBiometricSuccess);
      }
    });
  }

  async function verifyAppPinIfEnabled() {
    const savedHash = localStorage.getItem('mk_app_pin_hash');
    if (!savedHash || sessionStorage.getItem('mk_pin_unlocked') === '1' || pinPromptShown) return;
    pinPromptShown = true;
    const mainEl = document.getElementById('mainContent');
    if (mainEl) mainEl.classList.add('blur-md', 'pointer-events-none');
    try {
      if (root.__mkFeat && typeof root.__mkFeat.tryBiometricUnlock === 'function' && await root.__mkFeat.tryBiometricUnlock()) {
        markPinUnlocked();
        return;
      }
      while (true) {
        const waitSec = getPinCooldownSeconds();
        if (waitSec > 0) {
          const waitRes = await showPinCooldownAlert(waitSec);
          if (waitRes.isDenied) { if (typeof root.logout === 'function') root.logout(); return; }
          continue;
        }
        let unlockedByBio = false;
        const res = await promptAppPinInput(() => { unlockedByBio = true; Swal.close(); });
        if (unlockedByBio) { markPinUnlocked(); break; }
        if (res.isDenied) { if (typeof root.logout === 'function') root.logout(); return; }
        if (await verifyPinMatches(String(res.value || '').trim(), savedHash)) { markPinUnlocked(); break; }
        const st = recordFailedPinAttempt();
        const left = Math.max(0, MAX_PIN_ATTEMPTS - st.attempts);
        const msg = st.lockedUntil ? txMsg('Batas percobaan tercapai. Terkunci 60 detik.', 'Attempt limit reached. Locked for 60 seconds.') : txMsg(`Sisa ${left} percobaan.`, `${left} attempts left.`);
        await Swal.fire({ icon: 'error', title: txMsg('PIN salah', 'Incorrect PIN'), text: msg, timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      }
    } finally {
      pinPromptShown = false;
      if (mainEl) mainEl.classList.remove('blur-md', 'pointer-events-none');
    }
  }

  function buildQuickMenuCard(id, cardCls, iconCls, iconName, title, sub) {
    return `<button type="button" id="${id}" class="p-4 rounded-2xl border flex flex-col items-center justify-center gap-1.5 hover:shadow-sm transition-colors ${cardCls}">` +
      `<span class="w-10 h-10 rounded-xl flex items-center justify-center ${iconCls}"><i class="ph-bold ph-${iconName} text-xl" aria-hidden="true"></i></span>` +
      `<span>${title}</span><span class="text-[11px] font-medium opacity-80">${sub}</span></button>`;
  }

  async function openQuickAddMenu() {
    const cards = [
      buildQuickMenuCard('fab-out', 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/40', 'bg-rose-100 dark:bg-rose-500/20', 'minus-circle', txMsg('Pengeluaran', 'Expense'), txMsg('Catat biaya harian', 'Record daily spending')),
      buildQuickMenuCard('fab-in', 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/40', 'bg-emerald-100 dark:bg-emerald-500/20', 'plus-circle', txMsg('Pemasukan', 'Income'), txMsg('Gaji atau pendapatan', 'Salary or earnings')),
      buildQuickMenuCard('fab-ocr', 'bg-brand/10 text-brand dark:text-brand-ink border-brand/25', 'bg-brand/15', 'camera', txMsg('Scan Struk AI', 'AI Receipt Scan'), txMsg('Foto nota belanja', 'Snap shopping receipt')),
      buildQuickMenuCard('fab-tf', 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700', 'bg-slate-200/80 dark:bg-slate-700', 'arrows-left-right', txMsg('Transfer Dompet', 'Wallet Transfer'), txMsg('Pindah antar saldo', 'Move funds between wallets'))
    ].join('');
    return Swal.fire({
      title: txMsg('Catat Cepat', 'Quick Entry'),
      html: `<div class="grid grid-cols-2 gap-3 text-xs font-bold">${cards}</div>`,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: t('btn.tutup'),
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        document.getElementById('fab-out')?.addEventListener('click', () => { Swal.close(); openForm('Pengeluaran'); });
        document.getElementById('fab-in')?.addEventListener('click', () => { Swal.close(); openForm('Pemasukan'); });
        document.getElementById('fab-ocr')?.addEventListener('click', () => { Swal.close(); openForm('Pengeluaran'); setTimeout(() => triggerReceiptOcr(), 120); });
        document.getElementById('fab-tf')?.addEventListener('click', () => { Swal.close(); openTransferModal('transfer'); });
      }
    });
  }

  async function installPwaApp() {
    const promptEvt = root._deferredPwaPrompt;
    if (promptEvt && typeof promptEvt.prompt === 'function') {
      promptEvt.prompt();
      try {
        const choice = await promptEvt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          root._deferredPwaPrompt = null;
          document.getElementById('pwaInstallWrap')?.classList.add('hidden');
        }
      } catch (_) { /* ignore */ }
      return;
    }
    Swal.fire({
      icon: 'info',
      title: txMsg('Pasang di Layar Utama', 'Install to Home Screen'),
      html: `<p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${txMsg('Di <strong>iOS Safari</strong>, ketuk ikon <strong>Bagikan (Share)</strong> di bawah lalu pilih <strong>Add to Home Screen</strong>. Di <strong>Chrome/Edge</strong>, buka menu browser lalu pilih <strong>Install App</strong>.', 'On <strong>iOS Safari</strong>, tap the <strong>Share</strong> icon below then select <strong>Add to Home Screen</strong>. On <strong>Chrome/Edge</strong>, open the browser menu and select <strong>Install App</strong>.')}</p>`,
      confirmButtonText: txMsg('Mengerti', 'Got it'),
      customClass: { popup: getSwalClass() }
    });
  }

  function handlePwaShortcutAction() {
    if (root._pwaShortcutHandled || !root.isDataReady) return;
    const action = (new URLSearchParams(root.location.search || '').get('action') || '').toLowerCase();
    if (!action) return;
    root._pwaShortcutHandled = true;
    try {
      root.history.replaceState({}, document.title, root.location.pathname + root.location.hash);
    } catch (_) { /* ignore */ }
    setTimeout(() => {
      if (action === 'pengeluaran' && typeof openForm === 'function') openForm('Pengeluaran');
      else if (action === 'pemasukan' && typeof openForm === 'function') openForm('Pemasukan');
      else if (action === 'scan' && typeof openForm === 'function') {
        openForm('Pengeluaran');
        setTimeout(() => { if (typeof triggerReceiptOcr === 'function') triggerReceiptOcr(); }, 180);
      } else if (action === 'budgeting' && typeof switchView === 'function') switchView('budgeting');
    }, 120);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pinLastHiddenAt = Date.now();
    } else if (document.visibilityState === 'visible' && pinLastHiddenAt > 0) {
      const elapsed = Date.now() - pinLastHiddenAt;
      pinLastHiddenAt = 0;
      if (elapsed >= AUTO_LOCK_IDLE_MS && localStorage.getItem('mk_app_pin_hash') && !pinPromptShown) {
        try { sessionStorage.removeItem('mk_pin_unlocked'); } catch (_) { /* ignore */ }
        verifyAppPinIfEnabled();
      }
    }
  });

  async function saveInitialAppPin(pin) {
    if (localStorage.getItem('mk_app_pin_hash') || !/^\d{4,6}$/.test(String(pin || ''))) return false;
    localStorage.setItem('mk_app_pin_hash', await hashPin(String(pin)));
    markPinUnlocked();
    return true;
  }

  Object.assign(root, { openAccountSettingsModal, deleteOwnAccountFlow, openQuickAddMenu, installPwaApp });
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.saveInitialAppPin = saveInitialAppPin;
  root.__mkFeat.verifyAppPinIfEnabled = verifyAppPinIfEnabled;
  root.__mkFeat.handlePwaShortcutAction = handlePwaShortcutAction;
})(typeof window !== 'undefined' ? window : globalThis);
