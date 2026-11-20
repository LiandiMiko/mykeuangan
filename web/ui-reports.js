/* global DB, laporanState, TransactionImport, Swal, callServer, refreshFromServer, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, renderSelectOptions, getSwalClass, showActionError, getPeriodRange, walletName, getAutoCategoryRules, updateReportBulkBar, t */
/* ============================================================
   REPORTS, PAGINATION, FILTERS & CSV IMPORT
   ============================================================ */
(function (root) {
  'use strict';

  function renderReportWallets() {
    const select = document.getElementById('lapWallet');
    if (!select) return;
    const current = select.value;
    const wallets = DB.wallets || [];
    renderSelectOptions(
      select,
      wallets.map((w) => ({ value: w.id, label: w.name })),
      t('lap.all_wallets'),
      wallets.some((w) => w.id === current) ? current : ''
    );
  }

  function renderReportCategories() {
    const select = document.getElementById('lapCategory');
    if (!select) return;
    const current = select.value;
    const categories = Array.from(new Set([
      ...(DB.categories.pemasukan || []),
      ...(DB.categories.pengeluaran || []),
      ...DB.transactions.map((transaction) => transaction.kategori)
    ].filter(Boolean))).sort((left, right) => left.localeCompare(right));
    renderSelectOptions(select, categories, t('lap.all_categories'), categories.includes(current) ? current : '');
  }

  function buildReportDesktopRow(r) {
    const isM = r.tipe === 'Pemasukan';
    const badgeColor = isM
      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
      : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400';
    const textColor = isM ? 'text-emerald-500' : 'text-rose-500';
    const idAttr = escapeAttrJS(r.id);
    const idHtml = escapeHtmlJS(r.id);

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td class="px-4 py-4"><input type="checkbox" class="lap-row-check w-4 h-4 rounded accent-brand" value="${idHtml}" onchange="typeof syncReportRowCheck==='function'?syncReportRowCheck(this.value,this.checked):updateReportBulkBar()" aria-label="Pilih transaksi"></td>
        <td class="px-6 py-4 whitespace-nowrap">${escapeHtmlJS(r.tanggal)}</td>
        <td class="px-6 py-4"><span class="px-2 py-1 rounded-md text-[10px] font-bold ${badgeColor}">${escapeHtmlJS(r.tipe)}</span></td>
        <td class="px-6 py-4 font-bold text-slate-800 dark:text-white">${escapeHtmlJS(r.kategori)}</td>
        <td class="px-6 py-4 text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">${escapeHtmlJS(walletName(r.walletId))}</td>
        <td class="px-6 py-4">${escapeHtmlJS(r.keterangan || '-')}</td>
        <td class="px-6 py-4 text-right font-bold whitespace-nowrap ${textColor}">${isM ? '+' : '-'} ${formatRupiah(r.nominal)}</td>
        <td class="px-6 py-4 text-center">
          <button type="button" onclick="editTransaction('${idAttr}')" aria-label="${escapeHtmlJS(t('lap.edit'))}" class="w-11 h-11 text-blue-500 hover:text-blue-700"><i class="ph ph-pencil text-lg" aria-hidden="true"></i></button>
          <button type="button" onclick="deleteTransaction('${idAttr}')" aria-label="${escapeHtmlJS(t('lap.delete'))}" class="w-11 h-11 text-rose-500 hover:text-rose-700"><i class="ph ph-trash text-lg" aria-hidden="true"></i></button>
        </td>
      </tr>`;
  }

  function buildReportMobileCard(r) {
    const isM = r.tipe === 'Pemasukan';
    const badgeColor = isM
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
      : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
    const textColor = isM ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const wLabel = walletName(r.walletId);
    const idAttr = escapeAttrJS(r.id);
    const idHtml = escapeHtmlJS(r.id);

    return `
      <div class="p-4 flex items-start gap-3">
        <input type="checkbox" class="lap-row-check-mobile mt-1 w-4 h-4 rounded accent-brand shrink-0" value="${idHtml}" onchange="typeof syncReportRowCheck==='function'&&syncReportRowCheck(this.value,this.checked)" aria-label="Pilih transaksi">
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-bold text-sm text-slate-800 dark:text-white truncate">${escapeHtmlJS(r.kategori)}</p>
              <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtmlJS(r.tanggal)}${wLabel ? ' · ' + escapeHtmlJS(wLabel) : ''}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-sm font-black tabular-nums ${textColor}">${isM ? '+' : '-'}${formatRupiah(r.nominal)}</p>
              <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeColor}">${escapeHtmlJS(r.tipe)}</span>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2 mt-2">
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${escapeHtmlJS(r.keterangan || '-')}</p>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" onclick="editTransaction('${idAttr}')" aria-label="${escapeHtmlJS(t('lap.edit'))}" class="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-blue-600 flex items-center justify-center"><i class="ph ph-pencil text-base" aria-hidden="true"></i></button>
              <button type="button" onclick="deleteTransaction('${idAttr}')" aria-label="${escapeHtmlJS(t('lap.delete'))}" class="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-500 flex items-center justify-center"><i class="ph ph-trash text-base" aria-hidden="true"></i></button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderReportRows(txs) {
    const tbody = document.getElementById('table-laporan');
    const mobileList = document.getElementById('list-laporan-mobile');
    if (!tbody) return;
    const selectAllEl = document.getElementById('lapSelectAll');
    const selectAllMobEl = document.getElementById('lapSelectAllMobile');
    if (selectAllEl) selectAllEl.checked = false;
    if (selectAllMobEl) selectAllMobEl.checked = false;

    if (!txs.length) {
      renderHtml(tbody, `<tr><td colspan="8" class="px-8 py-16 text-center text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('lap.no_results'))}</td></tr>`);
      if (mobileList) renderHtml(mobileList, `<div class="p-8 text-center text-xs text-slate-500 dark:text-slate-400">${escapeHtmlJS(t('lap.no_results'))}</div>`);
      if (typeof updateReportBulkBar === 'function') updateReportBulkBar();
      return;
    }

    renderHtml(tbody, txs.map(buildReportDesktopRow).join(''));
    if (mobileList) renderHtml(mobileList, txs.map(buildReportMobileCard).join(''));
    if (typeof updateReportBulkBar === 'function') updateReportBulkBar();
  }

  async function loadReportPage() {
    const tbody = document.getElementById('table-laporan');
    const mobileList = document.getElementById('list-laporan-mobile');
    if (!tbody) return;

    const readVal = (id) => (document.getElementById(id) || {}).value || '';
    const filters = {
      start: readVal('lapStart'),
      end: readVal('lapEnd'),
      search: readVal('lapSearch').trim(),
      type: readVal('lapType'),
      category: readVal('lapCategory'),
      walletId: readVal('lapWallet'),
      offset: laporanState.page * laporanState.pageSize,
      limit: laporanState.pageSize
    };
    const key = JSON.stringify(filters);
    if (!laporanState.dirty && laporanState.queryKey === key) return;
    const requestId = ++laporanState.requestId;
    laporanState.queryKey = key;
    laporanState.dirty = false;

    const status = document.getElementById('lapStatus');
    const pageStatus = document.getElementById('lapPageStatus');
    const previous = document.getElementById('lapPrev');
    const next = document.getElementById('lapNext');
    if (status) status.textContent = t('lap.loading');
    if (pageStatus) pageStatus.textContent = '';
    if (previous) previous.disabled = true;
    if (next) next.disabled = true;
    renderHtml(tbody, `<tr><td colspan="8" class="px-8 py-16 text-center text-slate-500">${escapeHtmlJS(t('lap.loading'))}</td></tr>`);
    if (mobileList) renderHtml(mobileList, `<div class="p-8 text-center text-xs text-slate-500">${escapeHtmlJS(t('lap.loading'))}</div>`);

    try {
      const result = await callServer('api_searchTransactions', filters);
      if (requestId !== laporanState.requestId) return;
      laporanState.rows = result.transactions || [];
      laporanState.total = Number(result.totalCount) || 0;
      if (status) status.textContent = '';
      renderReportRows(laporanState.rows);
      const first = laporanState.total ? filters.offset + 1 : 0;
      const last = Math.min(filters.offset + laporanState.rows.length, laporanState.total);
      if (pageStatus) pageStatus.textContent = `${t('lap.page_range')} ${first}–${last} ${t('lap.of')} ${laporanState.total}`;
      if (previous) previous.disabled = laporanState.page === 0;
      if (next) next.disabled = (laporanState.page + 1) * laporanState.pageSize >= laporanState.total;
    } catch (error) {
      if (requestId !== laporanState.requestId) return;
      laporanState.dirty = true;
      if (status) status.textContent = String(error.message || error);
      const errBtn = `<button type="button" onclick="retryReportLoad()" class="min-h-[44px] px-4 rounded-xl bg-brand text-white font-semibold">${escapeHtmlJS(t('lap.retry'))}</button>`;
      renderHtml(tbody, `<tr><td colspan="8" class="px-8 py-12 text-center"><p class="text-rose-600 dark:text-rose-400 mb-3">${escapeHtmlJS(t('lap.load_error'))}</p>${errBtn}</td></tr>`);
      if (mobileList) renderHtml(mobileList, `<div class="p-8 text-center"><p class="text-xs text-rose-600 dark:text-rose-400 mb-3">${escapeHtmlJS(t('lap.load_error'))}</p>${errBtn}</div>`);
    }
  }

  function renderLaporan() {
    const start = document.getElementById('lapStart');
    const end = document.getElementById('lapEnd');
    if (laporanState.period !== DB.currentPeriod) {
      const range = getPeriodRange(DB.currentPeriod, DB.payrollDay);
      if (start) start.value = range.start;
      if (end) end.value = range.end;
      laporanState.period = DB.currentPeriod;
      laporanState.dirty = true;
      laporanState.page = 0;
    }
    renderReportCategories();
    renderReportWallets();
    loadReportPage();
  }

  function bindReportControls() {
    const search = document.getElementById('lapSearch');
    if (!search || search.dataset.bound === 'true') return;
    search.dataset.bound = 'true';
    const reload = () => {
      laporanState.page = 0;
      laporanState.dirty = true;
      loadReportPage();
    };
    search.addEventListener('input', () => {
      root.clearTimeout(laporanState.searchTimer);
      laporanState.searchTimer = root.setTimeout(reload, 250);
    });
    ['lapStart', 'lapEnd', 'lapType', 'lapCategory', 'lapWallet'].forEach((id) => {
      const control = document.getElementById(id);
      if (control) control.addEventListener('change', reload);
    });
    const previous = document.getElementById('lapPrev');
    const next = document.getElementById('lapNext');
    if (previous) previous.addEventListener('click', () => {
      if (laporanState.page > 0) { laporanState.page -= 1; laporanState.dirty = true; loadReportPage(); }
    });
    if (next) next.addEventListener('click', () => {
      if ((laporanState.page + 1) * laporanState.pageSize < laporanState.total) { laporanState.page += 1; laporanState.dirty = true; loadReportPage(); }
    });

    const importButton = document.getElementById('lapImportBtn');
    const input = document.getElementById('lapCsvInput');
    if (importButton && input) {
      importButton.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (file) await importTransactionsCsv(file);
        input.value = '';
      });
    }
  }

  function retryReportLoad() {
    laporanState.dirty = true;
    loadReportPage();
  }

  function downloadTransactionTemplate() {
    const blob = new Blob(['tanggal,tipe,kategori,nominal,keterangan,dompet\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'template-transaksi-mykeuangan.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importTransactionsCsv(file) {
    if (file.size > 2 * 1024 * 1024) {
      showActionError(new Error(t('lap.import_limit')));
      return;
    }
    try {
      const text = await file.text();
      if (TransactionImport.parseRows(text).length > 501) throw new Error(t('lap.import_limit'));
      const importOptions = {
        autoCategoryRules: typeof getAutoCategoryRules === 'function' ? getAutoCategoryRules() : [],
        categories: DB.categories
      };
      const result = TransactionImport.parseTransactionCsv(text, DB.transactions, DB.wallets, importOptions);
      const preview = result.rows.slice(0, 5).map((item) => {
        const rowText = `${item.transaction.tanggal} · ${item.transaction.kategori} · ${Number.isFinite(item.transaction.nominal) ? formatRupiah(item.transaction.nominal) : '-'}`;
        const issue = item.errors.length ? item.errors.join(' ') : (item.duplicate ? t('lap.import_duplicates') : '');
        return `<li class="py-1"><strong>${t('lap.csv_line')} ${item.line}:</strong> ${escapeHtmlJS(rowText)}${issue ? ` <span class="text-rose-600 dark:text-rose-400">${escapeHtmlJS(issue)}</span>` : ''}</li>`;
      }).join('');
      const invalidRows = result.rows.filter((item) => item.errors.length)
        .map((item) => `<li class="py-1"><strong>${t('lap.csv_line')} ${item.line}:</strong> ${escapeHtmlJS(item.errors.join(' '))}</li>`).join('');
      const html = `
        <div class="text-left text-sm space-y-2">
          <p>${escapeHtmlJS(t('lap.import_valid'))}: <strong>${result.valid.length}</strong></p>
          <p>${escapeHtmlJS(t('lap.import_duplicates'))}: <strong>${result.duplicateCount}</strong></p>
          <p>${escapeHtmlJS(t('lap.import_invalid'))}: <strong>${result.invalidCount}</strong></p>
          <ul class="max-h-32 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">${preview}</ul>
          ${invalidRows ? `<div><h4 class="font-semibold">${escapeHtmlJS(t('lap.import_invalid'))}</h4><ul class="max-h-40 overflow-y-auto text-xs text-rose-600 dark:text-rose-400">${invalidRows}</ul></div>` : ''}
        </div>`;

      const confirmation = await Swal.fire({
        icon: result.valid.length ? 'info' : 'warning',
        title: t('lap.import_preview'),
        html,
        showCancelButton: true,
        showConfirmButton: result.valid.length > 0,
        confirmButtonText: `${t('lap.import_confirm')} (${result.valid.length})`,
        cancelButtonText: t('btn.batal'),
        customClass: { popup: getSwalClass() }
      });
      if (!confirmation.isConfirmed || !result.valid.length) return;
      const response = await callServer('api_importTransactions', result.valid);
      await refreshFromServer(response);
      await Swal.fire({
        icon: 'success',
        title: t('lap.import_done'),
        text: `${response.addedCount} · ${t('lap.import_duplicates')}: ${response.skippedCount}`,
        customClass: { popup: getSwalClass() }
      });
    } catch (error) {
      showActionError(error);
    }
  }

  function getFilteredReportTransactions() {
    const start = (document.getElementById('lapStart') || {}).value || getPeriodRange(DB.currentPeriod, DB.payrollDay).start;
    const end = (document.getElementById('lapEnd') || {}).value || getPeriodRange(DB.currentPeriod, DB.payrollDay).end;
    const search = ((document.getElementById('lapSearch') || {}).value || '').trim().toLocaleLowerCase();
    const type = (document.getElementById('lapType') || {}).value || '';
    const category = (document.getElementById('lapCategory') || {}).value || '';
    const walletId = (document.getElementById('lapWallet') || {}).value || '';
    const txs = DB.transactions.filter((transaction) =>
      transaction.tanggal >= start &&
      transaction.tanggal <= end &&
      (!type || transaction.tipe === type) &&
      (!category || transaction.kategori === category) &&
      (!walletId || transaction.walletId === walletId) &&
      (!search || `${transaction.kategori} ${transaction.keterangan || ''}`.toLocaleLowerCase().includes(search))
    ).sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));
    return { txs, period: `${start}_${end}` };
  }

  Object.assign(root, {
    renderLaporan,
    renderReportWallets,
    renderReportCategories,
    bindReportControls,
    retryReportLoad,
    loadReportPage,
    renderReportRows,
    downloadTransactionTemplate,
    importTransactionsCsv,
    getFilteredReportTransactions
  });
})(typeof window !== 'undefined' ? window : globalThis);
