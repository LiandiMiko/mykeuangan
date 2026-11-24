import {
  Ctx, Tx, TZ, sb, esc, rp, today, parseNominal, fetchAll,
  getSettings, getCategories, normalizeCatKey, resolveUserCategory, cycleFor, inPeriod, periodLabel, syncPeriod,
  isFlow, streak, streakEmoji, setTemp, getTemp, delTemp, saveTx, savedMsg,
  send, mainKb, kategoriKb, statusKb,
} from './core.ts';
import { getWallets, matchWalletFromText, loadMoney } from './wallets.ts';
import { parseWithAI, confirmPreview } from './ai.ts';
import { checkBudgetAlert } from './planning.ts';

export async function handleStatus(c: Ctx) {
  const { trx, st, b, walletLines } = await loadMoney(c.uid);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  const todayOutTx = trx.filter((t) => String(t.tanggal).slice(0, 10) === today() && t.tipe === 'Pengeluaran' && isFlow(t.kategori));
  const monthTx = trx.filter((t) => inPeriod(String(t.tanggal), period, pd));
  let mIn = 0, mOut = 0;
  for (const t of monthTx) {
    if (!isFlow(t.kategori)) continue;
    if (t.tipe === 'Pemasukan') mIn += Number(t.nominal); else mOut += Number(t.nominal);
  }
  const tglStr = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(new Date());
  const st2 = streak(trx);
  const sel = mIn - mOut;

  let s = `👋 Halo <b>${esc(c.name)}</b>!\n📅 ${tglStr}\n\n`;
  s += `━━━━━━━━━━━━━━━━\n💰 <b>KEKAYAAN BERSIH</b>\n━━━━━━━━━━━━━━━━\n<b>${rp(b.net)}</b>\n\n`;
  s += `• Saldo Kas: <b>${rp(b.kas)}</b>\n${walletLines}• Investasi: <b>${rp(b.investasi)}</b>\n• Piutang: <b>${rp(b.piutang)}</b>\n• Utang: <b>-${rp(b.utang)}</b>\n\n`;
  s += `━━━━━━━━━━━━━━━━\n📊 <b>${periodLabel(period, pd).toUpperCase()}</b>\n━━━━━━━━━━━━━━━━\n`;
  s += `📥 Pemasukan: <b>${rp(mIn)}</b>\n📤 Pengeluaran: <b>${rp(mOut)}</b>\n💵 Selisih: <b>${sel >= 0 ? '+' : ''}${rp(sel)}</b>\n📝 ${monthTx.length} transaksi\n\n`;
  s += `🔥 <b>Hari ini:</b> ${todayOutTx.length === 0 ? 'belum ada pengeluaran' : rp(todayOutTx.reduce((a, t) => a + Number(t.nominal), 0))}\n`;
  s += `🔥 <b>Streak:</b> ${st2} hari ${streakEmoji(st2)}`;
  await send(c.chat, s, statusKb());
}

export async function handleSaldo(c: Ctx) {
  const { trx, st, b, walletLines } = await loadMoney(c.uid);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  let tIn = 0, tOut = 0;
  for (const t of trx) {
    if (!inPeriod(String(t.tanggal), period, pd) || !isFlow(t.kategori)) continue;
    if (t.tipe === 'Pemasukan') tIn += Number(t.nominal); else tOut += Number(t.nominal);
  }
  await send(c.chat,
    `💰 <b>Saldo & Ringkasan</b>\nSiklus: <code>${periodLabel(period, pd)}</code>\n\n` +
    `📥 Pemasukan: <b>${rp(tIn)}</b>\n📤 Pengeluaran: <b>${rp(tOut)}</b>\n💵 Selisih: <b>${rp(tIn - tOut)}</b>\n\n` +
    `💼 <b>Saldo Kas:</b> <b>${rp(b.kas)}</b>\n${walletLines}📈 Investasi: <b>${rp(b.investasi)}</b>\n🏦 <b>Net Worth:</b> <b>${rp(b.net)}</b>`, mainKb());
}

export async function handleBulan(c: Ctx) {
  const [trx, st] = await Promise.all([fetchAll('transactions', 'tanggal,tipe,kategori,nominal', c.uid, ['tanggal', 'id']), getSettings(c.uid)]);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  const txs = trx.filter((t) => inPeriod(String(t.tanggal), period, pd)).reverse();
  let s = `📅 <b>Transaksi ${periodLabel(period, pd)}</b>\n\n`;
  if (txs.length === 0) s += 'Belum ada transaksi.';
  else {
    for (const t of txs.slice(0, 15)) {
      s += `${t.tipe === 'Pemasukan' ? '🟢' : '🔴'} <code>${String(t.tanggal).slice(5, 10)}</code> ${esc(t.kategori)} — <b>${rp(Number(t.nominal))}</b>\n`;
    }
    if (txs.length > 15) s += `\n... +${txs.length - 15} lainnya.`;
  }
  await send(c.chat, s, mainKb());
}

