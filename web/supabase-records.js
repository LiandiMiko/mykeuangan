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
    tx.walletId || defaultWalletId || '',
    // Id stabil (§4): dua kopi identik dengan id berbeda adalah dua
    // baris berbeda; tanpa ini fingerprint kasar menelan kopi kedua.
    String(tx.legacyId || tx.legacy_id || '')
  ].join('\u001f');

  async function fetchTransactionsOnDates(dates) {
    const out = [];
    for (let index = 0; index < dates.length; index += 50) {
      const dateChunk = dates.slice(index, index + 50);
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('transactions')
          .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id,legacy_id')
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
      // Idempotency key antrean offline (T13, Gelombang 2.5): dibuat sekali
      // di klien saat enqueue, dikirim di dalam payload. trxRow() hanya
      // mengambil field yang dikenal, jadi kunci ditempel eksplisit di sini.
      const idempotencyKey = typeof d.idempotencyKey === 'string' ? d.idempotencyKey.trim() : '';
      const { data, error } = await sb.from('transactions').insert({
        ...row, source: 'web',
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
      })
        .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id').single();
      if (error && error.code === '23505' && idempotencyKey) {
        // Insert pertama berhasil tapi responsnya hilang, lalu retry
        // meng-insert ulang: unique index (user_id, idempotency_key)
        // menolaknya. JANGAN lempar — ambil baris yang sudah ada dan
        // kembalikan seperti insert berhasil, supaya flush menghapus
        // item antrean dan mengganti baris optimistis lokal.
        // Select terikat RLS (hanya baris milik sendiri), jadi filter
        // kunci saja sudah setara dengan pencarian (user_id, key).
        // (Cek code SEBELUM fail(): fail() membuang code dari error.)
        const existing = await sb.from('transactions')
          .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id')
          .eq('idempotency_key', idempotencyKey).maybeSingle();
        if (existing.error) fail(existing.error);
        if (existing.data) {
          const currentPeriod = await syncPeriod(existing.data.tanggal);
          return { transaction: trxFromRow(existing.data), ...(currentPeriod ? { currentPeriod } : {}) };
        }
        // Balapan: baris belum terlihat — lempar error asli agar flush
        // menandai retry, bukan menghapus item antrean.
        fail(error);
      }
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
      // Validasi PER BARIS (§9e/§10): dulu satu throw generik tanpa
      // menyebut baris mana; sekarang kumpulkan semua baris gagal
      // (indeks 1-based + alasan) dan laporkan sekaligus. Validasi
      // kategori & dompet terhadap data milik user sendiri — bukan
      // sekadar format — supaya PostgREST langsung tidak bisa
      // memasukkan kategori/dompet asing lewat jalur ini.
      const rowErrors = [];
      const rows = [];
      items.forEach((item, idx) => {
        try {
          rows.push(trxRow(item));
        } catch (e) {
          rowErrors.push({ index: idx + 1, message: String((e && e.message) || e) });
          rows.push(null);
        }
      });
      const [existing, defaultWallet, catsRes, walletsRes] = await Promise.all([
        fetchTransactionsOnDates(Array.from(new Set(rows.filter(Boolean).map((row) => row.tanggal))).sort()),
        sb.from('wallets').select('id').order('sort', { ascending: true }).order('name', { ascending: true }).limit(1).maybeSingle(),
        fetchCategoriesOnly(),
        sb.from('wallets').select('id').limit(1000)
      ]);
      fail(defaultWallet.error);
      fail(walletsRes.error);
      const defaultWalletId = defaultWallet.data ? defaultWallet.data.id : '';
      const knownCategories = new Set([
        ...((catsRes.categories && catsRes.categories.pemasukan) || []),
        ...((catsRes.categories && catsRes.categories.pengeluaran) || [])
      ].map((c) => String(c || '').trim().toLocaleLowerCase()));
      const knownWalletIds = new Set((walletsRes.data || []).map((w) => String(w.id)));
      rows.forEach((row, idx) => {
        if (!row) return;
        if (knownCategories.size && !knownCategories.has(String(row.kategori || '').trim().toLocaleLowerCase())) {
          rowErrors.push({ index: idx + 1, message: 'Kategori tidak dikenal: ' + row.kategori });
          rows[idx] = null;
        } else if (row.wallet_id && !knownWalletIds.has(String(row.wallet_id))) {
          rowErrors.push({ index: idx + 1, message: 'Dompet tidak ditemukan untuk transaksi ini.' });
          rows[idx] = null;
        }
      });
      if (rowErrors.length) {
        const detail = rowErrors.slice(0, 10).map((e) => 'baris ' + e.index + ': ' + e.message).join('; ');
        throw new Error('Impor gagal pada ' + rowErrors.length + ' baris (' + detail + (rowErrors.length > 10 ? '; ...' : '') + ').');
      }
      const validRows = rows.filter(Boolean);
      const dates = Array.from(new Set(validRows.map((row) => row.tanggal))).sort();
      const seen = new Set(existing.map((row) => transactionFingerprint({ ...row, walletId: row.wallet_id || '', legacyId: row.legacy_id || '' }, defaultWalletId)));
      const insertRows = [];
      validRows.forEach((row) => {
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
      // Dulu: tanpa validasi nama sama sekali (hanya CHECK grp di DB).
      const grp = String(group || '').trim();
      const clean = String(name || '').trim();
      if (!['UtangApp', 'UtangPerson', 'Piutang'].includes(grp)) throw new Error('Grup entitas tidak valid.');
      if (!clean || clean.length > 80) throw new Error('Nama entitas wajib diisi maksimal 80 karakter.');
      const { error } = await sb.from('entities').upsert({ grp, name: clean }, { onConflict: 'user_id,grp,name', ignoreDuplicates: true });
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

    // Wave 3.5 §3: restore atomik — SATU panggilan RPC, bukan N
    // insert terpisah. Server memvalidasi + meng-insert 10 koleksi
    // dalam satu transaksi; gagal di tengah = rollback semua.
    // Klien lama (fallback sekuensial) ada di ui-feat-backup.js dan
    // hanya dipakai bila RPC belum ada di server.
    async api_restoreBackup(payload) {
      if (!payload || typeof payload !== 'object') throw new Error('Payload restore tidak valid.');
      const { data, error } = await sb.rpc('restore_backup', { p_payload: payload });
      fail(error);
      return { restored: data };
    },

    async api_savePayrollDay(day) {
      await setSetting('payrollDay', Math.max(1, Math.min(28, Number(day) || 1)));
      return true;
    },

    // Dompet bank utama sebagai acuan Cashflow Runway. Nilai kosong ('')
    // menghapus pengaturan sehingga runway kembali memakai total semua dompet.
    async api_savePrimaryBankWallet(walletId) {
      const id = String(walletId || '').trim();
      if (id) {
        const { data: wallet, error } = await sb.from('wallets').select('id,kind').eq('id', id).maybeSingle();
        fail(error);
        if (!wallet || String(wallet.kind || '') !== 'bank') {
          throw new Error('Dompet utama harus berupa dompet bank yang sudah ada.');
        }
      }
      await setSetting('primaryBankWalletId', id);
      return true;
    },

    async api_savePeriod(period) {
      await setSetting('currentPeriod', period);
      return true;
    }
  });
})();
