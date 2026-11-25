/* global DB, FinanceAnalysis, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, parseFormattedNominal, bindNominalInputs, getSwalClass, showActionError, localToday, walletOptions, walletKindLabel, switchView, retryReportLoad, renderDebtLists, t */
/* ============================================================
   FEATURES — DEBT DETAIL, ASSET FORM, WALLET DETAIL & AUTO BUDGET
   ============================================================ */
(function (root) {
  'use strict';

  function debtKey(group, name) {
    return String(group) + '::' + String(name);
  }

  async function openDebtDetailModal(group, name) {
    const key = debtKey(group, name);
    const prefix = group + ' - ' + name;
    const dueMap = (DB && DB.debtDueDates) || {};
    const currentDue = dueMap[key] || '';
    const history = (DB.transactions || []).filter((tx) => tx.kategori === prefix)
      .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));

    const rowsHtml = history.length
      ? history.slice(0, 15).map((tx) => `
          <div class="flex items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-slate-800 text-xs">
            <div class="min-w-0 text-left">
              <p class="font-bold text-slate-700 dark:text-slate-200 tabular-nums">${escapeHtmlJS(tx.tanggal)} · ${escapeHtmlJS(tx.tipe)}</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtmlJS(tx.keterangan || '-')}</p>
            </div>
            <span class="font-black shrink-0 tabular-nums ${tx.tipe === 'Pemasukan' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${formatRupiah(tx.nominal).replace(',00', '')}</span>
          </div>`).join('')
      : '<p class="text-xs text-slate-500 dark:text-slate-400 py-3">Belum ada riwayat cicilan untuk entitas ini.</p>';

    const res = await Swal.fire({
      title: escapeHtmlJS(name),
      html: `
        <div class="text-left space-y-3">
          <div>
            <label for="debt-due-input" class="block text-xs font-bold text-slate-500 mb-1">Tanggal Jatuh Tempo (opsional)</label>
            <input id="debt-due-input" type="date" class="swal2-input" style="margin:0;width:100%" value="${escapeHtmlJS(currentDue)}">
          </div>
          <div>
            <p class="text-xs font-bold text-slate-500 mb-1">Riwayat Transaksi (${history.length})</p>
            <div class="max-h-52 overflow-y-auto">${rowsHtml}</div>
          </div>
        </div>`,
      showCancelButton: true,
      showDenyButton: Boolean(currentDue),
      denyButtonText: 'Hapus Jatuh Tempo',
      confirmButtonText: 'Simpan Jatuh Tempo',
      cancelButtonText: t('btn.tutup'),
      customClass: { popup: getSwalClass() },
      preConfirm: () => (document.getElementById('debt-due-input').value || '').slice(0, 10)
    });
    if (!res.isConfirmed && !res.isDenied) return;
    const nextMap = Object.assign({}, dueMap);
    if (res.isDenied || !res.value) delete nextMap[key];
    else nextMap[key] = res.value;
    try {
      const data = await callServer('api_saveDebtDueDates', nextMap);
      DB.debtDueDates = (data && data.debtDueDates) || nextMap;
      if (typeof renderDebtLists === 'function') renderDebtLists();
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  function bindAddAssetFieldToggles() {
    const typeSelect = document.getElementById('asset-type');
    const symbolInput = document.getElementById('asset-symbol');
    const qtyInput = document.getElementById('asset-quantity');
    const buyInput = document.getElementById('asset-buyprice');
    const valInput = document.getElementById('asset-value');
    const symbolWrap = document.getElementById('asset-symbol-wrap');
    const qtyWrap = document.getElementById('asset-quantity-wrap');
    const buyWrap = document.getElementById('asset-buyprice-wrap');
    const valWrap = document.getElementById('asset-value-wrap');
    const symbolLabel = document.getElementById('asset-symbol-label');
    const qtyLabel = document.getElementById('asset-quantity-label');
    const valLabel = document.getElementById('asset-value-label');
    function toggleFields() {
      const v = typeSelect.value;
      const isCrypto = v === 'Crypto';
      const isEmas = v === 'Emas';
      const isUsd = v === 'USD';
      if (symbolWrap) symbolWrap.style.display = (isCrypto || v === 'Saham') ? 'block' : 'none';
      if (symbolLabel) symbolLabel.textContent = isCrypto ? 'Simbol Crypto (Ticker)' : 'Kode Emiten / Ticker';
      symbolInput.placeholder = isCrypto ? 'Contoh: BTC, ETH, SOL, PAXG' : 'Contoh: BBCA, BBRI, TLKM';
      if (qtyWrap) qtyWrap.style.display = (isCrypto || isEmas || isUsd) ? 'block' : 'none';
      if (qtyLabel) qtyLabel.textContent = isEmas ? 'Berat Emas (gram)' : isUsd ? 'Nominal Valas (USD)' : 'Jumlah Coin / Unit';
      qtyInput.placeholder = isEmas ? 'Contoh: 5' : isUsd ? 'Contoh: 500' : 'Contoh: 0.05';
      if (buyWrap) buyWrap.style.display = isCrypto ? 'block' : 'none';
      if (valWrap) valWrap.style.display = isCrypto ? 'none' : 'block';
      if (valLabel) valLabel.textContent = isEmas ? 'Total Nilai Beli / Saat Ini (Rp)' : isUsd ? 'Total Nilai Setara (Rp)' : 'Total Nilai Aset (Rp)';
      valInput.placeholder = isEmas ? 'Contoh: 7.500.000' : isUsd ? 'Contoh: 8.000.000' : 'Contoh: 10.000.000';
      if (!buyInput.value && buyWrap) buyInput.placeholder = 'Contoh: 1.500.000.000';
    }
    typeSelect.addEventListener('change', toggleFields);
    toggleFields();
  }

  function validateAddAssetInput() {
    const type = document.getElementById('asset-type').value;
    const name = document.getElementById('asset-name').value.trim();
    if (!name) { Swal.showValidationMessage('Isi nama aset'); return false; }
    const walletId = document.getElementById('asset-wallet').value;
    if (type === 'Crypto') {
      const symbol = document.getElementById('asset-symbol').value.trim().toUpperCase();
      const quantity = parseFloat(document.getElementById('asset-quantity').value);
      const buyPrice = parseFormattedNominal(document.getElementById('asset-buyprice').value) || 0;
      if (!symbol) { Swal.showValidationMessage('Isi symbol crypto'); return false; }
      if (!quantity || quantity <= 0) { Swal.showValidationMessage('Isi jumlah coin'); return false; }
      if (buyPrice < 0 || (walletId && buyPrice <= 0)) {
        Swal.showValidationMessage('Isi harga beli di atas nol untuk mencatat sumber dana');
        return false;
      }
      return { name, type, symbol, quantity, buyPrice, value: 0, walletId, tanggal: localToday() };
    }
    const value = parseFormattedNominal(document.getElementById('asset-value').value);
    if (!value || value <= 0) { Swal.showValidationMessage('Isi total nilai Rupiah aset'); return false; }
    const quantity = (type === 'Emas' || type === 'USD') ? (parseFloat(document.getElementById('asset-quantity').value) || 0) : 0;
    if ((type === 'Emas' || type === 'USD') && quantity <= 0) {
      Swal.showValidationMessage(type === 'Emas' ? 'Isi berat emas (gram)' : 'Isi jumlah nominal USD');
      return false;
    }
    const symbol = type === 'Emas' ? 'XAU' : type === 'USD' ? 'USD' : (document.getElementById('asset-symbol').value.trim().toUpperCase() || '');
    const buyPrice = quantity > 0 ? Number((value / quantity).toFixed(2)) : 0;
    return { name, type, symbol, quantity, buyPrice, value, walletId, tanggal: localToday() };
  }

  function addManualAssetUI() {
    Swal.fire({
      title: 'Tambah Aset & Investasi',
      html: `
        <div class="text-left space-y-3">
          <div>
            <label for="asset-type" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Jenis Aset</label>
            <select id="asset-type" class="swal2-input" style="margin-top:0.35rem">
              <option value="Crypto">Crypto (CoinGecko)</option>
              <option value="Emas">Emas (gram &middot; Auto Harga)</option>
              <option value="USD">Valas USD (Auto Kurs IDR)</option>
              <option value="Saham">Saham / Reksa Dana</option>
              <option value="Cash">Cash / Deposito / Tabungan</option>
              <option value="Other">Aset Lainnya</option>
            </select>
          </div>
          <div>
            <label for="asset-name" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Nama Aset</label>
            <input id="asset-name" class="swal2-input" style="margin-top:0.35rem" placeholder="Contoh: Bitcoin / Antam 5g / Tabungan USD">
          </div>
          <div id="asset-symbol-wrap" style="display:none">
            <label id="asset-symbol-label" for="asset-symbol" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Simbol / Kode</label>
            <input id="asset-symbol" class="swal2-input" style="margin-top:0.35rem" placeholder="Contoh: BTC, ETH, BBCA">
          </div>
          <div id="asset-quantity-wrap" style="display:none">
            <label id="asset-quantity-label" for="asset-quantity" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Jumlah Unit</label>
            <input id="asset-quantity" type="number" step="0.00000001" class="swal2-input tabular-nums" style="margin-top:0.35rem" placeholder="Jumlah unit">
          </div>
          <div id="asset-buyprice-wrap" style="display:none">
            <label for="asset-buyprice" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Harga Beli per Unit (Rp)</label>
            <input id="asset-buyprice" type="text" inputmode="numeric" class="swal2-input tabular-nums" style="margin-top:0.35rem" placeholder="Harga beli per unit (Rp)">
          </div>
          <div id="asset-value-wrap">
            <label id="asset-value-label" for="asset-value" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Total Nilai Aset (Rp)</label>
            <input id="asset-value" type="text" inputmode="numeric" aria-label="Total Nilai Rupiah" class="swal2-input tabular-nums" style="margin-top:0.35rem" placeholder="Total Nilai (Rp)">
          </div>
          <div>
            <label for="asset-wallet" class="block text-xs font-semibold text-slate-600 dark:text-slate-300">Sumber Dana (opsional)</label>
            <select id="asset-wallet" class="swal2-input" style="margin-top:0.35rem"><option value="">Catat sebagai aset manual</option>${walletOptions('')}</select>
          </div>
          <p class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">Jika dompet dipilih, pembelian dicatat otomatis ke pengeluaran kategori Investasi.</p>
        </div>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      didOpen: () => { bindAddAssetFieldToggles(); bindNominalInputs(['asset-buyprice', 'asset-value']); },
      preConfirm: validateAddAssetInput
    }).then(async (res) => {
      if (!res.isConfirmed || !res.value) return;
      try {
        await refreshFromServer(await callServer('api_addAssetV2', res.value));
        if (['Crypto', 'Emas', 'USD'].includes(res.value.type)) {
          try { await refreshFromServer(await callServer('api_refreshPrices')); } catch (_) { /* ignore */ }
        }
      } catch (e) {
        Swal.fire({ icon: 'error', title: 'Gagal', text: String(e.message || e), customClass: { popup: getSwalClass() } });
      }
    });
  }

  function computeWalletDetailStats(w, walletId) {
    const defaultId = (DB.wallets[0] && DB.wallets[0].id) || '';
    const opening = Number(w.openingBalance) || 0;
    let totalIn = 0;
    let totalOut = 0;
    let netTransfers = 0;
    const walletTxs = (DB.transactions || []).filter((tx) => String(tx.walletId || defaultId) === String(walletId));

    walletTxs.forEach((tx) => {
      const cat = String(tx.kategori || '');
      const n = Number(tx.nominal) || 0;
      const isPiutang = cat.startsWith('Piutang');
      const isUtang = !isPiutang && cat.startsWith('Utang');
      if (isPiutang) { if (tx.tipe === 'Pengeluaran') totalOut += n; else totalIn += n; }
      else if (isUtang) { if (tx.tipe === 'Pengeluaran') totalOut += n; }
      else if (tx.tipe === 'Pemasukan') totalIn += n;
      else totalOut += n;
    });
    (DB.transfers || []).forEach((x) => {
      const n = Number(x.nominal) || 0;
      const f = Number(x.fee) || 0;
      if (String(x.fromWallet) === String(walletId)) netTransfers -= (n + f);
      if (String(x.toWallet) === String(walletId)) netTransfers += n;
    });
    return { opening, totalIn, totalOut, netTransfers, currentBal: opening + totalIn - totalOut + netTransfers, walletTxs };
  }

  async function openWalletDetailModal(walletId) {
    const w = (DB.wallets || []).find((x) => String(x.id) === String(walletId));
    if (!w) return;
    const st = computeWalletDetailStats(w, walletId);
    const recent = [...st.walletTxs].sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal))).slice(0, 10);
    const recentHtml = recent.length
      ? recent.map((tx) => `
          <div class="flex items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-slate-800 text-xs">
            <div class="min-w-0 text-left">
              <p class="font-bold text-slate-700 dark:text-slate-200 truncate">${escapeHtmlJS(tx.kategori)}</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate tabular-nums">${escapeHtmlJS(tx.tanggal)} · ${escapeHtmlJS(tx.keterangan || '-')}</p>
            </div>
            <span class="font-black shrink-0 tabular-nums ${tx.tipe === 'Pemasukan' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${tx.tipe === 'Pemasukan' ? '+' : '-'}${formatRupiah(tx.nominal).replace(',00', '')}</span>
          </div>`).join('')
      : '<p class="text-xs text-slate-500 dark:text-slate-400 py-3 text-center">Belum ada transaksi tercatat di dompet ini.</p>';

    const res = await Swal.fire({
      title: escapeHtmlJS(w.name) + ' (' + escapeHtmlJS(typeof walletKindLabel === 'function' ? walletKindLabel(w.kind) : w.kind) + ')',
      html: `
        <div class="text-left space-y-3">
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70"><p class="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold">Saldo Awal</p><p class="font-bold tabular-nums text-slate-800 dark:text-slate-200">${formatRupiah(st.opening).replace(',00', '')}</p></div>
            <div class="p-2.5 rounded-xl bg-brand/10"><p class="text-[11px] text-brand dark:text-brand-ink uppercase font-bold">Saldo Saat Ini</p><p class="font-black tabular-nums text-brand dark:text-brand-ink">${formatRupiah(st.currentBal).replace(',00', '')}</p></div>
            <div class="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10"><p class="text-[11px] text-emerald-700 dark:text-emerald-400 uppercase font-bold">Total Masuk</p><p class="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">+${formatRupiah(st.totalIn).replace(',00', '')}</p></div>
            <div class="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10"><p class="text-[11px] text-rose-600 dark:text-rose-400 uppercase font-bold">Total Keluar</p><p class="font-bold tabular-nums text-rose-600 dark:text-rose-400">-${formatRupiah(st.totalOut).replace(',00', '')}</p></div>
          </div>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">Mutasi Transfer Netto: <strong class="tabular-nums text-slate-700 dark:text-slate-200">${st.netTransfers >= 0 ? '+' : ''}${formatRupiah(st.netTransfers).replace(',00', '')}</strong></p>
          <div><p class="text-xs font-bold text-slate-500 mb-1">10 Transaksi Terakhir</p><div class="max-h-52 overflow-y-auto pr-1">${recentHtml}</div></div>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Filter di Laporan',
      cancelButtonText: t('btn.tutup'),
      customClass: { popup: getSwalClass() }
    });
    if (res.isConfirmed) {
      const lapW = document.getElementById('lapWallet');
      if (lapW) lapW.value = walletId;
      switchView('laporan');
      if (typeof retryReportLoad === 'function') retryReportLoad();
    }
  }

  async function openAutoBudgetModal() {
    const recs = FinanceAnalysis.recommendCategoryBudgets(DB.transactions, DB.currentPeriod, DB.payrollDay, 3);
    if (!recs.length) {
      await Swal.fire({
        icon: 'info',
        title: 'Belum ada riwayat pengeluaran',
        text: 'Catat minimal beberapa pengeluaran agar sistem dapat menghitung rata-rata budget per kategori.',
        customClass: { popup: getSwalClass() }
      });
      return;
    }

    const rowsHtml = recs.map((r, idx) => `
      <label class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs">
        <span class="flex items-center gap-2 min-w-0">
          <input type="checkbox" class="mk-autobudget-chk" data-idx="${idx}" checked>
          <span class="font-bold text-slate-700 dark:text-slate-200 truncate">${escapeHtmlJS(r.category)}</span>
        </span>
        <span class="text-right shrink-0">
          <span class="font-black text-brand dark:text-brand-ink">${formatRupiah(r.recommendedAmount).replace(',00', '')}</span>
          <span class="block text-[10px] text-slate-400">rata² ${formatRupiah(r.averageActual).replace(',00', '')}</span>
        </span>
      </label>`).join('');

    const conf = await Swal.fire({
      title: 'Rekomendasi Budget (' + escapeHtmlJS(DB.currentPeriod) + ')',
      html: `<p class="text-xs text-slate-500 mb-3">Dihitung otomatis dari rata-rata 3 siklus terakhir:</p><div class="space-y-2 max-h-64 overflow-y-auto text-left">${rowsHtml}</div>`,
      showCancelButton: true,
      confirmButtonText: 'Terapkan Budget Terpilih',
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      preConfirm: () => Array.from(document.querySelectorAll('.mk-autobudget-chk:checked'))
        .map((chk) => recs[Number(chk.dataset.idx)]).filter(Boolean)
    });

    if (!conf.isConfirmed || !conf.value || !conf.value.length) return;
    Swal.fire({ title: 'Menyimpan budget...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), customClass: { popup: getSwalClass() } });
    try {
      let lastData = null;
      for (const item of conf.value) {
        lastData = await callServer('api_saveBudget', item.category, DB.currentPeriod, item.recommendedAmount);
      }
      if (lastData) await refreshFromServer(lastData);
      Swal.fire({ icon: 'success', title: conf.value.length + ' budget diterapkan!', timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  Object.assign(root, { openDebtDetailModal, addManualAssetUI, openWalletDetailModal, openAutoBudgetModal });
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.debtKey = debtKey;
})(typeof window !== 'undefined' ? window : globalThis);
