import {
  Any, Ctx, Tx, TOKEN, GEMINI_KEY, GEMINI_MODEL, GEMINI_INSIGHT_MODEL, MAX_NOMINAL,
  esc, rp, today, sleep, safeHtml, getCategories, normalizeCatKey, isFlow, loadCore,
  inPeriod, getTemp, setTemp, send, mainKb,
} from './core.ts';
import { getWallets, matchWalletFromText } from './wallets.ts';

// --- Pembatas panggilan Gemini per pengguna (Gelombang 3.3, S15) ------------
// Sebelumnya satu-satunya kontrol preventif adalah lock insight 30 detik
// per chat; OCR/voice note tanpa batas — tiap foto/voice note memicu
// panggilan Gemini, dan satu request bisa kipas ke banyak model × 3
// percobaan. Guard ini (counter in-memory per user_id, jendela geser
// 1 jam) dipakai handleInsight DAN handleMediaMessage. Bila kuota habis,
// pengguna mendapat pesan ramah "coba lagi nanti" — Gemini TIDAK
// dipanggil sama sekali. Catatan: counter hidup di memori satu instance
// Edge Function; ini pembatas biaya/kuota, bukan penegakan keras
// lintas-instance (kuota keras tetap di sisi Google AI).
export const GEMINI_OCR_LIMIT_PER_HOUR = 10;
export const GEMINI_INSIGHT_LIMIT_PER_HOUR = 3;
export const GEMINI_QUOTA_WINDOW_MS = 60 * 60 * 1000;
// Maksimal model yang dicoba per satu request (primer + fallback).
// Sebelumnya daftar kandidat bisa tumbuh tanpa batas dari nama model
// yang disebut di pesan error Gemini.
export const GEMINI_MAX_MODEL_CANDIDATES = 4;
export const GEMINI_QUOTA_MESSAGE = '⏳ Kuota AI sudah habis untuk sementara. Coba lagi nanti, ya.';
const geminiQuota = new Map<string, { count: number; windowStart: number }>();

/** Konsumsi 1 kuota untuk uid+kind. true = masih boleh (kuota terpakai),
 *  false = kuota habis — jangan panggil Gemini. */
export function consumeGeminiQuota(uid: string, kind: 'ocr' | 'insight'): boolean {
  const limit = kind === 'ocr' ? GEMINI_OCR_LIMIT_PER_HOUR : GEMINI_INSIGHT_LIMIT_PER_HOUR;
  const now = Date.now();
  const key = `${uid}:${kind}`;
  const rec = geminiQuota.get(key);
  if (!rec || now - rec.windowStart >= GEMINI_QUOTA_WINDOW_MS) {
    geminiQuota.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
}

export function resetGeminiQuota(): void {
  geminiQuota.clear();
}

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1/interactions';
const TX_AI_SCHEMA = {
  type: 'object',
  properties: {
    tipe: { type: 'string', enum: ['Pemasukan', 'Pengeluaran'] },
    kategori: { type: 'string' },
    nominal: { type: 'number' },
    keterangan: { type: 'string' },
    tanggal: { type: 'string' },
  },
  required: ['tipe', 'kategori', 'nominal', 'keterangan', 'tanggal'],
};
const GEMINI_FALLBACK_MODELS = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-4-argon'];

function normalizeBotGeminiModel(modelName: string): string {
  const clean = String(modelName || '').replace(/^models\//i, '').trim();
  if (!clean) return 'gemini-4-hydrogen';
  const lower = clean.toLowerCase();
  if (lower === 'gemini-4-hydrogen' || lower === 'gemini-4-argon' || lower === 'gemini-4-neon' || lower === 'gemini-4-carbon' || lower === 'gemini-3.5-flash-lite') {
    return lower;
  }
  if (/^gemini-(2\.0|2\.5|3\.1)-flash-lite/i.test(clean)) return 'gemini-3.5-flash-lite';
  if (/^gemini-(1\.5|2\.5|3(?:\.1)?)-pro/i.test(clean)) return 'gemini-4-argon';
  if (/^gemini-(1\.5|2\.0|2\.5|3\.[5-8]|3-flash)/i.test(clean)) return 'gemini-4-hydrogen';
  return clean;
}

function extractInteractionText(j: Any): string {
  if (typeof j?.output_text === 'string' && j.output_text.trim()) return j.output_text.trim();
  if (Array.isArray(j?.steps)) {
    const out: string[] = [];
    for (const step of j.steps) {
      if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const part of step.content) {
        if (typeof part?.text === 'string' && (!part.type || part.type === 'text')) out.push(part.text);
      }
    }
    if (out.length) return out.join('').trim();
  }
  const legacy = j?.candidates?.[0]?.content?.parts;
  return Array.isArray(legacy) ? legacy.map((p: Any) => p?.text || '').join('').trim() : '';
}

function toInteractionInput(blocks: Any[]) {
  const out = blocks.map((b) => {
    if (b?.type) return b;
    if (typeof b?.text === 'string') return { type: 'text', text: b.text };
    if (b?.inlineData?.data) {
      const mime = String(b.inlineData.mimeType || 'image/jpeg');
      return { type: mime.startsWith('audio/') ? 'audio' : 'image', data: b.inlineData.data, mime_type: mime };
    }
    return b;
  }).filter(Boolean);
  return out.length === 1 && out[0]?.type === 'text' ? out[0].text : out;
}

export async function callGeminiJson(parts: Any[], responseSchema: Any, systemInstruction?: string): Promise<Any> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY belum diatur.');
  const raw = await callInteractions(
    GEMINI_MODEL,
    GEMINI_FALLBACK_MODELS,
    toInteractionInput(parts),
    'low',
    systemInstruction,
    responseSchema,
  );
  return JSON.parse(raw);
}

