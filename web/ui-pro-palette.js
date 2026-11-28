// @depends-on: ui-state.js
/* global DB, FinancePro, FinanceAnalysis, Swal, formatShortIDR, escapeHtmlJS, escapeAttrJS, renderHtml, switchView, openForm, triggerReceiptOcr, toggleDarkMode, setLang, currentLang, filterHistoriView, t, mkActionAttrs */
/* ============================================================
   PRO FEATURES — COMMAND PALETTE, #TAGS & AUTO-CATEGORY RULES
   ============================================================ */
(function (root) {
  'use strict';

  let cachedCmdItems = [];
  let cmdFiltered = [];
  let cmdActiveIdx = 0;
  let previousFocusEl = null;

  function buildCommandItems() {
    const items = [
      { label: 'Dashboard', hint: 'Halaman utama', icon: 'ph-squares-four', run: () => switchView('dashboard') },
      { label: 'Tabungan & Investasi', hint: 'Aset, rasio & Net Worth', icon: 'ph-piggy-bank', run: () => switchView('aset') },
      { label: 'Histori Transaksi', hint: 'Daftar siklus', icon: 'ph-list-bullets', run: () => switchView('histori') },
      { label: 'Budgeting, Target & Rutin', hint: 'Anggaran & jadwal', icon: 'ph-chart-pie-slice', run: () => switchView('budgeting') },
      { label: 'Laporan & Ekspor', hint: 'Filter, CSV, Excel, PDF', icon: 'ph-file-pdf', run: () => switchView('laporan') },
      { label: 'Analisis AI Gemini', hint: 'Skor & chat AI', icon: 'ph-sparkle', run: () => switchView('ai') },
      { label: 'Riwayat Pembaruan', hint: 'Catatan rilis', icon: 'ph-megaphone-simple', run: () => switchView('updates') },
      { label: 'Utang & Piutang', hint: 'Kelola pihak & jatuh tempo', icon: 'ph-hand-coins', run: () => switchView('utang') },
      { label: '+ Catat Pengeluaran', hint: 'Form transaksi', icon: 'ph-minus-circle', run: () => openForm('Pengeluaran') },
      { label: '+ Catat Pemasukan', hint: 'Form transaksi', icon: 'ph-plus-circle', run: () => openForm('Pemasukan') },
      { label: 'Scan Struk (AI OCR)', hint: 'Ambil transaksi dari struk', icon: 'ph-camera', run: () => typeof triggerReceiptOcr === 'function' && triggerReceiptOcr() },
      { label: 'Rekap Tahunan & Perbandingan', hint: 'Annual Wrapped 12 siklus', icon: 'ph-calendar-blank', run: () => root.openAnnualRecapModal() },
      { label: 'Kalkulator Finansial', hint: 'Snowball/Avalanche, Compound, Cicilan', icon: 'ph-calculator', run: () => root.openFinancialCalculatorsModal() },
      { label: 'Aturan Auto-Kategori CSV', hint: 'Kata kunci otomatis', icon: 'ph-magic-wand', run: () => openAutoCatRulesModal() },
      { label: 'Target Rebalance Portofolio', hint: 'Porsi ideal aset', icon: 'ph-scales', run: () => root.openRebalanceTargetsModal() },
      { label: 'Toggle Notifikasi Browser', hint: 'Pengingat opt-in', icon: 'ph-bell-ringing', run: () => root.toggleBrowserNotifications() },
      { label: 'Ganti Tema Gelap / Terang', hint: 'Tampilan', icon: 'ph-moon', run: () => toggleDarkMode() },
      { label: 'Ganti Bahasa (ID / EN)', hint: 'Bahasa', icon: 'ph-translate', run: () => setLang(typeof currentLang !== 'undefined' && currentLang === 'id' ? 'en' : 'id') }
    ];
    if (root.sessionRole === 'admin') {
      items.push({ label: 'Panel Admin', hint: 'Kelola pengguna', icon: 'ph-shield-check', run: () => switchView('admin') });
    }
    return items;
  }

  // Gelombang 6 (U18): umumkan item aktif ke screen reader lewat
  // aria-selected pada tiap option + aria-activedescendant pada input.
  function highlightCmdItem() {
    const listEl = document.getElementById('mkCmdList');
    if (!listEl) return;
    const input = document.getElementById('mkCmdInput');
    let activeId = null;
    listEl.querySelectorAll('[data-cmd-idx]').forEach((btn, idx) => {
      const on = idx === cmdActiveIdx;
      btn.classList.toggle('bg-brand/10', on);
      btn.classList.toggle('text-brand', on);
      btn.setAttribute('aria-selected', String(on));
      if (on) {
        activeId = btn.id;
        btn.scrollIntoView({ block: 'nearest' });
      }
    });
    if (input) {
      if (activeId) input.setAttribute('aria-activedescendant', activeId);
      else if (typeof input.removeAttribute === 'function') input.removeAttribute('aria-activedescendant');
    }
  }

  function closeCommandPalette() {
    const el = document.getElementById('mkCommandPalette');
    if (el) el.remove();
    if (previousFocusEl && previousFocusEl.isConnected && typeof previousFocusEl.focus === 'function') {
      previousFocusEl.focus();
    }
    previousFocusEl = null;
  }

  function filterCommandPalette() {
    const input = document.getElementById('mkCmdInput');
    const listEl = document.getElementById('mkCmdList');
    if (!input || !listEl) return;
    const q = String(input.value || '').trim().toLowerCase();
    cmdFiltered = cachedCmdItems.filter((it) => !q || `${it.label} ${it.hint}`.toLowerCase().includes(q)).slice(0, 14);
    cmdActiveIdx = 0;
    if (!cmdFiltered.length) {
      renderHtml(listEl, '<p class="p-4 text-xs text-slate-500 text-center">Tidak ditemukan perintah yang cocok.</p>');
      if (input && typeof input.removeAttribute === 'function') input.removeAttribute('aria-activedescendant');
      return;
    }
    renderHtml(listEl, cmdFiltered.map((it, idx) => `
      <button type="button" id="mkCmdOpt-${idx}" role="option" aria-selected="${idx === cmdActiveIdx ? 'true' : 'false'}" data-cmd-idx="${idx}"
              class="w-full px-3.5 py-2.5 rounded-xl text-left flex items-center justify-between gap-2 hover:bg-brand/10 hover:text-brand dark:hover:text-brand-ink transition-colors">
        <span class="min-w-0 flex items-center gap-2.5 text-xs font-bold text-slate-800 dark:text-slate-100">
          <i class="ph ${escapeHtmlJS(it.icon)} text-base text-brand dark:text-brand-ink shrink-0" aria-hidden="true"></i>
          <span class="truncate">${escapeHtmlJS(it.label)}</span>
        </span>
        <span class="shrink-0 max-w-[42%] truncate text-[11px] text-slate-500">${escapeHtmlJS(it.hint)}</span>
      </button>
    `).join(''));
    listEl.querySelectorAll('[data-cmd-idx]').forEach((btn) => {
      const idx = Number(btn.getAttribute('data-cmd-idx'));
      btn.onclick = () => {
        closeCommandPalette();
        cmdFiltered[idx].run();
      };
    });
    highlightCmdItem();
  }

  function openCommandPalette() {
    if (document.getElementById('mkCommandPalette')) {
      closeCommandPalette();
      return;
    }
    previousFocusEl = document.activeElement;
    cachedCmdItems = buildCommandItems();
    const wrap = document.createElement('div');
    wrap.id = 'mkCommandPalette';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Perintah Cepat');
    wrap.className = 'fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-start justify-center px-4';
    renderHtml(wrap, `
      <div class="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 overflow-hidden">
        <div class="p-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center gap-2.5">
          <i class="ph ph-magnifying-glass text-lg text-brand dark:text-brand-ink shrink-0" aria-hidden="true"></i>
          <input id="mkCmdInput" type="search" enterkeyhint="go" autocomplete="off" placeholder="Ketik halaman, aksi, kalkulator, tema..."
                 role="combobox" aria-expanded="true" aria-controls="mkCmdList" aria-label="Cari perintah cepat"
                 class="flex-1 min-w-0 bg-transparent outline-none text-sm font-medium text-slate-800 dark:text-white placeholder:text-slate-500">
          <kbd class="hidden sm:inline-block px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 dark:text-slate-400">ESC</kbd>
          <button id="mkCmdCloseBtn" type="button" aria-label="Tutup perintah cepat" class="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0"><i class="ph ph-x text-base" aria-hidden="true"></i></button>
        </div>
        <div id="mkCmdList" role="listbox" aria-label="Daftar perintah cepat" class="p-2 pb-3 sm:pb-2 overflow-y-auto space-y-0.5"></div>
        <div class="hidden sm:flex px-3.5 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>Gunakan <b class="font-semibold text-slate-700 dark:text-slate-200">&uarr;&darr;</b> navigasi &bull; <b class="font-semibold text-slate-700 dark:text-slate-200">Enter</b> pilih</span>
          <span><b class="font-semibold text-slate-700 dark:text-slate-200">Ctrl+K</b> buka cepat</span>
        </div>
      </div>
    `);
    wrap.onclick = (e) => { if (e.target === wrap) closeCommandPalette(); };
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(wrap.querySelectorAll('input, button:not([disabled])'));
      if (!focusables.length) return;
      const idx = focusables.indexOf(document.activeElement);
      e.preventDefault();
      const nextIdx = e.shiftKey
        ? (idx <= 0 ? focusables.length - 1 : idx - 1)
        : (idx < 0 || idx >= focusables.length - 1 ? 0 : idx + 1);
      focusables[nextIdx].focus();
    });
    document.body.appendChild(wrap);
    const closeBtn = document.getElementById('mkCmdCloseBtn');
    if (closeBtn) closeBtn.onclick = closeCommandPalette;
    const input = document.getElementById('mkCmdInput');
    input.oninput = filterCommandPalette;
    input.onkeydown = (e) => {
      if (!cmdFiltered.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdActiveIdx = (cmdActiveIdx + 1) % cmdFiltered.length; highlightCmdItem(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cmdActiveIdx = (cmdActiveIdx - 1 + cmdFiltered.length) % cmdFiltered.length; highlightCmdItem(); }
      else if (e.key === 'Enter') { e.preventDefault(); const chosen = cmdFiltered[cmdActiveIdx]; closeCommandPalette(); if (chosen) chosen.run(); }
    };
    filterCommandPalette();
    input.focus();
  }

  function applyTagFilter(target, tag) {
    if (target === 'histori') {
      const el = document.getElementById('historiSearch');
      if (el) {
        el.value = el.value.trim() === tag ? '' : tag;
        if (typeof filterHistoriView === 'function') filterHistoriView();
      }
      return;
    }
    const lapEl = document.getElementById('lapSearch');
    if (lapEl) {
      lapEl.value = lapEl.value.trim() === tag ? '' : tag;
      lapEl.dispatchEvent(new Event('input'));
    }
  }

  function renderTagBars() {
    if (typeof FinancePro === 'undefined' || !root.isDataReady) return;
    const cycleTags = FinancePro.summarizeTags(DB.transactions || [], DB.currentPeriod, DB.payrollDay, FinanceAnalysis);
    const allTags = FinancePro.summarizeTags(DB.transactions || [], '', DB.payrollDay, FinanceAnalysis);

    const fillBar = (elId, target, items) => {
      const bar = document.getElementById(elId);
      if (!bar) return;
      if (!items.length) {
        bar.classList.add('hide');
        bar.textContent = '';
        return;
      }
      bar.classList.remove('hide');
      renderHtml(bar, '<span class="text-[11px] font-bold text-slate-500 mr-1">Tag:</span>' +
        items.slice(0, 10).map((it) => `
          <button type="button" ${mkActionAttrs('applyTagFilter', [target, it.tag])}
                  class="px-2.5 py-1 rounded-full bg-brand/10 text-brand dark:text-brand-ink text-[11px] font-bold hover:bg-brand/20 transition-colors">
            ${escapeHtmlJS(it.tag)} <span class="opacity-75">(${it.count} · ${escapeHtmlJS(formatShortIDR(it.expense || it.income))})</span>
          </button>
        `).join(''));
    };

    fillBar('historiTagBar', 'histori', cycleTags);
    fillBar('lapTagBar', 'laporan', allTags);
  }

  async function openAutoCatRulesModal() {
    const pro = root.__mkPro || {};
    const custom = root.getAutoCategoryRules();
    const catByKey = new Map();
    [...(DB.categories?.pengeluaran || []), ...(DB.categories?.pemasukan || [])].forEach((c) => {
      const clean = String(c || '').trim();
      if (clean && !catByKey.has(clean.toLocaleLowerCase())) catByKey.set(clean.toLocaleLowerCase(), clean);
    });
    const allCats = Array.from(catByKey.values());
    const catOpts = allCats.map((c) => `<option value="${escapeHtmlJS(c)}">${escapeHtmlJS(c)}</option>`).join('');
    const customHtml = custom.length
      ? custom.map((r, i) => `
          <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs">
            <span class="truncate" title="${escapeHtmlJS(r.keyword)} → ${escapeHtmlJS(r.category)} (${escapeHtmlJS(r.tipe)})"><code>${escapeHtmlJS(r.keyword)}</code> → <strong>${escapeHtmlJS(r.category)}</strong> (${escapeHtmlJS(r.tipe)})</span>
            <button type="button" data-del-rule="${i}" class="min-h-9 min-w-11 px-3 py-1 rounded-lg bg-rose-500/10 text-rose-600 font-bold shrink-0">Hapus</button>
          </div>`).join('')
      : '<p class="text-xs text-slate-500">Belum ada aturan kustom (aturan bawaan tetap aktif).</p>';

    const res = await Swal.fire(pro.swalOpt({
      title: 'Aturan Auto-Kategori (CSV & Kilat)',
      width: 540,
      html: `
        <div class="text-left space-y-3">
          <p class="text-xs text-slate-500 dark:text-slate-400">Kata kunci dipisahkan dengan <code>|</code> (mis. <code>boba|kopi kenangan</code>).</p>
          <div class="space-y-1.5 max-h-36 overflow-y-auto">${customHtml}</div>
          <div class="border-t border-slate-200 dark:border-slate-700 pt-3 grid grid-cols-2 gap-2 text-xs">
            <input id="rule-kw" class="swal2-input col-span-2" style="margin:0;width:100%" placeholder="Kata kunci (mis. shopee|tokped)">
            <select id="rule-tipe" class="swal2-select" style="margin:0;width:100%">
              <option value="Pengeluaran">Pengeluaran</option>
              <option value="Pemasukan">Pemasukan</option>
            </select>
            <select id="rule-cat" class="swal2-select" style="margin:0;width:100%">${catOpts}</select>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Simpan Aturan',
      cancelButtonText: t('btn.tutup'),
      didOpen: () => {
        // Gelombang 6 (U6): hapus aturan minta konfirmasi — ketuk pertama
        // mempersenjatai tombol ("Yakin?"), ketuk kedua baru menghapus.
        // (Sebelumnya hapus langsung tanpa konfirmasi; salah ketuk = aturan hilang.)
        document.querySelectorAll('[data-del-rule]').forEach((b) => {
          b.onclick = () => {
            if (!b.dataset.armed) {
              b.dataset.armed = '1';
              b.textContent = 'Yakin?';
              b.classList.remove('bg-rose-500/10', 'text-rose-600');
              b.classList.add('bg-rose-600', 'text-white');
              window.setTimeout(() => {
                if (!b.isConnected || !b.dataset.armed) return;
                delete b.dataset.armed;
                b.textContent = 'Hapus';
                b.classList.remove('bg-rose-600', 'text-white');
                b.classList.add('bg-rose-500/10', 'text-rose-600');
              }, 3000);
              return;
            }
            const idx = Number(b.getAttribute('data-del-rule'));
            pro.safeWriteJson(pro.KEYS.AUTOCAT_RULES, custom.filter((_, i) => i !== idx));
            Swal.close();
            openAutoCatRulesModal();
          };
        });
      },
      preConfirm: () => {
        const keyword = String(document.getElementById('rule-kw').value || '').trim().toLowerCase();
        const tipe = document.getElementById('rule-tipe').value;
        const category = document.getElementById('rule-cat').value || 'Lainnya';
        if (!keyword) {
          Swal.showValidationMessage('Isi kata kunci aturan terlebih dahulu.');
          return false;
        }
        return { keyword, tipe, category };
      }
    }));

    if (res.isConfirmed && res.value) {
      custom.unshift(res.value);
      pro.safeWriteJson(pro.KEYS.AUTOCAT_RULES, custom);
      Swal.fire(pro.swalOpt({ icon: 'success', title: 'Aturan ditambahkan', timer: 1100, showConfirmButton: false }));
    }
  }

  Object.assign(root, {
    openCommandPalette,
    closeCommandPalette,
    filterCommandPalette,
    applyTagFilter,
    renderTagBars,
    openAutoCatRulesModal
  });
})(typeof window !== 'undefined' ? window : globalThis);
