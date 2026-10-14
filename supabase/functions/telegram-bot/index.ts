// Bot Telegram MyKeuanganGuech — Supabase Edge Function (tahap 3a)
// Webhook menggantikan polling Apps Script. Deploy dengan --no-verify-jwt
// (Telegram tidak mengirim JWT; keamanan lewat secret token + daftar chat).
//
// Tahap 3a: sapaan/menu, status, saldo, bulan, tambah, teks bebas (AI) + konfirmasi,
//           kategori, hapus/undo.
// Tahap 3b-1: budget + alert, recurring, insight AI, batch.
// Tahap 3c: job otomatis (reminder harian, laporan mingguan, recurring, snapshot, harga crypto)
//           lewat pg_cron → POST {job:'daily'|'weekly'|'recurring'|'snapshot'} + header x-cron-secret;
//           website memanggil {job:'refresh_prices'} dengan JWT login.
// Tahap 3b-2 (belum): foto struk, voice note, upload CSV.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL_PARSER') ?? 'gemini-3.5-flash-lite';
const TZ = Deno.env.get('APP_TIMEZONE') ?? 'Asia/Jakarta';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const TG = `https://api.telegram.org/bot${TOKEN}`;

// deno-lint-ignore no-explicit-any
type Any = any;
type Ctx = { chat: number; uid: string; name: string };
type Tx = {
  tanggal: string; tipe: 'Pemasukan' | 'Pengeluaran'; kategori: string; nominal: number; keterangan?: string;
  wallet_id?: string | null; walletName?: string;
};

/* ---------------- Format & helper umum ---------------- */
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rp = (n: number) => (n < 0 ? '-' : '') + 'Rp ' + Math.abs(Math.round(n)).toLocaleString('id-ID');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function parseNominal(raw: string): number {
  const m = raw.trim().toLowerCase().replace(/^rp\.?\s*/, '').match(/^([\d.,]+)\s*(rb|ribu|k|jt|juta)?$/);
  if (!m) return 0;
  const mult = m[2] ? (m[2] === 'jt' || m[2] === 'juta' ? 1e6 : 1e3) : 1;
  const n = m[2] ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''));
  return Math.round(n * mult) || 0;
}

/* ---------------- Telegram ---------------- */
async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error('telegram', method, r.status, await r.text());
}
const send = (chat: number, text: string, kb?: unknown) =>
  tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: kb });

