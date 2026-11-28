// @depends-on: ui-state.js
/* global DB, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, renderSelectOptions, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, getSwalClass, showActionError, switchView, fillWalletSelect, cycleOfDate, t, mkActionAttrs, toUserErrorMessage */
/* ============================================================
   TRANSACTION FORM & CATEGORY MANAGEMENT
   ============================================================ */
(function (root) {
  'use strict';

  function setFormFieldError(inputId, errId, msg) {
    const errEl = document.getElementById(errId);
    const inpEl = document.getElementById(inputId);
    if (errEl) {
      errEl.textContent = msg || '';
      errEl.classList.toggle('hide', !msg);
    }
    if (inpEl) {
      if (msg) inpEl.setAttribute('aria-invalid', 'true');
      else inpEl.removeAttribute('aria-invalid');
    }
  }

  function clearFormErrors() {
    setFormFieldError('tr_tanggal', 'tr_tanggal_error', '');
    setFormFieldError('tr_nominal', 'tr_nominal_error', '');
    setFormFieldError('tr_split_person', 'tr_split_error', '');
    const splitAmt = document.getElementById('tr_split_amount');
    if (splitAmt) splitAmt.removeAttribute('aria-invalid');
  }

  function bindNominalFormatters() {
    bindNominalInputs(['tr_nominal', 'tr_split_amount', 'budgetJumlah']);
    const noteEl = document.getElementById('tr_keterangan');
    if (noteEl && noteEl.dataset.growBound !== '1') {
      noteEl.dataset.growBound = '1';
      noteEl.addEventListener('input', () => {
        noteEl.style.height = 'auto';
        noteEl.style.height = Math.min(256, noteEl.scrollHeight) + 'px';
      });
    }
    [['tr_tanggal', 'tr_tanggal_error'], ['tr_nominal', 'tr_nominal_error'], ['tr_split_person', 'tr_split_error'], ['tr_split_amount', 'tr_split_error']].forEach(([inpId, errId]) => {
      const el = document.getElementById(inpId);
      if (el && el.dataset.errBound !== '1') {
        el.dataset.errBound = '1';
        el.addEventListener('input', () => setFormFieldError(inpId, errId, ''));
      }
    });
  }

  function addQuickNominalAmount(delta) {
    const input = document.getElementById('tr_nominal');
    if (!input) return;
    const current = parseFormattedNominal(input.value);
    const next = (Number.isFinite(current) && current > 0 ? current : 0) + (Number(delta) || 0);
    input.value = next > 0 ? formatNominalInputValue(next) : '';
    setFormFieldError('tr_nominal', 'tr_nominal_error', '');
  }

  function resetQuickNominalAmount() {
    const input = document.getElementById('tr_nominal');
    if (input) {
      input.value = '';
      setFormFieldError('tr_nominal', 'tr_nominal_error', '');
      input.focus();
    }
  }

  function openForm(action) {
    switchView('form-transaction');
    bindNominalFormatters();
    clearFormErrors();
    document.getElementById('formTransaction').reset();
    const noteEl = document.getElementById('tr_keterangan');
    if (noteEl) noteEl.style.height = '';
    document.getElementById('tr_row').value = '';
    const tipeKey = action === 'Pemasukan' ? 'form.pemasukan' : 'form.pengeluaran';
    document.getElementById('formTitle').innerText = t('form.title_add') + ' ' + t(tipeKey);
    document.getElementById('tr_action').value = 'Tambah';

    const tipe = (action === 'Pemasukan' || action === 'Pinjaman') ? 'Pemasukan' : 'Pengeluaran';
    document.getElementById('tr_tipe').value = tipe;

    const btnClass = 'w-full min-h-[52px] text-white font-bold py-3.5 rounded-2xl shadow-xl transition-[background-color,opacity,transform] flex items-center justify-center gap-2 ' +
      (tipe === 'Pemasukan' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700');
    document.getElementById('btnSubmitTrans').className = btnClass;

    let opts = tipe === 'Pemasukan' ? (DB.categories.pemasukan || []) : (DB.categories.pengeluaran || []);
    if (action === 'Tabungan') opts = ['Tabungan Baru', 'Investasi'];
    renderSelectOptions(document.getElementById('tr_kategori'), opts, null);

    fillWalletSelect('tr_wallet');
    const wl = document.getElementById('tr_wallet_label');
    if (wl) wl.innerText = tipe === 'Pemasukan' ? t('form.wallet_in') : t('form.wallet_out');

    if (root.fpTanggal) root.fpTanggal.setDate('today');
  }

  async function promptAddCategory() {
    const act = document.getElementById('tr_tipe').value;
    const { value: name } = await Swal.fire({
      title: 'Kategori Baru',
      input: 'text',
      inputPlaceholder: 'Contoh: Kopi, Parkir, Bonus',
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      showCancelButton: true,
      customClass: { popup: getSwalClass() }
    });
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const tipeKey = act === 'Pemasukan' ? 'pemasukan' : 'pengeluaran';
    try {
      const data = await callServer('api_addCategory', tipeKey, cleanName);
      DB.categories = data.categories;
      syncFormCategorySelect(cleanName);
    } catch (e) {
      showActionError(e);
    }
  }

  function syncFormCategorySelect(selectedName) {
    const tipeEl = document.getElementById('tr_tipe');
    const select = document.getElementById('tr_kategori');
    if (!tipeEl || !select) return;
    const tipe = tipeEl.value === 'Pemasukan' ? 'pemasukan' : 'pengeluaran';
    const opts = DB.categories[tipe] || [];
    const prev = String(selectedName || select.value || '').trim();
    const prevKey = prev.toLocaleLowerCase();
    const match = opts.find((c) => String(c || '').trim().toLocaleLowerCase() === prevKey);
    renderSelectOptions(select, opts, null, match || undefined);
  }

  async function openManageCategoriesModal(defaultTipe) {
    const formTipeEl = document.getElementById('tr_tipe');
    const tipe = defaultTipe || (formTipeEl && formTipeEl.value === 'Pemasukan' ? 'pemasukan' : 'pengeluaran');
    const list = (DB.categories && DB.categories[tipe]) || [];
    const rowsHtml = list.length
      ? list.map((name) => {
        const safe = escapeHtmlJS(name);
        const attr = escapeAttrJS(name);
        return `
          <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-xs">
            <span class="font-bold text-slate-800 dark:text-white truncate" title="${safe}">${safe}</span>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" ${mkActionAttrs('renameCategoryUI', [tipe, name])} aria-label="Ubah nama ${safe}" class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center"><i class="ph ph-pencil" aria-hidden="true"></i></button>
              <button type="button" ${mkActionAttrs('deleteCategoryUI', [tipe, name])} aria-label="Hapus kategori ${safe}" class="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center"><i class="ph ph-trash" aria-hidden="true"></i></button>
            </div>
          </div>`;
      }).join('')
      : '<p class="text-xs text-slate-500 py-4 text-center">Belum ada kategori.</p>';

    await Swal.fire({
      title: 'Kelola Kategori (' + (tipe === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran') + ')',
      html: `
        <div class="flex gap-2 mb-3">
          <button type="button" data-action="openManageCategoriesModal" data-args='["pengeluaran"]' class="flex-1 py-2 rounded-xl text-xs font-bold ${tipe === 'pengeluaran' ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">Pengeluaran</button>
          <button type="button" data-action="openManageCategoriesModal" data-args='["pemasukan"]' class="flex-1 py-2 rounded-xl text-xs font-bold ${tipe === 'pemasukan' ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">Pemasukan</button>
        </div>
        <div class="space-y-2 max-h-64 overflow-y-auto text-left">${rowsHtml}</div>`,
      showConfirmButton: true,
      confirmButtonText: t('btn.tutup'),
      customClass: { popup: getSwalClass() }
    });
  }

  async function renameCategoryUI(tipe, oldName) {
    const { value: newName } = await Swal.fire({
      title: 'Ubah Nama Kategori',
      input: 'text',
      inputValue: oldName,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      inputValidator: (v) => (!v || !v.trim()) ? 'Nama kategori wajib diisi.' : undefined
    });
    if (!newName || newName.trim() === oldName) { await openManageCategoriesModal(tipe); return; }
    try {
      const data = await callServer('api_renameCategory', tipe, oldName, newName.trim());
      await refreshFromServer(data);
      syncFormCategorySelect(newName.trim());
      await openManageCategoriesModal(tipe);
    } catch (e) { showActionError(e); }
  }

  async function deleteCategoryUI(tipe, name) {
    const conf = await Swal.fire({
      icon: 'warning',
      title: 'Hapus kategori "' + escapeHtmlJS(name) + '"?',
      text: 'Transaksi lama tetap tersimpan, kategori hanya dihapus dari daftar pilihan.',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: t('btn.ya_hapus'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!conf.isConfirmed) { await openManageCategoriesModal(tipe); return; }
    try {
      const data = await callServer('api_deleteCategory', tipe, name);
      await refreshFromServer(data);
      syncFormCategorySelect();
      await openManageCategoriesModal(tipe);
    } catch (e) { showActionError(e); }
  }

  function readTransactionFormData() {
    let tanggal = document.getElementById('tr_tanggal').value;
    if (!tanggal && root.fpTanggal && root.fpTanggal.selectedDates && root.fpTanggal.selectedDates.length > 0) {
      const d = root.fpTanggal.selectedDates[0];
      tanggal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return {
      tanggal,
      tipe: document.getElementById('tr_tipe').value,
      kategori: document.getElementById('tr_kategori').value,
      nominal: parseFormattedNominal(document.getElementById('tr_nominal').value),
      keterangan: document.getElementById('tr_keterangan').value,
      walletId: (document.getElementById('tr_wallet') || {}).value || ''
    };
  }

  async function submitTransaction(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('btnSubmitTrans');
    if (submitBtn && submitBtn.disabled) return;
    clearFormErrors();
    const rowId = document.getElementById('tr_row').value;
    const p = readTransactionFormData();

    let firstInvalid = null;
    if (!p.tanggal || !/^\d{4}-\d{2}-\d{2}/.test(p.tanggal)) {
      setFormFieldError('tr_tanggal', 'tr_tanggal_error', 'Pilih tanggal dari kalender atau ketik tanggal yang benar, mis. 28 November 2026.');
      firstInvalid = document.getElementById('tr_tanggal');
    }
    if (!p.nominal || p.nominal <= 0) {
      setFormFieldError('tr_nominal', 'tr_nominal_error', 'Masukkan nominal lebih dari 0.');
      if (!firstInvalid) firstInvalid = document.getElementById('tr_nominal');
    }
    if (firstInvalid) { firstInvalid.focus(); return; }

    const savedBtnNodes = submitBtn ? Array.from(submitBtn.childNodes) : [];
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
      renderHtml(submitBtn, '<i class="ph ph-spinner animate-spin" aria-hidden="true"></i><span>Menyimpan...</span>');
    }

    const txMonth = cycleOfDate(p.tanggal);
    const needPeriodSwitch = txMonth !== DB.currentPeriod;

    try {
      const data = rowId
        ? await callServer('api_updateTransaction', rowId, p)
        : await callServer('api_addTransaction', p);

      if (needPeriodSwitch) {
        await callServer('api_savePeriod', txMonth);
        data.currentPeriod = txMonth;
        if (root.fpMonth) {
          try { root.fpMonth.setDate(txMonth, false); } catch (_) { /* ignore */ }
        }
      }
      await refreshFromServer(data);
      Swal.fire({
        icon: 'success',
        title: 'Tersimpan!',
        html: `Transaksi <b>${escapeHtmlJS(p.tipe)}</b> sebesar <b>${formatRupiah(p.nominal)}</b> berhasil dicatat.`,
        timer: 1500,
        showConfirmButton: false,
        customClass: { popup: getSwalClass() }
      });
      switchView('dashboard');
    } catch (err) {
      console.error('[submitTransaction] error:', err);
      Swal.fire({ icon: 'error', title: 'Gagal menyimpan', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
        submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        submitBtn.replaceChildren(...savedBtnNodes);
      }
    }
  }

  function selectCategorySafely(selectEl, rawCategory) {
    if (!selectEl) return;
    const raw = String(rawCategory || '').trim();
    const targetKey = raw.toLocaleLowerCase();
    const options = Array.from(selectEl.options || []);
    const matched = options.find((opt) => opt.value === rawCategory) ||
      options.find((opt) => String(opt.value || '').trim().toLocaleLowerCase() === targetKey);
    if (matched) { selectEl.value = matched.value; return; }
    if (!raw) return;
    const extraOpt = document.createElement('option');
    extraOpt.value = raw;
    extraOpt.textContent = raw;
    selectEl.appendChild(extraOpt);
    selectEl.value = raw;
  }

  function editTransaction(id) {
    const tx = DB.transactions.find((x) => String(x.id) === String(id));
    if (!tx) return;
    openForm(tx.tipe);
    document.getElementById('formTitle').innerText = t('form.title_edit');
    document.getElementById('tr_action').value = 'Edit';
    document.getElementById('tr_row').value = tx.id;
    selectCategorySafely(document.getElementById('tr_kategori'), tx.kategori);
    document.getElementById('tr_nominal').value = formatNominalInputValue(tx.nominal);
    const noteEl = document.getElementById('tr_keterangan');
    if (noteEl) {
      noteEl.value = tx.keterangan || '';
      noteEl.style.height = 'auto';
      noteEl.style.height = Math.min(256, noteEl.scrollHeight) + 'px';
    }
    fillWalletSelect('tr_wallet', tx.walletId);
    if (root.fpTanggal) {
      try { root.fpTanggal.setDate(tx.tanggal, true); } catch (_) { /* ignore */ }
    }
    const inputTgl = document.getElementById('tr_tanggal');
    if (inputTgl) inputTgl.value = tx.tanggal;
  }

  function showUndoDeleteToast(txSnapshot) {
    if (!txSnapshot) return;
    const prev = document.getElementById('mkUndoToast');
    if (prev) { if (typeof prev._mkCleanup === 'function') prev._mkCleanup(); prev.remove(); }
    const toast = document.createElement('div');
    toast.id = 'mkUndoToast';
    toast.setAttribute('role', 'status');
    toast.className = 'mk-toast fixed left-4 right-4 sm:left-auto sm:right-4 z-50 sm:max-w-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-700 dark:border-slate-200';
    renderHtml(toast, `
      <div class="p-3.5 flex items-center justify-between gap-3">
        <span class="text-xs font-semibold truncate tabular-nums" title="Terhapus: ${escapeHtmlJS(txSnapshot.kategori)} (${escapeHtmlJS(formatRupiah(txSnapshot.nominal).replace(',00', ''))})">Terhapus: ${escapeHtmlJS(txSnapshot.kategori)} (${escapeHtmlJS(formatRupiah(txSnapshot.nominal).replace(',00', ''))})</span>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" id="btnUndoDeleteTx" class="px-3 min-h-9 rounded-xl bg-brand hover:bg-brand-hover text-white text-[11px] font-bold transition-colors">Batalkan</button>
          <button type="button" id="btnDismissUndoTx" aria-label="Tutup" class="w-8 h-8 rounded-lg flex items-center justify-center opacity-80 hover:opacity-100"><i class="ph ph-x" aria-hidden="true"></i></button>
        </div>
      </div>
      <div class="h-1 bg-slate-800 dark:bg-slate-200"><div class="mk-toast-progress h-full bg-brand"></div></div>
    `);
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.dataset.open = 'true'; });

    let remaining = 6000;
    let startedAt = Date.now();
    let timer = null;
    const closeToast = () => {
      root.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisChange);
      delete toast.dataset.open;
      root.setTimeout(() => toast.remove(), 200);
    };
    const pause = () => {
      if (!timer) return;
      root.clearTimeout(timer);
      timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
      toast.dataset.paused = 'true';
    };
    const resume = () => {
      if (timer || document.hidden) return;
      delete toast.dataset.paused;
      startedAt = Date.now();
      timer = root.setTimeout(closeToast, Math.max(250, remaining));
    };
    const onVisChange = () => (document.hidden ? pause() : resume());
    toast._mkCleanup = () => { root.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisChange); };
    toast.addEventListener('mouseenter', pause);
    toast.addEventListener('mouseleave', resume);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', resume);
    document.addEventListener('visibilitychange', onVisChange);
    resume();

    document.getElementById('btnDismissUndoTx').onclick = closeToast;
    document.getElementById('btnUndoDeleteTx').onclick = async () => {
      closeToast();
      try {
        await refreshFromServer(await callServer('api_addTransaction', {
          tanggal: txSnapshot.tanggal,
          tipe: txSnapshot.tipe,
          kategori: txSnapshot.kategori,
          nominal: Number(txSnapshot.nominal) || 0,
          keterangan: txSnapshot.keterangan || '',
          walletId: txSnapshot.walletId || ''
        }));
      } catch (err) {
        showActionError(err);
      }
    };
  }

  function deleteTransaction(id) {
    const targetTx = (DB.transactions || []).find((x) => String(x.id) === String(id));
    const txLabel = targetTx
      ? `${targetTx.kategori || 'Transaksi'} (${formatRupiah(targetTx.nominal).replace(',00', '')})`
      : 'transaksi ini';
    Swal.fire({
      title: 'Hapus Transaksi?',
      text: `Hapus ${txLabel}? Kamu masih bisa membatalkannya lewat Undo selama 6 detik setelah dihapus.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      confirmButtonText: 'Hapus Transaksi',
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        await refreshFromServer(await callServer('api_deleteTransaction', id));
        if (targetTx) showUndoDeleteToast(targetTx);
      } catch (e) {
        showActionError(e);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', bindNominalFormatters);

  Object.assign(root, {
    openForm, setFormFieldError, clearFormErrors, addQuickNominalAmount, resetQuickNominalAmount,
    promptAddCategory, syncFormCategorySelect, openManageCategoriesModal, renameCategoryUI,
    deleteCategoryUI, submitTransaction, editTransaction, deleteTransaction
  });
})(typeof window !== 'undefined' ? window : globalThis);
