/* global Swal */
/* supabase-auth.js — session check, Google OAuth, password recovery & offline profile cache */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, resolveReady, showCoreNotice } = core;

  const PROFILE_CACHE_KEY = 'mk_cached_profile_v1';
  const LOGOUT_STORAGE_KEYS = [
    'mk_gemini_api_key',
    'mk_gemini_model',
    'mk_gemini_thinking',
    'mk_app_pin_hash',
    'mk_app_pin_salt',
    'mk_pin_data_key_wrap',
    'mk_pin_lock_state_v1',
    'mk_cached_profile_v1',
    'mk_offline_tx_queue_v1',
    'mk_ai_analysis_cache_v1',
    'mk_ai_chat_history_v1',
    'mk_quick_templates_v1',
    'mk_autocat_rules_v1',
    'mk_rebalance_targets_v1',
    'mk_browser_notif_enabled',
    'mk_browser_notif_last_date',
    'mk_last_seen_release',
    'mk_onboarding_done_v1',
    'mk_auto_post_recurring',
    'mk_auto_post_last_date',
    'mk_native_notif_enabled',
    'mk_biometric_pin_enabled',
    'mk_biometric_cred_id'
  ];

  const showAuthNotice = (title, msg) => showCoreNotice(title, msg, { closable: true });
  const isAuthEn = () => localStorage.getItem('lang') === 'en';
  const authRedirectUrl = () => window.location.origin + window.location.pathname;

  function readCachedProfile(userId) {
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.userId === userId ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveCachedProfile(userId, displayName, role, status) {
    try {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
        userId,
        displayName,
        role,
        status,
        savedAt: new Date().toISOString()
      }));
    } catch (_) { /* ignore */ }
  }

  function applySessionIdentity(displayName, role) {
    window.sessionUser = displayName || 'User';
    window.sessionRole = role || 'user';
    const uEl = document.getElementById('ui-username');
    const rEl = document.getElementById('ui-role');
    if (uEl) uEl.textContent = window.sessionUser;
    if (rEl) rEl.textContent = window.sessionRole.toUpperCase();
    if (window.sessionRole === 'admin') {
      const admNav = document.getElementById('nav-admin');
      if (admNav) admNav.style.display = 'flex';
    }
  }

  async function finishLogin(session) {
    const user = session && session.user;
    const email = (user && user.email) || '';
    const meta = (user && user.user_metadata) || {};
    const fallbackName = String(meta.full_name || meta.name || email.split('@')[0] || 'User').slice(0, 60);
    try {
      applySessionIdentity(fallbackName, 'user');
      if (user && user.id) {
        const { data: prof, error } = await sb.from('profiles').select('display_name,role,status').eq('id', user.id).maybeSingle();
        fail(error);
        if (!prof) throw new Error('Profil akun belum tersedia. Hubungi administrator untuk menyelesaikan penyiapan akun.');
        if (prof.status !== 'active') {
          await showAuthNotice('Akun Nonaktif', 'Akun Anda belum aktif. Hubungi administrator untuk bantuan.');
          await sb.auth.signOut();
          location.reload();
          return;
        }
        applySessionIdentity(prof.display_name || fallbackName, prof.role || 'user');
        saveCachedProfile(user.id, window.sessionUser, window.sessionRole, prof.status);
      }
    } catch (e) {
      const cached = user && user.id ? readCachedProfile(user.id) : null;
      if (cached && cached.status === 'active') {
        applySessionIdentity(cached.displayName || fallbackName, cached.role || 'user');
      } else {
        console.error('finishLogin', e);
        await showAuthNotice('Gagal Memuat Profil', 'Tidak dapat memuat profil akun: ' + (e.message || String(e)));
      }
    }
    resolveReady();
  }

  let activeCheckPromise = null;
  async function checkActiveSession() {
    if (activeCheckPromise) return activeCheckPromise;
    activeCheckPromise = (async () => {
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (!authData.user) return;
      const { data: profile, error } = await sb.from('profiles').select('status').eq('id', authData.user.id).maybeSingle();
      fail(error);
      if (!profile || profile.status !== 'active') {
        await showAuthNotice('Sesi Berakhir', 'Akun Anda tidak lagi aktif. Sesi akan ditutup.');
        await sb.auth.signOut();
        location.reload();
      }
    })();
    try {
      await activeCheckPromise;
    } finally {
      activeCheckPromise = null;
    }
  }

  function refreshActiveSession() {
    if (!navigator.onLine) return;
    checkActiveSession().catch((error) => console.warn('Pengecekan status akun gagal:', error));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshActiveSession();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') refreshActiveSession();
  }, 60000);

  async function executeAuthSubmit(submitMode, el, errEl) {
    const authUi = window.__mkAuthUi || {};
    const en = isAuthEn();
    const email = el.querySelector('#mkEmail').value.trim();
    el.querySelectorAll('input').forEach((inp) => inp.removeAttribute('aria-invalid'));
    if (submitMode === 'login') {
      const pass = el.querySelector('#mkPass').value;
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) {
        errEl.textContent = (en ? 'Sign in failed: ' : 'Gagal masuk: ') + error.message;
        authUi.focusAuthErrorField(el, 'mkPass', true);
        return;
      }
      el.remove();
      activeLoginEl = null;
      finishLogin(data.session);
    } else if (submitMode === 'register') {
      const pass = el.querySelector('#mkPass').value;
      const passConfirm = el.querySelector('#mkPassConfirm').value;
      if (pass.length < 8 || pass.length > 128) {
        errEl.textContent = en ? 'Password must be 8 to 128 characters.' : 'Kata sandi harus terdiri dari 8 sampai 128 karakter.';
        authUi.focusAuthErrorField(el, 'mkPass', false);
        return;
      }
      if (pass !== passConfirm) {
        errEl.textContent = en ? 'Password confirmation does not match.' : 'Konfirmasi kata sandi tidak cocok.';
        authUi.focusAuthErrorField(el, 'mkPassConfirm', true);
        return;
      }
      const { data, error } = await sb.auth.signUp({ email, password: pass });
      if (error) {
        errEl.textContent = (en ? 'Sign up failed: ' : 'Pendaftaran gagal: ') + error.message;
        authUi.focusAuthErrorField(el, 'mkEmail', false);
        return;
      }
      if (data.session) {
        el.remove();
        activeLoginEl = null;
        finishLogin(data.session);
      } else {
        errEl.style.color = '#10b981';
        errEl.textContent = en ? 'Account created! Check your email or try signing in.' : 'Pendaftaran berhasil! Cek email untuk konfirmasi atau coba masuk.';
      }
    } else if (submitMode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
      if (error) {
        errEl.textContent = (en ? 'Failed to send reset link: ' : 'Gagal kirim reset: ') + error.message;
        authUi.focusAuthErrorField(el, 'mkEmail', false);
        return;
      }
      errEl.style.color = '#10b981';
      errEl.textContent = en ? 'Password reset link sent to your email.' : 'Link reset berhasil dikirim ke email Anda.';
    }
  }

  let activeLoginEl = null;

  function showLogin() {
    const authUi = window.__mkAuthUi || {};
    const theme = authUi.createAuthTheme();
    const el = document.createElement('div');
    activeLoginEl = el;
    if (theme.savedTheme) el.className = theme.savedTheme;
    el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(20px,var(--safe-area-inset-top,env(safe-area-inset-top,20px))) 16px max(24px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom,24px)));font-family:Inter,system-ui,sans-serif;overflow-y:auto;' +
      (theme.isDark ? 'background:radial-gradient(circle at top,#1e293b 0%,#020617 70%)' : 'background:radial-gradient(circle at top,#eef2ff 0%,#f1f5f9 75%)');
    let mode = 'login';
    let isSubmitting = false;
    let lastEmail = '';

    const bindFormEvents = () => {
      authUi.bindPassControls(el, isAuthEn, 'mkPass');
      [['#mkRegisterLink', 'register'], ['#mkLoginLink', 'login'], ['#mkForgotLink', 'forgot']].forEach(([sel, nextMode]) => {
        const node = el.querySelector(sel);
        if (node) {
          node.onclick = (ev) => {
            ev.preventDefault();
            if (isSubmitting) return;
            lastEmail = (el.querySelector('#mkEmail') || {}).value || lastEmail;
            mode = nextMode;
            renderForm();
          };
        }
      });
      const gBtn = el.querySelector('#mkGoogleBtn');
      if (gBtn) {
        gBtn.onclick = async () => {
          if (isSubmitting) return;
          isSubmitting = true;
          const errEl = el.querySelector('#mkErr');
          if (errEl) { errEl.textContent = ''; errEl.style.color = '#ef4444'; }
          gBtn.disabled = true;
          gBtn.style.opacity = '0.7';
          try {
            const useNativeOAuth = typeof window.isNativeApp === 'function' && window.isNativeApp() &&
              typeof window.startNativeOAuth === 'function';
            const { error } = useNativeOAuth
              ? await window.startNativeOAuth(sb, 'google')
              : await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirectUrl() } });
            if (error && errEl) errEl.textContent = (isAuthEn() ? 'Google Sign-In failed: ' : 'Login Google gagal: ') + error.message;
          } catch (oauthErr) {
            if (errEl) errEl.textContent = (isAuthEn() ? 'Google Sign-In failed: ' : 'Login Google gagal: ') + (oauthErr.message || String(oauthErr));
          } finally {
            isSubmitting = false;
            gBtn.disabled = false;
            gBtn.style.opacity = '';
          }
        };
      }
      el.querySelector('#mkAuthForm').onsubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        isSubmitting = true;
        const errEl = el.querySelector('#mkErr');
        const btn = el.querySelector('#mkSubmitBtn');
        const label = btn.textContent;
        errEl.textContent = '';
        errEl.style.color = '#ef4444';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.style.opacity = '0.7';
        btn.textContent = isAuthEn() ? 'Processing...' : 'Memproses...';
        try {
          await executeAuthSubmit(mode, el, errEl);
        } catch (error) {
          errEl.textContent = (isAuthEn() ? 'Failed: ' : 'Gagal: ') + (error.message || String(error));
        } finally {
          isSubmitting = false;
          const cur = el.querySelector('#mkSubmitBtn');
          if (cur) { cur.disabled = false; cur.removeAttribute('aria-busy'); cur.style.opacity = ''; cur.textContent = label; }
        }
      };
    };

    function renderForm() {
      const content = authUi.buildAuthModeFields(mode, theme, lastEmail, isAuthEn());
      const markup = `
        <div style="background:${theme.cardBg};padding:26px 24px;border-radius:28px;width:min(92vw,400px);box-shadow:0 25px 60px -15px rgba(15,23,42,${theme.isDark ? '0.65' : '0.18'});border:1px solid ${theme.inputBorder}">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid ${theme.inputBorder}">
            <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,var(--color-brand,#4f46e5) 0%,var(--color-brand-accent,#6366f1) 100%);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 10px 24px -10px rgb(var(--color-brand-rgb,79 70 229)/0.6)">
              <i class="ph-fill ph-wallet" aria-hidden="true" style="font-size:22px"></i>
            </div>
            <div>
              <h1 style="margin:0;font-size:19px;line-height:1.1;color:${theme.textMain};font-weight:800;letter-spacing:-0.02em">MyKeu<span style="color:var(--color-brand-ink,#4f46e5)">Guech</span></h1>
              <p style="margin:3px 0 0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:${theme.textMuted}">Personal Finance</p>
            </div>
          </div>
          <form id="mkAuthForm" style="display:grid;gap:9px">
            ${content}
            <p id="mkErr" role="status" aria-live="polite" style="margin:2px 0 0;color:#ef4444;font-size:12px;min-height:1em;text-align:center"></p>
          </form>
        </div>`;
      authUi.safeReplaceHtml(el, markup);
      bindFormEvents();
    }

    document.body.appendChild(el);
    renderForm();
    if (typeof window.hideNativeSplash === 'function') window.hideNativeSplash();
  }

  window.__mkHandleNativeAuthSession = function (session) {
    if (activeLoginEl) {
      activeLoginEl.remove();
      activeLoginEl = null;
    }
    finishLogin(session);
  };

  /* ============================================================
     K3 — LOGOUT GUARD: never purge an unsynced offline queue.
     The queue lives in IndexedDB ('mykeuangan_offline_db') with a
     localStorage mirror ('mk_offline_tx_queue_v1'). Queue readers
     here are defensive: the K2 encrypted-queue APIs
     (__mkFeat.getOfflineQueueSummary / exportOfflineQueuePlaintext /
     clearPinDataKey) are used when present, otherwise the legacy
     readers below are used. NOTE: ui-feat-offline.js does NOT expose
     getOfflineQueueItems() on window, so the IndexedDB read goes
     through the exposed __mkFeat.openOfflineDb() instead.
     ============================================================ */
  const OFFLINE_IDB_NAME = 'mykeuangan_offline_db';
  const OFFLINE_QUEUE_STORE_FALLBACK = 'pending_transactions';

  function swalPopupClass() {
    return typeof window.getSwalClass === 'function' ? window.getSwalClass() : '';
  }

  function confirmNative(message) {
    try { return window.confirm(message); } catch (_) { return false; }
  }

  async function readOfflineQueueItems() {
    const feat = window.__mkFeat || {};
    let idbItems = [];
    try {
      if (typeof feat.openOfflineDb === 'function' && 'indexedDB' in window) {
        const db = await feat.openOfflineDb();
        if (db) {
          const snapshotStore = feat.IDB_SNAPSHOT_STORE || 'offline_snapshot';
          const storeNames = Array.from(db.objectStoreNames || []);
          const storeName = storeNames.find((name) => name === OFFLINE_QUEUE_STORE_FALLBACK)
            || storeNames.find((name) => name !== snapshotStore)
            || OFFLINE_QUEUE_STORE_FALLBACK;
          idbItems = await new Promise((resolve) => {
            try {
              const tx = db.transaction(storeName, 'readonly');
              const req = tx.objectStore(storeName).getAll();
              req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
              req.onerror = () => resolve([]);
            } catch (_) { resolve([]); }
          });
        }
      }
    } catch (_) { /* fall through to the localStorage mirror */ }
    let localItems = [];
    try {
      localItems = typeof feat.readLocalQueue === 'function' ? feat.readLocalQueue() : [];
    } catch (_) { localItems = []; }
    if (!Array.isArray(localItems)) localItems = [];
    if (!idbItems.length) return localItems;
    const seen = new Set(idbItems.map((x) => x && x.localId));
    localItems.forEach((x) => { if (x && !seen.has(x.localId)) idbItems.push(x); });
    return idbItems;
  }

  function summarizeOfflineQueue(items) {
    const list = Array.isArray(items) ? items : [];
    const failed = list.filter((x) => x && x.failed).length;
    return { items: list, pending: list.length - failed, failed, total: list.length };
  }

  async function getOfflineQueueStatus() {
    const feat = window.__mkFeat || {};
    if (typeof feat.getOfflineQueueSummary === 'function') {
      try {
        const summary = await feat.getOfflineQueueSummary();
        if (summary && typeof summary === 'object'
          && (typeof summary.total === 'number' || typeof summary.pending === 'number')) {
          const pending = Math.max(0, Number(summary.pending) || 0);
          const failed = Math.max(0, Number(summary.failed) || 0);
          const total = typeof summary.total === 'number' ? Math.max(0, summary.total) : pending + failed;
          return { pending, failed, total, items: await readOfflineQueueItems() };
        }
      } catch (_) { /* fall through to the raw queue */ }
    }
    return summarizeOfflineQueue(await readOfflineQueueItems());
  }

  async function getOfflineQueueExportItems() {
    const feat = window.__mkFeat || {};
    if (typeof feat.exportOfflineQueuePlaintext === 'function') {
      try {
        const items = await feat.exportOfflineQueuePlaintext();
        if (Array.isArray(items)) return items;
        // null means the queue is locked (PIN): fall through to the raw queue
        // so the user still gets an export of whatever is readable.
      } catch (_) { /* fall through to the raw queue */ }
    }
    return readOfflineQueueItems();
  }

  function downloadOfflineQueueExport(items) {
    const payload = {
      exportedAt: new Date().toISOString(),
      user: window.sessionUser || '',
      items: Array.isArray(items) ? items : []
    };
    const json = JSON.stringify(payload, null, 2);
    const today = new Date().toISOString().slice(0, 10);
    const filename = 'MyKeuGuech_OfflineQueue_Emergency_' + today + '.json';
    if (typeof window.saveOrShareFile === 'function') {
      window.saveOrShareFile(json, filename, 'application/json;charset=utf-8');
      return;
    }
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Emergency export, then ask once more before logout deletes the queue.
  // Returns true only when the user confirms logout after the export.
  async function confirmEmergencyExportAndLogout() {
    const en = isAuthEn();
    let items = [];
    try {
      items = await getOfflineQueueExportItems();
      downloadOfflineQueueExport(items);
    } catch (err) {
      console.warn('Gagal membuat ekspor darurat antrean offline:', err);
      if (typeof Swal !== 'undefined') {
        await Swal.fire({
          icon: 'error',
          title: en ? 'Export Failed' : 'Ekspor Gagal',
          text: en ? 'Could not create the emergency export. Logout was cancelled; nothing was deleted.' : 'Ekspor darurat gagal dibuat. Logout dibatalkan; tidak ada data yang dihapus.',
          customClass: { popup: swalPopupClass() }
        });
      }
      return false;
    }
    if (typeof Swal === 'undefined') {
      return confirmNative(en
        ? 'Emergency export downloaded. Continue logging out and delete the local queue?'
        : 'Ekspor darurat sudah diunduh. Lanjutkan logout dan hapus antrean lokal?');
    }
    const res = await Swal.fire({
      icon: 'question',
      title: en ? 'Export created' : 'Ekspor dibuat',
      text: en
        ? 'The emergency export was downloaded. Continue logging out and delete the local queue?'
        : 'Ekspor darurat sudah diunduh. Lanjutkan logout dan hapus antrean lokal?',
      showCancelButton: true,
      confirmButtonText: en ? 'Log Out & Delete Queue' : 'Lanjutkan Logout & Hapus Antrean',
      cancelButtonText: en ? 'Cancel' : 'Batal',
      customClass: { popup: swalPopupClass() }
    });
    return !!res.isConfirmed;
  }

  // Shown when items remain after "Sync Now". Returns true when logout may proceed.
  async function handleRemainingQueueAfterSync(status) {
    const en = isAuthEn();
    const firstError = (status.items.find((x) => x && x.lastError) || {}).lastError || '';
    if (typeof Swal === 'undefined') {
      return confirmNative(en
        ? `Sync did not finish: ${status.total} transaction(s) still unsynced${firstError ? ' (first error: ' + firstError + ')' : ''}. Logging out will permanently delete them. Continue?`
        : `Sinkronisasi belum selesai: ${status.total} transaksi masih belum tersinkronisasi${firstError ? ' (alasan gagal pertama: ' + firstError + ')' : ''}. Logout akan menghapusnya secara permanen. Lanjutkan?`);
    }
    const res = await Swal.fire({
      icon: 'warning',
      title: en ? `${status.total} transaction(s) still unsynced` : `${status.total} transaksi masih belum tersinkronisasi`,
      text: (en ? `Sync did not finish (${status.pending} pending, ${status.failed} failed). ` : `Sinkronisasi belum selesai (${status.pending} menunggu, ${status.failed} gagal). `)
        + (firstError
          ? (en ? `First error: ${firstError} ` : `Alasan gagal pertama: ${firstError} `)
          : '')
        + (en ? 'Logging out now will also delete the remaining items.' : 'Logout sekarang juga akan menghapus item yang tersisa.'),
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: en ? 'Emergency Export' : 'Ekspor Darurat',
      denyButtonText: en ? 'Discard Failed & Log Out' : 'Buang Item Gagal & Lanjutkan Logout',
      cancelButtonText: en ? 'Cancel' : 'Batal',
      customClass: { popup: swalPopupClass() }
    });
    if (res.isConfirmed) return confirmEmergencyExportAndLogout();
    if (res.isDenied) {
      // Discard ONLY failed items — pending items are never discarded here.
      if (status.failed > 0 && typeof window.discardFailedOfflineItems === 'function') {
        try { await window.discardFailedOfflineItems(); } catch (_) { /* purge below still needs consent, which was given */ }
      }
      return true;
    }
    return false;
  }

  // Returns true when logout may proceed, false when it must be cancelled.
  // Never deletes anything itself — it only reads the queue and asks the user.
  async function guardOfflineQueueBeforeLogout() {
    const status = await getOfflineQueueStatus();
    if (!status.total) return true;
    const en = isAuthEn();
    if (typeof Swal === 'undefined') {
      return confirmNative(en
        ? `You have ${status.total} unsynced offline transaction(s) (${status.pending} pending, ${status.failed} failed). Logging out will permanently delete them. Continue logging out?`
        : `Ada ${status.total} transaksi offline yang belum tersinkronisasi (${status.pending} menunggu, ${status.failed} gagal). Logout akan menghapusnya secara permanen. Lanjutkan logout?`);
    }
    const res = await Swal.fire({
      icon: 'warning',
      title: en ? `${status.total} unsynced offline transaction(s)` : `${status.total} transaksi offline belum tersinkronisasi`,
      text: en
        ? 'Logging out will permanently delete these offline transactions before they reach the server. Sync them now, export them first, or cancel.'
        : 'Logout akan menghapus transaksi offline ini secara permanen sebelum sempat tersinkronisasi ke server. Sinkronkan sekarang, ekspor dulu, atau batalkan.',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: en ? 'Sync Now' : 'Sinkronkan Sekarang',
      denyButtonText: en ? 'Emergency Export' : 'Ekspor Darurat',
      cancelButtonText: en ? 'Cancel' : 'Batal',
      customClass: { popup: swalPopupClass() }
    });
    if (res.isDenied) return confirmEmergencyExportAndLogout();
    if (!res.isConfirmed) return false;
    try {
      if (typeof window.flushOfflineQueue === 'function') await window.flushOfflineQueue(false);
    } catch (_) { /* re-check below decides */ }
    const after = await getOfflineQueueStatus();
    if (!after.total) return true;
    return handleRemainingQueueAfterSync(after);
  }

  // K3: logout(opts) with opts = { force: false }.
  // force: true skips the offline-queue guard and runs the legacy purge as-is.
  // Use it only after the server account is already gone (e.g. from
  // deleteOwnAccountFlow after api_deleteOwnAccount succeeds), where the
  // queue can never sync again. Normal logouts must go through the guard.
  window.logout = async function (opts) {
    const force = !!(opts && opts.force);
    if (!force) {
      let mayProceed = false;
      try {
        mayProceed = await guardOfflineQueueBeforeLogout();
      } catch (err) {
        // Fail closed: never purge when the queue state is unknown.
        console.warn('Pemeriksaan antrean offline sebelum logout gagal:', err);
        mayProceed = false;
      }
      if (!mayProceed) return;
    }
    try {
      await sb.auth.signOut();
    } catch (_) {
      /* ignore signOut errors after account deletion or offline */
    }
    // T4 — fail-closed untuk token lokal: bila signOut() ke server gagal
    // (offline / server error), sesi di perangkat ini tetap harus mati.
    // signOut({ scope: 'local' }) menghapus sesi lokal tanpa round-trip
    // server; sapuan kunci di bawah menutup celah bila penyimpanan memakai
    // kunci kustom — kunci token Supabase (`sb-<ref>-auth-token`) TIDAK ada
    // di LOGOUT_STORAGE_KEYS, jadi tanpa sapuan ini token lama bisa
    // dipakai bootAuth untuk masuk otomatis setelah reload.
    try {
      if (sb.auth && typeof sb.auth.signOut === 'function') await sb.auth.signOut({ scope: 'local' });
    } catch (_) { /* ignore: sapuan kunci di bawah tetap berjalan */ }
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (typeof key === 'string' && /^sb-[^-]+-auth-token/.test(key)) localStorage.removeItem(key);
      }
    } catch (_) { /* ignore */ }
    LOGOUT_STORAGE_KEYS.forEach((k) => {
      try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
    });
    try {
      sessionStorage.removeItem('mk_pin_unlocked');
      sessionStorage.removeItem('mk_last_market_refresh_ts');
    } catch (_) { /* ignore */ }
    try {
      const feat = window.__mkFeat || {};
      if (typeof feat.clearPinDataKey === 'function') await feat.clearPinDataKey();
    } catch (_) { /* ignore */ }
    if ('indexedDB' in window) {
      try {
        await new Promise((resolve) => {
          const req = window.indexedDB.deleteDatabase(OFFLINE_IDB_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      } catch (_) { /* ignore */ }
    }
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (cacheErr) {
        console.warn('Gagal membersihkan cache logout:', cacheErr);
      }
    }
    location.reload();
  };

  core.bootAuth = function () {
    const authUi = window.__mkAuthUi || {};
    if (sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
      sb.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY' && typeof authUi.showPasswordRecoveryModal === 'function') {
          authUi.showPasswordRecoveryModal(sb, isAuthEn, showAuthNotice);
        }
      });
    }
    const start = async () => {
      const { data } = await sb.auth.getSession();
      if (data && data.session) finishLogin(data.session); else showLogin();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  };
})();