const mainKb = () => ({
  keyboard: [
    [{ text: '📊 Status Keuangan' }, { text: '💰 Saldo Bulan Ini' }],
    [{ text: '📅 Transaksi Bulan Ini' }, { text: '📝 Tambah Transaksi' }],
    [{ text: '📈 Budget' }, { text: '🔄 Recurring' }],
    [{ text: '🏷️ Kelola Kategori' }, { text: '❓ Bantuan' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Ketik transaksi atau pilih menu...',
});
const tambahKb = () => ({
  keyboard: [[{ text: '🟢 Pemasukan' }, { text: '🔴 Pengeluaran' }], [{ text: '🔙 Menu Utama' }]],
  resize_keyboard: true,
  is_persistent: true,
});
const kategoriKb = () => ({
  keyboard: [[{ text: '📚 Lihat Kategori' }, { text: '➕ Tambah Kategori' }], [{ text: '🔙 Menu Utama' }]],
  resize_keyboard: true,
  is_persistent: true,
});
const statusKb = () => ({
  inline_keyboard: [
    [{ text: '💰 Saldo', callback_data: 'cmd_saldo' }, { text: '📅 Bulan Ini', callback_data: 'cmd_bulan' }],
    [{ text: '📝 Tambah', callback_data: 'cmd_tambah' }, { text: '🏷️ Kategori', callback_data: 'cmd_kategori' }],
  ],
});

/* ---------------- Data (service role → selalu filter user_id) ---------------- */
async function fetchAll(table: string, cols: string, uid: string, order: string[]): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).eq('user_id', uid).range(from, from + 999);
    for (const o of order) q = q.order(o);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function getSettings(uid: string): Promise<Record<string, string>> {
  const rows = await fetchAll('settings', 'key,value', uid, ['key']);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function setSetting(uid: string, key: string, value: string) {
  const { error } = await sb.from('settings').upsert({ user_id: uid, key, value }, { onConflict: 'user_id,key' });
  if (error) throw error;
}

async function getCategories(uid: string, tipe: 'pemasukan' | 'pengeluaran'): Promise<string[]> {
  const rows = await fetchAll('categories', 'tipe,name', uid, ['tipe', 'name']);
  return rows.filter((r) => r.tipe === tipe).map((r) => r.name);
}

/* ---------------- Siklus gaji (setara Code.gs / Telegram.gs lama) ---------------- */
function cycleFor(tanggal: string, payrollDay: number): string {
  const [y0, m0, d] = tanggal.slice(0, 10).split('-').map(Number);
  let y = y0, m = m0;
  if (payrollDay > 1 && d >= payrollDay) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${pad(m)}`;
}

function periodRange(period: string, pd: number) {
  const [y, m] = period.split('-').map(Number);
  if (pd <= 1) return { start: `${period}-01`, end: `${period}-${pad(new Date(y, m, 0).getDate())}` };
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return { start: `${py}-${pad(pm)}-${pad(pd)}`, end: `${y}-${pad(m)}-${pad(pd - 1)}` };
}
const inPeriod = (tgl: string, period: string, pd: number) => {
  const r = periodRange(period, pd);
  const t = tgl.slice(0, 10);
  return t >= r.start && t <= r.end;
};
function periodLabel(period: string, pd: number) {
  const r = periodRange(period, pd);
  const [, sm, sd] = r.start.split('-').map(Number);
  const [ey, em, ed] = r.end.split('-').map(Number);
  return `${sd} ${MONTHS[sm - 1]} - ${ed} ${MONTHS[em - 1]} ${ey}`;
}

async function syncPeriod(uid: string, tanggal: string) {
  const s = await getSettings(uid);
  const cyc = cycleFor(tanggal, Number(s.payrollDay) || 1);
  if (!s.currentPeriod || cyc > s.currentPeriod) await setSetting(uid, 'currentPeriod', cyc);
}

/* ---------------- Perhitungan keuangan ---------------- */
// Utang/piutang dikenali dari AWAL nama kategori ("UtangApp - ..", "UtangPerson - ..", "Piutang - ..").
// (Versi lama memakai indexOf('utang'), yang ikut cocok dengan "Piutang" → salah hitung.)
const isPiutang = (k: string) => k.startsWith('Piutang');
const isUtang = (k: string) => k.startsWith('Utang');

function balances(trx: Any[], assets: Any[]) {
  let kas = 0, utang = 0, piutang = 0;
  for (const t of trx) {
    const n = Number(t.nominal) || 0;
    if (isPiutang(t.kategori)) {
      if (t.tipe === 'Pengeluaran') { piutang += n; kas -= n; } else { piutang -= n; kas += n; }
    } else if (isUtang(t.kategori)) {
      if (t.tipe === 'Pemasukan') utang += n; else { utang -= n; kas -= n; }
    } else {
      kas += t.tipe === 'Pemasukan' ? n : -n;
    }
  }
  const investasi = assets.reduce((a, b) => a + Number(b.value || 0), 0);
  return { kas, utang, piutang, investasi, net: kas + investasi + piutang - utang };
}

function streak(trx: Any[]): number {
  const dates = new Set(trx.map((t) => String(t.tanggal).slice(0, 10)));
  const cur = new Date(today() + 'T00:00:00Z');
  let s = 0;
  for (let i = 0; i < 365; i++) {
    const key = cur.toISOString().slice(0, 10);
    if (dates.has(key)) s++; else if (i > 0) break;
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return s;
}
const streakEmoji = (s: number) => (s >= 30 ? '🏆' : s >= 14 ? '🔥🔥' : s >= 7 ? '🔥' : s >= 3 ? '⭐' : s >= 1 ? '✨' : '💤');

/* ---------------- Status sementara (pending / undo) ---------------- */
async function setTemp(chat: number, kind: 'pending' | 'undo' | 'lock', payload: unknown, seconds = 300) {
  const { error } = await sb.from('telegram_pending').upsert(
    { chat_id: chat, kind, payload, expires_at: new Date(Date.now() + seconds * 1000).toISOString() },
    { onConflict: 'chat_id,kind' },
  );
  if (error) throw error;
}
async function getTemp(chat: number, kind: 'pending' | 'undo' | 'lock'): Promise<Any | null> {
  const { data } = await sb.from('telegram_pending').select('payload')
    .eq('chat_id', chat).eq('kind', kind).gt('expires_at', new Date().toISOString()).maybeSingle();
  return data?.payload ?? null;
}
const delTemp = (chat: number, kind: 'pending' | 'undo' | 'lock') =>
  sb.from('telegram_pending').delete().eq('chat_id', chat).eq('kind', kind);

/* ---------------- Simpan transaksi ---------------- */
async function saveTx(c: Ctx, p: Tx) {
  const { error } = await sb.from('transactions').insert({
    user_id: c.uid, tanggal: p.tanggal, tipe: p.tipe, kategori: p.kategori,
    nominal: p.nominal, keterangan: p.keterangan || 'Via Telegram', source: 'telegram',
    wallet_id: p.wallet_id || null,   // kosong → trigger database memakai dompet pertama (BCA)
  });
  if (error) throw error;
  await syncPeriod(c.uid, p.tanggal);
}

const savedMsg = (title: string, p: Tx) =>
  `${title}\n\n${p.tipe === 'Pemasukan' ? '🟢' : '🔴'} ${p.tipe}\n🏷️ ${esc(p.kategori)}\n💵 <b>${rp(p.nominal)}</b>\n📅 ${p.tanggal}` + (p.walletName ? `\n💳 ${esc(p.walletName)}` : '');

/* ---------------- AI parser (Gemini) ---------------- */
async function parseWithAI(c: Ctx, text: string): Promise<Tx & { keterangan: string }> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY belum diatur.');
  const inc = await getCategories(c.uid, 'pemasukan');
  const exp = await getCategories(c.uid, 'pengeluaran');
  const now = today();
  const prompt = `Kamu adalah asisten keuangan yang mengubah kalimat bahasa Indonesia menjadi data transaksi terstruktur.

ATURAN:
1. "tipe": "Pemasukan" atau "Pengeluaran".
2. "kategori" WAJIB salah satu dari:
   PEMASUKAN: ${inc.join(', ') || 'Lainnya'}
   PENGELUARAN: ${exp.join(', ') || 'Lainnya'}
   Jika tidak ada yang cocok, pilih "Lainnya".
3. "nominal" angka murni (tanpa titik/koma/Rp): "50rb"→50000, "1.5jt"→1500000, "dua ratus ribu"→200000.
4. "keterangan" ringkasan singkat.
5. "tanggal" format YYYY-MM-DD. Default: ${now}.

CONTOH:
INPUT: "tadi beli kopi 25rb"
OUTPUT: {"tipe":"Pengeluaran","kategori":"Makanan","nominal":25000,"keterangan":"Beli kopi","tanggal":"${now}"}

INPUT USER: ${JSON.stringify(text)}
OUTPUT:`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            tipe: { type: 'STRING', enum: ['Pemasukan', 'Pengeluaran'] },
            kategori: { type: 'STRING' },
            nominal: { type: 'NUMBER' },
            keterangan: { type: 'STRING' },
            tanggal: { type: 'STRING' },
          },
          required: ['tipe', 'kategori', 'nominal', 'tanggal'],
        },
      },
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error('Gemini: ' + j.error.message);
  const p = JSON.parse(j.candidates[0].content.parts[0].text);

  const nominal = Math.round(Number(p.nominal));
  if (!nominal || nominal <= 0) throw new Error('Nominal tidak terbaca');
  const cats = p.tipe === 'Pemasukan' ? inc : exp;
  return {
    tipe: p.tipe,
    kategori: cats.includes(p.kategori) ? p.kategori : (cats.includes('Lainnya') ? 'Lainnya' : p.kategori),
    nominal,
    keterangan: p.keterangan || 'Via AI',
    tanggal: /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal) ? p.tanggal : now,
  };
}

function confirmPreview(chat: number, p: Tx) {
  const text = `📝 <b>Saya pahami:</b>\n\n${p.tipe === 'Pemasukan' ? '🟢' : '🔴'} <b>${p.tipe}</b>\n` +
    `🏷️ Kategori: <b>${esc(p.kategori)}</b>\n💵 Nominal: <b>${rp(p.nominal)}</b>\n📅 Tanggal: <b>${p.tanggal}</b>` +
    (p.walletName ? `\n💳 Dompet: <b>${esc(p.walletName)}</b>` : '') +
    (p.keterangan ? `\n📝 <i>${esc(p.keterangan)}</i>` : '') + '\n\n<b>Simpan transaksi ini?</b>';
  return send(chat, text, {
    inline_keyboard: [
      [{ text: '✅ Simpan', callback_data: 'confirm_save' }, { text: '❌ Batal', callback_data: 'confirm_cancel' }],
      [{ text: '✏️ Ubah Kategori', callback_data: 'confirm_edit_cat' }, ...(p.walletName ? [{ text: '🔁 Ganti Dompet', callback_data: 'confirm_wallet' }] : [])],
    ],
  });
}

/* ---------------- Dompet (BCA / Cash) ---------------- */
type Wallet = { id: string; name: string; kind: string; opening_balance: number; sort: number };

async function getWallets(uid: string): Promise<Wallet[]> {
  const rows = await fetchAll('wallets', 'id,name,kind,opening_balance,sort', uid, ['sort', 'name']);
  return rows.map((r) => ({ ...r, opening_balance: Number(r.opening_balance) || 0 }));
}
const walletByKind = (ws: Wallet[], kind: 'bank' | 'cash'): Wallet | undefined => ws.find((w) => w.kind === kind) ?? ws[0];

function detectWalletKind(text: string): 'bank' | 'cash' | null {
  if (/\b(cash|tunai)\b/i.test(text)) return 'cash';
  if (/\b(bca|m-?banking|debit|qris|transfer)\b/i.test(text)) return 'bank';
  return null;
}

// Sama dengan walletBalances() di website: saldo awal + transaksi per dompet + transfer
function walletBalancesBot(ws: Wallet[], trx: Any[], transfers: Any[]): Map<string, number> {
  const bal = new Map<string, number>(ws.map((w) => [w.id, w.opening_balance]));
  const def = ws[0]?.id;
  for (const t of trx) {
    const id = t.wallet_id && bal.has(t.wallet_id) ? t.wallet_id : def;
    if (!id) continue;
    const n = Number(t.nominal) || 0;
    let eff: number;
    if (isPiutang(t.kategori)) eff = t.tipe === 'Pengeluaran' ? -n : n;
    else if (isUtang(t.kategori)) eff = t.tipe === 'Pemasukan' ? 0 : -n;
    else eff = t.tipe === 'Pemasukan' ? n : -n;
    bal.set(id, (bal.get(id) ?? 0) + eff);
  }
  for (const x of transfers) {
    const n = Number(x.nominal) || 0, f = Number(x.fee) || 0;
    if (x.from_wallet && bal.has(x.from_wallet)) bal.set(x.from_wallet, (bal.get(x.from_wallet) ?? 0) - n - f);
    if (x.to_wallet && bal.has(x.to_wallet)) bal.set(x.to_wallet, (bal.get(x.to_wallet) ?? 0) + n);
  }
  return bal;
}

async function loadMoney(uid: string) {
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

async function handleTarik(c: Ctx, arg: string) {
  const parts = arg.replace(/^tunai\s*/i, '').split(/\s+/).filter(Boolean);
  const nominal = parseNominal(parts[0] ?? '');
  if (nominal <= 0) {
    return send(c.chat, '❌ Format: <code>/tarik 500rb</code>\natau dengan biaya admin: <code>/tarik 500rb 6500</code>', mainKb());
  }
  const fee = parts[1] ? parseNominal(parts[1]) : 0;
  const ws = await getWallets(c.uid);
  const bank = ws.find((w) => w.kind === 'bank'), cash = ws.find((w) => w.kind === 'cash');
  if (!bank || !cash) return send(c.chat, '❌ Dompet BCA dan Cash belum ada. Buka website sekali agar dibuat otomatis.', mainKb());
  const { error } = await sb.from('transfers').insert({
    user_id: c.uid, tanggal: today(), kind: 'tarik_tunai', from_wallet: bank.id, to_wallet: cash.id,
    nominal, fee, keterangan: 'Via Telegram',
  });
  if (error) throw error;
  const m = await loadMoney(c.uid);
  await send(c.chat,
    `🏧 <b>Tarik tunai tercatat!</b>\n\n${esc(bank.name)}: <b>-${rp(nominal + fee)}</b>${fee ? ` (termasuk biaya ${rp(fee)})` : ''}\n` +
    `${esc(cash.name)}: <b>+${rp(nominal)}</b>\n\n💳 <b>Saldo sekarang</b>\n${m.walletLines}`, mainKb());
}

/* ---------------- Handler perintah ---------------- */
async function handleStatus(c: Ctx) {
  const { trx, st, b, walletLines } = await loadMoney(c.uid);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  const isFlow = (t: Any) => !isUtang(t.kategori) && !isPiutang(t.kategori);

  const todayOutTx = trx.filter((t) => String(t.tanggal).slice(0, 10) === today() && t.tipe === 'Pengeluaran' && isFlow(t));
  const monthTx = trx.filter((t) => inPeriod(String(t.tanggal), period, pd));
  let mIn = 0, mOut = 0;
  for (const t of monthTx) {
    if (!isFlow(t)) continue;
    if (t.tipe === 'Pemasukan') mIn += Number(t.nominal); else mOut += Number(t.nominal);
  }
  const tglStr = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(new Date());
  const st2 = streak(trx);
  const sel = mIn - mOut;

  let s = `👋 Halo <b>${esc(c.name)}</b>!\n📅 ${tglStr}\n\n`;
  s += `━━━━━━━━━━━━━━━━\n💰 <b>KEKAYAAN BERSIH</b>\n━━━━━━━━━━━━━━━━\n<b>${rp(b.net)}</b>\n\n`;
  s += `• Saldo Kas:   <b>${rp(b.kas)}</b>\n` + walletLines + `• Investasi:   <b>${rp(b.investasi)}</b>\n`;
  s += `• Piutang:     <b>${rp(b.piutang)}</b>\n• Utang:      <b>-${rp(b.utang)}</b>\n\n`;
  s += `━━━━━━━━━━━━━━━━\n📊 <b>${periodLabel(period, pd).toUpperCase()}</b>\n━━━━━━━━━━━━━━━━\n`;
  s += `📥 Pemasukan:   <b>${rp(mIn)}</b>\n📤 Pengeluaran: <b>${rp(mOut)}</b>\n`;
  s += `💵 Selisih:     <b>${sel >= 0 ? '+' : ''}${rp(sel)}</b>\n📝 ${monthTx.length} transaksi\n\n`;
  s += `━━━━━━━━━━━━━━━━\n🔥 <b>HARI INI</b>\n━━━━━━━━━━━━━━━━\n`;
  s += todayOutTx.length === 0
    ? '✨ Belum ada pengeluaran\n'
    : `📤 Total: <b>${rp(todayOutTx.reduce((a, t) => a + Number(t.nominal), 0))}</b>\n📝 ${todayOutTx.length} transaksi\n`;
  s += `\n🔥 <b>Streak:</b> ${st2} hari ${streakEmoji(st2)}\n`;
  await send(c.chat, s, statusKb());
}

async function handleSaldo(c: Ctx) {
  const { trx, st, b, walletLines } = await loadMoney(c.uid);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  let tIn = 0, tOut = 0;
  for (const t of trx) {
    if (!inPeriod(String(t.tanggal), period, pd) || isUtang(t.kategori) || isPiutang(t.kategori)) continue;
    if (t.tipe === 'Pemasukan') tIn += Number(t.nominal); else tOut += Number(t.nominal);
  }
  await send(c.chat,
    `💰 <b>Saldo & Ringkasan</b>\nSiklus: <code>${periodLabel(period, pd)}</code>\n\n` +
    `📥 Pemasukan (siklus):   <b>${rp(tIn)}</b>\n📤 Pengeluaran (siklus): <b>${rp(tOut)}</b>\n` +
    `💵 Selisih:              <b>${rp(tIn - tOut)}</b>\n\n` +
    `💼 <b>Saldo Kas (total):</b> <b>${rp(b.kas)}</b>\n${walletLines}📈 Investasi:             <b>${rp(b.investasi)}</b>\n\n` +
    `🏦 <b>Net Worth:</b> <b>${rp(b.net)}</b>`, mainKb());
}

async function handleBulan(c: Ctx) {
  const [trx, st] = await Promise.all([
    fetchAll('transactions', 'tanggal,tipe,kategori,nominal', c.uid, ['tanggal', 'id']),
    getSettings(c.uid),
  ]);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  const txs = trx.filter((t) => inPeriod(String(t.tanggal), period, pd)).reverse(); // terbaru dulu
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

async function handleTambah(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    return send(c.chat, '❌ Format: <code>/tambah [Pemasukan|Pengeluaran] [Kategori] [Nominal]</code>');
  }
  const tipe = (parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()) as Tx['tipe'];
  if (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') return send(c.chat, '❌ Tipe harus Pemasukan atau Pengeluaran.');
  // kata terakhir boleh nama dompet: cash / tunai / bca
  let walletKind: 'bank' | 'cash' = 'bank';
  const lastTok = parts[parts.length - 1].toLowerCase();
  if (lastTok === 'cash' || lastTok === 'tunai') { walletKind = 'cash'; parts.pop(); }
  else if (lastTok === 'bca' || lastTok === 'bank') { parts.pop(); }
  if (parts.length < 3) return send(c.chat, '❌ Format: <code>/tambah [Pemasukan|Pengeluaran] [Kategori] [Nominal] [cash|bca]</code>');
  const nominal = parseNominal(parts[parts.length - 1]);
  if (nominal <= 0) return send(c.chat, '❌ Nominal tidak valid.');
  const w = walletByKind(await getWallets(c.uid), walletKind);
  const p: Tx = { tanggal: today(), tipe, kategori: parts.slice(1, -1).join(' '), nominal, keterangan: 'Via Telegram', wallet_id: w?.id ?? null, walletName: w?.name };
  await saveTx(c, p);
  await send(c.chat, savedMsg('✅ <b>Tersimpan!</b>', p), mainKb());
  if (p.tipe === 'Pengeluaran') await checkBudgetAlert(c, p.kategori);
}

async function handleFreeText(c: Ctx, text: string) {
  try {
    const p = await parseWithAI(c, text);
    const w = walletByKind(await getWallets(c.uid), detectWalletKind(text) ?? 'bank');
    const pend = { ...p, originalText: text, wallet_id: w?.id ?? null, walletName: w?.name ?? '' };
    await setTemp(c.chat, 'pending', pend);
    await confirmPreview(c.chat, pend);
  } catch (e) {
    console.error('freeText', e);
    await send(c.chat, '❌ Maaf, saya belum paham.\n\nContoh:\n<code>makan siang 25rb</code>', mainKb());
  }
}

async function handleKategori(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();
  if (!action || action === 'list' || action === 'lihat') {
    const inc = await getCategories(c.uid, 'pemasukan');
    const exp = await getCategories(c.uid, 'pengeluaran');
    return send(c.chat,
      `📚 <b>Daftar Kategori</b>\n\n🟢 <b>Pemasukan</b> (${inc.length}):\n${inc.map((x) => '  • ' + esc(x)).join('\n')}\n\n` +
      `🔴 <b>Pengeluaran</b> (${exp.length}):\n${exp.map((x) => '  • ' + esc(x)).join('\n')}\n\n` +
      `➕ Tambah: <code>/kategori tambah Pemasukan Crypto</code>`, kategoriKb());
  }
  if (['tambah', 'add', 'baru'].includes(action)) {
    if (parts.length < 3) return send(c.chat, '❌ Format: <code>/kategori tambah [Pemasukan|Pengeluaran] [Nama]</code>', kategoriKb());
    const raw = parts[1].toLowerCase();
    const tipe = raw.includes('pem') || raw === 'in' || raw === '+' ? 'pemasukan'
      : raw.includes('peng') || raw === 'out' || raw === '-' ? 'pengeluaran' : '';
    if (!tipe) return send(c.chat, '❌ Tipe harus Pemasukan atau Pengeluaran.');
    const nama = parts.slice(2).join(' ').trim();
    const existing = await getCategories(c.uid, tipe as 'pemasukan' | 'pengeluaran');
    if (existing.some((x) => x.toLowerCase() === nama.toLowerCase())) {
      return send(c.chat, `⚠️ Kategori "<b>${esc(nama)}</b>" sudah ada.`);
    }
    const { error } = await sb.from('categories').insert({ user_id: c.uid, tipe, name: nama });
    if (error) throw error;
    return send(c.chat, `✅ <b>Kategori ditambahkan!</b>\n\n📌 ${tipe === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'}\n🏷️ <b>${esc(nama)}</b>`, kategoriKb());
  }
  return send(c.chat, '❓ Command tidak dikenal. Gunakan /kategori untuk lihat.', kategoriKb());
}

async function handleHapus(c: Ctx) {
  // Hapus transaksi yang TERAKHIR DICATAT (bukan terbaru menurut tanggal).
  const { data, error } = await sb.from('transactions')
    .select('id,tanggal,tipe,kategori,nominal,keterangan,wallet_id')
    .eq('user_id', c.uid).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  const last = data?.[0];
  if (!last) return send(c.chat, '📭 Belum ada transaksi untuk dihapus.', mainKb());
  await setTemp(c.chat, 'undo', last);
  const { error: e2 } = await sb.from('transactions').delete().eq('id', last.id).eq('user_id', c.uid);
  if (e2) throw e2;
  await send(c.chat,
    savedMsg('🗑️ <b>Transaksi dihapus!</b>', { ...last, nominal: Number(last.nominal) }) +
    '\n\n💡 Salah hapus? Ketik <code>/undo</code> dalam 5 menit.', mainKb());
}

async function handleUndo(c: Ctx) {
  const t = await getTemp(c.chat, 'undo');
  if (!t) return send(c.chat, '⌛ Tidak ada yang bisa di-undo (kadaluarsa / belum ada).', mainKb());
  const p: Tx = { tanggal: t.tanggal, tipe: t.tipe, kategori: t.kategori, nominal: Number(t.nominal), keterangan: t.keterangan || '', wallet_id: t.wallet_id ?? null };
  await saveTx(c, p);
  await delTemp(c.chat, 'undo');
  await send(c.chat, savedMsg('↩️ <b>Berhasil di-undo!</b>', p), mainKb());
}

/* ---------------- Tahap 3b: helper bersama ---------------- */
const GEMINI_INSIGHT_MODEL = Deno.env.get('GEMINI_MODEL_INSIGHT') ?? 'gemini-2.5-flash';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isFlow = (k: string) => !isUtang(k) && !isPiutang(k);

async function loadCore(uid: string) {
  const [trx, st] = await Promise.all([
    fetchAll('transactions', 'tanggal,tipe,kategori,nominal', uid, ['tanggal', 'id']),
    getSettings(uid),
  ]);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  return { trx, pd, period };
}

function actualFor(trx: Any[], kategori: string, period: string, pd: number): number {
  return trx
    .filter((t) => t.tipe === 'Pengeluaran' && t.kategori === kategori && isFlow(t.kategori) && inPeriod(String(t.tanggal), period, pd))
    .reduce((a, t) => a + Number(t.nominal), 0);
}

async function getBudgets(uid: string, period: string): Promise<Any[]> {
  const rows = await fetchAll('budgets', 'id,kategori,bulan,jumlah', uid, ['kategori']);
  return rows.filter((b) => String(b.bulan).slice(0, 7) === period);
}

// Teks dari AI: escape semua, lalu pulihkan hanya tag yang diizinkan Telegram (b, i, code)
const safeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;(\/?)(b|i|code)&gt;/g, '<$1$2>');

/* ---------------- Budget ---------------- */
async function handleBudget(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();

  if (!action || action === 'list' || action === 'lihat') return showBudgets(c);

  if (['set', 'tambah', 'add'].includes(action)) {
    if (parts.length < 3) {
      return send(c.chat, '❌ Format: <code>/budget set [Kategori] [Jumlah]</code>\n\nContoh:\n<code>/budget set Makanan 1500000</code>', mainKb());
    }
    const jumlah = parseNominal(parts[parts.length - 1]);
    if (jumlah <= 0) return send(c.chat, '❌ Jumlah tidak valid.', mainKb());
    return setBudget(c, parts.slice(1, -1).join(' '), jumlah);
  }
  if (['hapus', 'delete', 'remove'].includes(action)) {
    if (parts.length < 2) return send(c.chat, '❌ Format: <code>/budget hapus [Kategori]</code>', mainKb());
    return deleteBudget(c, parts.slice(1).join(' '));
  }
  if (['cek', 'detail'].includes(action)) {
    if (parts.length < 2) return send(c.chat, '❌ Format: <code>/budget cek [Kategori]</code>', mainKb());
    return budgetDetail(c, parts.slice(1).join(' '));
  }
  if (action === 'copy') return copyBudget(c);

  return send(c.chat,
    '<b>📊 Command Budget</b>\n\n• <code>/budget</code> — lihat semua budget\n• <code>/budget set Makanan 1500000</code> — set budget\n' +
    '• <code>/budget cek Makanan</code> — detail 1 kategori\n• <code>/budget hapus Makanan</code> — hapus\n• <code>/budget copy</code> — copy dari bulan lalu', mainKb());
}

async function showBudgets(c: Ctx) {
  const { trx, pd, period } = await loadCore(c.uid);
  const label = periodLabel(period, pd);
  const budgets = await getBudgets(c.uid, period);
  if (budgets.length === 0) {
    return send(c.chat,
      `📊 <b>Budget ${period}</b>\n📅 Siklus: ${label}\n\n📭 Belum ada budget bulan ini.\n\n➕ Tambah dengan:\n<code>/budget set Makanan 1500000</code>`, mainKb());
  }
  let s = `📊 <b>Budget ${period}</b>\n📅 ${label}\n━━━━━━━━━━━━━━━━\n\n`;
  let totalPlan = 0, totalActual = 0;
  for (const b of budgets) {
    const plan = Number(b.jumlah) || 0;
    const actual = actualFor(trx, b.kategori, period, pd);
    const pct = plan > 0 ? (actual / plan) * 100 : 0;
    const sisa = plan - actual;
    totalPlan += plan; totalActual += actual;
    const icon = pct > 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
    s += `${icon} <b>${esc(b.kategori)}</b>\n   ${rp(actual)} / ${rp(plan)} (${pct.toFixed(0)}%)\n`;
    s += `   ${sisa >= 0 ? 'Sisa: +' : 'Over: -'}${rp(Math.abs(sisa))}\n\n`;
  }
  const totalPct = totalPlan > 0 ? (totalActual / totalPlan) * 100 : 0;
  s += `━━━━━━━━━━━━━━━━\n📈 <b>Total:</b> ${totalPct.toFixed(0)}% terpakai\n📥 Actual: ${rp(totalActual)}\n🎯 Plan: ${rp(totalPlan)}`;
  await send(c.chat, s, mainKb());
}

async function budgetDetail(c: Ctx, kategori: string) {
  const { trx, pd, period } = await loadCore(c.uid);
  const b = (await getBudgets(c.uid, period)).find((x) => x.kategori.toLowerCase() === kategori.toLowerCase());
  if (!b) {
    return send(c.chat, `❌ Budget <b>${esc(kategori)}</b> tidak ditemukan.\n\nTambah: <code>/budget set ${esc(kategori)} 1000000</code>`, mainKb());
  }
  const plan = Number(b.jumlah) || 0;
  const actual = actualFor(trx, b.kategori, period, pd);
  const pct = plan > 0 ? (actual / plan) * 100 : 0;
  const sisa = plan - actual;
  const n = trx.filter((t) => t.tipe === 'Pengeluaran' && t.kategori === b.kategori && inPeriod(String(t.tanggal), period, pd)).length;
  const status = pct > 100 ? '🔴 Over' : pct >= 80 ? '🟡 Mendekati' : '🟢 Aman';
  await send(c.chat,
    `📊 <b>${esc(b.kategori)}</b>\n📅 ${periodLabel(period, pd)}\n━━━━━━━━━━━━━━━━\n\n` +
    `🎯 Plan:    <b>${rp(plan)}</b>\n📥 Actual:  <b>${rp(actual)}</b>\n` +
    `💵 ${sisa >= 0 ? 'Sisa: ' : 'Over: '}<b>${sisa >= 0 ? '+' : '-'}${rp(Math.abs(sisa))}</b>\n` +
    `📈 Terpakai: <b>${pct.toFixed(0)}%</b>\n📝 ${n} transaksi\n\nStatus: ${status}`, mainKb());
}

async function setBudget(c: Ctx, kategori: string, jumlah: number) {
  const { pd, period } = await loadCore(c.uid);
  const cats = await getCategories(c.uid, 'pengeluaran');
  const found = cats.find((k) => k.toLowerCase() === kategori.toLowerCase());
  if (!found) {
    return send(c.chat,
      `❌ Kategori <b>${esc(kategori)}</b> tidak ada.\n\nKategori tersedia:\n${cats.map((k) => '• ' + esc(k)).join('\n')}\n\n` +
      `Tambah: <code>/kategori tambah Pengeluaran ${esc(kategori)}</code>`, mainKb());
  }
  const { error } = await sb.from('budgets').upsert(
    { user_id: c.uid, kategori: found, bulan: period, jumlah },
    { onConflict: 'user_id,kategori,bulan' },
  );
  if (error) throw error;
  await send(c.chat,
    `✅ <b>Budget di-set!</b>\n\n📌 ${esc(found)}\n💵 ${rp(jumlah)}\n📅 ${periodLabel(period, pd)}\n\nCek dengan: <code>/budget</code>`, mainKb());
}

async function deleteBudget(c: Ctx, kategori: string) {
  const { period } = await loadCore(c.uid);
  const b = (await getBudgets(c.uid, period)).find((x) => x.kategori.toLowerCase() === kategori.toLowerCase());
  if (!b) return send(c.chat, `❌ Budget <b>${esc(kategori)}</b> tidak ditemukan bulan ini.`, mainKb());
  const { error } = await sb.from('budgets').delete().eq('id', b.id).eq('user_id', c.uid);
  if (error) throw error;
  await send(c.chat, `🗑️ Budget <b>${esc(b.kategori)}</b> dihapus.`, mainKb());
}

async function copyBudget(c: Ctx) {
  const { pd, period } = await loadCore(c.uid);
  const [y, m] = period.split('-').map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${pad(m === 1 ? 12 : m - 1)}`;
  const source = await getBudgets(c.uid, prev);
  if (source.length === 0) return send(c.chat, '❌ Tidak ada budget di bulan sebelumnya untuk di-copy.', mainKb());
  const have = new Set((await getBudgets(c.uid, period)).map((b) => b.kategori));
  const rows = source.filter((b) => !have.has(b.kategori))
    .map((b) => ({ user_id: c.uid, kategori: b.kategori, bulan: period, jumlah: b.jumlah }));
  if (rows.length) {
    const { error } = await sb.from('budgets').insert(rows);
    if (error) throw error;
  }
  await send(c.chat,
    `✅ <b>Budget di-copy!</b>\n\n📋 Dari: ${periodLabel(prev, pd)}\n📌 Ke: ${periodLabel(period, pd)}\n\n${source.length} kategori di-copy.`, mainKb());
}

// Dipanggil setelah pengeluaran tersimpan: peringatan bila ≥80% / ≥100% budget
async function checkBudgetAlert(c: Ctx, kategori: string) {
  try {
    if (!isFlow(kategori)) return;
    const { trx, pd, period } = await loadCore(c.uid);
    const b = (await getBudgets(c.uid, period)).find((x) => x.kategori.toLowerCase() === kategori.toLowerCase());
    if (!b) return;
    const plan = Number(b.jumlah) || 0;
    const actual = actualFor(trx, b.kategori, period, pd);
    const pct = plan > 0 ? (actual / plan) * 100 : 0;
    if (pct < 80) return;
    const sisa = plan - actual;
    await send(c.chat,
      `${pct >= 100 ? '🚨' : '⚠️'} <b>${pct >= 100 ? 'BUDGET OVER!' : 'BUDGET WARNING'}</b>\n\n` +
      `📌 Kategori: <b>${esc(b.kategori)}</b>\n📊 Terpakai: <b>${pct.toFixed(0)}%</b>\n\n🎯 Plan:    ${rp(plan)}\n📥 Actual:  ${rp(actual)}\n` +
      (sisa >= 0 ? `💵 Sisa:    ${rp(sisa)}` : `💸 Over:    ${rp(Math.abs(sisa))}`) + '\n\n' +
      (pct >= 100 ? 'Coba review pengeluaran kategori ini ya 📝' : 'Hati-hati, jangan sampai over! 🎯'));
  } catch (e) { console.error('budgetAlert', e); }
}

/* ---------------- Recurring ---------------- */
async function handleRecurring(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();

  if (!action || action === 'list' || action === 'lihat') return showRecurring(c);

  if (['add', 'tambah', 'set'].includes(action)) {
    const usage =
      '❌ <b>Format:</b>\n<code>/recurring add [Tipe] [Kategori] [Nominal] [Tanggal]</code>\n\n<b>Contoh:</b>\n' +
      '<code>/recurring add Pengeluaran Tagihan 350000 5</code>\n<code>/recurring add Pemasukan Gaji 8500000 25</code>\n\n📌 Tanggal = 1-28';
    if (parts.length < 5) return send(c.chat, usage, mainKb());
    const tipe = (parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase()) as Tx['tipe'];
    if (tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') return send(c.chat, '❌ Tipe harus Pemasukan atau Pengeluaran');
    const day = parseInt(parts[parts.length - 1], 10);
    if (!day || day < 1 || day > 28) return send(c.chat, '❌ Tanggal harus 1-28');
    const nominal = parseNominal(parts[parts.length - 2]);
    if (nominal <= 0) return send(c.chat, '❌ Nominal tidak valid');
    const kategori = parts.slice(2, -2).join(' ');
    const { error } = await sb.from('recurring').insert({
      user_id: c.uid, tipe, kategori, nominal, keterangan: 'Auto via Telegram', day_of_month: day, active: true,
    });
    if (error) throw error;
    return send(c.chat,
      `✅ <b>Recurring ditambahkan!</b>\n\n${tipe === 'Pemasukan' ? '📥' : '📤'} ${tipe}\n🏷️ ${esc(kategori)}\n💵 ${rp(nominal)}\n📅 Setiap tanggal <b>${day}</b>`, mainKb());
  }

  if (['hapus', 'delete', 'toggle', 'aktif'].includes(action)) {
    const del = action === 'hapus' || action === 'delete';
    if (parts.length < 2) return send(c.chat, `❌ Format: <code>/recurring ${del ? 'hapus' : 'toggle'} [id]</code>`);
    const rows = await fetchAll('recurring', 'id,kategori,active', c.uid, ['id']);
    const found = rows.find((r) => r.id.startsWith(parts[1].toLowerCase()));
    if (!found) return send(c.chat, '❌ Recurring tidak ditemukan', mainKb());
    if (del) {
      const { error } = await sb.from('recurring').delete().eq('id', found.id).eq('user_id', c.uid);
      if (error) throw error;
      return send(c.chat, `🗑️ <b>${esc(found.kategori)}</b> dihapus.`, mainKb());
    }
    const { error } = await sb.from('recurring').update({ active: !found.active }).eq('id', found.id).eq('user_id', c.uid);
    if (error) throw error;
    return send(c.chat, `🔄 <b>${esc(found.kategori)}</b> sekarang <b>${found.active ? 'nonaktif ⚫' : 'aktif 🟢'}</b>`, mainKb());
  }

  return send(c.chat, '❓ Command tidak dikenal. Ketik /recurring untuk lihat.', mainKb());
}

async function showRecurring(c: Ctx) {
  const list = await fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,active', c.uid, ['day_of_month', 'kategori']);
  if (list.length === 0) {
    return send(c.chat,
      '🔄 <b>Recurring Transactions</b>\n\n📭 Belum ada recurring.\n\n➕ Tambah dengan:\n<code>/recurring add Pengeluaran Tagihan 350000 5</code>', mainKb());
  }
  let s = '🔄 <b>Recurring Transactions</b>\n━━━━━━━━━━━━━━━━\n\n';
  for (const r of list) {
    s += `${r.active ? '🟢' : '⚫'} <b>${esc(r.kategori)}</b>\n   ${r.tipe === 'Pemasukan' ? '📥' : '📤'} ${r.tipe}\n   💵 ${rp(Number(r.nominal))}\n   📅 Tiap tgl <b>${r.day_of_month}</b>\n`;
    if (r.keterangan) s += `   📝 <i>${esc(r.keterangan)}</i>\n`;
    s += `   🆔 <code>${r.id.slice(0, 8)}</code>\n\n`;
  }
  s += '━━━━━━━━━━━━━━━━\n• <code>/recurring toggle [id]</code>\n• <code>/recurring hapus [id]</code>';
  await send(c.chat, s, mainKb());
}

/* ---------------- Insight AI ---------------- */
async function askInsight(sum: { period: string; totalIn: number; totalOut: number; n: number; top: string }): Promise<string> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY belum diatur.');
  const prompt = `Kamu adalah financial advisor Indonesia yang ramah dan sedikit santai. Analisis data keuangan bulanan user berikut.

DATA BULAN ${sum.period}:
- Pemasukan: ${rp(sum.totalIn)}
- Pengeluaran: ${rp(sum.totalOut)}
- Saldo bersih: ${rp(sum.totalIn - sum.totalOut)}
- Jumlah transaksi: ${sum.n}
- Breakdown pengeluaran:
${sum.top || 'Belum ada'}

FORMAT OUTPUT:
- Bahasa Indonesia santai, profesional, personal
- HTML Telegram: boleh <b>, <i>, <code>
- Maksimal 200 kata
- Struktur: 1) kalimat pembuka + emoji, 2) 2-3 observasi penting (bullet •), 3) 2-3 saran konkret (bullet •), 4) penutup motivasi
- JANGAN pakai markdown (**, *, #). Bullet pakai •`;

  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_INSIGHT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const j = await r.json();
    if (j.error) {
      const msg = String(j.error.message || '');
      if (attempt < 3 && /high demand|overloaded/i.test(msg)) { await sleep(2 ** attempt * 1000); continue; }
      throw new Error('Gemini: ' + msg);
    }
    const text: string = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) throw new Error('Gemini: respons kosong');
    return text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^\*\s+/gm, '• ').trim();
  }
}

