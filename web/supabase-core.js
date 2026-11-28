/* supabase-core.js — client init, query helpers & initial payload assembly */
(function () {
  'use strict';

  function showCoreNotice(title, msg, options) {
    const opts = options || {};
    if (opts.preferSwal !== false && window.Swal && typeof window.Swal.fire === 'function') {
      const dark = document.documentElement.classList.contains('dark');
      return window.Swal.fire({
        icon: opts.icon || 'error',
        title,
        text: msg,
        customClass: { popup: dark ? 'dark-swal' : '' }
      });
    }
    return new Promise((resolve) => {
      const render = () => {
        const wrap = document.createElement('div');
        wrap.setAttribute('role', 'alertdialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.style.cssText = 'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,0.8);font-family:Inter,system-ui,sans-serif;';
        const card = document.createElement('div');
        card.style.cssText = 'max-width:400px;width:100%;background:#fff;color:#0f172a;padding:22px;border-radius:20px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.3);';
        const h = document.createElement('h2');
        h.style.cssText = 'margin:0 0 8px;font-size:17px;font-weight:800;color:#e11d48;';
        h.textContent = title;
        const p = document.createElement('p');
        p.style.cssText = 'margin:0;font-size:13px;line-height:1.5;color:#475569;';
        p.textContent = msg;
        card.append(h, p);
        if (opts.closable) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'OK';
          btn.style.cssText = 'margin-top:16px;padding:9px 20px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer;';
          btn.onclick = () => { wrap.remove(); resolve(); };
          card.appendChild(btn);
        }
        wrap.appendChild(card);
        document.body.appendChild(wrap);
      };
      if (document.body) render();
      else document.addEventListener('DOMContentLoaded', render, { once: true });
    });
  }

  if (!window.supabase || !window.supabase.createClient) {
    showCoreNotice('Jaringan / Library Bermasalah', 'Library Supabase gagal dimuat (jaringan atau ad-blocker memblokir CDN). Muat ulang halaman dengan Ctrl+F5.', { preferSwal: false });
    return;
  }
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    showCoreNotice('Konfigurasi Belum Diisi', 'web/config.js belum diisi (SUPABASE_URL & SUPABASE_ANON_KEY).', { preferSwal: false });
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

  const MAX_NOMINAL = 999999999999.99;

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
    if (amount > MAX_NOMINAL) {
      throw new Error('Nominal transaksi tidak boleh melebihi Rp 999.999.999.999,99.');
    }
    const row = { tanggal: date, tipe: d.tipe, kategori: d.kategori.trim(), nominal: amount, keterangan: d.keterangan || '' };
    if (d.walletId) row.wallet_id = d.walletId;
    // Id stabil dibawa sebagai legacy_id (§4): dedup berbasis id di
    // jalur impor/restore, dan retry yang sama tidak duplikat.
    const stableId = String(d.legacyId || d.legacy_id || d.id || '').trim();
    if (stableId) row.legacy_id = stableId;
    return row;
  };

  const trxFromRow = (row) => ({
    id: row.id,
    tanggal: row.tanggal,
    tipe: row.tipe,
    kategori: row.kategori,
    nominal: num(row.nominal),
    keterangan: row.keterangan || '',
    walletId: row.wallet_id || '',
    // Optimistic locking (Gelombang 7c): versi baris saat dibaca dari
    // server. 1 bila sumbernya belum membawa versi (server lama / RPC
    // lama seperti search/contribute) — handler mengambil versi segar
    // dari server bila pemanggil tidak menyertakannya (fetch-first).
    version: num(row.version) || 1
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
    const budgets = await fetchAll('budgets', 'id,kategori,bulan,jumlah,version', ['bulan', 'kategori']);
    return { budgets: budgets.map((b) => ({ id: b.id, kategori: b.kategori, bulan: b.bulan, jumlah: num(b.jumlah), version: num(b.version) || 1 })) };
  };

  const fetchWalletsOnly = async () => {
    const wallets = await fetchAll('wallets', 'id,name,kind,opening_balance,sort,version', ['sort', 'name']);
    return {
      wallets: wallets.map((w) => ({ id: w.id, name: w.name, kind: w.kind, openingBalance: num(w.opening_balance), sort: w.sort, version: num(w.version) || 1 }))
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
    const assets = await fetchAll('assets', 'id,name,type,symbol,quantity,buy_price,value,version', ['name', 'id']);
    return {
      assets: assets.map((a) => ({
        id: a.id, name: a.name, type: a.type, symbol: a.symbol,
        quantity: num(a.quantity), buyPrice: num(a.buy_price), value: num(a.value),
        version: num(a.version) || 1
      }))
    };
  };

  const fetchRecurringOnly = async () => {
    const recurring = await fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,last_run,active,version', ['id']);
    return {
      recurring: recurring.map((r) => ({
        id: r.id, tipe: r.tipe, kategori: r.kategori, nominal: num(r.nominal),
        keterangan: r.keterangan || '', dayOfMonth: r.day_of_month,
        lastRun: r.last_run || '', active: String(r.active),
        version: num(r.version) || 1
      }))
    };
  };

  const goalFromRow = (goal) => ({
    id: goal.id,
    name: goal.name,
    targetAmount: num(goal.target_amount),
    currentAmount: num(goal.current_amount),
    targetDate: goal.target_date || '',
    version: num(goal.version) || 1
  });

  function formatInitialDataPayload(raw, includeTransactions, payrollDay) {
    const { trx, cats, ents, assets, budgets, recurring, settings, snapData, wallets, transfers, goalRows } = raw;
    return {
      ...(includeTransactions ? { transactions: trx.map(trxFromRow) } : {}),
      wallets: wallets.map((w) => ({ id: w.id, name: w.name, kind: w.kind, openingBalance: num(w.opening_balance), sort: w.sort, version: num(w.version) || 1 })),
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
        quantity: num(a.quantity), buyPrice: num(a.buy_price), value: num(a.value),
        version: num(a.version) || 1
      })),
      budgets: budgets.map((b) => ({ id: b.id, kategori: b.kategori, bulan: b.bulan, jumlah: num(b.jumlah), version: num(b.version) || 1 })),
      goals: goalRows.map(goalFromRow),
      snapshots: snapData.map((s) => ({
        tanggal: s.tanggal, total: num(s.total_value), crypto: num(s.crypto_value),
        cash: num(s.cash_value), other: num(s.other_value)
      })),
      recurring: recurring.map((r) => ({
        id: r.id, tipe: r.tipe, kategori: r.kategori, nominal: num(r.nominal),
        keterangan: r.keterangan || '', dayOfMonth: r.day_of_month,
        lastRun: r.last_run || '', active: String(r.active),
        version: num(r.version) || 1
      })),
      debtDueDates: parseDebtDueDatesSetting(settings.debtDueDates),
      currentPeriod: settings.currentPeriod || cycleFor(ymd(new Date()), payrollDay),
      primaryBankWalletId: settings.primaryBankWalletId || '',
      payrollDay
    };
  }

  async function getInitialData(options) {
    const includeTransactions = !options || options.includeTransactions !== false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const [trx, cats, ents, assets, budgets, recurring, settings, snapRes, walletsRaw, transfers, goalRows] = await Promise.all([
      includeTransactions ? fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan,wallet_id,version', ['tanggal', 'id']) : Promise.resolve([]),
      fetchAll('categories', 'tipe,name', ['tipe', 'name']),
      fetchAll('entities', 'grp,name', ['grp', 'name']),
      fetchAll('assets', 'id,name,type,symbol,quantity,buy_price,value,version', ['name', 'id']),
      fetchAll('budgets', 'id,kategori,bulan,jumlah,version', ['bulan', 'kategori']),
      fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,last_run,active,version', ['id']),
      getSettings(),
      sb.from('portfolio_snapshots').select('tanggal,total_value,crypto_value,cash_value,other_value').gte('tanggal', ymd(cutoff)).order('tanggal', { ascending: true }),
      fetchAll('wallets', 'id,name,kind,opening_balance,sort,version', ['sort', 'name']),
      fetchAll('transfers', 'id,tanggal,kind,from_wallet,to_wallet,nominal,fee,keterangan', ['tanggal', 'id']),
      fetchAll('financial_goals', 'id,name,target_amount,current_amount,target_date,created_at,version', ['created_at', 'id'])
    ]);
    fail(snapRes.error);

    let wallets = walletsRaw;
    if (wallets.length === 0) {
      const { error: wErr } = await sb.from('wallets').insert([
        { name: 'BCA (m-banking)', kind: 'bank', sort: 1 },
        { name: 'Cash', kind: 'cash', sort: 2 }
      ]);
      fail(wErr);
      wallets = await fetchAll('wallets', 'id,name,kind,opening_balance,sort,version', ['sort', 'name']);
    }

    const payrollDay = Number(settings.payrollDay) || 1;
    return formatInitialDataPayload(
      { trx, cats, ents, assets, budgets, recurring, settings, snapData: snapRes.data, wallets, transfers, goalRows },
      includeTransactions,
      payrollDay
    );
  }

  /* ============================================================
     OPTIMISTIC LOCKING (Gelombang 7c Item 2)
     - createConflictError(kind, details): error terstruktur untuk
       konflik tulis. `.code === 'MK_CONFLICT'`, `.conflict` membawa
       { kind, id, operation, mine, current, base, deletedByOther }.
       Pesan `.message` TIDAK PERNAH ditampilkan mentah ke pengguna
       — dialog di web/sync-conflict.js membaca `.conflict`, dan
       toUserErrorMessage memetakan kode ini ke kalimat umum sebagai
       jaring pengaman.
     - isConflictError(err): pengenal konflik (dipakai flush antrean
       offline + call-site, supaya konflik tidak diperlakukan sebagai
       kegagalan transient / error biasa).
     - loadVersionedRow(table, id, columns): baca SATU baris beserta
       `version`-nya — dipakai pola fetch-first handler: bila
       pemanggil tidak menyertakan expectedVersion, versi kini
       diambil dari server lalu update tetap bersyarat
       (WHERE version = ...), jadi pemanggil lama otomatis
       terlindungi tanpa perubahan.
     Helper ini tinggal di core (dimuat sebelum modul fitur) supaya
     handler supabase-* bisa memakainya tanpa bergantung pada urutan
     muat web/sync-conflict.js.
     ============================================================ */
  function createConflictError(kind, details) {
    const err = new Error('CONFLICT:' + String(kind || 'record'));
    err.code = 'MK_CONFLICT';
    err.conflict = Object.assign({ kind: String(kind || 'record') }, details || {});
    return err;
  }

  function isConflictError(err) {
    if (!err || typeof err !== 'object') return false;
    if (err.code === 'MK_CONFLICT') return true;
    return Boolean(err.conflict && typeof err.conflict === 'object' && err.conflict.kind);
  }

  async function loadVersionedRow(table, id, columns) {
    const { data, error } = await sb.from(table).select(columns).eq('id', id).maybeSingle();
    fail(error);
    return data || null;
  }

  // Menyelesaikan expectedVersion untuk satu operasi tulis:
  // 'force' = timpa yang disetujui pengguna (ambil versi kini);
  // angka = pakai apa adanya; undefined = fetch-first dari server.
  // Mengembalikan { expected, current } — current null bila baris
  // tidak ada (sudah dihapus di server).
  async function resolveExpectedVersion(table, id, columns, expectedVersion) {
    if (expectedVersion === 'force') {
      const current = await loadVersionedRow(table, id, columns);
      return { expected: current ? (Number(current.version) || 1) : null, current, force: true };
    }
    if (typeof expectedVersion === 'number' && Number.isFinite(expectedVersion)) {
      return { expected: expectedVersion, current: null, force: false };
    }
    const current = await loadVersionedRow(table, id, columns);
    return { expected: current ? (Number(current.version) || 1) : null, current, force: false };
  }

  window.__mkSb = {
    sb, fail, num, pad, ymd, ready, resolveReady: () => readyResolve(), showCoreNotice,
    fetchAll, getSettings, setSetting, cycleFor, syncPeriod, trxRow, trxFromRow,
    fetchCategoriesOnly, fetchEntitiesOnly, fetchBudgetsOnly, fetchWalletsOnly,
    fetchWalletsAndTransfers, fetchAssetsOnly, fetchRecurringOnly, goalFromRow,
    createConflictError, isConflictError, loadVersionedRow, resolveExpectedVersion,
    MAX_NOMINAL,
    handlers: { getInitialData }
  };
})();
