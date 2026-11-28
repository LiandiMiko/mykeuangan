/* global Swal, closeCommandPalette, toggleSidebar, switchView */
/* ============================================================
   NATIVE CAPACITOR BRIDGE (ANDROID / WEB FALLBACK)
   ============================================================ */
(function (root) {
  'use strict';

  const NATIVE_AUTH_REDIRECT_URL = 'com.mykeuguech.app://auth-callback';
  const HOSTED_WEB_ORIGIN = 'https://liandimiko.github.io/mykeuangan';
  // Wave 3.1 / S2 — OAuth state: single-use, stored in sessionStorage
  // before the browser opens, validated (constant-time) on callback.
  // A callback without a matching state is rejected before any token
  // exchange happens. Raw access_token/refresh_token URLs are NEVER
  // accepted (code + PKCE exchange only).
  const OAUTH_STATE_KEY = 'mk_oauth_state_v1';
  const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
  const LEGAL_RELATIVE_PAGES = new Set(['privacy.html', 'terms.html', 'delete-account.html']);
  let lastBackPressedAt = 0;
  let lastHandledOAuthUrl = '';

  function isNativeApp() {
    return Boolean(root.Capacitor && typeof root.Capacitor.isNativePlatform === 'function' && root.Capacitor.isNativePlatform());
  }

  function getNativePlatform() {
    if (!isNativeApp() || typeof root.Capacitor.getPlatform !== 'function') return 'web';
    return String(root.Capacitor.getPlatform() || 'web');
  }

  function getCapPlugin(name) {
    return (root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins[name]) || null;
  }

  function toExportBlob(blobOrData, mimeType) {
    if (typeof Blob !== 'undefined' && blobOrData instanceof Blob) return blobOrData;
    return new Blob([String(blobOrData == null ? '' : blobOrData)], { type: mimeType || 'text/plain;charset=utf-8' });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || '');
        const commaIdx = result.indexOf('base64,');
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 7) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('Gagal membaca data berkas.'));
      reader.readAsDataURL(blob);
    });
  }

  function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'export.bin';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveOrShareFile(blobOrData, filename, mimeType) {
    const safeName = String(filename || 'export.bin').replace(/[^a-zA-Z0-9._-]/g, '_') || 'export.bin';
    const blob = toExportBlob(blobOrData, mimeType);
    const Filesystem = getCapPlugin('Filesystem');
    const Share = getCapPlugin('Share');
    if (isNativeApp() && Filesystem && Share) {
      try {
        const base64 = await blobToBase64(blob);
        await Filesystem.writeFile({ path: safeName, data: base64, directory: 'CACHE' });
        const uriRes = await Filesystem.getUri({ directory: 'CACHE', path: safeName });
        await Share.share({ title: safeName, files: [uriRes.uri], url: uriRes.uri, dialogTitle: safeName });
        return;
      } catch (err) {
        if (/cancel|abort/i.test(String((err && err.message) || err))) return;
        console.warn('Native share gagal, fallback ke download:', err);
      }
    }
    triggerBrowserDownload(blob, safeName);
  }

  // Gelombang 4 (R16): validasi skema URL eksternal — dulu
  // openExternalUrl meneruskan string apa pun ke Browser.open /
  // window.open, sehingga javascript:/data:/file: bisa lolos dari data
  // yang tidak tepercaya (mis. tautan di data impor). Hanya http/https
  // yang diizinkan; URL relatif dianggap aman (diselesaikan ke origin
  // https aplikasi).
  function isSafeExternalUrl(url) {
    const target = String(url || '').trim();
    if (!target) return false;
    let parsed;
    try {
      parsed = new URL(target, 'https://app.invalid/');
    } catch (_) {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  }

  async function openExternalUrl(url) {
    const target = String(url || '').trim();
    if (!target || !isSafeExternalUrl(target)) return;
    const Browser = getCapPlugin('Browser');
    if (isNativeApp() && Browser && typeof Browser.open === 'function') {
      await Browser.open({ url: target });
      return;
    }
    root.open(target, '_blank', 'noopener,noreferrer');
  }

  async function syncNativeSystemBars(isDark) {
    if (!isNativeApp()) return;
    const style = isDark ? 'DARK' : 'LIGHT';
    const SystemBars = getCapPlugin('SystemBars');
    const StatusBar = getCapPlugin('StatusBar');
    try {
      if (SystemBars && typeof SystemBars.setStyle === 'function') await SystemBars.setStyle({ style });
      else if (StatusBar && typeof StatusBar.setStyle === 'function') await StatusBar.setStyle({ style });
    } catch (_) { /* ignore unsupported bar call */ }
  }

  async function hideNativeSplash() {
    if (!isNativeApp()) return;
    const SplashScreen = getCapPlugin('SplashScreen');
    if (SplashScreen && typeof SplashScreen.hide === 'function') {
      try { await SplashScreen.hide(); } catch (_) { /* ignore */ }
    }
  }

  async function triggerHaptic(kind) {
    if (!isNativeApp()) return;
    const Haptics = getCapPlugin('Haptics');
    if (!Haptics) return;
    const tone = String(kind || 'light').toLowerCase();
    try {
      if (['success', 'warning', 'error'].includes(tone) && typeof Haptics.notification === 'function') {
        await Haptics.notification({ type: tone.toUpperCase() });
      } else if (typeof Haptics.impact === 'function') {
        await Haptics.impact({ style: tone === 'medium' ? 'MEDIUM' : 'LIGHT' });
      }
    } catch (_) { /* ignore unsupported haptics */ }
  }

  async function captureReceiptNative() {
    const Camera = getCapPlugin('Camera');
    if (!isNativeApp() || !Camera || typeof Camera.getPhoto !== 'function') return { unavailable: true };
    try {
      const photo = await Camera.getPhoto({
        quality: 82,
        width: 1280,
        allowEditing: false,
        resultType: 'base64',
        source: 'PROMPT',
        promptLabelHeader: 'Scan Struk AI',
        promptLabelPhoto: 'Pilih dari Galeri',
        promptLabelPicture: 'Ambil Foto'
      });
      if (!photo || !photo.base64String) return { cancelled: true };
      const fmt = String(photo.format || 'jpeg').toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
      return { mimeType: fmt, base64: photo.base64String };
    } catch (err) {
      const msg = String((err && err.message) || err || '');
      return /cancel/i.test(msg) ? { cancelled: true } : { unavailable: true };
    }
  }

  async function scheduleNativeDailyReminder(enabled, hour, minute) {
    const LocalNotifications = getCapPlugin('LocalNotifications');
    if (!isNativeApp() || !LocalNotifications) return { ok: false, granted: false };
    try {
      if (typeof LocalNotifications.cancel === 'function') {
        await LocalNotifications.cancel({ notifications: [{ id: 2001 }] });
      }
      if (!enabled) return { ok: true, granted: true };
      let granted = true;
      if (typeof LocalNotifications.requestPermissions === 'function') {
        const perm = await LocalNotifications.requestPermissions();
        granted = Boolean(perm && perm.display === 'granted');
      }
      if (!granted || typeof LocalNotifications.schedule !== 'function') return { ok: false, granted };
      await LocalNotifications.schedule({
        notifications: [{
          id: 2001,
          title: 'Pengingat Catat Keuangan',
          body: 'Sudah catat pemasukan dan pengeluaranmu hari ini di MyKeuGuech?',
          schedule: { on: { hour: Number(hour) || 20, minute: Number(minute) || 0 }, repeats: true, allowWhileIdle: true }
        }]
      });
      return { ok: true, granted: true };
    } catch (_) {
      return { ok: false, granted: false };
    }
  }

  async function syncNativeBillReminders(dueBills) {
    const LocalNotifications = getCapPlugin('LocalNotifications');
    if (!isNativeApp() || !LocalNotifications || localStorage.getItem('mk_native_notif_enabled') !== '1') return;
    try {
      if (typeof LocalNotifications.checkPermissions === 'function') {
        const perm = await LocalNotifications.checkPermissions();
        if (!perm || perm.display !== 'granted') return;
      }
      const ids = [2101, 2102, 2103, 2104, 2105].map((id) => ({ id }));
      if (typeof LocalNotifications.cancel === 'function') await LocalNotifications.cancel({ notifications: ids });
      const items = (Array.isArray(dueBills) ? dueBills : []).slice(0, 5);
      if (!items.length || typeof LocalNotifications.schedule !== 'function') return;
      const fireAt = new Date(Date.now() + 8000);
      await LocalNotifications.schedule({
        notifications: items.map((b, idx) => ({
          id: 2101 + idx,
          title: `Tagihan Jatuh Tempo: ${String(b.kategori || 'Rutin')}`,
          body: `Nominal Rp ${Number(b.nominal || 0).toLocaleString('id-ID')} siap dicatat di MyKeuGuech.`,
          schedule: { at: new Date(fireAt.getTime() + idx * 1500) }
        }))
      });
    } catch (_) { /* ignore reminder scheduling errors */ }
  }

  function parseQuerySegment(segment) {
    const out = {};
    String(segment || '').replace(/^[?#]/, '').split('&').forEach((pair) => {
      if (!pair) return;
      const eqIdx = pair.indexOf('=');
      const rawKey = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
      const rawVal = eqIdx >= 0 ? pair.slice(eqIdx + 1) : '';
      try {
        const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
        if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
          out[key] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
        }
      } catch (_) { /* ignore malformed segment */ }
    });
    return out;
  }

  function parseOAuthCallbackParams(rawUrl) {
    const str = String(rawUrl || '');
    const hashIdx = str.indexOf('#');
    const beforeHash = hashIdx >= 0 ? str.slice(0, hashIdx) : str;
    const hashPart = hashIdx >= 0 ? str.slice(hashIdx + 1) : '';
    const qIdx = beforeHash.indexOf('?');
    const queryPart = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';
    const q = parseQuerySegment(queryPart);
    const h = parseQuerySegment(hashPart);
    return {
      code: q.code || h.code || '',
      accessToken: h.access_token || q.access_token || '',
      refreshToken: h.refresh_token || q.refresh_token || '',
      state: q.state || h.state || '',
      error: h.error_description || q.error_description || h.error || q.error || ''
    };
  }

  function base64UrlEncodeBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function generateOAuthState() {
    const bytes = new Uint8Array(32);
    const nonceBytes = new Uint8Array(32);
    root.crypto.getRandomValues(bytes);
    root.crypto.getRandomValues(nonceBytes);
    return { state: base64UrlEncodeBytes(bytes), nonce: base64UrlEncodeBytes(nonceBytes) };
  }

  function storeOAuthState() {
    const pair = generateOAuthState();
    try {
      sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({
        state: pair.state, nonce: pair.nonce, createdAt: Date.now()
      }));
    } catch (_) { /* storage unavailable: caller still must not proceed without state */ }
    return pair;
  }

  // Constant-time string comparison (lengths leak, contents do not).
  function timingSafeEqual(a, b) {
    const x = String(a || '');
    const y = String(b || '');
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0;
  }

  // Single-use: reads the stored state, deletes it immediately, then
  // validates presence, freshness and equality. Returns
  // { ok: true, nonce } or { ok: false, error }.
  function consumeOAuthState(returnedState) {
    let stored = null;
    try {
      const raw = sessionStorage.getItem(OAUTH_STATE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch (_) { stored = null; }
    try { sessionStorage.removeItem(OAUTH_STATE_KEY); } catch (_) { /* ignore */ }
    if (!stored || typeof stored.state !== 'string') return { ok: false, error: 'missing_state' };
    if (Date.now() - Number(stored.createdAt || 0) > OAUTH_STATE_TTL_MS) return { ok: false, error: 'expired_state' };
    if (!returnedState || !timingSafeEqual(returnedState, stored.state)) return { ok: false, error: 'state_mismatch' };
    return { ok: true, nonce: stored.nonce || '' };
  }

  async function startNativeOAuth(sb, provider) {
    if (!sb || !sb.auth) return { error: new Error('Klien autentikasi belum siap.') };
    // State (+nonce) is generated and stored BEFORE the auth URL opens,
    // and is carried through the provider via queryParams so Google
    // echoes it back to the redirect URL. If GoTrue ever stops echoing
    // a custom state, callbacks will be rejected (fail-closed) until the
    // flow is reworked — the raw-token fallback is gone either way.
    const pair = storeOAuthState();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: provider || 'google',
      options: {
        redirectTo: NATIVE_AUTH_REDIRECT_URL,
        skipBrowserRedirect: true,
        queryParams: { state: pair.state, nonce: pair.nonce }
      }
    });
    if (error) {
      try { sessionStorage.removeItem(OAUTH_STATE_KEY); } catch (_) { /* ignore */ }
      return { error };
    }
    if (!data || !data.url) {
      try { sessionStorage.removeItem(OAUTH_STATE_KEY); } catch (_) { /* ignore */ }
      return { error: new Error('Tautan autentikasi Google tidak tersedia.') };
    }
    await openExternalUrl(data.url);
    return { data };
  }

  async function handleNativeAppUrlOpen(rawUrl) {
    const url = String(rawUrl || '');
    if (!url.startsWith(NATIVE_AUTH_REDIRECT_URL) || url === lastHandledOAuthUrl) return;
    lastHandledOAuthUrl = url;
    const Browser = getCapPlugin('Browser');
    if (Browser && typeof Browser.close === 'function') {
      try { await Browser.close(); } catch (_) { /* ignore */ }
    }
    const parsed = parseOAuthCallbackParams(url);
    if (parsed.error) {
      const notice = root.__mkSb && root.__mkSb.showCoreNotice;
      if (typeof notice === 'function') notice('Login Google Gagal', parsed.error, { closable: true });
      return;
    }
    // S2: state is mandatory, single-use, constant-time compared.
    // Any callback without a matching state is rejected here — before
    // any exchange — so a crafted auth-callback URL cannot log anyone in.
    const stateCheck = consumeOAuthState(parsed.state);
    if (!stateCheck.ok) {
      const notice = root.__mkSb && root.__mkSb.showCoreNotice;
      if (typeof notice === 'function') {
        notice('Login Google Gagal',
          'Respons login tidak valid (state tidak cocok atau sudah kedaluwarsa). Silakan coba masuk lagi.',
          { closable: true });
      }
      return;
    }
    const sb = root.__mkSb && root.__mkSb.sb;
    if (!sb || !sb.auth) return;
    try {
      // Code + PKCE exchange ONLY. A URL carrying only raw
      // access_token/refresh_token is rejected: tokens in a URL can be
      // planted by any app that fires the custom scheme.
      if (!parsed.code) {
        const notice = root.__mkSb && root.__mkSb.showCoreNotice;
        if (typeof notice === 'function') {
          notice('Login Google Gagal',
            'Respons login tidak berisi kode otorisasi. Silakan coba masuk lagi.',
            { closable: true });
        }
        return;
      }
      const res = await sb.auth.exchangeCodeForSession(parsed.code);
      if (res && res.error) throw res.error;
      const session = res && res.data && res.data.session;
      if (session && typeof root.__mkHandleNativeAuthSession === 'function') {
        root.__mkHandleNativeAuthSession(session);
      }
    } catch (err) {
      const notice = root.__mkSb && root.__mkSb.showCoreNotice;
      if (typeof notice === 'function') notice('Login Google Gagal', (err && err.message) || String(err), { closable: true });
    }
  }

  async function checkNativeLaunchUrl() {
    if (!isNativeApp()) return;
    const App = getCapPlugin('App');
    if (!App || typeof App.getLaunchUrl !== 'function') return;
    try {
      const launch = await App.getLaunchUrl();
      if (launch && launch.url) await handleNativeAppUrlOpen(launch.url);
    } catch (_) { /* ignore */ }
  }

  function showNativeExitToast() {
    if (document.getElementById('mkNativeExitToast')) return;
    const isEn = typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'en';
    const toast = document.createElement('div');
    toast.id = 'mkNativeExitToast';
    toast.setAttribute('role', 'status');
    toast.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(5.25rem + var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)));z-index:1300;background:rgba(15,23,42,0.92);color:#f8fafc;padding:10px 18px;border-radius:999px;font-size:12px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,0.3);pointer-events:none;white-space:nowrap;';
    toast.textContent = isEn ? 'Press back again to exit' : 'Tekan kembali sekali lagi untuk keluar';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1900);
  }

  function handleAndroidBackButton() {
    const App = getCapPlugin('App');
    const recovery = document.getElementById('mkRecoveryOverlay');
    if (recovery) { recovery.remove(); return; }
    if (document.getElementById('mkCommandPalette') && typeof closeCommandPalette === 'function') {
      closeCommandPalette();
      return;
    }
    if (typeof Swal !== 'undefined' && Swal.isVisible()) {
      const mainEl = document.getElementById('mainContent');
      if (root.__mkForceUpdateActive || (mainEl && mainEl.classList.contains('blur-md'))) {
        if (App && typeof App.minimizeApp === 'function') App.minimizeApp();
        return;
      }
      const popup = typeof Swal.getPopup === 'function' ? Swal.getPopup() : null;
      if (popup && popup.classList.contains('swal2-hide')) {
        const container = typeof Swal.getContainer === 'function' ? Swal.getContainer() : null;
        if (container) container.remove();
        document.body.classList.remove('swal2-shown', 'swal2-height-auto');
        document.documentElement.classList.remove('swal2-shown', 'swal2-height-auto');
        return;
      }
      Swal.close();
      return;
    }
    const sb = document.getElementById('sidebar');
    if (sb && root.innerWidth < 1024 && !sb.classList.contains('-translate-x-full') && typeof toggleSidebar === 'function') {
      toggleSidebar();
      return;
    }
    const activeView = document.querySelector('.view-section:not(.hide)');
    if (activeView && activeView.id && activeView.id !== 'view-dashboard' && typeof switchView === 'function') {
      switchView('dashboard');
      return;
    }
    const now = Date.now();
    if (now - lastBackPressedAt < 2000 && App && typeof App.exitApp === 'function') {
      App.exitApp();
      return;
    }
    lastBackPressedAt = now;
    showNativeExitToast();
  }

  function bindNativeLinkInterceptor() {
    if (root.__mkNativeLinksBound) return;
    root.__mkNativeLinksBound = true;
    document.addEventListener('click', (ev) => {
      const anchor = ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('a[href]') : null;
      if (!anchor) return;
      const rawHref = (anchor.getAttribute('href') || '').trim();
      const targetUrl = LEGAL_RELATIVE_PAGES.has(rawHref) ? `${HOSTED_WEB_ORIGIN}/${rawHref}` : rawHref;
      const shouldIntercept = LEGAL_RELATIVE_PAGES.has(rawHref) ||
        (anchor.getAttribute('target') === '_blank' && /^https?:\/\//i.test(targetUrl));
      if (!shouldIntercept) return;
      ev.preventDefault();
      openExternalUrl(targetUrl);
    });
  }

  function initNativeBridge() {
    if (!isNativeApp()) return;
    const htmlEl = root.document && root.document.documentElement;
    if (htmlEl) htmlEl.classList.add('mk-native-app', `mk-platform-${getNativePlatform()}`);
    if (root.__mkNativeBridgeReady) return;
    root.__mkNativeBridgeReady = true;
    bindNativeLinkInterceptor();
    const isDark = (htmlEl && htmlEl.classList.contains('dark')) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('mode') === 'dark');
    syncNativeSystemBars(isDark);
    const App = getCapPlugin('App');
    if (App && typeof App.addListener === 'function') {
      App.addListener('backButton', handleAndroidBackButton);
      App.addListener('appUrlOpen', (ev) => {
        if (ev && ev.url) handleNativeAppUrlOpen(ev.url);
      });
    }
  }

  initNativeBridge();
  if (root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('DOMContentLoaded', () => {
      initNativeBridge();
      checkNativeLaunchUrl();
      if (isNativeApp()) {
        root.document.getElementById('pwaInstallWrap')?.classList.add('hidden');
        syncNativeSystemBars(root.document.documentElement.classList.contains('dark'));
      }
    });
  }

  Object.assign(root, {
    NATIVE_AUTH_REDIRECT_URL,
    isNativeApp,
    getNativePlatform,
    saveOrShareFile,
    openExternalUrl,
    isSafeExternalUrl,
    syncNativeSystemBars,
    hideNativeSplash,
    triggerHaptic,
    captureReceiptNative,
    scheduleNativeDailyReminder,
    syncNativeBillReminders,
    parseOAuthCallbackParams,
    startNativeOAuth,
    handleNativeAppUrlOpen,
    checkNativeLaunchUrl,
    handleAndroidBackButton
  });
  // Wave 3.1 / S2 — test/diagnostic surface for the OAuth state flow.
  root.__mkNativeOAuth = {
    OAUTH_STATE_KEY,
    OAUTH_STATE_TTL_MS,
    generateOAuthState,
    storeOAuthState,
    consumeOAuthState,
    timingSafeEqual
  };
})(typeof window !== 'undefined' ? window : globalThis);