function buildParsedTx(parsed: Any, inc: string[], exp: string[], fallbackNote: string, invalidAmtMsg: string): Tx & { keterangan: string } {
  const nominal = Math.round(Number(parsed?.nominal));
  if (!nominal || nominal <= 0) throw new Error(invalidAmtMsg);
  // S14: hasil parse AI juga tunduk pada batas nominal yang sama.
  if (nominal > MAX_NOMINAL) throw new Error(`Nominal melebihi batas maksimum ${rp(MAX_NOMINAL)}.`);
  const tipe: 'Pemasukan' | 'Pengeluaran' = parsed?.tipe === 'Pemasukan' ? 'Pemasukan' : 'Pengeluaran';
  const cats = tipe === 'Pemasukan' ? inc : exp;
  const rawCat = String(parsed?.kategori || '').trim();
  const matchedCat = cats.find((c) => normalizeCatKey(c) === normalizeCatKey(rawCat));
  const kategori = matchedCat ?? (cats.find((c) => normalizeCatKey(c) === 'lainnya') ?? (rawCat || 'Lainnya'));
  return {
    tipe, kategori, nominal,
    keterangan: String(parsed?.keterangan || fallbackNote),
    tanggal: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed?.tanggal || '')) ? parsed.tanggal : today(),
  };
}

