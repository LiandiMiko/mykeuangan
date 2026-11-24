/* supabase-records.js — transactions, search, CSV import, categories, entities & period settings */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, num, syncPeriod, trxRow, trxFromRow, fetchCategoriesOnly, fetchEntitiesOnly, fetchBudgetsOnly, fetchRecurringOnly, setSetting } = core;

  const transactionFingerprint = (tx, defaultWalletId) => [
    tx.tanggal,
    tx.tipe,
    String(tx.kategori || '').trim().toLocaleLowerCase(),
    Number(tx.nominal),
    String(tx.keterangan || '').trim().toLocaleLowerCase(),
    tx.walletId || defaultWalletId || ''
  ].join('\u001f');

  async function fetchTransactionsOnDates(dates) {
    const out = [];
    for (let index = 0; index < dates.length; index += 50) {
      const dateChunk = dates.slice(index, index + 50);
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('transactions')
          .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id')
          .in('tanggal', dateChunk)
          .order('tanggal', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + 999);
        fail(error);
        out.push(...data);
        if (data.length < 1000) break;
      }
    }
    return out;
  }

  function validateSearchFilters(filters) {
    const value = filters && typeof filters === 'object' ? filters : {};
    const start = String(value.start || '');
    const end = String(value.end || '');
    const validDate = (date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const parsed = new Date(date + 'T00:00:00Z');
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    };
    if (!validDate(start) || !validDate(end) || start > end) throw new Error('Rentang tanggal laporan tidak valid.');
    const type = String(value.type || '');
    if (type && type !== 'Pemasukan' && type !== 'Pengeluaran') throw new Error('Tipe transaksi laporan tidak valid.');
    return {
      p_start: start,
      p_end: end,
      p_type: type || null,
      p_category: String(value.category || '') || null,
      p_search: String(value.search || '').trim().slice(0, 100),
      p_offset: Math.max(0, Math.min(1000000, Math.trunc(Number(value.offset) || 0))),
      p_limit: Math.max(1, Math.min(100, Math.trunc(Number(value.limit) || 20))),
      walletId: String(value.walletId || '').trim() || null
    };
  }

  Object.assign(core.handlers, {
    async api_searchTransactions(filters) {
      const { walletId, ...baseParams } = validateSearchFilters(filters);
      let { data, error } = await sb.rpc('search_user_transactions', { ...baseParams, p_wallet_id: walletId });
      if (error && !walletId && /p_wallet_id|Could not find the function/i.test(error.message || '')) {
        const retry = await sb.rpc('search_user_transactions', baseParams);
        data = retry.data;
        error = retry.error;
      }
      fail(error);
      return {
        transactions: (data || []).map((row) => ({
          id: row.id, tanggal: row.tanggal, tipe: row.tipe, kategori: row.kategori,
          nominal: num(row.nominal), keterangan: row.keterangan || '', walletId: row.wallet_id || ''
        })),
        totalCount: data && data.length ? Number(data[0].total_count) || 0 : 0
      };
    },

    async api_addTransaction(d) {
      const row = trxRow(d);
      const { data, error } = await sb.from('transactions').insert({ ...row, source: 'web' })
        .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id').single();
      fail(error);
      const currentPeriod = await syncPeriod(row.tanggal);
      return { transaction: trxFromRow(data), ...(currentPeriod ? { currentPeriod } : {}) };
    },

    async api_updateTransaction(id, d) {
      const row = trxRow(d);
      const { data, error } = await sb.from('transactions').update(row).eq('id', id)
        .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id').maybeSingle();
      fail(error);
      if (!data) throw new Error('Transaksi tidak ditemukan atau tidak dapat diakses.');
      const currentPeriod = await syncPeriod(row.tanggal);
      return { transaction: trxFromRow(data), ...(currentPeriod ? { currentPeriod } : {}) };
    },

    async api_deleteTransaction(id) {
      const { data, error } = await sb.from('transactions').delete().eq('id', id).select('id').maybeSingle();
      fail(error);
      if (!data) throw new Error('Transaksi tidak ditemukan atau tidak dapat diakses.');
      return { deletedTransactionId: data.id };
    },

    async api_importTransactions(items) {
      if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
        throw new Error('Impor harus berisi 1 sampai 500 transaksi.');
      }
      const rows = items.map((item) => trxRow(item));
      const dates = Array.from(new Set(rows.map((row) => row.tanggal))).sort();
      const [existing, defaultWallet] = await Promise.all([
        fetchTransactionsOnDates(dates),
        sb.from('wallets').select('id').order('sort', { ascending: true }).order('name', { ascending: true }).limit(1).maybeSingle()
      ]);
      fail(defaultWallet.error);
      const defaultWalletId = defaultWallet.data ? defaultWallet.data.id : '';
      const seen = new Set(existing.map((row) => transactionFingerprint({ ...row, walletId: row.wallet_id || '' }, defaultWalletId)));
      const insertRows = [];
      rows.forEach((row) => {
        const key = transactionFingerprint({ ...row, walletId: row.wallet_id || '' }, defaultWalletId);
        if (!seen.has(key)) { seen.add(key); insertRows.push({ ...row, source: 'import' }); }
      });

      let addedTransactions = [];
      let currentPeriod = '';
      if (insertRows.length) {
        const { data, error } = await sb.from('transactions').insert(insertRows)
          .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id');
        fail(error);
        addedTransactions = data.map(trxFromRow);
        currentPeriod = await syncPeriod(dates[dates.length - 1]);
      }
      return {
        addedTransactions,
        addedCount: addedTransactions.length,
        skippedCount: items.length - addedTransactions.length,
        ...(currentPeriod ? { currentPeriod } : {})
      };
    },

    async api_addCategory(tipe, name) {
      const cleanTipe = String(tipe || '').trim().toLowerCase();
      if (!['pemasukan', 'pengeluaran'].includes(cleanTipe)) throw new Error('Tipe kategori tidak valid.');
      const clean = String(name || '').trim();
      if (!clean) throw new Error('Nama kategori wajib diisi.');
      const { error } = await sb.from('categories').upsert({ tipe: cleanTipe, name: clean }, { onConflict: 'user_id,tipe,name', ignoreDuplicates: true });
      fail(error);
      return fetchCategoriesOnly();
    },

    async api_renameCategory(tipe, oldName, newName) {
      const cleanOld = String(oldName || '').trim();
      const cleanNew = String(newName || '').trim();
      if (!['pemasukan', 'pengeluaran'].includes(tipe)) throw new Error('Tipe kategori tidak valid.');
      if (!cleanOld || !cleanNew) throw new Error('Nama kategori wajib diisi.');
      const { error } = await sb.rpc('rename_category_with_transactions', { p_tipe: tipe, p_old_name: cleanOld, p_new_name: cleanNew });
      fail(error);
      const [cats, budgets, recurring] = await Promise.all([fetchCategoriesOnly(), fetchBudgetsOnly(), fetchRecurringOnly()]);
      return {
        ...cats, ...budgets, ...recurring,
        renamedTransactionCategory: { from: cleanOld, to: cleanNew, tipe: tipe === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran' }
      };
    },

    async api_deleteCategory(tipe, name) {
      if (!['pemasukan', 'pengeluaran'].includes(tipe)) throw new Error('Tipe kategori tidak valid.');
      const { error } = await sb.rpc('delete_category', { p_tipe: tipe, p_name: String(name || '') });
      fail(error);
      return fetchCategoriesOnly();
    },

    async api_addEntity(group, name) {
      const { error } = await sb.from('entities').upsert({ grp: group, name }, { onConflict: 'user_id,grp,name', ignoreDuplicates: true });
      fail(error);
      return fetchEntitiesOnly();
    },

    async api_updateEntity(group, oldName, newName) {
      if (typeof newName !== 'string' || !newName.trim()) throw new Error('Nama entitas wajib diisi.');
      const { error } = await sb.rpc('rename_entity_with_transactions', { p_group: group, p_old_name: oldName, p_new_name: newName.trim() });
      fail(error);
      return { ...(await fetchEntitiesOnly()), renamedTransactionCategory: { from: group + ' - ' + oldName, to: group + ' - ' + newName.trim() } };
    },

    async api_deleteEntity(group, name) {
      const { error } = await sb.from('entities').delete().eq('grp', group).eq('name', name);
      fail(error);
      return fetchEntitiesOnly();
    },

    async api_savePayrollDay(day) {
      await setSetting('payrollDay', Math.max(1, Math.min(28, Number(day) || 1)));
      return true;
    },

    async api_savePeriod(period) {
      await setSetting('currentPeriod', period);
      return true;
    }
  });
})();