async function handleInsight(c: Ctx) {
  if (await getTemp(c.chat, 'lock')) {
    return send(c.chat, '⏳ Sabar ya, insight sebelumnya masih diproses.\nTunggu ~30 detik lagi.', mainKb());
  }
  await setTemp(c.chat, 'lock', { at: Date.now() }, 30);
  await send(c.chat, '🤖 <b>Menganalisis data keuangan...</b>\n\nMohon tunggu ~5 detik ⏳');

  const { trx, pd, period } = await loadCore(c.uid);
  const monthTx = trx.filter((t) => inPeriod(String(t.tanggal), period, pd));
  if (monthTx.length === 0) return send(c.chat, '📭 Belum ada transaksi bulan ini untuk dianalisis.', mainKb());

  let totalIn = 0, totalOut = 0;
  const byCat: Record<string, number> = {};
  for (const t of monthTx) {
    if (!isFlow(t.kategori)) continue;
    const n = Number(t.nominal);
    if (t.tipe === 'Pemasukan') totalIn += n;
    else { totalOut += n; byCat[t.kategori] = (byCat[t.kategori] || 0) + n; }
  }
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const sum = { period, totalIn, totalOut, n: monthTx.length, top: top.map(([k, v]) => `• ${k}: ${rp(v)}`).join('\n') };

  let body: string;
  try {
    body = safeHtml(await askInsight(sum));
  } catch (e) {
    console.error('insight', e);
    const sel = totalIn - totalOut;
    body = (sel > 0 ? `🎉 <b>Surplus ${rp(sel)}!</b> Kerja bagus!` : sel < 0 ? `⚠️ <b>Defisit ${rp(-sel)}.</b> Coba hemat ya.` : '⚖️ Pas-pasan bulan ini. Seimbang!') +
      `\n\n📊 <b>Ringkasan:</b>\n📥 Pemasukan: <b>${rp(totalIn)}</b>\n📤 Pengeluaran: <b>${rp(totalOut)}</b>\n📝 ${monthTx.length} transaksi` +
      (top.length ? `\n\n🔝 <b>Pengeluaran Utama:</b>\n${top.map(([k, v]) => `• ${esc(k)}: ${rp(v)}`).join('\n')}` : '') +
      '\n\n💡 Coba <code>/insight</code> lagi nanti untuk analisis lebih dalam.';
  }
  await send(c.chat, `💡 <b>Insight Bulan ${period}</b>\n\n${body}`, mainKb());
}

