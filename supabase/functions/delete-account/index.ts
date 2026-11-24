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

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('delete-account: deleteUser failed', deleteError.message);
    return jsonResponse(req, { error: deleteError.message || 'Gagal menghapus akun.' }, 500);
  }

  return jsonResponse(req, { success: true });
});
