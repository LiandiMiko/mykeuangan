import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
export const SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
export const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
export const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL_PARSER') ?? 'gemini-4-hydrogen';
export const GEMINI_INSIGHT_MODEL = Deno.env.get('GEMINI_MODEL_INSIGHT') ?? 'gemini-4-hydrogen';
export const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
export const CG_KEY = Deno.env.get('COINGECKO_API_KEY') ?? '';
export const TZ = Deno.env.get('APP_TIMEZONE') ?? 'Asia/Jakarta';

export const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// --- Bot personal (Gelombang 2.2) -------------------------------------------
// Token bot tiap pengguna tersimpan terenkripsi (AES-GCM, kunci dari secret
// TELEGRAM_TOKEN_ENCRYPTION_KEY) di tabel telegram_bots. Setiap request
// webhook memakai token bot pemiliknya; token env TELEGRAM_BOT_TOKEN hanya
// fallback transisi untuk bot lama yang belum dimigrasi ke bot personal.

const TOKEN_CACHE_TTL_MS = 60_000;
const tokenCache = new Map<string, { token: string; exp: number }>();

const b64ToBytes = (s: string) => {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const bytesToB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const bytesToHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 hex — sama dengan encode(digest(p_otp, 'sha256'), 'hex') di SQL. */
export async function sha256Hex(input: string): Promise<string> {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(data));
}

/** Secret acak hex untuk webhook_secret / link_secret (aman di URL). */
export function randomSecretHex(bytes = 32): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function getTokenEncryptionKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('TELEGRAM_TOKEN_ENCRYPTION_KEY') ?? '';
  if (!secret) throw new Error('TELEGRAM_TOKEN_ENCRYPTION_KEY belum dikonfigurasi.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptBotToken(token: string): Promise<{ iv: string; cipher: string }> {
  const key = await getTokenEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { iv: bytesToB64(iv.buffer), cipher: bytesToB64(cipher) };
}

export async function decryptBotToken(ivB64: string, cipherB64: string): Promise<string> {
  const key = await getTokenEncryptionKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(cipherB64),
  );
  return new TextDecoder().decode(plain);
}

export type BotRow = {
  user_id: string;
  bot_username: string;
  bot_user_id: number;
  token_encrypted: string;
  token_iv: string;
  webhook_secret: string;
  link_secret: string;
};

const BOT_COLUMNS = 'user_id,bot_username,bot_user_id,token_encrypted,token_iv,webhook_secret,link_secret';

export async function getBotRowByUser(uid: string): Promise<BotRow | null> {
  const { data, error } = await sb.from('telegram_bots').select(BOT_COLUMNS).eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return (data as BotRow | null) ?? null;
}

export async function getBotRowByLink(linkSecret: string): Promise<BotRow | null> {
  const { data, error } = await sb.from('telegram_bots').select(BOT_COLUMNS).eq('link_secret', linkSecret).maybeSingle();
  if (error) throw error;
  return (data as BotRow | null) ?? null;
}

/**
 * Token bot untuk satu chat. Alur: telegram_chats -> user_id ->
 * telegram_bots -> dekripsi. Cache 60 detik per user_id.
 * Bila pengguna belum memasang bot personal (atau chat belum terhubung),
 * kembali ke token env bersama (fallback transisi). Bila baris bot ada
 * tetapi dekripsi gagal, error dilempar — JANGAN diam-diam memakai bot
 * bersama, karena pesan akan terkirim dari bot yang salah.
 */
export async function resolveBotTokenForChat(chat: number): Promise<string> {
  const { data: reg } = await sb.from('telegram_chats').select('user_id').eq('chat_id', chat).maybeSingle();
  const uid = (reg as { user_id?: string } | null)?.user_id;
  if (!uid) return TOKEN;
  const cached = tokenCache.get(uid);
  if (cached && cached.exp > Date.now()) return cached.token;
  const row = await getBotRowByUser(uid);
  if (!row) return TOKEN;
  const token = await decryptBotToken(row.token_iv, row.token_encrypted);
  tokenCache.set(uid, { token, exp: Date.now() + TOKEN_CACHE_TTL_MS });
  return token;
}

export function clearBotTokenCache(uid?: string) {
  if (uid) tokenCache.delete(uid);
  else tokenCache.clear();
}

// deno-lint-ignore no-explicit-any
export type Any = any;
export type Ctx = { chat: number; uid: string; name: string; token?: string };
export type Tx = {
  tanggal: string; tipe: 'Pemasukan' | 'Pengeluaran'; kategori: string; nominal: number; keterangan?: string;
  wallet_id?: string | null; walletName?: string;
};
export type Wallet = { id: string; name: string; kind: string; opening_balance: number; sort: number };

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const rp = (n: number) => (n < 0 ? '-' : '') + 'Rp ' + Math.abs(Math.round(n)).toLocaleString('id-ID');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const pad = (n: number) => String(n).padStart(2, '0');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const safeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;(\/?)(b|i|code)&gt;/g, '<$1$2>');

