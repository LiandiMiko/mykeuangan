import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// --- CORS fail-closed (Gelombang 3.3, S14) ---------------------------------
// ALLOWED_ORIGIN wajib diisi (daftar origin dipisah koma, tanpa trailing
// slash). '*' di daftar DITOLAK — bukan wildcard. Origin request yang
// tidak ada di daftar TIDAK mendapat header Access-Control-Allow-Origin
// sama sekali (browser menolak). Request tanpa header Origin memakai
// origin pertama yang dikonfigurasi, atau default aman
// https://liandimiko.github.io bila env kosong. Set secret-nya eksplisit
// per environment saat deploy (lihat supabase/README.md).
const DEFAULT_ALLOWED_ORIGIN = 'https://liandimiko.github.io';

function resolveAllowedOrigin(req: Request): string | null {
  const raw = Deno.env.get('ALLOWED_ORIGIN') ?? '';
  const list = raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter((s) => s && s !== '*');
  const reqOrigin = (req.headers.get('origin') || '').trim().replace(/\/+$/, '');
  if (reqOrigin) return list.includes(reqOrigin) ? reqOrigin : null;
  return list[0] ?? DEFAULT_ALLOWED_ORIGIN;
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
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

// --- Kebijakan password server (Gelombang 3.3, S14) ------------------------
// Aturan IDENTIK dengan validator klien (web): panjang 8–128, tolak 3+
// karakter identik berurutan, tolak 4+ karakter berurutan naik/turun
// (abcd / 4321), tolak password umum (denylist ~100), tolak password
// yang mengandung local-part email pemilik akun.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'pass123', 'pass', 'psw123',
  '12345678', '123456789', '1234567890', '12345678910', '1234567', '123456', '12345', '123456a', 'a123456',
  '123123', '123321', '123abc', '123qwe', '1234qwer', 'qwer1234', 'qwe123', '1q2w3e', '1q2w3e4r', '1qaz2wsx',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfgh', 'asdf1234', 'zxcvbn', 'zxcvbnm',
  '11111111', '00000000', '000000', '112233', '121212', '77777777', '88888888', '99999999',
  'abc123', 'abc12345', 'aaa111', 'admin', 'admin123', 'admin1234', 'root123', 'user123', 'test123', 'test1234',
  'letmein', 'welcome', 'welcome1', 'changeme', 'default', 'secret', 'freedom', 'trustno1',
  'monkey', 'dragon', 'football', 'iloveyou', 'sunshine', 'master', 'shadow', 'superman', 'michael',
  'jordan', 'jordan23', 'liverpool', 'chelsea', 'arsenal', 'killer', 'starwars', 'whatever', 'princess',
  'ashley', 'bailey', 'daniel', 'jessica', 'charlie', 'thomas', 'mypass', 'computer', 'internet', 'access',
  'flower', 'hannah', 'maggie', 'pepper', 'ginger', 'marlboro', 'diamond', 'golden', 'silver', 'copper',
  'winter', 'summer', 'autumn', 'spring', 'hello123', 'world123', 'mustang',
  'indonesia', 'indonesia123', 'jakarta', 'jakarta123', 'bismillah', 'allah', 'sayang', 'cinta', 'rahasia',
]);

function hasSequentialRun(pw: string): boolean {
  const s = pw.toLowerCase();
  for (let i = 0; i + 4 <= s.length; i++) {
    const a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2), d = s.charCodeAt(i + 3);
    if (b === a + 1 && c === b + 1 && d === c + 1) return true;
    if (b === a - 1 && c === b - 1 && d === c - 1) return true;
  }
  return false;
}

/** Kembalikan pesan error spesifik, atau null bila password lolos. */
export function validateAdminPassword(password: unknown, emailLocalPart = ''): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Password harus 8–128 karakter.';
  }
  if (/(.)\1{2,}/.test(password)) return 'Password tidak boleh mengandung 3 karakter identik berurutan.';
  if (hasSequentialRun(password)) return 'Password tidak boleh mengandung 4 karakter berurutan (mis. abcd atau 1234).';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Password terlalu umum. Pilih password yang lebih unik.';
  const local = String(emailLocalPart || '').trim().toLowerCase();
  if (local.length >= 3 && password.toLowerCase().includes(local)) {
    return 'Password tidak boleh mengandung bagian dari alamat email akun.';
  }
  return null;
}

// --- Dekripsi token bot personal (Gelombang 2.2, sama dengan admin-user-ops)
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

