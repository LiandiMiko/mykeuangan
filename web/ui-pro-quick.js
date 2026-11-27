/* global DB, FinancePro, Swal, callServer, refreshFromServer, formatRupiah, formatShortIDR, escapeHtmlJS, renderHtml, renderSelectOptions, walletOptions, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, getSwalClass, showActionError, cycleOfDate, localToday, t, mkActionAttrs */
/* ============================================================
   PRO FEATURES — QUICK-ADD, TEMPLATES & PWA UPDATE TOAST
   ============================================================ */
(function (root) {
  'use strict';

  const KEYS = {
    QUICK_TEMPLATES: 'mk_quick_templates_v1',
    AUTOCAT_RULES: 'mk_autocat_rules_v1',
    REBALANCE_TARGETS: 'mk_rebalance_targets_v1',
    AI_CHAT_HISTORY: 'mk_ai_chat_history_v1',
    AI_ANALYSIS_CACHE: 'mk_ai_analysis_cache_v1',
    BROWSER_NOTIF: 'mk_browser_notif_enabled',
    BROWSER_NOTIF_DATE: 'mk_browser_notif_last_date'
  };

  let cachedQuickTemplates = [];

  function safeReadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn('[Pro] Gagal membaca cache lokal:', key, err);
      return fallback;
    }
  }

  function safeWriteJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* ignore */
    }
  }

  function swalOpt(extra) {
    return Object.assign({ customClass: { popup: typeof getSwalClass === 'function' ? getSwalClass() : '' } }, extra || {});
  }

  function getAutoCategoryRules() {
    const saved = safeReadJson(KEYS.AUTOCAT_RULES, []);
    return Array.isArray(saved) ? saved : [];
  }

  function previewQuickAdd() {
    const input = document.getElementById('quickAddInput');
    const preview = document.getElementById('quickAddPreview');
    if (!input || !preview || typeof FinancePro === 'undefined' || typeof DB === 'undefined') return;
    const text = String(input.value || '').trim();
    if (!text) {
      preview.classList.add('hide');
      preview.textContent = '';
      return;
    }
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const parsed = FinancePro.parseQuickTxInput(text, DB.categories, DB.wallets, getAutoCategoryRules(), todayStr);
    preview.classList.remove('hide');
    if (!parsed.valid) {
      renderHtml(preview, '<span class="text-amber-600 dark:text-amber-400">Ketik nominal agar siap dicatat (contoh: kopi 25rb bca)</span>');
      return;
    }
    const badgeCls = parsed.tipe === 'Pemasukan'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300';
    const tagsHtml = parsed.tags.map((tg) => `<span class="px-1.5 py-0.5 rounded bg-brand/10 text-brand dark:text-brand-ink">${escapeHtmlJS(tg)}</span>`).join(' ');
    renderHtml(preview, `
      <span class="px-2 py-0.5 rounded-full ${badgeCls} font-bold mr-1">${escapeHtmlJS(parsed.tipe)}</span>
      <strong class="text-slate-800 dark:text-white mr-1">${escapeHtmlJS(formatRupiah(parsed.nominal).replace(',00', ''))}</strong>
      · <span>${escapeHtmlJS(parsed.kategori)}</span>
      ${parsed.walletName ? ` · <span>${escapeHtmlJS(parsed.walletName)}</span>` : ''}
      · <span class="italic">${escapeHtmlJS(parsed.keterangan)}</span> ${tagsHtml}
    `);
  }

  async function saveQuickTransactionObject(txPayload) {
    const txMonth = typeof cycleOfDate === 'function' ? cycleOfDate(txPayload.tanggal) : DB.currentPeriod;
    const needSwitch = txMonth && txMonth !== DB.currentPeriod;
    const data = await callServer('api_addTransaction', txPayload);
    if (needSwitch) {
      await callServer('api_savePeriod', txMonth);
      if (data) data.currentPeriod = txMonth;
      if (root.fpMonth) {
        try { root.fpMonth.setDate(txMonth, false); } catch (_) { /* ignore */ }
      }
    }
    await refreshFromServer(data);
  }

  async function submitQuickAdd(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('quickAddInput');
    const btn = document.getElementById('btnQuickAddSubmit');
    if (!input || typeof FinancePro === 'undefined' || (btn && btn.disabled)) return;
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const parsed = FinancePro.parseQuickTxInput(input.value, DB.categories, DB.wallets, getAutoCategoryRules(), todayStr);
    if (!parsed.valid) {
      Swal.fire(swalOpt({ icon: 'warning', title: 'Format belum lengkap', text: 'Sertakan nominal dan keterangan singkat, contoh: kopi 25rb bca' }));
      return;
    }
    const savedNodes = btn ? Array.from(btn.childNodes) : [];
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('opacity-75');
      renderHtml(btn, '<span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span><span class="hidden sm:inline">Menyimpan...</span>');
    }
    try {
      await saveQuickTransactionObject({
        tanggal: parsed.tanggal,
        tipe: parsed.tipe,
        kategori: parsed.kategori,
        nominal: parsed.nominal,
        keterangan: parsed.keterangan,
        walletId: parsed.walletId
      });
      input.value = '';
      previewQuickAdd();
      Swal.fire(swalOpt({
        icon: 'success',
        title: 'Tercatat!',
        text: `${parsed.kategori} · ${formatRupiah(parsed.nominal).replace(',00', '')}`,
        timer: 1300,
        showConfirmButton: false
      }));
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.classList.remove('opacity-75');
        btn.replaceChildren(...savedNodes);
      }
    }
  }

  function getMergedQuickTemplates() {
    const pinnedRaw = safeReadJson(KEYS.QUICK_TEMPLATES, []);
    const pinned = Array.isArray(pinnedRaw) ? pinnedRaw.map((p) => Object.assign({}, p, { pinned: true })) : [];
    const mined = typeof FinancePro !== 'undefined' && typeof DB !== 'undefined'
      ? FinancePro.buildFrequentTemplates(DB.transactions || [], 6)
      : [];
    const seen = new Set(pinned.map((p) => `${p.tipe}|${String(p.kategori).toLowerCase()}|${p.nominal}`));
    const merged = [...pinned];
    mined.forEach((m) => {
      const sig = `${m.tipe}|${String(m.kategori).toLowerCase()}|${m.nominal}`;
      if (!seen.has(sig) && merged.length < 7) {
        seen.add(sig);
        merged.push(m);
      }
    });
    return merged;
  }

  function renderQuickTemplates() {
    const container = document.getElementById('quickTemplateChips');
    if (!container || !root.isDataReady) return;
    cachedQuickTemplates = getMergedQuickTemplates();
    if (!cachedQuickTemplates.length) {
      renderHtml(container, '<span class="text-xs text-slate-500 dark:text-slate-400 shrink-0 whitespace-nowrap">Template otomatis muncul setelah beberapa transaksi.</span>');
      return;
    }
    renderHtml(container, cachedQuickTemplates.map((tpl, idx) => {
      const iconHtml = tpl.pinned
        ? '<i class="ph-fill ph-push-pin text-xs shrink-0" aria-hidden="true"></i>'
        : '<i class="ph-bold ph-lightning text-xs shrink-0" aria-hidden="true"></i>';
      const tone = tpl.tipe === 'Pemasukan'
        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-900/40'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700';
      return `<button type="button" ${mkActionAttrs('applyQuickTemplate', [idx])} class="min-h-8 px-2.5 py-1 rounded-full border text-xs font-bold inline-flex items-center gap-1 hover:border-brand transition-colors shrink-0 whitespace-nowrap tabular-nums ${tone}">${iconHtml}<span>${escapeHtmlJS(tpl.label)} · ${escapeHtmlJS(formatShortIDR(tpl.nominal))}</span></button>`;
    }).join(''));
  }

  async function applyQuickTemplate(idx) {
    const tpl = cachedQuickTemplates[idx];
    if (!tpl) return;
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const defaultWalletId = (DB.wallets && DB.wallets[0] && DB.wallets[0].id) || '';
    try {
      await saveQuickTransactionObject({
        tanggal: todayStr,
        tipe: tpl.tipe || 'Pengeluaran',
        kategori: tpl.kategori || 'Lainnya',
        nominal: Number(tpl.nominal) || 0,
        keterangan: tpl.keterangan || tpl.label,
        walletId: tpl.walletId || defaultWalletId
      });
      Swal.fire(swalOpt({
        icon: 'success',
        title: 'Template dicatat!',
        text: `${tpl.kategori} · ${formatRupiah(tpl.nominal).replace(',00', '')}`,
        timer: 1300,
        showConfirmButton: false
      }));
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  function bindTemplateDeleteButtons(pinned) {
    document.querySelectorAll('[data-del-tpl]').forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.getAttribute('data-del-tpl'));
        safeWriteJson(KEYS.QUICK_TEMPLATES, pinned.filter((_, i) => i !== idx));
        renderQuickTemplates();
        Swal.close();
        openQuickTemplatesModal();
      };
    });
  }

  function syncTemplateCategorySelect() {
    const tipeEl = document.getElementById('tpl-tipe');
    const catEl = document.getElementById('tpl-cat');
    if (!tipeEl || !catEl) return;
    const rawList = tipeEl.value === 'Pemasukan'
      ? (DB.categories?.pemasukan || [])
      : (DB.categories?.pengeluaran || []);
    const list = rawList.length ? rawList : ['Lainnya'];
    const prev = catEl.value;
    renderSelectOptions(catEl, list, null, list.includes(prev) ? prev : list[0]);
  }

  async function openQuickTemplatesModal() {
    const pinned = safeReadJson(KEYS.QUICK_TEMPLATES, []);
    const listHtml = pinned.length
      ? pinned.map((p, i) => `
          <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs">
            <span class="truncate font-semibold tabular-nums">${escapeHtmlJS(p.label)} · ${escapeHtmlJS(formatRupiah(p.nominal).replace(',00', ''))}</span>
            <button type="button" data-del-tpl="${i}" class="min-h-8 px-2.5 py-1 rounded bg-rose-500/10 text-rose-600 font-bold">Hapus</button>
          </div>`).join('')
      : '<p class="text-xs text-slate-500">Belum ada template yang disematkan.</p>';

    const res = await Swal.fire(swalOpt({
      title: 'Template Transaksi Cepat',
      width: 520,
      html: `
        <div class="text-left space-y-3">
          <div id="tplSavedList" class="space-y-1.5 max-h-36 overflow-y-auto">${listHtml}</div>
          <div class="border-t border-slate-200 dark:border-slate-700 pt-3 grid grid-cols-2 gap-2 text-xs">
            <label for="tpl-label" class="sr-only">Nama template</label>
            <input id="tpl-label" class="swal2-input col-span-2" style="margin:0;width:100%" placeholder="Nama singkat (mis. Kopi Pagi)">
            <label for="tpl-tipe" class="sr-only">Tipe template</label>
            <select id="tpl-tipe" class="swal2-select" style="margin:0;width:100%">
              <option value="Pengeluaran">Pengeluaran</option>
              <option value="Pemasukan">Pemasukan</option>
            </select>
            <label for="tpl-cat" class="sr-only">Kategori template</label>
            <select id="tpl-cat" class="swal2-select" style="margin:0;width:100%"></select>
            <label for="tpl-amt" class="sr-only">Nominal template (Rp)</label>
            <input id="tpl-amt" type="text" inputmode="numeric" class="swal2-input col-span-2 tabular-nums" style="margin:0;width:100%" placeholder="Nominal (Rp, mis. 25.000)">
            <label for="tpl-wallet" class="sr-only">Dompet template</label>
            <select id="tpl-wallet" class="swal2-select col-span-2" style="margin:0;width:100%">
              <option value="">Otomatis (dompet utama)</option>
              ${walletOptions('')}
            </select>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Tambah Template',
      cancelButtonText: t('btn.tutup'),
      didOpen: () => {
        bindTemplateDeleteButtons(pinned);
        bindNominalInputs(['tpl-amt']);
        syncTemplateCategorySelect();
        document.getElementById('tpl-tipe')?.addEventListener('change', syncTemplateCategorySelect);
      },
      preConfirm: () => {
        const label = String(document.getElementById('tpl-label').value || '').trim();
        const tipe = document.getElementById('tpl-tipe').value;
        const kategori = document.getElementById('tpl-cat').value || 'Lainnya';
        const nominal = parseFormattedNominal(document.getElementById('tpl-amt').value);
        const walletId = document.getElementById('tpl-wallet')?.value || '';
        if (!label || !Number.isFinite(nominal) || nominal <= 0) {
          Swal.showValidationMessage('Isi nama template dan nominal di atas 0.');
          return false;
        }
        return { label, tipe, kategori, nominal, keterangan: label, walletId };
      }
    }));

    if (res.isConfirmed && res.value) {
      pinned.push(res.value);
      safeWriteJson(KEYS.QUICK_TEMPLATES, pinned);
      renderQuickTemplates();
    }
  }

  function showPwaUpdateToast(reg) {
    if (document.getElementById('pwaUpdateToast')) return;
    const toast = document.createElement('div');
    toast.id = 'pwaUpdateToast';
    toast.setAttribute('data-open', 'false');
    toast.className = 'mk-toast fixed left-4 right-4 sm:left-auto sm:right-4 z-50 sm:max-w-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl shadow-2xl p-3.5 flex items-center gap-3 border border-slate-700 dark:border-slate-200';
    renderHtml(toast, `
      <i class="ph ph-sparkle text-xl text-brand-ink dark:text-brand shrink-0" aria-hidden="true"></i>
      <div class="min-w-0 flex-1 text-xs">
        <p class="font-bold">Pembaruan tersedia</p>
        <p class="opacity-80 text-[11px]">Muat ulang untuk memakai versi terbaru.</p>
      </div>
      <button type="button" id="pwaReloadBtn" class="min-h-9 px-3 py-1.5 rounded-xl bg-brand text-white text-xs font-bold shrink-0">Muat Ulang</button>
      <button type="button" id="pwaDismissBtn" aria-label="Tutup" class="w-8 h-8 rounded-lg opacity-75 hover:opacity-100 flex items-center justify-center"><i class="ph ph-x" aria-hidden="true"></i></button>
    `);
    document.body.appendChild(toast);
    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(() => toast.setAttribute('data-open', 'true'));
    } else {
      toast.setAttribute('data-open', 'true');
    }
    const dismiss = () => {
      toast.setAttribute('data-open', 'false');
      root.setTimeout(() => toast.remove(), 190);
    };
    document.getElementById('pwaReloadBtn').onclick = () => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        root.setTimeout(() => window.location.reload(), 1500);
        return;
      }
      window.location.reload();
    };
    document.getElementById('pwaDismissBtn').onclick = dismiss;
  }

  root.__mkPro = Object.assign(root.__mkPro || {}, { KEYS, safeReadJson, safeWriteJson, swalOpt });
  Object.assign(root, {
    getAutoCategoryRules,
    previewQuickAdd,
    submitQuickAdd,
    renderQuickTemplates,
    applyQuickTemplate,
    openQuickTemplatesModal,
    showPwaUpdateToast
  });
})(typeof window !== 'undefined' ? window : globalThis);