export async function parseWithAI(c: Ctx, text: string): Promise<Tx & { keterangan: string }> {
  const [inc, exp] = await Promise.all([getCategories(c.uid, 'pemasukan'), getCategories(c.uid, 'pengeluaran')]);
  const now = today();
  const prompt = `Ekstrak 1 transaksi keuangan dari kalimat bahasa Indonesia berikut.
ATURAN:
1. "tipe": "Pemasukan" atau "Pengeluaran".
2. "kategori" WAJIB salah satu dari: PEMASUKAN [${inc.join(', ') || 'Lainnya'}], PENGELUARAN [${exp.join(', ') || 'Lainnya'}]. Jika tidak cocok, pilih "Lainnya".
3. "nominal": angka murni IDR (mis. 50rb->50000, 1,5jt->1500000).
4. "keterangan": ringkasan singkat.
5. "tanggal": YYYY-MM-DD (default ${now}).
INPUT USER: ${JSON.stringify(text)}`;
  const sys = 'Kamu adalah parser transaksi keuangan bahasa Indonesia berpresisi tinggi. Kembalikan hanya JSON terstruktur sesuai skema.';
  return buildParsedTx(await callGeminiJson([{ type: 'text', text: prompt }], TX_AI_SCHEMA, sys), inc, exp, 'Via AI', 'Nominal tidak terbaca');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function parseMediaWithAI(c: Ctx, mimeType: string, base64: string, caption: string): Promise<Tx & { keterangan: string }> {
  const [inc, exp] = await Promise.all([getCategories(c.uid, 'pemasukan'), getCategories(c.uid, 'pengeluaran')]);
  const prompt = `Ekstrak 1 transaksi dari foto struk/bukti transfer atau voice note bahasa Indonesia.
ATURAN:
1. "tipe": "Pemasukan" atau "Pengeluaran".
2. "kategori" WAJIB dari PEMASUKAN [${inc.join(', ') || 'Lainnya'}] atau PENGELUARAN [${exp.join(', ') || 'Lainnya'}].
3. "nominal": angka bulat IDR (ambil Grand Total/Total Bayar, bukan subtotal atau kembalian; titik = pemisah ribuan).
4. "keterangan": merchant/item singkat. 5. "tanggal": YYYY-MM-DD (default ${today()}).
${caption ? 'CATATAN PENGIRIM: ' + JSON.stringify(caption) : ''}`;
  const sys = 'Kamu parser OCR struk belanja, bukti transfer, dan voice note keuangan Indonesia yang akurat.';
  const mediaType = mimeType.startsWith('audio/') ? 'audio' : 'image';
  const parsed = await callGeminiJson([
    { type: 'text', text: prompt },
    { type: mediaType, data: base64, mime_type: mimeType },
  ], TX_AI_SCHEMA, sys);
  return buildParsedTx(parsed, inc, exp, 'Via Media AI', 'Nominal tidak terbaca dari media');
}

export function confirmPreview(chat: number, p: Tx) {
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

export async function handleMediaMessage(c: Ctx, msg: Any) {
  if (msg.document) {
    return send(c.chat, '📄 Upload CSV & bank statement dapat dilakukan melalui menu <b>Laporan → Impor CSV</b> di web MyKeuGuech.', mainKb());
  }
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const voice = msg.voice ?? null;
  const fileId = photo?.file_id ?? voice?.file_id;
  if (!fileId) return;

  // S15: kuota OCR dicek SEBELUM getFile/unduh/panggil Gemini — bila
  // habis, kirim pesan ramah dan berhenti (tidak ada fetch Gemini).
  if (!consumeGeminiQuota(c.uid, 'ocr')) {
    return send(c.chat, `${GEMINI_QUOTA_MESSAGE}\n\nBatas: ${GEMINI_OCR_LIMIT_PER_HOUR} foto/voice note per jam.`, mainKb());
  }

  // File media milik bot yang menerima pesan: getFile + unduhan HARUS
  // memakai token bot pemilik request (c.token), bukan token bersama —
  // file_id hanya berlaku di bot yang menerimanya (Gelombang 2.2).
  const botToken = c.token ?? TOKEN;
  await send(c.chat, photo ? '📸 Membaca foto struk dengan Gemini 4 AI...' : '🎙️ Memahami voice note dengan Gemini 4 AI...');
  const metaJson = await (await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(12000) })).json();
  const filePath = metaJson?.result?.file_path;
  if (!filePath) throw new Error('Gagal mengambil file dari Telegram.');
  if (Number(metaJson?.result?.file_size || 0) > 4 * 1024 * 1024) throw new Error('Ukuran media melebihi batas 4 MB.');

  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`, { signal: AbortSignal.timeout(20000) });
  if (!fileRes.ok) throw new Error('Gagal mengunduh file media Telegram.');
  const base64 = bytesToBase64(new Uint8Array(await fileRes.arrayBuffer()));
  const caption = String(msg.caption || '').trim();
  const p = await parseMediaWithAI(c, photo ? 'image/jpeg' : (voice?.mime_type || 'audio/ogg'), base64, caption);
  const w = matchWalletFromText(await getWallets(c.uid), caption + ' ' + p.keterangan);
  const pend = { ...p, originalText: caption || '[Media AI]', wallet_id: w?.id ?? null, walletName: w?.name ?? '' };
  await setTemp(c.chat, 'pending', pend);
  await confirmPreview(c.chat, pend);
}

async function askInsight(sum: { period: string; totalIn: number; totalOut: number; n: number; top: string }): Promise<string> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY belum diatur.');
  const net = sum.totalIn - sum.totalOut;
  const savingsPct = sum.totalIn > 0 ? ((net / sum.totalIn) * 100).toFixed(1) : '0.0';
  const prompt = `Analisis data keuangan bulan ${sum.period}:
- Pemasukan: ${rp(sum.totalIn)}, Pengeluaran: ${rp(sum.totalOut)}, Saldo bersih: ${rp(net)} (Savings rate: ${savingsPct}%), Transaksi: ${sum.n}.
- Pengeluaran Terbesar:\n${sum.top || 'Belum ada'}
Format: Bahasa Indonesia santai profesional, HTML Telegram (<b>, <i>, <code>), max 200 kata, bullet •, sertakan 2 saran penghematan spesifik.`;
  const sys = 'Kamu penasihat keuangan pribadi MyKeuGuech yang ringkas, akurat, dan memberi angka konkret tanpa mengarang data.';

  const text = await callInteractions(GEMINI_INSIGHT_MODEL, GEMINI_FALLBACK_MODELS, prompt, 'medium', sys);
  return text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^\*\s+/gm, '• ').trim();
}

async function callInteractions(
  primaryModel: string,
  candidatesFallback: string[],
  input: Any,
  thinkingLevel: 'low' | 'medium' | 'high',
  systemInstruction?: string,
  responseSchema?: Any,
): Promise<string> {
  const candidates: string[] = [];
  const addCandidate = (modelName: string) => {
    const clean = normalizeBotGeminiModel(modelName);
    if (clean && !candidates.includes(clean) && candidates.length < GEMINI_MAX_MODEL_CANDIDATES) candidates.push(clean);
  };
  [primaryModel, ...candidatesFallback].forEach(addCandidate);

  let lastErr = '';
  for (let i = 0; i < candidates.length; i++) {
    const body: Record<string, unknown> = {
      model: candidates[i],
      input,
      store: false,
      generation_config: { thinking_level: thinkingLevel },
    };
    if (systemInstruction) body.system_instruction = systemInstruction;
    if (responseSchema) body.response_format = { type: 'text', mime_type: 'application/json', schema: responseSchema };

    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(GEMINI_INTERACTIONS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': GEMINI_KEY,
          'Api-Revision': '2026-05-20',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.error && r.ok) {
        const text = extractInteractionText(j);
        if (!text) throw new Error('Gemini tidak mengembalikan hasil (Respons kosong)');
        return text;
      }
      const msg = String(j?.error?.message || `HTTP ${r.status}`);
      lastErr = msg;
      for (const m of msg.matchAll(/models\/([a-z0-9._-]+)/gi)) addCandidate(m[1]);
      if (attempt < 2 && (r.status === 429 || r.status === 503 || /high demand|overloaded|rate limit/i.test(msg))) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      if (r.status === 404 || r.status === 403 || /not found|no longer available|not supported|deprecated|billing|paid tier/i.test(msg)) break;
      throw new Error('Gemini: ' + msg);
    }
  }
  throw new Error('Gemini: ' + (lastErr || 'Semua model AI gagal diakses'));
}

export async function handleInsight(c: Ctx) {
  if (await getTemp(c.chat, 'lock')) return send(c.chat, '⏳ Sabar ya, insight sebelumnya masih diproses.\nTunggu ~30 detik lagi.', mainKb());
  await setTemp(c.chat, 'lock', { at: Date.now() }, 30);

  const { trx, pd, period } = await loadCore(c.uid);
  const monthTx = trx.filter((t) => inPeriod(String(t.tanggal), period, pd));
  if (monthTx.length === 0) return send(c.chat, '📭 Belum ada transaksi bulan ini untuk dianalisis.', mainKb());

  // S15: kuota insight dicek SETELAH terbukti ada data untuk dianalisis
  // (supaya insight kosong tidak membakar kuota) dan SEBELUM Gemini
  // dipanggil. Lock 30 detik di atas tetap dipertahankan.
  if (!consumeGeminiQuota(c.uid, 'insight')) {
    return send(c.chat, `${GEMINI_QUOTA_MESSAGE}\n\nBatas: ${GEMINI_INSIGHT_LIMIT_PER_HOUR} insight per jam.`, mainKb());
  }
  await send(c.chat, '🤖 <b>Menganalisis data keuangan...</b>\n\nMohon tunggu ~5 detik ⏳');

  let totalIn = 0, totalOut = 0;
  const byCat = new Map<string, { label: string; total: number }>();
  for (const t of monthTx) {
    if (!isFlow(t.kategori)) continue;
    const n = Number(t.nominal);
    if (t.tipe === 'Pemasukan') totalIn += n;
    else {
      totalOut += n;
      const clean = String(t.kategori || '').trim() || 'Lainnya';
      const key = normalizeCatKey(clean);
      const prev = byCat.get(key);
      if (prev) {
        prev.total += n;
        if (prev.label === prev.label.toLowerCase() && clean !== clean.toLowerCase()) prev.label = clean;
      } else {
        byCat.set(key, { label: clean, total: n });
      }
    }
  }
  const top = Array.from(byCat.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  let body: string;
  try {
    const topStr = top.map((it) => {
      const share = totalOut > 0 ? Math.round((it.total / totalOut) * 100) : 0;
      return `• ${it.label}: ${rp(it.total)} (${share}%)`;
    }).join('\n');
    body = safeHtml(await askInsight({ period, totalIn, totalOut, n: monthTx.length, top: topStr }));
  } catch (e) {
    console.error('insight', e);
    const sel = totalIn - totalOut;
    body = (sel > 0 ? `🎉 <b>Surplus ${rp(sel)}!</b>` : sel < 0 ? `⚠️ <b>Defisit ${rp(-sel)}.</b>` : '⚖️ Seimbang!') +
      `\n\n📥 Masuk: <b>${rp(totalIn)}</b> · 📤 Keluar: <b>${rp(totalOut)}</b>`;
  }
  await send(c.chat, `💡 <b>Insight Bulan ${period}</b>\n\n${body}`, mainKb());
}
