import {
  Any, Ctx, Tx, Wallet, sb, esc, rp, today, parseNominal, fetchAll, getSettings,
  isPiutang, isUtang, balances, saveTx, send, mainKb,
} from './core.ts';

export async function getWallets(uid: string): Promise<Wallet[]> {
  const rows = await fetchAll('wallets', 'id,name,kind,opening_balance,sort', uid, ['sort', 'name']);
  return rows.map((r) => ({ ...r, opening_balance: Number(r.opening_balance) || 0 }));
}

export const walletByKind = (ws: Wallet[], kind: 'bank' | 'cash' | 'ewallet'): Wallet | undefined =>
  ws.find((w) => w.kind === kind) ?? ws[0];

export function detectWalletKind(text: string): 'bank' | 'cash' | 'ewallet' | null {
  if (/\b(cash|tunai)\b/i.test(text)) return 'cash';
  if (/\b(gopay|ovo|dana|shopeepay|spay|linkaja|e-?wallet|ewallet)\b/i.test(text)) return 'ewallet';
  if (/\b(bca|m-?banking|debit|qris|transfer|mandiri|bri|bni|seabank|jago|blu)\b/i.test(text)) return 'bank';
  return null;
}

export function matchWalletFromText(ws: Wallet[], text: string): Wallet | undefined {
  if (!ws.length) return undefined;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (const w of ws) {
    const fullLower = String(w.name || '').trim().toLowerCase();
    const shortWord = fullLower.split(/[\s(/]+/)[0];
    if (words.some((tok) => tok.length >= 2 && (tok === fullLower || tok === shortWord))) {
      return w;
    }
  }
  const kind = detectWalletKind(text);
  return kind ? walletByKind(ws, kind) : ws[0];
}

export function walletBalancesBot(ws: Wallet[], trx: Any[], transfers: Any[]): Map<string, number> {
  const bal = new Map<string, number>(ws.map((w) => [w.id, w.opening_balance]));
  const def = ws[0]?.id;
  for (const t of trx) {
    const id = t.wallet_id && bal.has(t.wallet_id) ? t.wallet_id : def;
    if (!id) continue;
    const n = Number(t.nominal) || 0;
    const eff = isPiutang(t.kategori) ? (t.tipe === 'Pengeluaran' ? -n : n)
      : isUtang(t.kategori) ? (t.tipe === 'Pemasukan' ? 0 : -n)
      : (t.tipe === 'Pemasukan' ? n : -n);
    bal.set(id, (bal.get(id) ?? 0) + eff);
  }
  for (const x of transfers) {
    const n = Number(x.nominal) || 0, f = Number(x.fee) || 0;
    if (x.from_wallet && bal.has(x.from_wallet)) bal.set(x.from_wallet, (bal.get(x.from_wallet) ?? 0) - n - f);
    if (x.to_wallet && bal.has(x.to_wallet)) bal.set(x.to_wallet, (bal.get(x.to_wallet) ?? 0) + n);
  }
  return bal;
}

export async function loadMoney(uid: string) {
  const [trx, assets, st, ws, transfers] = await Promise.all([
    fetchAll('transactions', 'tanggal,tipe,kategori,nominal,wallet_id', uid, ['tanggal', 'id']),
    fetchAll('assets', 'value', uid, ['id']),
    getSettings(uid),
    getWallets(uid),
    fetchAll('transfers', 'from_wallet,to_wallet,nominal,fee', uid, ['id']),
  ]);
  const b = balances(trx, assets);
  let walletLines = '';
  let bal = new Map<string, number>();
  if (ws.length) {
    bal = walletBalancesBot(ws, trx, transfers);
    b.kas = [...bal.values()].reduce((a, v) => a + v, 0);
    b.net = b.kas + b.investasi + b.piutang - b.utang;
    walletLines = ws.map((w) => `   ◦ ${esc(w.name)}: <b>${rp(bal.get(w.id) ?? 0)}</b>`).join('\n') + '\n';
  }
  return { trx, assets, st, b, ws, bal, walletLines };
}

export async function handleTarik(c: Ctx, arg: string) {
  const parts = arg.replace(/^tunai\s*/i, '').split(/\s+/).filter(Boolean);
  const parsedAmt = parseNominal(parts[0] ?? '');
  const fee = parts[1] ? parseNominal(parts[1]) : 0;
  if (parsedAmt <= 0) {
    return send(c.chat, '❌ Format: <code>/tarik 500rb</code>\natau dengan biaya admin: <code>/tarik 500rb 6500</code>', mainKb());
  }
  const ws = await getWallets(c.uid);
  const bank = ws.find((w) => w.kind === 'bank'), cash = ws.find((w) => w.kind === 'cash');
  if (!bank || !cash) return send(c.chat, '❌ Dompet BCA dan Cash belum ada. Buka website sekali agar dibuat otomatis.', mainKb());
  const { error } = await sb.from('transfers').insert({
    user_id: c.uid, tanggal: today(), kind: 'tarik_tunai', from_wallet: bank.id, to_wallet: cash.id,
    nominal: parsedAmt, fee, keterangan: 'Via Telegram',
  });
  if (error) throw error;
  const m = await loadMoney(c.uid);
  await send(c.chat,
    `🏧 <b>Tarik tunai tercatat!</b>\n\n${esc(bank.name)}: <b>-${rp(parsedAmt + fee)}</b>${fee ? ` (termasuk biaya ${rp(fee)})` : ''}\n` +
    `${esc(cash.name)}: <b>+${rp(parsedAmt)}</b>\n\n💳 <b>Saldo sekarang</b>\n${m.walletLines}`, mainKb());
}

export async function handleTransfer(c: Ctx, arg: string) {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    return send(c.chat,
      '❌ <b>Format Transfer Antar Dompet</b>:\n<code>/transfer [dari] [ke] [nominal] [catatan...]</code>\n\n' +
      'Contoh:\n<code>/transfer bca cash 200rb</code>\n<code>/transfer gopay bca 50rb transfer balik</code>', mainKb());
  }
  const nominal = parseNominal(parts[2]);
  if (nominal <= 0) return send(c.chat, '❌ Nominal tidak valid. Contoh: <code>/transfer bca cash 150rb</code>', mainKb());
  const notes = parts.slice(3).join(' ').trim();
  const ws = await getWallets(c.uid);
  if (ws.length < 2) return send(c.chat, '❌ Butuh minimal 2 dompet untuk transfer.', mainKb());

  const matchW = (q: string) => ws.find((w) => w.name.toLowerCase().includes(q) || w.kind.toLowerCase() === q);
  const fromW = matchW(parts[0].toLowerCase()), toW = matchW(parts[1].toLowerCase());
  if (!fromW || !toW) {
    const listNames = ws.map((w) => `• <b>${esc(w.name)}</b> (${esc(w.kind)})`).join('\n');
    return send(c.chat, `❌ Dompet tidak ditemukan.\n\nDaftar dompet Anda:\n${listNames}`, mainKb());
  }
  if (fromW.id === toW.id) return send(c.chat, '❌ Dompet asal dan tujuan harus berbeda.', mainKb());

  const kind = (fromW.kind === 'bank' && toW.kind === 'cash') ? 'tarik_tunai' : 'transfer';
  const { error } = await sb.from('transfers').insert({
    user_id: c.uid, tanggal: today(), kind, from_wallet: fromW.id, to_wallet: toW.id,
    nominal, fee: 0, keterangan: notes || 'Via Telegram',
  });
  if (error) throw error;
  const m = await loadMoney(c.uid);
  await send(c.chat,
    `🔁 <b>Transfer berhasil dicatat!</b>\n\n${esc(fromW.name)} ➔ ${esc(toW.name)}: <b>${rp(nominal)}</b>\n` +
    (notes ? `📝 Catatan: ${esc(notes)}\n` : '') + `\n💳 <b>Saldo sekarang</b>\n${m.walletLines}`, mainKb());
}