/* ---------------- Batch ---------------- */
function parseBatchLine(line: string, defaultDate: string): { ok: true; data: Tx } | { ok: false; error: string } {
  let tanggal = defaultDate, s = line;
  const dm = s.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*/);
  if (dm) { tanggal = dm[1]; s = s.slice(dm[0].length); }
  let sep = '|', best = 0;
  for (const x of ['|', ';', '\t', ',']) {
    const n = s.split(x).length - 1;
    if (n > best) { best = n; sep = x; }
  }
  if (best === 0) return { ok: false, error: 'Tidak ada separator' };
  const parts = s.split(sep).map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length < 3) return { ok: false, error: 'Minimal 3 kolom' };
  const raw = parts[0].toLowerCase();
  const tipe = raw.includes('pem') || raw === 'in' || raw === '+' ? 'Pemasukan'
    : raw.includes('peng') || raw === 'out' || raw === '-' ? 'Pengeluaran' : null;
  if (!tipe) return { ok: false, error: 'Tipe tidak dikenal' };
  const kategori = parts[1];
  const nominal = parseNominal(parts[2]);
  if (nominal <= 0) return { ok: false, error: 'Nominal tidak valid' };
  return { ok: true, data: { tanggal, tipe, kategori, nominal, keterangan: parts.slice(3).join(' ').trim() } };
}

