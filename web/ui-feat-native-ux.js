/* global Swal, getSwalClass */
/* ============================================================
   FEATURES — NATIVE UX (PULL-TO-REFRESH, HAPTICS & BIOMETRIC)
   ============================================================ */
(function (root) {
  'use strict';

  const BIOMETRIC_ENABLED_KEY = 'mk_biometric_pin_enabled';
  const BIOMETRIC_CRED_KEY = 'mk_biometric_cred_id';
  const PTR_VIEWS = ['view-dashboard', 'view-histori', 'view-laporan', 'view-aset', 'view-budgeting'];

  const isEn = () => typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'en';
  const msg = (idStr, enStr) => (isEn() ? enStr : idStr);

  function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(b64) {
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isNativePlatform() {
    return Boolean(root.Capacitor && typeof root.Capacitor.isNativePlatform === 'function' && root.Capacitor.isNativePlatform());
  }

  function getNativeBiometricPlugin() {
    const cap = root.Capacitor;
    if (!cap) return null;
    if (cap.Plugins && cap.Plugins.NativeBiometric) return cap.Plugins.NativeBiometric;
    if (isNativePlatform() && typeof cap.registerPlugin === 'function' &&
        (typeof cap.isPluginAvailable !== 'function' || cap.isPluginAvailable('NativeBiometric'))) {
      try {
        const plugin = cap.registerPlugin('NativeBiometric');
        if (plugin) {
          cap.Plugins = cap.Plugins || {};
          cap.Plugins.NativeBiometric = plugin;
          return plugin;
        }
      } catch (_) { /* ignore missing native registration */ }
    }
    return null;
  }

  function resolveWebAuthnRpId() {
    const host = (root.location && root.location.hostname) ? String(root.location.hostname).trim() : '';
    if (!host || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return undefined;
    return host;
  }

  async function checkBiometricAvailability() {
    const isNative = isNativePlatform();
    const nativeBio = getNativeBiometricPlugin();
    if (nativeBio && typeof nativeBio.isAvailable === 'function') {
      try {
        const res = await nativeBio.isAvailable();
        if (res && res.isAvailable) return { supported: true, mode: 'native', reason: 'available' };
        if (isNative) return { supported: false, mode: 'native', reason: (res && res.reason) || 'unavailable' };
      } catch (err) {
        if (isNative) return { supported: false, mode: 'native', reason: (err && (err.code || err.message)) || 'unavailable' };
      }
    }
    if (isNative) return { supported: false, mode: 'native_missing', reason: 'native_plugin_missing' };
    if (root.isSecureContext === false) return { supported: false, mode: 'web', reason: 'insecure_context' };
    if (!root.PublicKeyCredential || typeof root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      return { supported: false, mode: 'web', reason: 'no_webauthn' };
    }
    try {
      const ok = await root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return { supported: Boolean(ok), mode: 'web', reason: ok ? 'available' : 'no_platform_authenticator' };
    } catch (_) {
      return { supported: false, mode: 'web', reason: 'no_platform_authenticator' };
    }
  }

  async function isBiometricUnlockSupported() {
    const res = await checkBiometricAvailability();
    return Boolean(res.supported);
  }

  function isBiometricUnlockEnabled() {
    try {
      return localStorage.getItem(BIOMETRIC_ENABLED_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function formatBiometricFailureReason(reasonOrErr) {
    const code = String((reasonOrErr && (reasonOrErr.code || reasonOrErr.name)) || reasonOrErr || '');
    const rawMsg = String((reasonOrErr && reasonOrErr.message) || reasonOrErr || '');
    const map = {
      none_enrolled: msg('Belum ada sidik jari/biometrik terdaftar di pengaturan perangkat.', 'No fingerprint/biometric is enrolled in device settings.'),
      no_hardware: msg('Perangkat ini tidak memiliki sensor sidik jari atau biometrik.', 'This device has no biometric hardware.'),
      hw_unavailable: msg('Sensor biometrik sedang sibuk atau tidak tersedia sementara.', 'Biometric sensor is temporarily unavailable.'),
      native_plugin_missing: msg('Modul biometrik native belum aktif di build aplikasi ini. Perbarui APK terbaru.', 'Native biometric module is missing in this build. Install the latest APK.'),
      insecure_context: msg('Kunci sidik jari di web memerlukan koneksi HTTPS yang aman.', 'Web biometric unlock requires a secure HTTPS connection.'),
      no_webauthn: msg('Browser atau WebView ini belum mendukung kunci biometrik.', 'This browser or WebView does not support biometric unlock.'),
      no_platform_authenticator: msg('Perangkat atau browser belum mengaktifkan autentikator sidik jari/layar kunci.', 'Platform biometric authenticator is unavailable on this device.'),
      SecurityError: msg('Origin saat ini tidak diizinkan untuk kunci biometrik WebAuthn.', 'Current origin is not permitted for WebAuthn biometrics.')
    };
    if (map[code]) return map[code];
    if (code === 'NotAllowedError' || code === '10' || code === '13' || /cancel|abort|timeout/i.test(rawMsg)) {
      return msg('Verifikasi biometrik dibatalkan atau waktu habis.', 'Biometric verification was cancelled or timed out.');
    }
    return rawMsg || msg('Gagal mengaktifkan kunci biometrik.', 'Failed to activate biometric unlock.');
  }

  async function waitSwalClosed() {
    if (typeof Swal === 'undefined' || typeof document === 'undefined') return;
    if (Swal.isVisible() || document.querySelector('.swal2-popup.swal2-hide')) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  async function enrollWebAuthnCredential() {
    if (!navigator.credentials || typeof navigator.credentials.create !== 'function') return '';
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userBytes = new TextEncoder().encode(String(root.sessionUser || 'mykeuguech-user').slice(0, 48));
    const rpId = resolveWebAuthnRpId();
    const rp = rpId ? { name: 'MyKeuGuech', id: rpId } : { name: 'MyKeuGuech' };
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp,
        user: { id: userBytes, name: String(root.sessionUser || 'user'), displayName: String(root.sessionUser || 'User') },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        timeout: 45000
      }
    });
    return cred && cred.rawId ? bytesToBase64Url(new Uint8Array(cred.rawId)) : '';
  }

  async function tryBiometricUnlock() {
    if (!isBiometricUnlockEnabled()) return false;
    const isNative = isNativePlatform();
    const nativeBio = getNativeBiometricPlugin();
    if (nativeBio && typeof nativeBio.verifyIdentity === 'function') {
      try {
        await nativeBio.verifyIdentity({
          title: 'MyKeuGuech',
          subtitle: msg('Verifikasi sidik jari atau wajah', 'Verify fingerprint or face'),
          reason: msg('Buka kunci MyKeuGuech', 'Unlock MyKeuGuech'),
          negativeButtonText: msg('Gunakan PIN', 'Use PIN')
        });
        return true;
      } catch (_) {
        return false;
      }
    }
    if (isNative) return false;
    const credId = localStorage.getItem(BIOMETRIC_CRED_KEY) || '';
    if (!credId || !navigator.credentials || typeof navigator.credentials.get !== 'function') return false;
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const rpId = resolveWebAuthnRpId();
      const publicKey = {
        challenge,
        allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(credId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 45000
      };
      if (rpId) publicKey.rpId = rpId;
      const assertion = await navigator.credentials.get({ publicKey });
      return Boolean(assertion);
    } catch (_) {
      return false;
    }
  }

  async function toggleBiometricUnlock() {
    if (!localStorage.getItem('mk_app_pin_hash')) {
      await waitSwalClosed();
      Swal.fire({ icon: 'info', title: msg('Atur PIN Dulu', 'Set PIN First'), text: msg('Simpan PIN 4–6 digit terlebih dahulu sebelum mengaktifkan biometrik.', 'Save a 4–6 digit PIN before enabling biometrics.'), customClass: { popup: getSwalClass() } });
      return;
    }
    if (isBiometricUnlockEnabled()) {
      localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
      localStorage.removeItem(BIOMETRIC_CRED_KEY);
      await waitSwalClosed();
      Swal.fire({ icon: 'info', title: msg('Biometrik dimatikan', 'Biometrics disabled'), timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      return;
    }
    const avail = await checkBiometricAvailability();
    if (!avail.supported) {
      await waitSwalClosed();
      Swal.fire({ icon: 'warning', title: msg('Tidak Didukung', 'Unsupported'), text: formatBiometricFailureReason(avail.reason), customClass: { popup: getSwalClass() } });
      return;
    }
    try {
      const nativeBio = getNativeBiometricPlugin();
      if (nativeBio && typeof nativeBio.verifyIdentity === 'function') {
        await nativeBio.verifyIdentity({
          title: 'MyKeuGuech',
          subtitle: msg('Aktifkan kunci biometrik', 'Enable biometric lock'),
          reason: msg('Tempelkan sidik jari untuk mengaktifkan buka kunci biometrik', 'Verify biometric to enable fingerprint unlock'),
          negativeButtonText: msg('Batal', 'Cancel')
        });
      } else {
        const credId = await enrollWebAuthnCredential();
        if (!credId) throw new Error(msg('Kredensial biometrik gagal dibuat.', 'Failed to create biometric credential.'));
        localStorage.setItem(BIOMETRIC_CRED_KEY, credId);
      }
      localStorage.setItem(BIOMETRIC_ENABLED_KEY, '1');
      if (typeof root.triggerHaptic === 'function') root.triggerHaptic('success');
      await waitSwalClosed();
      Swal.fire({ icon: 'success', title: msg('Biometrik Aktif!', 'Biometrics Enabled!'), timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      await waitSwalClosed();
      Swal.fire({ icon: 'warning', title: msg('Gagal Mengaktifkan', 'Activation Failed'), text: formatBiometricFailureReason(err), customClass: { popup: getSwalClass() } });
    }
  }

  function decoratePinModalBiometricButton(onSuccess) {
    if (!isBiometricUnlockEnabled() || typeof document === 'undefined' || typeof Swal === 'undefined') return;
    const popup = typeof Swal.getPopup === 'function' ? Swal.getPopup() : null;
    if (!popup || popup.querySelector('#mk-pin-bio-btn')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mk-pin-bio-wrap';
    wrap.className = 'mt-3';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mk-pin-bio-btn';
    btn.className = 'w-full min-h-10 py-2 px-3 rounded-xl bg-brand/10 text-brand dark:text-brand-ink text-xs font-bold inline-flex items-center justify-center gap-1.5';
    const icon = document.createElement('i');
    icon.className = 'ph ph-fingerprint text-base';
    icon.setAttribute('aria-hidden', 'true');
    const lbl = document.createElement('span');
    lbl.textContent = msg('Buka dengan Sidik Jari', 'Unlock with Biometrics');
    btn.append(icon, lbl);
    wrap.appendChild(btn);
    const actions = popup.querySelector('.swal2-actions');
    if (actions) popup.insertBefore(wrap, actions);
    else popup.appendChild(wrap);
    bindPinModalBiometricRetry(onSuccess);
  }

  function bindPinModalBiometricRetry(onSuccess) {
    const btn = typeof document !== 'undefined' ? document.getElementById('mk-pin-bio-btn') : null;
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        if (await tryBiometricUnlock()) {
          if (typeof onSuccess === 'function') onSuccess();
        }
      } finally {
        if (document.body && document.body.contains(btn)) btn.disabled = false;
      }
    });
  }

  function decorateAccountBiometricRow(hasPin) {
    const pinInput = document.getElementById('acc-pin-input');
    if (!pinInput || !pinInput.parentElement) return;
    const container = pinInput.parentElement;
    if (container.querySelector('#acc-bio-row')) return;
    const row = document.createElement('div');
    row.id = 'acc-bio-row';
    row.className = 'mt-2.5 flex flex-wrap gap-2';

    const bioBtn = document.createElement('button');
    bioBtn.type = 'button';
    const bioOn = hasPin && isBiometricUnlockEnabled();
    bioBtn.className = 'flex-1 min-h-10 px-3 py-2 rounded-xl border text-[11px] font-bold inline-flex items-center justify-center gap-1.5 ' +
      (bioOn ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200');
    const bioIcon = document.createElement('i');
    bioIcon.className = 'ph ph-fingerprint text-base';
    bioIcon.setAttribute('aria-hidden', 'true');
    const bioLabel = document.createElement('span');
    bioLabel.textContent = bioOn ? msg('Biometrik: Aktif', 'Biometrics: On') : msg('Aktifkan Sidik Jari', 'Enable Biometrics');
    bioBtn.append(bioIcon, bioLabel);
    bioBtn.addEventListener('click', async () => {
      const typedPin = String(pinInput.value || '').trim();
      const feat = root.__mkFeat || {};
      if (!localStorage.getItem('mk_app_pin_hash') && /^\d{4,6}$/.test(typedPin) && typeof feat.saveInitialAppPin === 'function') {
        await feat.saveInitialAppPin(typedPin);
      }
      Swal.close();
      await toggleBiometricUnlock();
    });

    const guideBtn = document.createElement('button');
    guideBtn.type = 'button';
    guideBtn.className = 'min-h-10 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[11px] font-bold inline-flex items-center justify-center gap-1.5';
    guideBtn.textContent = msg('Panduan Awal', 'Setup Wizard');
    guideBtn.addEventListener('click', () => {
      Swal.close();
      if (typeof root.openOnboardingWizard === 'function') root.openOnboardingWizard(true);
    });

    row.append(bioBtn, guideBtn);
    container.appendChild(row);
  }

  function ensurePullRefreshPill() {
    let pill = document.getElementById('mkPullRefreshPill');
    if (!pill && document.body) {
      pill = document.createElement('div');
      pill.id = 'mkPullRefreshPill';
      pill.setAttribute('aria-live', 'polite');
      pill.className = 'hide fixed left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg text-xs font-bold text-brand dark:text-brand-ink flex items-center gap-2 pointer-events-none';
      pill.style.top = 'calc(4.1rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))';
      document.body.appendChild(pill);
    }
    return pill;
  }

  function initPullToRefresh() {
    if (root.__mkPtrBound || typeof document === 'undefined') return;
    root.__mkPtrBound = true;
    let startY = 0;
    let tracking = false;
    let armed = false;
    let refreshing = false;

    const resetPill = () => {
      const pill = document.getElementById('mkPullRefreshPill');
      if (pill) pill.classList.add('hide');
      tracking = false;
      armed = false;
    };

    document.addEventListener('touchstart', (e) => {
      if (refreshing || !root.isDataReady || e.touches.length !== 1 || (root.scrollY || 0) > 2) return;
      if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
      const sb = document.getElementById('sidebar');
      if (sb && root.innerWidth < 1024 && !sb.classList.contains('-translate-x-full')) return;
      const t = e.target;
      if (t && t.closest && t.closest('.overflow-y-auto, .overflow-x-auto, .flatpickr-calendar, input, textarea, select')) return;
      const active = document.querySelector('.view-section:not(.hide)');
      if (!active || !PTR_VIEWS.includes(active.id)) return;
      startY = e.touches[0].clientY;
      tracking = true;
      armed = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      if (dy < 20) {
        if (dy < -12) resetPill();
        return;
      }
      const pill = ensurePullRefreshPill();
      if (!pill) return;
      pill.classList.remove('hide');
      const nowArmed = dy >= 76;
      if (nowArmed && !armed && typeof root.triggerHaptic === 'function') root.triggerHaptic('light');
      armed = nowArmed;
      pill.textContent = armed ? msg('Lepas untuk menyegarkan...', 'Release to refresh...') : msg('Tarik ke bawah untuk refresh...', 'Pull down to refresh...');
    }, { passive: true });

    document.addEventListener('touchend', async () => {
      if (!tracking) return;
      const shouldRefresh = armed && !refreshing;
      if (!shouldRefresh) { resetPill(); return; }
      refreshing = true;
      const pill = ensurePullRefreshPill();
      if (pill) { pill.classList.remove('hide'); pill.textContent = msg('Menyegarkan data...', 'Refreshing data...'); }
      try {
        if (navigator.onLine && typeof root.flushOfflineQueue === 'function') await root.flushOfflineQueue(true);
        if (typeof root.retryInitialAppLoad === 'function') await root.retryInitialAppLoad();
        if (typeof root.triggerHaptic === 'function') root.triggerHaptic('success');
      } finally {
        refreshing = false;
        resetPill();
      }
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', initPullToRefresh);
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('#mobileBottomNav button, [onclick*="addQuickNominalAmount"]') : null;
    if (btn && typeof root.triggerHaptic === 'function') root.triggerHaptic('light');
  });

  Object.assign(root, {
    isBiometricUnlockSupported,
    checkBiometricAvailability,
    isBiometricUnlockEnabled,
    toggleBiometricUnlock,
    tryBiometricUnlock,
    resolveWebAuthnRpId,
    formatBiometricFailureReason
  });
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.tryBiometricUnlock = tryBiometricUnlock;
  root.__mkFeat.isBiometricUnlockEnabled = isBiometricUnlockEnabled;
  root.__mkFeat.checkBiometricAvailability = checkBiometricAvailability;
  root.__mkFeat.bindPinModalBiometricRetry = bindPinModalBiometricRetry;
  root.__mkFeat.decoratePinModalBiometricButton = decoratePinModalBiometricButton;
  root.__mkFeat.decorateAccountBiometricRow = decorateAccountBiometricRow;
})(typeof window !== 'undefined' ? window : globalThis);
