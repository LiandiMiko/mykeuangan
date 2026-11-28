// @depends-on: finance-analysis-core.js
(function (root) {
  'use strict';

  const core = (typeof module !== 'undefined' && module.exports)
    ? require('./finance-analysis-core.js')
    : root.FinanceAnalysisCore;

  const MAX_NOMINAL = 999999999999.99;

  // Nama dompet untuk sebuah id dompet lama (dari backup) atau id dompet
  // yang sudah ada di akun. '' = tidak dapat dipetakan.
  function resolveBackupWalletName(oldWalletId, walletNameByOldId, existingWallets) {
    if (!oldWalletId) return '';
    const id = String(oldWalletId);
    const mapped = walletNameByOldId ? String(walletNameByOldId[id] || '').trim() : '';
    if (mapped) return mapped;
    const existing = (Array.isArray(existingWallets) ? existingWallets : [])
      .find((w) => String(w.id) === id);
    return existing ? String(existing.name || '').trim() : '';
  }

  function filterNewBackupTransactions(rawTx, existingTxList, walletNameByOldId, existingWallets) {
    // Dedup UTAMA berdasarkan id stabil (id/legacy_id dari ekspor).
    // Dulu hanya ada signature kasar tanggal|tipe|kategori|nominal|
    // keterangan — kopi identik harian yang sah dianggap duplikat.
    // Signature lengkap (termasuk nama dompet hasil resolusi) hanya
    // fallback untuk baris tanpa id. Sisa risiko: dua pembelian yang
    // benar-benar identik (hari, dompet, nominal, catatan sama) tanpa
    // id tetap bisa bertabrakan — jalur berbasis id yang menutupnya.
    const walletNameOf = (walletId) => resolveBackupWalletName(walletId, walletNameByOldId, existingWallets);
    const txSig = (t) => `${String(t.tanggal || '').slice(0, 10)}|${String(t.tipe || '').trim()}|${String(t.kategori || '').trim().toLowerCase()}|${Math.round(Number(t.nominal) || 0)}|${String(t.keterangan || '').trim().toLowerCase()}|${String(t.walletName || t.walletId || '').trim().toLowerCase()}`;
    const seenIds = new Set((existingTxList || []).map((t) => String(t.id || t.legacyId || '')).filter(Boolean));
    const seen = new Set((existingTxList || []).map((t) => txSig({
      ...t,
      walletName: t.walletName || walletNameOf(t.walletId)
    })));
    const added = [];
    let skipped = 0;

    (rawTx || []).forEach((t) => {
      if (!t || typeof t !== 'object') { skipped += 1; return; }
      const tanggal = String(t.tanggal || '').slice(0, 10);
      const tipe = String(t.tipe || '').trim();
      const kategori = String(t.kategori || '').trim();
      const nominal = Number(t.nominal);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') || !kategori || !Number.isFinite(nominal) || nominal <= 0 || nominal > MAX_NOMINAL) {
        skipped += 1;
        return;
      }
      const stableId = String(t.id || t.legacyId || t.legacy_id || '').trim();
      if (stableId && seenIds.has(stableId)) { skipped += 1; return; }
      const item = {
        id: stableId, legacyId: stableId,
        tanggal, tipe, kategori, nominal,
        keterangan: String(t.keterangan || '').trim(),
        walletId: t.walletId ? String(t.walletId) : '',
        walletName: walletNameOf(t.walletId)
      };
      // Signature hanya untuk baris TANPA id stabil: dua kopi identik
      // dengan id berbeda adalah dua pembelian sah dan keduanya masuk.
      if (!stableId) {
        const sig = txSig(item);
        if (seen.has(sig)) { skipped += 1; return; }
        seen.add(sig);
      } else {
        seenIds.add(stableId);
      }
      added.push(item);
    });
    return { added, skipped };
  }

  function filterNewBackupTransfers(rawTransfers, existingTransfers, walletNameByOldId, existingWallets) {
    // Koleksi ke-9 yang dulu hilang dari restore (§1): transfer antar
    // dompet tidak pernah dibaca dari backup. Validasi tanggal/jenis/
    // nominal/biaya; dompet dipetakan BERDASARKAN NAMA (id lama tidak
    // berlaku lintas akun). Transfer yang dompetnya tak dapat dipetakan
    // masuk `unmapped` — pemanggil harus membatalkan restore (§2),
    // bukan mengalihkannya diam-diam ke dompet pertama.
    const walletNameOf = (walletId) => resolveBackupWalletName(walletId, walletNameByOldId, existingWallets);
    const nameOfExisting = (walletId) => {
      const w = (Array.isArray(existingWallets) ? existingWallets : []).find((x) => String(x.id) === String(walletId || ''));
      return w ? String(w.name || '').trim() : String(walletId || '');
    };
    const trSig = (t) => `${String(t.tanggal || '').slice(0, 10)}|${String(t.kind || 'transfer')}|${String(t.fromWalletName || '').trim().toLowerCase()}|${String(t.toWalletName || '').trim().toLowerCase()}|${Math.round(Number(t.nominal) || 0)}|${Math.round(Number(t.fee) || 0)}|${String(t.keterangan || '').trim().toLowerCase()}`;
    const seenIds = new Set((existingTransfers || []).map((t) => String(t.id || t.legacyId || '')).filter(Boolean));
    const seen = new Set((existingTransfers || []).map((t) => trSig({
      ...t,
      fromWalletName: t.fromWalletName || nameOfExisting(t.fromWallet),
      toWalletName: t.toWalletName || nameOfExisting(t.toWallet)
    })));
    const added = [];
    const unmapped = [];
    let skipped = 0;
    (Array.isArray(rawTransfers) ? rawTransfers : []).forEach((x) => {
      if (!x || typeof x !== 'object') { skipped += 1; return; }
      const tanggal = String(x.tanggal || '').slice(0, 10);
      const kind = String(x.kind || 'transfer').trim();
      const nominal = Number(x.nominal);
      const fee = Number(x.fee) || 0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)
        || !['transfer', 'tarik_tunai', 'investasi'].includes(kind)
        || !Number.isFinite(nominal) || nominal <= 0 || nominal > MAX_NOMINAL
        || !Number.isFinite(fee) || fee < 0 || fee > MAX_NOMINAL) {
        skipped += 1;
        return;
      }
      const stableId = String(x.id || x.legacyId || x.legacy_id || '').trim();
      if (stableId && seenIds.has(stableId)) { skipped += 1; return; }
      const fromWalletName = walletNameOf(x.fromWallet);
      const toWalletName = kind === 'investasi' ? '' : walletNameOf(x.toWallet);
      if (!fromWalletName || (kind !== 'investasi' && !toWalletName)) {
        unmapped.push({
          tanggal, kind, nominal, fee,
          keterangan: String(x.keterangan || '').trim(),
          missingWalletName: !fromWalletName
            ? (x.fromWallet ? String(walletNameByOldId && walletNameByOldId[String(x.fromWallet)] || 'dompet tidak dikenal') : 'dompet asal kosong')
            : String(walletNameByOldId && walletNameByOldId[String(x.toWallet)] || 'dompet tidak dikenal')
        });
        skipped += 1;
        return;
      }
      if (fromWalletName.toLowerCase() === toWalletName.toLowerCase() && kind !== 'investasi') { skipped += 1; return; }
      const item = {
        id: stableId, legacyId: stableId, tanggal, kind, nominal, fee,
        keterangan: String(x.keterangan || '').trim(),
        fromWallet: x.fromWallet ? String(x.fromWallet) : '',
        toWallet: x.toWallet ? String(x.toWallet) : '',
        fromWalletName, toWalletName
      };
      if (!stableId) {
        const sig = trSig(item);
        if (seen.has(sig)) { skipped += 1; return; }
        seen.add(sig);
      } else {
        seenIds.add(stableId);
      }
      added.push(item);
    });
    return { added, skipped, unmapped };
  }

  function filterNewBackupEntities(rawEntities, existingEntities) {
    // Koleksi ke-10 yang dulu hilang dari restore (§1): registry
    // utang/piutang. Backup mengekspornya sebagai objek
    // {UtangApp:[...], UtangPerson:[...], Piutang:[...]}; bentuk
    // array [{grp,name}] juga diterima.
    const VALID_GROUPS = ['UtangApp', 'UtangPerson', 'Piutang'];
    const existing = existingEntities && typeof existingEntities === 'object' ? existingEntities : {};
    const seen = {};
    VALID_GROUPS.forEach((g) => {
      seen[g] = new Set((Array.isArray(existing[g]) ? existing[g] : []).map((n) => String(n || '').trim().toLowerCase()));
    });
    const rawList = [];
    if (Array.isArray(rawEntities)) {
      rawEntities.forEach((e) => { if (e && typeof e === 'object') rawList.push(e); });
    } else if (rawEntities && typeof rawEntities === 'object') {
      VALID_GROUPS.forEach((g) => {
        (Array.isArray(rawEntities[g]) ? rawEntities[g] : []).forEach((name) => rawList.push({ grp: g, name }));
      });
    }
    const added = [];
    let skipped = 0;
    rawList.forEach((e) => {
      const grp = String(e.grp || e.group || '').trim();
      const name = String(e.name || '').trim().slice(0, 80);
      if (!VALID_GROUPS.includes(grp) || !name) { skipped += 1; return; }
      const key = name.toLowerCase();
      if (seen[grp].has(key)) { skipped += 1; return; }
      seen[grp].add(key);
      added.push({ grp, name });
    });
    return { added, skipped };
  }

  function filterNewBackupBudgets(rawBudgets, existingBudgets) {
    const budgetSig = (b) => `${String(b.bulan || '').slice(0, 7)}|${String(b.kategori || '').trim().toLowerCase()}`;
    const seen = new Set((Array.isArray(existingBudgets) ? existingBudgets : []).map(budgetSig));
    const added = [];
    let skipped = 0;

    (rawBudgets || []).forEach((b) => {
      if (!b || typeof b !== 'object') { skipped += 1; return; }
      const bulan = String(b.bulan || '').slice(0, 7);
      const kategori = String(b.kategori || '').trim();
      const jumlah = Number(b.jumlah);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan) || !kategori || !Number.isFinite(jumlah) || jumlah < 0) {
        skipped += 1;
        return;
      }
      const item = { bulan, kategori, jumlah };
      const sig = budgetSig(item);
      if (seen.has(sig)) { skipped += 1; return; }
      seen.add(sig);
      added.push(item);
    });
    return { added, skipped };
  }

  function filterNewBackupGoals(rawGoals, existingGoals) {
    const goalSig = (g) => `${String(g.name || '').trim().toLowerCase()}|${Math.round(Number(g.targetAmount) || 0)}`;
    const seen = new Set((Array.isArray(existingGoals) ? existingGoals : []).map(goalSig));
    const added = [];
    let skipped = 0;

    (rawGoals || []).forEach((g) => {
      if (!g || typeof g !== 'object') { skipped += 1; return; }
      const name = String(g.name || '').trim();
      const targetAmount = Number(g.targetAmount);
      const currentAmount = Number(g.currentAmount) || 0;
      const targetDate = String(g.targetDate || '').slice(0, 10);
      if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0) { skipped += 1; return; }
      const item = { name: name.slice(0, 80), targetAmount, currentAmount: Math.max(0, currentAmount), targetDate: /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : '' };
      const sig = goalSig(item);
      if (seen.has(sig)) { skipped += 1; return; }
      seen.add(sig);
      added.push(item);
    });
    return { added, skipped };
  }

  function filterNewBackupCategories(rawCategories, existingCategories) {
    if (!rawCategories || typeof rawCategories !== 'object' || Array.isArray(rawCategories)) return { added: [], skipped: 0 };
    const existing = existingCategories && typeof existingCategories === 'object' ? existingCategories : {};
    const added = [];
    let skipped = 0;
    const processSide = (tipe, rawList, existingList) => {
      const seen = new Set((Array.isArray(existingList) ? existingList : []).map((n) => String(n || '').trim().toLowerCase()));
      (Array.isArray(rawList) ? rawList : []).forEach((rawName) => {
        const name = String(rawName || '').trim().slice(0, 60);
        if (!name || name === 'Saldo Awal' || name === 'Mutasi') { skipped += 1; return; }
        const key = name.toLowerCase();
        if (seen.has(key)) { skipped += 1; return; }
        seen.add(key);
        added.push({ tipe, name });
      });
    };
    processSide('Pemasukan', rawCategories.pemasukan, existing.pemasukan);
    processSide('Pengeluaran', rawCategories.pengeluaran, existing.pengeluaran);
    return { added, skipped };
  }

  function filterNewBackupWallets(rawWallets, existingWallets) {
    const seen = new Set((Array.isArray(existingWallets) ? existingWallets : []).map((w) => String(w.name || '').trim().toLowerCase()));
    const walletNameByOldId = {};
    const added = [];
    let skipped = 0;
    (Array.isArray(rawWallets) ? rawWallets : []).forEach((w) => {
      if (!w || typeof w !== 'object') { skipped += 1; return; }
      const name = String(w.name || '').trim().slice(0, 80);
      if (!name) { skipped += 1; return; }
      if (w.id) walletNameByOldId[String(w.id)] = name;
      const key = name.toLowerCase();
      if (seen.has(key)) { skipped += 1; return; }
      seen.add(key);
      const rawKind = String(w.kind || '').toLowerCase();
      const kind = ['bank', 'cash', 'ewallet'].includes(rawKind) ? rawKind : 'bank';
      const openingBalance = Math.max(0, Number(w.openingBalance ?? w.opening_balance) || 0);
      added.push({ name, kind, openingBalance });
    });
    return { added, skipped, walletNameByOldId };
  }

  function filterNewBackupRecurring(rawRecurring, existingRecurring) {
    const sigFn = (r) => `${String(r.tipe || '').trim()}|${String(r.kategori || '').trim().toLowerCase()}|${Math.round(Number(r.nominal) || 0)}|${Math.trunc(Number(r.dayOfMonth ?? r.day_of_month) || 0)}|${String(r.keterangan || '').trim().toLowerCase()}`;
    const seen = new Set((Array.isArray(existingRecurring) ? existingRecurring : []).map(sigFn));
    const added = [];
    let skipped = 0;
    (Array.isArray(rawRecurring) ? rawRecurring : []).forEach((r) => {
      if (!r || typeof r !== 'object') { skipped += 1; return; }
      const tipe = String(r.tipe || '').trim();
      const kategori = String(r.kategori || '').trim();
      const nominal = Number(r.nominal);
      const dayOfMonth = Math.trunc(Number(r.dayOfMonth ?? r.day_of_month));
      if ((tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') || !kategori || !Number.isFinite(nominal) || nominal <= 0 || !Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        skipped += 1; return;
      }
      const item = { tipe, kategori, nominal, dayOfMonth, keterangan: String(r.keterangan || '').trim(), active: r.active === undefined ? true : Boolean(r.active) };
      const sig = sigFn(item);
      if (seen.has(sig)) { skipped += 1; return; }
      seen.add(sig);
      added.push(item);
    });
    return { added, skipped };
  }

  function filterNewBackupAssets(rawAssets, existingAssets) {
    const VALID_TYPES = ['Crypto', 'Emas', 'USD', 'Saham', 'Cash', 'Other'];
    const sigFn = (a) => `${String(a.type || 'Other').trim().toLowerCase()}|${String(a.name || '').trim().toLowerCase()}|${String(a.symbol || '').trim().toUpperCase()}`;
    const seen = new Set((Array.isArray(existingAssets) ? existingAssets : []).map(sigFn));
    const added = [];
    let skipped = 0;
    (Array.isArray(rawAssets) ? rawAssets : []).forEach((a) => {
      if (!a || typeof a !== 'object') { skipped += 1; return; }
      const name = String(a.name || '').trim().slice(0, 80);
      if (!name) { skipped += 1; return; }
      const type = VALID_TYPES.includes(String(a.type || '')) ? String(a.type) : 'Other';
      const item = {
        name, type,
        symbol: String(a.symbol || '').trim().toUpperCase().slice(0, 16),
        quantity: Math.max(0, Number(a.quantity) || 0),
        buyPrice: Math.max(0, Number(a.buyPrice ?? a.buy_price) || 0),
        value: Math.max(0, Number(a.value) || 0)
      };
      const sig = sigFn(item);
      if (seen.has(sig)) { skipped += 1; return; }
      seen.add(sig);
      added.push(item);
    });
    return { added, skipped };
  }

  function filterNewBackupDebtDueDates(rawDueDates, existingDueDates) {
    if (!rawDueDates || typeof rawDueDates !== 'object' || Array.isArray(rawDueDates)) return { added: {}, skipped: 0 };
    const seen = new Set(Object.keys(existingDueDates && typeof existingDueDates === 'object' ? existingDueDates : {}));
    const added = {};
    let skipped = 0;
    Object.entries(rawDueDates).forEach(([rawKey, rawVal]) => {
      const key = String(rawKey || '').trim().slice(0, 120);
      const val = String(rawVal || '').slice(0, 10);
      if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(val) || seen.has(key)) { skipped += 1; return; }
      seen.add(key);
      added[key] = val;
    });
    return { added, skipped };
  }

  function prepareBackupRestorePayload(backupObj, existingData) {
    const empty = {
      valid: false,
      newTransactions: [], skippedTransactions: 0,
      newBudgets: [], skippedBudgets: 0,
      newGoals: [], skippedGoals: 0,
      newCategories: [], skippedCategories: 0,
      newWallets: [], skippedWallets: 0,
      walletNameByOldId: {},
      newRecurring: [], skippedRecurring: 0,
      newAssets: [], skippedAssets: 0,
      newDebtDueDates: {}, skippedDebtDueDates: 0,
      newTransfers: [], skippedTransfers: 0, unmappedTransfers: [],
      newEntities: [], skippedEntities: 0,
      unmappedTransactions: []
    };
    if (!backupObj || typeof backupObj !== 'object') return empty;

    const src = (backupObj.data && typeof backupObj.data === 'object') ? backupObj.data : backupObj;
    const rawTx = Array.isArray(src.transactions) ? src.transactions : (Array.isArray(src.transaksi) ? src.transaksi : null);
    const rawBudgets = Array.isArray(src.budgets) ? src.budgets : null;
    const rawGoals = Array.isArray(src.goals) ? src.goals : null;
    const rawCategories = (src.categories && typeof src.categories === 'object' && !Array.isArray(src.categories)) ? src.categories : null;
    const rawWallets = Array.isArray(src.wallets) ? src.wallets : null;
    const rawRecurring = Array.isArray(src.recurring) ? src.recurring : null;
    const rawAssets = Array.isArray(src.assets) ? src.assets : null;
    const rawDueDates = (src.debtDueDates && typeof src.debtDueDates === 'object' && !Array.isArray(src.debtDueDates)) ? src.debtDueDates : null;
    const rawTransfers = Array.isArray(src.transfers) ? src.transfers : null;
    const rawEntities = src.entities ? src.entities : null;
    if (!rawTx && !rawBudgets && !rawGoals && !rawCategories && !rawWallets && !rawRecurring && !rawAssets && !rawDueDates && !rawTransfers && !rawEntities) return empty;

    const existing = existingData && typeof existingData === 'object' ? existingData : {};
    const existingTxList = Array.isArray(existing.transactions)
      ? existing.transactions
      : (Array.isArray(existing.transaksi) ? existing.transaksi : []);
    const existingWallets = Array.isArray(existing.wallets) ? existing.wallets : [];
    const existingTransfers = Array.isArray(existing.transfers) ? existing.transfers : [];
    // Dompet dulu: pemetaannya dibutuhkan transaksi & transfer (§2).
    const walletRes = filterNewBackupWallets(rawWallets, existingWallets);
    const txRes = filterNewBackupTransactions(rawTx, existingTxList, walletRes.walletNameByOldId, existingWallets);
    const budgetRes = filterNewBackupBudgets(rawBudgets, existing.budgets);
    const goalRes = filterNewBackupGoals(rawGoals, existing.goals);
    const catRes = filterNewBackupCategories(rawCategories, existing.categories);
    const recRes = filterNewBackupRecurring(rawRecurring, existing.recurring);
    const assetRes = filterNewBackupAssets(rawAssets, existing.assets);
    const dueRes = filterNewBackupDebtDueDates(rawDueDates, existing.debtDueDates);
    const transferRes = filterNewBackupTransfers(rawTransfers, existingTransfers, walletRes.walletNameByOldId, existingWallets);
    const entityRes = filterNewBackupEntities(rawEntities, existing.entities);
    // Transaksi yang dompetnya tidak dapat dipetakan: restore harus
    // DIBATALKAN (§2) — jangan alihkan diam-diam ke dompet pertama.
    // Nama dompet lama yang hilang dicatat untuk ditampilkan ke user.
    const unmappedTransactions = txRes.added
      .filter((t) => t.walletId && !t.walletName)
      .map((t) => ({
        tanggal: t.tanggal, kategori: t.kategori, nominal: t.nominal,
        oldWalletName: String(walletRes.walletNameByOldId[String(t.walletId)] || t.walletId)
      }));
    const mappedTransactions = txRes.added.filter((t) => !t.walletId || t.walletName);

    return {
      valid: true,
      newTransactions: mappedTransactions, skippedTransactions: txRes.skipped + unmappedTransactions.length,
      newBudgets: budgetRes.added, skippedBudgets: budgetRes.skipped,
      newGoals: goalRes.added, skippedGoals: goalRes.skipped,
      newCategories: catRes.added, skippedCategories: catRes.skipped,
      newWallets: walletRes.added, skippedWallets: walletRes.skipped,
      walletNameByOldId: walletRes.walletNameByOldId,
      newRecurring: recRes.added, skippedRecurring: recRes.skipped,
      newAssets: assetRes.added, skippedAssets: assetRes.skipped,
      newDebtDueDates: dueRes.added, skippedDebtDueDates: dueRes.skipped,
      newTransfers: transferRes.added, skippedTransfers: transferRes.skipped,
      unmappedTransfers: transferRes.unmapped,
      newEntities: entityRes.added, skippedEntities: entityRes.skipped,
      unmappedTransactions
    };
  }

  function projectGoalMilestone(currentAmount, targetAmount, targetDate, monthlySavingOverride, avgMonthlySavings, todayStr) {
    const cur = Math.max(0, Number(currentAmount) || 0);
    const target = Number(targetAmount);
    if (!Number.isFinite(target) || target <= 0) {
      return { status: 'invalid', remaining: 0, projectedMonths: 0, projectedDate: '', label: 'Target tidak valid' };
    }
    const remaining = Math.max(0, target - cur);
    if (remaining <= 0) {
      return { status: 'completed', remaining: 0, projectedMonths: 0, projectedDate: '', label: 'Target sudah tercapai!' };
    }

    const todayDate = todayStr ? new Date(todayStr + 'T00:00:00Z') : new Date();
    const savingRate = Math.max(0, Number(monthlySavingOverride) || 0) || Math.max(0, Number(avgMonthlySavings) || 0);
    let projectedMonths = null;
    let projectedDate = '';
    if (savingRate > 0) {
      projectedMonths = Math.ceil(remaining / savingRate);
      const proj = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + projectedMonths, 1));
      projectedDate = proj.toISOString().slice(0, 7);
    }

    let status = 'in_progress';
    let targetMonthsRemaining = null;
    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      const tDate = new Date(targetDate + 'T00:00:00Z');
      const diffDays = Math.ceil((tDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) status = 'overdue';
      else targetMonthsRemaining = Math.max(1, Math.round(diffDays / 30.4));
    }

    return {
      status,
      remaining: Math.round(remaining),
      percent: Math.min(100, Math.round((cur / target) * 100)),
      projectedMonths,
      projectedDate,
      targetMonthsRemaining,
      savingRate: Math.round(savingRate)
    };
  }

  function resolveDueDateInCycle(rawDay, payDay, startYm, endYm, startDays, endDays) {
    const recDay = Math.max(1, Math.min(31, Math.trunc(Number(rawDay) || 1)));
    if (payDay <= 1) return endYm + '-' + String(Math.min(recDay, endDays)).padStart(2, '0');
    if (recDay >= payDay) return startYm + '-' + String(Math.min(recDay, startDays)).padStart(2, '0');
    return endYm + '-' + String(Math.min(recDay, endDays)).padStart(2, '0');
  }

  function getDueRecurringBills(recurringList, transactions, todayStr, period, payrollDay) {
    const curDateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : core.formatDate(new Date());
    const activePeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || '')) ? String(period) : curDateStr.slice(0, 7);
    const payDay = Number(payrollDay) || 1;
    const range = core.getPeriodRange(activePeriod, payDay);
    const startYm = range.start.slice(0, 7);
    const endYm = range.end.slice(0, 7);
    const startDays = new Date(Date.UTC(Number(startYm.slice(0, 4)), Number(startYm.slice(5, 7)), 0)).getUTCDate();
    const endDays = new Date(Date.UTC(Number(endYm.slice(0, 4)), Number(endYm.slice(5, 7)), 0)).getUTCDate();

    const activeList = (Array.isArray(recurringList) ? recurringList : [])
      .filter((r) => r && String(r.active) !== 'false' && r.active !== false);
    const txList = (Array.isArray(transactions) ? transactions : []).filter((t) =>
      core.isInPeriod(t.tanggal, activePeriod, payDay)
    );

    const dueBills = [];
    let totalDueAmount = 0;

    activeList.forEach((rec) => {
      const recNominal = Math.round(Number(rec.nominal) || 0);
      const recCat = String(rec.kategori || '').trim().toLowerCase();
      const recDay = Math.max(1, Math.min(31, Math.trunc(Number(rec.dayOfMonth ?? rec.day_of_month) || 1)));
      const lastRunDate = String(rec.lastRun ?? rec.last_run ?? '').slice(0, 10);
      const lastRunInPeriod = lastRunDate && core.isInPeriod(lastRunDate, activePeriod, payDay);
      const alreadyTransacted = lastRunInPeriod || txList.some((tx) =>
        tx.tipe === rec.tipe &&
        String(tx.kategori || '').trim().toLowerCase() === recCat &&
        Math.abs((Number(tx.nominal) || 0) - recNominal) <= 1
      );

      const dueDate = resolveDueDateInCycle(recDay, payDay, startYm, endYm, startDays, endDays);
      if (!alreadyTransacted && dueDate >= range.start && dueDate <= range.end && dueDate <= curDateStr) {
        dueBills.push({
          id: rec.id, tipe: rec.tipe, kategori: rec.kategori, nominal: recNominal,
          keterangan: rec.keterangan || '', dayOfMonth: recDay, dueDate
        });
        totalDueAmount += recNominal;
      }
    });

    return { dueBills, count: dueBills.length, totalDueAmount };
  }

  function parseIsoDayMs(isoDate) {
    const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function computeCycleForecast(transactions, budgets, period, payrollDay, todayStr) {
    const activePeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ''))
      ? String(period)
      : core.formatDate(new Date()).slice(0, 7);
    const curDate = /^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ''))
      ? String(todayStr).slice(0, 10)
      : core.formatDate(new Date());
    const range = core.getPeriodRange(activePeriod, payrollDay);
    const summary = core.summarizePeriod(budgets, transactions, activePeriod, payrollDay);
    const dayMs = 86400000;
    const totalDays = Math.max(1, Math.round((parseIsoDayMs(range.end) - parseIsoDayMs(range.start)) / dayMs) + 1);
    const isUpcoming = curDate < range.start;
    const isCompleted = curDate > range.end;
    const isCurrentCycle = !isUpcoming && !isCompleted;
    const elapsedDays = isUpcoming
      ? 0
      : (isCompleted ? totalDays : Math.max(1, Math.round((parseIsoDayMs(curDate) - parseIsoDayMs(range.start)) / dayMs) + 1));
    const remainingDays = Math.max(0, totalDays - elapsedDays);
    const actualExpense = summary.actualTotal;
    const budgetTotal = summary.budgetTotal;
    const dailyBurnRate = elapsedDays > 0 ? Math.round(actualExpense / elapsedDays) : 0;
    const projectedExpense = isCurrentCycle ? Math.round(dailyBurnRate * totalDays) : actualExpense;
    const remainingBudget = budgetTotal > 0 ? budgetTotal - actualExpense : null;
    const dailySafeAllowance = (budgetTotal > 0 && remainingDays > 0)
      ? Math.max(0, Math.floor(remainingBudget / remainingDays))
      : null;
    const projectedVariance = budgetTotal > 0 ? budgetTotal - projectedExpense : null;
    let status = 'active';
    if (isUpcoming) status = 'upcoming';
    else if (isCompleted) status = 'completed';
    else if (budgetTotal > 0) {
      status = projectedExpense > budgetTotal ? 'over' : (projectedExpense >= budgetTotal * 0.85 ? 'warning' : 'safe');
    }

    return {
      period: activePeriod, range, totalDays, elapsedDays, remainingDays, isCurrentCycle,
      actualExpense, budgetTotal, dailyBurnRate, projectedExpense,
      remainingBudget, dailySafeAllowance, projectedVariance, status
    };
  }

  const backupApi = {
    prepareBackupRestorePayload, projectGoalMilestone, getDueRecurringBills, computeCycleForecast,
    filterNewBackupTransactions, filterNewBackupTransfers, filterNewBackupEntities,
    filterNewBackupWallets, resolveBackupWalletName, MAX_NOMINAL
  };
  root.FinanceAnalysisBackup = backupApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = backupApi;
})(typeof window !== 'undefined' ? window : globalThis);
