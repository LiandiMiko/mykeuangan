(function (root) {
  'use strict';

  const core = (typeof module !== 'undefined' && module.exports)
    ? require('./finance-analysis-core.js')
    : root.FinanceAnalysisCore;

  function filterNewBackupTransactions(rawTx, existingTxList) {
    const txSig = (t) => `${String(t.tanggal || '').slice(0, 10)}|${String(t.tipe || '').trim()}|${String(t.kategori || '').trim().toLowerCase()}|${Math.round(Number(t.nominal) || 0)}|${String(t.keterangan || '').trim().toLowerCase()}`;
    const seen = new Set(existingTxList.map(txSig));
    const added = [];
    let skipped = 0;

    (rawTx || []).forEach((t) => {
      if (!t || typeof t !== 'object') { skipped += 1; return; }
      const tanggal = String(t.tanggal || '').slice(0, 10);
      const tipe = String(t.tipe || '').trim();
      const kategori = String(t.kategori || '').trim();
      const nominal = Number(t.nominal);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') || !kategori || !Number.isFinite(nominal) || nominal <= 0) {
        skipped += 1;
        return;
      }
      const item = { tanggal, tipe, kategori, nominal, keterangan: String(t.keterangan || '').trim(), walletId: t.walletId ? String(t.walletId) : '' };
      const sig = txSig(item);
      if (seen.has(sig)) { skipped += 1; return; }
      seen.add(sig);
      added.push(item);
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

  function prepareBackupRestorePayload(backupObj, existingData) {
    const empty = {
      valid: false,
      newTransactions: [], skippedTransactions: 0,
      newBudgets: [], skippedBudgets: 0,
      newGoals: [], skippedGoals: 0
    };
    if (!backupObj || typeof backupObj !== 'object') return empty;

    const src = (backupObj.data && typeof backupObj.data === 'object') ? backupObj.data : backupObj;
    const rawTx = Array.isArray(src.transactions) ? src.transactions : (Array.isArray(src.transaksi) ? src.transaksi : null);
    const rawBudgets = Array.isArray(src.budgets) ? src.budgets : null;
    const rawGoals = Array.isArray(src.goals) ? src.goals : null;
    if (!rawTx && !rawBudgets && !rawGoals) return empty;

    const existing = existingData && typeof existingData === 'object' ? existingData : {};
    const existingTxList = Array.isArray(existing.transactions)
      ? existing.transactions
      : (Array.isArray(existing.transaksi) ? existing.transaksi : []);
    const txRes = filterNewBackupTransactions(rawTx, existingTxList);
    const budgetRes = filterNewBackupBudgets(rawBudgets, existing.budgets);
    const goalRes = filterNewBackupGoals(rawGoals, existing.goals);

    return {
      valid: true,
      newTransactions: txRes.added, skippedTransactions: txRes.skipped,
      newBudgets: budgetRes.added, skippedBudgets: budgetRes.skipped,
      newGoals: goalRes.added, skippedGoals: goalRes.skipped
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
      return { status: 'completed', remaining: 0, projectedMonths: 0, projectedDate: '', label: 'Target sudah tercapai! 🎉' };
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

  const backupApi = { prepareBackupRestorePayload, projectGoalMilestone, getDueRecurringBills };
  root.FinanceAnalysisBackup = backupApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = backupApi;
})(typeof window !== 'undefined' ? window : globalThis);