export function parseNominal(raw: string): number {
  const m = raw.trim().toLowerCase().replace(/^rp\.?\s*/, '').match(/^([\d.,]+)\s*(rb|ribu|k|jt|juta)?$/);
  if (!m) return 0;
  const mult = m[2] ? (m[2] === 'jt' || m[2] === 'juta' ? 1e6 : 1e3) : 1;
  const n = m[2] ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''));
  return Math.round(n * mult) || 0;
}

export async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * Panggilan Telegram API dengan token eksplisit. Setiap pesan ke pengguna
 * HARUS lewat token bot miliknya (lihat resolveBotTokenForChat / send).
 * tg() lama dipertahankan hanya untuk jalur legacy bot bersama.
 */
export async function tgWithToken(token: string, method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) console.error('telegram', method, r.status, await r.text());
}

export async function tg(method: string, body: Record<string, unknown>) {
  return tgWithToken(TOKEN, method, body);
}

/** Kirim pesan ke chat — token bot pemilik chat di-resolve per chat (cache 60 dtk). */
export const send = (chat: number, text: string, kb?: unknown) =>
  resolveBotTokenForChat(chat).then((token) =>
    tgWithToken(token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: kb })
  );

/** Kirim pesan dengan token yang sudah di-resolve (mis. pairing, chat belum terhubung). */
export const sendWithToken = (token: string, chat: number, text: string, kb?: unknown) =>
  tgWithToken(token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: kb });

