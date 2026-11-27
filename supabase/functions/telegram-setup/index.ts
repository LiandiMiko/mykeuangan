// ============================================================
// telegram-setup — Bot Telegram personal (bring your own bot)
// Gelombang 2.2
//
// Pengguna membuat botnya sendiri via @BotFather lalu menempel tokennya
// di sini. Fungsi ini:
//   * memvalidasi token lewat Telegram getMe (membuktikan token asli
//     dan mengambil username bot),
//   * mengenkripsi token (AES-GCM, kunci dari secret
//     TELEGRAM_TOKEN_ENCRYPTION_KEY) sebelum disimpan di telegram_bots,
//   * memasang webhook per pengguna: URL membawa link_secret acak dan
//     header secret_token berisi webhook_secret acak.
// Token TIDAK PERNAH dikirim kembali ke klien setelah disimpan.
// Deploy dengan verify_jwt = true (fungsi juga memverifikasi JWT
// sendiri lewat getUser; tanpa secret TELEGRAM_TOKEN_ENCRYPTION_KEY
// yang terisi, connect_bot menolak dengan 500).
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const sbUrl = Deno.env.get('SUPABASE_URL')!;
const anonClient = createClient(sbUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
const adminClient = createClient(sbUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// --- CORS fail-closed (Gelombang 3.3, S14) ---------------------------------
// Diseragamkan ke ALLOWED_ORIGIN (tunggal) seperti fungsi lain — sebelumnya
// file ini membaca ALLOWED_ORIGINS (jamak). '*' di daftar DITOLAK.
// Origin request yang tidak ada di daftar TIDAK mendapat header
// Access-Control-Allow-Origin sama sekali. Request tanpa header Origin
// memakai origin pertama yang dikonfigurasi, atau default aman
// https://liandimiko.github.io bila env kosong.
const DEFAULT_ALLOWED_ORIGIN = 'https://liandimiko.github.io';
function resolveAllowedOrigin(req: Request): string | null {
  const raw = Deno.env.get('ALLOWED_ORIGIN') ?? '';
  const list = raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter((s) => s && s !== '*');
  const reqOrigin = (req.headers.get('origin') || '').trim().replace(/\/+$/, '');
  if (reqOrigin) return list.includes(reqOrigin) ? reqOrigin : null;
  return list[0] ?? DEFAULT_ALLOWED_ORIGIN;
}
function buildCorsHeaders(req: Request) {
  const origin = resolveAllowedOrigin(req);
  const headers: Record<string, string> = {
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  };
  if (origin) headers['access-control-allow-origin'] = origin;
  return headers;
}
function jsonResponse(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...buildCorsHeaders(req), 'content-type': 'application/json' } });
}

async function getUser(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const { data, error } = await anonClient.auth.getUser(authHeader.slice(7));
  if (error || !data.user) return null;
  return data.user;
}

// --- Enkripsi token bot (desain sama dengan telegram-bot/core.ts) ----------
// AES-GCM 256-bit; kunci = SHA-256 dari secret server (bukan token itu
// sendiri). IV acak 12 byte per token. Fungsi ini dan telegram-bot TIDAK
// berbagi kode (deploy Edge Function per direktori), jadi helper ini
// diduplikasi dengan sengaja — ubah keduanya bila desain berubah.
const b64ToBytes = (s: string) => {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const bytesToB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const bytesToHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function getTokenEncryptionKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('TELEGRAM_TOKEN_ENCRYPTION_KEY') ?? '';
  if (!secret) throw new Error('TELEGRAM_TOKEN_ENCRYPTION_KEY belum dikonfigurasi.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptBotToken(token: string): Promise<{ iv: string; cipher: string }> {
  const key = await getTokenEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { iv: bytesToB64(iv.buffer), cipher: bytesToB64(cipher) };
}

async function decryptBotToken(ivB64: string, cipherB64: string): Promise<string> {
  const key = await getTokenEncryptionKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(cipherB64),
  );
  return new TextDecoder().decode(plain);
}

