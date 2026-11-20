/* global Swal, callServer, getSwalClass, escapeHtmlJS, showActionError, updateDashboardTitle, openForm, openTransferModal, triggerReceiptOcr, switchView, t */
/* ============================================================
   FEATURES — ACCOUNT SETTINGS, PIN LOCK, QUICK MENU & PWA INSTALL
   ============================================================ */
(function (root) {
  'use strict';

  let pinPromptShown = false;

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

  async function openAccountSettingsModal() {
    const hasPin = Boolean(localStorage.getItem('mk_app_pin_hash'));
    const res = await Swal.fire({
      title: 'Pengaturan Akun & Keamanan',
      html: `
        <div class="text-left space-y-3 text-xs">
          <div>
            <label for="acc-display-name" class="block font-bold text-slate-500 mb-1">Nama Tampilan</label>
            <input id="acc-display-name" class="swal2-input" style="margin:0;width:100%" maxlength="60" value="${escapeHtmlJS(root.sessionUser || '')}">
          </div>
          <div class="pt-2 border-t border-slate-200 dark:border-slate-700">
            <label for="acc-pin-input" class="block font-bold text-slate-500 mb-1">PIN Kunci Aplikasi Lokal (4–6 digit, ${hasPin ? 'Aktif' : 'Belum diatur'})</label>
            <input id="acc-pin-input" type="password" inputmode="numeric" maxlength="6" class="swal2-input" style="margin:0;width:100%" placeholder="${hasPin ? 'Kosongkan jika tetap / ketik PIN baru' : 'Contoh: 1234'}">
          </div>
          <div class="flex flex-wrap gap-2 pt-2">
            <button type="button" onclick="Swal.close();changeOwnPassword()" class="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">🔑 Ganti Password</button>
            ${hasPin ? '<button type="button" id="acc-clear-pin-btn" class="py-2.5 px-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 font-bold">🔓 Hapus PIN</button>' : ''}
          </div>
        </div>`,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        const clr = document.getElementById('acc-clear-pin-btn');
        if (clr) {
          clr.addEventListener('click', () => {
            localStorage.removeItem('mk_app_pin_hash');
            localStorage.removeItem('mk_app_pin_salt');
            sessionStorage.removeItem('mk_pin_unlocked');
            Swal.fire({ icon: 'info', title: 'PIN aplikasi dihapus', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
          });
        }
      },
      preConfirm: () => {
        const displayName = (document.getElementById('acc-display-name').value || '').trim();
        const pin = (document.getElementById('acc-pin-input').value || '').trim();
        if (displayName.length < 2) { Swal.showValidationMessage('Nama tampilan minimal 2 karakter.'); return false; }
        if (pin && !/^\d{4,6}$/.test(pin)) { Swal.showValidationMessage('PIN harus 4 sampai 6 angka.'); return false; }
        return { displayName, pin };
      }
    });

    if (!res.isConfirmed || !res.value) return;
    try {
      if (res.value.displayName !== root.sessionUser) {
        const out = await callServer('api_updateOwnProfile', res.value.displayName);
        if (out && out.displayName) {
          root.sessionUser = out.displayName;
          const uEl = document.getElementById('ui-username');
          if (uEl) uEl.innerText = root.sessionUser;
          if (typeof updateDashboardTitle === 'function') updateDashboardTitle();
        }
      }
      if (res.value.pin) {
        localStorage.setItem('mk_app_pin_hash', await hashPin(res.value.pin));
        sessionStorage.setItem('mk_pin_unlocked', '1');
      }
      Swal.fire({ icon: 'success', title: 'Pengaturan akun tersimpan', timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  async function verifyAppPinIfEnabled() {
    const savedHash = localStorage.getItem('mk_app_pin_hash');
    if (!savedHash || sessionStorage.getItem('mk_pin_unlocked') === '1' || pinPromptShown) return;
    pinPromptShown = true;
    const mainEl = document.getElementById('mainContent');
    if (mainEl) mainEl.classList.add('blur-md', 'pointer-events-none');
    try {
      while (true) {
        const res = await Swal.fire({
          title: 'Masukkan PIN Aplikasi',
          input: 'password',
          inputAttributes: { inputmode: 'numeric', maxlength: '6', autocomplete: 'off' },
          inputPlaceholder: 'PIN 4–6 digit',
          allowOutsideClick: false,
          allowEscapeKey: false,
          showDenyButton: true,
          denyButtonText: 'Keluar',
          denyButtonColor: '#64748b',
          confirmButtonText: 'Buka Kunci',
          customClass: { popup: getSwalClass() }
        });
        if (res.isDenied) {
          if (typeof root.logout === 'function') root.logout();
          return;
        }
        if (await verifyPinMatches(String(res.value || '').trim(), savedHash)) {
          sessionStorage.setItem('mk_pin_unlocked', '1');
          break;
        }
        await Swal.fire({ icon: 'error', title: 'PIN salah', timer: 1100, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      }
    } finally {
      if (mainEl) mainEl.classList.remove('blur-md', 'pointer-events-none');
    }
  }

  async function openQuickAddMenu() {
    return Swal.fire({
      title: 'Catat Cepat',
      html: `
        <div class="grid grid-cols-2 gap-3 text-xs font-bold">
          <button type="button" id="fab-out" class="p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40 flex flex-col items-center justify-center gap-1.5 hover:shadow-sm active:scale-[0.98] transition-all">
            <span class="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center"><i class="ph-bold ph-minus-circle text-xl" aria-hidden="true"></i></span>
            <span>Pengeluaran</span><span class="text-[10px] font-medium opacity-75">Catat biaya harian</span>
          </button>
          <button type="button" id="fab-in" class="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/40 flex flex-col items-center justify-center gap-1.5 hover:shadow-sm active:scale-[0.98] transition-all">
            <span class="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center"><i class="ph-bold ph-plus-circle text-xl" aria-hidden="true"></i></span>
            <span>Pemasukan</span><span class="text-[10px] font-medium opacity-75">Gaji atau pendapatan</span>
          </button>
          <button type="button" id="fab-ocr" class="p-4 rounded-2xl bg-brand/10 text-brand dark:text-brand-ink border border-brand/25 flex flex-col items-center justify-center gap-1.5 hover:shadow-sm active:scale-[0.98] transition-all">
            <span class="w-10 h-10 rounded-xl bg-brand/15 flex items-center justify-center"><i class="ph-bold ph-camera text-xl" aria-hidden="true"></i></span>
            <span>Scan Struk AI</span><span class="text-[10px] font-medium opacity-75">Foto nota belanja</span>
          </button>
          <button type="button" id="fab-tf" class="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-1.5 hover:shadow-sm active:scale-[0.98] transition-all">
            <span class="w-10 h-10 rounded-xl bg-slate-200/80 dark:bg-slate-700 flex items-center justify-center"><i class="ph-bold ph-arrows-left-right text-xl" aria-hidden="true"></i></span>
            <span>Transfer Dompet</span><span class="text-[10px] font-medium opacity-75">Pindah antar saldo</span>
          </button>
        </div>`,
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
      title: 'Pasang di Layar Utama',
      html: '<p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">Di <strong>iOS Safari</strong>, ketuk ikon <strong>Bagikan (Share)</strong> di bawah lalu pilih <strong>Add to Home Screen</strong>. Di <strong>Chrome/Edge</strong>, buka menu browser lalu pilih <strong>Install App</strong>.</p>',
      confirmButtonText: 'Mengerti',
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

  Object.assign(root, { openAccountSettingsModal, openQuickAddMenu, installPwaApp });
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.verifyAppPinIfEnabled = verifyAppPinIfEnabled;
  root.__mkFeat.handlePwaShortcutAction = handlePwaShortcutAction;
})(typeof window !== 'undefined' ? window : globalThis);
