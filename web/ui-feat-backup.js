/* global DB, FinanceAnalysis, sessionUser, Swal, callServer, refreshFromServer, formatRupiah, _origFormatRupiah, escapeHtmlJS, renderHtml, getSwalClass, showActionError, getFilteredReportTransactions, walletName, localToday, t */
/* ============================================================
   FEATURES — EXCEL EXPORT, JSON BACKUP/RESTORE & PRINT STATEMENT
   ============================================================ */
(function (root) {
  'use strict';

  function exportExcel() {
    const { txs, period } = getFilteredReportTransactions();
    if (!txs.length) {
      Swal.fire({ icon: 'warning', title: 'Kosong', text: 'Tidak ada data untuk diekspor', customClass: { popup: getSwalClass() } });
      return;
    }
    const safeExcelCell = (val) => {
      const s = String(val == null ? '' : val);
      return escapeHtmlJS(/^[=+\-@\t\r]/.test(s) ? ("'" + s) : s);
    };
    const rowsHtml = txs.map((r) => `
      <tr>
        <td>${safeExcelCell(r.tanggal)}</td>
        <td>${safeExcelCell(r.tipe)}</td>
        <td>${safeExcelCell(r.kategori)}</td>
        <td>${Number(r.nominal) || 0}</td>
        <td>${safeExcelCell(r.keterangan || '')}</td>
        <td>${safeExcelCell(walletName(r.walletId))}</td>
      </tr>`).join('');

    const tableDoc = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="UTF-8"></head>
      <body>
        <table border="1">
          <thead><tr><th>Tanggal</th><th>Tipe</th><th>Kategori</th><th>Nominal (IDR)</th><th>Catatan</th><th>Dompet</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body></html>`;

    const blob = new Blob(['\ufeff' + tableDoc], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Laporan_Keuangan_${sessionUser}_${period || 'All'}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportBackupJson() {
    const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
    const snapshot = {
      exportedAt: new Date().toISOString(),
      version: '3.1',
      user: sessionUser,
      currentPeriod: DB.currentPeriod,
      payrollDay: DB.payrollDay,
      wallets: DB.wallets || [],
      transfers: DB.transfers || [],
      categories: DB.categories || {},
      entities: DB.entities || {},
      assets: DB.assets || [],
      budgets: DB.budgets || [],
      goals: DB.goals || [],
      recurring: DB.recurring || [],
      debtDueDates: DB.debtDueDates || {},
      transactions: DB.transactions || []
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_MyKeuGuech_${sessionUser}_${todayStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerRestoreJson() {
    const input = document.getElementById('lapRestoreJsonInput');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function applyBackupRestorePlan(plan) {
    Swal.fire({
      title: 'Memulihkan data...',
      text: 'Mohon tunggu sebentar.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      customClass: { popup: getSwalClass() }
    });
    const validWalletIds = new Set((DB.wallets || []).map((w) => String(w.id)));
    const fallbackWalletId = (DB.wallets && DB.wallets[0] && DB.wallets[0].id) || '';
    for (let i = 0; i < plan.newTransactions.length; i += 500) {
      const chunk = plan.newTransactions.slice(i, i + 500).map((tx) => ({
        ...tx,
        walletId: tx.walletId && validWalletIds.has(String(tx.walletId)) ? tx.walletId : fallbackWalletId
      }));
      await refreshFromServer(await callServer('api_importTransactions', chunk));
    }
    for (const b of plan.newBudgets) {
      await refreshFromServer(await callServer('api_saveBudget', b.kategori, b.bulan, b.jumlah));
    }
    for (const g of plan.newGoals) {
      await refreshFromServer(await callServer('api_saveGoal', g));
    }
  }

  async function handleRestoreJsonFile(event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    if (typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.prepareBackupRestorePayload !== 'function') {
      Swal.fire({ icon: 'error', title: 'Error', text: 'Modul analisis belum siap.', customClass: { popup: getSwalClass() } });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (_) {
      Swal.fire({ icon: 'error', title: 'File Tidak Valid', text: 'File bukan JSON backup yang valid.', customClass: { popup: getSwalClass() } });
      return;
    }

    const plan = FinanceAnalysis.prepareBackupRestorePayload(parsed, DB);
    if (!plan.valid) {
      Swal.fire({ icon: 'error', title: 'Format Tidak Dikenali', text: 'File JSON tidak memuat array transactions, budgets, atau goals.', customClass: { popup: getSwalClass() } });
      return;
    }

    if (plan.newTransactions.length + plan.newBudgets.length + plan.newGoals.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Semua Data Sudah Tersimpan',
        text: `Tidak ada data baru untuk ditambahkan (${plan.skippedTransactions} transaksi, ${plan.skippedBudgets} budget, ${plan.skippedGoals} target sudah ada).`,
        customClass: { popup: getSwalClass() }
      });
      return;
    }

    const confirmRes = await Swal.fire({
      icon: 'question',
      title: 'Konfirmasi Restore & Merge JSON',
      html: `
        <div class="text-left text-xs space-y-2 text-slate-600 dark:text-slate-300">
          <p>Data baru akan ditambahkan tanpa menduplikasi data yang sudah ada:</p>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>Transaksi baru:</strong> ${plan.newTransactions.length} <span class="text-slate-400">(${plan.skippedTransactions} dilewati)</span></li>
            <li><strong>Budget baru:</strong> ${plan.newBudgets.length} <span class="text-slate-400">(${plan.skippedBudgets} dilewati)</span></li>
            <li><strong>Target keuangan baru:</strong> ${plan.newGoals.length} <span class="text-slate-400">(${plan.skippedGoals} dilewati)</span></li>
          </ul>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Pulihkan Sekarang',
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!confirmRes.isConfirmed) return;

    try {
      await applyBackupRestorePlan(plan);
      Swal.fire({
        icon: 'success',
        title: 'Restore Selesai!',
        text: `${plan.newTransactions.length} transaksi, ${plan.newBudgets.length} budget, dan ${plan.newGoals.length} target berhasil dipulihkan.`,
        customClass: { popup: getSwalClass() }
      });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
      else Swal.fire({ icon: 'error', title: 'Gagal Restore', text: String(err.message || err), customClass: { popup: getSwalClass() } });
    }
  }

  function buildStatementHtml(st, fmtFn, forPrint) {
    const dateRangeLabel = `${st.range.start} s/d ${st.range.end}`;
    const runwayText = st.ratios.emergencyRunwayMonths !== null ? `${st.ratios.emergencyRunwayMonths} Bulan` : '—';
    const cardStyle = forPrint ? 'padding:12px;border-radius:12px;border:1px solid #cbd5e1;background:#f8fafc;' : '';
    const cardClass = forPrint ? '' : 'p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800';
    const innerCardStyle = forPrint ? 'padding:8px;border-radius:8px;border:1px solid #e2e8f0;background:#ffffff;' : '';
    const innerCardClass = forPrint ? '' : 'p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800';
    const rowBorder = forPrint ? 'border-bottom:1px solid #e2e8f0;padding:5px 0;font-size:12px;display:flex;justify-content:space-between;' : '';
    const rowClass = forPrint ? '' : 'flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 text-xs';

    const topExpHtml = (st.topExpenses || []).map((e, idx) => `
      <div class="${rowClass}" ${forPrint ? `style="${rowBorder}"` : ''}>
        <span class="${forPrint ? '' : 'text-slate-600 dark:text-slate-300'}">${idx + 1}. ${escapeHtmlJS(e.category || 'Lainnya')}</span>
        <span class="${forPrint ? '' : 'font-extrabold text-slate-800 dark:text-white'}" style="${forPrint ? 'font-weight:800;' : ''}">${fmtFn(e.amount ?? 0)} (${e.sharePct}%)</span>
      </div>`).join('') || '<p style="font-size:12px;color:#64748b;padding:4px 0;">Belum ada pengeluaran.</p>';

    return `
      <div class="text-left space-y-4">
        <div style="${forPrint ? 'border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:12px;' : ''}" class="${forPrint ? '' : 'border-b border-slate-200 dark:border-slate-700 pb-3'}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <h3 style="${forPrint ? 'margin:0;font-size:16px;font-weight:900;text-transform:uppercase;color:#0f172a;' : ''}" class="${forPrint ? '' : 'text-base font-black text-slate-900 dark:text-white uppercase tracking-wide'}">Ringkasan Finansial Eksekutif</h3>
            <span style="${forPrint ? 'font-size:10px;font-weight:700;padding:3px 8px;border:1px solid #4f46e5;border-radius:999px;color:#4f46e5;text-transform:uppercase;' : ''}" class="${forPrint ? '' : 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand/10 text-brand dark:text-brand-ink uppercase'}">1-Page Statement</span>
          </div>
          <p style="${forPrint ? 'margin:4px 0 0;font-size:12px;color:#475569;' : ''}" class="${forPrint ? '' : 'text-xs text-slate-500 dark:text-slate-400 mt-0.5'}">Pengguna: <strong>${escapeHtmlJS(sessionUser || 'User')}</strong> · Siklus: <strong>${escapeHtmlJS(st.period)}</strong> (${escapeHtmlJS(dateRangeLabel)})</p>
        </div>
        <div style="${forPrint ? 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;' : ''}" class="${forPrint ? '' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}">
          <div class="${cardClass}" style="${cardStyle}">
            <span style="${forPrint ? 'font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-[10px] font-bold uppercase tracking-wider text-slate-400'}">Kekayaan Bersih (Net Worth)</span>
            <p style="${forPrint ? 'margin:4px 0 8px;font-size:18px;font-weight:900;color:#0f172a;' : ''}" class="${forPrint ? '' : 'text-lg font-black text-slate-900 dark:text-white mt-0.5'}">${fmtFn(st.netWorth)}</p>
            <div style="${forPrint ? 'font-size:11px;color:#334155;' : ''}" class="${forPrint ? '' : 'text-[11px] text-slate-500 dark:text-slate-400 mt-1 space-y-0.5'}">
              <div style="display:flex;justify-content:space-between;"><span>Kas Dompet:</span> <strong>${fmtFn(st.walletsTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Investasi/Aset:</span> <strong>${fmtFn(st.assetsTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Piutang:</span> <strong>${fmtFn(st.piutangTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Utang:</span> <strong style="color:#e11d48;">-${fmtFn(st.utangTotal)}</strong></div>
            </div>
          </div>
          <div class="${cardClass}" style="${cardStyle}">
            <span style="${forPrint ? 'font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-[10px] font-bold uppercase tracking-wider text-slate-400'}">Arus Kas Siklus Berjalan</span>
            <p style="${forPrint ? `margin:4px 0 8px;font-size:18px;font-weight:900;color:${st.netCashflow >= 0 ? '#059669' : '#e11d48'};` : ''}" class="${forPrint ? '' : `text-lg font-black ${st.netCashflow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} mt-0.5`}">${st.netCashflow >= 0 ? '+' : ''}${fmtFn(st.netCashflow)}</p>
            <div style="${forPrint ? 'font-size:11px;color:#334155;' : ''}" class="${forPrint ? '' : 'text-[11px] text-slate-500 dark:text-slate-400 mt-1 space-y-0.5'}">
              <div style="display:flex;justify-content:space-between;"><span>Pemasukan:</span> <strong style="color:#059669;">${fmtFn(st.incomeTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Pengeluaran:</span> <strong style="color:#e11d48;">${fmtFn(st.expenseTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Savings Rate:</span> <strong>${st.savingsRate}%</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Biaya Rutin (Fixed):</span> <strong>${st.fixedCostRatioPct}%</strong></div>
            </div>
          </div>
        </div>
        <div class="${cardClass}" style="${forPrint ? cardStyle + 'margin-bottom:12px;' : ''}">
          <span style="${forPrint ? 'display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:6px;' : ''}" class="${forPrint ? '' : 'text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block'}">Metrik Kesehatan Finansial</span>
          <div style="${forPrint ? 'display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;' : ''}" class="${forPrint ? '' : 'grid grid-cols-2 gap-2 text-xs'}">
            <div class="${innerCardClass}" style="${innerCardStyle}"><span style="${forPrint ? 'font-size:10px;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-[10px] text-slate-400'}">Runway Dana Darurat</span><p style="${forPrint ? 'margin:2px 0;font-weight:900;color:#0f172a;' : ''}" class="${forPrint ? '' : 'font-black text-slate-800 dark:text-white mt-0.5'}">${escapeHtmlJS(runwayText)}</p><span style="${forPrint ? 'font-size:10px;font-weight:700;color:#4f46e5;' : ''}" class="${forPrint ? '' : 'text-[10px] font-bold text-brand'}">${escapeHtmlJS(st.ratios.runwayStatus)}</span></div>
            <div class="${innerCardClass}" style="${innerCardStyle}"><span style="${forPrint ? 'font-size:10px;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-[10px] text-slate-400'}">Rasio Utang / Aset</span><p style="${forPrint ? 'margin:2px 0;font-weight:900;color:#0f172a;' : ''}" class="${forPrint ? '' : 'font-black text-slate-800 dark:text-white mt-0.5'}">${st.ratios.debtToAssetPct}%</p><span style="${forPrint ? `font-size:10px;font-weight:700;color:${st.ratios.debtToAssetPct <= 30 ? '#059669' : '#d97706'};` : ''}" class="${forPrint ? '' : `text-[10px] font-bold ${st.ratios.debtToAssetPct <= 30 ? 'text-emerald-600' : 'text-amber-600'}`}">${escapeHtmlJS(st.ratios.debtStatus)}</span></div>
          </div>
        </div>
        <div class="${cardClass}" style="${cardStyle}">
          <span style="${forPrint ? 'display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:6px;' : ''}" class="${forPrint ? '' : 'text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block'}">Pengeluaran Terbesar Periode Ini</span>
          <div class="space-y-0.5">${topExpHtml}</div>
        </div>
      </div>`;
  }

  function openFinancialStatementModal() {
    if (!root.isDataReady || typeof FinanceAnalysis === 'undefined' || typeof FinanceAnalysis.compileOnePageFinancialStatement !== 'function') {
      Swal.fire({ icon: 'error', title: 'Error', text: 'Modul analisis keuangan belum siap.', customClass: { popup: getSwalClass() } });
      return;
    }
    const st = FinanceAnalysis.compileOnePageFinancialStatement(DB, DB.currentPeriod, DB.payrollDay);
    const fmtPreview = (n) => formatRupiah(n).replace(',00', '');
    Swal.fire({
      html: `<div id="printStatementArea">${buildStatementHtml(st, fmtPreview, false)}</div>`,
      width: '540px',
      showCancelButton: true,
      confirmButtonText: '🖨️ Cetak / Print',
      cancelButtonText: 'Tutup',
      confirmButtonColor: '#4f46e5',
      customClass: { popup: getSwalClass() }
    }).then((result) => {
      if (!result.isConfirmed) return;
      const fmtPrint = (n) => (typeof _origFormatRupiah === 'function' ? _origFormatRupiah(n) : formatRupiah(n)).replace(',00', '');
      let printRoot = document.getElementById('mkPrintStatementRoot');
      if (!printRoot) {
        printRoot = document.createElement('div');
        printRoot.id = 'mkPrintStatementRoot';
        document.body.appendChild(printRoot);
      }
      renderHtml(printRoot, `<div style="font-family:Inter,system-ui,sans-serif;padding:8px;color:#0f172a;background:#fff;">${buildStatementHtml(st, fmtPrint, true)}</div>`);
      document.body.classList.add('mk-printing-statement');
      const cleanup = () => {
        document.body.classList.remove('mk-printing-statement');
        printRoot.textContent = '';
        root.removeEventListener('afterprint', cleanup);
      };
      root.addEventListener('afterprint', cleanup);
      setTimeout(() => { root.print(); }, 60);
      setTimeout(cleanup, 15000);
    });
  }

  Object.assign(root, { exportExcel, exportBackupJson, triggerRestoreJson, handleRestoreJsonFile, openFinancialStatementModal });
})(typeof window !== 'undefined' ? window : globalThis);
