/* supabase-portfolio.js — wallets, transfers, assets & live market price refresh */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, num, ymd, syncPeriod, trxFromRow, fetchAll, fetchCategoriesOnly, fetchWalletsOnly, fetchWalletsAndTransfers, fetchAssetsOnly } = core;

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
      const { error } = await sb.from('assets').insert({
        name: String(d.name || ''), type: String(d.type || 'Other'), symbol: String(d.symbol || '').toUpperCase(),
        quantity: num(d.quantity), buy_price: num(d.buyPrice), value: num(d.value)
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
      return { ...wt, transactions: trx.map(trxFromRow) };
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
      const { data, error } = await sb.functions.invoke('telegram-bot', { body: { job: 'refresh_prices' } });
      if (error) throw new Error('Refresh harga gagal: ' + (error.message || error));
      if (data && data.error) throw new Error(data.error);
      if (data && data.updated === 0 && data.missing && data.missing.length) {
        throw new Error('Simbol belum didukung: ' + data.missing.join(', '));
      }
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const [assetsRes, snapRes] = await Promise.all([
        fetchAssetsOnly(),
        sb.from('portfolio_snapshots').select('tanggal,total_value,crypto_value,cash_value,other_value')
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
    }
  });
})();
