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
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 128) {
    return jsonResponse(req, { error: 'ID pengguna atau password tidak valid.' }, 400);
  }

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
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (targetError) {
    console.error('admin-password: failed to load target profile', targetError.message);
    return jsonResponse(req, { error: 'Tidak dapat memeriksa akun tujuan.' }, 500);
  }
  if (!target) return jsonResponse(req, { error: 'Akun pengguna tidak ditemukan.' }, 404);

  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password });
  if (updateError) {
    return jsonResponse(req, { error: updateError.message || 'Password pengguna gagal diperbarui.' }, 400);
  }

  return jsonResponse(req, { success: true });
});
