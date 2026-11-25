/* global DB, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, renderHtml, parseFormattedNominal, bindNominalInputs, getSwalClass, showActionError, walletOptions, localToday */
/* ============================================================
   DEBT & RECEIVABLES (UTANG / PIUTANG)
   ============================================================ */
(function (root) {
  'use strict';

  function computeDebtBalances() {
    const debtBal = { UtangApp: {}, UtangPerson: {}, Piutang: {} };
    (DB.entities.UtangApp || []).forEach((e) => { debtBal.UtangApp[e] = 0; });
    (DB.entities.UtangPerson || []).forEach((e) => { debtBal.UtangPerson[e] = 0; });
    (DB.entities.Piutang || []).forEach((e) => { debtBal.Piutang[e] = 0; });

    (DB.transactions || []).forEach((tx) => {
      if (tx.kategori.startsWith('UtangApp - ')) {
        const n = tx.kategori.replace('UtangApp - ', '');
        debtBal.UtangApp[n] = (debtBal.UtangApp[n] || 0) + (tx.tipe === 'Pemasukan' ? tx.nominal : -tx.nominal);
      } else if (tx.kategori.startsWith('UtangPerson - ')) {
        const n = tx.kategori.replace('UtangPerson - ', '');
        debtBal.UtangPerson[n] = (debtBal.UtangPerson[n] || 0) + (tx.tipe === 'Pemasukan' ? tx.nominal : -tx.nominal);
      } else if (tx.kategori.startsWith('Piutang - ')) {
        const n = tx.kategori.replace('Piutang - ', '');
        debtBal.Piutang[n] = (debtBal.Piutang[n] || 0) + (tx.tipe === 'Pengeluaran' ? tx.nominal : -tx.nominal);
      }
    });
    return debtBal;
  }

  function buildDebtCard(group, name, bal, iconCol, btnAddTxt, btnPayTxt) {
    let iconName = 'user-circle';
    if (group === 'UtangApp') iconName = 'device-mobile';
    if (group === 'Piutang') iconName = 'hand-coins';
    const safeName = escapeHtmlJS(name);
    const safeGroup = escapeHtmlJS(group);

    return `
      <div class="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 relative group transition-colors">
        <div class="flex justify-between items-start mb-3">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full flex items-center justify-center bg-white dark:bg-slate-700 shadow-sm ${iconCol}">
              <i class="ph ph-${iconName} text-lg"></i>
            </div>
            <p class="font-bold text-slate-800 dark:text-white truncate max-w-[120px]" title="${safeName}">${safeName}</p>
          </div>
          <div class="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
            <button type="button" data-debt-action="edit" data-debt-group="${safeGroup}" data-debt-name="${safeName}" aria-label="Edit ${safeName}" class="w-10 h-10 text-blue-700 dark:text-blue-400 hover:text-blue-800">
              <i class="ph ph-pencil" aria-hidden="true"></i>
            </button>
            <button type="button" data-debt-action="delete" data-debt-group="${safeGroup}" data-debt-name="${safeName}" aria-label="Hapus ${safeName}" class="w-10 h-10 text-rose-600 dark:text-rose-400 hover:text-rose-700">
              <i class="ph ph-trash" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <p class="text-xl font-black mb-4 text-slate-800 dark:text-white tabular-nums">${formatRupiah(bal).replace(',00', '')}</p>
        <div class="flex gap-2">
          <button type="button" data-debt-action="add" data-debt-group="${safeGroup}" data-debt-name="${safeName}" class="flex-1 min-h-[44px] py-2 bg-white dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600 text-xs font-bold shadow-sm hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition-colors">
            ${btnAddTxt}
          </button>
          <button type="button" data-debt-action="pay" data-debt-group="${safeGroup}" data-debt-name="${safeName}" class="flex-1 min-h-[44px] py-2 bg-brand text-white rounded-xl text-xs font-bold shadow-sm hover:bg-brand-hover transition-colors">
            ${btnPayTxt}
          </button>
        </div>
      </div>`;
  }

  function bindDebtCardActions(container) {
    container.querySelectorAll('[data-debt-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const { debtAction, debtGroup, debtName } = button.dataset;
        if (debtAction === 'edit' || debtAction === 'delete') {
          manageDebtEntity(debtAction, debtGroup, debtName);
        } else if (debtAction === 'add' || debtAction === 'pay') {
          transactDebt(debtAction, debtGroup, debtName);
        }
      });
    });
  }

  function renderDebtLists() {
    const debtBal = computeDebtBalances();
    const groups = [
      { id: 'list-utang-app', group: 'UtangApp', iconCol: 'text-rose-500', addTxt: 'Pinjam', payTxt: 'Bayar' },
      { id: 'list-utang-person', group: 'UtangPerson', iconCol: 'text-amber-500', addTxt: 'Pinjam', payTxt: 'Bayar' },
      { id: 'list-piutang', group: 'Piutang', iconCol: 'text-emerald-500', addTxt: 'Beri', payTxt: 'Terima' }
    ];
    groups.forEach((g) => {
      const el = document.getElementById(g.id);
      if (!el) return;
      renderHtml(el, Object.keys(debtBal[g.group])
        .map((n) => buildDebtCard(g.group, n, debtBal[g.group][n], g.iconCol, g.addTxt, g.payTxt))
        .join('') || '<p class="text-center text-xs text-slate-400 p-4">Klik + untuk menambah</p>');
      bindDebtCardActions(el);
    });
  }

  async function manageDebtEntity(action, group, oldName = '') {
    if (action === 'delete') {
      const r = await Swal.fire({
        title: `Hapus ${escapeHtmlJS(oldName)}?`,
        text: 'Catatan transaksi lama tidak akan terhapus.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        customClass: { popup: getSwalClass() }
      });
      if (!r.isConfirmed) return;
      try {
        await refreshFromServer(await callServer('api_deleteEntity', group, oldName));
      } catch (e) {
        showActionError(e);
      }
      return;
    }

    const title = action === 'add' ? (group === 'UtangApp' ? 'Nama Aplikasi' : 'Nama Orang') : 'Edit Nama';
    const { value: name } = await Swal.fire({
      title,
      input: 'text',
      inputValue: action === 'edit' ? oldName : '',
      inputPlaceholder: group === 'UtangApp' ? 'Contoh: Kredivo, SPayLater' : 'Contoh: Budi',
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      showCancelButton: true,
      customClass: { popup: getSwalClass() }
    });
    if (name && name !== oldName) {
      try {
        const data = action === 'add'
          ? await callServer('api_addEntity', group, name)
          : await callServer('api_updateEntity', group, oldName, name);
        await refreshFromServer(data);
      } catch (e) {
        showActionError(e);
      }
    }
  }

  async function transactDebt(type, group, name) {
    const isDebtGroup = group === 'UtangApp' || group === 'UtangPerson';
    const isIncome = isDebtGroup ? (type === 'add') : (type === 'pay');
    const title = isDebtGroup
      ? (type === 'add' ? `Pinjam dari ${name}` : `Bayar utang ke ${name}`)
      : (type === 'add' ? `Beri pinjaman ke ${name}` : `Terima bayaran dari ${name}`);

    const affectsCash = !(isDebtGroup && type === 'add');
    const walletSel = affectsCash && (DB.wallets || []).length
      ? `<div><label for="swal-wallet" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">${isIncome ? 'Masuk ke dompet' : 'Dibayar dari dompet'}</label><select id="swal-wallet" class="swal2-input" style="margin:0;width:100%">${walletOptions('')}</select></div>`
      : '';

    const { value: formVals } = await Swal.fire({
      title: escapeHtmlJS(title),
      html: `
        <div class="text-left space-y-3">
          <div>
            <label for="swal-nom" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Nominal (Rp)</label>
            <input id="swal-nom" class="swal2-input tabular-nums" style="margin:0;width:100%" type="text" inputmode="numeric" placeholder="0">
          </div>
          <div>
            <label for="swal-ket" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Catatan (opsional)</label>
            <input id="swal-ket" class="swal2-input" style="margin:0;width:100%" type="text" placeholder="Contoh: Cicilan ke-1">
          </div>
          <div>
            <label for="swal-date" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Tanggal Transaksi</label>
            <input id="swal-date" class="swal2-input" style="margin:0;width:100%" type="date" value="${localToday()}">
          </div>
          ${walletSel}
        </div>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      didOpen: () => bindNominalInputs(['swal-nom']),
      preConfirm: () => {
        const rawNom = document.getElementById('swal-nom').value;
        const parsedNom = Math.round(parseFormattedNominal(rawNom));
        if (!parsedNom || parsedNom <= 0) {
          Swal.showValidationMessage('Isi nominal lebih dari 0.');
          return false;
        }
        return [
          rawNom,
          document.getElementById('swal-ket').value,
          (document.getElementById('swal-wallet') || {}).value || '',
          (document.getElementById('swal-date') || {}).value || localToday()
        ];
      }
    });

    if (formVals && formVals[0]) {
      const nominal = Math.round(parseFormattedNominal(formVals[0]));
      if (!nominal || nominal <= 0) return;
      const payload = {
        tanggal: (formVals[3] || '').slice(0, 10) || localToday(),
        tipe: isIncome ? 'Pemasukan' : 'Pengeluaran',
        kategori: `${group} - ${name}`,
        nominal,
        keterangan: formVals[1] || '',
        walletId: formVals[2] || ''
      };
      try {
        await refreshFromServer(await callServer('api_addTransaction', payload));
        Swal.fire({ icon: 'success', title: 'Tercatat', timer: 1000, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      } catch (e) {
        showActionError(e);
      }
    }
  }

  Object.assign(root, {
    renderDebtLists,
    bindDebtCardActions,
    manageDebtEntity,
    transactDebt
  });
})(typeof window !== 'undefined' ? window : globalThis);
