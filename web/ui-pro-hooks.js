// @depends-on: error-messages.js, ui-state.js
/* global Swal, escapeHtmlJS, escapeAttrJS, localToday, getCurrentNotifications, openCommandPalette, closeCommandPalette, renderQuickTemplates, renderTagBars, restoreAiAnalysisCache, t, mkActionAttrs */
/* ============================================================
   PRO FEATURES — NOTIFICATIONS MODAL, BROWSER ALERTS & HOOKS
   ============================================================ */
(function (root) {
  'use strict';

  const NATIVE_NOTIF_KEY = 'mk_native_notif_enabled';

  function renderMobileBottomNavState(viewId) {
    const nav = document.getElementById('mobileBottomNav');
    if (nav) nav.classList.toggle('hide', viewId === 'form-transaction');
    document.querySelectorAll('#mobileBottomNav [data-mobile-nav]').forEach((btn) => {
      const active = btn.getAttribute('data-mobile-nav') === viewId;
      btn.classList.toggle('mobile-nav-active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  async function toggleBrowserNotifications() {
    const pro = root.__mkPro || {};
    if (!('Notification' in window)) {
      Swal.fire(pro.swalOpt({ icon: 'info', title: 'Tidak didukung', text: 'Browser ini tidak mendukung Web Notification API.' }));
      return;
    }
    const enabled = localStorage.getItem(pro.KEYS.BROWSER_NOTIF) === '1';
    if (enabled) {
      localStorage.setItem(pro.KEYS.BROWSER_NOTIF, '0');
      Swal.fire(pro.swalOpt({ icon: 'info', title: 'Notifikasi browser dimatikan', timer: 1200, showConfirmButton: false }));
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      Swal.fire(pro.swalOpt({ icon: 'warning', title: 'Izin ditolak', text: 'Aktifkan izin notifikasi di pengaturan browser.' }));
      return;
    }
    localStorage.setItem(pro.KEYS.BROWSER_NOTIF, '1');
    localStorage.removeItem(pro.KEYS.BROWSER_NOTIF_DATE);
    maybeNotifyBrowserSummary();
    Swal.fire(pro.swalOpt({ icon: 'success', title: 'Pengingat browser aktif!', timer: 1300, showConfirmButton: false }));
  }

  async function toggleNativeNotifications() {
    const pro = root.__mkPro || {};
    const currentlyOn = localStorage.getItem(NATIVE_NOTIF_KEY) === '1';
    if (typeof root.scheduleNativeDailyReminder !== 'function') {
      Swal.fire(pro.swalOpt({ icon: 'info', title: 'Belum tersedia', text: 'Plugin notifikasi native belum siap.' }));
      return;
    }
    const nextState = !currentlyOn;
    const res = await root.scheduleNativeDailyReminder(nextState, 20, 0);
    if (!res.ok) {
      Swal.fire(pro.swalOpt({ icon: 'warning', title: 'Izin ditolak', text: 'Izinkan notifikasi MyKeuGuech di Pengaturan Aplikasi Android.' }));
      return;
    }
    localStorage.setItem(NATIVE_NOTIF_KEY, nextState ? '1' : '0');
    Swal.fire(pro.swalOpt({
      icon: nextState ? 'success' : 'info',
      title: nextState ? 'Pengingat Android 20:00 aktif!' : 'Pengingat Android dimatikan',
      timer: 1300,
      showConfirmButton: false
    }));
  }

  async function openNotificationsModal() {
    const pro = root.__mkPro || {};
    const list = typeof getCurrentNotifications === 'function' ? getCurrentNotifications() : [];
    const isNative = typeof root.isNativeApp === 'function' && root.isNativeApp();
    const browserOn = localStorage.getItem(pro.KEYS.BROWSER_NOTIF) === '1' && ('Notification' in window) && Notification.permission === 'granted';
    const nativeOn = localStorage.getItem(NATIVE_NOTIF_KEY) === '1';
    const toggleOn = isNative ? nativeOn : browserOn;
    const toggleLabel = isNative ? 'Pengingat Android (20:00):' : 'Notifikasi Browser:';
    const toggleAction = isNative ? 'toggleNativeNotifications' : 'toggleBrowserNotifications';
    const sevStyle = {
      danger: 'border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300',
      warning: 'border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
      info: 'border-blue-200 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
    };
    const rows = list.length ? list.map((n) => {
      let actionBtn = '';
      if (n.actionType === 'view' && n.actionPayload && n.actionPayload.view) {
        actionBtn = `<button type="button" ${mkActionAttrs('swalClose|switchView', [n.actionPayload.view])} class="mt-2 px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold">Lihat</button>`;
      } else if (n.actionType === 'recurring' && n.actionPayload && n.actionPayload.id) {
        actionBtn = `<button type="button" ${mkActionAttrs('recordRecurringFromNotif', [n.actionPayload.id])} class="mt-2 px-3 py-1 rounded-lg bg-brand text-white text-[11px] font-bold">Catat Sekarang</button>`;
      } else if (n.actionType === 'sync_offline') {
        actionBtn = '<button type="button" data-action="swalClose|flushOfflineQueue" data-args="[false]" class="mt-2 px-3 py-1 rounded-lg bg-brand text-white text-[11px] font-bold">Sinkronisasi</button>';
      } else if (n.actionType === 'offline_failed') {
        actionBtn = '<div class="mt-2 flex flex-wrap gap-2"><button type="button" data-action="swalClose|retryFailedOfflineItems" class="px-3 py-1 rounded-lg bg-brand text-white text-[11px] font-bold">Coba Ulang</button><button type="button" data-action="swalClose|discardFailedOfflineItems" class="px-3 py-1 rounded-lg bg-rose-500 text-white text-[11px] font-bold">Buang Gagal</button></div>';
      }
      return `
        <div class="p-3 rounded-xl border text-left ${sevStyle[n.severity] || sevStyle.info}">
          <p class="font-bold text-xs">${escapeHtmlJS(n.title)}</p>
          <p class="text-[11px] opacity-90 mt-0.5">${escapeHtmlJS(n.message)}</p>
          ${actionBtn}
        </div>`;
    }).join('') : `<p class="text-xs text-slate-400 py-4 text-center">${escapeHtmlJS(t('notif.empty'))}</p>`;

    await Swal.fire(pro.swalOpt({
      title: t('notif.title'),
      html: `
        <div class="mb-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs">
          <span>${toggleLabel} <strong>${toggleOn ? 'Aktif' : 'Nonaktif'}</strong></span>
          <button type="button" data-action="${toggleAction}" class="px-2.5 py-1 rounded-lg ${toggleOn ? 'bg-slate-200 dark:bg-slate-700' : 'bg-brand text-white'} font-bold">${toggleOn ? 'Matikan' : 'Aktifkan'}</button>
        </div>
        <div class="space-y-2.5 max-h-80 overflow-y-auto pr-1">${rows}</div>
      `,
      confirmButtonText: t('btn.tutup')
    }));
  }

  function maybeNotifyBrowserSummary() {
    const pro = root.__mkPro || {};
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (localStorage.getItem(pro.KEYS.BROWSER_NOTIF) !== '1' || typeof getCurrentNotifications !== 'function') return;
    const todayStr = localToday();
    if (localStorage.getItem(pro.KEYS.BROWSER_NOTIF_DATE) === todayStr) return;
    const important = getCurrentNotifications().filter((n) => n.severity === 'danger' || n.severity === 'warning');
    if (!important.length) return;
    localStorage.setItem(pro.KEYS.BROWSER_NOTIF_DATE, todayStr);
    try {
      new Notification(`MyKeuGuech: ${important.length} Pengingat Hari Ini`, {
        body: `${important[0].title} — ${important[0].message}`,
        icon: 'icons/icon-192.png'
      });
    } catch (_) {
      /* ignore */
    }
  }

  function installProHooks() {
    const pro = root.__mkPro || {};
    if (typeof root.renderAssetAllocation === 'function' && !root._proAllocHooked) {
      root._proAllocHooked = true;
      const prevAlloc = root.renderAssetAllocation;
      root.renderAssetAllocation = function () {
        prevAlloc();
        if (typeof pro.decorateAssetRebalanceStrip === 'function') pro.decorateAssetRebalanceStrip();
      };
    }
    if (typeof root.switchView === 'function' && !root._proSwitchViewHooked) {
      root._proSwitchViewHooked = true;
      const prevSwitch = root.switchView;
      root.switchView = function (id) {
        prevSwitch(id);
        renderMobileBottomNavState(id);
        if (id === 'ai') restoreAiAnalysisCache();
      };
    }
    if (typeof root.renderAll === 'function' && !root._proRenderAllHooked) {
      root._proRenderAllHooked = true;
      const prevRenderAll = root.renderAll;
      root.renderAll = function () {
        prevRenderAll();
        renderQuickTemplates();
        renderTagBars();
        restoreAiAnalysisCache();
        maybeNotifyBrowserSummary();
      };
    }
  }

  document.addEventListener('click', (e) => {
    ['lapImportMenu', 'lapExportMenu'].forEach((id) => {
      const det = document.getElementById(id);
      if (det && det.open && !det.contains(e.target)) det.open = false;
    });
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'k') {
      e.preventDefault();
      if (typeof openCommandPalette === 'function') openCommandPalette();
    } else if (e.key === 'Escape' && document.getElementById('mkCommandPalette') && typeof closeCommandPalette === 'function') {
      closeCommandPalette();
    }
  });

  installProHooks();
  document.addEventListener('DOMContentLoaded', installProHooks);

  Object.assign(root, {
    toggleBrowserNotifications,
    toggleNativeNotifications,
    openNotificationsModal,
    maybeNotifyBrowserSummary
  });
})(typeof window !== 'undefined' ? window : globalThis);
