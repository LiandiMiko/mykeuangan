// Bot Telegram MyKeuanganGuech — Supabase Edge Function (tahap 3a)
// Webhook menggantikan polling Apps Script. Deploy dengan --no-verify-jwt
// (Telegram tidak mengirim JWT; keamanan lewat secret token + daftar chat).
//
// Tahap 3a: sapaan/menu, status, saldo, bulan, tambah, teks bebas (AI) + konfirmasi,
//           kategori, hapus/undo.
// Tahap 3b (belum): budget + alert, recurring, insight, batch, foto/voice/CSV.
// Tahap 3c (belum): reminder harian, laporan mingguan, harga crypto.

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
type Tx = { tanggal: string; tipe: 'Pemasukan' | 'Pengeluaran'; kategori: string; nominal: number; keterangan?: string };

/* ---------------- Format & helper umum ---------------- */
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rp = (n: number) => (n < 0 ? '-' : '') + 'Rp ' + Math.abs(Math.round(n)).toLocaleString('id-ID');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function parseNominal(raw: string): number {
  const m = raw.trim().toLowerCase().match(/^([\d.,]+)\s*(rb|ribu|k|jt|juta)?$/);
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
async function setTemp(chat: number, kind: 'pending' | 'undo', payload: unknown) {
  const { error } = await sb.from('telegram_pending').upsert(
    { chat_id: chat, kind, payload, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() },
    { onConflict: 'chat_id,kind' },
  );
  if (error) throw error;
}
async function getTemp(chat: number, kind: 'pending' | 'undo'): Promise<Any | null> {
  const { data } = await sb.from('telegram_pending').select('payload')
    .eq('chat_id', chat).eq('kind', kind).gt('expires_at', new Date().toISOString()).maybeSingle();
  return data?.payload ?? null;
}
const delTemp = (chat: number, kind: 'pending' | 'undo') =>
  sb.from('telegram_pending').delete().eq('chat_id', chat).eq('kind', kind);

/* ---------------- Simpan transaksi ---------------- */
async function saveTx(c: Ctx, p: Tx) {
  const { error } = await sb.from('transactions').insert({
    user_id: c.uid, tanggal: p.tanggal, tipe: p.tipe, kategori: p.kategori,
    nominal: p.nominal, keterangan: p.keterangan || 'Via Telegram', source: 'telegram',
  });
  if (error) throw error;
  await syncPeriod(c.uid, p.tanggal);
}

const savedMsg = (title: string, p: Tx) =>
  `${title}\n\n${p.tipe === 'Pemasukan' ? '🟢' : '🔴'} ${p.tipe}\n🏷️ ${esc(p.kategori)}\n💵 <b>${rp(p.nominal)}</b>\n📅 ${p.tanggal}`;

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
    (p.keterangan ? `\n📝 <i>${esc(p.keterangan)}</i>` : '') + '\n\n<b>Simpan transaksi ini?</b>';
  return send(chat, text, {
    inline_keyboard: [
      [{ text: '✅ Simpan', callback_data: 'confirm_save' }, { text: '❌ Batal', callback_data: 'confirm_cancel' }],
      [{ text: '✏️ Ubah Kategori', callback_data: 'confirm_edit_cat' }],
    ],
  });
}

