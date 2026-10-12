/* supabase-api.js — pengganti google.script.run untuk MyKeuanganGuech.
 * Mengganti callServer() dari script.html: semua pemanggilan api_* lama
 * diterjemahkan ke Supabase dan mengembalikan payload getInitialData()
 * dengan bentuk yang sama seperti versi Apps Script. */
(function () {
  'use strict';

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

  /* ---------------- Login ---------------- */
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  function finishLogin(session) {
    const email = (session && session.user && session.user.email) || '';
    try { sessionUser = email.split('@')[0] || 'User'; } catch (e) { /* global belum ada */ }
    readyResolve();
  }

  function showLogin() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;background:#0f172a;font-family:system-ui,sans-serif';
    const field = 'padding:10px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px';
    el.innerHTML =
      '<form id="mkLogin" style="background:#fff;padding:28px;border-radius:16px;' +
      'width:min(92vw,340px);display:grid;gap:12px">' +
      '<h2 style="margin:0;font-size:20px;color:#0f172a">MyKeuanganGuech</h2>' +
      '<input id="mkEmail" type="email" placeholder="Email" required autocomplete="username" style="' + field + '">' +
      '<input id="mkPass" type="password" placeholder="Password" required autocomplete="current-password" style="' + field + '">' +
      '<button type="submit" style="padding:10px;border:0;border-radius:10px;background:#0f172a;' +
      'color:#fff;font-weight:600;font-size:15px;cursor:pointer">Masuk</button>' +
      '<p id="mkErr" style="margin:0;color:#dc2626;font-size:13px;min-height:1em"></p></form>';
    document.body.appendChild(el);
    el.querySelector('#mkLogin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { data, error } = await sb.auth.signInWithPassword({
        email: el.querySelector('#mkEmail').value.trim(),
        password: el.querySelector('#mkPass').value
      });
      if (error) { el.querySelector('#mkErr').textContent = 'Login gagal: ' + error.message; return; }
      el.remove();
      finishLogin(data.session);
    });
  }

  async function boot() {
    const { data } = await sb.auth.getSession();
    if (data && data.session) finishLogin(data.session); else showLogin();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.logout = async function () { await sb.auth.signOut(); location.reload(); };

  /* ---------------- Helper data ---------------- */
  // PostgREST membatasi 1000 baris per request → ambil bertahap.
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
    const o = {};
    rows.forEach((r) => { o[r.key] = r.value; });
    return o;
  }

  async function setSetting(key, value) {
    const { error } = await sb.from('settings').upsert({ key, value: String(value) }, { onConflict: 'user_id,key' });
    fail(error);
  }

  // Setara getCycleForDate() di Code.gs
  function cycleFor(tanggal, payrollDay) {
    payrollDay = Number(payrollDay) || 1;
    const p = String(tanggal).slice(0, 10).split('-').map(Number);
    if (p.length !== 3) return '';
    let [y, m, d] = p;
    if (payrollDay > 1 && d >= payrollDay) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + '-' + pad(m);
  }

  // Majukan "periode aktif" bila transaksi jatuh ke siklus yang lebih baru
  async function syncPeriod(tanggal) {
    const s = await getSettings();
    const cyc = cycleFor(tanggal, s.payrollDay);
    if (cyc && (!s.currentPeriod || cyc > s.currentPeriod)) await setSetting('currentPeriod', cyc);
  }

  /* ---------------- getInitialData ---------------- */
  async function getInitialData() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const [trx, cats, ents, assets, budgets, recurring, settings, snapRes] = await Promise.all([
      fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan', ['tanggal', 'id']),
      fetchAll('categories', 'tipe,name', ['tipe', 'name']),
      fetchAll('entities', 'grp,name', ['grp', 'name']),
      fetchAll('assets', 'id,name,type,symbol,quantity,buy_price,value', ['name', 'id']),
      fetchAll('budgets', 'id,kategori,bulan,jumlah', ['bulan', 'kategori']),
      fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,last_run,active', ['id']),
      getSettings(),
      sb.from('portfolio_snapshots')
        .select('tanggal,total_value,crypto_value,cash_value,other_value')
        .gte('tanggal', ymd(cutoff)).order('tanggal', { ascending: true })
    ]);
    fail(snapRes.error);

    const payrollDay = Number(settings.payrollDay) || 1;
    return {
      transactions: trx.map((t) => ({
        id: t.id, tanggal: t.tanggal, tipe: t.tipe, kategori: t.kategori,
        nominal: num(t.nominal), keterangan: t.keterangan || ''
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
      snapshots: snapRes.data.map((s) => ({
        tanggal: s.tanggal, total: num(s.total_value), crypto: num(s.crypto_value),
        cash: num(s.cash_value), other: num(s.other_value)
      })),
      recurring: recurring.map((r) => ({
        id: r.id, tipe: r.tipe, kategori: r.kategori, nominal: num(r.nominal),
        keterangan: r.keterangan || '', dayOfMonth: r.day_of_month,
        lastRun: r.last_run || '', active: String(r.active)
      })),
      currentPeriod: settings.currentPeriod || cycleFor(ymd(new Date()), payrollDay),
      payrollDay
    };
  }

  /* ---------------- Handler per fungsi server lama ---------------- */
  const trxRow = (d) => ({
    tanggal: String(d.tanggal || '').slice(0, 10),
    tipe: d.tipe,
    kategori: d.kategori,
    nominal: num(d.nominal),
    keterangan: d.keterangan || ''
  });

  const handlers = {
    getInitialData,

    async api_addTransaction(d) {
      const row = trxRow(d);
      const { error } = await sb.from('transactions').insert({ ...row, source: 'web' });
      fail(error);
      await syncPeriod(row.tanggal);
      return getInitialData();
    },
    async api_updateTransaction(id, d) {
      const row = trxRow(d);
      const { error } = await sb.from('transactions').update(row).eq('id', id);
      fail(error);
      await syncPeriod(row.tanggal);
      return getInitialData();
    },
    async api_deleteTransaction(id) {
      const { error } = await sb.from('transactions').delete().eq('id', id);
      fail(error);
      return getInitialData();
    },

    async api_addCategory(tipe, name) {
      const { error } = await sb.from('categories')
        .upsert({ tipe, name }, { onConflict: 'user_id,tipe,name', ignoreDuplicates: true });
      fail(error);
      return getInitialData();
    },

    async api_addEntity(group, name) {
      const { error } = await sb.from('entities')
        .upsert({ grp: group, name }, { onConflict: 'user_id,grp,name', ignoreDuplicates: true });
      fail(error);
      return getInitialData();
    },
    async api_updateEntity(group, oldName, newName) {
      const r1 = await sb.from('entities').update({ name: newName }).eq('grp', group).eq('name', oldName);
      fail(r1.error);
      // ikut ganti nama kategori utang/piutang di transaksi lama
      const r2 = await sb.from('transactions')
        .update({ kategori: group + ' - ' + newName })
        .eq('kategori', group + ' - ' + oldName);
      fail(r2.error);
      return getInitialData();
    },
    async api_deleteEntity(group, name) {
      const { error } = await sb.from('entities').delete().eq('grp', group).eq('name', name);
      fail(error);
      return getInitialData();
    },

    async api_addAssetV2(d) {
      const { error } = await sb.from('assets').insert({
        name: String(d.name || ''),
        type: String(d.type || 'Other'),
        symbol: String(d.symbol || '').toUpperCase(),
        quantity: num(d.quantity),
        buy_price: num(d.buyPrice),
        value: num(d.value)
      });
      fail(error);
      return getInitialData();
    },
    async api_deleteAsset(id) {
      const { error } = await sb.from('assets').delete().eq('id', id);
      fail(error);
      return getInitialData();
    },

    async api_saveBudget(kategori, bulan, jumlah) {
      if (!kategori || !bulan) return getInitialData();
      const { error } = await sb.from('budgets').upsert(
        { kategori, bulan: String(bulan).slice(0, 7), jumlah: Math.max(0, num(jumlah)) },
        { onConflict: 'user_id,kategori,bulan' }
      );
      fail(error);
      return getInitialData();
    },
    async api_deleteBudget(id) {
      const { error } = await sb.from('budgets').delete().eq('id', id);
      fail(error);
      return getInitialData();
    },
    async api_copyBudget(fromBulan, toBulan) {
      const fB = String(fromBulan || '').slice(0, 7);
      const tB = String(toBulan || '').slice(0, 7);
      if (!fB || !tB || fB === tB) return getInitialData();
      const all = await fetchAll('budgets', 'kategori,bulan,jumlah', ['kategori']);
      const have = new Set(all.filter((b) => b.bulan === tB).map((b) => b.kategori));
      const rows = all
        .filter((b) => b.bulan === fB && !have.has(b.kategori))
        .map((b) => ({ kategori: b.kategori, bulan: tB, jumlah: num(b.jumlah) }));
      if (rows.length) {
        const { error } = await sb.from('budgets').insert(rows);
        fail(error);
      }
      return getInitialData();
    },

    async api_savePayrollDay(day) {
      await setSetting('payrollDay', Math.max(1, Math.min(28, Number(day) || 1)));
      return true;
    },
    async api_savePeriod(period) {
      await setSetting('currentPeriod', period);
      return true;
    },

    async api_refreshPrices() {
      // Langkah 3: akan memanggil Edge Function "refresh-prices" (CoinGecko, key di secrets).
      throw new Error('Refresh harga crypto belum aktif (Edge Function refresh-prices belum dibuat).');
    },
    async api_resetDemo() {
      // Versi lama menghapus semua transaksi lalu mengisi data demo — dimatikan agar data asli aman.
      throw new Error('Reset demo dinonaktifkan pada versi Supabase.');
    }
  };

  // Menggantikan callServer() bawaan script.html (identifier global dicari saat dipanggil)
  window.callServer = async function (fn, ...args) {
    await ready;
    const h = handlers[fn];
    if (!h) throw new Error('Fungsi server belum tersedia: ' + fn);
    return h(...args);
  };
})();
