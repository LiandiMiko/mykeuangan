/* supabase-portfolio.js — wallets, transfers, assets & resilient live market price refresh */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, num, ymd, syncPeriod, trxFromRow, fetchAll, fetchCategoriesOnly, fetchWalletsOnly, fetchWalletsAndTransfers, fetchAssetsOnly, createConflictError, loadVersionedRow, resolveExpectedVersion } = core;

  const walletVersionColumns = 'id,name,kind,opening_balance,sort,version';

  const CRYPTO_ID_MAP = {
    BTC: 'bitcoin', ETH: 'ethereum', ONDO: 'ondo-finance', TAO: 'bittensor', SOL: 'solana', ADA: 'cardano',
    DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token', USDT: 'tether', USDC: 'usd-coin',
    BNB: 'binancecoin', XRP: 'ripple', DOGE: 'dogecoin', AVAX: 'avalanche-2', LINK: 'chainlink', PEPE: 'pepe',
    SHIB: 'shiba-inu', ARB: 'arbitrum', OP: 'optimism', SUI: 'sui', TON: 'the-open-network', LTC: 'litecoin',
    BCH: 'bitcoin-cash', NEAR: 'near', APT: 'aptos', RENDER: 'render-token', PAXG: 'pax-gold', TRX: 'tron',
    XLM: 'stellar', UNI: 'uniswap', AAVE: 'aave', ATOM: 'cosmos', FIL: 'filecoin', ICP: 'internet-computer',
    ETC: 'ethereum-classic', HBAR: 'hedera-hashgraph', VET: 'vechain', ALGO: 'algorand', INJ: 'injective-protocol',
    SEI: 'sei-network', TIA: 'celestia', STX: 'blockstack', WIF: 'dogwifcoin', BONK: 'bonk', FLOKI: 'floki',
    FET: 'fetch-ai', ENA: 'ethena', KAS: 'kaspa', BGB: 'bitget-token', OKB: 'okb', CRO: 'crypto-com-chain',
    MNT: 'mantle', WBTC: 'wrapped-bitcoin', XAUT: 'tether-gold', HYPE: 'hyperliquid', PI: 'pi-network'
  };

  const MAX_NOMINAL = 999999999999.99;

  // Saldo turunan satu dompet dari state yang sudah diambil
  // (web/finance-analysis-core.js: aturan cashDelta yang sama).
  // Dipakai pre-check klien di api_addTransfer — UX saja; kontrol
  // sebenarnya ada di RPC transfer_between_wallets (ada jeda TOCTOU
  // antara cek ini dan eksekusi server, hanya server yang menutupnya).
  function computeWalletBalanceFromState(state, walletId) {
    const wallets = (state && Array.isArray(state.wallets)) ? state.wallets : [];
    const wallet = wallets.find((w) => String(w.id) === String(walletId));
    if (!wallet) return null;
    const defaultWalletId = wallets.length ? wallets[0].id : null;
    let balance = Number(wallet.openingBalance) || 0;
    const cashDelta = (t) => {
      const cat = String(t.kategori || '');
      const amount = Number(t.nominal) || 0;
      if (/^piutang/i.test(cat)) return t.tipe === 'Pemasukan' ? amount : -amount;
      if (/^utang/i.test(cat)) return t.tipe === 'Pemasukan' ? 0 : -amount;
      return t.tipe === 'Pemasukan' ? amount : -amount;
    };
    (Array.isArray(state.transactions) ? state.transactions : []).forEach((t) => {
      const wid = (t.walletId && wallets.some((w) => String(w.id) === String(t.walletId))) ? t.walletId : defaultWalletId;
      if (String(wid) === String(walletId)) balance += cashDelta(t);
    });
    (Array.isArray(state.transfers) ? state.transfers : []).forEach((x) => {
      const n = Number(x.nominal) || 0;
      const f = Number(x.fee) || 0;
      if (String(x.fromWallet) === String(walletId)) balance -= (n + f);
      if (String(x.toWallet) === String(walletId)) balance += n;
    });
    return balance;
  }

  function checkTransferBalancePrecondition(d, nominal, fee) {
    // Hanya bila state global DB tersedia (browser). Tanpa DB (mis.
    // konteks tes / worker), lewati — RPC tetap menegakkan saldo.
    if (typeof DB === 'undefined' || !DB || typeof DB !== 'object') return;
    const wallets = Array.isArray(DB.wallets) ? DB.wallets : [];
    if (!wallets.some((w) => String(w.id) === String(d.fromWallet))) {
      throw new Error('Dompet asal tidak ditemukan.');
    }
    const balance = computeWalletBalanceFromState(DB, d.fromWallet);
    if (balance === null) throw new Error('Dompet asal tidak ditemukan.');
    if (balance < nominal + fee) {
      throw new Error('Saldo dompet asal tidak mencukupi untuk transfer ini.');
    }
  }

  async function extractEdgeErrorMessage(error, defaultMessage) {
    let msg = (error && error.message) ? error.message : defaultMessage;
    const res = error && error.context;
    if (res && typeof res.json === 'function') {
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string' && body.error.trim()) msg = body.error.trim();
      } catch (_) { /* ignore non-JSON error body */ }
    }
    return msg;
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    if (typeof fetch !== 'function') throw new Error('Fetch API tidak tersedia.');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 10000) : null;
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchCurrencyApiIdrRates() {
    // Versi dipin ke 2026.11.27 (latest stabil saat Wave 3.5, diverifikasi
    // dari registry npm) — sama dengan pin di
    // supabase/functions/telegram-bot/jobs.ts. Jangan pakai @latest:
    // rilis baru upstream bisa mengubah format tanpa pemberitahuan.
    const urls = [
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026.11.27/v1/currencies/idr.min.json',
      'https://latest.currency-api.pages.dev/v1/currencies/idr.min.json'
    ];
    for (const url of urls) {
      try {
        const json = await fetchJsonWithTimeout(url, 10000);
        if (json && json.idr && typeof json.idr === 'object') return json.idr;
      } catch (_) { /* try mirror */ }
    }
    return null;
  }

  async function fetchCoinGeckoIdrPrices(symbols, needGold) {
    const wanted = [...new Set(symbols.map((s) => String(s || '').trim().toUpperCase()).filter((s) => CRYPTO_ID_MAP[s]))];
    const ids = [...new Set([...wanted.map((s) => CRYPTO_ID_MAP[s]), 'tether', ...(needGold ? ['pax-gold'] : [])])];
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=idr,usd`;
    const json = await fetchJsonWithTimeout(url, 10000);
    if (!json || typeof json !== 'object') return null;
    const out = {};
    const usdIdr = Number(json.tether && json.tether.idr) || 0;
    if (usdIdr > 0) out.USD = usdIdr;
    [...wanted, ...(needGold ? ['PAXG'] : [])].forEach((sym) => {
      const d = json[CRYPTO_ID_MAP[sym]];
      if (d && Number(d.idr) > 0) out[sym] = Number(d.idr);
      else if (d && Number(d.usd) > 0 && usdIdr > 0) out[sym] = Math.round(Number(d.usd) * usdIdr);
    });
    return out;
  }

  async function fetchDirectMarketPricesIDR(symbols, needGold) {
    const reqSyms = [...new Set((symbols || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];
    const [cgRes, curRes] = await Promise.allSettled([
      reqSyms.some((s) => CRYPTO_ID_MAP[s]) || needGold ? fetchCoinGeckoIdrPrices(reqSyms, needGold) : Promise.resolve(null),
      fetchCurrencyApiIdrRates()
    ]);
    const cgPrices = cgRes.status === 'fulfilled' ? cgRes.value : null;
    const idrRates = curRes.status === 'fulfilled' ? curRes.value : null;
    if (!cgPrices && !idrRates) {
      throw new Error('Penyedia harga pasar (CoinGecko & Kurs) tidak dapat dijangkau sementara.');
    }
    const out = Object.assign({}, cgPrices || {});
    if (idrRates) {
      const rateToIdr = (code) => (Number(idrRates[code]) > 0 ? 1 / Number(idrRates[code]) : 0);
      if (!out.USD) { const u = rateToIdr('usd'); if (u > 0) out.USD = Math.round(u); }
      if (!out.XAU) { const g = rateToIdr('xau'); if (g > 0) out.XAU = g; }
      if (!out.PAXG) { const p = rateToIdr('paxg'); if (p > 0) out.PAXG = p; }
      reqSyms.forEach((sym) => {
        if (!out[sym]) { const v = rateToIdr(sym.toLowerCase()); if (v > 0) out[sym] = v; }
      });
    }
    return out;
  }

  async function savePortfolioSnapshotDirect(assets) {
    let total = 0, crypto = 0, cash = 0, other = 0;
    (assets || []).forEach((a) => {
      const v = Number(a.value) || 0;
      total += v;
      const t = String(a.type || 'Other').toLowerCase();
      if (t === 'crypto') crypto += v;
      else if (t === 'cash') cash += v;
      else other += v;
    });
    let userId = '';
    if (sb.auth && typeof sb.auth.getSession === 'function') {
      try {
        const sess = await sb.auth.getSession();
        userId = (sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id) || '';
      } catch (_) { /* ignore */ }
    }
    const row = {
      ...(userId ? { user_id: userId } : {}),
      tanggal: ymd(new Date()),
      total_value: total,
      crypto_value: crypto,
      cash_value: cash,
      other_value: other
    };
    const { error } = await sb.from('portfolio_snapshots').upsert(row, { onConflict: 'user_id,tanggal' });
    fail(error);
  }

  async function refreshPricesDirect(assets) {
    const list = (assets || []).map((a) => Object.assign({}, a));
    const cryptos = list.filter((a) => String(a.type || '').toLowerCase() === 'crypto' && a.symbol && num(a.quantity) > 0);
    const golds = list.filter((a) => String(a.type || '').toLowerCase() === 'emas' && num(a.quantity) > 0);
    const usds = list.filter((a) => String(a.type || '').toLowerCase() === 'usd' && num(a.quantity) > 0);
    if (!cryptos.length && !golds.length && !usds.length) return { updated: 0, missing: [], source: 'direct' };

    const prices = await fetchDirectMarketPricesIDR(cryptos.map((a) => a.symbol), golds.length > 0);
    const missing = new Set();
    let updated = 0;

    const applyGroup = async (rows, unitRate, symKey) => {
      for (const row of rows) {
        if (!unitRate || !Number.isFinite(unitRate)) { missing.add(symKey); continue; }
        const nextVal = Math.round(num(row.quantity) * unitRate);
        const { error } = await sb.from('assets').update({ value: nextVal }).eq('id', row.id);
        fail(error);
        row.value = nextVal;
        updated += 1;
      }
    };

    for (const row of cryptos) {
      const sym = String(row.symbol || '').trim().toUpperCase();
      await applyGroup([row], prices[sym] || 0, sym);
    }
    const goldOz = prices.XAU || prices.PAXG || 0;
    await applyGroup(golds, goldOz ? goldOz / 31.1034768 : 0, 'XAU');
    await applyGroup(usds, prices.USD || 0, 'USD');
    if (updated > 0) await savePortfolioSnapshotDirect(list);
    return { updated, missing: [...missing], source: 'direct' };
  }

  async function finishAssetWalletMutation(assetsRes, transactions, walletId, date) {
    if (walletId && transactions && transactions.length) {
      const [catsRes, currentPeriod] = await Promise.all([fetchCategoriesOnly(), syncPeriod(date)]);
      return {
        ...assetsRes,
        ...catsRes,
        transaction: trxFromRow(transactions[0]),
        ...(currentPeriod ? { currentPeriod } : {})
      };
    }
    return assetsRes;
  }

  function validateAssetPurchaseParams(d) {
    const name = String(d.name || '').trim();
    const type = String(d.type || 'Other');
    const typeLower = type.toLowerCase();
    const quantity = num(d.quantity);
    const buyPrice = num(d.buyPrice);
    const amount = typeLower === 'crypto' ? quantity * buyPrice : num(d.value);
    const date = String(d.tanggal || ymd(new Date())).slice(0, 10);
    if (!name || !Number.isFinite(amount) || amount <= 0) throw new Error('Nama aset dan nominal pembelian harus valid.');
    if (typeLower === 'crypto' && (quantity <= 0 || buyPrice <= 0)) {
      throw new Error('Isi jumlah aset dan harga beli untuk mencatat sumber dana.');
    }
    if ((typeLower === 'emas' || typeLower === 'usd') && quantity <= 0) {
      throw new Error(typeLower === 'emas' ? 'Isi berat emas (gram).' : 'Isi jumlah nominal USD.');
    }
    const defaultSym = typeLower === 'emas' ? 'XAU' : (typeLower === 'usd' ? 'USD' : '');
    const symbol = String(d.symbol || defaultSym).toUpperCase();
    const resolvedBuyPrice = buyPrice > 0
      ? buyPrice
      : ((typeLower === 'emas' || typeLower === 'usd') && quantity > 0 ? Number((amount / quantity).toFixed(4)) : 0);
    return { p_name: name, p_type: type, p_symbol: symbol, p_quantity: quantity, p_buy_price: resolvedBuyPrice, p_amount: amount, p_wallet_id: d.walletId, p_date: date };
  }

  async function fetchRecentSnapshots() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const snapRes = await sb.from('portfolio_snapshots').select('tanggal,total_value,crypto_value,cash_value,other_value')
      .gte('tanggal', ymd(cutoff)).order('tanggal', { ascending: true });
    fail(snapRes.error);
    return (snapRes.data || []).map((s) => ({
      tanggal: s.tanggal, total: num(s.total_value), crypto: num(s.crypto_value),
      cash: num(s.cash_value), other: num(s.other_value)
    }));
  }

  Object.assign(core.handlers, {
    async api_addAssetV2(d) {
      if (!d || typeof d !== 'object') throw new Error('Data aset tidak valid.');
      if (d.walletId) {
        const rpcArgs = validateAssetPurchaseParams(d);
        const { data: transactions, error } = await sb.rpc('create_asset_with_expense', rpcArgs);
        fail(error);
        if (!transactions || !transactions.length) throw new Error('Pembelian aset tidak mengembalikan catatan transaksi.');
        return finishAssetWalletMutation(await fetchAssetsOnly(), transactions, d.walletId, rpcArgs.p_date);
      }
      const typeLower = String(d.type || 'Other').toLowerCase();
      const qty = num(d.quantity);
      const buyPrice = num(d.buyPrice);
      const rawVal = num(d.value);
      const val = rawVal > 0 ? rawVal : (typeLower === 'crypto' && qty > 0 && buyPrice > 0 ? Math.round(qty * buyPrice) : rawVal);
      // Jalur tanpa dompet: dulu TIDAK ada validasi sama sekali —
      // num() memaksa sampah jadi 0 dan nilai negatif lolos ke insert.
      // Sekarang: tolak input tidak valid, jangan diam-diam memasukkan
      // baris sampah. (Validasi aset + CHECK tabel ditangani agen lain
      // untuk sisi DB; ini pertahanan klien.)
      const name = String(d.name || '').trim();
      const type = String(d.type || 'Other').trim();
      if (!name || name.length > 80) throw new Error('Nama aset wajib diisi maksimal 80 karakter.');
      if (!['Crypto', 'Emas', 'USD', 'Saham', 'Cash', 'Other'].includes(type)) throw new Error('Jenis aset tidak valid.');
      if (!Number.isFinite(qty) || qty < 0 || qty > MAX_NOMINAL) throw new Error('Jumlah aset tidak valid.');
      if (!Number.isFinite(buyPrice) || buyPrice < 0 || buyPrice > MAX_NOMINAL) throw new Error('Harga beli aset tidak valid.');
      if (!Number.isFinite(rawVal) || rawVal < 0 || rawVal > MAX_NOMINAL) throw new Error('Nilai aset tidak valid.');
      if (type.toLowerCase() === 'crypto' && qty > 0 && buyPrice <= 0) throw new Error('Isi harga beli untuk aset crypto.');
      const { error } = await sb.from('assets').insert({
        name, type, symbol: String(d.symbol || '').toUpperCase(),
        quantity: qty, buy_price: buyPrice, value: val
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
      if (!Number.isFinite(amount) || amount <= 0 || (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))) {
        throw new Error('Nominal atau jumlah pencairan aset tidak valid.');
      }
      const { data: transactions, error } = await sb.rpc('liquidate_asset', {
        p_asset_id: id, p_amount: amount, p_quantity: quantity, p_wallet_id: (d && d.walletId) || null, p_date: date
      });
      fail(error);
      return finishAssetWalletMutation(await fetchAssetsOnly(), transactions, d && d.walletId, date);
    },

    async api_addWallet(d) {
      if (!d || typeof d !== 'object') throw new Error('Data dompet tidak valid.');
      const name = String(d.name || '').trim();
      const kind = String(d.kind || '');
      const openingBalance = Number(d.openingBalance);
      if (!name || name.length > 80) throw new Error('Nama dompet wajib diisi maksimal 80 karakter.');
      if (!['bank', 'cash', 'ewallet'].includes(kind)) throw new Error('Jenis dompet tidak valid.');
      if (!Number.isFinite(openingBalance) || openingBalance < 0) throw new Error('Saldo awal harus berupa angka nol atau lebih.');
      const { data: lastWallet, error: sortError } = await sb.from('wallets').select('sort').order('sort', { ascending: false }).limit(1).maybeSingle();
      fail(sortError);
      const sort = (lastWallet && Number(lastWallet.sort) || 0) + 1;
      const { error } = await sb.from('wallets').insert({ name, kind, opening_balance: openingBalance, sort });
      fail(error);
      return fetchWalletsOnly();
    },

    async api_updateWallet(id, d, expectedVersion) {
      if (!d || typeof d !== 'object') throw new Error('Data dompet tidak valid.');
      const patch = {};
      if (d.name !== undefined && d.name !== null) {
        if (!String(d.name).trim() || String(d.name).trim().length > 80) throw new Error('Nama dompet wajib diisi maksimal 80 karakter.');
        patch.name = String(d.name).trim();
      }
      if (d.kind !== undefined && d.kind !== null) {
        if (!['bank', 'cash', 'ewallet'].includes(String(d.kind))) throw new Error('Jenis dompet tidak valid.');
        patch.kind = String(d.kind);
      }
      if (d.openingBalance !== undefined && d.openingBalance !== null) {
        const opening = Number(d.openingBalance);
        if (!Number.isFinite(opening) || opening < 0 || opening > MAX_NOMINAL) throw new Error('Saldo awal dompet tidak valid.');
        patch.opening_balance = opening;
      }
      // Dulu: field tidak valid diam-diam dibuang dan update KOSONG tetap
      // dikirim lalu dilaporkan sukses — no-op yang menyamar sebagai sukses.
      if (!Object.keys(patch).length) throw new Error('Tidak ada perubahan dompet yang valid untuk disimpan.');
      // Optimistic locking (Gelombang 7c): update bersyarat versi
      // (pola yang sama dengan api_updateTransaction). `mine` untuk
      // dialog dibangun dari base + patch — field yang tidak di-patch
      // memakai nilai base, supaya dialog tidak menuduh field itu
      // berubah.
      const base = (d && d.__base && typeof d.__base === 'object') ? d.__base : null;
      const patchClient = {};
      if (patch.name !== undefined) patchClient.name = patch.name;
      if (patch.kind !== undefined) patchClient.kind = patch.kind;
      if (patch.opening_balance !== undefined) patchClient.openingBalance = patch.opening_balance;
      const mine = Object.assign({ id }, base || {}, patchClient);
      const resolved = await resolveExpectedVersion('wallets', id, walletVersionColumns, expectedVersion);
      if (resolved.expected === null) {
        throw createConflictError('wallet', {
          operation: 'update', id, mine, current: null, base, deletedByOther: true,
          op: 'api_updateWallet', args: [id, Object.assign({}, d)]
        });
      }
      const { data, error } = await sb.from('wallets').update(patch).eq('id', id).eq('version', resolved.expected).select('id').maybeSingle();
      fail(error);
      if (!data) {
        const current = await loadVersionedRow('wallets', id, walletVersionColumns);
        if (!current) {
          throw createConflictError('wallet', {
            operation: 'update', id, mine, current: null, base, deletedByOther: true,
            op: 'api_updateWallet', args: [id, Object.assign({}, d)]
          });
        }
        throw createConflictError('wallet', {
          operation: 'update', id, mine,
          current: {
            id: current.id, name: current.name, kind: current.kind,
            openingBalance: num(current.opening_balance), sort: current.sort,
            version: num(current.version) || 1
          },
          base, deletedByOther: false,
          op: 'api_updateWallet', args: [id, Object.assign({}, d)]
        });
      }
      return fetchWalletsOnly();
    },

    // Optimistic locking (Gelombang 7c): hapus lewat RPC
    // delete_wallet_checked (cek versi di server, lalu mendelegasikan
    // ke delete_wallet lama). Dompet yang sudah tidak ada = sukses
    // idempotent (bukan error) — konsisten dengan delete lain.
    async api_deleteWallet(id, expectedVersion) {
      let expected = expectedVersion;
      if (expected === 'force' || expected === undefined) {
        const current = await loadVersionedRow('wallets', id, walletVersionColumns);
        if (!current) {
          const [wt0, trx0] = await Promise.all([
            fetchWalletsAndTransfers(),
            fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan,wallet_id', ['tanggal', 'id'])
          ]);
          return { ...wt0, transactions: trx0.map(trxFromRow) };
        }
        expected = Number(current.version) || 1;
      }
      const { data, error } = await sb.rpc('delete_wallet_checked', { p_wallet_id: id, p_expected_version: expected });
      if (error) {
        const msg = String(error.message || '');
        if (/could not find the function|PGRST202|404/i.test(msg)) {
          throw new Error('Fitur hapus dompet belum tersedia: migrasi delete_wallet_checked belum diterapkan di server.');
        }
        fail(error);
      }
      const res = Array.isArray(data) ? data[0] : data;
      if (res && res.conflict) {
        throw createConflictError('wallet', {
          operation: 'delete', id, mine: null,
          current: {
            id: res.id, name: res.name, kind: res.kind,
            openingBalance: num(res.opening_balance), sort: 0,
            version: num(res.version) || 1
          },
          base: null, deletedByOther: false,
          op: 'api_deleteWallet', args: [id]
        });
      }
      const [wt, trx] = await Promise.all([
        fetchWalletsAndTransfers(),
        fetchAll('transactions', 'id,tanggal,tipe,kategori,nominal,keterangan,wallet_id', ['tanggal', 'id'])
      ]);
      return { ...wt, transactions: trx.map(trxFromRow) };
    },

    async api_addTransfer(d) {
      const nominal = num(d.nominal);
      const fee = Math.max(0, num(d.fee));
      if (nominal <= 0 || nominal > MAX_NOMINAL) throw new Error('Nominal harus lebih dari 0 dan tidak melebihi Rp 999.999.999.999,99.');
      if (fee > MAX_NOMINAL) throw new Error('Biaya transfer tidak valid.');
      if (d.kind !== 'investasi' && (!d.fromWallet || !d.toWallet || d.fromWallet === d.toWallet)) {
        throw new Error('Pilih dompet asal dan tujuan yang berbeda');
      }
      if (!d.fromWallet) throw new Error('Dompet asal wajib diisi.');
      // Pre-check klien (UX): saldo dari state DB yang sudah diambil.
      // RPC di bawah adalah kontrol sebenarnya (TOCTOU).
      checkTransferBalancePrecondition(d, nominal, fee);
      // Idempotency key antrean offline (T13, Gelombang 2.5): dibuat sekali
      // di klien saat enqueue, dikirim di dalam payload.
      const idempotencyKey = typeof d.idempotencyKey === 'string' ? d.idempotencyKey.trim() : '';
      const rpcArgs = {
        p_from: d.fromWallet,
        p_to: d.toWallet || null,
        p_nominal: nominal,
        p_fee: fee,
        p_tanggal: String(d.tanggal || ymd(new Date())).slice(0, 10),
        p_keterangan: d.keterangan || '',
        p_idempotency_key: idempotencyKey || null
      };
      // Jalur utama (Wave 3.5 §6): RPC transfer_between_wallets —
      // lock kedua dompet, cek kepemilikan + saldo di server.
      if (sb.rpc && typeof sb.rpc === 'function') {
        const { data, error } = await sb.rpc('transfer_between_wallets', rpcArgs);
        if (error) {
          const msg = String(error.message || '');
          // Migrasi belum diterapkan di server: gagal eksplisit, jangan
          // diam-diam kembali ke insert tanpa cek saldo.
          if (/could not find the function|PGRST202|404/i.test(msg)) {
            throw new Error('Fitur transfer belum tersedia: migrasi transfer_between_wallets belum diterapkan di server.');
          }
          if (error.code === '23505' && idempotencyKey) {
            const existing = await sb.from('transfers')
              .select('id,tanggal,kind,from_wallet,to_wallet,nominal,fee,keterangan')
              .eq('idempotency_key', idempotencyKey).maybeSingle();
            if (existing.error) fail(existing.error);
            if (existing.data) return fetchWalletsAndTransfers();
            fail(error);
          }
          fail(error);
        }
        if (!data || !data.length) throw new Error('Transfer tidak mengembalikan data.');
        return fetchWalletsAndTransfers();
      }
      // Jembatan kompatibilitas: hanya bila sb.rpc tidak ada sama sekali
      // (stub tes lama). JANGAN dipakai di produksi — sb Supabase asli
      // selalu punya rpc, jadi jalur ini tidak pernah menonaktifkan
      // cek saldo server di aplikasi nyata.
      const { error } = await sb.from('transfers').insert({
        tanggal: rpcArgs.p_tanggal,
        kind: d.kind || 'transfer',
        from_wallet: d.fromWallet || null,
        to_wallet: d.toWallet || null,
        nominal,
        fee,
        keterangan: d.keterangan || '',
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
      });
      if (error && error.code === '23505' && idempotencyKey) {
        // Retry setelah respons hilang: baris sudah ada — kembalikan
        // daftar dompet+transfer terbaru (bentuk hasil yang sama seperti
        // insert berhasil) supaya flush menghapus item antrean. Select
        // terikat RLS, jadi filter kunci saja sudah setara dengan
        // pencarian (user_id, key). (Cek code SEBELUM fail().)
        const existing = await sb.from('transfers')
          .select('id,tanggal,kind,from_wallet,to_wallet,nominal,fee,keterangan')
          .eq('idempotency_key', idempotencyKey).maybeSingle();
        if (existing.error) fail(existing.error);
        if (existing.data) return fetchWalletsAndTransfers();
        // Balapan: baris belum terlihat — lempar error asli agar retry.
        fail(error);
      }
      fail(error);
      return fetchWalletsAndTransfers();
    },

    async api_deleteTransfer(id) {
      const { error } = await sb.from('transfers').delete().eq('id', id);
      fail(error);
      return fetchWalletsAndTransfers();
    },

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
        p_asset_id: id, p_amount: amount, p_price: price, p_quantity: quantity, p_wallet_id: d.walletId || null, p_date: date
      });
      fail(error);
      return d.walletId ? { ...(await fetchAssetsOnly()), ...(await fetchWalletsAndTransfers()) } : fetchAssetsOnly();
    },

    async api_refreshPrices() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Anda sedang offline. Hubungkan internet untuk menyegarkan harga aset.');
      }
      const initialAssetsRes = await fetchAssetsOnly();
      const marketAssets = (initialAssetsRes.assets || []).filter((a) => {
        const t = String(a.type || '').toLowerCase();
        return ((t === 'crypto' && a.symbol) || t === 'emas' || t === 'usd') && num(a.quantity) > 0;
      });
      if (!marketAssets.length) {
        return { ...initialAssetsRes, snapshots: await fetchRecentSnapshots(), refreshMeta: { updated: 0, missing: [], noMarketAssets: true } };
      }

      let edgeResult = null;
      let edgeErrorMsg = '';
      if (sb.functions && typeof sb.functions.invoke === 'function') {
        try {
          const { data, error } = await sb.functions.invoke('telegram-bot', { body: { job: 'refresh_prices' } });
          if (!error && data && !data.error) edgeResult = data;
          else edgeErrorMsg = await extractEdgeErrorMessage(error, (data && data.error) || 'Refresh harga server gagal.');
        } catch (err) {
          edgeErrorMsg = (err && err.message) || String(err);
        }
      }

      let directResult = null;
      let directError = null;
      const needsDirect = !edgeResult || (Number(edgeResult.updated) === 0 && Array.isArray(edgeResult.missing) && edgeResult.missing.length > 0);
      if (needsDirect) {
        try {
          directResult = await refreshPricesDirect(initialAssetsRes.assets);
        } catch (err) {
          directError = err;
        }
      }

      const activeRes = directResult || (edgeResult ? { updated: Number(edgeResult.updated) || 0, missing: edgeResult.missing || [], source: 'edge' } : null);
      if (!activeRes) {
        throw new Error((directError && directError.message) || edgeErrorMsg || 'Gagal memperbarui harga aset.');
      }
      if (activeRes.updated === 0 && activeRes.missing && activeRes.missing.length) {
        throw new Error('Simbol belum didukung: ' + activeRes.missing.join(', '));
      }

      const [freshAssets, snapshots] = await Promise.all([fetchAssetsOnly(), fetchRecentSnapshots()]);
      return { ...freshAssets, snapshots, refreshMeta: activeRes };
    }
  });

  core.fetchDirectMarketPricesIDR = fetchDirectMarketPricesIDR;
  core.refreshPricesDirect = refreshPricesDirect;
  core.computeWalletBalanceFromState = computeWalletBalanceFromState;
  core.MAX_NOMINAL = MAX_NOMINAL;
})();
