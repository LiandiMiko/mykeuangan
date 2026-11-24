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
    'mk_app_pin_hash',
    'mk_app_pin_salt',
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
    'mk_last_seen_release'
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

  function showLogin() {
    const authUi = window.__mkAuthUi || {};
    const theme = authUi.createAuthTheme();
    const el = document.createElement('div');
    if (theme.savedTheme) el.className = theme.savedTheme;
    el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;overflow-y:auto;' +
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
            const { error } = await sb.auth.signInWithOAuth({
              provider: 'google',
              options: { redirectTo: authRedirectUrl() }
            });
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
        <div style="background:${theme.cardBg};padding:26px 24px;border-radius:24px;width:min(92vw,400px);box-shadow:0 25px 60px -15px rgba(15,23,42,${theme.isDark ? '0.65' : '0.18'});border:1px solid ${theme.inputBorder}">
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
  }

  window.logout = async function () {
    try {
      await sb.auth.signOut();
    } catch (_) {
      /* ignore signOut errors after account deletion or offline */
    } finally {
      LOGOUT_STORAGE_KEYS.forEach((k) => {
        try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
      });
      try {
        sessionStorage.removeItem('mk_pin_unlocked');
        sessionStorage.removeItem('mk_last_market_refresh_ts');
      } catch (_) { /* ignore */ }
      if ('indexedDB' in window) {
        try { window.indexedDB.deleteDatabase('mykeuangan_offline_db'); } catch (_) { /* ignore */ }
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
    }
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
