// @depends-on: error-messages.js
/* supabase-planning.js — goals, budgets & recurring schedules */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, num, ymd, fetchAll, fetchCategoriesOnly, fetchBudgetsOnly, fetchRecurringOnly, goalFromRow, createConflictError, loadVersionedRow, resolveExpectedVersion } = core;

  // Kolom versi yang dibaca bersama baris (untuk konflik + fetch-first).
  const goalVersionColumns = 'id,name,target_amount,current_amount,target_date,created_at,version';
  const budgetVersionColumns = 'id,kategori,bulan,jumlah,version';
  const recurringVersionColumns = 'id,tipe,kategori,nominal,keterangan,day_of_month,last_run,active,version';

  // `active` boleh boolean (pemanggil UI) atau string 'true'/'false'
  // (bentuk DB dari fetchRecurringOnly / hasil merge konflik) —
  // Boolean('false') === true, jadi normalisasi eksplisit di sini.
  function recurringActiveValue(d) {
    if (d.active === undefined) return true;
    if (typeof d.active === 'string') return d.active.toLowerCase() !== 'false';
    return Boolean(d.active);
  }

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
    // Optimistic locking (Gelombang 7c): update bersyarat versi —
    // pola yang sama dengan api_updateTransaction (lihat
    // supabase-records.js). Insert (tanpa id) tidak butuh cek.
    async api_saveGoal(goal, expectedVersion) {
      const base = (goal && goal.__base && typeof goal.__base === 'object') ? goal.__base : null;
      const row = validateGoalRow(goal);
      if (!goal.id) {
        const { data, error } = await sb.from('financial_goals').insert(row).select(goalVersionColumns).maybeSingle();
        fail(error);
        if (!data) throw new Error('Target tidak ditemukan atau tidak dapat diakses.');
        return { goal: goalFromRow(data) };
      }
      const mine = { id: goal.id, name: row.name, targetAmount: row.target_amount, currentAmount: row.current_amount, targetDate: row.target_date || '' };
      const resolved = await resolveExpectedVersion('financial_goals', goal.id, goalVersionColumns, expectedVersion);
      if (resolved.expected === null) {
        throw createConflictError('goal', {
          operation: 'update', id: goal.id, mine, current: null, base, deletedByOther: true,
          op: 'api_saveGoal', args: [Object.assign({}, goal)]
        });
      }
      const { data, error } = await sb.from('financial_goals').update(row).eq('id', goal.id).eq('version', resolved.expected).select(goalVersionColumns).maybeSingle();
      fail(error);
      if (!data) {
        const current = await loadVersionedRow('financial_goals', goal.id, goalVersionColumns);
        if (!current) {
          throw createConflictError('goal', {
            operation: 'update', id: goal.id, mine, current: null, base, deletedByOther: true,
            op: 'api_saveGoal', args: [Object.assign({}, goal)]
          });
        }
        throw createConflictError('goal', {
          operation: 'update', id: goal.id, mine, current: goalFromRow(current), base, deletedByOther: false,
          op: 'api_saveGoal', args: [Object.assign({}, goal)]
        });
      }
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

    async api_deleteGoal(id, expectedVersion) {
      const resolved = await resolveExpectedVersion('financial_goals', id, goalVersionColumns, expectedVersion);
      if (resolved.expected === null) return { deletedGoalId: id, alreadyDeleted: true };
      const { data, error } = await sb.from('financial_goals').delete().eq('id', id).eq('version', resolved.expected).select('id').maybeSingle();
      fail(error);
      if (!data) {
        const current = await loadVersionedRow('financial_goals', id, goalVersionColumns);
        if (!current) return { deletedGoalId: id, alreadyDeleted: true };
        throw createConflictError('goal', {
          operation: 'delete', id, mine: null, current: goalFromRow(current), base: null, deletedByOther: false,
          op: 'api_deleteGoal', args: [id]
        });
      }
      return { deletedGoalId: data.id };
    },

    // Optimistic locking (Gelombang 7c): upsert PostgREST tidak bisa
    // bersyarat versi (selalu menang) — penegakan lewat RPC
    // save_budget_checked (SELECT ... FOR UPDATE + bandingkan versi di
    // dalam transaksi). expectedVersion: angka / 'force' / undefined
    // (fetch-first dari server; null = baris belum ada → insert).
    async api_saveBudget(kategori, bulan, jumlah, expectedVersion, base) {
      const amount = Number(jumlah);
      if (typeof kategori !== 'string' || !kategori.trim() || typeof bulan !== 'string' ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan) || !Number.isFinite(amount) || amount < 0) {
        throw new Error('Kategori, periode, atau nominal budget tidak valid.');
      }
      const kat = kategori.trim();
      const mine = { kategori: kat, bulan, jumlah: amount };
      let expected = expectedVersion;
      if (expected === 'force' || expected === undefined) {
        const { data: existing, error: existingError } = await sb.from('budgets')
          .select('id,version').eq('kategori', kat).eq('bulan', bulan).maybeSingle();
        fail(existingError);
        expected = existing ? (Number(existing.version) || 1) : null;
      }
      const { data, error } = await sb.rpc('save_budget_checked', {
        p_kategori: kat, p_bulan: bulan, p_jumlah: amount, p_expected_version: expected
      });
      if (error) {
        const msg = String(error.message || '');
        if (/could not find the function|PGRST202|404/i.test(msg)) {
          throw new Error('Fitur anggaran belum tersedia: migrasi save_budget_checked belum diterapkan di server.');
        }
        fail(error);
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('Anggaran tidak mengembalikan data.');
      if (row.conflict) {
        throw createConflictError('budget', {
          operation: 'update', id: row.id, mine,
          current: { id: row.id, kategori: row.kategori, bulan: row.bulan, jumlah: num(row.current_jumlah), version: num(row.current_version) || 1 },
          base: (base && typeof base === 'object') ? base : null, deletedByOther: false,
          op: 'api_saveBudget', args: [kat, bulan, amount]
        });
      }
      return fetchBudgetsOnly();
    },

    async api_deleteBudget(id, expectedVersion) {
      const resolved = await resolveExpectedVersion('budgets', id, budgetVersionColumns, expectedVersion);
      if (resolved.expected === null) return fetchBudgetsOnly();
      const { data, error } = await sb.from('budgets').delete().eq('id', id).eq('version', resolved.expected).select('id').maybeSingle();
      fail(error);
      if (!data) {
        const current = await loadVersionedRow('budgets', id, budgetVersionColumns);
        if (!current) return fetchBudgetsOnly();
        throw createConflictError('budget', {
          operation: 'delete', id, mine: null,
          current: { id: current.id, kategori: current.kategori, bulan: current.bulan, jumlah: num(current.jumlah), version: num(current.version) || 1 },
          base: null, deletedByOther: false,
          op: 'api_deleteBudget', args: [id]
        });
      }
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

    async api_saveRecurring(d, expectedVersion) {
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
        active: recurringActiveValue(d)
      };
      // Optimistic locking (Gelombang 7c): insert tanpa cek; update
      // bersyarat versi (pola yang sama dengan api_saveGoal).
      if (!d.id) {
        const { error } = await sb.from('recurring').insert(row);
        fail(error);
        return fetchRecurringOnly();
      }
      const base = (d.__base && typeof d.__base === 'object') ? d.__base : null;
      const mine = {
        id: d.id, tipe: row.tipe, kategori: row.kategori, nominal: row.nominal,
        keterangan: row.keterangan, dayOfMonth: row.day_of_month, active: row.active
      };
      const resolved = await resolveExpectedVersion('recurring', d.id, recurringVersionColumns, expectedVersion);
      if (resolved.expected === null) {
        throw createConflictError('recurring', {
          operation: 'update', id: d.id, mine, current: null, base, deletedByOther: true,
          op: 'api_saveRecurring', args: [Object.assign({}, d)]
        });
      }
      const { data, error } = await sb.from('recurring').update(row).eq('id', d.id).eq('version', resolved.expected).select('id').maybeSingle();
      fail(error);
      if (!data) {
        const current = await loadVersionedRow('recurring', d.id, recurringVersionColumns);
        if (!current) {
          throw createConflictError('recurring', {
            operation: 'update', id: d.id, mine, current: null, base, deletedByOther: true,
            op: 'api_saveRecurring', args: [Object.assign({}, d)]
          });
        }
        throw createConflictError('recurring', {
          operation: 'update', id: d.id, mine,
          current: {
            id: current.id, tipe: current.tipe, kategori: current.kategori, nominal: num(current.nominal),
            keterangan: current.keterangan || '', dayOfMonth: current.day_of_month,
            lastRun: current.last_run || '', active: String(current.active),
            version: num(current.version) || 1
          },
          base, deletedByOther: false,
          op: 'api_saveRecurring', args: [Object.assign({}, d)]
        });
      }
      return fetchRecurringOnly();
    },

    // Toggle satu-field sistem: update bersyarat versi + SATU kali
    // retry otomatis dengan versi segar (tidak memakai dialog konflik
    // — toggle tidak punya "versi saya" yang perlu dipilih pengguna).
    async api_toggleRecurring(id, active) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await loadVersionedRow('recurring', id, 'id,version');
        if (!current) throw new Error('Jadwal rutin tidak ditemukan.');
        const { data, error } = await sb.from('recurring').update({ active: Boolean(active) })
          .eq('id', id).eq('version', Number(current.version) || 1).select('id').maybeSingle();
        fail(error);
        if (data) return fetchRecurringOnly();
        // 0 baris: versi bergerak di antara baca dan tulis — coba
        // sekali lagi dengan versi segar.
      }
      throw new Error('Jadwal rutin sudah berubah. Coba lagi.');
    },

    async api_deleteRecurring(id, expectedVersion) {
      const resolved = await resolveExpectedVersion('recurring', id, recurringVersionColumns, expectedVersion);
      if (resolved.expected === null) return fetchRecurringOnly();
      const { data, error } = await sb.from('recurring').delete().eq('id', id).eq('version', resolved.expected).select('id').maybeSingle();
      fail(error);
      if (!data) {
        const current = await loadVersionedRow('recurring', id, recurringVersionColumns);
        if (!current) return fetchRecurringOnly();
        throw createConflictError('recurring', {
          operation: 'delete', id, mine: null,
          current: {
            id: current.id, tipe: current.tipe, kategori: current.kategori, nominal: num(current.nominal),
            keterangan: current.keterangan || '', dayOfMonth: current.day_of_month,
            lastRun: current.last_run || '', active: String(current.active),
            version: num(current.version) || 1
          },
          base: null, deletedByOther: false,
          op: 'api_deleteRecurring', args: [id]
        });
      }
      return fetchRecurringOnly();
    },

    async api_markRecurringRun(ids, dateStr) {
      const cleanIds = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '').trim()).filter(Boolean);
      const runDate = String(dateStr || ymd(new Date())).slice(0, 10);
      if (!cleanIds.length || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return fetchRecurringOnly();
      // Penanda jalan sistem per baris: update bersyarat versi + satu
      // retry otomatis (pola toggle di atas). Baris yang sudah dihapus
      // dilewati — jangan gagalkan seluruh run karenanya.
      for (const rid of cleanIds) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await loadVersionedRow('recurring', rid, 'id,version');
          if (!current) break;
          const { data, error } = await sb.from('recurring').update({ last_run: runDate })
            .eq('id', rid).eq('version', Number(current.version) || 1).select('id').maybeSingle();
          fail(error);
          if (data) break;
        }
      }
      return fetchRecurringOnly();
    }
  });
})();