export async function handleTambah(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return send(c.chat, '❌ Format: <code>/tambah [Pemasukan|Pengeluaran] [Kategori] [Nominal]</code>');
  const tipe = (parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()) as Tx['tipe'];
  if (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') return send(c.chat, '❌ Tipe harus Pemasukan atau Pengeluaran.');
  const ws = await getWallets(c.uid);
  const lastTok = parts[parts.length - 1];
  const trailingHint = parseNominal(lastTok) <= 0 ? parts.pop()! : '';
  const nominal = parts.length >= 3 ? parseNominal(parts[parts.length - 1]) : 0;
  if (nominal <= 0) return send(c.chat, '❌ Nominal tidak valid.');
  const w = trailingHint ? matchWalletFromText(ws, trailingHint) : ws[0];
  const kategori = await resolveUserCategory(c.uid, tipe, parts.slice(1, -1).join(' '));
  const p: Tx = { tanggal: today(), tipe, kategori, nominal, keterangan: 'Via Telegram', wallet_id: w?.id ?? null, walletName: w?.name };
  await saveTx(c, p);
  await send(c.chat, savedMsg('✅ <b>Tersimpan!</b>', p), mainKb());
  if (p.tipe === 'Pengeluaran') await checkBudgetAlert(c, p.kategori);
}

export async function handleFreeText(c: Ctx, text: string) {
  try {
    const p = await parseWithAI(c, text);
    const w = matchWalletFromText(await getWallets(c.uid), text);
    const pend = { ...p, originalText: text, wallet_id: w?.id ?? null, walletName: w?.name ?? '' };
    await setTemp(c.chat, 'pending', pend);
    await confirmPreview(c.chat, pend);
  } catch (e) {
    console.error('freeText', e);
    await send(c.chat, '❌ Maaf, saya belum paham.\n\nContoh:\n<code>makan siang 25rb</code>', mainKb());
  }
}

export async function handleKategori(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();
  if (!action || action === 'list' || action === 'lihat') {
    const [inc, exp] = await Promise.all([getCategories(c.uid, 'pemasukan'), getCategories(c.uid, 'pengeluaran')]);
    return send(c.chat,
      `📚 <b>Daftar Kategori</b>\n\n🟢 <b>Pemasukan</b> (${inc.length}):\n${inc.map((x) => '  • ' + esc(x)).join('\n')}\n\n` +
      `🔴 <b>Pengeluaran</b> (${exp.length}):\n${exp.map((x) => '  • ' + esc(x)).join('\n')}\n\n` +
      `➕ Tambah: <code>/kategori tambah Pemasukan Crypto</code>`, kategoriKb());
  }
  if (['tambah', 'add', 'baru'].includes(action) && parts.length >= 3) {
    const raw = parts[1].toLowerCase();
    const tipe = raw.includes('pem') || raw === 'in' || raw === '+' ? 'pemasukan'
      : raw.includes('peng') || raw === 'out' || raw === '-' ? 'pengeluaran' : '';
    if (!tipe) return send(c.chat, '❌ Tipe harus Pemasukan atau Pengeluaran.');
    const nama = parts.slice(2).join(' ').trim();
    const existing = await getCategories(c.uid, tipe);
    if (existing.some((x) => x.toLowerCase() === nama.toLowerCase())) return send(c.chat, `⚠️ Kategori "<b>${esc(nama)}</b>" sudah ada.`);
    const { error } = await sb.from('categories').insert({ user_id: c.uid, tipe, name: nama });
    if (error) throw error;
    return send(c.chat, `✅ <b>Kategori ditambahkan!</b>\n🏷️ <b>${esc(nama)}</b>`, kategoriKb());
  }
  return send(c.chat, '❓ Command tidak dikenal. Gunakan /kategori untuk lihat.', kategoriKb());
}

export async function handleHapus(c: Ctx) {
  const { data, error } = await sb.from('transactions')
    .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id')
    .eq('user_id', c.uid).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  const last = data?.[0];
  if (!last) return send(c.chat, '📭 Belum ada transaksi untuk dihapus.', mainKb());
  await setTemp(c.chat, 'undo', last);
  const { error: e2 } = await sb.from('transactions').delete().eq('id', last.id).eq('user_id', c.uid);
  if (e2) throw e2;
  await send(c.chat, savedMsg('🗑️ <b>Transaksi dihapus!</b>', { ...last, nominal: Number(last.nominal) }) + '\n\n💡 Ketik <code>/undo</code> dalam 5 menit.', mainKb());
}

export async function handleUndo(c: Ctx) {
  const t = await getTemp(c.chat, 'undo');
  if (!t) return send(c.chat, '⌛ Tidak ada yang bisa di-undo.', mainKb());
  const p: Tx = { tanggal: t.tanggal, tipe: t.tipe, kategori: t.kategori, nominal: Number(t.nominal), keterangan: t.keterangan || '', wallet_id: t.wallet_id ?? null };
  await saveTx(c, p);
  await delTemp(c.chat, 'undo');
  await send(c.chat, savedMsg('↩️ <b>Berhasil di-undo!</b>', p), mainKb());
}

function parseBatchLine(line: string, defaultDate: string): { ok: true; data: Tx } | { ok: false; error: string } {
  let tanggal = defaultDate, s = line;
  const dm = s.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*/);
  if (dm) { tanggal = dm[1]; s = s.slice(dm[0].length); }
  const sep = ['|', ';', '\t', ','].sort((a, b) => s.split(b).length - s.split(a).length)[0];
  if (!s.includes(sep)) return { ok: false, error: 'Tidak ada separator' };
  const parts = s.split(sep).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return { ok: false, error: 'Minimal 3 kolom' };
  const raw = parts[0].toLowerCase();
  const tipe = raw.includes('pem') || raw === 'in' || raw === '+' ? 'Pemasukan'
    : raw.includes('peng') || raw === 'out' || raw === '-' ? 'Pengeluaran' : null;
  const nominal = parseNominal(parts[2]);
  if (!tipe || nominal <= 0) return { ok: false, error: 'Tipe/nominal tidak valid' };
  return { ok: true, data: { tanggal, tipe, kategori: parts[1], nominal, keterangan: parts.slice(3).join(' ').trim() } };
}