export const mainKb = () => ({
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

export const tambahKb = () => ({
  keyboard: [[{ text: '🟢 Pemasukan' }, { text: '🔴 Pengeluaran' }], [{ text: '🔙 Menu Utama' }]],
  resize_keyboard: true,
  is_persistent: true,
});

export const kategoriKb = () => ({
  keyboard: [[{ text: '📚 Lihat Kategori' }, { text: '➕ Tambah Kategori' }], [{ text: '🔙 Menu Utama' }]],
  resize_keyboard: true,
  is_persistent: true,
});

export const statusKb = () => ({
  inline_keyboard: [
    [{ text: '💰 Saldo', callback_data: 'cmd_saldo' }, { text: '📅 Bulan Ini', callback_data: 'cmd_bulan' }],
    [{ text: '📝 Tambah', callback_data: 'cmd_tambah' }, { text: '🏷️ Kategori', callback_data: 'cmd_kategori' }],
  ],
});

export async function fetchAll(
  table: string,
  cols: string,
  uid: string,
  order: string[],
  gteFilter?: [string, string],
): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).eq('user_id', uid).range(from, from + 999);
    if (gteFilter) q = q.gte(gteFilter[0], gteFilter[1]);
    for (const o of order) q = q.order(o);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function isActiveUser(uid: string): Promise<boolean> {
  const { data, error } = await sb.from('profiles').select('status').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data?.status === 'active';
}

export async function getSettings(uid: string): Promise<Record<string, string>> {
  const rows = await fetchAll('settings', 'key,value', uid, ['key']);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(uid: string, key: string, value: string) {
  const { error } = await sb.from('settings').upsert({ user_id: uid, key, value }, { onConflict: 'user_id,key' });
  if (error) throw error;
}

export async function getCategories(uid: string, tipe: 'pemasukan' | 'pengeluaran'): Promise<string[]> {
  const rows = await fetchAll('categories', 'tipe,name', uid, ['tipe', 'name']);
  return rows.filter((r) => r.tipe === tipe).map((r) => r.name);
}

export function cycleFor(tanggal: string, payrollDay: number): string {
  const [y0, m0, d] = tanggal.slice(0, 10).split('-').map(Number);
  let y = y0, m = m0;
  if (payrollDay > 1 && d >= payrollDay) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${pad(m)}`;
}

export function periodRange(period: string, pd: number) {
  const [y, m] = period.split('-').map(Number);
  if (pd <= 1) return { start: `${period}-01`, end: `${period}-${pad(new Date(y, m, 0).getDate())}` };
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return { start: `${py}-${pad(pm)}-${pad(pd)}`, end: `${y}-${pad(m)}-${pad(pd - 1)}` };
}

export const inPeriod = (tgl: string, period: string, pd: number) => {
  const r = periodRange(period, pd);
  const t = tgl.slice(0, 10);
  return t >= r.start && t <= r.end;
};

export function periodLabel(period: string, pd: number) {
  const r = periodRange(period, pd);
  const [, sm, sd] = r.start.split('-').map(Number);
  const [ey, em, ed] = r.end.split('-').map(Number);
  return `${sd} ${MONTHS[sm - 1]} - ${ed} ${MONTHS[em - 1]} ${ey}`;
}

export async function syncPeriod(uid: string, tanggal: string) {
  const s = await getSettings(uid);
  const cyc = cycleFor(tanggal, Number(s.payrollDay) || 1);
  if (!s.currentPeriod || cyc > s.currentPeriod) await setSetting(uid, 'currentPeriod', cyc);
}

export const normalizeCatKey = (s: unknown) => String(s ?? '').trim().toLowerCase();

export async function resolveUserCategory(uid: string, tipe: Tx['tipe'], raw: string): Promise<string> {
  const clean = String(raw || '').trim();
  if (!clean) return 'Lainnya';
  const cats = await getCategories(uid, tipe === 'Pemasukan' ? 'pemasukan' : 'pengeluaran');
  return cats.find((c) => normalizeCatKey(c) === normalizeCatKey(clean)) ?? clean;
}

export const isPiutang = (k: unknown) => String(k ?? '').trim().startsWith('Piutang');
export const isUtang = (k: unknown) => String(k ?? '').trim().startsWith('Utang');
export const isFlow = (k: unknown) => !isUtang(k) && !isPiutang(k);

export function balances(trx: Any[], assets: Any[]) {
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

export function streak(trx: Any[]): number {
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

export const streakEmoji = (s: number) => (s >= 30 ? '🏆' : s >= 14 ? '🔥🔥' : s >= 7 ? '🔥' : s >= 3 ? '⭐' : s >= 1 ? '✨' : '💤');

export async function setTemp(chat: number, kind: 'pending' | 'undo' | 'lock', payload: unknown, seconds = 300) {
  const { error } = await sb.from('telegram_pending').upsert(
    { chat_id: chat, kind, payload, expires_at: new Date(Date.now() + seconds * 1000).toISOString() },
    { onConflict: 'chat_id,kind' },
  );
  if (error) throw error;
}

export async function getTemp(chat: number, kind: 'pending' | 'undo' | 'lock'): Promise<Any | null> {
  const { data } = await sb.from('telegram_pending').select('payload')
    .eq('chat_id', chat).eq('kind', kind).gt('expires_at', new Date().toISOString()).maybeSingle();
  return data?.payload ?? null;
}

export const delTemp = (chat: number, kind: 'pending' | 'undo' | 'lock') =>
  sb.from('telegram_pending').delete().eq('chat_id', chat).eq('kind', kind);

export async function saveTx(c: Ctx, p: Tx) {
  const { error } = await sb.from('transactions').insert({
    user_id: c.uid, tanggal: p.tanggal, tipe: p.tipe, kategori: p.kategori,
    nominal: p.nominal, keterangan: p.keterangan || 'Via Telegram', source: 'telegram',
    wallet_id: p.wallet_id || null,
  });
  if (error) throw error;
  await syncPeriod(c.uid, p.tanggal);
}

export const savedMsg = (title: string, p: Tx) =>
  `${title}\n\n${p.tipe === 'Pemasukan' ? '🟢' : '🔴'} ${p.tipe}\n🏷️ ${esc(p.kategori)}\n💵 <b>${rp(p.nominal)}</b>\n📅 ${p.tanggal}` +
  (p.walletName ? `\n💳 ${esc(p.walletName)}` : '');

export async function loadCore(uid: string) {
  const [trx, st] = await Promise.all([
    fetchAll('transactions', 'tanggal,tipe,kategori,nominal', uid, ['tanggal', 'id']),
    getSettings(uid),
  ]);
  const pd = Number(st.payrollDay) || 1;
  return { trx, pd, period: st.currentPeriod || cycleFor(today(), pd) };
}

export function actualFor(trx: Any[], kategori: string, period: string, pd: number): number {
  const targetKey = normalizeCatKey(kategori);
  return trx
    .filter((t) => t.tipe === 'Pengeluaran' && normalizeCatKey(t.kategori) === targetKey && isFlow(t.kategori) && inPeriod(String(t.tanggal), period, pd))
    .reduce((a, t) => a + Number(t.nominal), 0);
}

export async function getBudgets(uid: string, period: string): Promise<Any[]> {
  const rows = await fetchAll('budgets', 'id,kategori,bulan,jumlah', uid, ['kategori']);
  return rows.filter((b) => String(b.bulan).slice(0, 7) === period);
}
