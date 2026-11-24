import {
  Any, Ctx, Tx, TOKEN, TG, GEMINI_KEY, GEMINI_MODEL, GEMINI_INSIGHT_MODEL,
  esc, rp, today, sleep, safeHtml, getCategories, normalizeCatKey, isFlow, loadCore,
  inPeriod, getTemp, setTemp, send, mainKb,
} from './core.ts';
import { getWallets, matchWalletFromText } from './wallets.ts';

const TX_AI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tipe: { type: 'STRING', enum: ['Pemasukan', 'Pengeluaran'] },
    kategori: { type: 'STRING' },
    nominal: { type: 'NUMBER' },
    keterangan: { type: 'STRING' },
    tanggal: { type: 'STRING' },
  },
  required: ['tipe', 'kategori', 'nominal', 'tanggal'],
};
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

export async function callGeminiJson(parts: Any[], responseSchema: Any): Promise<Any> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY belum diatur.');
  const candidates: string[] = [];
  const addCandidate = (modelName: string) => {
    const clean = String(modelName || '').replace(/^models\//, '').trim();
    if (clean && !candidates.includes(clean)) candidates.push(clean);
  };
  [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].forEach(addCandidate);

  let lastErr = '';
  for (let i = 0; i < candidates.length; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidates[i])}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', responseSchema } }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json().catch(() => ({}));
    if (j?.error || !r.ok) {
      const msg = String(j?.error?.message || `HTTP ${r.status}`);
      lastErr = msg;
      for (const m of msg.matchAll(/models\/([a-z0-9._-]+)/gi)) addCandidate(m[1]);
      if (r.status === 404 || /not found|no longer available|not supported/i.test(msg)) continue;
      throw new Error('Gemini: ' + msg);
    }
    const rawText = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error(`Gemini tidak mengembalikan hasil (${j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason || 'Respons kosong'})`);
    return JSON.parse(rawText);
  }
  throw new Error('Gemini: ' + (lastErr || 'Semua model AI gagal diakses'));
}

function buildParsedTx(parsed: Any, inc: string[], exp: string[], fallbackNote: string, invalidAmtMsg: string): Tx & { keterangan: string } {
  const nominal = Math.round(Number(parsed?.nominal));
  if (!nominal || nominal <= 0) throw new Error(invalidAmtMsg);
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
  const prompt = `Kamu adalah asisten keuangan yang mengubah kalimat bahasa Indonesia menjadi data transaksi terstruktur.
ATURAN:
1. "tipe": "Pemasukan" atau "Pengeluaran".
2. "kategori" WAJIB salah satu dari: PEMASUKAN [${inc.join(', ') || 'Lainnya'}], PENGELUARAN [${exp.join(', ') || 'Lainnya'}]. Jika tidak cocok, pilih "Lainnya".
3. "nominal": angka murni (mis. 50rb->50000). 4. "keterangan": ringkasan singkat. 5. "tanggal": YYYY-MM-DD (default ${now}).
INPUT USER: ${JSON.stringify(text)}`;
  return buildParsedTx(await callGeminiJson([{ text: prompt }], TX_AI_SCHEMA), inc, exp, 'Via AI', 'Nominal tidak terbaca');
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
3. "nominal": angka bulat IDR. 4. "keterangan": merchant/item singkat. 5. "tanggal": YYYY-MM-DD (default ${today()}).
${caption ? 'CATATAN PENGIRIM: ' + JSON.stringify(caption) : ''}`;
  const parsed = await callGeminiJson([{ text: prompt }, { inlineData: { mimeType, data: base64 } }], TX_AI_SCHEMA);
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

  await send(c.chat, photo ? '📸 Membaca foto struk dengan Gemini AI...' : '🎙️ Memahami voice note dengan Gemini AI...');
  const metaJson = await (await fetch(`${TG}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(12000) })).json();
  const filePath = metaJson?.result?.file_path;
  if (!filePath) throw new Error('Gagal mengambil file dari Telegram.');
  if (Number(metaJson?.result?.file_size || 0) > 4 * 1024 * 1024) throw new Error('Ukuran media melebihi batas 4 MB.');

  const fileRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`, { signal: AbortSignal.timeout(20000) });
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
  const prompt = `Analisis data keuangan bulan ${sum.period}:
- Pemasukan: ${rp(sum.totalIn)}, Pengeluaran: ${rp(sum.totalOut)}, Saldo bersih: ${rp(sum.totalIn - sum.totalOut)}, Transaksi: ${sum.n}.
- Breakdown:\n${sum.top || 'Belum ada'}
Format: Bahasa Indonesia santai profesional, HTML Telegram (<b>, <i>, <code>), max 200 kata, bullet •.`;

  const candidates: string[] = [];
  const addCandidate = (modelName: string) => {
    const clean = String(modelName || '').replace(/^models\//, '').trim();
    if (clean && !candidates.includes(clean)) candidates.push(clean);
  };
  [GEMINI_INSIGHT_MODEL, ...GEMINI_FALLBACK_MODELS].forEach(addCandidate);

  let lastErr = '';
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const generationConfig: Record<string, unknown> = { temperature: 0.7, maxOutputTokens: 2048 };
    if (/^gemini-(2\.5|3)/i.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(25000),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.error || !r.ok) {
        const msg = String(j?.error?.message || `HTTP ${r.status}`);
        lastErr = msg;
        for (const m of msg.matchAll(/models\/([a-z0-9._-]+)/gi)) addCandidate(m[1]);
        if (attempt < 2 && /high demand|overloaded|503/i.test(msg)) { await sleep(2 ** attempt * 1000); continue; }
        if (r.status === 404 || /not found|no longer available|not supported|deprecated/i.test(msg)) break;
        throw new Error('Gemini: ' + msg);
      }
      const text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('Gemini: respons kosong');
      return text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^\*\s+/gm, '• ').trim();
    }
  }
  throw new Error('Gemini: ' + (lastErr || 'Semua model AI gagal diakses'));
}

export async function handleInsight(c: Ctx) {
  if (await getTemp(c.chat, 'lock')) return send(c.chat, '⏳ Sabar ya, insight sebelumnya masih diproses.\nTunggu ~30 detik lagi.', mainKb());
  await setTemp(c.chat, 'lock', { at: Date.now() }, 30);
  await send(c.chat, '🤖 <b>Menganalisis data keuangan...</b>\n\nMohon tunggu ~5 detik ⏳');

  const { trx, pd, period } = await loadCore(c.uid);
  const monthTx = trx.filter((t) => inPeriod(String(t.tanggal), period, pd));
  if (monthTx.length === 0) return send(c.chat, '📭 Belum ada transaksi bulan ini untuk dianalisis.', mainKb());

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
    body = safeHtml(await askInsight({ period, totalIn, totalOut, n: monthTx.length, top: top.map((it) => `• ${it.label}: ${rp(it.total)}`).join('\n') }));
  } catch (e) {
    console.error('insight', e);
    const sel = totalIn - totalOut;
    body = (sel > 0 ? `🎉 <b>Surplus ${rp(sel)}!</b>` : sel < 0 ? `⚠️ <b>Defisit ${rp(-sel)}.</b>` : '⚖️ Seimbang!') +
      `\n\n📥 Masuk: <b>${rp(totalIn)}</b> · 📤 Keluar: <b>${rp(totalOut)}</b>`;
  }
  await send(c.chat, `💡 <b>Insight Bulan ${period}</b>\n\n${body}`, mainKb());
}
