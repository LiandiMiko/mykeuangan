// @depends-on: error-messages.js
/* supabase-planning.js — goals, budgets & recurring schedules */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, num, ymd, fetchAll, fetchCategoriesOnly, fetchBudgetsOnly, fetchRecurringOnly, goalFromRow } = core;

  function validateGoalRow(goal) {
    if (!goal || typeof goal !== 'object') throw new Error('Data target keuangan tidak valid.');
    const name = typeof goal.name === 'string' ? goal.name.trim() : '';
    const targetAmount = Number(goal.targetAmount);
    const currentAmount = Number(goal.currentAmount);
    const targetDate = String(goal.targetDate || '');
    if (!name || name.length > 80) throw new Error('Nama target harus berisi 1 sampai 80 karakter.');
    if (!Number.isFinite(targetAmount) || targetAmount <= 0 || targetAmount > 999999999999.99) {
      throw new Error('Nominal target harus lebih dari 0 dan tidak melebihi Rp 999.999.999.999,99.');
    }
    if (!Number.isFinite(currentAmount) || currentAmount < 0 || currentAmount > 999999999999.99) {
      throw new Error('Progres target tidak valid.');
    }
    if (targetDate) {
      // Gelombang 5.3 (Q10): validasi via isValidIsoDate() bersama
      // (komponen lokal) — BUKAN round-trip toISOString() (UTC).
      if (!isValidIsoDate(targetDate)) {
        throw new Error('Tanggal target tidak valid.');
      }
    }
    return { name, target_amount: targetAmount, current_amount: currentAmount, target_date: targetDate || null };
  }

  Object.assign(core.handlers, {
    async api_saveGoal(goal) {
      const row = validateGoalRow(goal);
      const query = goal.id ? sb.from('financial_goals').update(row).eq('id', goal.id) : sb.from('financial_goals').insert(row);
      const { data, error } = await query.select('id,name,target_amount,current_amount,target_date,created_at').maybeSingle();
      fail(error);
      if (!data) throw new Error('Target tidak ditemukan atau tidak dapat diakses.');
      return { goal: goalFromRow(data) };
    },

    async api_contributeGoal(d) {
      if (!d || typeof d !== 'object' || !d.goalId) throw new Error('Target keuangan tidak valid.');
      const amount = Number(d.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Nominal alokasi harus lebih dari nol.');
      const date = String(d.tanggal || ymd(new Date())).slice(0, 10);
      const { data, error } = await sb.rpc('contribute_to_goal', {
        p_goal_id: d.goalId, p_amount: amount, p_wallet_id: d.walletId || null, p_date: date
      });
      fail(error);
      const payload = { goal: data && data.goal };
      if (data && data.transaction) {
        payload.transaction = data.transaction;
        payload.categories = (await fetchCategoriesOnly()).categories;
      }
      return payload;
    },

    async api_deleteGoal(id) {
      const { data, error } = await sb.from('financial_goals').delete().eq('id', id).select('id').maybeSingle();
      fail(error);
      if (!data) throw new Error('Target tidak ditemukan atau tidak dapat diakses.');
      return { deletedGoalId: data.id };
    },

    async api_saveBudget(kategori, bulan, jumlah) {
      const amount = Number(jumlah);
      if (typeof kategori !== 'string' || !kategori.trim() || typeof bulan !== 'string' ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan) || !Number.isFinite(amount) || amount < 0) {
        throw new Error('Kategori, periode, atau nominal budget tidak valid.');
      }
      const { error } = await sb.from('budgets').upsert(
        { kategori: kategori.trim(), bulan, jumlah: amount },
        { onConflict: 'user_id,kategori,bulan' }
      );
      fail(error);
      return fetchBudgetsOnly();
    },

    async api_deleteBudget(id) {
      const { error } = await sb.from('budgets').delete().eq('id', id);
      fail(error);
      return fetchBudgetsOnly();
    },

    async api_copyBudget(fromBulan, toBulan) {
      const fB = String(fromBulan || '').slice(0, 7);
      const tB = String(toBulan || '').slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fB) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(tB) || fB === tB) {
        throw new Error('Periode budget tidak valid.');
      }
      const all = await fetchAll('budgets', 'kategori,bulan,jumlah', ['kategori']);
      const normCat = (v) => String(v || '').trim().toLocaleLowerCase();
      const have = new Set(all.filter((b) => b.bulan === tB).map((b) => normCat(b.kategori)));
      const rows = all.filter((b) => b.bulan === fB && !have.has(normCat(b.kategori)))
        .map((b) => ({ kategori: String(b.kategori || '').trim(), bulan: tB, jumlah: num(b.jumlah) }));
      if (rows.length) {
        const { error } = await sb.from('budgets').insert(rows);
        fail(error);
      }
      return fetchBudgetsOnly();
    },

    async api_saveRecurring(d) {
      if (!d || typeof d !== 'object') throw new Error('Data jadwal rutin tidak valid.');
      const tipe = String(d.tipe || '');
      const kategori = String(d.kategori || '').trim();
      const nominal = Number(d.nominal);
      const dayOfMonth = Math.trunc(Number(d.dayOfMonth));
      if (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') throw new Error('Tipe transaksi rutin tidak valid.');
      if (!kategori) throw new Error('Kategori transaksi rutin wajib diisi.');
      if (!Number.isFinite(nominal) || nominal <= 0) throw new Error('Nominal harus lebih dari 0.');
      if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new Error('Tanggal eksekusi bulanan harus antara 1 dan 31.');
      }
      const row = {
        tipe, kategori, nominal,
        keterangan: String(d.keterangan || '').trim(),
        day_of_month: dayOfMonth,
        active: d.active === undefined ? true : Boolean(d.active)
      };
      const query = d.id ? sb.from('recurring').update(row).eq('id', d.id) : sb.from('recurring').insert(row);
      const { error } = await query;
      fail(error);
      return fetchRecurringOnly();
    },

    async api_toggleRecurring(id, active) {
      const { error } = await sb.from('recurring').update({ active: Boolean(active) }).eq('id', id);
      fail(error);
      return fetchRecurringOnly();
    },

    async api_deleteRecurring(id) {
      const { error } = await sb.from('recurring').delete().eq('id', id);
      fail(error);
      return fetchRecurringOnly();
    },

    async api_markRecurringRun(ids, dateStr) {
      const cleanIds = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '').trim()).filter(Boolean);
      const runDate = String(dateStr || ymd(new Date())).slice(0, 10);
      if (!cleanIds.length || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return fetchRecurringOnly();
      const { error } = await sb.from('recurring').update({ last_run: runDate }).in('id', cleanIds);
      fail(error);
      return fetchRecurringOnly();
    }
  });
})();