export async function handleBatch(c: Ctx, fullText: string) {
  const lines = fullText.split('\n').map((l) => l.trim()).filter((l) => l && !l.toLowerCase().startsWith('/batch') && l.toLowerCase() !== 'batch');
  if (lines.length === 0) return send(c.chat, '📦 <b>Format /batch</b>\n\n<code>/batch\nPemasukan | Gaji | 8000000\nPengeluaran | Makanan | 50000</code>', mainKb());
  const rows: Tx[] = [], errors: string[] = [];
  lines.forEach((line, i) => { const r = parseBatchLine(line, today()); if (r.ok) rows.push(r.data); else errors.push(`Baris ${i + 1}: ${r.error}`); });
  if (rows.length === 0) return send(c.chat, '❌ Tidak ada baris valid.\n' + errors.join('\n'));

  const [inc, exp, ws] = await Promise.all([
    getCategories(c.uid, 'pemasukan'),
    getCategories(c.uid, 'pengeluaran'),
    getWallets(c.uid),
  ]);
  const defaultWalletId = ws[0]?.id ?? null;
  const resolveBatchCat = (tipe: Tx['tipe'], rawCat: string) => {
    const clean = String(rawCat || '').trim();
    const pool = tipe === 'Pemasukan' ? inc : exp;
    return pool.find((cat) => normalizeCatKey(cat) === normalizeCatKey(clean)) ?? (clean || 'Lainnya');
  };
  const { error } = await sb.from('transactions').insert(rows.map((p) => ({
    user_id: c.uid, tanggal: p.tanggal, tipe: p.tipe, kategori: resolveBatchCat(p.tipe, p.kategori), nominal: p.nominal,
    keterangan: p.keterangan || 'Via Batch', source: 'telegram', wallet_id: defaultWalletId,
  })));
  if (error) throw error;
  await syncPeriod(c.uid, rows.map((r) => r.tanggal).sort().at(-1)!);
  const tIn = rows.filter((r) => r.tipe === 'Pemasukan').reduce((a, r) => a + r.nominal, 0);
  const tOut = rows.filter((r) => r.tipe === 'Pengeluaran').reduce((a, r) => a + r.nominal, 0);
  await send(c.chat, `✅ <b>${rows.length} transaksi tersimpan!</b>\n\n📥 ${rp(tIn)} · 📤 ${rp(tOut)}${errors.length ? `\n⚠️ ${errors.length} baris dilewati.` : ''}`, mainKb());
}

export async function handleCari(c: Ctx, arg: string) {
  const q = String(arg || '').trim();
  if (!q) return send(c.chat, '🔍 Format: <code>/cari [kata kunci]</code>\nContoh: <code>/cari laundry</code>', mainKb());
  const trx = await fetchAll('transactions', 'tanggal,tipe,kategori,nominal,keterangan', c.uid, ['tanggal', 'id']);
  const qLow = q.toLowerCase();
  const hits = trx.filter((t) => `${t.kategori || ''} ${t.keterangan || ''}`.toLowerCase().includes(qLow)).reverse();
  if (!hits.length) return send(c.chat, `🔎 Tidak ditemukan transaksi untuk "<b>${esc(q)}</b>".`, mainKb());
  const total = hits.reduce((sum, t) => sum + (Number(t.nominal) || 0), 0);
  const lines = hits.slice(0, 12).map((t) => {
    const icon = t.tipe === 'Pemasukan' ? '🟢' : '🔴';
    const note = t.keterangan && t.keterangan !== 'Via Telegram' ? ` · <i>${esc(String(t.keterangan).slice(0, 32))}</i>` : '';
    return `${icon} <code>${String(t.tanggal).slice(0, 10)}</code> <b>${esc(t.kategori)}</b> ${rp(Number(t.nominal))}${note}`;
  });
  const more = hits.length > 12 ? `\n\n... +${hits.length - 12} transaksi lainnya.` : '';
  await send(c.chat, `🔍 <b>Hasil Cari "${esc(q)}"</b> (${hits.length} trx · ${rp(total)})\n\n${lines.join('\n')}${more}`, mainKb());
}
