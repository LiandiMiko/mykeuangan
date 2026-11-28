// @depends-on: ui-state.js
/* global DB, Swal, callServer, refreshFromServer, renderAll, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, renderSelectOptions, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, getSwalClass, showActionError, getPeriodLabel, t, mkActionAttrs */
/* ============================================================
   PAYROLL CYCLE & RECURRING TRANSACTIONS
   ============================================================ */
(function (root) {
  'use strict';

  async function settingPayrollDay() {
    const current = DB.payrollDay || 1;
    const { value: day } = await Swal.fire({
      title: t('payroll.title'),
      html: `
        <div class="text-left space-y-3">
          <p class="text-xs leading-relaxed text-slate-600 dark:text-slate-300">${escapeHtmlJS(t('payroll.desc'))}</p>
          <div>
            <label for="swal-payroll" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Tanggal gajian (1 - 28)</label>
            <input id="swal-payroll" type="number" min="1" max="28" value="${current}"
                   class="swal2-input tabular-nums text-center font-bold text-xl" style="margin-top:0.35rem" placeholder="1-28">
          </div>
          <div class="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-1">
            <p class="text-xs font-medium text-slate-700 dark:text-slate-200">${escapeHtmlJS(t('payroll.example'))}: <b class="tabular-nums">28</b> &rarr; ${escapeHtmlJS(getPeriodLabel(DB.currentPeriod, 28))}</p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('payroll.range_hint'))}</p>
          </div>
        </div>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const v = parseInt(document.getElementById('swal-payroll').value, 10);
        if (!v || v < 1 || v > 28) { Swal.showValidationMessage('1-28'); return false; }
        return v;
      }
    });
    if (!day) return;
    try {
      await callServer('api_savePayrollDay', day);
      DB.payrollDay = Number(day);
      renderAll();
      const cycleLabel = getPeriodLabel(DB.currentPeriod, day);
      Swal.fire({
        icon: 'success',
        title: t('payroll.saved'),
        html: `<div class="space-y-1.5 text-center">
                 <p class="text-sm text-slate-700 dark:text-slate-200">${escapeHtmlJS(t('payroll.tanggal'))}: <b>${day}</b></p>
                 <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('payroll.active_cycle'))}: <b>${escapeHtmlJS(cycleLabel)}</b></p>
               </div>`,
        timer: 2500,
        showConfirmButton: false,
        customClass: { popup: getSwalClass() }
      });
    } catch (e) {
      showActionError(e);
    }
  }

  function buildRecurringCardHtml(r) {
    const isActive = String(r.active) !== 'false' && r.active !== false;
    const isIncome = r.tipe === 'Pemasukan';
    const badgeClass = isActive
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
    const amountClass = isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const idAttr = escapeAttrJS(r.id);
    const catHtml = escapeHtmlJS(r.kategori);

    return `
      <article class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="font-bold text-slate-800 dark:text-white text-sm truncate" title="${catHtml}">${catHtml}</h4>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">${escapeHtmlJS(isActive ? t('rec.active') : t('rec.paused'))}</span>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${escapeHtmlJS(t('rec.day_prefix'))} ${escapeHtmlJS(r.dayOfMonth)}${r.keterangan ? ' · ' + escapeHtmlJS(r.keterangan) : ''}</p>
          <p class="font-black text-sm mt-1 tabular-nums ${amountClass}">${isIncome ? '+' : '-'}${formatRupiah(r.nominal)}</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button type="button" ${mkActionAttrs('recordRecurringFromNotif', [r.id])} aria-label="Catat sekarang ${catHtml}" title="Catat transaksi ini sekarang" class="h-10 px-2.5 rounded-xl bg-brand/10 dark:bg-brand/20 text-brand dark:text-brand-ink text-[11px] font-bold flex items-center justify-center gap-1 hover:bg-brand hover:text-white transition-colors">
            <i class="ph-bold ph-lightning" aria-hidden="true"></i> <span>Catat</span>
          </button>
          <button type="button" ${mkActionAttrs('toggleRecurringItem', [r.id, !isActive])} aria-label="${isActive ? 'Jeda' : 'Aktifkan'} jadwal ${catHtml}" title="${isActive ? 'Jeda' : 'Aktifkan'}" class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700">
            <i class="ph ph-${isActive ? 'pause' : 'play'}" aria-hidden="true"></i>
          </button>
          <button type="button" ${mkActionAttrs('openRecurringForm', [r.id])} aria-label="Edit jadwal ${catHtml}" title="Edit" class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center hover:bg-blue-100">
            <i class="ph ph-pencil" aria-hidden="true"></i>
          </button>
          <button type="button" ${mkActionAttrs('deleteRecurringItem', [r.id])} aria-label="Hapus jadwal ${catHtml}" title="Hapus" class="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center hover:bg-rose-100">
            <i class="ph ph-trash" aria-hidden="true"></i>
          </button>
        </div>
      </article>`;
  }

  function renderRecurring() {
    const container = document.getElementById('recurringList');
    if (!container) return;
    const list = (DB.recurring || []).slice().sort((a, b) => Number(a.dayOfMonth) - Number(b.dayOfMonth));
    if (!list.length) {
      renderHtml(container, `<p class="md:col-span-2 p-6 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500">${escapeHtmlJS(t('rec.empty'))}</p>`);
      return;
    }
    renderHtml(container, list.map(buildRecurringCardHtml).join(''));
  }

  async function openRecurringForm(id) {
    const item = (DB.recurring || []).find((x) => String(x.id) === String(id));
    const cur = item || { tipe: 'Pengeluaran', kategori: '', nominal: '', dayOfMonth: 1, keterangan: '', active: true };
    const curKey = String(cur.kategori || '').trim().toLocaleLowerCase();
    const getCatList = (tipe) => {
      const raw = tipe === 'Pemasukan' ? (DB.categories.pemasukan || []) : (DB.categories.pengeluaran || []);
      const list = raw.length ? raw.slice() : ['Lainnya'];
      if (item && cur.kategori && !list.some((c) => String(c || '').trim().toLocaleLowerCase() === curKey)) {
        list.push(String(cur.kategori).trim());
      }
      return list;
    };
    const optsFor = (tipe) => getCatList(tipe).map((c) => {
      const selected = curKey && String(c || '').trim().toLocaleLowerCase() === curKey;
      return `<option value="${escapeHtmlJS(c)}" ${selected ? 'selected' : ''}>${escapeHtmlJS(c)}</option>`;
    }).join('');

    const res = await Swal.fire({
      title: item ? 'Edit Jadwal Rutin' : t('rec.add'),
      html: `
        <div class="text-left space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="rec-tipe" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Tipe</label>
              <select id="rec-tipe" class="swal2-input" style="margin-top:0.35rem">
                <option value="Pengeluaran" ${cur.tipe === 'Pengeluaran' ? 'selected' : ''}>Pengeluaran</option>
                <option value="Pemasukan" ${cur.tipe === 'Pemasukan' ? 'selected' : ''}>Pemasukan</option>
              </select>
            </div>
            <div>
              <label for="rec-day" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Tanggal Eksekusi (1-31)</label>
              <input id="rec-day" type="number" min="1" max="31" value="${escapeHtmlJS(cur.dayOfMonth || 1)}" class="swal2-input tabular-nums" style="margin-top:0.35rem">
            </div>
          </div>
          <div>
            <label for="rec-kat" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Kategori</label>
            <select id="rec-kat" class="swal2-input" style="margin-top:0.35rem">${optsFor(cur.tipe)}</select>
          </div>
          <div>
            <label for="rec-nom" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Nominal (Rp)</label>
            <input id="rec-nom" type="text" inputmode="numeric" value="${escapeHtmlJS(cur.nominal ? formatNominalInputValue(cur.nominal) : '')}" class="swal2-input tabular-nums" style="margin-top:0.35rem" placeholder="Contoh: 350.000">
          </div>
          <div>
            <label for="rec-ket" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Catatan</label>
            <input id="rec-ket" type="text" value="${escapeHtmlJS(cur.keterangan)}" class="swal2-input" style="margin-top:0.35rem" placeholder="Contoh: Internet Rumah">
          </div>
        </div>`,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        bindNominalInputs(['rec-nom']);
        const tipeSel = document.getElementById('rec-tipe');
        const katSel = document.getElementById('rec-kat');
        if (tipeSel && katSel) {
          tipeSel.addEventListener('change', () => {
            const list = getCatList(tipeSel.value);
            const matchCur = list.find((c) => String(c || '').trim().toLocaleLowerCase() === curKey);
            renderSelectOptions(katSel, list, null, matchCur);
          });
        }
      },
      preConfirm: () => {
        const tipe = document.getElementById('rec-tipe').value;
        const kategori = document.getElementById('rec-kat').value;
        const nominal = Math.round(parseFormattedNominal(document.getElementById('rec-nom').value));
        const dayOfMonth = parseInt(document.getElementById('rec-day').value, 10);
        const keterangan = document.getElementById('rec-ket').value.trim();
        if (!kategori || !Number.isFinite(nominal) || nominal <= 0 || !dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) {
          Swal.showValidationMessage('Periksa tipe, kategori, nominal, dan tanggal (1-31).');
          return false;
        }
        return {
          id: item ? item.id : undefined,
          tipe, kategori, nominal, dayOfMonth, keterangan,
          active: String(cur.active) !== 'false' && cur.active !== false
        };
      }
    });
    if (!res.isConfirmed || !res.value) return;
    try {
      await refreshFromServer(await callServer('api_saveRecurring', res.value));
      Swal.fire({ icon: 'success', title: t('alert.saved'), timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      showActionError(e);
    }
  }

  async function toggleRecurringItem(id, active) {
    try {
      await refreshFromServer(await callServer('api_toggleRecurring', id, active));
    } catch (e) {
      showActionError(e);
    }
  }

  async function deleteRecurringItem(id) {
    const conf = await Swal.fire({
      icon: 'warning',
      title: t('alert.confirm_delete'),
      text: 'Jadwal transaksi rutin ini akan dihapus.',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: t('btn.ya_hapus'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!conf.isConfirmed) return;
    try {
      await refreshFromServer(await callServer('api_deleteRecurring', id));
    } catch (e) {
      showActionError(e);
    }
  }

  Object.assign(root, {
    settingPayrollDay,
    renderRecurring,
    openRecurringForm,
    toggleRecurringItem,
    deleteRecurringItem
  });
})(typeof window !== 'undefined' ? window : globalThis);
