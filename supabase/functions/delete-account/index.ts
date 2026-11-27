import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

function resolveAllowedOrigin(req: Request): string {
  const raw = Deno.env.get('ALLOWED_ORIGIN') || '*';
  const list = raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!list.length || list.includes('*')) return '*';
  const reqOrigin = (req.headers.get('origin') || '').trim().replace(/\/+$/, '');
  if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
  return list[0];
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin !== '*') headers['Vary'] = 'Origin';
  return headers;
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Dekripsi token bot personal (Gelombang 2.2) ----------------------------
// Desain sama dengan telegram-bot/core.ts dan telegram-setup/index.ts
// (AES-GCM, kunci = SHA-256 dari TELEGRAM_TOKEN_ENCRYPTION_KEY).
// Dipakai untuk mencabut webhook bot pengguna sebelum akun dihapus
// (baris telegram_bots ikut terhapus lewat ON DELETE CASCADE, tetapi
// webhook di Telegram harus dicabut eksplisit).
const b64ToBytes = (s: string) => {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function decryptBotToken(ivB64: string, cipherB64: string): Promise<string> {
  const secret = Deno.env.get('TELEGRAM_TOKEN_ENCRYPTION_KEY') ?? '';
  if (!secret) throw new Error('TELEGRAM_TOKEN_ENCRYPTION_KEY belum dikonfigurasi.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(cipherB64),
  );
  return new TextDecoder().decode(plain);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('delete-account: required Supabase environment is missing');
    return jsonResponse(req, { error: 'Fungsi hapus akun belum dikonfigurasi.' }, 500);
  }

  const authorization = req.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400);
  }

  if (!isRecord(body) || typeof body.confirmation !== 'string' ||
      !['HAPUS', 'DELETE'].includes(body.confirmation.trim().toUpperCase())) {
    return jsonResponse(req, { error: 'Ketik HAPUS atau DELETE untuk mengonfirmasi penghapusan akun.' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);
  const userId = authData.user.id;

  // T4: autentikasi ulang — penghapusan akun wajib membuktikan password
  // saat ini. Pesan sengaja generik ("Kata sandi tidak valid.") agar tidak
  // membocorkan apakah password yang dikirim kosong, salah, atau akun
  // tidak punya password (mis. akun OAuth-only). signInWithPassword di
  // sini memakai klien anon tanpa persistSession, jadi tidak ada sesi
  // baru yang tersimpan di server fungsi ini.
  if (!isRecord(body) || typeof body.password !== 'string' || !body.password) {
    return jsonResponse(req, { error: 'Kata sandi tidak valid.' }, 401);
  }
  const { error: passwordError } = await userClient.auth.signInWithPassword({
    email: authData.user.email,
    password: body.password,
  });
  if (passwordError) return jsonResponse(req, { error: 'Kata sandi tidak valid.' }, 401);

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role,status')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) {
    console.error('delete-account: failed to load requester profile', profileError.message);
    return jsonResponse(req, { error: 'Tidak dapat memverifikasi profil pengguna.' }, 500);
  }

  if (profile && profile.role === 'admin' && profile.status === 'active') {
    const { data: otherAdmins, error: adminCheckErr } = await adminClient
      .from('profiles')
      .select('id')
      .neq('id', userId)
      .eq('role', 'admin')
      .eq('status', 'active')
      .limit(1);
    if (adminCheckErr) {
      console.error('delete-account: failed to check remaining admins', adminCheckErr.message);
      return jsonResponse(req, { error: 'Gagal memeriksa daftar administrator.' }, 500);
    }
    if (!otherAdmins || otherAdmins.length === 0) {
      return jsonResponse(req, {
        error: 'Anda adalah satu-satunya administrator aktif. Promosikan admin lain terlebih dahulu sebelum menghapus akun.',
      }, 400);
    }
  }

  // Bot personal: cabut webhook bot pengguna SEBELUM akun dihapus
  // (baris telegram_bots ikut terhapus via ON DELETE CASCADE, tetapi
  // webhook di Telegram harus dicabut eksplisit). Best-effort: kegagalan
  // di sini tidak boleh menggagalkan penghapusan akun.
  try {
    const { data: botRow } = await adminClient.from('telegram_bots')
      .select('token_encrypted,token_iv').eq('user_id', userId).maybeSingle();
    if (botRow) {
      const token = await decryptBotToken(botRow.token_iv, botRow.token_encrypted);
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: true }),
        signal: AbortSignal.timeout(10000),
      });
    }
  } catch (e) {
    console.error('delete-account: gagal mencabut webhook bot', e);
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('delete-account: deleteUser failed', deleteError.message);
    return jsonResponse(req, { error: deleteError.message || 'Gagal menghapus akun.' }, 500);
  }

  return jsonResponse(req, { success: true });
});