/* ---------------- Handler perintah ---------------- */
async function handleStatus(c: Ctx) {
  const [trx, assets, st] = await Promise.all([
    fetchAll('transactions', 'tanggal,tipe,kategori,nominal', c.uid, ['tanggal', 'id']),
    fetchAll('assets', 'value', c.uid, ['id']),
    getSettings(c.uid),
  ]);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  const b = balances(trx, assets);
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
  s += `• Saldo Kas:   <b>${rp(b.kas)}</b>\n• Investasi:   <b>${rp(b.investasi)}</b>\n`;
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
  const [trx, assets, st] = await Promise.all([
    fetchAll('transactions', 'tanggal,tipe,kategori,nominal', c.uid, ['tanggal', 'id']),
    fetchAll('assets', 'value', c.uid, ['id']),
    getSettings(c.uid),
  ]);
  const pd = Number(st.payrollDay) || 1;
  const period = st.currentPeriod || cycleFor(today(), pd);
  const b = balances(trx, assets);
  let tIn = 0, tOut = 0;
  for (const t of trx) {
    if (!inPeriod(String(t.tanggal), period, pd) || isUtang(t.kategori) || isPiutang(t.kategori)) continue;
    if (t.tipe === 'Pemasukan') tIn += Number(t.nominal); else tOut += Number(t.nominal);
  }
  await send(c.chat,
    `💰 <b>Saldo & Ringkasan</b>\nSiklus: <code>${periodLabel(period, pd)}</code>\n\n` +
    `📥 Pemasukan (siklus):   <b>${rp(tIn)}</b>\n📤 Pengeluaran (siklus): <b>${rp(tOut)}</b>\n` +
    `💵 Selisih:              <b>${rp(tIn - tOut)}</b>\n\n` +
    `💼 <b>Saldo Kas (total):</b> <b>${rp(b.kas)}</b>\n📈 Investasi:             <b>${rp(b.investasi)}</b>\n\n` +
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
  const nominal = parseNominal(parts[parts.length - 1]);
  if (nominal <= 0) return send(c.chat, '❌ Nominal tidak valid.');
  const p: Tx = { tanggal: today(), tipe, kategori: parts.slice(1, -1).join(' '), nominal, keterangan: 'Via Telegram' };
  await saveTx(c, p);
  await send(c.chat, savedMsg('✅ <b>Tersimpan!</b>', p), mainKb());
}

async function handleFreeText(c: Ctx, text: string) {
  try {
    const p = await parseWithAI(c, text);
    await setTemp(c.chat, 'pending', { ...p, originalText: text });
    await confirmPreview(c.chat, p);
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
    .select('id,tanggal,tipe,kategori,nominal,keterangan')
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
  const p: Tx = { tanggal: t.tanggal, tipe: t.tipe, kategori: t.kategori, nominal: Number(t.nominal), keterangan: t.keterangan || '' };
  await saveTx(c, p);
  await delTemp(c.chat, 'undo');
  await send(c.chat, savedMsg('↩️ <b>Berhasil di-undo!</b>', p), mainKb());
}

const NOT_YET = (c: Ctx) =>
  send(c.chat, '🚧 Fitur ini sedang dipindahkan ke versi baru dan segera aktif.', mainKb());

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
    const p: Tx = { tanggal: pending.tanggal, tipe: pending.tipe, kategori: pending.kategori, nominal: Number(pending.nominal), keterangan: pending.keterangan };
    await saveTx(c, p);
    await delTemp(c.chat, 'pending');
    return send(c.chat, savedMsg('✅ <b>Tersimpan!</b>', p), mainKb());
  }
  if (data === 'confirm_back') return confirmPreview(c.chat, pending);

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
    '📈 budget': () => NOT_YET(c),
    '🔄 recurring': () => NOT_YET(c),
    '💡 insight ai': () => NOT_YET(c),
    '📝 tambah transaksi': () => send(c.chat,
      '📝 <b>Tambah Transaksi</b>\n\nAda 3 cara:\n<b>1) Ketik bebas:</b> <i>makan siang 25rb</i>\n' +
      '<b>2) Command:</b> <code>/tambah Pemasukan Gaji 5jt</code>\n<b>3) Voice note:</b> rekam suara', tambahKb()),
    '❓ bantuan': () => send(c.chat, '<b>❓ Bantuan</b>\n\nKlik tombol di bawah 👇\n\nAtau ketik bebas: <i>kopi 25rb</i>', mainKb()),
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
  if (/^\/?(budget|recurring|insight|analisis|batch)(\s|$)/i.test(text)) return NOT_YET(c);

  if (!cmd.startsWith('/') && text.length >= 3) return handleFreeText(c, text);

  return send(c.chat, '🤖 Perintah tidak dikenal.\n\nKlik tombol di bawah atau ketik:\n<i>makan siang 25rb</i>', mainKb());
}

/* ---------------- Webhook ---------------- */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  if (req.headers.get('x-telegram-bot-api-secret-token') !== SECRET) return new Response('forbidden', { status: 403 });

  let update: Any;
  try { update = await req.json(); } catch { return new Response('bad request', { status: 400 }); }

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
