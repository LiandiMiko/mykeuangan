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
    return jsonResponse(req, { error: 'Fungsi operasi admin belum dikonfigurasi.' }, 500);
  }

  const tokenMatch = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);

  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400); }
  if (!isRecord(body)) return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400);

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!['delete_user', 'unlink_telegram'].includes(action) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) {
    return jsonResponse(req, { error: 'Aksi atau ID pengguna tidak valid.' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);

  const { data: requester } = await adminClient.from('profiles').select('role,status,email').eq('id', authData.user.id).maybeSingle();
  if (!requester || requester.role !== 'admin' || requester.status !== 'active') {
    return jsonResponse(req, { error: 'Akses ditolak: hanya administrator aktif.' }, 403);
  }

  const { data: target, error: targetErr } = await adminClient.from('profiles').select('id,email,role,status').eq('id', userId).maybeSingle();
  if (targetErr) return jsonResponse(req, { error: 'Gagal memeriksa akun tujuan.' }, 500);
  if (!target) return jsonResponse(req, { error: 'Akun pengguna tidak ditemukan.' }, 404);

  if (action === 'unlink_telegram') {
    const { data: deletedChats, error: chatErr } = await adminClient.from('telegram_chats').delete().eq('user_id', userId).select('chat_id');
    if (chatErr) return jsonResponse(req, { error: chatErr.message || 'Gagal memutus tautan Telegram.' }, 500);
    await adminClient.from('telegram_pairings').delete().eq('user_id', userId);
    try {
      await adminClient.from('admin_audit_logs').insert({
        actor_user_id: authData.user.id, actor_email: requester.email || '', action: 'unlink_telegram',
        target_user_id: userId, target_email: target.email || '',
        details: { chats_removed: (deletedChats || []).length }
      });
    } catch { /* ignore if audit table not migrated yet */ }
    return jsonResponse(req, { success: true, unlinkedCount: (deletedChats || []).length });
  }

  if (userId === authData.user.id) {
    return jsonResponse(req, { error: 'Gunakan fitur Hapus Akun Saya pada Pengaturan Akun.' }, 400);
  }
  const confirmToken = typeof body.confirmation === 'string' ? body.confirmation.trim().toUpperCase() : '';
  if (!['HAPUS', 'DELETE'].includes(confirmToken)) {
    return jsonResponse(req, { error: 'Konfirmasi HAPUS diperlukan.' }, 400);
  }
  if (target.role === 'admin' && target.status === 'active') {
    const { data: otherAdmins } = await adminClient.from('profiles').select('id').neq('id', userId).eq('role', 'admin').eq('status', 'active').limit(1);
    if (!otherAdmins || !otherAdmins.length) {
      return jsonResponse(req, { error: 'Tidak dapat menghapus satu-satunya admin aktif.' }, 400);
    }
  }
  try {
    await adminClient.from('admin_audit_logs').insert({
      actor_user_id: authData.user.id, actor_email: requester.email || '', action: 'delete_user',
      target_user_id: userId, target_email: target.email || '', details: { target_role: target.role }
    });
  } catch { /* ignore if audit table not migrated yet */ }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) return jsonResponse(req, { error: deleteError.message || 'Gagal menghapus pengguna.' }, 500);
  return jsonResponse(req, { success: true });
});
