/* supabase-core.js — client init, query helpers & initial payload assembly */
(function () {
  'use strict';

  if (!window.supabase || !window.supabase.createClient) {
    alert('Library Supabase gagal dimuat (jaringan atau ad-blocker memblokir CDN). Muat ulang halaman dengan Ctrl+F5.');
    return;
  }
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    alert('web/config.js belum diisi (SUPABASE_URL & SUPABASE_ANON_KEY).');
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const fail = (error) => { if (error) throw new Error(error.message || String(error)); };
  const num = (v) => Number(v) || 0;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  async function fetchAll(table, columns, orderCols) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select(columns).range(from, from + 999);
      (orderCols || []).forEach((c) => { q = q.order(c, { ascending: true }); });
      const { data, error } = await q;
      fail(error);
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }

  async function getSettings() {
    const rows = await fetchAll('settings', 'key,value', ['key']);
    const out = {};
    rows.forEach((r) => { out[r.key] = r.value; });
    return out;
  }

  async function setSetting(key, value) {
    const { error } = await sb.from('settings').upsert({ key, value: String(value) }, { onConflict: 'user_id,key' });
    fail(error);
  }

  function cycleFor(tanggal, payrollDay) {
    const pd = Number(payrollDay) || 1;
    const p = String(tanggal).slice(0, 10).split('-').map(Number);
    if (p.length !== 3) return '';
    let [y, m, d] = p;
    if (pd > 1 && d >= pd) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + '-' + pad(m);
  }

  async function syncPeriod(tanggal) {
    const s = await getSettings();
    const cyc = cycleFor(tanggal, s.payrollDay);
    if (cyc && (!s.currentPeriod || cyc > s.currentPeriod)) {
      await setSetting('currentPeriod', cyc);
      return cyc;
    }
    return s.currentPeriod || '';
  }

  function parseDebtDueDatesSetting(rawValue) {
    try {
      const parsed = JSON.parse(rawValue || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  const trxRow = (d) => {
    if (!d || typeof d !== 'object') throw new Error('Data transaksi tidak valid.');
    const date = String(d.tanggal || '').slice(0, 10);
    const dateValue = new Date(date + 'T00:00:00');
    const amount = Number(d.nominal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateValue.getTime()) || ymd(dateValue) !== date) {
      throw new Error('Tanggal transaksi tidak valid.');
    }
    if (d.tipe !== 'Pemasukan' && d.tipe !== 'Pengeluaran') {
      throw new Error('Tipe transaksi tidak valid.');
    }
    if (typeof d.kategori !== 'string' || !d.kategori.trim()) {
      throw new Error('Kategori transaksi wajib diisi.');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Nominal transaksi harus lebih dari 0.');
    }
    const row = { tanggal: date, tipe: d.tipe, kategori: d.kategori.trim(), nominal: amount, keterangan: d.keterangan || '' };
    if (d.walletId) row.wallet_id = d.walletId;
    return row;
  };

  const trxFromRow = (row) => ({
    id: row.id,
    tanggal: row.tanggal,
    tipe: row.tipe,
    kategori: row.kategori,
    nominal: num(row.nominal),
    keterangan: row.keterangan || '',
    walletId: row.wallet_id || ''
  });

  const fetchCategoriesOnly = async () => {
    const cats = await fetchAll('categories', 'tipe,name', ['tipe', 'name']);
    return {
      categories: {
        pemasukan: cats.filter((c) => c.tipe === 'pemasukan').map((c) => c.name),
        pengeluaran: cats.filter((c) => c.tipe === 'pengeluaran').map((c) => c.name)
      }
    };
  };

  const fetchEntitiesOnly = async () => {
    const ents = await fetchAll('entities', 'grp,name', ['grp', 'name']);
    return {
      entities: {
        UtangApp: ents.filter((e) => e.grp === 'UtangApp').map((e) => e.name),
        UtangPerson: ents.filter((e) => e.grp === 'UtangPerson').map((e) => e.name),
        Piutang: ents.filter((e) => e.grp === 'Piutang').map((e) => e.name)
      }
    };
  };

  const fetchBudgetsOnly = async () => {
    const budgets = await fetchAll('budgets', 'id,kategori,bulan,jumlah', ['bulan', 'kategori']);
    return { budgets: budgets.map((b) => ({ id: b.id, kategori: b.kategori, bulan: b.bulan, jumlah: num(b.jumlah) })) };
  };

  const fetchWalletsOnly = async () => {
    const wallets = await fetchAll('wallets', 'id,name,kind,opening_balance,sort', ['sort', 'name']);
    return {
      wallets: wallets.map((w) => ({ id: w.id, name: w.name, kind: w.kind, openingBalance: num(w.opening_balance), sort: w.sort }))
    };
  };

  const fetchWalletsAndTransfers = async () => {
    const [walletsRes, transfers] = await Promise.all([
      fetchWalletsOnly(),
      fetchAll('transfers', 'id,tanggal,kind,from_wallet,to_wallet,nominal,fee,keterangan', ['tanggal', 'id'])
    ]);
    return {
      ...walletsRes,
      transfers: transfers.map((x) => ({
        id: x.id, tanggal: x.tanggal, kind: x.kind, fromWallet: x.from_wallet || '',
        toWallet: x.to_wallet || '', nominal: num(x.nominal), fee: num(x.fee), keterangan: x.keterangan || ''
      }))
    };
  };

  const fetchAssetsOnly = async () => {
    const assets = await fetchAll('assets', 'id,name,type,symbol,quantity,buy_price,value', ['name', 'id']);
    return {
      assets: assets.map((a) => ({
        id: a.id, name: a.name, type: a.type, symbol: a.symbol,
        quantity: num(a.quantity), buyPrice: num(a.buy_price), value: num(a.value)
      }))
    };
  };

  const fetchRecurringOnly = async () => {
    const recurring = await fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,last_run,active', ['id']);
    return {
      recurring: recurring.map((r) => ({
        id: r.id, tipe: r.tipe, kategori: r.kategori, nominal: num(r.nominal),
        keterangan: r.keterangan || '', dayOfMonth: r.day_of_month,
        lastRun: r.last_run || '', active: String(r.active)
      }))
    };
  };

  const goalFromRow = (goal) => ({
    id: goal.id,
    name: goal.name,
    targetAmount: num(goal.target_amount),
    currentAmount: num(goal.current_amount),
    targetDate: goal.target_date || ''
  });

  function formatInitialDataPayload(raw, includeTransactions, payrollDay) {
    const { trx, cats, ents, assets, budgets, recurring, settings, snapData, wallets, transfers, goalRows } = raw;
    return {
      ...(includeTransactions ? { transactions: trx.map(trxFromRow) } : {}),
      wallets: wallets.map((w) => ({ id: w.id, name: w.name, kind: w.kind, openingBalance: num(w.opening_balance), sort: w.sort })),
      transfers: transfers.map((x) => ({
        id: x.id, tanggal: x.tanggal, kind: x.kind, fromWallet: x.from_wallet || '',
        toWallet: x.to_wallet || '', nominal: num(x.nominal), fee: num(x.fee), keterangan: x.keterangan || ''
      })),
      categories: {
        pemasukan: cats.filter((c) => c.tipe === 'pemasukan').map((c) => c.name),
        pengeluaran: cats.filter((c) => c.tipe === 'pengeluaran').map((c) => c.name)
      },
      entities: {
        UtangApp: ents.filter((e) => e.grp === 'UtangApp').map((e) => e.name),
        UtangPerson: ents.filter((e) => e.grp === 'UtangPerson').map((e) => e.name),
        Piutang: ents.filter((e) => e.grp === 'Piutang').map((e) => e.name)
      },
      assets: assets.map((a) => ({
        id: a.id, name: a.name, type: a.type, symbol: a.symbol,
        quantity: num(a.quantity), buyPrice: num(a.buy_price), value: num(a.value)
      })),
      budgets: budgets.map((b) => ({ id: b.id, kategori: b.kategori, bulan: b.bulan, jumlah: num(b.jumlah) })),
      goals: goalRows.map(goalFromRow),
      snapshots: snapData.map((s) => ({
        tanggal: s.tanggal, total: num(s.total_value), crypto: num(s.crypto_value),
        cash: num(s.cash_value), other: num(s.other_value)
      })),
      recurring: recurring.map((r) => ({
        id: r.id, tipe: r.tipe, kategori: r.kategori, nominal: num(r.nominal),
        keterangan: r.keterangan || '', dayOfMonth: r.day_of_month,
        lastRun: r.last_run || '', active: String(r.active)
      })),
      debtDueDates: parseDebtDueDatesSetting(settings.debtDueDates),
      currentPeriod: settings.currentPeriod || cycleFor(ymd(new Date()), payrollDay),
      payrollDay
    };
  }

  async function getInitialData(options) {
    const includeTransactions = !options || options.includeTransactions !== false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const [trx, cats, ents, assets, budgets, recurring, settings, snapRes, walletsRaw, transfers, goalRows] = await Promise.all([
      includeTransactions ? fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan,wallet_id', ['tanggal', 'id']) : Promise.resolve([]),
      fetchAll('categories', 'tipe,name', ['tipe', 'name']),
      fetchAll('entities', 'grp,name', ['grp', 'name']),
      fetchAll('assets', 'id,name,type,symbol,quantity,buy_price,value', ['name', 'id']),
      fetchAll('budgets', 'id,kategori,bulan,jumlah', ['bulan', 'kategori']),
      fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,last_run,active', ['id']),
      getSettings(),
      sb.from('portfolio_snapshots').select('tanggal,total_value,crypto_value,cash_value,other_value').gte('tanggal', ymd(cutoff)).order('tanggal', { ascending: true }),
      fetchAll('wallets', 'id,name,kind,opening_balance,sort', ['sort', 'name']),
      fetchAll('transfers', 'id,tanggal,kind,from_wallet,to_wallet,nominal,fee,keterangan', ['tanggal', 'id']),
      fetchAll('financial_goals', 'id,name,target_amount,current_amount,target_date,created_at', ['created_at', 'id'])
    ]);
    fail(snapRes.error);

    let wallets = walletsRaw;
    if (wallets.length === 0) {
      const { error: wErr } = await sb.from('wallets').insert([
        { name: 'BCA (m-banking)', kind: 'bank', sort: 1 },
        { name: 'Cash', kind: 'cash', sort: 2 }
      ]);
      fail(wErr);
      wallets = await fetchAll('wallets', 'id,name,kind,opening_balance,sort', ['sort', 'name']);
    }

    const payrollDay = Number(settings.payrollDay) || 1;
    return formatInitialDataPayload(
      { trx, cats, ents, assets, budgets, recurring, settings, snapData: snapRes.data, wallets, transfers, goalRows },
      includeTransactions,
      payrollDay
    );
  }

  window.__mkSb = {
    sb, fail, num, pad, ymd, ready, resolveReady: () => readyResolve(),
    fetchAll, getSettings, setSetting, cycleFor, syncPeriod, trxRow, trxFromRow,
    fetchCategoriesOnly, fetchEntitiesOnly, fetchBudgetsOnly, fetchWalletsOnly,
    fetchWalletsAndTransfers, fetchAssetsOnly, fetchRecurringOnly, goalFromRow,
    handlers: { getInitialData }
  };
})();