async function handleBatch(c: Ctx, fullText: string) {
  const lines = fullText.split('\n').map((l) => l.trim()).filter((l) => l && !l.toLowerCase().startsWith('/batch') && l.toLowerCase() !== 'batch');
  if (lines.length === 0) {
    return send(c.chat, '📦 <b>Format /batch</b>\n\n<code>/batch\nPemasukan | Gaji | 8000000\nPengeluaran | Makanan | 50000</code>', mainKb());
  }
  const rows: Tx[] = [], errors: string[] = [];
  lines.forEach((line, i) => {
    const r = parseBatchLine(line, today());
    if (r.ok) rows.push(r.data); else errors.push(`Baris ${i + 1}: ${r.error}`);
  });
  if (rows.length === 0) return send(c.chat, '❌ Tidak ada baris valid.\n' + errors.join('\n'));

  const { error } = await sb.from('transactions').insert(rows.map((p) => ({
    user_id: c.uid, tanggal: p.tanggal, tipe: p.tipe, kategori: p.kategori,
    nominal: p.nominal, keterangan: p.keterangan || 'Via Batch', source: 'telegram',
  })));
  if (error) throw error;
  await syncPeriod(c.uid, rows.map((r) => r.tanggal).sort().at(-1)!);

  const tIn = rows.filter((r) => r.tipe === 'Pemasukan').reduce((a, r) => a + r.nominal, 0);
  const tOut = rows.filter((r) => r.tipe === 'Pengeluaran').reduce((a, r) => a + r.nominal, 0);
  let reply = `✅ <b>${rows.length} transaksi tersimpan!</b>\n\n📥 Pemasukan:  <b>${rp(tIn)}</b>\n📤 Pengeluaran: <b>${rp(tOut)}</b>\n💵 Selisih:    <b>${rp(tIn - tOut)}</b>`;
  if (errors.length) reply += `\n\n⚠️ ${errors.length} baris dilewati.`;
  await send(c.chat, reply, mainKb());
}