export async function handleDebtCommand(c: Ctx, arg: string, kind: 'utang' | 'piutang') {
  const isUtangCmd = kind === 'utang';
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();
  const isAddAction = isUtangCmd ? action === 'pinjam' : ['beri', 'pinjamkan'].includes(action);
  const isPayAction = isUtangCmd ? action === 'bayar' : ['terima', 'kembali', 'lunas'].includes(action);

  if (parts.length < 3 || (!isAddAction && !isPayAction)) {
    const usage = isUtangCmd
      ? '❌ <b>Format Perintah Utang:</b>\n• <code>/utang pinjam [Nama] [Nominal] [Catatan]</code>\n• <code>/utang bayar [Nama] [Nominal] [Catatan]</code>\n\nContoh:\n<code>/utang pinjam Budi 500rb</code>'
      : '❌ <b>Format Perintah Piutang:</b>\n• <code>/piutang beri [Nama] [Nominal] [Catatan]</code>\n• <code>/piutang terima [Nama] [Nominal] [Catatan]</code>\n\nContoh:\n<code>/piutang beri Andi 300rb</code>';
    return send(c.chat, usage, mainKb());
  }

  const person = parts[1];
  const nominal = parseNominal(parts[2]);
  if (nominal <= 0) return send(c.chat, '❌ Nominal tidak valid.', mainKb());
  const notes = parts.slice(3).join(' ').trim();
  const grp = isUtangCmd ? 'UtangPerson' : 'Piutang';
  const { error: entErr } = await sb.from('entities').upsert({ user_id: c.uid, grp, name: person }, { onConflict: 'user_id,grp,name', ignoreDuplicates: true });
  if (entErr) console.warn('entities upsert', entErr.message);

  const tipe: 'Pemasukan' | 'Pengeluaran' = (isUtangCmd ? isAddAction : isPayAction) ? 'Pemasukan' : 'Pengeluaran';
  const p: Tx = {
    tanggal: today(), tipe, kategori: `${grp} - ${person}`, nominal,
    keterangan: notes ? `${notes} (via Telegram)` : `${isUtangCmd ? 'Utang' : 'Piutang'} ${person} via Telegram`,
  };
  await saveTx(c, p);

  const m = await loadMoney(c.uid);
  const label = isUtangCmd
    ? (isAddAction ? 'Pinjaman Diterima (Utang Bertambah)' : 'Pembayaran Utang (Utang Berkurang)')
    : (isAddAction ? 'Pinjaman Diberikan (Piutang Bertambah)' : 'Piutang Diterima Kembali (Piutang Berkurang)');
  const totalAmt = isUtangCmd ? m.b.utang : m.b.piutang;
  await send(c.chat,
    `🤝 <b>${label}</b>\n\n${tipe === 'Pemasukan' ? '📥' : '📤'} Nominal: <b>${rp(nominal)}</b>\n👤 Pihak: <b>${esc(person)}</b>\n` +
    `📅 Tanggal: ${p.tanggal}\n${notes ? `📝 Catatan: ${esc(notes)}\n` : ''}\n` +
    `💰 <b>${isUtangCmd ? 'Total Utang Tersisa' : 'Total Piutang Berjalan'}:</b> <b>${rp(totalAmt)}</b>\n💼 Saldo Kas: <b>${rp(m.b.kas)}</b>`, mainKb());
}

export const handleUtang = (c: Ctx, arg: string) => handleDebtCommand(c, arg, 'utang');
export const handlePiutang = (c: Ctx, arg: string) => handleDebtCommand(c, arg, 'piutang');
