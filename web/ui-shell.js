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
    if (typeof Chart !== 'undefined') {
      Chart.defaults.font.family = "'Inter', sans-serif";
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
  }

  function setTheme(t) {
    const theme = t || '';
    document.documentElement.className = '';
    if (localStorage.getItem('mode') === 'dark') {
      document.documentElement.classList.add('dark');
    }
    if (theme) document.documentElement.classList.add(theme);
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

    const nav = document.getElementById('nav-' + (id.includes('utang') ? 'dashboard' : id));
    if (nav) {
      nav.classList.remove('text-slate-500', 'dark:text-slate-400');
      nav.classList.add('active-nav');
      nav.setAttribute('aria-current', 'page');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

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
    DB.snapshots = data.snapshots || [];
    DB.wallets = data.wallets || [];
    DB.transfers = data.transfers || [];
    DB.goals = data.goals || [];
    DB.recurring = data.recurring || [];
    const uEl = document.getElementById('ui-username');
    const rEl = document.getElementById('ui-role');
    if (uEl) uEl.innerText = root.sessionUser;
    if (rEl) rEl.innerText = root.sessionRole;
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
        <button type="button" onclick="retryInitialAppLoad()" class="min-h-11 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shrink-0">
          Muat Ulang Data
        </button>
      </div>
    `);
  }

  async function loadInitialAppData() {
    const banner = document.getElementById('appLoadErrorBanner');
    try {
      const data = await callServer('getInitialData');
      applyLoadedInitialData(data);
      if (banner) {
        banner.classList.add('hide');
        banner.textContent = '';
      }
      root.isDataReady = true;
      if (!controlsInitialized) {
        initPickersAndControls();
        controlsInitialized = true;
      }
      switchView('dashboard');
      renderAll();
      refreshMarketPricesInBackground();
    } catch (e) {
      root.isDataReady = false;
      console.error('[INIT] error:', e);
      showLoadFailureBanner(e);
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
    if (rEl) rEl.innerText = root.sessionRole;
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