/* ---------------- Callback (tombol inline) ---------------- */
async function handleCallback(c: Ctx, cbq: Any) {
  await tg('answerCallbackQuery', { callback_query_id: cbq.id });
  const data: string = cbq.data || '';

  if (data === 'cmd_saldo') return handleSaldo(c);
  if (data === 'cmd_bulan') return handleBulan(c);
  if (data === 'cmd_status') return handleStatus(c);
  if (data === 'cmd_kategori') return handleKategori(c, '');
  if (data === 'cmd_tambah') return send(c.chat, '📝 Ketik atau rekam transaksi:', tambahKb());

  if (data === 'confirm_cancel') {
    await delTemp(c.chat, 'pending');
    return send(c.chat, '❌ Dibatalkan. Tidak ada yang disimpan.', mainKb());
  }

  const pending = await getTemp(c.chat, 'pending');
  if (!pending) return send(c.chat, '⌛ Sesi kadaluarsa. Silakan input ulang.');

  if (data === 'confirm_save') {
    const p: Tx = { tanggal: pending.tanggal, tipe: pending.tipe, kategori: pending.kategori, nominal: Number(pending.nominal), keterangan: pending.keterangan, wallet_id: pending.wallet_id ?? null, walletName: pending.walletName };
    await saveTx(c, p);
    await delTemp(c.chat, 'pending');
    await send(c.chat, savedMsg('✅ <b>Tersimpan!</b>', p), mainKb());
    if (p.tipe === 'Pengeluaran') await checkBudgetAlert(c, p.kategori);
    return;
  }
  if (data === 'confirm_back') return confirmPreview(c.chat, pending);

  if (data === 'confirm_wallet') {
    const ws = await getWallets(c.uid);
    if (ws.length < 2) return confirmPreview(c.chat, pending);
    const i = ws.findIndex((w) => w.id === pending.wallet_id);
    const next = ws[(i + 1) % ws.length];
    pending.wallet_id = next.id;
    pending.walletName = next.name;
    await setTemp(c.chat, 'pending', pending);
    return confirmPreview(c.chat, pending);
  }

  if (data === 'confirm_edit_cat') {
    const cats = await getCategories(c.uid, pending.tipe === 'Pemasukan' ? 'pemasukan' : 'pengeluaran');
    const rows: Any[] = [];
    for (let i = 0; i < cats.length; i += 2) {
      const row = [{ text: cats[i], callback_data: `set_cat_${i}` }];
      if (cats[i + 1]) row.push({ text: cats[i + 1], callback_data: `set_cat_${i + 1}` });
      rows.push(row);
    }
    rows.push([{ text: '⬅️ Kembali', callback_data: 'confirm_back' }]);
    return send(c.chat, '🏷️ <b>Pilih kategori baru:</b>', { inline_keyboard: rows });
  }

  if (data.startsWith('set_cat_')) {
    const idx = parseInt(data.slice(8), 10);
    const cats = await getCategories(c.uid, pending.tipe === 'Pemasukan' ? 'pemasukan' : 'pengeluaran');
    if (cats[idx]) {
      pending.kategori = cats[idx];
      await setTemp(c.chat, 'pending', pending);
      return confirmPreview(c.chat, pending);
    }
  }
}

