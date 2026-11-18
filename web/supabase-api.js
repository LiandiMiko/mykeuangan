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
          if (prof.status !== 'active') {
            alert('Akun Anda belum aktif. Hubungi administrator untuk bantuan.');
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

  let activeCheckPromise = null;
  async function checkActiveSession() {
    if (activeCheckPromise) return activeCheckPromise;
    activeCheckPromise = (async () => {
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (!authData.user) return;

      const { data: profile, error } = await sb.from('profiles')
        .select('status').eq('id', authData.user.id).maybeSingle();
      fail(error);
      if (!profile || profile.status !== 'active') {
        alert('Akun Anda tidak lagi aktif. Sesi akan ditutup.');
        await sb.auth.signOut();
        location.reload();
      }
    })();
    try {
      await activeCheckPromise;
    } finally {
      activeCheckPromise = null;
    }
  }

  function refreshActiveSession() {
    checkActiveSession().catch((error) => {
      console.warn('Pengecekan status akun gagal:', error);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshActiveSession();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') refreshActiveSession();
  }, 60000);

  function showLogin() {
    const isDark = localStorage.getItem('mode') === 'dark' || document.documentElement.classList.contains('dark');
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;' +
      'justify-content:center;background:#0f172a;padding:16px;font-family:Inter,system-ui,sans-serif';
    const cardBg = isDark ? '#1e293b' : '#ffffff';
    const textMain = isDark ? '#f8fafc' : '#0f172a';
    const textMuted = isDark ? '#94a3b8' : '#64748b';
    const labelColor = isDark ? '#cbd5e1' : '#334155';
    const inputBg = isDark ? '#0f172a' : '#ffffff';
    const inputBorder = isDark ? '#334155' : '#cbd5e1';
    const field = `width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid ${inputBorder};border-radius:10px;font-size:14px;background:${inputBg};color:${textMain}`;
    const passField = `width:100%;box-sizing:border-box;padding:10px 44px 10px 12px;border:1px solid ${inputBorder};border-radius:10px;font-size:14px;background:${inputBg};color:${textMain}`;
    const fieldLabel = `font-size:12px;font-weight:600;color:${labelColor}`;
    const toggleBtnStyle = `position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:${textMuted};font-size:11px;font-weight:700;cursor:pointer;padding:6px 8px`;
    let mode = 'login';
    let isSubmitting = false;

    const passInputGroup = (id, placeholder, autocomplete, minLen) => `
      <div style="position:relative">
        <input id="${id}" type="password" placeholder="${placeholder}" ${minLen ? `minlength="${minLen}"` : ''} required autocomplete="${autocomplete}" aria-describedby="mkErr" style="${passField}">
        <button type="button" data-toggle-pass="${id}" aria-label="Tampilkan atau sembunyikan kata sandi" style="${toggleBtnStyle}">Lihat</button>
      </div>
    `;

    function renderForm() {
      let content = '';
      if (mode === 'login') {
        content = `
          <h2 style="margin:0 0 4px;font-size:20px;color:${textMain};font-weight:800">Masuk ke Akun</h2>
          <p style="margin:0 0 12px;font-size:13px;color:${textMuted}">Kelola finansial dan portofolio Anda</p>
          <label for="mkEmail" style="${fieldLabel}">Alamat Email</label>
          <input id="mkEmail" type="email" placeholder="Alamat Email" required autocomplete="username" aria-describedby="mkErr" style="${field}">
          <label for="mkPass" style="${fieldLabel}">Kata Sandi</label>
          ${passInputGroup('mkPass', 'Kata Sandi', 'current-password', 0)}
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <a href="#" id="mkForgotLink" style="color:#3b82f6;text-decoration:none">Lupa kata sandi?</a>
          </div>
          <button type="submit" id="mkSubmitBtn" style="padding:11px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px">Masuk</button>
          <p style="margin:12px 0 0;font-size:13px;color:${textMuted};text-align:center">
            Belum punya akun? <a href="#" id="mkRegisterLink" style="color:#3b82f6;font-weight:700;text-decoration:none">Daftar sekarang</a>
          </p>
        `;
      } else if (mode === 'register') {
        content = `
          <h2 style="margin:0 0 4px;font-size:20px;color:${textMain};font-weight:800">Daftar Akun Baru</h2>
          <p style="margin:0 0 12px;font-size:13px;color:${textMuted}">Gratis dan instan untuk kelola keuangan</p>
          <label for="mkEmail" style="${fieldLabel}">Alamat Email</label>
          <input id="mkEmail" type="email" placeholder="Alamat Email" required autocomplete="username" aria-describedby="mkErr" style="${field}">
          <label for="mkPass" style="${fieldLabel}">Kata Sandi (min. 8 karakter)</label>
          ${passInputGroup('mkPass', 'Minimal 8 karakter', 'new-password', 8)}
          <label for="mkPassConfirm" style="${fieldLabel}">Ulangi Kata Sandi</label>
          ${passInputGroup('mkPassConfirm', 'Ulangi Kata Sandi', 'new-password', 8)}
          <button type="submit" id="mkSubmitBtn" style="padding:11px;border:0;border-radius:10px;background:#10b981;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px">Daftar Akun</button>
          <p style="margin:12px 0 0;font-size:13px;color:${textMuted};text-align:center">
            Sudah punya akun? <a href="#" id="mkLoginLink" style="color:#3b82f6;font-weight:700;text-decoration:none">Masuk di sini</a>
          </p>
        `;
      } else if (mode === 'forgot') {
        content = `
          <h2 style="margin:0 0 4px;font-size:20px;color:${textMain};font-weight:800">Reset Kata Sandi</h2>
          <p style="margin:0 0 12px;font-size:13px;color:${textMuted}">Masukkan email untuk menerima link reset</p>
          <label for="mkEmail" style="${fieldLabel}">Alamat Email</label>
          <input id="mkEmail" type="email" placeholder="Alamat Email Anda" required autocomplete="username" aria-describedby="mkErr" style="${field}">
          <button type="submit" id="mkSubmitBtn" style="padding:11px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px">Kirim Link Reset</button>
          <p style="margin:12px 0 0;font-size:13px;color:${textMuted};text-align:center">
            Kembali ke <a href="#" id="mkLoginLink" style="color:#3b82f6;font-weight:700;text-decoration:none">Halaman Masuk</a>
          </p>
        `;
      }

      el.innerHTML = `
        <div style="background:${cardBg};padding:32px 28px;border-radius:20px;width:min(92vw,370px);box-shadow:0 25px 50px -12px rgba(0,0,0,0.45);border:1px solid ${isDark ? '#334155' : 'transparent'}">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <div style="width:36px;height:36px;border-radius:10px;background:#2563eb;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900">M</div>
            <h1 style="margin:0;font-size:18px;color:${textMain};font-weight:800">MyKeuangan<span style="color:#3b82f6">Guech</span></h1>
          </div>
          <form id="mkAuthForm" style="display:grid;gap:10px">
            ${content}
            <p id="mkErr" role="status" aria-live="polite" style="margin:4px 0 0;color:#ef4444;font-size:12px;min-height:1em;text-align:center"></p>
          </form>
        </div>
      `;

      el.querySelectorAll('[data-toggle-pass]').forEach((btn) => {
        btn.onclick = () => {
          const input = el.querySelector('#' + btn.dataset.togglePass);
          if (!input) return;
          const showing = input.type === 'text';
          input.type = showing ? 'password' : 'text';
          btn.textContent = showing ? 'Lihat' : 'Tutup';
        };
      });

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
      errEl.style.color = '#ef4444';
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
          if (pass.length < 8 || pass.length > 128) {
            errEl.textContent = 'Kata sandi harus terdiri dari 8 sampai 128 karakter.';
            return;
          }
          if (pass !== passConfirm) { errEl.textContent = 'Konfirmasi kata sandi tidak cocok.'; return; }
          const { data, error } = await sb.auth.signUp({ email, password: pass });
          if (error) { errEl.textContent = 'Pendaftaran gagal: ' + error.message; return; }
          if (data.session) {
            el.remove();
            finishLogin(data.session);
          } else {
            errEl.style.color = '#10b981';
            errEl.textContent = 'Pendaftaran berhasil! Cek email untuk konfirmasi atau coba masuk.';
          }
        } else if (submitMode === 'forgot') {
          const { error } = await sb.auth.resetPasswordForEmail(email);
          if (error) { errEl.textContent = 'Gagal kirim reset: ' + error.message; return; }
          errEl.style.color = '#10b981';
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

  window.logout = async function () {
    try {
      await sb.auth.signOut();
    } finally {
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        } catch (cacheErr) {
          console.warn('Gagal membersihkan cache logout:', cacheErr);
        }
      }
      location.reload();
    }
  };

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
    if (cyc && (!s.currentPeriod || cyc > s.currentPeriod)) {
      await setSetting('currentPeriod', cyc);
      return cyc;
    }
    return s.currentPeriod || '';
  }

  /* ---------------- getInitialData ---------------- */
  async function getInitialData(options) {
    const includeTransactions = !options || options.includeTransactions !== false;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const [trx, cats, ents, assets, budgets, recurring, settings, snapRes, walletsRaw, transfers, goalRows] = await Promise.all([
      includeTransactions
        ? fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan,wallet_id', ['tanggal', 'id'])
        : Promise.resolve([]),
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
      fetchAll('transfers', 'id,tanggal,kind,from_wallet,to_wallet,nominal,fee,keterangan', ['tanggal', 'id']),
      fetchAll('financial_goals', 'id,name,target_amount,current_amount,target_date,created_at', ['created_at', 'id'])
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
      ...(includeTransactions ? {
        transactions: trx.map((t) => ({
          id: t.id, tanggal: t.tanggal, tipe: t.tipe, kategori: t.kategori,
          nominal: num(t.nominal), keterangan: t.keterangan || '', walletId: t.wallet_id || ''
        }))
      } : {}),
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
      goals: goalRows.map((goal) => ({
        id: goal.id,
        name: goal.name,
        targetAmount: num(goal.target_amount),
        currentAmount: num(goal.current_amount),
        targetDate: goal.target_date || ''
      })),
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
    const row = {
      tanggal: date,
      tipe: d.tipe,
      kategori: d.kategori.trim(),
      nominal: amount,
      keterangan: d.keterangan || ''
    };
    if (d.walletId) row.wallet_id = d.walletId;   // kosong → trigger database memakai dompet pertama (BCA)
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
    return {
      budgets: budgets.map((b) => ({ id: b.id, kategori: b.kategori, bulan: b.bulan, jumlah: num(b.jumlah) }))
    };
  };
  const fetchWalletsOnly = async () => {
    const wallets = await fetchAll('wallets', 'id,name,kind,opening_balance,sort', ['sort', 'name']);
    return {
      wallets: wallets.map((w) => ({
        id: w.id, name: w.name, kind: w.kind, openingBalance: num(w.opening_balance), sort: w.sort
      }))
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
        id: x.id, tanggal: x.tanggal, kind: x.kind, fromWallet: x.from_wallet || '', toWallet: x.to_wallet || '',
        nominal: num(x.nominal), fee: num(x.fee), keterangan: x.keterangan || ''
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
  const transactionFingerprint = (transaction, defaultWalletId) => [
    transaction.tanggal,
    transaction.tipe,
    String(transaction.kategori || '').trim().toLocaleLowerCase(),
    Number(transaction.nominal),
    String(transaction.keterangan || '').trim(),
    transaction.walletId || defaultWalletId || ''
  ].join('\u001f');
  const fetchTransactionsOnDates = async (dates) => {
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
  };

  const handlers = {
    getInitialData,

    async api_searchTransactions(filters) {
      const value = filters && typeof filters === 'object' ? filters : {};
      const start = String(value.start || '');
      const end = String(value.end || '');
      const validDate = (date) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
        const parsed = new Date(date + 'T00:00:00Z');
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
      };
      if (!validDate(start) || !validDate(end) || start > end) {
        throw new Error('Rentang tanggal laporan tidak valid.');
      }
      const type = String(value.type || '');
      if (type && type !== 'Pemasukan' && type !== 'Pengeluaran') {
        throw new Error('Tipe transaksi laporan tidak valid.');
      }
      const category = String(value.category || '');
      const walletId = String(value.walletId || '').trim() || null;
      const search = String(value.search || '').trim().slice(0, 100);
      const offset = Math.max(0, Math.min(1000000, Math.trunc(Number(value.offset) || 0)));
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(value.limit) || 20)));
      const baseParams = {
        p_start: start,
        p_end: end,
        p_type: type || null,
        p_category: category || null,
        p_search: search,
        p_offset: offset,
        p_limit: limit
      };
      let { data, error } = await sb.rpc('search_user_transactions', { ...baseParams, p_wallet_id: walletId });
      if (error && !walletId && /p_wallet_id|Could not find the function/i.test(error.message || '')) {
        const retry = await sb.rpc('search_user_transactions', baseParams);
        data = retry.data;
        error = retry.error;
      }
      fail(error);
      return {
        transactions: (data || []).map((row) => ({
          id: row.id,
          tanggal: row.tanggal,
          tipe: row.tipe,
          kategori: row.kategori,
          nominal: num(row.nominal),
          keterangan: row.keterangan || '',
          walletId: row.wallet_id || ''
        })),
        totalCount: data && data.length ? Number(data[0].total_count) || 0 : 0
      };
    },

    async api_addTransaction(d) {
      const row = trxRow(d);
      const { data, error } = await sb.from('transactions')
        .insert({ ...row, source: 'web' })
        .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id')
        .single();
      fail(error);
      const currentPeriod = await syncPeriod(row.tanggal);
      return {
        transaction: trxFromRow(data),
        ...(currentPeriod ? { currentPeriod } : {})
      };
    },
    async api_updateTransaction(id, d) {
      const row = trxRow(d);
      const { data, error } = await sb.from('transactions')
        .update(row).eq('id', id)
        .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id')
        .maybeSingle();
      fail(error);
      if (!data) throw new Error('Transaksi tidak ditemukan atau tidak dapat diakses.');
      const currentPeriod = await syncPeriod(row.tanggal);
      return {
        transaction: trxFromRow(data),
        ...(currentPeriod ? { currentPeriod } : {})
      };
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
        sb.from('wallets').select('id').order('sort', { ascending: true })
          .order('name', { ascending: true }).limit(1).maybeSingle()
      ]);
      fail(defaultWallet.error);
      const defaultWalletId = defaultWallet.data ? defaultWallet.data.id : '';
      const existingKeys = new Set(existing.map((row) => transactionFingerprint({
        ...row,
        walletId: row.wallet_id || ''
      }, defaultWalletId)));
      const batchKeys = new Set();
      const insertRows = [];
      rows.forEach((row) => {
        const transaction = {
          ...row,
          walletId: row.wallet_id || ''
        };
        const key = transactionFingerprint(transaction, defaultWalletId);
        if (!existingKeys.has(key) && !batchKeys.has(key)) {
          insertRows.push({ ...row, source: 'import' });
          batchKeys.add(key);
        }
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

    async api_saveGoal(goal) {
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
        const parsed = new Date(targetDate + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
            !Number.isFinite(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== targetDate) {
          throw new Error('Tanggal target tidak valid.');
        }
      }
      const row = {
        name,
        target_amount: targetAmount,
        current_amount: currentAmount,
        target_date: targetDate || null
      };
      let query = goal.id
        ? sb.from('financial_goals').update(row).eq('id', goal.id)
        : sb.from('financial_goals').insert(row);
      const { data, error } = await query
        .select('id,name,target_amount,current_amount,target_date,created_at')
        .maybeSingle();
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
        p_goal_id: d.goalId,
        p_amount: amount,
        p_wallet_id: d.walletId || null,
        p_date: date
      });
      fail(error);
      const payload = { goal: data && data.goal };
      if (data && data.transaction) {
        payload.transaction = data.transaction;
        const cats = await fetchCategoriesOnly();
        payload.categories = cats.categories;
      }
      return payload;
    },

    async api_deleteGoal(id) {
      const { data, error } = await sb.from('financial_goals')
        .delete().eq('id', id).select('id').maybeSingle();
      fail(error);
      if (!data) throw new Error('Target tidak ditemukan atau tidak dapat diakses.');
      return { deletedGoalId: data.id };
    },

    async api_addCategory(tipe, name) {
      const clean = String(name || '').trim();
      if (!clean) throw new Error('Nama kategori wajib diisi.');
      const { error } = await sb.from('categories')
        .upsert({ tipe, name: clean }, { onConflict: 'user_id,tipe,name', ignoreDuplicates: true });
      fail(error);
      return fetchCategoriesOnly();
    },
    async api_renameCategory(tipe, oldName, newName) {
      const cleanOld = String(oldName || '').trim();
      const cleanNew = String(newName || '').trim();
      if (!['pemasukan', 'pengeluaran'].includes(tipe)) throw new Error('Tipe kategori tidak valid.');
      if (!cleanOld || !cleanNew) throw new Error('Nama kategori wajib diisi.');
      const { error } = await sb.rpc('rename_category_with_transactions', {
        p_tipe: tipe,
        p_old_name: cleanOld,
        p_new_name: cleanNew
      });
      fail(error);
      const [cats, budgets, recurring] = await Promise.all([
        fetchCategoriesOnly(),
        fetchBudgetsOnly(),
        fetchRecurringOnly()
      ]);
      return {
        ...cats,
        ...budgets,
        ...recurring,
        renamedTransactionCategory: {
          from: cleanOld,
          to: cleanNew,
          tipe: tipe === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'
        }
      };
    },
    async api_deleteCategory(tipe, name) {
      if (!['pemasukan', 'pengeluaran'].includes(tipe)) throw new Error('Tipe kategori tidak valid.');
      const { error } = await sb.rpc('delete_category', { p_tipe: tipe, p_name: String(name || '') });
      fail(error);
      return fetchCategoriesOnly();
    },

    async api_addEntity(group, name) {
      const { error } = await sb.from('entities')
        .upsert({ grp: group, name }, { onConflict: 'user_id,grp,name', ignoreDuplicates: true });
      fail(error);
      return fetchEntitiesOnly();
    },
    async api_updateEntity(group, oldName, newName) {
      if (typeof newName !== 'string' || !newName.trim()) throw new Error('Nama entitas wajib diisi.');
      const { error } = await sb.rpc('rename_entity_with_transactions', {
        p_group: group,
        p_old_name: oldName,
        p_new_name: newName.trim()
      });
      fail(error);
      return {
        ...(await fetchEntitiesOnly()),
        renamedTransactionCategory: {
          from: group + ' - ' + oldName,
          to: group + ' - ' + newName.trim()
        }
      };
    },
    async api_deleteEntity(group, name) {
      const { error } = await sb.from('entities').delete().eq('grp', group).eq('name', name);
      fail(error);
      return fetchEntitiesOnly();
    },

    async api_addAssetV2(d) {
      if (!d || typeof d !== 'object') throw new Error('Data aset tidak valid.');
      if (d.walletId) {
        const name = String(d.name || '').trim();
        const type = String(d.type || 'Other');
        const quantity = num(d.quantity);
        const buyPrice = num(d.buyPrice);
        const amount = type === 'Crypto' ? quantity * buyPrice : num(d.value);
        const date = String(d.tanggal || ymd(new Date())).slice(0, 10);
        if (!name || !Number.isFinite(amount) || amount <= 0) {
          throw new Error('Nama aset dan nominal pembelian harus valid.');
        }
        if (type === 'Crypto' && (quantity <= 0 || buyPrice <= 0)) {
          throw new Error('Isi jumlah aset dan harga beli untuk mencatat sumber dana.');
        }
        const { data: transactions, error } = await sb.rpc('create_asset_with_expense', {
          p_name: name,
          p_type: type,
          p_symbol: String(d.symbol || '').toUpperCase(),
          p_quantity: quantity,
          p_buy_price: buyPrice,
          p_amount: amount,
          p_wallet_id: d.walletId,
          p_date: date
        });
        fail(error);
        if (!transactions || !transactions.length) {
          throw new Error('Pembelian aset tidak mengembalikan catatan transaksi.');
        }
        const [assetsRes, catsRes, currentPeriod] = await Promise.all([
          fetchAssetsOnly(),
          fetchCategoriesOnly(),
          syncPeriod(date)
        ]);
        return {
          ...assetsRes,
          ...catsRes,
          transaction: trxFromRow(transactions[0]),
          ...(currentPeriod ? { currentPeriod } : {})
        };
      }

      const { error } = await sb.from('assets').insert({
        name: String(d.name || ''),
        type: String(d.type || 'Other'),
        symbol: String(d.symbol || '').toUpperCase(),
        quantity: num(d.quantity),
        buy_price: num(d.buyPrice),
        value: num(d.value)
      });
      fail(error);
      return fetchAssetsOnly();
    },
    async api_deleteAsset(id) {
      const { error } = await sb.from('assets').delete().eq('id', id);
      fail(error);
      return fetchAssetsOnly();
    },
    async api_withdrawAsset(id, d) {
      const amount = Number(d && d.amount);
      const quantity = d && d.quantity !== '' && d.quantity != null ? Number(d.quantity) : null;
      const date = String((d && d.tanggal) || ymd(new Date())).slice(0, 10);
      if (!Number.isFinite(amount) || amount <= 0 ||
          (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))) {
        throw new Error('Nominal atau jumlah pencairan aset tidak valid.');
      }
      const { data: transactions, error } = await sb.rpc('liquidate_asset', {
        p_asset_id: id,
        p_amount: amount,
        p_quantity: quantity,
        p_wallet_id: (d && d.walletId) || null,
        p_date: date
      });
      fail(error);
      const assetsRes = await fetchAssetsOnly();
      if (d && d.walletId && transactions && transactions.length) {
        const [catsRes, currentPeriod] = await Promise.all([
          fetchCategoriesOnly(),
          syncPeriod(date)
        ]);
        return {
          ...assetsRes,
          ...catsRes,
          transaction: trxFromRow(transactions[0]),
          ...(currentPeriod ? { currentPeriod } : {})
        };
      }
      return assetsRes;
    },

    async api_saveBudget(kategori, bulan, jumlah) {
      const amount = Number(jumlah);
      if (typeof kategori !== 'string' || !kategori.trim() ||
          typeof bulan !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan) ||
          !Number.isFinite(amount) || amount < 0) {
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
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fB) ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(tB) || fB === tB) {
        throw new Error('Periode budget tidak valid.');
      }
      const all = await fetchAll('budgets', 'kategori,bulan,jumlah', ['kategori']);
      const have = new Set(all.filter((b) => b.bulan === tB).map((b) => b.kategori));
      const rows = all
        .filter((b) => b.bulan === fB && !have.has(b.kategori))
        .map((b) => ({ kategori: b.kategori, bulan: tB, jumlah: num(b.jumlah) }));
      if (rows.length) {
        const { error } = await sb.from('budgets').insert(rows);
        fail(error);
      }
      return fetchBudgetsOnly();
    },

    async api_savePayrollDay(day) {
      await setSetting('payrollDay', Math.max(1, Math.min(28, Number(day) || 1)));
      return true;
    },
    async api_savePeriod(period) {
      await setSetting('currentPeriod', period);
      return true;
    },

    /* ---------- Transaksi berulang (Recurring) ---------- */
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
        tipe,
        kategori,
        nominal,
        keterangan: String(d.keterangan || '').trim(),
        day_of_month: dayOfMonth,
        active: d.active === undefined ? true : Boolean(d.active)
      };
      const query = d.id
        ? sb.from('recurring').update(row).eq('id', d.id)
        : sb.from('recurring').insert(row);
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

    /* ---------- Dompet, transfer, tarik tunai ---------- */
    async api_addWallet(d) {
      if (!d || typeof d !== 'object') throw new Error('Data dompet tidak valid.');
      const name = String(d.name || '').trim();
      const kind = String(d.kind || '');
      const openingBalance = Number(d.openingBalance);
      if (!name || name.length > 80) throw new Error('Nama dompet wajib diisi maksimal 80 karakter.');
      if (!['bank', 'cash', 'ewallet'].includes(kind)) throw new Error('Jenis dompet tidak valid.');
      if (!Number.isFinite(openingBalance) || openingBalance < 0) {
        throw new Error('Saldo awal harus berupa angka nol atau lebih.');
      }

      const { data: lastWallet, error: sortError } = await sb.from('wallets')
        .select('sort').order('sort', { ascending: false }).limit(1).maybeSingle();
      fail(sortError);
      const sort = (lastWallet && Number(lastWallet.sort) || 0) + 1;
      const { error } = await sb.from('wallets').insert({
        name,
        kind,
        opening_balance: openingBalance,
        sort
      });
      fail(error);
      return fetchWalletsOnly();
    },
    async api_updateWallet(id, d) {
      const patch = {};
      if (d.name && String(d.name).trim()) patch.name = String(d.name).trim();
      if (d.kind && ['bank', 'cash', 'ewallet'].includes(String(d.kind))) patch.kind = String(d.kind);
      if (d.openingBalance !== undefined && d.openingBalance !== null && isFinite(Number(d.openingBalance))) {
        patch.opening_balance = Number(d.openingBalance);
      }
      const { error } = await sb.from('wallets').update(patch).eq('id', id);
      fail(error);
      return fetchWalletsOnly();
    },
    async api_deleteWallet(id) {
      const { error } = await sb.rpc('delete_wallet', { p_wallet_id: id });
      fail(error);
      const [wt, trx] = await Promise.all([
        fetchWalletsAndTransfers(),
        fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan,wallet_id', ['tanggal', 'id'])
      ]);
      return {
        ...wt,
        transactions: trx.map(trxFromRow)
      };
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
      return fetchWalletsAndTransfers();
    },
    async api_deleteTransfer(id) {
      const { error } = await sb.from('transfers').delete().eq('id', id);
      fail(error);
      return fetchWalletsAndTransfers();
    },

    /* ---------- Tambah nilai aset yang sudah ada (top-up) ---------- */
    async api_topUpAsset(id, d) {
      const amount = Number(d.amount);
      const price = d.price === '' || d.price == null ? null : Number(d.price);
      const quantity = d.quantity === '' || d.quantity == null ? null : Number(d.quantity);
      const date = String(d.tanggal || ymd(new Date())).slice(0, 10);
      if (!Number.isFinite(amount) || amount <= 0 ||
          (price !== null && (!Number.isFinite(price) || price < 0)) ||
          (quantity !== null && (!Number.isFinite(quantity) || quantity < 0))) {
        throw new Error('Nominal, harga, atau jumlah aset tidak valid.');
      }
      const { error } = await sb.rpc('top_up_asset', {
        p_asset_id: id,
        p_amount: amount,
        p_price: price,
        p_quantity: quantity,
        p_wallet_id: d.walletId || null,
        p_date: date
      });
      fail(error);
      return d.walletId
        ? { ...(await fetchAssetsOnly()), ...(await fetchWalletsAndTransfers()) }
        : fetchAssetsOnly();
    },

    async api_refreshPrices() {
      // Edge Function (CoinGecko, key di secrets) — memakai JWT login Anda
      const { data, error } = await sb.functions.invoke('telegram-bot', { body: { job: 'refresh_prices' } });
      if (error) throw new Error('Refresh harga gagal: ' + (error.message || error));
      if (data && data.error) throw new Error(data.error);
      if (data && data.updated === 0 && data.missing && data.missing.length) {
        throw new Error('Simbol belum didukung: ' + data.missing.join(', '));
      }
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
      const [assetsRes, snapRes] = await Promise.all([
        fetchAssetsOnly(),
        sb.from('portfolio_snapshots')
          .select('tanggal,total_value,crypto_value,cash_value,other_value')
          .gte('tanggal', ymd(cutoff)).order('tanggal', { ascending: true })
      ]);
      fail(snapRes.error);
      return {
        ...assetsRes,
        snapshots: (snapRes.data || []).map((s) => ({
          tanggal: s.tanggal, total: num(s.total_value), crypto: num(s.crypto_value),
          cash: num(s.cash_value), other: num(s.other_value)
        }))
      };
    },
    /* ---------- Admin Panel & User Management ---------- */
    async api_getAdminData() {
      if (sessionRole !== 'admin') throw new Error('Akses ditolak: Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (!authData.user) throw new Error('Sesi login tidak valid. Silakan masuk kembali.');
      const [profiles, statsRes] = await Promise.all([
        fetchAll('profiles', 'id,email,display_name,role,status,created_at', ['created_at']),
        sb.rpc('get_admin_platform_stats')
      ]);

      let stats;
      if (!statsRes.error && Array.isArray(statsRes.data) && statsRes.data.length) {
        const s = statsRes.data[0];
        stats = {
          totalUsers: Number(s.total_users) || profiles.length,
          activeUsers: Number(s.active_users) || 0,
          suspendedUsers: Number(s.suspended_users) || 0,
          totalTelegramChats: Number(s.total_telegram_chats) || 0,
          totalTransactions: Number(s.total_transactions) || 0
        };
      } else {
        const chCount = await sb.from('telegram_chats').select('chat_id', { count: 'exact', head: true });
        fail(chCount.error);
        stats = {
          totalUsers: profiles.length,
          activeUsers: profiles.filter(p => p.status === 'active').length,
          suspendedUsers: profiles.filter(p => p.status === 'suspended').length,
          totalTelegramChats: chCount.count || 0
        };
      }

      return {
        users: profiles,
        currentUserId: authData.user.id,
        stats
      };
    },
    async api_setUserStatus(userId, status) {
      if (sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (authData.user && authData.user.id === userId && status !== 'active') {
        throw new Error('Admin tidak dapat menonaktifkan akunnya sendiri.');
      }
      const { error } = await sb.from('profiles').update({ status }).eq('id', userId);
      fail(error);
      return true;
    },
    async api_setUserRole(userId, role) {
      if (sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (authData.user && authData.user.id === userId && role !== 'admin') {
        throw new Error('Admin tidak dapat menurunkan role akunnya sendiri.');
      }
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
      if (!window.crypto || !window.crypto.getRandomValues) {
        throw new Error('Browser ini tidak mendukung pembuatan kode pairing yang aman.');
      }
      const sample = new Uint32Array(1);
      const ceiling = Math.floor(0x100000000 / 100000000) * 100000000;
      let value;
      do {
        window.crypto.getRandomValues(sample);
        value = sample[0];
      } while (value >= ceiling);
      const otp = String(value % 100000000).padStart(8, '0');
      const { error } = await sb.rpc('replace_telegram_pairing', { p_otp: otp });
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