/* global DB, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, renderSelectOptions, formatNominalInputValue, parseFormattedNominal, getSwalClass, showActionError, switchView, fillWalletSelect, cycleOfDate, t */
/* ============================================================
   TRANSACTION FORM & CATEGORY MANAGEMENT
   ============================================================ */
(function (root) {
  'use strict';

  function bindNominalFormatters() {
    ['tr_nominal', 'tr_split_amount', 'budgetJumlah'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.fmtBound === '1') return;
      el.dataset.fmtBound = '1';
      el.addEventListener('input', () => { el.value = formatNominalInputValue(el.value); });
    });
  }

  function addQuickNominalAmount(delta) {
    const input = document.getElementById('tr_nominal');
    if (!input) return;
    const current = parseFormattedNominal(input.value);
    const next = (Number.isFinite(current) && current > 0 ? current : 0) + (Number(delta) || 0);
    input.value = next > 0 ? formatNominalInputValue(next) : '';
  }

  function resetQuickNominalAmount() {
    const input = document.getElementById('tr_nominal');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  function openForm(action) {
    switchView('form-transaction');
    bindNominalFormatters();
    document.getElementById('formTransaction').reset();
    document.getElementById('tr_row').value = '';
    const tipeKey = action === 'Pemasukan' ? 'form.pemasukan' : 'form.pengeluaran';
    document.getElementById('formTitle').innerText = t('form.title_add') + ' ' + t(tipeKey);
    document.getElementById('tr_action').value = 'Tambah';

    const tipe = (action === 'Pemasukan' || action === 'Pinjaman') ? 'Pemasukan' : 'Pengeluaran';
    document.getElementById('tr_tipe').value = tipe;

    const btnClass = 'w-full text-white font-bold py-5 rounded-2xl shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 ' +
      (tipe === 'Pemasukan' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600');
    document.getElementById('btnSubmitTrans').className = btnClass;

    let opts = tipe === 'Pemasukan' ? (DB.categories.pemasukan || []) : (DB.categories.pengeluaran || []);
    if (action === 'Tabungan') opts = ['Tabungan Baru', 'Investasi'];
    renderSelectOptions(document.getElementById('tr_kategori'), opts, null);

    fillWalletSelect('tr_wallet');
    const wl = document.getElementById('tr_wallet_label');
    if (wl) wl.innerText = tipe === 'Pemasukan' ? 'Masuk ke dompet' : 'Dibayar dari dompet';

    if (root.fpTanggal) root.fpTanggal.setDate('today');
  }

  async function promptAddCategory() {
    const act = document.getElementById('tr_tipe').value;
    const { value: name } = await Swal.fire({
      title: 'Kategori Baru',
      input: 'text',
      showCancelButton: true,
      customClass: { popup: getSwalClass() }
    });
    if (!name) return;
    const tipeKey = act === 'Pemasukan' ? 'pemasukan' : 'pengeluaran';
    try {
      const data = await callServer('api_addCategory', tipeKey, name);
      DB.categories = data.categories;
      const select = document.getElementById('tr_kategori');
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
      select.value = name;
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
    const prev = selectedName || select.value;
    renderSelectOptions(select, opts, null, opts.includes(prev) ? prev : undefined);
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
            <span class="font-bold text-slate-800 dark:text-white truncate">${safe}</span>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" onclick="renameCategoryUI('${tipe}', '${attr}')" aria-label="Ubah nama ${safe}" class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center"><i class="ph ph-pencil" aria-hidden="true"></i></button>
              <button type="button" onclick="deleteCategoryUI('${tipe}', '${attr}')" aria-label="Hapus kategori ${safe}" class="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center"><i class="ph ph-trash" aria-hidden="true"></i></button>
            </div>
          </div>`;
      }).join('')
      : '<p class="text-xs text-slate-400 py-4 text-center">Belum ada kategori.</p>';

    await Swal.fire({
      title: 'Kelola Kategori (' + (tipe === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran') + ')',
      html: `
        <div class="flex gap-2 mb-3">
          <button type="button" onclick="openManageCategoriesModal('pengeluaran')" class="flex-1 py-2 rounded-xl text-xs font-bold ${tipe === 'pengeluaran' ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">Pengeluaran</button>
          <button type="button" onclick="openManageCategoriesModal('pemasukan')" class="flex-1 py-2 rounded-xl text-xs font-bold ${tipe === 'pemasukan' ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">Pemasukan</button>
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
    if (!newName || newName.trim() === oldName) {
      await openManageCategoriesModal(tipe);
      return;
    }
    try {
      const data = await callServer('api_renameCategory', tipe, oldName, newName.trim());
      await refreshFromServer(data);
      syncFormCategorySelect(newName.trim());
      await openManageCategoriesModal(tipe);
    } catch (e) {
      showActionError(e);
    }
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
    if (!conf.isConfirmed) {
      await openManageCategoriesModal(tipe);
      return;
    }
    try {
      const data = await callServer('api_deleteCategory', tipe, name);
      await refreshFromServer(data);
      syncFormCategorySelect();
      await openManageCategoriesModal(tipe);
    } catch (e) {
      showActionError(e);
    }
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
    const rowId = document.getElementById('tr_row').value;
    const p = readTransactionFormData();

    if (!p.tanggal || !/^\d{4}-\d{2}-\d{2}/.test(p.tanggal) || !p.nominal || p.nominal <= 0) {
      Swal.fire({
        icon: 'error',
        title: 'Data tidak valid',
        text: 'Isi tanggal (format YYYY-MM-DD) dan nominal dengan benar.',
        customClass: { popup: getSwalClass() }
      });
      return;
    }

    const savedBtnNodes = submitBtn ? Array.from(submitBtn.childNodes) : [];
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
      submitBtn.textContent = 'Menyimpan...';
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
      Swal.fire({ icon: 'error', title: 'Gagal menyimpan', text: String((err && err.message) || err), customClass: { popup: getSwalClass() } });
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        submitBtn.replaceChildren(...savedBtnNodes);
      }
    }
  }

  function editTransaction(id) {
    const tx = DB.transactions.find((x) => String(x.id) === String(id));
    if (!tx) return;
    openForm(tx.tipe);
    document.getElementById('formTitle').innerText = t('form.title_edit');
    document.getElementById('tr_action').value = 'Edit';
    document.getElementById('tr_row').value = tx.id;
    document.getElementById('tr_kategori').value = tx.kategori;
    document.getElementById('tr_nominal').value = formatNominalInputValue(tx.nominal);
    document.getElementById('tr_keterangan').value = tx.keterangan || '';
    fillWalletSelect('tr_wallet', tx.walletId);
    if (root.fpTanggal) {
      try { root.fpTanggal.setDate(tx.tanggal, true); } catch (_) { /* ignore */ }
    }
    const inputTgl = document.getElementById('tr_tanggal');
    if (inputTgl) inputTgl.value = tx.tanggal;
  }

  function showUndoDeleteToast(txSnapshot) {
    if (!txSnapshot) return;
    document.getElementById('mkUndoToast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'mkUndoToast';
    toast.setAttribute('role', 'status');
    toast.className = 'fixed bottom-20 lg:bottom-6 left-4 right-4 sm:left-auto sm:right-4 z-50 sm:max-w-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl shadow-2xl p-3.5 flex items-center justify-between gap-3 border border-slate-700 dark:border-slate-200';
    renderHtml(toast, `
      <span class="text-xs font-semibold truncate">Terhapus: ${escapeHtmlJS(txSnapshot.kategori)} (${escapeHtmlJS(formatRupiah(txSnapshot.nominal).replace(',00', ''))})</span>
      <div class="flex items-center gap-1.5 shrink-0">
        <button type="button" id="btnUndoDeleteTx" class="px-3 py-1.5 rounded-xl bg-brand text-white text-[11px] font-bold">Batalkan</button>
        <button type="button" id="btnDismissUndoTx" aria-label="Tutup" class="p-1 opacity-75 hover:opacity-100"><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
    `);
    document.body.appendChild(toast);
    const timer = root.setTimeout(() => toast.remove(), 6000);
    document.getElementById('btnDismissUndoTx').onclick = () => { root.clearTimeout(timer); toast.remove(); };
    document.getElementById('btnUndoDeleteTx').onclick = async () => {
      root.clearTimeout(timer);
      toast.remove();
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
    Swal.fire({
      title: 'Hapus Data?',
      text: 'Data tidak bisa dikembalikan!',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Ya, Hapus',
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
    openForm,
    addQuickNominalAmount,
    resetQuickNominalAmount,
    promptAddCategory,
    syncFormCategorySelect,
    openManageCategoriesModal,
    renameCategoryUI,
    deleteCategoryUI,
    submitTransaction,
    editTransaction,
    deleteTransaction
  });
})(typeof window !== 'undefined' ? window : globalThis);