/* ---------------- Router pesan ---------------- */
const GREETINGS = ['halo', 'hai', 'hi', 'hello', 'helo', 'hei', 'pagi', 'siang', 'malam', 'sore', 'assalamualaikum', 'salam'];

async function handleMessage(c: Ctx, msg: Any) {
  if (msg.document || msg.photo || msg.voice) {
    return send(c.chat, '🚧 Foto struk, voice note, dan upload CSV sedang dipindahkan ke versi baru (tahap berikutnya).', mainKb());
  }
  let text = String(msg.text || '').trim();
  if (!text) return;
  // "/status@NamaBot arg" → "/status arg"
  if (text.startsWith('/') && text.split(' ')[0].includes('@')) text = text.split(' ')[0].split('@')[0] + text.slice(text.split(' ')[0].length);
  const cmd = text.toLowerCase();

  // tombol menu
  const menu: Record<string, () => Promise<unknown>> = {
    '📊 status keuangan': () => handleStatus(c),
    '💰 saldo bulan ini': () => handleSaldo(c),
    '📅 transaksi bulan ini': () => handleBulan(c),
    '🏷️ kelola kategori': () => handleKategori(c, ''),
    '📚 lihat kategori': () => handleKategori(c, ''),
    '↩️ undo terakhir': () => handleUndo(c),
    '📈 budget': () => handleBudget(c, ''),
    '🔄 recurring': () => handleRecurring(c, ''),
    '💡 insight ai': () => handleInsight(c),
    '💡 insight': () => handleInsight(c),
    '📝 tambah transaksi': () => send(c.chat,
      '📝 <b>Tambah Transaksi</b>\n\nAda 3 cara:\n<b>1) Ketik bebas:</b> <i>makan siang 25rb</i>\n' +
      '<b>2) Command:</b> <code>/tambah Pemasukan Gaji 5jt</code>\n<b>3) Voice note:</b> rekam suara', tambahKb()),
    '❓ bantuan': () => send(c.chat, '<b>❓ Bantuan</b>\n\nKlik tombol di bawah 👇\n\nKetik bebas: <i>kopi 25rb</i>\nDompet Cash: <i>kopi 25rb cash</i>\nTarik tunai: <code>/tarik 500rb</code>', mainKb()),
    '🔙 menu utama': () => send(c.chat, '🏠 <b>Menu Utama</b>\n\nPilih menu 👇', mainKb()),
    '🟢 pemasukan': () => send(c.chat, '🟢 <b>Tambah Pemasukan</b>\n\nContoh:\n<code>/tambah Pemasukan Gaji 5000000</code>\n\nAtau: <i>gaji bulan ini 8 juta</i>', tambahKb()),
    '🔴 pengeluaran': () => send(c.chat, '🔴 <b>Tambah Pengeluaran</b>\n\nContoh:\n<code>/tambah Pengeluaran Makanan 25000</code>\n\nAtau: <i>makan siang 25rb</i>', tambahKb()),
    '➕ tambah kategori': () => send(c.chat, '➕ <b>Tambah Kategori</b>\n\nFormat:\n<code>/kategori tambah [Tipe] [Nama]</code>\n\nContoh:\n<code>/kategori tambah Pemasukan Crypto</code>', kategoriKb()),
  };
  if (menu[cmd]) return void (await menu[cmd]());

  if (GREETINGS.includes(cmd.split(/\s+/)[0])) return handleStatus(c);

  if (cmd === '/start' || cmd === 'start') {
    return send(c.chat, `👋 Halo <b>${esc(c.name)}</b>!\n\nSaya <b>MyKeuanganGuech Bot</b> 💰\n\nKlik tombol di bawah 👇`, mainKb());
  }
  if (['/status', 'status', 'info', 'rekap'].includes(cmd)) return handleStatus(c);
  if (cmd === '/saldo' || cmd === 'saldo') return handleSaldo(c);
  if (cmd === '/bulan' || cmd === 'bulan') return handleBulan(c);
  if (cmd === '/hapus' || cmd === 'hapus') return handleHapus(c);
  if (cmd === '/undo' || cmd === 'undo') return handleUndo(c);
  if (cmd === '/help' || cmd === 'help' || cmd === 'bantuan') return send(c.chat, '❓ Klik tombol 👇', mainKb());
  if (cmd === '/menu' || cmd === 'menu') return send(c.chat, '🏠 <b>Menu Utama</b>', mainKb());
  if (/^\/?(kategori)(\s|$)/i.test(text)) return handleKategori(c, text.replace(/^\/?kategori\s*/i, '').trim());
  if (/^\/?(tambah)\s/i.test(text)) return handleTambah(c, text.replace(/^\/?tambah\s*/i, ''));
  if (cmd === '/insight' || cmd === 'insight' || cmd === '/analisis') return handleInsight(c);
  if (/^\/?budget(\s|$)/i.test(text)) return handleBudget(c, text.replace(/^\/?budget\s*/i, ''));
  if (/^\/?recurring(\s|$)/i.test(text)) return handleRecurring(c, text.replace(/^\/?recurring\s*/i, ''));
  if (/^\/?batch(\s|$)/i.test(text)) return handleBatch(c, text);

  if (/^\/?tarik(\s|$)/i.test(text)) return handleTarik(c, text.replace(/^\/?tarik\s*/i, ''));

  if (!cmd.startsWith('/') && text.length >= 3) return handleFreeText(c, text);

  return send(c.chat, '🤖 Perintah tidak dikenal.\n\nKlik tombol di bawah atau ketik:\n<i>makan siang 25rb</i>', mainKb());
}

/* ---------------- Tahap 3c: job otomatis (cron) + refresh harga ---------------- */
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const CG_KEY = Deno.env.get('COINGECKO_API_KEY') ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const CRYPTO_MAP: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', ONDO: 'ondo-finance', TAO: 'bittensor', SOL: 'solana', ADA: 'cardano',
  DOT: 'polkadot', MATIC: 'matic-network', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', XRP: 'ripple',
  DOGE: 'dogecoin', AVAX: 'avalanche-2', LINK: 'chainlink', PEPE: 'pepe', SHIB: 'shiba-inu', ARB: 'arbitrum', OP: 'optimism',
};

