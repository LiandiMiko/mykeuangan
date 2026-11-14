/* supabase-api.js — pengganti google.script.run untuk MyKeuanganGuech.
 * Mengganti callServer() dari script.html: semua pemanggilan api_* lama
 * diterjemahkan ke Supabase dan mengembalikan payload getInitialData()
 * dengan bentuk yang sama seperti versi Apps Script. */
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

  /* ---------------- Login ---------------- */
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  async function finishLogin(session) {
    const user = session && session.user;
    const email = (user && user.email) || '';
    try {
      sessionUser = email.split('@')[0] || 'User';
      const uEl = document.getElementById('ui-username');
      if (uEl) uEl.textContent = sessionUser;

      // Ambil profil & role pengguna dari public.profiles
      if (user && user.id) {
        const { data: prof, error } = await sb.from('profiles').select('display_name,role,status').eq('id', user.id).maybeSingle();
        fail(error);
        if (!prof) throw new Error('Profil akun belum tersedia. Hubungi administrator untuk menyelesaikan penyiapan akun.');
        if (prof) {
          if (prof.status === 'suspended') {
            alert('Akun Anda dinonaktifkan oleh administrator.');
            await sb.auth.signOut();
            location.reload();
            return;
          }
          if (prof.display_name) {
            sessionUser = prof.display_name;
            if (uEl) uEl.textContent = sessionUser;
          }
          sessionRole = prof.role || 'user';
          const rEl = document.getElementById('ui-role');
          if (rEl) rEl.textContent = sessionRole.toUpperCase();
          if (sessionRole === 'admin') {
            const admNav = document.getElementById('nav-admin');
            if (admNav) admNav.style.display = 'flex';
          }
        }
      }
    } catch (e) {
      console.error('finishLogin', e);
      alert('Tidak dapat memuat profil akun: ' + (e.message || String(e)));
    }
    readyResolve();
  }

  function showLogin() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;background:#0f172a;font-family:system-ui,sans-serif';
    const field = 'padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none';
    let mode = 'login';
    let isSubmitting = false;

    function renderForm() {
      let content = '';
      if (mode === 'login') {
        content = `
          <h2 style="margin:0 0 4px;font-size:20px;color:#0f172a;font-weight:800">Masuk ke Akun</h2>
          <p style="margin:0 0 12px;font-size:13px;color:#64748b">Kelola finansial dan portofolio Anda</p>
          <input id="mkEmail" type="email" placeholder="Alamat Email" required autocomplete="username" style="${field}">
          <input id="mkPass" type="password" placeholder="Kata Sandi" required autocomplete="current-password" style="${field}">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <a href="#" id="mkForgotLink" style="color:#2563eb;text-decoration:none">Lupa kata sandi?</a>
          </div>
          <button type="submit" id="mkSubmitBtn" style="padding:10px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px">Masuk</button>
          <p style="margin:12px 0 0;font-size:13px;color:#64748b;text-align:center">
            Belum punya akun? <a href="#" id="mkRegisterLink" style="color:#2563eb;font-weight:700;text-decoration:none">Daftar sekarang</a>
          </p>
        `;
      } else if (mode === 'register') {
        content = `
          <h2 style="margin:0 0 4px;font-size:20px;color:#0f172a;font-weight:800">Daftar Akun Baru</h2>
          <p style="margin:0 0 12px;font-size:13px;color:#64748b">Gratis dan instan untuk kelola keuangan</p>
          <input id="mkEmail" type="email" placeholder="Alamat Email" required autocomplete="username" style="${field}">
          <input id="mkPass" type="password" placeholder="Kata Sandi (min. 6 karakter)" minlength="6" required autocomplete="new-password" style="${field}">
          <input id="mkPassConfirm" type="password" placeholder="Ulangi Kata Sandi" minlength="6" required autocomplete="new-password" style="${field}">
          <button type="submit" id="mkSubmitBtn" style="padding:10px;border:0;border-radius:10px;background:#10b981;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px">Daftar Akun</button>
          <p style="margin:12px 0 0;font-size:13px;color:#64748b;text-align:center">
            Sudah punya akun? <a href="#" id="mkLoginLink" style="color:#2563eb;font-weight:700;text-decoration:none">Masuk di sini</a>
          </p>
        `;
      } else if (mode === 'forgot') {
        content = `
          <h2 style="margin:0 0 4px;font-size:20px;color:#0f172a;font-weight:800">Reset Kata Sandi</h2>
          <p style="margin:0 0 12px;font-size:13px;color:#64748b">Masukkan email untuk menerima link reset</p>
          <input id="mkEmail" type="email" placeholder="Alamat Email Anda" required autocomplete="username" style="${field}">
          <button type="submit" id="mkSubmitBtn" style="padding:10px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px">Kirim Link Reset</button>
          <p style="margin:12px 0 0;font-size:13px;color:#64748b;text-align:center">
            Kembali ke <a href="#" id="mkLoginLink" style="color:#2563eb;font-weight:700;text-decoration:none">Halaman Masuk</a>
          </p>
        `;
      }

      el.innerHTML = `
        <div style="background:#fff;padding:32px 28px;border-radius:20px;width:min(92vw,360px);box-shadow:0 25px 50px -12px rgba(0,0,0,0.35)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <div style="width:36px;height:36px;border-radius:10px;background:#2563eb;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900">M</div>
            <h1 style="margin:0;font-size:18px;color:#0f172a;font-weight:800">MyKeuangan<span style="color:#2563eb">Guech</span></h1>
          </div>
          <form id="mkAuthForm" style="display:grid;gap:10px">
            ${content}
            <p id="mkErr" style="margin:4px 0 0;color:#dc2626;font-size:12px;min-height:1em;text-align:center"></p>
          </form>
        </div>
      `;

      const regLink = el.querySelector('#mkRegisterLink');
      if (regLink) regLink.onclick = (e) => { e.preventDefault(); if (!isSubmitting) { mode = 'register'; renderForm(); } };
      const logLink = el.querySelector('#mkLoginLink');
      if (logLink) logLink.onclick = (e) => { e.preventDefault(); if (!isSubmitting) { mode = 'login'; renderForm(); } };
      const forLink = el.querySelector('#mkForgotLink');
      if (forLink) forLink.onclick = (e) => { e.preventDefault(); if (!isSubmitting) { mode = 'forgot'; renderForm(); } };

      el.querySelector('#mkAuthForm').onsubmit = handleAuthSubmit;
    }

    async function handleAuthSubmit(e) {
      e.preventDefault();
      if (isSubmitting) return;

      isSubmitting = true;
      const errEl = el.querySelector('#mkErr');
      const submitBtn = el.querySelector('#mkSubmitBtn');
      const submitLabel = submitBtn.textContent;
      const submitMode = mode;
      errEl.textContent = '';
      errEl.style.color = '#dc2626';
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.style.opacity = '0.7';
      submitBtn.textContent = 'Memproses...';

      try {
        const email = el.querySelector('#mkEmail').value.trim();

        if (submitMode === 'login') {
          const pass = el.querySelector('#mkPass').value;
          const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
          if (error) { errEl.textContent = 'Gagal masuk: ' + error.message; return; }
          el.remove();
          finishLogin(data.session);
        } else if (submitMode === 'register') {
          const pass = el.querySelector('#mkPass').value;
          const passConfirm = el.querySelector('#mkPassConfirm').value;
          if (pass !== passConfirm) { errEl.textContent = 'Konfirmasi kata sandi tidak cocok.'; return; }
          const { data, error } = await sb.auth.signUp({ email, password: pass });
          if (error) { errEl.textContent = 'Pendaftaran gagal: ' + error.message; return; }
          if (data.session) {
            el.remove();
            finishLogin(data.session);
          } else {
            errEl.style.color = '#059669';
            errEl.textContent = 'Pendaftaran berhasil! Cek email untuk konfirmasi atau coba masuk.';
          }
        } else if (submitMode === 'forgot') {
          const { error } = await sb.auth.resetPasswordForEmail(email);
          if (error) { errEl.textContent = 'Gagal kirim reset: ' + error.message; return; }
          errEl.style.color = '#059669';
          errEl.textContent = 'Link reset berhasil dikirim ke email Anda.';
        }
      } catch (error) {
        const action = submitMode === 'register' ? 'Pendaftaran gagal: ' :
          (submitMode === 'forgot' ? 'Gagal kirim reset: ' : 'Gagal masuk: ');
        errEl.textContent = action + (error.message || String(error));
      } finally {
        isSubmitting = false;
        const currentSubmitBtn = el.querySelector('#mkSubmitBtn');
        if (currentSubmitBtn) {
          currentSubmitBtn.disabled = false;
          currentSubmitBtn.removeAttribute('aria-busy');
          currentSubmitBtn.style.cursor = 'pointer';
          currentSubmitBtn.style.opacity = '';
          currentSubmitBtn.textContent = submitLabel;
        }
      }
    }

    document.body.appendChild(el);
    renderForm();
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
    const [trx, cats, ents, assets, budgets, recurring, settings, snapRes, walletsRaw, transfers] = await Promise.all([
      fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan,wallet_id', ['tanggal', 'id']),
      fetchAll('categories', 'tipe,name', ['tipe', 'name']),
      fetchAll('entities', 'grp,name', ['grp', 'name']),
      fetchAll('assets', 'id,name,type,symbol,quantity,buy_price,value', ['name', 'id']),
      fetchAll('budgets', 'id,kategori,bulan,jumlah', ['bulan', 'kategori']),
      fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,last_run,active', ['id']),
      getSettings(),
      sb.from('portfolio_snapshots')
        .select('tanggal,total_value,crypto_value,cash_value,other_value')
        .gte('tanggal', ymd(cutoff)).order('tanggal', { ascending: true }),
      fetchAll('wallets', 'id,name,kind,opening_balance,sort', ['sort', 'name']),
      fetchAll('transfers', 'id,tanggal,kind,from_wallet,to_wallet,nominal,fee,keterangan', ['tanggal', 'id'])
    ]);
    fail(snapRes.error);

    // Pertama kali dipakai: buat dompet standar BCA + Cash
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
    return {
      transactions: trx.map((t) => ({
        id: t.id, tanggal: t.tanggal, tipe: t.tipe, kategori: t.kategori,
        nominal: num(t.nominal), keterangan: t.keterangan || '', walletId: t.wallet_id || ''
      })),
      wallets: wallets.map((w) => ({
        id: w.id, name: w.name, kind: w.kind, openingBalance: num(w.opening_balance), sort: w.sort
      })),
      transfers: transfers.map((x) => ({
        id: x.id, tanggal: x.tanggal, kind: x.kind, fromWallet: x.from_wallet || '', toWallet: x.to_wallet || '',
        nominal: num(x.nominal), fee: num(x.fee), keterangan: x.keterangan || ''
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
  const trxRow = (d) => {
    const row = {
      tanggal: String(d.tanggal || '').slice(0, 10),
      tipe: d.tipe,
      kategori: d.kategori,
      nominal: num(d.nominal),
      keterangan: d.keterangan || ''
    };
    if (d.walletId) row.wallet_id = d.walletId;   // kosong → trigger database memakai dompet pertama (BCA)
    return row;
  };

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

    /* ---------- Dompet, transfer, tarik tunai ---------- */
    async api_updateWallet(id, d) {
      const patch = {};
      if (d.name && String(d.name).trim()) patch.name = String(d.name).trim();
      if (d.openingBalance !== undefined && d.openingBalance !== null && isFinite(Number(d.openingBalance))) {
        patch.opening_balance = Number(d.openingBalance);
      }
      const { error } = await sb.from('wallets').update(patch).eq('id', id);
      fail(error);
      return getInitialData();
    },
    async api_addTransfer(d) {
      const nominal = num(d.nominal);
      if (nominal <= 0) throw new Error('Nominal harus lebih dari 0');
      if (d.kind !== 'investasi' && (!d.fromWallet || !d.toWallet || d.fromWallet === d.toWallet)) {
        throw new Error('Pilih dompet asal dan tujuan yang berbeda');
      }
      const { error } = await sb.from('transfers').insert({
        tanggal: String(d.tanggal || ymd(new Date())).slice(0, 10),
        kind: d.kind || 'transfer',
        from_wallet: d.fromWallet || null,
        to_wallet: d.toWallet || null,
        nominal,
        fee: Math.max(0, num(d.fee)),
        keterangan: d.keterangan || ''
      });
      fail(error);
      return getInitialData();
    },
    async api_deleteTransfer(id) {
      const { error } = await sb.from('transfers').delete().eq('id', id);
      fail(error);
      return getInitialData();
    },

    /* ---------- Tambah nilai aset yang sudah ada (top-up) ---------- */
    async api_topUpAsset(id, d) {
      const { data: a, error } = await sb.from('assets').select('*').eq('id', id).single();
      fail(error);
      const amount = num(d.amount);                       // uang yang dikeluarkan (Rp)
      if (amount <= 0) throw new Error('Nominal harus lebih dari 0');

      const oldQty = num(a.quantity), oldBuy = num(a.buy_price), oldVal = num(a.value);
      const patch = {};
      if (String(a.type).toLowerCase() === 'crypto') {
        let price = num(d.price);                         // harga per koin saat beli (opsional)
        if (!price && oldQty > 0 && oldVal > 0) price = oldVal / oldQty;   // harga terakhir yang tersimpan
        let addQty = num(d.quantity);                     // jumlah koin yang didapat (opsional)
        if (!addQty) {
          if (!price) throw new Error('Harga koin belum diketahui. Isi jumlah koin atau harga per koin.');
          addQty = amount / price;
        }
        const newQty = oldQty + addQty;
        patch.quantity = newQty;
        patch.value = Math.round(oldVal + amount);        // dikoreksi otomatis saat harga di-refresh
        // harga beli rata-rata tertimbang; bila harga beli lama tidak diketahui, tetap tidak diketahui
        patch.buy_price = oldQty === 0 ? Math.round(amount / addQty)
          : (oldBuy > 0 ? Math.round((oldQty * oldBuy + amount) / newQty) : 0);
      } else {
        patch.value = Math.round(oldVal + amount);
      }

      const up = await sb.from('assets').update(patch).eq('id', id);
      fail(up.error);

      if (d.walletId) {                                   // uang berasal dari dompet → saldo dompet berkurang
        const tr = await sb.from('transfers').insert({
          tanggal: String(d.tanggal || ymd(new Date())).slice(0, 10),
          kind: 'investasi',
          from_wallet: d.walletId,
          to_wallet: null,
          nominal: amount,
          keterangan: 'Top-up ' + a.name
        });
        if (tr.error) {                                   // batalkan perubahan aset agar tidak setengah jalan
          await sb.from('assets').update({ quantity: a.quantity, buy_price: a.buy_price, value: a.value }).eq('id', id);
          fail(tr.error);
        }
      }
      return getInitialData();
    },

    async api_refreshPrices() {
      // Edge Function (CoinGecko, key di secrets) — memakai JWT login Anda
      const { data, error } = await sb.functions.invoke('telegram-bot', { body: { job: 'refresh_prices' } });
      if (error) throw new Error('Refresh harga gagal: ' + (error.message || error));
      if (data && data.error) throw new Error(data.error);
      if (data && data.updated === 0 && data.missing && data.missing.length) {
        throw new Error('Simbol belum didukung: ' + data.missing.join(', '));
      }
      return getInitialData();
    },
    /* ---------- Admin Panel & User Management ---------- */
    async api_getAdminData() {
      if (sessionRole !== 'admin') throw new Error('Akses ditolak: Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (!authData.user) throw new Error('Sesi login tidak valid. Silakan masuk kembali.');
      const [profiles, chCount] = await Promise.all([
        fetchAll('profiles', 'id,email,display_name,role,status,created_at', ['created_at']),
        sb.from('telegram_chats').select('chat_id', { count: 'exact', head: true })
      ]);
      fail(chCount.error);
      return {
        users: profiles,
        currentUserId: authData.user.id,
        stats: {
          totalUsers: profiles.length,
          activeUsers: profiles.filter(p => p.status === 'active').length,
          suspendedUsers: profiles.filter(p => p.status === 'suspended').length,
          totalTelegramChats: chCount.count || 0
        }
      };
    },
    async api_setUserStatus(userId, status) {
      if (sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { error } = await sb.from('profiles').update({ status }).eq('id', userId);
      fail(error);
      return true;
    },
    async api_setUserRole(userId, role) {
      if (sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
      fail(error);
      return true;
    },
    async api_updateOwnPassword(password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('Password harus terdiri dari 8 sampai 128 karakter.');
      }
      const { error } = await sb.auth.updateUser({ password });
      fail(error);
    },
    async api_adminSetPassword(userId, password) {
      if (sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('Password harus terdiri dari 8 sampai 128 karakter.');
      }
      const { data, error } = await sb.functions.invoke('admin-password', {
        body: { userId, password }
      });
      if (error) {
        let message = error.message || 'Reset password gagal.';
        const response = error.context;
        if (response && typeof response.json === 'function') {
          try {
            const details = await response.json();
            if (details && typeof details.error === 'string') message = details.error;
          } catch (parseError) {
            console.error('Gagal membaca detail error admin-password:', parseError);
          }
        }
        throw new Error(message);
      }
      if (!data || data.success !== true) throw new Error(data && data.error || 'Reset password gagal.');
    },

    /* ---------- Telegram Pairing (Self-Service) ---------- */
    async api_generateTelegramOTP() {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const { error } = await sb.from('telegram_pairings').insert({ otp });
      fail(error);
      return otp;
    },

  };

  // Menggantikan callServer() bawaan script.html (identifier global dicari saat dipanggil)
  window.callServer = async function (fn, ...args) {
    await ready;
    const h = handlers[fn];
    if (!h) throw new Error('Fungsi server belum tersedia: ' + fn);
    return h(...args);
  };
})();