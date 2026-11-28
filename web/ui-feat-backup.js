// @depends-on: error-messages.js, ui-state.js
/* global DB, FinanceAnalysis, sessionUser, Swal, callServer, refreshFromServer, formatRupiah, _origFormatRupiah, escapeHtmlJS, renderHtml, getSwalClass, showActionError, getFilteredReportTransactions, walletName, localToday, t, toUserErrorMessage */
/* ============================================================
   FEATURES — EXCEL EXPORT, JSON BACKUP/RESTORE & PRINT STATEMENT
   ============================================================ */
(function (root) {
  'use strict';

  function downloadOrShareText(content, filename, mimeType) {
    if (typeof root.saveOrShareFile === 'function') {
      root.saveOrShareFile(content, filename, mimeType);
      return;
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // Gelombang 4 (R18): dipindah ke lingkup IIFE (dulu bersarang di
  // exportExcel sehingga tidak bisa diuji) + aturan yang sama dengan
  // csvEscapeCell: spasi di depan pemicu dan | % juga disanitasi.
  function safeExcelCell(val) {
    const s = String(val == null ? '' : val);
    return escapeHtmlJS(/^\s*[=+\-@|%]/.test(s) ? ("'" + s) : s);
  }

  function exportExcel() {
    const { txs, period } = getFilteredReportTransactions();
    if (!txs.length) {
      Swal.fire({ icon: 'warning', title: 'Kosong', text: 'Tidak ada data untuk diekspor', customClass: { popup: getSwalClass() } });
      return;
    }
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

    downloadOrShareText('\ufeff' + tableDoc, `Laporan_Keuangan_${sessionUser}_${period || 'All'}.xls`, 'application/vnd.ms-excel;charset=utf-8');
  }

  const ENCRYPTED_BACKUP_FORMAT = 'mykeuguech-encrypted-backup-v1';
  // Wave 3.5 §8: PBKDF2 600.000 iterasi (OWASP) & kata sandi min 12.
  // BACK-COMPAT: decrypt memakai env.iterations (backup lama 150.000
  // tetap terbuka); hanya backup BARU yang ditulis dengan 600.000.
  const BACKUP_PBKDF2_ITERATIONS = 600000;
  const BACKUP_LEGACY_PBKDF2_ITERATIONS = 150000;
  const BACKUP_MIN_PASSWORD_LENGTH = 12;

  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveBackupAesKey(password, saltBytes, usages, iterations) {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle) throw new Error('Web Crypto AES-GCM tidak tersedia pada perangkat ini.');
    const keyMat = await subtle.importKey('raw', new TextEncoder().encode(String(password || '')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: Number(iterations) > 0 ? Number(iterations) : BACKUP_PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMat,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  async function encryptBackupPayload(snapshot, password) {
    const pass = String(password || '');
    if (pass.length < BACKUP_MIN_PASSWORD_LENGTH) throw new Error('Kata sandi enkripsi minimal 12 karakter.');
    const salt = new Uint8Array(16);
    const iv = new Uint8Array(12);
    root.crypto.getRandomValues(salt);
    root.crypto.getRandomValues(iv);
    const key = await deriveBackupAesKey(pass, salt, ['encrypt']);
    const cipherBuf = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(snapshot)));
    return {
      format: ENCRYPTED_BACKUP_FORMAT,
      kdf: 'PBKDF2-SHA256',
      iterations: BACKUP_PBKDF2_ITERATIONS,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      ciphertext: bytesToB64(new Uint8Array(cipherBuf))
    };
  }

  async function decryptBackupPayload(envelope, password) {
    const env = envelope && typeof envelope === 'object' ? envelope : {};
    if (env.format !== ENCRYPTED_BACKUP_FORMAT) throw new Error('Format backup terenkripsi tidak dikenali.');
    const pass = String(password || '');
    if (!pass) throw new Error('Kata sandi diperlukan untuk mendekripsi backup.');
    const salt = b64ToBytes(env.salt);
    const iv = b64ToBytes(env.iv);
    const cipherBytes = b64ToBytes(env.ciphertext);
    // Backup lama (150.000 iterasi) tetap bisa dibuka: pakai iterasi yang
    // tercatat di envelope; hanya envelope tanpa catatan yang jatuh ke 150.000.
    const iterations = Number(env.iterations) > 0 ? Number(env.iterations) : BACKUP_LEGACY_PBKDF2_ITERATIONS;
    const key = await deriveBackupAesKey(pass, salt, ['decrypt'], iterations);
    const plainBuf = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  async function exportBackupJson() {
    const todayStr = localToday();
    const snapshot = {
      exportedAt: new Date().toISOString(),
      version: '3.14',
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
    const choice = await Swal.fire({
      title: 'Ekspor Backup JSON',
      // Gelombang 4 (R19): peringatan jelas bahwa JSON biasa TIDAK
      // terenkripsi — dulu kedua pilihan tampil setara tanpa peringatan.
      html: 'Pilih apakah berkas backup disimpan dalam format JSON biasa atau dienkripsi dengan kata sandi (AES-GCM).<br><br><b>\u26a0\ufe0f JSON biasa TIDAK terenkripsi:</b> siapa pun yang mendapatkan berkas ini dapat membaca seluruh data keuangan Anda. Simpan di tempat yang aman, atau pilih enkripsi kata sandi.',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'JSON Biasa (Tidak Terenkripsi)',
      denyButtonText: 'Enkripsi Kata Sandi',
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (choice.isConfirmed) {
      downloadOrShareText(JSON.stringify(snapshot, null, 2), `Backup_MyKeuGuech_${sessionUser}_${todayStr}.json`, 'application/json;charset=utf-8');
      return;
    }
    if (!choice.isDenied) return;
    const passRes = await Swal.fire({
      title: 'Kata Sandi Enkripsi Backup',
      input: 'password',
      inputPlaceholder: 'Minimal 12 karakter',
      inputAttributes: { autocomplete: 'new-password' },
      showCancelButton: true,
      confirmButtonText: 'Enkripsi & Unduh',
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      preConfirm: (v) => (String(v || '').length < 12 ? (Swal.showValidationMessage('Minimal 12 karakter.'), false) : String(v))
    });
    if (!passRes.isConfirmed || !passRes.value) return;
    try {
      const encrypted = await encryptBackupPayload(snapshot, passRes.value);
      downloadOrShareText(JSON.stringify(encrypted, null, 2), `Backup_Encrypted_MyKeuGuech_${sessionUser}_${todayStr}.json`, 'application/json;charset=utf-8');
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  function triggerRestoreJson() {
    const input = document.getElementById('lapRestoreJsonInput');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  // Wave 3.5 §2: TIDAK ADA lagi fallback diam-diam ke dompet pertama.
  // Bila dompet lama tidak cocok dengan id maupun nama, kembalikan null
  // dan biarkan pemanggil membatalkan restore (bukan menaruh transaksi
  // orang ke dompet yang salah). Transaksi yang memang TANPA dompet
  // (walletId kosong, mis. dari bot) tetap ditangani pemanggil/RPC
  // lewat dompet default — itu bukan kasus "dompet hilang".
  function resolveRestoredWalletId(oldWalletId, walletNameByOldId) {
    const wallets = DB.wallets || [];
    if (oldWalletId && wallets.some((w) => String(w.id) === String(oldWalletId))) return String(oldWalletId);
    const mappedName = oldWalletId && walletNameByOldId ? String(walletNameByOldId[String(oldWalletId)] || '').trim().toLowerCase() : '';
    if (mappedName) {
      const matched = wallets.find((w) => String(w.name || '').trim().toLowerCase() === mappedName);
      if (matched && matched.id) return String(matched.id);
    }
    return null;
  }

  function makeRestoreIdempotencyKey() {
    const c = root.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'restore-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Payload satu panggilan untuk RPC restore_backup (§3): semua 10
  // koleksi, dompet dirujuk BERDASARKAN NAMA (id lama tidak berlaku
  // lintas akun), transaksi membawa legacyId untuk dedup retry-aman.
  function buildRestoreRpcPayload(plan) {
    return {
      wallets: (plan.newWallets || []).map((w) => ({ name: w.name, kind: w.kind, openingBalance: w.openingBalance })),
      categories: (plan.newCategories || []).map((c) => ({ tipe: c.tipe, name: c.name })),
      entities: (plan.newEntities || []).map((e) => ({ grp: e.grp, name: e.name })),
      transactions: (plan.newTransactions || []).map((t) => ({
        legacyId: t.legacyId || t.id || '',
        tanggal: t.tanggal, tipe: t.tipe, kategori: t.kategori,
        nominal: t.nominal, keterangan: t.keterangan || '',
        walletName: t.walletName || ''
      })),
      transfers: (plan.newTransfers || []).map((x) => ({
        legacyId: x.legacyId || x.id || '',
        tanggal: x.tanggal, kind: x.kind,
        fromWalletName: x.fromWalletName || '', toWalletName: x.toWalletName || '',
        nominal: x.nominal, fee: x.fee || 0, keterangan: x.keterangan || ''
      })),
      budgets: (plan.newBudgets || []).map((b) => ({ bulan: b.bulan, kategori: b.kategori, jumlah: b.jumlah })),
      goals: (plan.newGoals || []).map((g) => ({
        name: g.name, targetAmount: g.targetAmount,
        currentAmount: g.currentAmount || 0, targetDate: g.targetDate || ''
      })),
      recurring: (plan.newRecurring || []).map((r) => ({
        tipe: r.tipe, kategori: r.kategori, nominal: r.nominal,
        dayOfMonth: r.dayOfMonth, keterangan: r.keterangan || '', active: r.active !== false
      })),
      assets: (plan.newAssets || []).map((a) => ({
        name: a.name, type: a.type, symbol: a.symbol || '',
        quantity: a.quantity || 0, buyPrice: a.buyPrice || 0, value: a.value || 0
      })),
      debtDueDates: plan.newDebtDueDates || {}
    };
  }

  async function applyBackupRestorePlanSequential(plan) {
    for (const c of (plan.newCategories || [])) {
      await refreshFromServer(await callServer('api_addCategory', c.tipe, c.name));
    }
    for (const w of (plan.newWallets || [])) {
      await refreshFromServer(await callServer('api_addWallet', w));
    }
    for (const e of (plan.newEntities || [])) {
      await refreshFromServer(await callServer('api_addEntity', e.grp, e.name));
    }
    // Urutan fallback: transaksi DULU lalu transfer, supaya saldo
    // turunan dompet asal sudah terbentuk saat RPC transfer mengecek
    // saldo (di RPC restore urutan ini ditangani di dalam server).
    for (let i = 0; i < plan.newTransactions.length; i += 500) {
      const chunk = plan.newTransactions.slice(i, i + 500).map((tx) => {
        const walletId = tx.walletId ? resolveRestoredWalletId(tx.walletId, plan.walletNameByOldId) : '';
        if (tx.walletId && !walletId) {
          throw new Error('Dompet tidak ditemukan untuk transaksi ' + tx.tanggal + ' · ' + tx.kategori + ' · ' + tx.nominal + '. Restore dibatalkan.');
        }
        return { ...tx, walletId: walletId || '' };
      });
      await refreshFromServer(await callServer('api_importTransactions', chunk));
    }
    for (const x of (plan.newTransfers || [])) {
      await refreshFromServer(await callServer('api_addTransfer', {
        tanggal: x.tanggal, kind: x.kind,
        fromWallet: resolveRestoredWalletId(x.fromWallet, plan.walletNameByOldId),
        toWallet: x.kind === 'investasi' ? '' : resolveRestoredWalletId(x.toWallet, plan.walletNameByOldId),
        nominal: x.nominal, fee: x.fee || 0, keterangan: x.keterangan || '',
        idempotencyKey: makeRestoreIdempotencyKey()
      }));
    }
    for (const b of plan.newBudgets) {
      await refreshFromServer(await callServer('api_saveBudget', b.kategori, b.bulan, b.jumlah));
    }
    for (const g of plan.newGoals) {
      await refreshFromServer(await callServer('api_saveGoal', g));
    }
    for (const r of (plan.newRecurring || [])) {
      await refreshFromServer(await callServer('api_saveRecurring', r));
    }
    for (const a of (plan.newAssets || [])) {
      await refreshFromServer(await callServer('api_addAssetV2', { ...a, walletId: '' }));
    }
    const dueEntries = Object.entries(plan.newDebtDueDates || {});
    if (dueEntries.length) {
      const mergedDue = Object.assign({}, plan.newDebtDueDates, DB.debtDueDates || {});
      await refreshFromServer(await callServer('api_saveDebtDueDates', mergedDue));
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
    // Jalur utama (§3): SATU panggilan RPC restore_backup — atomik di
    // server. Bila RPC belum ada di server (migrasi belum diterapkan),
    // jatuh ke jalur sekuensial klien (tidak atomik — dicatat di UI
    // lewat error bila gagal di tengah jalan).
    try {
      const payload = buildRestoreRpcPayload(plan);
      const res = await callServer('api_restoreBackup', payload);
      if (res && res.restored) {
        await refreshFromServer(await callServer('getInitialData'));
        return;
      }
      await applyBackupRestorePlanSequential(plan);
    } catch (err) {
      if (/could not find the function|PGRST202/i.test(String((err && err.message) || err || ''))) {
        await applyBackupRestorePlanSequential(plan);
        return;
      }
      throw err;
    }
  }

  function buildRestoreSummaryHtml(plan) {
    const dueCount = Object.keys(plan.newDebtDueDates || {}).length;
    const rows = [
      ['Kategori baru', (plan.newCategories || []).length, plan.skippedCategories || 0],
      ['Dompet baru', (plan.newWallets || []).length, plan.skippedWallets || 0],
      ['Entitas utang/piutang baru', (plan.newEntities || []).length, plan.skippedEntities || 0],
      ['Transaksi baru', plan.newTransactions.length, plan.skippedTransactions],
      ['Transfer baru', (plan.newTransfers || []).length, plan.skippedTransfers || 0],
      ['Budget baru', plan.newBudgets.length, plan.skippedBudgets],
      ['Target keuangan baru', plan.newGoals.length, plan.skippedGoals],
      ['Jadwal rutin baru', (plan.newRecurring || []).length, plan.skippedRecurring || 0],
      ['Aset baru', (plan.newAssets || []).length, plan.skippedAssets || 0],
      ['Jatuh tempo utang baru', dueCount, plan.skippedDebtDueDates || 0]
    ];
    const listHtml = rows.map(([label, add, skip]) =>
      `<li><strong>${label}:</strong> ${add} <span class="text-slate-500">(${skip} dilewati)</span></li>`
    ).join('');
    return `<div class="text-left text-xs space-y-2 text-slate-600 dark:text-slate-300"><p>Data baru akan ditambahkan tanpa menduplikasi data yang sudah ada:</p><ul class="list-disc pl-5 space-y-1">${listHtml}</ul></div>`;
  }

  async function handleRestoreJsonFile(event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (event && event.target) event.target.value = '';
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
    if (parsed && parsed.format === ENCRYPTED_BACKUP_FORMAT) {
      const decPass = await Swal.fire({
        title: 'Backup Terenkripsi Terdeteksi',
        input: 'password',
        inputPlaceholder: 'Masukkan kata sandi dekripsi',
        showCancelButton: true,
        confirmButtonText: 'Buka Backup',
        cancelButtonText: t('btn.batal'),
        customClass: { popup: getSwalClass() }
      });
      if (!decPass.isConfirmed || !decPass.value) return;
      try {
        parsed = await decryptBackupPayload(parsed, decPass.value);
      } catch (_) {
        Swal.fire({ icon: 'error', title: 'Kata Sandi Salah', text: 'Gagal mendekripsi berkas backup. Periksa kembali kata sandi Anda.', customClass: { popup: getSwalClass() } });
        return;
      }
    }

    const plan = FinanceAnalysis.prepareBackupRestorePayload(parsed, DB);
    if (!plan.valid) {
      Swal.fire({ icon: 'error', title: 'Format Tidak Dikenali', text: 'File JSON tidak memuat koleksi data MyKeuGuech yang valid.', customClass: { popup: getSwalClass() } });
      return;
    }

    const dueCount = Object.keys(plan.newDebtDueDates || {}).length;
    const totalNew = plan.newTransactions.length + plan.newBudgets.length + plan.newGoals.length
      + (plan.newCategories || []).length + (plan.newWallets || []).length
      + (plan.newRecurring || []).length + (plan.newAssets || []).length + dueCount
      + (plan.newTransfers || []).length + (plan.newEntities || []).length;
    // §2: BATALKAN restore bila ada transaksi/transfer yang dompetnya
    // tidak dapat dipetakan — jangan alihkan diam-diam ke dompet lain.
    const unmappedTx = plan.unmappedTransactions || [];
    const unmappedTr = plan.unmappedTransfers || [];
    if (unmappedTx.length || unmappedTr.length) {
      const walletNames = [...new Set([
        ...unmappedTx.map((t) => t.oldWalletName),
        ...unmappedTr.map((t) => t.missingWalletName)
      ].filter(Boolean))];
      const detail = unmappedTx.slice(0, 5).map((t) =>
        `${t.tanggal} · ${t.kategori} · ${t.nominal}`
      ).join('<br>');
      Swal.fire({
        icon: 'error',
        title: 'Restore Dibatalkan — Dompet Tidak Ditemukan',
        html: `<div class="text-left text-xs space-y-2"><p>Backup merujuk dompet yang tidak ada di akun ini dan tidak ada di dalam backup: <strong>${walletNames.map((n) => escapeHtmlJS(n)).join(', ')}</strong>.</p><p>${unmappedTx.length} transaksi dan ${unmappedTr.length} transfer terdampak.</p>${detail ? `<p>${detail}</p>` : ''}<p>Pulihkan dompet tersebut dulu (atau tambahkan ke backup), lalu coba lagi. Tidak ada data yang diubah.</p></div>`,
        customClass: { popup: getSwalClass() }
      });
      return;
    }
    if (totalNew === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Semua Data Sudah Tersimpan',
        text: `Tidak ada data baru untuk ditambahkan (${plan.skippedTransactions} transaksi, ${plan.skippedBudgets} budget, ${plan.skippedGoals} target, ${(plan.skippedWallets || 0)} dompet, ${(plan.skippedAssets || 0)} aset sudah ada).`,
        customClass: { popup: getSwalClass() }
      });
      return;
    }

    const confirmRes = await Swal.fire({
      icon: 'question',
      title: 'Konfirmasi Restore & Merge JSON',
      html: buildRestoreSummaryHtml(plan),
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
        text: `${totalNew} entri baru berhasil dipulihkan dan digabung ke akun Anda.`,
        customClass: { popup: getSwalClass() }
      });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
      else Swal.fire({ icon: 'error', title: 'Gagal Restore', text: (typeof toUserErrorMessage === 'function' ? toUserErrorMessage(err) : 'Terjadi kesalahan. Coba lagi.'), customClass: { popup: getSwalClass() } });
    }
  }

  function buildStatementHtml(st, fmtFn, forPrint) {
    const printAccent = (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim() : '') || '#4f46e5';
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
            <span style="${forPrint ? `font-size:10px;font-weight:700;padding:3px 8px;border:1px solid ${printAccent};border-radius:999px;color:${printAccent};text-transform:uppercase;` : ''}" class="${forPrint ? '' : 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand/10 text-brand dark:text-brand-ink uppercase'}">1-Page Statement</span>
          </div>
          <p style="${forPrint ? 'margin:4px 0 0;font-size:12px;color:#475569;' : ''}" class="${forPrint ? '' : 'text-xs text-slate-500 dark:text-slate-400 mt-0.5'}">Pengguna: <strong>${escapeHtmlJS(sessionUser || 'User')}</strong> · Siklus: <strong>${escapeHtmlJS(st.period)}</strong> (${escapeHtmlJS(dateRangeLabel)})</p>
        </div>
        <div style="${forPrint ? 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;' : ''}" class="${forPrint ? '' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}">
          <div class="${cardClass}" style="${cardStyle}">
            <span style="${forPrint ? 'font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-xs font-bold uppercase tracking-wider text-slate-500'}">Kekayaan Bersih (Net Worth)</span>
            <p style="${forPrint ? 'margin:4px 0 8px;font-size:18px;font-weight:900;color:#0f172a;' : ''}" class="${forPrint ? '' : 'text-lg font-black text-slate-900 dark:text-white mt-0.5'}">${fmtFn(st.netWorth)}</p>
            <div style="${forPrint ? 'font-size:11px;color:#334155;' : ''}" class="${forPrint ? '' : 'text-xs text-slate-500 dark:text-slate-400 mt-1 space-y-0.5'}">
              <div style="display:flex;justify-content:space-between;"><span>Kas Dompet:</span> <strong>${fmtFn(st.walletsTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Investasi/Aset:</span> <strong>${fmtFn(st.assetsTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Piutang:</span> <strong>${fmtFn(st.piutangTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Utang:</span> <strong style="color:#e11d48;">-${fmtFn(st.utangTotal)}</strong></div>
            </div>
          </div>
          <div class="${cardClass}" style="${cardStyle}">
            <span style="${forPrint ? 'font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-xs font-bold uppercase tracking-wider text-slate-500'}">Arus Kas Siklus Berjalan</span>
            <p style="${forPrint ? `margin:4px 0 8px;font-size:18px;font-weight:900;color:${st.netCashflow >= 0 ? '#059669' : '#e11d48'};` : ''}" class="${forPrint ? '' : `text-lg font-black ${st.netCashflow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} mt-0.5`}">${st.netCashflow >= 0 ? '+' : ''}${fmtFn(st.netCashflow)}</p>
            <div style="${forPrint ? 'font-size:11px;color:#334155;' : ''}" class="${forPrint ? '' : 'text-xs text-slate-500 dark:text-slate-400 mt-1 space-y-0.5'}">
              <div style="display:flex;justify-content:space-between;"><span>Pemasukan:</span> <strong style="color:#059669;">${fmtFn(st.incomeTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Pengeluaran:</span> <strong style="color:#e11d48;">${fmtFn(st.expenseTotal)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Savings Rate:</span> <strong>${st.savingsRate}%</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Biaya Rutin (Fixed):</span> <strong>${st.fixedCostRatioPct}%</strong></div>
            </div>
          </div>
        </div>
        <div class="${cardClass}" style="${forPrint ? cardStyle + 'margin-bottom:12px;' : ''}">
          <span style="${forPrint ? 'display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:6px;' : ''}" class="${forPrint ? '' : 'text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 block'}">Metrik Kesehatan Finansial</span>
          <div style="${forPrint ? 'display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;' : ''}" class="${forPrint ? '' : 'grid grid-cols-2 gap-2 text-xs'}">
            <div class="${innerCardClass}" style="${innerCardStyle}"><span style="${forPrint ? 'font-size:10px;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-xs text-slate-500'}">Runway Dana Darurat</span><p style="${forPrint ? 'margin:2px 0;font-weight:900;color:#0f172a;' : ''}" class="${forPrint ? '' : 'font-black text-slate-800 dark:text-white mt-0.5'}">${escapeHtmlJS(runwayText)}</p><span style="${forPrint ? `font-size:10px;font-weight:700;color:${printAccent};` : ''}" class="${forPrint ? '' : 'text-xs font-bold text-brand'}">${escapeHtmlJS(st.ratios.runwayStatus)}</span></div>
            <div class="${innerCardClass}" style="${innerCardStyle}"><span style="${forPrint ? 'font-size:10px;color:#64748b;' : ''}" class="${forPrint ? '' : 'text-xs text-slate-500'}">Rasio Utang / Aset</span><p style="${forPrint ? 'margin:2px 0;font-weight:900;color:#0f172a;' : ''}" class="${forPrint ? '' : 'font-black text-slate-800 dark:text-white mt-0.5'}">${st.ratios.debtToAssetPct}%</p><span style="${forPrint ? `font-size:10px;font-weight:700;color:${st.ratios.debtToAssetPct <= 30 ? '#059669' : '#d97706'};` : ''}" class="${forPrint ? '' : `text-xs font-bold ${st.ratios.debtToAssetPct <= 30 ? 'text-emerald-600' : 'text-amber-600'}`}">${escapeHtmlJS(st.ratios.debtStatus)}</span></div>
          </div>
        </div>
        <div class="${cardClass}" style="${cardStyle}">
          <span style="${forPrint ? 'display:block;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:6px;' : ''}" class="${forPrint ? '' : 'text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 block'}">Pengeluaran Terbesar Periode Ini</span>
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
    const brandAccent = (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim() : '') || '#4f46e5';
    Swal.fire({
      html: `<div id="printStatementArea">${buildStatementHtml(st, fmtPreview, false)}</div>`,
      width: '540px',
      showCancelButton: true,
      confirmButtonText: 'Cetak / Print',
      cancelButtonText: 'Tutup',
      confirmButtonColor: brandAccent,
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

  Object.assign(root, { exportExcel, safeExcelCell, exportBackupJson, triggerRestoreJson, handleRestoreJsonFile, openFinancialStatementModal, encryptBackupPayload, decryptBackupPayload, resolveRestoredWalletId, buildRestoreRpcPayload, BACKUP_PBKDF2_ITERATIONS, BACKUP_MIN_PASSWORD_LENGTH });
})(typeof window !== 'undefined' ? window : globalThis);
