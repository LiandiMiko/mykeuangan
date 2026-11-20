import {
  Any, CRON_SECRET, CG_KEY, sb, esc, rp, today, safeEqual, fetchAll,
  isActiveUser, isFlow, syncPeriod, streak, streakEmoji, send, mainKb,
} from './core.ts';
import { getWallets } from './wallets.ts';

export const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const CRYPTO_MAP: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', ONDO: 'ondo-finance', TAO: 'bittensor', SOL: 'solana', ADA: 'cardano',
  DOT: 'polkadot', MATIC: 'matic-network', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', XRP: 'ripple',
  DOGE: 'dogecoin', AVAX: 'avalanche-2', LINK: 'chainlink', PEPE: 'pepe', SHIB: 'shiba-inu', ARB: 'arbitrum', OP: 'optimism',
  PAXG: 'pax-gold',
};

async function chatsOf(uid?: string): Promise<{ chat_id: number; user_id: string }[]> {
  let q = sb.from('telegram_chats').select('chat_id,user_id');
  if (uid) q = q.eq('user_id', uid);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function getActiveUserIds(): Promise<Set<string>> {
  const { data, error } = await sb.from('profiles').select('id').eq('status', 'active');
  if (error) throw error;
  return new Set((data ?? []).map((p: { id: string }) => p.id));
}

async function fetchPricesIDR(symbols: string[]): Promise<Record<string, number>> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => CRYPTO_MAP[s]);
  const ids = [...new Set([...wanted.map((s) => CRYPTO_MAP[s]), 'tether'])];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=idr,usd` +
    (CG_KEY ? `&x_cg_demo_api_key=${encodeURIComponent(CG_KEY)}` : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error('CoinGecko HTTP ' + r.status);
  const j = await r.json();
  const usdIdr = Number(j.tether?.idr) || 16000;
  const out: Record<string, number> = { USD: usdIdr };
  for (const s of wanted) {
    const d = j[CRYPTO_MAP[s]];
    if (d?.idr) out[s] = Number(d.idr);
    else if (d?.usd) out[s] = Math.round(Number(d.usd) * usdIdr);
  }
  return out;
}

async function savePortfolioSnapshot(uid: string) {
  const assets = await fetchAll('assets', 'type,value', uid, ['id']);
  let total = 0, crypto = 0, cash = 0, other = 0;
  for (const a of assets) {
    const v = Number(a.value) || 0;
    total += v;
    const t = String(a.type || 'Other').toLowerCase();
    if (t === 'crypto') crypto += v; else if (t === 'cash') cash += v; else other += v;
  }
  const { error } = await sb.from('portfolio_snapshots').upsert(
    { user_id: uid, tanggal: today(), total_value: total, crypto_value: crypto, cash_value: cash, other_value: other },
    { onConflict: 'user_id,tanggal' },
  );
  if (error) throw error;
  return total;
}

async function updateAssetGroup(rows: Any[], uid: string, unitRate: number, symKey: string, missing: Set<string>): Promise<number> {
  let count = 0;
  for (const row of rows) {
    if (!unitRate) { missing.add(symKey); continue; }
    const { error } = await sb.from('assets').update({ value: Math.round(Number(row.quantity || 0) * unitRate) }).eq('id', row.id).eq('user_id', uid);
    if (error) throw error;
    count++;
  }
  return count;
}

async function refreshPrices(uid: string) {
  const assets = await fetchAll('assets', 'id,type,symbol,quantity', uid, ['id']);
  const cryptos = assets.filter((a) => String(a.type).toLowerCase() === 'crypto' && a.symbol);
  const golds = assets.filter((a) => String(a.type).toLowerCase() === 'emas' && Number(a.quantity) > 0);
  const usds = assets.filter((a) => String(a.type).toLowerCase() === 'usd' && Number(a.quantity) > 0);
  if (cryptos.length === 0 && golds.length === 0 && usds.length === 0) return { updated: 0, missing: [] as string[] };

  const prices = await fetchPricesIDR([...cryptos.map((a) => String(a.symbol)), ...(golds.length ? ['PAXG'] : [])]);
  let updated = 0;
  const missing = new Set<string>();
  for (const a of cryptos) {
    const sym = String(a.symbol).toUpperCase();
    updated += await updateAssetGroup([a], uid, prices[sym] || 0, sym, missing);
  }
  updated += await updateAssetGroup(golds, uid, prices.PAXG ? prices.PAXG / 31.1034768 : 0, 'XAU', missing);
  updated += await updateAssetGroup(usds, uid, prices.USD || 0, 'USD', missing);
  if (updated > 0) await savePortfolioSnapshot(uid);
  return { updated, missing: [...missing] };
}

async function runRecurring() {
  const t = today();
  const [yearStr, monthStr, dayStr] = t.split('-');
  const day = Number(dayStr);
  const lastDay = new Date(Number(yearStr), Number(monthStr), 0).getDate();
  const q = sb.from('recurring').select('*').eq('active', true);
  const { data, error } = day === lastDay ? await q.gte('day_of_month', day) : await q.eq('day_of_month', day);
  if (error) throw error;
  const activeIds = await getActiveUserIds();
  const byUser = new Map<string, string[]>();
  let created = 0;
  const defaultWalletCache = new Map<string, string | null>();
  for (const r of data ?? []) {
    if (!activeIds.has(r.user_id)) continue;
    const claim = await sb.from('recurring').update({ last_run: t }).eq('id', r.id).or(`last_run.is.null,last_run.neq.${t}`).select('id');
    if (claim.error) throw claim.error;
    if (!claim.data || claim.data.length === 0) continue;
    if (!defaultWalletCache.has(r.user_id)) {
      const ws = await getWallets(r.user_id);
      defaultWalletCache.set(r.user_id, ws[0]?.id ?? null);
    }
    const cleanNote = String(r.keterangan || '').trim();
    const ins = await sb.from('transactions').insert({
      user_id: r.user_id, tanggal: t, tipe: r.tipe, kategori: r.kategori, nominal: r.nominal,
      keterangan: cleanNote ? `${cleanNote} (recurring)` : 'Recurring', source: 'recurring',
      wallet_id: defaultWalletCache.get(r.user_id) ?? null,
    });
    if (ins.error) { await sb.from('recurring').update({ last_run: r.last_run }).eq('id', r.id); console.error('recurring insert', ins.error); continue; }
    await syncPeriod(r.user_id, t);
    created++;
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), `• ${esc(r.kategori)}: ${rp(Number(r.nominal))}`]);
  }
  for (const [uid, lines] of byUser) {
    for (const ch of await chatsOf(uid)) await send(ch.chat_id, `🔄 <b>Recurring hari ini</b>\n\n${lines.length} transaksi:\n\n${lines.join('\n')}`);
  }
  return { created };
}

async function dailyReminder() {
  const activeIds = await getActiveUserIds();
  let sent = 0;
  for (const ch of await chatsOf()) {
    if (!activeIds.has(ch.user_id)) continue;
    const trx = await fetchAll('transactions', 'tanggal,tipe,kategori,nominal', ch.user_id, ['tanggal', 'id']);
    const todayTx = trx.filter((x) => String(x.tanggal).slice(0, 10) === today());
    const st = streak(trx);
    const total = todayTx.filter((x) => x.tipe === 'Pengeluaran' && isFlow(x.kategori)).reduce((a, x) => a + Number(x.nominal), 0);
    const msg = todayTx.length === 0
      ? `⏰ <b>Pengingat Malam</b>\n\nBelum ada catatan hari ini.\n🔥 Streak: <b>${st} hari</b> ${streakEmoji(st)}`
      : `✅ <b>Rekap Hari Ini</b>\n\n📝 Transaksi: <b>${todayTx.length}</b> · 💵 Pengeluaran: <b>${rp(total)}</b>\n🔥 Streak: <b>${st} hari</b> ${streakEmoji(st)}`;
    await send(ch.chat_id, msg, mainKb());
    sent++;
  }
  return { sent };
}

async function weeklyReport() {
  const end = today();
  const d = new Date(end + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  const start = d.toISOString().slice(0, 10);
  const activeIds = await getActiveUserIds();
  let sent = 0;
  for (const ch of await chatsOf()) {
    if (!activeIds.has(ch.user_id)) continue;
    const trx = await fetchAll('transactions', 'tanggal,tipe,kategori,nominal', ch.user_id, ['tanggal', 'id']);
    const weekTx = trx.filter((x) => { const t = String(x.tanggal).slice(0, 10); return t >= start && t <= end; });
    if (weekTx.length === 0) continue;
    let tIn = 0, tOut = 0;
    const byCat: Record<string, number> = {};
    for (const x of weekTx) {
      if (!isFlow(x.kategori)) continue;
      const n = Number(x.nominal);
      if (x.tipe === 'Pemasukan') tIn += n; else { tOut += n; byCat[x.kategori] = (byCat[x.kategori] || 0) + n; }
    }
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const sel = tIn - tOut;
    const msg = `📊 <b>Laporan Minggu Ini</b> (${start.slice(5)}..${end.slice(5)})\n📥 ${rp(tIn)} · 📤 ${rp(tOut)} · 💵 ${sel >= 0 ? '+' : ''}${rp(sel)}\n` +
      (top.length ? '\n🔝 ' + top.map(([k, v]) => `${esc(k)} (${rp(v)})`).join(', ') : '');
    await send(ch.chat_id, msg, mainKb());
    sent++;
  }
  return { sent };
}

async function snapshotAll() {
  const activeIds = await getActiveUserIds();
  const { data } = await sb.from('assets').select('user_id');
  const users = [...new Set((data ?? []).map((r: Any) => r.user_id as string))].filter((uid) => activeIds.has(uid));
  let done = 0;
  for (const uid of users) {
    try { await refreshPrices(uid); } catch (e) { console.error('refreshPrices', e); }
    try { await savePortfolioSnapshot(uid); done++; } catch (e) { console.error('snapshot', e); }
  }
  return { users: done };
}

export async function handleJob(req: Request, job: string): Promise<Response> {
  const cron = await safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET);
  let uid: string | null = null;
  if (!cron) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data } = token ? await sb.auth.getUser(token) : { data: null };
    uid = data?.user?.id ?? null;
    if (!uid || job !== 'refresh_prices' || !await isActiveUser(uid)) return json({ error: 'forbidden' }, 403);
  }
  try {
    if (job === 'refresh_prices' && uid) return json(await refreshPrices(uid));
    if (job === 'refresh_prices') {
      const activeIds = await getActiveUserIds();
      const { data } = await sb.from('assets').select('user_id');
      const users = [...new Set((data ?? []).map((r: Any) => r.user_id as string))].filter((u) => activeIds.has(u));
      let done = 0;
      for (const u of users) { try { await refreshPrices(u); done++; } catch (e) { console.error('refreshPrices', u, e); } }
      return json({ users: done });
    }
    const jobs: Record<string, () => Promise<unknown>> = { daily: dailyReminder, weekly: weeklyReport, recurring: runRecurring, snapshot: snapshotAll };
    return jobs[job] ? json(await jobs[job]()) : json({ error: 'unknown job' }, 400);
  } catch (e) {
    console.error('job', job, e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
}