function randomSecretHex(bytes = 32): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// --- Panggilan Telegram API --------------------------------------------------
async function tgCall(token: string, method: string, body?: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && (data as { ok?: boolean }).ok === true, data: data as { result?: { id?: number; is_bot?: boolean; username?: string }; description?: string } };
}

function webhookUrl(linkSecret: string) {
  return `${sbUrl}/functions/v1/telegram-bot?bot=${linkSecret}`;
}

async function setBotWebhook(token: string, linkSecret: string, webhookSecret: string) {
  return tgCall(token, 'setWebhook', {
    url: webhookUrl(linkSecret),
    secret_token: webhookSecret,
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query'],
  });
}

async function deleteBotWebhook(token: string) {
  // Best-effort: token bisa sudah dicabut pengguna via BotFather.
  await tgCall(token, 'deleteWebhook', { drop_pending_updates: true }).catch(() => undefined);
}

const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

type BotRow = {
  user_id: string;
  bot_username: string;
  bot_user_id: number;
  token_encrypted: string;
  token_iv: string;
  webhook_secret: string;
  link_secret: string;
  created_at: string;
};

async function getBotRowByUser(uid: string): Promise<BotRow | null> {
  const { data, error } = await adminClient.from('telegram_bots')
    .select('user_id,bot_username,bot_user_id,token_encrypted,token_iv,webhook_secret,link_secret,created_at')
    .eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return (data as BotRow | null) ?? null;
}

