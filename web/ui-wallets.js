/* global DB, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, renderSelectOptions, getSwalClass, showActionError, t */
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
    const iconBoxClass = isCash
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
      : isEwallet
        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
        : 'bg-brand/10 text-brand dark:text-brand-ink';
    return `
      <div class="px-4 py-3 sm:px-5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl ${iconBoxClass} flex items-center justify-center shrink-0">
            <i class="ph ph-${isCash ? 'money' : isEwallet ? 'device-mobile' : 'bank'} text-xl" aria-hidden="true"></i>
          </div>
          <div class="min-w-0">
            <p class="text-slate-800 dark:text-white text-sm font-bold truncate">${escapeHtmlJS(w.name)}</p>
            <p class="text-[11px] text-slate-400 dark:text-slate-500 truncate">${walletKindLabel(w.kind)}</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5 shrink-0">
          <span class="text-sm sm:text-base font-extrabold tabular-nums ${bal < 0 ? 'text-rose-600' : 'text-slate-800 dark:text-white'}">${formatRupiah(bal)}</span>
          <button type="button" onclick="editWallet('${escapeAttrJS(w.id)}')" aria-label="Edit dompet ${escapeHtmlJS(w.name)}" title="Edit saldo"
            class="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-brand dark:hover:text-brand-ink flex items-center justify-center shrink-0 transition-colors">
            <i class="ph ph-pencil-simple text-base" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
  }

  function buildTransferRowHtml(x) {
    const label = { tarik_tunai: 'Tarik Tunai', transfer: 'Transfer', investasi: 'Top-up Aset' };
    return `
      <div class="px-5 py-3.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
        <div class="min-w-0">
          <p class="font-bold text-slate-700 dark:text-slate-200 truncate">${label[x.kind] || 'Transfer'} · ${escapeHtmlJS(walletName(x.fromWallet))}${x.toWallet ? ' → ' + escapeHtmlJS(walletName(x.toWallet)) : ' → Aset'}</p>
          <p class="text-slate-400 mt-0.5">${escapeHtmlJS(String(x.tanggal).slice(0, 10))}${x.fee ? ' · biaya ' + formatRupiah(x.fee) : ''}${x.keterangan ? ' · ' + escapeHtmlJS(x.keterangan) : ''}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="font-black text-slate-700 dark:text-slate-200">${formatRupiah(x.nominal)}</span>
          <button type="button" onclick="deleteTransfer('${escapeAttrJS(x.id)}')" aria-label="Hapus transfer" title="Hapus transfer" class="min-w-10 min-h-10 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-500 flex items-center justify-center hover:bg-rose-100 transition-colors">
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
      renderHtml(box, `<div class="p-8 text-center text-xs text-slate-400">${escapeHtmlJS(t('wallet.empty_transfers'))}</div>`);
      return;
    }
    renderHtml(box, list.map(buildTransferRowHtml).join(''));
  }

  async function addWallet() {
    const res = await Swal.fire({
      title: 'Tambah Dompet',
      html: `
        <label for="wl-new-name" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Nama dompet</label>
        <input id="wl-new-name" class="swal2-input" maxlength="80" placeholder="Contoh: SeaBank">
        <label for="wl-new-kind" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Jenis</label>
        <select id="wl-new-kind" class="swal2-input">
          <option value="bank">Bank</option>
          <option value="ewallet">E-wallet</option>
          <option value="cash">Tunai</option>
        </select>
        <label for="wl-new-balance" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Saldo awal (Rp)</label>
        <input id="wl-new-balance" type="number" min="0" step="1" class="swal2-input" value="0">`,
      showCancelButton: true,
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const name = document.getElementById('wl-new-name').value.trim();
        const openingBalance = Number(document.getElementById('wl-new-balance').value);
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
        <label for="wl-name" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:4px 4px 0">Nama dompet</label>
        <input id="wl-name" class="swal2-input" value="${escapeHtmlJS(w.name)}" placeholder="Nama dompet">
        <label for="wl-kind" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Jenis dompet</label>
        <select id="wl-kind" class="swal2-input">
          <option value="bank" ${w.kind === 'bank' ? 'selected' : ''}>Bank</option>
          <option value="ewallet" ${w.kind === 'ewallet' ? 'selected' : ''}>E-wallet</option>
          <option value="cash" ${w.kind === 'cash' ? 'selected' : ''}>Tunai</option>
        </select>
        <label for="wl-bal" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Saldo sekarang (Rp)</label>
        <input id="wl-bal" type="number" class="swal2-input" value="${Math.round(bal)}" placeholder="Saldo sekarang (Rp)">
        <p style="font-size:12px;color:#64748b;margin-top:10px">Mengubah saldo akan menyesuaikan saldo awal dompet. Riwayat transaksi tidak berubah.</p>`,
      showCancelButton: true,
      showDenyButton: (DB.wallets || []).length > 1,
      denyButtonText: 'Hapus Dompet',
      denyButtonColor: '#e11d48',
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const name = document.getElementById('wl-name').value.trim();
        const kind = document.getElementById('wl-kind').value;
        const b = parseFloat(document.getElementById('wl-bal').value);
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
        <label style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Dari</label>
        <select id="tf-from" class="swal2-input">${walletOptions(fromWallet.id)}</select>
        <label style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Ke</label>
        <select id="tf-to" class="swal2-input">${walletOptions(toWallet.id)}</select>
        <label for="tf-date" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Tanggal Transfer</label>
        <input id="tf-date" type="date" class="swal2-input" value="${localToday()}">
        <input id="tf-nom" type="number" class="swal2-input" placeholder="Nominal (Rp)">
        <input id="tf-fee" type="number" class="swal2-input" placeholder="Biaya admin (Rp) — opsional">
        <input id="tf-ket" type="text" class="swal2-input" placeholder="Catatan — opsional">`,
      showCancelButton: true,
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const from = document.getElementById('tf-from').value;
        const to = document.getElementById('tf-to').value;
        const nominal = parseFloat(document.getElementById('tf-nom').value);
        const tanggal = (document.getElementById('tf-date').value || '').slice(0, 10) || localToday();
        if (from === to) { Swal.showValidationMessage('Dompet asal dan tujuan harus berbeda'); return false; }
        if (!nominal || nominal <= 0) { Swal.showValidationMessage('Isi nominal'); return false; }
        return {
          fromWallet: from, toWallet: to, nominal, tanggal,
          fee: parseFloat(document.getElementById('tf-fee').value) || 0,
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
      showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Ya, Hapus', customClass: { popup: getSwalClass() }
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
    deleteWalletUI,
    openTransferModal,
    deleteTransfer
  });
})(typeof window !== 'undefined' ? window : globalThis);
