// @depends-on: error-messages.js, ui-state.js
/* global DB, FinanceAnalysis, Swal, callServer, refreshFromServer, getSwalClass, showActionError, localToday, t, escapeHtmlJS, openExternalUrl */
/* ============================================================
   FEATURES — RELEASE UPDATES & NOTIFICATION BELL CENTER
   ============================================================ */
(function (root) {
  'use strict';

  const LAST_SEEN_RELEASE_KEY = 'mk_last_seen_release';
  const DISMISSED_UPDATE_KEY = 'mk_dismissed_update_version';
  const REMOTE_VERSION_URL = 'https://liandimiko.github.io/mykeuangan/version.json';
  const DEFAULT_ANDROID_RELEASE_URL = 'https://github.com/LiandiMiko/mykeuangan/releases/latest';
  let activeUpdatesTopic = 'all';
  let remoteUpdateChecked = false;
  let cachedRemoteUpdate = null;

  function getLatestReleaseMeta() {
    const viewEl = document.getElementById('view-updates');
    return {
      id: (viewEl && viewEl.getAttribute('data-latest-release')) || '',
      version: (viewEl && viewEl.getAttribute('data-latest-version')) || ''
    };
  }

  function hasUnreadRelease() {
    const meta = getLatestReleaseMeta();
    if (!meta.id) return false;
    try {
      return localStorage.getItem(LAST_SEEN_RELEASE_KEY) !== meta.id;
    } catch (_) {
      return false;
    }
  }

  function refreshUpdatesBadge() {
    const meta = getLatestReleaseMeta();
    const verEl = document.getElementById('navUpdatesVersion');
    if (verEl && meta.version) verEl.textContent = meta.version;
    const dotEl = document.getElementById('navUpdatesDot');
    if (dotEl) dotEl.classList.toggle('hide', !hasUnreadRelease());
  }

  function markLatestReleaseSeen() {
    const meta = getLatestReleaseMeta();
    if (!meta.id) return;
    try {
      localStorage.setItem(LAST_SEEN_RELEASE_KEY, meta.id);
    } catch (_) {
      /* ignore */
    }
    refreshUpdatesBadge();
    refreshNotificationBell();
  }

  function syncToggleAllReleasesButton() {
    const btn = document.getElementById('btnToggleAllReleases');
    const textEl = document.getElementById('btnToggleAllReleasesText');
    if (!btn || !textEl) return;
    const visibleDetails = Array.from(document.querySelectorAll('#updatesList [data-release-details]'))
      .filter((el) => !el.classList.contains('hide'));
    const allOpen = visibleDetails.length > 0 && visibleDetails.every((el) => el.open);
    const key = allOpen ? 'updates.collapse_all' : 'updates.expand_all';
    textEl.setAttribute('data-i18n', key);
    textEl.textContent = typeof t === 'function' ? t(key) : (allOpen ? 'Tutup Semua' : 'Buka Semua');
  }

  function filterUpdatesList() {
    const input = document.getElementById('updatesSearchInput');
    const query = String((input && input.value) || '').trim().toLowerCase();
    const cards = Array.from(document.querySelectorAll('#updatesList [data-release-card]'));
    const autoExpand = Boolean(query) || activeUpdatesTopic !== 'all';
    let visibleCount = 0;

    cards.forEach((card) => {
      const topics = String(card.getAttribute('data-topics') || '').split(/\s+/).filter(Boolean);
      const topicMatch = activeUpdatesTopic === 'all' || topics.includes(activeUpdatesTopic);
      const textMatch = !query || String(card.textContent || '').toLowerCase().includes(query);
      const visible = topicMatch && textMatch;
      card.classList.toggle('hide', !visible);
      if (card.hasAttribute('data-release-details')) card.open = visible && autoExpand;
      if (visible) visibleCount++;
    });

    const countEl = document.getElementById('updatesCountLabel');
    if (countEl) {
      const prefix = typeof t === 'function' ? t('updates.count_showing') : 'Menampilkan';
      const unit = typeof t === 'function' ? t('updates.count_unit') : 'rilis';
      countEl.textContent = `${prefix} ${visibleCount} ${unit}`;
    }
    const emptyEl = document.getElementById('updatesEmptyState');
    if (emptyEl) emptyEl.classList.toggle('hide', visibleCount > 0);
    syncToggleAllReleasesButton();
  }

  function setUpdatesTopic(topic) {
    activeUpdatesTopic = topic || 'all';
    document.querySelectorAll('[data-updates-topic]').forEach((btn) => {
      const isActive = btn.getAttribute('data-updates-topic') === activeUpdatesTopic;
      btn.classList.toggle('bg-brand', isActive);
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('shadow-xs', isActive);
      btn.classList.toggle('bg-slate-100', !isActive);
      btn.classList.toggle('dark:bg-slate-800', !isActive);
      btn.classList.toggle('text-slate-600', !isActive);
      btn.classList.toggle('dark:text-slate-300', !isActive);
    });
    filterUpdatesList();
  }

  function toggleAllReleaseDetails() {
    const visibleDetails = Array.from(document.querySelectorAll('#updatesList [data-release-details]'))
      .filter((el) => !el.classList.contains('hide'));
    const shouldOpen = visibleDetails.some((el) => !el.open);
    visibleDetails.forEach((el) => { el.open = shouldOpen; });
    syncToggleAllReleasesButton();
  }

  function getCurrentNotifications() {
    const feat = root.__mkFeat || {};
    const queue = typeof feat.readLocalQueue === 'function' ? feat.readLocalQueue() : [];
    const pendingItems = queue.filter((x) => !x.failed);
    const failedItems = queue.filter((x) => x.failed);
    const todayStr = localToday();
    const list = FinanceAnalysis.buildAppNotifications({
      budgets: DB.budgets,
      transactions: DB.transactions,
      recurring: DB.recurring,
      goals: DB.goals,
      offlineQueueCount: pendingItems.length
    }, DB.currentPeriod, DB.payrollDay, todayStr);

    if (failedItems.length > 0) {
      const sampleErr = failedItems[0].lastError ? ` (${String(failedItems[0].lastError).slice(0, 90)})` : '';
      list.unshift({
        id: 'offline:failed',
        severity: 'danger',
        title: `${failedItems.length} transaksi offline gagal sinkronisasi`,
        message: `Sinkronisasi ditolak server${sampleErr}. Coba ulang atau buang antrean bermasalah.`,
        actionType: 'offline_failed',
        actionPayload: { count: failedItems.length }
      });
    }

    if (hasUnreadRelease()) {
      const meta = getLatestReleaseMeta();
      const rawTitle = typeof t === 'function' ? t('updates.notif_title') : 'Pembaruan {version} Tersedia';
      const rawMsg = typeof t === 'function' ? t('updates.notif_msg') : 'Lihat fitur baru dan perbaikan keamanan terbaru di halaman Pembaruan.';
      list.unshift({
        id: 'release-' + meta.id,
        severity: 'info',
        title: rawTitle.replace('{version}', meta.version || ''),
        message: rawMsg,
        actionType: 'view',
        actionPayload: { view: 'updates' }
      });
    }
    return list;
  }

  function refreshNotificationBell() {
    refreshUpdatesBadge();
    const badge = document.getElementById('notifBadge');
    if (!badge || !root.isDataReady) return;
    const list = getCurrentNotifications();
    if (list.length > 0) {
      badge.textContent = list.length > 99 ? '99+' : String(list.length);
      badge.classList.remove('hide');
    } else {
      badge.textContent = '0';
      badge.classList.add('hide');
    }
  }

  async function recordRecurringFromNotif(recId) {
    const item = (DB.recurring || []).find((r) => String(r.id) === String(recId));
    if (!item) return;
    Swal.close();
    try {
      const todayStr = localToday();
      const data = await callServer('api_addTransaction', {
        tanggal: todayStr,
        tipe: item.tipe,
        kategori: item.kategori,
        nominal: Number(item.nominal) || 0,
        keterangan: (item.keterangan ? item.keterangan + ' ' : '') + '(rutin)',
        walletId: (DB.wallets && DB.wallets[0] && DB.wallets[0].id) || ''
      });
      let recData = null;
      if (item.id) {
        try { recData = await callServer('api_markRecurringRun', [item.id], todayStr); } catch (_) { /* ignore */ }
      }
      await refreshFromServer({ ...data, ...recData });
      Swal.fire({ icon: 'success', title: 'Jadwal rutin dicatat!', timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  // Gelombang 5.3 (Q10): delegasi ke escapeHtmlJS — yang sendiri
  // mendelegasikan ke escapeHtml() kanonis (error-messages.js).
  // Rantai replace lama dihapus; jangan salin lagi ke sini.
  function escUpdateHtml(value) {
    if (typeof escapeHtmlJS === 'function') return escapeHtmlJS(value);
    return escapeHtml(value);
  }

  function safeHttpsUrl(url, fallback) {
    const clean = String(url || '').trim();
    return /^https:\/\//i.test(clean) ? clean : fallback;
  }

  function parseSemverParts(raw) {
    const m = String(raw || '').trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/i);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
  }

  function compareSemver(a, b) {
    const pa = parseSemverParts(a);
    const pb = parseSemverParts(b);
    if (!pa || !pb) return 0;
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
  }

  function getInstalledAppVersion() {
    if (typeof document !== 'undefined') {
      const metaEl = document.querySelector('meta[name="app-version"]');
      const rawMeta = metaEl && metaEl.getAttribute('content');
      if (parseSemverParts(rawMeta)) return String(rawMeta).trim();
    }
    const parsed = parseSemverParts(getLatestReleaseMeta().version);
    return parsed ? parsed.join('.') : '0.0.0';
  }

  function evaluateRemoteVersion(currentVersion, manifest) {
    const m = manifest && typeof manifest === 'object' ? manifest : {};
    const curNorm = (parseSemverParts(currentVersion) || [0, 0, 0]).join('.');
    const latestParsed = parseSemverParts(m.version);
    const latestNorm = latestParsed ? latestParsed.join('.') : '';
    const minParsed = parseSemverParts(m.minSupportedVersion);
    const minNorm = minParsed ? minParsed.join('.') : '';
    const hasUpdate = Boolean(latestNorm) && compareSemver(curNorm, latestNorm) < 0;
    const forceUpdate = hasUpdate && Boolean(minNorm) && compareSemver(curNorm, minNorm) < 0;
    const notes = Array.isArray(m.notes) ? m.notes.map((n) => String(n || '').trim()).filter(Boolean).slice(0, 4) : [];
    return {
      hasUpdate,
      forceUpdate,
      currentVersion: curNorm,
      latestVersion: latestNorm || curNorm,
      minSupportedVersion: minNorm,
      releaseTitle: String(m.releaseTitle || '').trim(),
      notes,
      androidUrl: safeHttpsUrl(m.androidUrl, DEFAULT_ANDROID_RELEASE_URL),
      webUrl: safeHttpsUrl(m.webUrl, REMOTE_VERSION_URL.replace(/\/version\.json$/, '/'))
    };
  }

  function trUpdate(key, fallback, vars) {
    const base = typeof t === 'function' ? t(key) : '';
    let out = base && base !== key ? base : fallback;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach((k) => { out = out.replaceAll(`{${k}}`, String(vars[k] == null ? '' : vars[k])); });
    }
    return out;
  }

  function fireUpdateNotice(icon, titleText, textKey, fallback, vars) {
    if (typeof Swal === 'undefined') return null;
    return Swal.fire({
      icon,
      title: titleText,
      text: trUpdate(textKey, fallback, vars),
      customClass: { popup: typeof getSwalClass === 'function' ? getSwalClass() : '' }
    });
  }

  function renderRemoteUpdateBanner(status) {
    if (typeof document === 'undefined') return;
    const banner = document.getElementById('remoteUpdateBanner');
    if (!banner) return;
    if (!status || !status.hasUpdate) { banner.classList.add('hide'); return; }
    const titleEl = document.getElementById('remoteUpdateBannerTitle');
    const metaEl = document.getElementById('remoteUpdateBannerMeta');
    if (titleEl) titleEl.textContent = trUpdate('updates.available_title', 'Update v{latest} Tersedia', { latest: status.latestVersion });
    if (metaEl) metaEl.textContent = status.releaseTitle || trUpdate('updates.banner_desc', 'Versi baru aplikasi sudah tersedia. Segera perbarui agar fitur & keamanan tetap mutakhir.');
    banner.classList.remove('hide');
  }

  async function applyUpdateAction(status) {
    const isNative = typeof root.isNativeApp === 'function' && root.isNativeApp();
    if (isNative) {
      if (typeof openExternalUrl === 'function') await openExternalUrl(status.androidUrl);
      else if (typeof root.open === 'function') root.open(status.androidUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      if (root.navigator && 'serviceWorker' in root.navigator) {
        const reg = await root.navigator.serviceWorker.getRegistration();
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        else if (reg && typeof reg.update === 'function') await reg.update();
      }
    } catch (_) { /* ignore SW fallback */ }
    if (root.location && typeof root.location.reload === 'function') root.location.reload();
  }

  async function showAppUpdatePopup(status) {
    if (!status || !status.hasUpdate || typeof Swal === 'undefined') return null;
    const isNative = typeof root.isNativeApp === 'function' && root.isNativeApp();
    const title = status.forceUpdate
      ? trUpdate('updates.required_title', 'Wajib Update ke v{latest}', { latest: status.latestVersion })
      : trUpdate('updates.available_title', 'Update v{latest} Tersedia', { latest: status.latestVersion });
    const iconCls = status.forceUpdate ? 'ph-bold ph-warning-circle text-rose-600 dark:text-rose-400' : 'ph-bold ph-rocket-launch text-brand dark:text-brand-ink';
    const iconBg = status.forceUpdate ? 'bg-rose-100 dark:bg-rose-500/20' : 'bg-brand/10';
    const notesHtml = status.notes.length
      ? `<ul class="mt-3 space-y-1.5 text-left text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 rounded-2xl p-3 border border-slate-200/70 dark:border-slate-700/70">${status.notes.map((item) => `<li class="flex items-start gap-2"><i class="ph-bold ph-check-circle text-brand dark:text-brand-ink mt-0.5 shrink-0" aria-hidden="true"></i><span>${escUpdateHtml(item)}</span></li>`).join('')}</ul>`
      : '';
    const hintText = isNative
      ? trUpdate('updates.android_hint', 'Anda akan diarahkan ke halaman unduhan APK terbaru. Pasang tanpa menghapus versi lama agar pengaturan lokal tetap aman.')
      : trUpdate('updates.web_hint', 'Versi web terbaru akan dimuat ulang agar seluruh fitur mutakhir langsung aktif.');
    const bodyHtml = `<div class="text-center space-y-2.5"><div class="w-12 h-12 rounded-2xl ${iconBg} mx-auto flex items-center justify-center"><i class="${iconCls} text-2xl" aria-hidden="true"></i></div><div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums"><span>v${escUpdateHtml(status.currentVersion)}</span><i class="ph ph-arrow-right text-xs" aria-hidden="true"></i><span class="text-brand dark:text-brand-ink">v${escUpdateHtml(status.latestVersion)}</span></div>${status.releaseTitle ? `<p class="text-xs font-bold text-slate-800 dark:text-slate-100 leading-snug">${escUpdateHtml(status.releaseTitle)}</p>` : ''}${notesHtml}<p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1">${escUpdateHtml(hintText)}</p></div>`;

    root.__mkForceUpdateActive = Boolean(status.forceUpdate);
    const swalOpts = {
      title,
      html: bodyHtml,
      showConfirmButton: true,
      confirmButtonText: trUpdate('updates.update_now', 'Update Sekarang'),
      showCancelButton: !status.forceUpdate,
      cancelButtonText: trUpdate('updates.later', 'Nanti Saja'),
      allowOutsideClick: !status.forceUpdate,
      allowEscapeKey: !status.forceUpdate,
      customClass: { popup: typeof getSwalClass === 'function' ? getSwalClass() : '' },
      didClose: () => { root.__mkForceUpdateActive = false; }
    };
    if (status.forceUpdate) swalOpts.preConfirm = () => { applyUpdateAction(status); return false; };

    const res = await Swal.fire(swalOpts);
    if (!status.forceUpdate && res && res.isConfirmed) await applyUpdateAction(status);
    else if (!status.forceUpdate && res && res.dismiss) {
      try { localStorage.setItem(DISMISSED_UPDATE_KEY, status.latestVersion); } catch (_) { /* ignore */ }
    }
    return res;
  }

  function resolveVersionManifestUrl() {
    const cfgUrl = root.APP_CONFIG && root.APP_CONFIG.VERSION_MANIFEST_URL;
    if (cfgUrl && /^https:\/\//i.test(String(cfgUrl).trim())) return String(cfgUrl).trim();
    if (typeof root.isNativeApp === 'function' && root.isNativeApp()) return REMOTE_VERSION_URL;
    const proto = root.location && root.location.protocol;
    return proto === 'http:' || proto === 'https:' ? './version.json' : REMOTE_VERSION_URL;
  }

  function setCheckUpdateLoading(loading) {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('btnCheckAppUpdate');
    const txt = document.getElementById('btnCheckAppUpdateText');
    if (btn) { btn.disabled = loading; btn.setAttribute('aria-busy', loading ? 'true' : 'false'); }
    if (txt) {
      const key = loading ? 'updates.checking' : 'updates.check_now';
      txt.setAttribute('data-i18n', key);
      txt.textContent = trUpdate(key, loading ? 'Memeriksa...' : 'Cek Pembaruan');
    }
  }

  async function checkRemoteAppUpdate(opts = {}) {
    const manual = Boolean(opts && opts.manual);
    if (!manual) {
      const mainEl = typeof document !== 'undefined' && document.getElementById('mainContent');
      const blocked = typeof Swal !== 'undefined' && typeof Swal.isVisible === 'function' && Swal.isVisible();
      if (remoteUpdateChecked || (root.navigator && root.navigator.onLine === false) || blocked || (mainEl && mainEl.classList.contains('blur-md'))) {
        return cachedRemoteUpdate;
      }
    } else if (root.navigator && root.navigator.onLine === false) {
      await fireUpdateNotice('info', trUpdate('updates.check_now', 'Cek Pembaruan'), 'updates.offline_msg', 'Perangkat sedang offline. Hubungkan ke internet untuk memeriksa pembaruan.');
      return null;
    }

    if (manual) setCheckUpdateLoading(true);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
    try {
      const resp = await root.fetch(`${resolveVersionManifestUrl()}?t=${Date.now()}`, { cache: 'no-store', signal: controller ? controller.signal : undefined });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const status = evaluateRemoteVersion(getInstalledAppVersion(), await resp.json());
      cachedRemoteUpdate = status;
      remoteUpdateChecked = true;
      renderRemoteUpdateBanner(status);

      if (status.hasUpdate) {
        let dismissed = '';
        try { dismissed = localStorage.getItem(DISMISSED_UPDATE_KEY) || ''; } catch (_) { /* ignore */ }
        if (manual || status.forceUpdate || dismissed !== status.latestVersion) await showAppUpdatePopup(status);
      } else if (manual) {
        await fireUpdateNotice('success', trUpdate('updates.up_to_date_title', 'Aplikasi Sudah Terbaru'), 'updates.up_to_date_msg', 'Anda sudah memakai versi terbaru (v{current}).', { current: status.currentVersion });
      }
      return status;
    } catch (_) {
      if (manual) await fireUpdateNotice('warning', trUpdate('updates.check_now', 'Cek Pembaruan'), 'updates.error_msg', 'Gagal memeriksa pembaruan sekarang. Silakan coba lagi beberapa saat lagi.');
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      if (manual) setCheckUpdateLoading(false);
    }
  }

  Object.assign(root, {
    refreshUpdatesBadge,
    markLatestReleaseSeen,
    setUpdatesTopic,
    filterUpdatesList,
    toggleAllReleaseDetails,
    getCurrentNotifications,
    refreshNotificationBell,
    recordRecurringFromNotif,
    compareSemver,
    getInstalledAppVersion,
    evaluateRemoteVersion,
    showAppUpdatePopup,
    checkRemoteAppUpdate
  });
})(typeof window !== 'undefined' ? window : globalThis);
