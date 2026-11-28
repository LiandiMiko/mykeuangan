/* supabase-auth-ui.js — auth theme, Google OAuth UI, password recovery modal & legal links */
(function () {
  'use strict';

  const GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"/></svg>';

  function safeReplaceHtml(targetEl, htmlStr) {
    const doc = new DOMParser().parseFromString(htmlStr, 'text/html');
    doc.querySelectorAll('script').forEach((node) => node.remove());
    targetEl.replaceChildren(...Array.from(doc.body.childNodes));
  }

  function escapeAuthAttr(val) {
    return String(val == null ? '' : val).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function createAuthTheme() {
    const isDark = localStorage.getItem('mode') === 'dark' || document.documentElement.classList.contains('dark');
    const savedTheme = localStorage.getItem('theme') || '';
    const cardBg = isDark ? '#0f172a' : '#ffffff';
    const textMain = isDark ? '#f8fafc' : '#0f172a';
    const textMuted = isDark ? '#94a3b8' : '#64748b';
    const inputBg = isDark ? '#020617' : '#f8fafc';
    const inputBorder = isDark ? '#1e293b' : '#e2e8f0';
    const field = `width:100%;box-sizing:border-box;min-height:48px;padding:12px 14px;border:1px solid ${inputBorder};border-radius:14px;font-size:16px;background:${inputBg};color:${textMain};outline:none`;
    const passField = `width:100%;box-sizing:border-box;min-height:48px;padding:12px 44px 12px 14px;border:1px solid ${inputBorder};border-radius:14px;font-size:16px;background:${inputBg};color:${textMain};outline:none`;
    const fieldLabel = `display:block;font-size:11.5px;font-weight:700;color:${isDark ? '#cbd5e1' : '#334155'};margin-top:2px`;
    const toggleBtnStyle = `position:absolute;right:4px;top:50%;transform:translateY(-50%);width:42px;height:42px;border:0;border-radius:12px;background:transparent;color:${textMuted};display:inline-flex;align-items:center;justify-content:center;cursor:pointer`;
    const primaryBtn = 'width:100%;min-height:48px;padding:12px 16px;border:0;border-radius:16px;background:linear-gradient(135deg,var(--color-brand,#4f46e5) 0%,var(--color-brand-accent,#6366f1) 100%);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer;margin-top:6px;box-shadow:0 12px 28px -12px rgb(var(--color-brand-rgb,79 70 229)/0.55)';
    const googleBtn = `width:100%;min-height:48px;padding:11px 14px;border:1px solid ${inputBorder};border-radius:16px;background:${inputBg};color:${textMain};font-weight:700;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:10px`;
    const linkStyle = 'color:var(--color-brand-ink,#4f46e5);text-decoration:none';
    const passInputGroup = (id, placeholder, autocomplete, minLen, enterHint) => `
      <div style="position:relative">
        <input id="${id}" type="password" placeholder="${placeholder}" ${minLen ? `minlength="${minLen}"` : ''} required autocomplete="${autocomplete}" enterkeyhint="${enterHint || 'done'}" aria-describedby="mkErr" style="${passField}">
        <button type="button" data-toggle-pass="${id}" aria-pressed="false" aria-label="Tampilkan atau sembunyikan kata sandi" style="${toggleBtnStyle}">
          <i class="ph ph-eye" aria-hidden="true" style="font-size:17px"></i>
        </button>
      </div>`;
    return { isDark, savedTheme, cardBg, textMain, textMuted, inputBorder, field, fieldLabel, passInputGroup, primaryBtn, googleBtn, linkStyle };
  }

  function buildGoogleBlock(theme, en) {
    return `
      <div style="display:flex;align-items:center;gap:10px;margin:6px 0 2px">
        <span style="flex:1;height:1px;background:${theme.inputBorder}"></span>
        <span style="font-size:11px;font-weight:600;color:${theme.textMuted};text-transform:uppercase">${en ? 'or' : 'atau'}</span>
        <span style="flex:1;height:1px;background:${theme.inputBorder}"></span>
      </div>
      <button type="button" id="mkGoogleBtn" style="${theme.googleBtn}">
        ${GOOGLE_SVG}
        <span>${en ? 'Continue with Google' : 'Lanjutkan dengan Google'}</span>
      </button>`;
  }

  function buildLegalFooter(theme, en) {
    return `
      <p style="margin:6px 0 0;font-size:11px;color:${theme.textMuted};text-align:center;line-height:1.5">
        <a href="privacy.html" target="_blank" rel="noopener noreferrer" style="${theme.linkStyle}">${en ? 'Privacy Policy' : 'Kebijakan Privasi'}</a>
        ·
        <a href="terms.html" target="_blank" rel="noopener noreferrer" style="${theme.linkStyle}">${en ? 'Terms' : 'Syarat & Ketentuan'}</a>
      </p>`;
  }

  function buildAuthModeFields(mode, theme, savedEmail, en) {
    const tAuth = (idStr, enStr) => (en ? enStr : idStr);
    const { textMain, textMuted, field, fieldLabel, passInputGroup, primaryBtn, linkStyle } = theme;
    const emailAttr = escapeAuthAttr(savedEmail || '');
    const emailLabel = tAuth('Alamat Email', 'Email Address');
    const emailPh = tAuth('nama@email.com', 'name@email.com');
    const legalFooter = buildLegalFooter(theme, en);

    if (mode === 'login') {
      return `
        <h2 style="margin:0 0 2px;font-size:20px;color:${textMain};font-weight:800;letter-spacing:-0.02em">${tAuth('Masuk ke Akun', 'Sign In')}</h2>
        <p style="margin:0 0 10px;font-size:12.5px;color:${textMuted}">${tAuth('Kelola arus kas, dompet, dan portofolio Anda', 'Track your cashflow, wallets, and portfolio')}</p>
        <label for="mkEmail" style="${fieldLabel}">${emailLabel}</label>
        <input id="mkEmail" type="email" value="${emailAttr}" placeholder="${emailPh}" required autocomplete="username" autocapitalize="off" autocorrect="off" enterkeyhint="next" aria-describedby="mkErr" style="${field}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label for="mkPass" style="${fieldLabel}">${tAuth('Kata Sandi', 'Password')}</label>
          <a href="#" id="mkForgotLink" style="${linkStyle};font-size:11.5px;font-weight:600">${tAuth('Lupa kata sandi?', 'Forgot password?')}</a>
        </div>
        ${passInputGroup('mkPass', tAuth('Masukkan kata sandi', 'Enter password'), 'current-password', 0)}
        <button type="submit" id="mkSubmitBtn" style="${primaryBtn}">${tAuth('Masuk Sekarang', 'Sign In')}</button>
        ${buildGoogleBlock(theme, en)}
        <p style="margin:8px 0 0;font-size:12.5px;color:${textMuted};text-align:center">
          ${tAuth('Belum punya akun?', "Don't have an account?")} <a href="#" id="mkRegisterLink" style="${linkStyle};font-weight:700">${tAuth('Daftar gratis', 'Sign up free')}</a>
        </p>${legalFooter}`;
    }
    if (mode === 'register') {
      return `
        <h2 style="margin:0 0 2px;font-size:20px;color:${textMain};font-weight:800;letter-spacing:-0.02em">${tAuth('Daftar Akun Baru', 'Create Account')}</h2>
        <p style="margin:0 0 10px;font-size:12.5px;color:${textMuted}">${tAuth('Gratis & privat dengan proteksi isolasi data per pengguna', 'Free & private with per-user row-level security')}</p>
        <label for="mkEmail" style="${fieldLabel}">${emailLabel}</label>
        <input id="mkEmail" type="email" value="${emailAttr}" placeholder="${emailPh}" required autocomplete="username" autocapitalize="off" autocorrect="off" enterkeyhint="next" aria-describedby="mkErr" style="${field}">
        <label for="mkPass" style="${fieldLabel}">${tAuth('Kata Sandi (min. 8 karakter)', 'Password (min. 8 chars)')}</label>
        ${passInputGroup('mkPass', tAuth('Minimal 8 karakter', 'At least 8 characters'), 'new-password', 8, 'next')}
        <p id="mkPassStrength" style="margin:-2px 0 2px;font-size:11px;min-height:14px;font-weight:700"></p>
        <label for="mkPassConfirm" style="${fieldLabel}">${tAuth('Ulangi Kata Sandi', 'Confirm Password')}</label>
        ${passInputGroup('mkPassConfirm', tAuth('Ulangi kata sandi', 'Repeat password'), 'new-password', 8, 'done')}
        <button type="submit" id="mkSubmitBtn" style="${primaryBtn};background:linear-gradient(135deg,#059669 0%,#14b8a6 100%)">${tAuth('Daftar Akun', 'Create Account')}</button>
        ${buildGoogleBlock(theme, en)}
        <p style="margin:8px 0 0;font-size:12.5px;color:${textMuted};text-align:center">
          ${tAuth('Sudah punya akun?', 'Already have an account?')} <a href="#" id="mkLoginLink" style="${linkStyle};font-weight:700">${tAuth('Masuk di sini', 'Sign in')}</a>
        </p>${legalFooter}`;
    }
    return `
      <h2 style="margin:0 0 2px;font-size:20px;color:${textMain};font-weight:800;letter-spacing:-0.02em">${tAuth('Reset Kata Sandi', 'Reset Password')}</h2>
      <p style="margin:0 0 10px;font-size:12.5px;color:${textMuted}">${tAuth('Masukkan email terdaftar untuk menerima tautan reset', 'Enter your registered email to receive a reset link')}</p>
      <label for="mkEmail" style="${fieldLabel}">${emailLabel}</label>
      <input id="mkEmail" type="email" value="${emailAttr}" placeholder="${emailPh}" required autocomplete="username" autocapitalize="off" autocorrect="off" enterkeyhint="send" aria-describedby="mkErr" style="${field}">
      <button type="submit" id="mkSubmitBtn" style="${primaryBtn}">${tAuth('Kirim Link Reset', 'Send Reset Link')}</button>
      <p style="margin:10px 0 0;font-size:12.5px;color:${textMuted};text-align:center">
        ${tAuth('Kembali ke', 'Back to')} <a href="#" id="mkLoginLink" style="${linkStyle};font-weight:700">${tAuth('Halaman Masuk', 'Sign In')}</a>
      </p>${legalFooter}`;
  }

  function focusAuthErrorField(el, fieldId, selectValue) {
    const target = el && el.querySelector('#' + fieldId);
    if (!target) return;
    target.setAttribute('aria-invalid', 'true');
    if (typeof target.focus === 'function') target.focus();
    if (selectValue && typeof target.select === 'function') target.select();
  }

  function bindPassControls(el, isAuthEn, passInputId) {
    const inputSel = '#' + (passInputId || 'mkPass');
    el.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => inp.removeAttribute('aria-invalid'));
    });
    el.querySelectorAll('[data-toggle-pass]').forEach((btn) => {
      btn.onclick = () => {
        const input = el.querySelector('#' + btn.dataset.togglePass);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.setAttribute('aria-pressed', String(!showing));
        const icon = document.createElement('i');
        icon.className = `ph ph-${showing ? 'eye' : 'eye-slash'}`;
        icon.setAttribute('aria-hidden', 'true');
        icon.style.fontSize = '17px';
        btn.replaceChildren(icon);
      };
    });
    const passInput = el.querySelector(inputSel);
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

  // Wave 3.1 / S5 — shared password policy; length-only fallback when
  // web/password-policy.js has not been loaded (yet).
  function checkPasswordPolicy(pass, email, en) {
    const pol = (window.__mkFeat && window.__mkFeat.passwordPolicy) || window.__mkPasswordPolicy;
    if (pol && typeof pol.validatePassword === 'function') {
      const res = pol.validatePassword(pass, { email, lang: en ? 'en' : 'id' });
      return res.ok ? '' : (res.errors[0] && res.errors[0].message) || '';
    }
    if (typeof pass !== 'string' || pass.length < 8 || pass.length > 128) {
      return en ? 'Password must be 8 to 128 characters.' : 'Kata sandi harus terdiri dari 8 sampai 128 karakter.';
    }
    return '';
  }

  function showPasswordRecoveryModal(sb, isAuthEn, showAuthNotice) {
    if (document.getElementById('mkRecoveryOverlay')) return;
    const en = isAuthEn();
    const theme = createAuthTheme();
    const wrap = document.createElement('div');
    wrap.id = 'mkRecoveryOverlay';
    if (theme.savedTheme) wrap.className = theme.savedTheme;
    wrap.style.cssText = 'position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,0.72);backdrop-filter:blur(4px);font-family:Inter,system-ui,sans-serif;';
    safeReplaceHtml(wrap, `
      <div style="background:${theme.cardBg};padding:26px 22px;border-radius:24px;width:min(92vw,390px);border:1px solid ${theme.inputBorder};box-shadow:0 24px 60px -12px rgba(15,23,42,0.45)">
        <h2 style="margin:0 0 4px;font-size:19px;font-weight:800;color:${theme.textMain}">${en ? 'Set New Password' : 'Buat Kata Sandi Baru'}</h2>
        <p style="margin:0 0 12px;font-size:12.5px;color:${theme.textMuted}">${en ? 'Enter a new password for your account (min. 8 chars).' : 'Masukkan kata sandi baru untuk akun Anda (min. 8 karakter).'}</p>
        <form id="mkRecForm" style="display:grid;gap:9px">
          <label for="mkRecPass" style="${theme.fieldLabel}">${en ? 'New Password' : 'Kata Sandi Baru'}</label>
          ${theme.passInputGroup('mkRecPass', en ? 'At least 8 characters' : 'Minimal 8 karakter', 'new-password', 8, 'next')}
          <p id="mkPassStrength" style="margin:-2px 0 2px;font-size:11px;min-height:14px;font-weight:700"></p>
          <label for="mkRecPassConfirm" style="${theme.fieldLabel}">${en ? 'Confirm New Password' : 'Ulangi Kata Sandi Baru'}</label>
          ${theme.passInputGroup('mkRecPassConfirm', en ? 'Repeat new password' : 'Ulangi kata sandi baru', 'new-password', 8, 'done')}
          <button type="submit" id="mkRecSubmitBtn" style="${theme.primaryBtn}">${en ? 'Save New Password' : 'Simpan Kata Sandi Baru'}</button>
          <button type="button" id="mkRecCancelBtn" style="border:0;background:transparent;color:${theme.textMuted};font-size:12px;font-weight:600;padding:8px;cursor:pointer">${en ? 'Cancel' : 'Nanti Saja'}</button>
          <p id="mkErr" role="status" aria-live="polite" style="margin:0;color:#ef4444;font-size:12px;min-height:1em;text-align:center"></p>
        </form>
      </div>`);
    document.body.appendChild(wrap);
    bindPassControls(wrap, isAuthEn, 'mkRecPass');
    wrap.querySelector('#mkRecCancelBtn').onclick = () => wrap.remove();
    wrap.querySelector('#mkRecForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const errEl = wrap.querySelector('#mkErr');
      const btn = wrap.querySelector('#mkRecSubmitBtn');
      const pass = wrap.querySelector('#mkRecPass').value;
      const confirmPass = wrap.querySelector('#mkRecPassConfirm').value;
      // Email is needed for the "password contains email" rule; best
      // effort only — the check still runs without it.
      let recoveryEmail = null;
      try {
        const { data } = await sb.auth.getUser();
        recoveryEmail = (data && data.user && data.user.email) || null;
      } catch (_) { /* ignore: policy still applies without the email rule */ }
      const policyError = checkPasswordPolicy(pass, recoveryEmail, en);
      if (policyError) {
        errEl.textContent = policyError;
        focusAuthErrorField(wrap, 'mkRecPass', false);
        return;
      }
      if (pass !== confirmPass) {
        errEl.textContent = en ? 'Password confirmation does not match.' : 'Konfirmasi kata sandi tidak cocok.';
        focusAuthErrorField(wrap, 'mkRecPassConfirm', true);
        return;
      }
      btn.disabled = true;
      btn.textContent = en ? 'Saving...' : 'Menyimpan...';
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) {
        btn.disabled = false;
        btn.textContent = en ? 'Save New Password' : 'Simpan Kata Sandi Baru';
        errEl.textContent = toUserErrorMessage(error, en ? 'en' : 'id');
        return;
      }
      wrap.remove();
      await showAuthNotice(
        en ? 'Password Updated' : 'Kata Sandi Diperbarui',
        en ? 'Your account password has been updated successfully.' : 'Kata sandi baru berhasil disimpan.'
      );
    };
  }

  window.__mkAuthUi = {
    safeReplaceHtml,
    createAuthTheme,
    buildAuthModeFields,
    bindPassControls,
    focusAuthErrorField,
    showPasswordRecoveryModal
  };
})();
