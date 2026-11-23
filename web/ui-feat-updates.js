/* global DB, FinanceAnalysis, Swal, callServer, refreshFromServer, getSwalClass, showActionError, localToday, t */
/* ============================================================
   FEATURES — RELEASE UPDATES & NOTIFICATION BELL CENTER
   ============================================================ */
(function (root) {
  'use strict';

  const LAST_SEEN_RELEASE_KEY = 'mk_last_seen_release';
  let activeUpdatesTopic = 'all';

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
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
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
      const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
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

  Object.assign(root, {
    refreshUpdatesBadge,
    markLatestReleaseSeen,
    setUpdatesTopic,
    filterUpdatesList,
    toggleAllReleaseDetails,
    getCurrentNotifications,
    refreshNotificationBell,
    recordRecurringFromNotif
  });
})(typeof window !== 'undefined' ? window : globalThis);