async function chatsOf(uid?: string): Promise<{ chat_id: number; user_id: string }[]> {
  let q = sb.from('telegram_chats').select('chat_id,user_id');
  if (uid) q = q.eq('user_id', uid);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Satu request CoinGecko untuk semua simbol (versi lama: 1 request + jeda 3 detik per simbol)
async function fetchPricesIDR(symbols: string[]): Promise<Record<string, number>> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => CRYPTO_MAP[s]);
  if (wanted.length === 0) return {};
  const ids = [...new Set([...wanted.map((s) => CRYPTO_MAP[s]), 'tether'])];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=idr,usd` +
    (CG_KEY ? `&x_cg_demo_api_key=${encodeURIComponent(CG_KEY)}` : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error('CoinGecko HTTP ' + r.status);
  const j = await r.json();
  const usdIdr = Number(j.tether?.idr) || 16000;
  const out: Record<string, number> = {};
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

async function refreshPrices(uid: string) {
  const assets = await fetchAll('assets', 'id,type,symbol,quantity', uid, ['id']);
  const cryptos = assets.filter((a) => String(a.type).toLowerCase() === 'crypto' && a.symbol);
  if (cryptos.length === 0) return { updated: 0, missing: [] as string[] };
  const prices = await fetchPricesIDR(cryptos.map((a) => String(a.symbol)));
  let updated = 0;
  const missing = new Set<string>();
  for (const a of cryptos) {
    const sym = String(a.symbol).toUpperCase();
    const price = prices[sym];
    if (!price) { missing.add(sym); continue; }
    const { error } = await sb.from('assets').update({ value: Math.round(Number(a.quantity || 0) * price) })
      .eq('id', a.id).eq('user_id', uid);
    if (error) throw error;
    updated++;
  }
  if (updated > 0) await savePortfolioSnapshot(uid);
  return { updated, missing: [...missing] };
}

// Transaksi berulang: jalan pada tanggal yang cocok (zona APP_TIMEZONE), maksimal sekali per hari
async function runRecurring() {
  const t = today();
  const day = Number(t.slice(8, 10));
  const { data, error } = await sb.from('recurring').select('*').eq('active', true).eq('day_of_month', day);
  if (error) throw error;
  const byUser = new Map<string, string[]>();
  let created = 0;
  for (const r of data ?? []) {
    // "klaim" atomik: hanya satu eksekusi yang berhasil mengubah last_run hari ini
    const claim = await sb.from('recurring').update({ last_run: t }).eq('id', r.id)
      .or(`last_run.is.null,last_run.neq.${t}`).select('id');
    if (claim.error) throw claim.error;
    if (!claim.data || claim.data.length === 0) continue;
    const ins = await sb.from('transactions').insert({
      user_id: r.user_id, tanggal: t, tipe: r.tipe, kategori: r.kategori, nominal: r.nominal,
      keterangan: (r.keterangan || '') + ' (recurring)', source: 'recurring',
    });
    if (ins.error) {
      await sb.from('recurring').update({ last_run: r.last_run }).eq('id', r.id); // batalkan klaim
      console.error('recurring insert', ins.error);
      continue;
    }
    await syncPeriod(r.user_id, t);
    created++;
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), `• ${esc(r.kategori)}: ${rp(Number(r.nominal))}`]);
  }
  for (const [uid, lines] of byUser) {
    for (const ch of await chatsOf(uid)) {
      await send(ch.chat_id, `🔄 <b>Recurring hari ini</b>\n\n${lines.length} transaksi auto-catat:\n\n${lines.join('\n')}`);
    }
  }
  return { created };
}

async function dailyReminder() {
  let sent = 0;
  for (const ch of await chatsOf()) {
    const trx = await fetchAll('transactions', 'tanggal,tipe,kategori,nominal', ch.user_id, ['tanggal', 'id']);
    const todayTx = trx.filter((x) => String(x.tanggal).slice(0, 10) === today());
    const st = streak(trx);
    let msg: string;
    if (todayTx.length === 0) {
      msg = '⏰ <b>Pengingat Malam</b>\n\nBelum ada catatan transaksi hari ini nih.\n\n💡 Kirim cepat, contoh:\n' +
        '<i>makan malam 30rb</i>\n<i>belanja 150rb</i>\n\n' +
        `🔥 Streak kamu: <b>${st} hari</b> ${streakEmoji(st)}\nJangan sampai putus ya!`;
    } else {
      const total = todayTx.filter((x) => x.tipe === 'Pengeluaran' && isFlow(x.kategori))
        .reduce((a, x) => a + Number(x.nominal), 0);
      msg = `✅ <b>Rekap Hari Ini</b>\n\n📝 Transaksi: <b>${todayTx.length}</b>\n💵 Pengeluaran: <b>${rp(total)}</b>\n\n` +
        `🔥 Streak: <b>${st} hari</b> ${streakEmoji(st)}\nMantap, terus konsisten!`;
    }
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
  let sent = 0;
  for (const ch of await chatsOf()) {
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
    const sel = tIn - tOut, st = streak(trx);
    let msg = `📊 <b>Laporan Minggu Ini</b>\n📅 ${start.slice(5)} s/d ${end.slice(5)}\n\n━━━━━━━━━━━━━━━━\n` +
      `📥 Pemasukan:  <b>${rp(tIn)}</b>\n📤 Pengeluaran: <b>${rp(tOut)}</b>\n💵 Selisih:    <b>${sel >= 0 ? '+' : ''}${rp(sel)}</b>\n━━━━━━━━━━━━━━━━\n\n`;
    if (top.length) {
      msg += '<b>🔝 Top Pengeluaran:</b>\n' +
        top.map(([k, v], i) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} ${esc(k)} — <b>${rp(v)}</b>`).join('\n') + '\n\n';
    }
    msg += `📝 Total transaksi: <b>${weekTx.length}</b>\n🔥 Streak: <b>${st} hari</b> ${streakEmoji(st)}\n\n` +
      (sel >= 0 ? '🎉 Great! Kamu surplus minggu ini.' : '💡 Defisit minggu ini, coba hemat minggu depan ya.');
    await send(ch.chat_id, msg, mainKb());
    sent++;
  }
  return { sent };
}

// Snapshot harian: segarkan harga dulu (bila gagal, tetap simpan nilai terakhir), lalu simpan snapshot
async function snapshotAll() {
  const { data } = await sb.from('assets').select('user_id');
  const users = [...new Set((data ?? []).map((r: Any) => r.user_id as string))];
  let done = 0;
  for (const uid of users) {
    try { await refreshPrices(uid); } catch (e) { console.error('refreshPrices', e); }
    try { await savePortfolioSnapshot(uid); done++; } catch (e) { console.error('snapshot', e); }
  }
  return { users: done };
}

async function handleJob(req: Request, job: string): Promise<Response> {
  const cron = CRON_SECRET !== '' && req.headers.get('x-cron-secret') === CRON_SECRET;
  let uid: string | null = null;
  if (!cron) {
    // Panggilan dari website: JWT login Supabase, hanya boleh refresh harga milik sendiri
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data } = token ? await sb.auth.getUser(token) : { data: null };
    uid = data?.user?.id ?? null;
    if (!uid || job !== 'refresh_prices') return json({ error: 'forbidden' }, 403);
  }
  try {
    switch (job) {
      case 'refresh_prices': return json(await refreshPrices(uid!));
      case 'daily': return json(await dailyReminder());
      case 'weekly': return json(await weeklyReport());
      case 'recurring': return json(await runRecurring());
      case 'snapshot': return json(await snapshotAll());
      default: return json({ error: 'unknown job' }, 400);
    }
  } catch (e) {
    console.error('job', job, e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
}

/* ---------------- Webhook ---------------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('ok');

  let update: Any;
  try { update = await req.json(); } catch { return new Response('bad request', { status: 400 }); }

  // Job otomatis (pg_cron) & refresh harga dari website — punya autentikasi sendiri
  if (typeof update?.job === 'string') return handleJob(req, update.job);

  if (req.headers.get('x-telegram-bot-api-secret-token') !== SECRET) return new Response('forbidden', { status: 403 });

  try {
    // Dedup: Telegram bisa mengirim ulang update yang sama
    if (update.update_id) {
      const { error } = await sb.from('telegram_updates').insert({ update_id: update.update_id });
      if (error?.code === '23505') return new Response('dup');
      if (Math.random() < 0.02) {
        await sb.from('telegram_updates').delete().lt('received_at', new Date(Date.now() - 86_400_000).toISOString());
        await sb.from('telegram_pending').delete().lt('expires_at', new Date().toISOString());
      }
    }

    const msg = update.message ?? update.callback_query?.message;
    const from = update.message?.from ?? update.callback_query?.from;
    if (!msg || !from) return new Response('ok');
    const chat: number = msg.chat.id;

    // Hanya chat yang terdaftar di telegram_chats yang dilayani
    const { data: reg } = await sb.from('telegram_chats').select('user_id').eq('chat_id', chat).maybeSingle();
    if (!reg) {
      await send(chat, `🔒 Chat ini belum terdaftar.\n\nchat_id Anda: <code>${chat}</code>\nDaftarkan di Supabase (tabel telegram_chats).`);
      return new Response('ok');
    }

    const c: Ctx = { chat, uid: reg.user_id, name: from.first_name || 'User' };
    try {
      if (update.callback_query) await handleCallback(c, update.callback_query);
      else await handleMessage(c, update.message);
    } catch (e) {
      console.error('handler error', e);
      await send(chat, `❌ Gagal: <code>${esc((e as Error).message || e)}</code>`);
    }
  } catch (e) {
    console.error('webhook error', e);
  }
  return new Response('ok'); // selalu 200 agar Telegram tidak mengulang terus
});
