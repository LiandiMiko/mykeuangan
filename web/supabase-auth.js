/* supabase-auth.js — session check, brand-themed Auth modal & hardened logout */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, resolveReady, showCoreNotice } = core;

  const LOGOUT_STORAGE_KEYS = [
    'mk_gemini_api_key',
    'mk_gemini_model',
    'mk_app_pin_hash',
    'mk_app_pin_salt',
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

  function escapeAuthAttr(val) {
    return String(val == null ? '' : val).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const showAuthNotice = (title, msg) => showCoreNotice(title, msg, { closable: true });
  const isAuthEn = () => localStorage.getItem('lang') === 'en';

  async function finishLogin(session) {
    const user = session && session.user;
    const email = (user && user.email) || '';
    try {
      window.sessionUser = email.split('@')[0] || 'User';
      const uEl = document.getElementById('ui-username');
      if (uEl) uEl.textContent = window.sessionUser;

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
        if (prof.display_name) {
          window.sessionUser = prof.display_name;
          if (uEl) uEl.textContent = window.sessionUser;
        }
        window.sessionRole = prof.role || 'user';
        const rEl = document.getElementById('ui-role');
        if (rEl) rEl.textContent = window.sessionRole.toUpperCase();
        if (window.sessionRole === 'admin') {
          const admNav = document.getElementById('nav-admin');
          if (admNav) admNav.style.display = 'flex';
        }
      }
    } catch (e) {
      console.error('finishLogin', e);
      await showAuthNotice('Gagal Memuat Profil', 'Tidak dapat memuat profil akun: ' + (e.message || String(e)));
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
    checkActiveSession().catch((error) => console.warn('Pengecekan status akun gagal:', error));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshActiveSession();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') refreshActiveSession();
  }, 60000);

  function buildAuthModeFields(mode, theme, savedEmail) {
    const en = isAuthEn();
    const tAuth = (idStr, enStr) => (en ? enStr : idStr);
    const { textMain, textMuted, field, fieldLabel, passInputGroup, primaryBtn, linkStyle } = theme;
    const emailAttr = escapeAuthAttr(savedEmail || '');
    const emailLabel = tAuth('Alamat Email', 'Email Address');
    const emailPh = tAuth('nama@email.com', 'name@email.com');
    if (mode === 'login') {
      return `
        <h2 style="margin:0 0 2px;font-size:20px;color:${textMain};font-weight:800;letter-spacing:-0.02em">${tAuth('Masuk ke Akun', 'Sign In')}</h2>
        <p style="margin:0 0 10px;font-size:12.5px;color:${textMuted}">${tAuth('Kelola arus kas, dompet, dan portofolio Anda', 'Track your cashflow, wallets, and portfolio')}</p>
        <label for="mkEmail" style="${fieldLabel}">${emailLabel}</label>
        <input id="mkEmail" type="email" value="${emailAttr}" placeholder="${emailPh}" required autocomplete="username" aria-describedby="mkErr" style="${field}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label for="mkPass" style="${fieldLabel}">${tAuth('Kata Sandi', 'Password')}</label>
          <a href="#" id="mkForgotLink" style="${linkStyle};font-size:11.5px;font-weight:600">${tAuth('Lupa kata sandi?', 'Forgot password?')}</a>
        </div>
        ${passInputGroup('mkPass', tAuth('Masukkan kata sandi', 'Enter password'), 'current-password', 0)}
        <button type="submit" id="mkSubmitBtn" style="${primaryBtn}">${tAuth('Masuk Sekarang', 'Sign In')}</button>
        <p style="margin:10px 0 0;font-size:12.5px;color:${textMuted};text-align:center">
          ${tAuth('Belum punya akun?', "Don't have an account?")} <a href="#" id="mkRegisterLink" style="${linkStyle};font-weight:700">${tAuth('Daftar gratis', 'Sign up free')}</a>
        </p>`;
    }
    if (mode === 'register') {
      return `
        <h2 style="margin:0 0 2px;font-size:20px;color:${textMain};font-weight:800;letter-spacing:-0.02em">${tAuth('Daftar Akun Baru', 'Create Account')}</h2>
        <p style="margin:0 0 10px;font-size:12.5px;color:${textMuted}">${tAuth('Gratis & privat dengan proteksi isolasi data per pengguna', 'Free & private with per-user row-level security')}</p>
        <label for="mkEmail" style="${fieldLabel}">${emailLabel}</label>
        <input id="mkEmail" type="email" value="${emailAttr}" placeholder="${emailPh}" required autocomplete="username" aria-describedby="mkErr" style="${field}">
        <label for="mkPass" style="${fieldLabel}">${tAuth('Kata Sandi (min. 8 karakter)', 'Password (min. 8 chars)')}</label>
        ${passInputGroup('mkPass', tAuth('Minimal 8 karakter', 'At least 8 characters'), 'new-password', 8)}
        <p id="mkPassStrength" style="margin:-2px 0 2px;font-size:11px;min-height:14px;font-weight:700"></p>
        <label for="mkPassConfirm" style="${fieldLabel}">${tAuth('Ulangi Kata Sandi', 'Confirm Password')}</label>
        ${passInputGroup('mkPassConfirm', tAuth('Ulangi kata sandi', 'Repeat password'), 'new-password', 8)}
        <button type="submit" id="mkSubmitBtn" style="${primaryBtn};background:linear-gradient(135deg,#059669 0%,#14b8a6 100%)">${tAuth('Daftar Akun', 'Create Account')}</button>
        <p style="margin:10px 0 0;font-size:12.5px;color:${textMuted};text-align:center">
          ${tAuth('Sudah punya akun?', 'Already have an account?')} <a href="#" id="mkLoginLink" style="${linkStyle};font-weight:700">${tAuth('Masuk di sini', 'Sign in')}</a>
        </p>`;
    }
    return `
      <h2 style="margin:0 0 2px;font-size:20px;color:${textMain};font-weight:800;letter-spacing:-0.02em">${tAuth('Reset Kata Sandi', 'Reset Password')}</h2>
      <p style="margin:0 0 10px;font-size:12.5px;color:${textMuted}">${tAuth('Masukkan email terdaftar untuk menerima tautan reset', 'Enter your registered email to receive a reset link')}</p>
      <label for="mkEmail" style="${fieldLabel}">${emailLabel}</label>
      <input id="mkEmail" type="email" value="${emailAttr}" placeholder="${emailPh}" required autocomplete="username" aria-describedby="mkErr" style="${field}">
      <button type="submit" id="mkSubmitBtn" style="${primaryBtn}">${tAuth('Kirim Link Reset', 'Send Reset Link')}</button>
      <p style="margin:10px 0 0;font-size:12.5px;color:${textMuted};text-align:center">
        ${tAuth('Kembali ke', 'Back to')} <a href="#" id="mkLoginLink" style="${linkStyle};font-weight:700">${tAuth('Halaman Masuk', 'Sign In')}</a>
      </p>`;
  }

  async function executeAuthSubmit(submitMode, el, errEl) {
    const en = isAuthEn();
    const email = el.querySelector('#mkEmail').value.trim();
    if (submitMode === 'login') {
      const pass = el.querySelector('#mkPass').value;
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) { errEl.textContent = (en ? 'Sign in failed: ' : 'Gagal masuk: ') + error.message; return; }
      el.remove();
      finishLogin(data.session);
    } else if (submitMode === 'register') {
      const pass = el.querySelector('#mkPass').value;
      const passConfirm = el.querySelector('#mkPassConfirm').value;
      if (pass.length < 8 || pass.length > 128) {
        errEl.textContent = en ? 'Password must be 8 to 128 characters.' : 'Kata sandi harus terdiri dari 8 sampai 128 karakter.';
        return;
      }
      if (pass !== passConfirm) { errEl.textContent = en ? 'Password confirmation does not match.' : 'Konfirmasi kata sandi tidak cocok.'; return; }
      const { data, error } = await sb.auth.signUp({ email, password: pass });
      if (error) { errEl.textContent = (en ? 'Sign up failed: ' : 'Pendaftaran gagal: ') + error.message; return; }
      if (data.session) {
        el.remove();
        finishLogin(data.session);
      } else {
        errEl.style.color = '#10b981';
        errEl.textContent = en ? 'Account created! Check your email or try signing in.' : 'Pendaftaran berhasil! Cek email untuk konfirmasi atau coba masuk.';
      }
    } else if (submitMode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if (error) { errEl.textContent = (en ? 'Failed to send reset link: ' : 'Gagal kirim reset: ') + error.message; return; }
      errEl.style.color = '#10b981';
      errEl.textContent = en ? 'Password reset link sent to your email.' : 'Link reset berhasil dikirim ke email Anda.';
    }
  }

  function createAuthTheme() {
    const isDark = localStorage.getItem('mode') === 'dark' || document.documentElement.classList.contains('dark');
    const savedTheme = localStorage.getItem('theme') || '';
    const cardBg = isDark ? '#0f172a' : '#ffffff';
    const textMain = isDark ? '#f8fafc' : '#0f172a';
    const textMuted = isDark ? '#94a3b8' : '#64748b';
    const inputBg = isDark ? '#020617' : '#f8fafc';
    const inputBorder = isDark ? '#1e293b' : '#e2e8f0';
    const field = `width:100%;box-sizing:border-box;min-height:44px;padding:11px 14px;border:1px solid ${inputBorder};border-radius:12px;font-size:13.5px;background:${inputBg};color:${textMain};outline:none`;
    const passField = `width:100%;box-sizing:border-box;min-height:44px;padding:11px 44px 11px 14px;border:1px solid ${inputBorder};border-radius:12px;font-size:13.5px;background:${inputBg};color:${textMain};outline:none`;
    const fieldLabel = `display:block;font-size:11.5px;font-weight:700;color:${isDark ? '#cbd5e1' : '#334155'};margin-top:2px`;
    const toggleBtnStyle = `position:absolute;right:6px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:10px;background:transparent;color:${textMuted};display:inline-flex;align-items:center;justify-content:center;cursor:pointer`;
    const primaryBtn = 'width:100%;min-height:46px;padding:12px 16px;border:0;border-radius:14px;background:linear-gradient(135deg,var(--color-brand,#4f46e5) 0%,var(--color-brand-accent,#6366f1) 100%);color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:6px;box-shadow:0 12px 28px -12px rgb(var(--color-brand-rgb,79 70 229)/0.55)';
    const linkStyle = 'color:var(--color-brand-ink,#4f46e5);text-decoration:none';
    const passInputGroup = (id, placeholder, autocomplete, minLen) => `
      <div style="position:relative">
        <input id="${id}" type="password" placeholder="${placeholder}" ${minLen ? `minlength="${minLen}"` : ''} required autocomplete="${autocomplete}" aria-describedby="mkErr" style="${passField}">
        <button type="button" data-toggle-pass="${id}" aria-label="Tampilkan atau sembunyikan kata sandi" style="${toggleBtnStyle}">
          <i class="ph ph-eye" aria-hidden="true" style="font-size:17px"></i>
        </button>
      </div>`;
    return { isDark, savedTheme, cardBg, textMain, textMuted, inputBorder, field, fieldLabel, passInputGroup, primaryBtn, linkStyle };
  }

  function bindPassControls(el) {
    el.querySelectorAll('[data-toggle-pass]').forEach((btn) => {
      btn.onclick = () => {
        const input = el.querySelector('#' + btn.dataset.togglePass);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        const icon = document.createElement('i');
        icon.className = `ph ph-${showing ? 'eye' : 'eye-slash'}`;
        icon.setAttribute('aria-hidden', 'true');
        icon.style.fontSize = '17px';
        btn.replaceChildren(icon);
      };
    });
    const passInput = el.querySelector('#mkPass');
    const strengthEl = el.querySelector('#mkPassStrength');
    if (!passInput || !strengthEl) return;
    passInput.oninput = () => {
      const v = passInput.value;
      const en = isAuthEn();
      if (!v) { strengthEl.textContent = ''; return; }
      const strong = v.length >= 10 && /[A-Z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v);
      const fair = v.length >= 8 && /[A-Za-z]/.test(v) && (/\d/.test(v) || /[^A-Za-z0-9]/.test(v));
      strengthEl.style.color = v.length < 8 ? '#e11d48' : strong ? '#059669' : fair ? '#d97706' : '#0284c7';
      strengthEl.textContent = v.length < 8
        ? (en ? 'Too short (min. 8 chars)' : 'Terlalu pendek (min. 8 karakter)')
        : strong ? (en ? 'Strength: Strong' : 'Kekuatan: Kuat')
          : fair ? (en ? 'Strength: Fair' : 'Kekuatan: Cukup') : (en ? 'Strength: Weak' : 'Kekuatan: Lemah');
    };
  }

  function showLogin() {
    const theme = createAuthTheme();
    const el = document.createElement('div');
    if (theme.savedTheme) el.className = theme.savedTheme;
    el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif;' +
      (theme.isDark ? 'background:radial-gradient(circle at top,#1e293b 0%,#020617 70%)' : 'background:radial-gradient(circle at top,#eef2ff 0%,#f1f5f9 75%)');
    let mode = 'login';
    let isSubmitting = false;
    let lastEmail = '';

    const bindFormEvents = () => {
      bindPassControls(el);
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
      const content = buildAuthModeFields(mode, theme, lastEmail);
      const markup = `
        <div style="background:${theme.cardBg};padding:28px 24px;border-radius:24px;width:min(92vw,400px);box-shadow:0 25px 60px -15px rgba(15,23,42,${theme.isDark ? '0.65' : '0.18'});border:1px solid ${theme.inputBorder}">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${theme.inputBorder}">
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
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      doc.querySelectorAll('script').forEach((node) => node.remove());
      el.replaceChildren(...Array.from(doc.body.childNodes));
      bindFormEvents();
    }

    document.body.appendChild(el);
    renderForm();
  }

  window.logout = async function () {
    try {
      await sb.auth.signOut();
    } finally {
      LOGOUT_STORAGE_KEYS.forEach((k) => {
        try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
      });
      try { sessionStorage.removeItem('mk_pin_unlocked'); } catch (_) { /* ignore */ }
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
    const start = async () => {
      const { data } = await sb.auth.getSession();
      if (data && data.session) finishLogin(data.session); else showLogin();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  };
})();
