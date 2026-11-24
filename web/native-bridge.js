/* global Swal, closeCommandPalette, toggleSidebar, switchView */
/* ============================================================
   NATIVE CAPACITOR BRIDGE (ANDROID / WEB FALLBACK)
   ============================================================ */
(function (root) {
  'use strict';

  const NATIVE_AUTH_REDIRECT_URL = 'com.mykeuguech.app://auth-callback';
  const HOSTED_WEB_ORIGIN = 'https://liandimiko.github.io/mykeuangan';
  const LEGAL_RELATIVE_PAGES = new Set(['privacy.html', 'terms.html', 'delete-account.html']);
  let lastBackPressedAt = 0;

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

  async function openExternalUrl(url) {
    const target = String(url || '').trim();
    if (!target) return;
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
      error: h.error_description || q.error_description || h.error || q.error || ''
    };
  }

  async function startNativeOAuth(sb, provider) {
    if (!sb || !sb.auth) return { error: new Error('Klien autentikasi belum siap.') };
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: provider || 'google',
      options: { redirectTo: NATIVE_AUTH_REDIRECT_URL, skipBrowserRedirect: true }
    });
    if (error) return { error };
    if (!data || !data.url) return { error: new Error('Tautan autentikasi Google tidak tersedia.') };
    await openExternalUrl(data.url);
    return { data };
  }

  async function handleNativeAppUrlOpen(rawUrl) {
    if (!String(rawUrl || '').startsWith(NATIVE_AUTH_REDIRECT_URL)) return;
    const Browser = getCapPlugin('Browser');
    if (Browser && typeof Browser.close === 'function') {
      try { await Browser.close(); } catch (_) { /* ignore */ }
    }
    const parsed = parseOAuthCallbackParams(rawUrl);
    if (parsed.error) {
      const notice = root.__mkSb && root.__mkSb.showCoreNotice;
      if (typeof notice === 'function') notice('Login Google Gagal', parsed.error, { closable: true });
      return;
    }
    const sb = root.__mkSb && root.__mkSb.sb;
    if (!sb || !sb.auth) return;
    try {
      let res = null;
      if (parsed.code) res = await sb.auth.exchangeCodeForSession(parsed.code);
      else if (parsed.accessToken && parsed.refreshToken) {
        res = await sb.auth.setSession({ access_token: parsed.accessToken, refresh_token: parsed.refreshToken });
      }
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
      if (mainEl && mainEl.classList.contains('blur-md')) {
        if (App && typeof App.minimizeApp === 'function') App.minimizeApp();
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
    syncNativeSystemBars,
    hideNativeSplash,
    parseOAuthCallbackParams,
    startNativeOAuth,
    handleAndroidBackButton
  });
})(typeof window !== 'undefined' ? window : globalThis);