// --- Notifikasi pemilik akun via Telegram (Gelombang 3.3, S14) -------------
// Best-effort: kirim lewat bot personal pemilik akun (token terenkripsi di
// telegram_bots); bila belum ada bot personal, pakai token env bersama
// (fallback transisi, sama seperti telegram-bot/core.ts). Bila tidak ada
// chat tertaut / tidak ada token, kembalikan notified:false beserta
// alasan — pemanggil mencatatnya di audit, BUKAN menggagalkan aksi.
async function notifyUserByTelegram(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  message: string,
): Promise<{ notified: boolean; reason: string }> {
  try {
    const { data: chats } = await adminClient.from('telegram_chats').select('chat_id').eq('user_id', userId);
    if (!chats?.length) return { notified: false, reason: 'no_linked_chat' };
    let token = '';
    try {
      const { data: botRow } = await adminClient.from('telegram_bots')
        .select('token_encrypted,token_iv').eq('user_id', userId).maybeSingle();
      if (botRow) token = await decryptBotToken(botRow.token_iv, botRow.token_encrypted);
    } catch { /* fallback ke token env di bawah */ }
    if (!token) token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
    if (!token) return { notified: false, reason: 'no_bot_token' };
    let ok = false;
    for (const ch of chats as { chat_id: number }[]) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: ch.chat_id, text: message, parse_mode: 'HTML' }),
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) ok = true;
      } catch { /* coba chat berikutnya */ }
    }
    return ok ? { notified: true, reason: 'sent' } : { notified: false, reason: 'send_failed' };
  } catch (e) {
    console.error('admin-password: notify telegram gagal', e);
    return { notified: false, reason: 'error' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('admin-password: required Supabase environment is missing');
    return jsonResponse(req, { error: 'Fungsi reset password belum dikonfigurasi.' }, 500);
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

  if (!isRecord(body)) return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400);

  const userId = body.userId;
  const password = body.password;
  if (typeof userId !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) {
    return jsonResponse(req, { error: 'ID pengguna tidak valid.' }, 400);
  }
  const pwError = validateAdminPassword(password);
  if (pwError) return jsonResponse(req, { error: pwError }, 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);
  if (userId === authData.user.id) {
    return jsonResponse(req, { error: 'Gunakan fitur ganti password akun Anda sendiri.' }, 400);
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role,status')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error('admin-password: failed to load requester profile', profileError.message);
    return jsonResponse(req, { error: 'Tidak dapat memverifikasi hak akses admin.' }, 500);
  }
  if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
    return jsonResponse(req, { error: 'Akses ditolak: hanya admin aktif yang dapat mengatur password pengguna lain.' }, 403);
  }

  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('id,email')
    .eq('id', userId)
    .maybeSingle();
  if (targetError) {
    console.error('admin-password: failed to load target profile', targetError.message);
    return jsonResponse(req, { error: 'Tidak dapat memeriksa akun tujuan.' }, 500);
  }
  if (!target) return jsonResponse(req, { error: 'Akun pengguna tidak ditemukan.' }, 404);

  // Cek local-part email (butuh email target — baru bisa dicek di sini).
  const localPart = String(target.email || '').split('@')[0] || '';
  const pwLocalError = validateAdminPassword(password, localPart);
  if (pwLocalError) return jsonResponse(req, { error: pwLocalError }, 400);

  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password });
  if (updateError) {
    return jsonResponse(req, { error: updateError.message || 'Password pengguna gagal diperbarui.' }, 400);
  }

  // S14: beri tahu pemilik akun lewat Telegram (best-effort), lalu catat
  // audit. Hasil notifikasi dicatat di details audit.
  const notify = await notifyUserByTelegram(
    adminClient,
    userId,
    '🔐 <b>Password akun Anda direset oleh admin.</b>\n\nBila ini bukan Anda, segera hubungi admin MyKeuGuech.',
  );

  // Audit WAJIB lewat RPC admin_log_action (migrasi Gelombang 3,
  // 20261128040000_wave3_database.sql, mencabut INSERT langsung ke
  // admin_audit_logs + allowlist aksi). Bentuk panggilan edge function
  // menurut migrasi itu: adminClient (service_role) dengan actor
  // eksplisit — JWT service_role tidak membawa auth.uid(), jadi tanpa
  // p_actor_user_id RPC menolak. Bila audit gagal, JANGAN diam-diam:
  // kembalikan 500 yang menyatakan password sudah berubah tapi audit
  // gagal, supaya kejadian itu ditindaklanjuti manual.
  const { error: auditError } = await adminClient.rpc('admin_log_action', {
    p_action: 'reset_password',
    p_target_user_id: userId,
    p_target_email: target.email || '',
    p_details: { telegram_notified: notify.notified, telegram_reason: notify.reason },
    p_actor_user_id: authData.user.id,
    p_actor_email: authData.user.email || '',
  });
  if (auditError) {
    console.error('admin-password: audit log gagal', auditError.message);
    return jsonResponse(req, { error: 'Password berhasil diubah, tetapi pencatatan audit gagal. Hubungi admin — kejadian ini harus dicatat manual.' }, 500);
  }

  return jsonResponse(req, { success: true });
});