async function profileActive(uid: string): Promise<boolean> {
  const { data, error } = await adminClient.from('profiles').select('status').eq('id', uid).maybeSingle();
  if (error) throw error;
  return (data as { status?: string } | null)?.status === 'active';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, 405, { success: false, error: 'Method tidak diizinkan.' });

  const user = await getUser(req);
  if (!user) return jsonResponse(req, 401, { success: false, error: 'Sesi tidak valid. Silakan masuk ulang.' });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action ?? '');

  try {
    if (action === 'get_status') {
      const row = await getBotRowByUser(user.id);
      if (!row) return jsonResponse(req, 200, { success: true, connected: false });
      return jsonResponse(req, 200, {
        success: true,
        connected: true,
        bot_username: row.bot_username,
        bot_user_id: row.bot_user_id,
        created_at: row.created_at,
      });
    }

    if (action === 'connect_bot') {
      if (!await profileActive(user.id)) return jsonResponse(req, 403, { success: false, error: 'Akun ini sedang dinonaktifkan.' });
      const token = String(body.token ?? '').trim();
      if (!BOT_TOKEN_RE.test(token)) {
        return jsonResponse(req, 400, { success: false, error: 'Format token tidak valid. Salin token lengkap dari @BotFather (angka, titik dua, lalu kode rahasia).' });
      }

      // 1. Validasi token ke Telegram (membuktikan token asli + ambil username).
      const me = await tgCall(token, 'getMe');
      if (!me.ok || !me.data.result?.is_bot || !me.data.result.username || !me.data.result.id) {
        return jsonResponse(req, 400, { success: false, error: 'Token tidak valid atau bukan bot. Periksa kembali token dari @BotFather.' });
      }
      const botUsername = me.data.result.username;
      const botUserId = me.data.result.id;

      // 2. Satu bot hanya boleh terhubung ke satu akun.
      const { data: claimed } = await adminClient.from('telegram_bots')
        .select('user_id').eq('bot_user_id', botUserId).maybeSingle();
      if (claimed && (claimed as { user_id: string }).user_id !== user.id) {
        return jsonResponse(req, 409, { success: false, error: 'Bot ini sudah terhubung ke akun lain.' });
      }

      // 3. Enkripsi token + buat secret baru.
      let enc: { iv: string; cipher: string };
      try {
        enc = await encryptBotToken(token);
      } catch {
        return jsonResponse(req, 500, { success: false, error: 'Server belum dikonfigurasi (kunci enkripsi bot belum diisi). Hubungi admin.' });
      }
      const webhookSecret = randomSecretHex();
      const linkSecret = randomSecretHex();
      const oldRow = await getBotRowByUser(user.id);

      const { error: upsertErr } = await adminClient.from('telegram_bots').upsert({
        user_id: user.id,
        bot_username: botUsername,
        bot_user_id: botUserId,
        token_encrypted: enc.cipher,
        token_iv: enc.iv,
        webhook_secret: webhookSecret,
        link_secret: linkSecret,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (upsertErr) throw upsertErr;

      // 4. Pasang webhook untuk bot INI. Gagal -> kembalikan baris lama.
      const wh = await setBotWebhook(token, linkSecret, webhookSecret);
      if (!wh.ok) {
        if (oldRow) {
          await adminClient.from('telegram_bots').upsert({
            user_id: oldRow.user_id,
            bot_username: oldRow.bot_username,
            bot_user_id: oldRow.bot_user_id,
            token_encrypted: oldRow.token_encrypted,
            token_iv: oldRow.token_iv,
            webhook_secret: oldRow.webhook_secret,
            link_secret: oldRow.link_secret,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        } else {
          await adminClient.from('telegram_bots').delete().eq('user_id', user.id);
        }
        return jsonResponse(req, 502, { success: false, error: `Telegram menolak webhook: ${wh.data.description || 'gagal memasang webhook'}. Coba lagi nanti.` });
      }

      // 5. Bila mengganti bot lama, cabut webhook bot lama (best-effort).
      if (oldRow && oldRow.bot_user_id !== botUserId) {
        try {
          const oldToken = await decryptBotToken(oldRow.token_iv, oldRow.token_encrypted);
          await deleteBotWebhook(oldToken);
        } catch { /* abaikan */ }
      }

      return jsonResponse(req, 200, { success: true, bot_username: botUsername, bot_user_id: botUserId });
    }

    if (action === 'disconnect_bot') {
      const row = await getBotRowByUser(user.id);
      if (!row) return jsonResponse(req, 404, { success: false, error: 'Belum ada bot yang terhubung.' });
      try {
        const token = await decryptBotToken(row.token_iv, row.token_encrypted);
        await deleteBotWebhook(token);
      } catch { /* best-effort; baris tetap dihapus */ }
      await adminClient.from('telegram_chats').delete().eq('user_id', user.id);
      await adminClient.from('telegram_pairings').delete().eq('user_id', user.id);
      await adminClient.from('telegram_bots').delete().eq('user_id', user.id);
      return jsonResponse(req, 200, { success: true });
    }

    if (action === 'rotate_webhook') {
      const row = await getBotRowByUser(user.id);
      if (!row) return jsonResponse(req, 404, { success: false, error: 'Belum ada bot yang terhubung.' });
      const newWebhookSecret = randomSecretHex();
      const newLinkSecret = randomSecretHex();
      const { error: updErr } = await adminClient.from('telegram_bots').update({
        webhook_secret: newWebhookSecret,
        link_secret: newLinkSecret,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);
      if (updErr) throw updErr;
      let token: string;
      try {
        token = await decryptBotToken(row.token_iv, row.token_encrypted);
      } catch {
        return jsonResponse(req, 500, { success: false, error: 'Server belum dikonfigurasi (kunci enkripsi bot belum diisi). Hubungi admin.' });
      }
      const wh = await setBotWebhook(token, newLinkSecret, newWebhookSecret);
      if (!wh.ok) {
        // Kembalikan secret lama supaya webhook lama tetap hidup.
        await adminClient.from('telegram_bots').update({
          webhook_secret: row.webhook_secret,
          link_secret: row.link_secret,
          updated_at: new Date().toISOString(),
        }).eq('user_id', user.id);
        return jsonResponse(req, 502, { success: false, error: `Telegram menolak webhook: ${wh.data.description || 'gagal memasang webhook'}. Secret lama tetap dipakai.` });
      }
      return jsonResponse(req, 200, { success: true });
    }

    return jsonResponse(req, 400, { success: false, error: 'Aksi tidak dikenal.' });
  } catch (e) {
    console.error('telegram-setup error', action, e);
    return jsonResponse(req, 500, { success: false, error: 'Terjadi kesalahan di server. Coba lagi nanti.' });
  }
});
