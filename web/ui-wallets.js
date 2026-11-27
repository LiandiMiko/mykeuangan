/* global DB, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, renderSelectOptions, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, getSwalClass, showActionError, t, mkActionAttrs */
/* ============================================================
   WALLETS, TRANSFERS & DATE HELPERS
   ============================================================ */
(function (root) {
  'use strict';

  const isPiutangK = (k) => String(k).startsWith('Piutang');
  const isUtangK = (k) => !isPiutangK(k) && String(k).startsWith('Utang');

  function localToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function cycleOfDate(tanggal) {
    const pd = Number(DB.payrollDay) || 1;
    const parts = String(tanggal).slice(0, 10).split('-').map(Number);
    let y = parts[0];
    let m = parts[1];
    const d = parts[2];
    if (pd > 1 && d >= pd) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return y + '-' + String(m).padStart(2, '0');
  }

  function txCashEffect(tx) {
    const n = Number(tx.nominal) || 0;
    if (isPiutangK(tx.kategori)) return tx.tipe === 'Pengeluaran' ? -n : n;
    if (isUtangK(tx.kategori)) return tx.tipe === 'Pemasukan' ? 0 : -n;
    return tx.tipe === 'Pemasukan' ? n : -n;
  }

  function walletBalances() {
    const bal = {};
    (DB.wallets || []).forEach((w) => { bal[w.id] = Number(w.openingBalance) || 0; });
    const def = DB.wallets && DB.wallets[0] ? DB.wallets[0].id : null;
    DB.transactions.forEach((tx) => {
      const id = (tx.walletId && bal[tx.walletId] !== undefined) ? tx.walletId : def;
      if (id) bal[id] += txCashEffect(tx);
    });
    (DB.transfers || []).forEach((x) => {
      const n = Number(x.nominal) || 0;
      const f = Number(x.fee) || 0;
      if (x.fromWallet && bal[x.fromWallet] !== undefined) bal[x.fromWallet] -= (n + f);
      if (x.toWallet && bal[x.toWallet] !== undefined) bal[x.toWallet] += n;
    });
    return bal;
  }

  const walletName = (id) => {
    const w = (DB.wallets || []).find((x) => x.id === id);
    return w ? w.name : '-';
  };
  const walletKindLabel = (kind) => kind === 'cash' ? 'Tunai' : kind === 'ewallet' ? 'E-wallet' : 'Bank';
  const walletOptions = (selectedId) => (DB.wallets || [])
    .map((w) => `<option value="${escapeHtmlJS(w.id)}" ${w.id === selectedId ? 'selected' : ''}>${escapeHtmlJS(w.name)} (${walletKindLabel(w.kind)})</option>`)
    .join('');

  function fillWalletSelect(id, selectedId) {
    const el = document.getElementById(id);
    if (!el) return;
    const ws = DB.wallets || [];
    const targetId = selectedId || (ws[0] ? ws[0].id : '');
    renderSelectOptions(
      el,
      ws.map((w) => ({ value: w.id, label: `${w.name} (${walletKindLabel(w.kind)})` })),
      null,
      targetId
    );
  }

  function buildWalletRowHtml(w, bal) {
    const isCash = w.kind === 'cash';
    const isEwallet = w.kind === 'ewallet';
    const isBank = !isCash && !isEwallet;
    const isPrimary = isBank && (DB.primaryBankWalletId || '') === w.id;
    const iconBoxClass = isCash
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
      : isEwallet
        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
        : 'bg-brand/10 text-brand dark:text-brand-ink';
    const safeName = escapeHtmlJS(w.name);
    const idAttr = escapeAttrJS(w.id);
    return `
      <div class="px-3.5 py-2.5 sm:px-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors flex items-center justify-between gap-2">
        <button type="button" data-wallet-detail="${idAttr}" ${mkActionAttrs('openWalletDetailModal', [w.id])}
                aria-label="Lihat rincian dompet ${safeName}"
                class="flex-1 min-w-0 min-h-11 py-1 px-1 rounded-xl flex items-center justify-between gap-3 text-left">
          <span class="flex items-center gap-3 min-w-0">
            <span class="w-10 h-10 rounded-2xl ${iconBoxClass} flex items-center justify-center shrink-0">
              <i class="ph ph-${isCash ? 'money' : isEwallet ? 'device-mobile' : 'bank'} text-xl" aria-hidden="true"></i>
            </span>
            <span class="min-w-0">
              <span class="block text-slate-800 dark:text-white text-sm font-bold truncate">${safeName}</span>
              <span class="mt-0.5 flex items-center gap-1.5 min-w-0">
                <span class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${walletKindLabel(w.kind)}</span>
                ${isPrimary ? '<span class="shrink-0 px-1.5 py-px rounded-full bg-brand/10 text-brand dark:text-brand-ink text-[10px] font-black uppercase tracking-wide">Dompet Utama</span>' : ''}
              </span>
            </span>
          </span>
          <span class="text-sm sm:text-base font-extrabold tabular-nums shrink-0 ${bal < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'}">${formatRupiah(bal)}</span>
        </button>
        ${isBank && !isPrimary ? `<button type="button" ${mkActionAttrs('setPrimaryBankWallet', [w.id])} aria-label="Jadikan ${safeName} dompet utama" title="Jadikan dompet utama (acuan Cashflow Runway)"
          class="min-h-9 px-2.5 rounded-full border border-brand/30 bg-brand/5 text-brand dark:text-brand-ink text-[11px] font-bold whitespace-nowrap shrink-0 transition-colors hover:bg-brand/10">
          <i class="ph ph-star" aria-hidden="true"></i> Jadikan Utama
        </button>` : ''}
        <button type="button" ${mkActionAttrs('editWallet', [w.id])} aria-label="Edit dompet ${safeName}" title="Edit saldo"
          class="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-brand dark:hover:text-brand-ink flex items-center justify-center shrink-0 transition-colors">
          <i class="ph ph-pencil-simple text-base" aria-hidden="true"></i>
        </button>
      </div>`;
  }

  async function setPrimaryBankWallet(id) {
    const w = (DB.wallets || []).find((x) => x.id === id);
    if (!w || String(w.kind || '') !== 'bank') return;
    if ((DB.primaryBankWalletId || '') === id) return;
    try {
      await callServer('api_savePrimaryBankWallet', id);
      DB.primaryBankWalletId = id;
      renderWallets();
      if (typeof root.renderCashflowRunwayStrip === 'function') root.renderCashflowRunwayStrip();
      Swal.fire({
        icon: 'success', title: 'Dompet utama diatur',
        text: w.name + ' kini menjadi acuan Cashflow Runway.',
        timer: 1800, showConfirmButton: false, customClass: { popup: getSwalClass() }
      });
    } catch (e) {
      showActionError(e);
    }
  }

  // Menghapus pengaturan dompet utama bila dompet yang dihapus adalah dompet
  // utama, sehingga runway kembali memakai total semua dompet.
  async function clearPrimaryBankWalletSetting() {
    try { await callServer('api_savePrimaryBankWallet', ''); } catch (_) { /* tetap bersihkan lokal */ }
    DB.primaryBankWalletId = '';
    renderWallets();
    if (typeof root.renderCashflowRunwayStrip === 'function') root.renderCashflowRunwayStrip();
  }

  function buildTransferRowHtml(x) {
    const label = { tarik_tunai: 'Tarik Tunai', transfer: 'Transfer', investasi: 'Top-up Aset' };
    return `
      <div class="px-5 py-3.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
        <div class="min-w-0">
          <p class="font-bold text-slate-700 dark:text-slate-200 truncate">${label[x.kind] || 'Transfer'} · ${escapeHtmlJS(walletName(x.fromWallet))}${x.toWallet ? ' → ' + escapeHtmlJS(walletName(x.toWallet)) : ' → Aset'}</p>
          <p class="text-slate-500 dark:text-slate-400 mt-0.5">${escapeHtmlJS(String(x.tanggal).slice(0, 10))}${x.fee ? ' · biaya ' + formatRupiah(x.fee) : ''}${x.keterangan ? ' · ' + escapeHtmlJS(x.keterangan) : ''}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="font-black text-slate-800 dark:text-slate-200 tabular-nums">${formatRupiah(x.nominal)}</span>
          <button type="button" ${mkActionAttrs('deleteTransfer', [x.id])} aria-label="Hapus transfer" title="Hapus transfer" class="min-w-10 min-h-10 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center hover:bg-rose-100 transition-colors">
            <i class="ph ph-trash text-sm" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
  }

  function renderWallets() {
    const panel = document.getElementById('wallet-panel');
    if (!panel) return;
    const wb = walletBalances();
    renderHtml(panel, (DB.wallets || []).map((w) => buildWalletRowHtml(w, wb[w.id] || 0)).join(''));

    const box = document.getElementById('wallet-transfers');
    if (!box) return;
    const list = [...(DB.transfers || [])]
      .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || String(b.id).localeCompare(String(a.id)))
      .slice(0, 10);
    if (list.length === 0) {
      renderHtml(box, `<div class="p-8 text-center text-xs text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('wallet.empty_transfers'))}</div>`);
      return;
    }
    renderHtml(box, list.map(buildTransferRowHtml).join(''));
  }

  async function addWallet() {
    const res = await Swal.fire({
      title: 'Tambah Dompet',
      html: `
        <div class="text-left space-y-3">
          <div>
            <label for="wl-new-name" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Nama dompet</label>
            <input id="wl-new-name" class="swal2-input" style="margin-top:0.35rem" maxlength="80" placeholder="Contoh: SeaBank">
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="wl-new-kind" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Jenis dompet</label>
              <select id="wl-new-kind" class="swal2-input" style="margin-top:0.35rem">
                <option value="bank">Bank</option>
                <option value="ewallet">E-wallet</option>
                <option value="cash">Tunai</option>
              </select>
            </div>
            <div>
              <label for="wl-new-balance" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Saldo awal (Rp)</label>
              <input id="wl-new-balance" type="text" inputmode="numeric" class="swal2-input tabular-nums" style="margin-top:0.35rem" value="0">
            </div>
          </div>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      didOpen: () => bindNominalInputs(['wl-new-balance']),
      preConfirm: () => {
        const name = document.getElementById('wl-new-name').value.trim();
        const rawBal = document.getElementById('wl-new-balance').value;
        const openingBalance = String(rawBal || '').trim() === '' ? 0 : parseFormattedNominal(rawBal);
        if (!name) { Swal.showValidationMessage('Isi nama dompet'); return false; }
        if (!Number.isFinite(openingBalance) || openingBalance < 0) {
          Swal.showValidationMessage('Saldo awal harus berupa angka nol atau lebih');
          return false;
        }
        return { name, kind: document.getElementById('wl-new-kind').value, openingBalance };
      }
    });
    if (!res.isConfirmed || !res.value) return;
    try {
      await refreshFromServer(await callServer('api_addWallet', res.value));
      Swal.fire({ icon: 'success', title: 'Dompet ditambahkan', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: String(e.message || e), customClass: { popup: getSwalClass() } });
    }
  }

  async function deleteWalletUI(id, name) {
    const conf = await Swal.fire({
      icon: 'warning',
      title: 'Hapus dompet ' + escapeHtmlJS(name) + '?',
      text: 'Transaksi lama pada dompet ini akan dipindahkan ke dompet utama lainnya.',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: t('btn.ya_hapus'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!conf.isConfirmed) return;
    try {
      await refreshFromServer(await callServer('api_deleteWallet', id));
      if ((DB.primaryBankWalletId || '') === id) await clearPrimaryBankWalletSetting();
      Swal.fire({ icon: 'success', title: 'Dompet dihapus', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      showActionError(e);
    }
  }

  async function editWallet(id) {
    const w = (DB.wallets || []).find((x) => x.id === id);
    if (!w) return;
    const bal = walletBalances()[id] || 0;
    const res = await Swal.fire({
      title: 'Edit ' + escapeHtmlJS(w.name),
      html: `
        <div class="text-left space-y-3">
          <div>
            <label for="wl-name" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Nama dompet</label>
            <input id="wl-name" class="swal2-input" style="margin-top:0.35rem" value="${escapeHtmlJS(w.name)}" placeholder="Nama dompet">
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="wl-kind" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Jenis dompet</label>
              <select id="wl-kind" class="swal2-input" style="margin-top:0.35rem">
                <option value="bank" ${w.kind === 'bank' ? 'selected' : ''}>Bank</option>
                <option value="ewallet" ${w.kind === 'ewallet' ? 'selected' : ''}>E-wallet</option>
                <option value="cash" ${w.kind === 'cash' ? 'selected' : ''}>Tunai</option>
              </select>
            </div>
            <div>
              <label for="wl-bal" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Saldo sekarang (Rp)</label>
              <input id="wl-bal" type="text" inputmode="numeric" class="swal2-input tabular-nums" style="margin-top:0.35rem" value="${escapeHtmlJS(formatNominalInputValue(Math.round(Math.abs(bal))) || '0')}" placeholder="Saldo sekarang (Rp)">
            </div>
          </div>
          <p class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">Mengubah saldo akan menyesuaikan saldo awal dompet. Riwayat transaksi tidak berubah.</p>
        </div>`,
      showCancelButton: true,
      showDenyButton: (DB.wallets || []).length > 1,
      denyButtonText: 'Hapus Dompet',
      denyButtonColor: '#e11d48',
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      didOpen: () => bindNominalInputs(['wl-bal']),
      preConfirm: () => {
        const name = document.getElementById('wl-name').value.trim();
        const kind = document.getElementById('wl-kind').value;
        const b = parseFormattedNominal(document.getElementById('wl-bal').value);
        if (!name) { Swal.showValidationMessage('Isi nama dompet'); return false; }
        if (!isFinite(b)) { Swal.showValidationMessage('Isi saldo dengan angka'); return false; }
        return { name, kind, balance: b };
      }
    });
    if (res.isDenied) { await deleteWalletUI(id, w.name); return; }
    if (!res.isConfirmed || !res.value) return;
    const newOpening = (Number(w.openingBalance) || 0) + (res.value.balance - bal);
    try {
      await refreshFromServer(await callServer('api_updateWallet', id, { name: res.value.name, kind: res.value.kind, openingBalance: newOpening }));
      if ((DB.primaryBankWalletId || '') === id && res.value.kind !== 'bank') {
        await clearPrimaryBankWalletSetting();
        Swal.fire({
          icon: 'info', title: 'Dompet utama dihapus',
          text: 'Jenis dompet diubah dari bank, jadi Cashflow Runway kembali memakai total semua dompet.',
          timer: 2400, showConfirmButton: false, customClass: { popup: getSwalClass() }
        });
      }
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: String(e.message || e), customClass: { popup: getSwalClass() } });
    }
  }

  async function openTransferModal(kind) {
    const ws = DB.wallets || [];
    if (ws.length < 2) {
      Swal.fire({ icon: 'info', title: 'Butuh 2 dompet', text: 'Tambahkan dompet lain terlebih dahulu.', customClass: { popup: getSwalClass() } });
      return;
    }
    const fromWallet = kind === 'tarik_tunai' ? (ws.find((w) => w.kind === 'bank') || ws[0]) : ws[0];
    const toWallet = kind === 'tarik_tunai'
      ? (ws.find((w) => w.kind === 'cash' && w.id !== fromWallet.id) || ws.find((w) => w.id !== fromWallet.id))
      : ws.find((w) => w.id !== fromWallet.id);

    const res = await Swal.fire({
      title: kind === 'tarik_tunai' ? 'Tarik Tunai / Transfer Antar Dompet' : 'Transfer Antar Dompet',
      html: `
        <div class="text-left space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="tf-from" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Dari dompet</label>
              <select id="tf-from" class="swal2-input" style="margin-top:0.35rem">${walletOptions(fromWallet.id)}</select>
            </div>
            <div>
              <label for="tf-to" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Ke dompet</label>
              <select id="tf-to" class="swal2-input" style="margin-top:0.35rem">${walletOptions(toWallet.id)}</select>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="tf-nom" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Nominal (Rp)</label>
              <input id="tf-nom" type="text" inputmode="numeric" class="swal2-input tabular-nums" style="margin-top:0.35rem" placeholder="Contoh: 500.000">
            </div>
            <div>
              <label for="tf-fee" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Biaya admin (Rp, opsional)</label>
              <input id="tf-fee" type="text" inputmode="numeric" class="swal2-input tabular-nums" style="margin-top:0.35rem" placeholder="0">
            </div>
          </div>
          <div>
            <label for="tf-date" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Tanggal Transfer</label>
            <input id="tf-date" type="date" class="swal2-input" style="margin-top:0.35rem" value="${localToday()}">
          </div>
          <div>
            <label for="tf-ket" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Catatan (opsional)</label>
            <input id="tf-ket" type="text" class="swal2-input" style="margin-top:0.35rem" placeholder="Mis. Tarik tunai ATM">
          </div>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      didOpen: () => bindNominalInputs(['tf-nom', 'tf-fee']),
      preConfirm: () => {
        const from = document.getElementById('tf-from').value;
        const to = document.getElementById('tf-to').value;
        const nominal = parseFormattedNominal(document.getElementById('tf-nom').value);
        const tanggal = (document.getElementById('tf-date').value || '').slice(0, 10) || localToday();
        const rawFee = parseFormattedNominal(document.getElementById('tf-fee').value);
        if (from === to) { Swal.showValidationMessage('Dompet asal dan tujuan harus berbeda'); return false; }
        if (!Number.isFinite(nominal) || nominal <= 0) { Swal.showValidationMessage('Isi nominal transfer di atas 0'); return false; }
        return {
          fromWallet: from, toWallet: to, nominal, tanggal,
          fee: Number.isFinite(rawFee) && rawFee > 0 ? rawFee : 0,
          keterangan: document.getElementById('tf-ket').value.trim()
        };
      }
    });
    if (!res.isConfirmed || !res.value) return;
    const f = ws.find((w) => w.id === res.value.fromWallet);
    const t2 = ws.find((w) => w.id === res.value.toWallet);
    const k = (f && t2 && f.kind === 'bank' && t2.kind === 'cash') ? 'tarik_tunai' : 'transfer';
    try {
      await refreshFromServer(await callServer('api_addTransfer', { ...res.value, kind: k, tanggal: res.value.tanggal || localToday() }));
      Swal.fire({ icon: 'success', title: 'Tercatat', timer: 1000, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: String(e.message || e), customClass: { popup: getSwalClass() } });
    }
  }

  function deleteTransfer(id) {
    Swal.fire({
      title: 'Hapus transfer ini?', text: 'Saldo dompet akan kembali seperti sebelum transfer.', icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus', cancelButtonText: 'Batal', customClass: { popup: getSwalClass() }
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        await refreshFromServer(await callServer('api_deleteTransfer', id));
      } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal', text: String(e.message || e), customClass: { popup: getSwalClass() } });
      }
    });
  }

  Object.assign(root, {
    localToday,
    cycleOfDate,
    txCashEffect,
    walletBalances,
    walletName,
    walletKindLabel,
    walletOptions,
    fillWalletSelect,
    renderWallets,
    addWallet,
    editWallet,
    setPrimaryBankWallet,
    deleteWalletUI,
    openTransferModal,
    deleteTransfer
  });
})(typeof window !== 'undefined' ? window : globalThis);
