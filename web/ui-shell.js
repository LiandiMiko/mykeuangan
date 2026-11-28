// @depends-on: ui-state.js
/* global DB, Chart, flatpickr, monthSelectPlugin, escapeHtmlJS, renderHtml, callServer, updateEyeIcon, updateAiKeyStatusUI, bindReportControls, saveCurrentPeriod, updateDashboardTitle, renderDashboard, renderWallets, renderRecurring, renderLaporan, renderDebtLists, renderKalender, renderBudgeting, renderPortfolioChart, loadAdminData, markLatestReleaseSeen */
/* ============================================================
   INIT, THEME, NAVIGATION & RENDER ORCHESTRATION
   ============================================================ */
(function (root) {
  'use strict';

  const MARKET_REFRESH_TS_KEY = 'mk_last_market_refresh_ts';
  const MARKET_REFRESH_COOLDOWN_MS = 600000;

  function refreshMarketPricesInBackground() {
    const hasMarketAsset = (DB.assets || []).some((a) =>
      ['crypto', 'emas', 'usd'].includes(String(a.type || '').toLowerCase())
    );
    if (!hasMarketAsset) return;
    try {
      const lastTs = Number(sessionStorage.getItem(MARKET_REFRESH_TS_KEY) || 0);
      if (lastTs && (Date.now() - lastTs) < MARKET_REFRESH_COOLDOWN_MS) return;
      sessionStorage.setItem(MARKET_REFRESH_TS_KEY, String(Date.now()));
    } catch (_) {
      /* ignore */
    }
    callServer('api_refreshPrices')
      .then((updated) => {
        if (!updated) return;
        if (updated.assets) DB.assets = updated.assets;
        if (updated.snapshots) DB.snapshots = updated.snapshots;
        renderAll();
      })
      .catch((err) => {
        console.warn('[INIT] Auto-refresh harga latar gagal:', err);
      });
  }

  function initPickersAndControls() {
    if (document.getElementById('tr_tanggal')) {
      root.fpTanggal = flatpickr('#tr_tanggal', {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd F Y',
        locale: 'id',
        disableMobile: true
      });
    }
    if (document.getElementById('dashMonthPicker')) {
      root.fpMonth = flatpickr('#dashMonthPicker', {
        plugins: [new monthSelectPlugin({ shorthand: true, dateFormat: 'Y-m', altFormat: 'F Y' })],
        altInput: true,
        locale: 'id',
        disableMobile: true,
        defaultDate: DB.currentPeriod,
        onChange: async (d, s) => {
          if (s) await saveCurrentPeriod(s);
        }
      });
    }
    const prefersReducedMotion = typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof Chart !== 'undefined') {
      Chart.defaults.font.family = "'Inter', sans-serif";
      if (prefersReducedMotion) Chart.defaults.animation = false;
    }
    updateEyeIcon();
    updateAiKeyStatusUI();
    bindReportControls();
  }

  function syncThemeColorMeta() {
    const isDark = document.documentElement.classList.contains('dark');
    const color = isDark ? '#0f172a' : '#ffffff';
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', color);
    });
    if (typeof root.syncNativeSystemBars === 'function') root.syncNativeSystemBars(isDark);
  }

  function setTheme(t) {
    const theme = t || '';
    const rootCls = document.documentElement.classList;
    rootCls.remove('theme-pink', 'theme-violet', 'theme-blue', 'theme-emerald');
    rootCls.toggle('dark', localStorage.getItem('mode') === 'dark');
    if (theme) rootCls.add(theme);
    localStorage.setItem('theme', theme);

    document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
      const isActive = (btn.getAttribute('data-theme-btn') || '') === theme;
      btn.classList.toggle('active-theme', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });

    syncThemeColorMeta();

    if (root.isDataReady) {
      try { renderPortfolioChart(); } catch (_) { /* ignore */ }
    }
  }

  function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('mode', isDark ? 'dark' : 'light');
    syncThemeColorMeta();
    renderAll();
  }

  let lastFocusBeforeSidebar = null;

  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebarOverlay');
    if (!sb || !ov) return;
    if (window.innerWidth >= 1024) {
      sb.classList.toggle('lg:-ml-72');
      sb.classList.toggle('lg:translate-x-0');
    } else if (sb.classList.contains('-translate-x-full')) {
      lastFocusBeforeSidebar = document.activeElement;
      sb.classList.remove('-translate-x-full');
      sb.setAttribute('aria-hidden', 'false');
      ov.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
      ov.classList.add('opacity-100');
      const closeBtn = document.getElementById('sidebarCloseBtn');
      if (closeBtn && typeof closeBtn.focus === 'function') {
        setTimeout(() => closeBtn.focus(), 50);
      }
    } else {
      sb.classList.add('-translate-x-full');
      sb.setAttribute('aria-hidden', 'true');
      ov.classList.remove('opacity-100');
      ov.classList.add('opacity-0', 'pointer-events-none');
      setTimeout(() => ov.classList.add('hidden'), 280);
      const restoreTarget = (lastFocusBeforeSidebar && document.contains(lastFocusBeforeSidebar))
        ? lastFocusBeforeSidebar
        : document.getElementById('sidebarToggleBtn');
      lastFocusBeforeSidebar = null;
      if (restoreTarget && typeof restoreTarget.focus === 'function') {
        restoreTarget.focus();
      }
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || window.innerWidth >= 1024) return;
    const sb = document.getElementById('sidebar');
    if (sb && !sb.classList.contains('-translate-x-full')) {
      toggleSidebar();
    }
  });

  function switchView(id) {
    document.querySelectorAll('.view-section').forEach((el) => el.classList.add('hide'));
    const target = document.getElementById('view-' + id);
    if (target) target.classList.remove('hide');

    if (id === 'dashboard') {
      setTimeout(() => {
        try { renderKalender(); } catch (e) { console.error('renderKalender on switch err:', e); }
      }, 0);
    }

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.remove('active-nav', 'bg-brand-light', 'text-brand', 'dark:bg-slate-800', 'dark:text-white');
      btn.classList.add('text-slate-500', 'dark:text-slate-400');
      btn.removeAttribute('aria-current');
    });

    // Gelombang 6 (U1): setiap layar punya entri nav sendiri — termasuk
    // Utang & Piutang (nav-utang) — jadi id view dipakai apa adanya.
    // Dulu 'utang' dipetakan ke 'dashboard' karena belum ada nav utang.
    const nav = document.getElementById('nav-' + id);
    if (nav) {
      nav.classList.remove('text-slate-500', 'dark:text-slate-400');
      nav.classList.add('active-nav');
      nav.setAttribute('aria-current', 'page');
    }

    const reduceScrollMotion = typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceScrollMotion ? 'auto' : 'smooth' });

    if (id === 'aset') {
      setTimeout(() => {
        try { renderPortfolioChart(); } catch (e) { console.error('renderPortfolioChart err:', e); }
      }, 60);
    }
    if (id === 'admin') loadAdminData();
    if (id === 'updates' && typeof markLatestReleaseSeen === 'function') markLatestReleaseSeen();

    if (window.innerWidth < 1024) {
      const sb = document.getElementById('sidebar');
      if (sb && !sb.classList.contains('-translate-x-full')) toggleSidebar();
    }
  }

  function renderAll() {
    if (!root.isDataReady) return;
    try { renderDashboard(); } catch (e) { console.error('renderDashboard err:', e); }
    try { renderWallets(); } catch (e) { console.error('renderWallets err:', e); }
    try { renderRecurring(); } catch (e) { console.error('renderRecurring err:', e); }
    try { renderLaporan(); } catch (e) { console.error('renderLaporan err:', e); }
    try { renderDebtLists(); } catch (e) { console.error('renderDebtLists err:', e); }
    try { renderKalender(); } catch (e) { console.error('renderKalender err:', e); }
    try { renderBudgeting(); } catch (e) { console.error('renderBudgeting err:', e); }
    try { renderPortfolioChart(); } catch (e) { console.error('renderPortfolioChart err:', e); }
    try { updateAiKeyStatusUI(); } catch (e) { console.error('updateAiKeyStatusUI err:', e); }
  }

  let controlsInitialized = false;

  function applyLoadedInitialData(data) {
    DB.transactions = data.transactions || [];
    DB.categories = data.categories || { pemasukan: [], pengeluaran: [] };
    DB.entities = data.entities || { UtangApp: [], UtangPerson: [], Piutang: [] };
    DB.assets = data.assets || [];
    DB.budgets = data.budgets || [];
    DB.currentPeriod = data.currentPeriod || DB.currentPeriod;
    DB.payrollDay = data.payrollDay || 1;
    DB.primaryBankWalletId = data.primaryBankWalletId || '';
    DB.snapshots = data.snapshots || [];
    DB.wallets = data.wallets || [];
    DB.transfers = data.transfers || [];
    DB.goals = data.goals || [];
    DB.recurring = data.recurring || [];
    DB.debtDueDates = data.debtDueDates || DB.debtDueDates || {};
    const uEl = document.getElementById('ui-username');
    const rEl = document.getElementById('ui-role');
    if (uEl) uEl.innerText = root.sessionUser;
    if (rEl) rEl.innerText = String(root.sessionRole || 'USER').toUpperCase();
    updateDashboardTitle();
  }

  function showLoadFailureBanner(err) {
    const banner = document.getElementById('appLoadErrorBanner');
    if (!banner) return;
    banner.classList.remove('hide');
    renderHtml(banner, `
      <div role="alert" class="rounded-3xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p class="text-sm font-extrabold text-rose-700 dark:text-rose-300">Gagal memuat data keuangan dari Supabase</p>
          <p class="text-xs text-rose-600/90 dark:text-rose-400 mt-1">${escapeHtmlJS(String((err && err.message) || err))}</p>
        </div>
        <button type="button" data-action="retryInitialAppLoad" class="min-h-11 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shrink-0">
          Muat Ulang Data
        </button>
      </div>
    `);
  }

  function showOfflineCacheBanner(savedAt) {
    const banner = document.getElementById('appLoadErrorBanner');
    if (!banner) return;
    let timeText = 'sebelumnya';
    if (savedAt) {
      try {
        timeText = new Date(savedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
      } catch (_) {
        timeText = String(savedAt).slice(0, 16).replace('T', ' ');
      }
    }
    banner.classList.remove('hide');
    renderHtml(banner, `
      <div role="status" class="rounded-3xl border border-amber-300/80 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p class="text-sm font-extrabold text-amber-800 dark:text-amber-300">Mode Offline · Data Cache Lokal</p>
          <p class="text-xs text-amber-700/90 dark:text-amber-400 mt-0.5">Menampilkan data tersimpan terakhir (${escapeHtmlJS(timeText)}). Catatan baru tetap tersimpan ke antrean offline.</p>
        </div>
        <button type="button" data-action="retryInitialAppLoad" class="min-h-11 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0">
          Coba Sinkronkan
        </button>
      </div>
    `);
  }

  function finishReadyUiState() {
    // Pertahanan berlapis (T1): jangan render bila PIN diset tapi sesi belum unlocked.
    if (typeof localStorage !== 'undefined' && localStorage.getItem('mk_app_pin_hash') && sessionStorage.getItem('mk_pin_unlocked') !== '1') return;
    root.isDataReady = true;
    if (!controlsInitialized) {
      initPickersAndControls();
      controlsInitialized = true;
    }
    switchView('dashboard');
    renderAll();
    if (typeof root.hideNativeSplash === 'function') root.hideNativeSplash();
  }

  async function loadInitialAppData() {
    const banner = document.getElementById('appLoadErrorBanner');
    try {
      // T1: tampilkan layar kunci DULU — verifikasi PIN SEBELUM data dimuat ke
      // memori, diterapkan, atau dirender. Ini mencakup jalur snapshot offline
      // (snapshot tidak dirender sebelum PIN benar). Bila PIN tidak diset,
      // verifyAppPinIfEnabled langsung return true dan alur tidak berubah.
      // Bila pengguna memilih keluar saat terkunci, batalkan pemuatan.
      const feat = root.__mkFeat || {};
      if (typeof feat.verifyAppPinIfEnabled === 'function') {
        const unlocked = await feat.verifyAppPinIfEnabled();
        if (!unlocked) {
          root.isDataReady = false;
          return;
        }
      }
      const data = await callServer('getInitialData');
      applyLoadedInitialData(data);
      if (typeof root.saveOfflineSnapshot === 'function') root.saveOfflineSnapshot(data);
      if (banner) {
        banner.classList.add('hide');
        banner.textContent = '';
      }
      finishReadyUiState();
      refreshMarketPricesInBackground();
    } catch (e) {
      // Jalur snapshot offline juga tunduk pada gate PIN (T1): bila PIN diset
      // tapi sesi belum unlocked (mis. verifikasi di atas gagal/throw),
      // jangan terapkan snapshot ke memori maupun merendernya.
      if (typeof localStorage !== 'undefined' && localStorage.getItem('mk_app_pin_hash') && sessionStorage.getItem('mk_pin_unlocked') !== '1') {
        root.isDataReady = false;
        console.error('[INIT] error:', e);
        return;
      }
      const cached = typeof root.loadOfflineSnapshot === 'function' ? await root.loadOfflineSnapshot() : null;
      if (cached && cached.data) {
        const merged = typeof root.mergeQueuedOfflineTx === 'function' ? await root.mergeQueuedOfflineTx(cached.data) : cached.data;
        applyLoadedInitialData(merged);
        finishReadyUiState();
        showOfflineCacheBanner(cached.savedAt);
        return;
      }
      root.isDataReady = false;
      console.error('[INIT] error:', e);
      // Wave 3.5 / S30: snapshot kedaluwarsa (> 7 hari) tidak diterapkan —
      // beri tahu pengguna alasannya, bukan sekadar "gagal memuat".
      if (cached && cached.stale) {
        showLoadFailureBanner(new Error('Snapshot offline sudah kedaluwarsa (lebih dari 7 hari). Hubungkan ke internet untuk memuat data terbaru.'));
      } else {
        showLoadFailureBanner(e);
      }
    } finally {
      const loader = document.getElementById('appLoader');
      if (loader) loader.classList.add('hide');
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (localStorage.getItem('mode') === 'dark') {
      document.documentElement.classList.add('dark');
    }
    setTheme(localStorage.getItem('theme') || '');

    const uEl = document.getElementById('ui-username');
    const rEl = document.getElementById('ui-role');
    if (uEl) uEl.innerText = root.sessionUser;
    if (rEl) rEl.innerText = String(root.sessionRole || 'USER').toUpperCase();
    updateDashboardTitle();

    await loadInitialAppData();
  });

  Object.assign(root, {
    setTheme,
    toggleDarkMode,
    toggleSidebar,
    switchView,
    renderAll,
    refreshMarketPricesInBackground,
    retryInitialAppLoad: loadInitialAppData
  });
})(typeof window !== 'undefined' ? window : globalThis);
