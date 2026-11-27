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
// Dipakai unlink_telegram untuk memanggil deleteWebhook pada bot pengguna.
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
    return jsonResponse(req, { error: 'Fungsi operasi admin belum dikonfigurasi.' }, 500);
  }

  const tokenMatch = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);

  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400); }
  if (!isRecord(body)) return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400);

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!['delete_user', 'unlink_telegram', 'set_user_role', 'set_user_status'].includes(action) ||
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

  if (action === 'set_user_role' || action === 'set_user_status') {
    const isRoleChange = action === 'set_user_role';
    const newValue = isRoleChange
      ? (typeof body.role === 'string' ? body.role.trim() : '')
      : (typeof body.status === 'string' ? body.status.trim() : '');
    const allowedValues = isRoleChange ? ['user', 'admin'] : ['active', 'suspended'];
    if (!allowedValues.includes(newValue)) {
      return jsonResponse(req, { error: isRoleChange ? 'Role tidak valid.' : 'Status tidak valid.' }, 400);
    }

    // Admin tidak boleh mendemosi/menonaktifkan akunnya sendiri. Cek ini harus
    // di server: trigger DB prevent_admin_lockout mengandalkan auth.uid() yang
    // bernilai null untuk service_role, jadi tidak menangkap kasus ini.
    const selfDemotes = userId === authData.user.id &&
      ((isRoleChange && newValue !== 'admin') || (!isRoleChange && newValue !== 'active'));
    if (selfDemotes) {
      return jsonResponse(req, {
        error: isRoleChange
          ? 'Admin tidak dapat menurunkan role akunnya sendiri.'
          : 'Admin tidak dapat menonaktifkan akunnya sendiri.',
      }, 400);
    }

    // Jangan sampai sistem kehabisan admin aktif (cermin logika delete_user).
    const removesActiveAdmin = target.role === 'admin' && target.status === 'active' &&
      ((isRoleChange && newValue !== 'admin') || (!isRoleChange && newValue !== 'active'));
    if (removesActiveAdmin) {
      const { data: otherAdmins } = await adminClient.from('profiles').select('id').neq('id', userId).eq('role', 'admin').eq('status', 'active').limit(1);
      if (!otherAdmins || !otherAdmins.length) {
        return jsonResponse(req, {
          error: isRoleChange
            ? 'Tidak dapat menurunkan role satu-satunya admin aktif.'
            : 'Tidak dapat menonaktifkan satu-satunya admin aktif.',
        }, 400);
      }
    }

    const patch = isRoleChange ? { role: newValue } : { status: newValue };
    const { error: updateError } = await adminClient.from('profiles').update(patch).eq('id', userId);
    if (updateError) return jsonResponse(req, { error: updateError.message || 'Gagal memperbarui akun pengguna.' }, 500);

    try {
      await adminClient.from('admin_audit_logs').insert({
        actor_user_id: authData.user.id, actor_email: requester.email || '',
        action: isRoleChange ? `role_${newValue}` : `status_${newValue}`,
        target_user_id: userId, target_email: target.email || '',
        details: isRoleChange
          ? { old_role: target.role, new_role: newValue }
          : { old_status: target.status, new_status: newValue },
      });
    } catch { /* ignore if audit table not migrated yet */ }
    return jsonResponse(req, { success: true });
  }

  if (action === 'unlink_telegram') {
    // Ambil baris bot personal SEBELUM dihapus, supaya webhook bot itu
    // bisa dicabut (deleteWebhook). Tanpa ini, webhook tetap terpasang
    // di Telegram dan update-nya terus datang (ditolak 404) setelah unlink.
    const { data: botRow } = await adminClient.from('telegram_bots')
      .select('token_encrypted,token_iv').eq('user_id', userId).maybeSingle();
    const { data: deletedChats, error: chatErr } = await adminClient.from('telegram_chats').delete().eq('user_id', userId).select('chat_id');
    if (chatErr) return jsonResponse(req, { error: chatErr.message || 'Gagal memutus tautan Telegram.' }, 500);
    await adminClient.from('telegram_pairings').delete().eq('user_id', userId);
    await adminClient.from('telegram_bots').delete().eq('user_id', userId);
    if (botRow) {
      try {
        const token = await decryptBotToken(botRow.token_iv, botRow.token_encrypted);
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ drop_pending_updates: true }),
          signal: AbortSignal.timeout(10000),
        });
      } catch { /* best-effort: token bisa sudah dicabut via BotFather */ }
    }
    try {
      await adminClient.from('admin_audit_logs').insert({
        actor_user_id: authData.user.id, actor_email: requester.email || '', action: 'unlink_telegram',
        target_user_id: userId, target_email: target.email || '',
        details: { chats_removed: (deletedChats || []).length, bots_removed: botRow ? 1 : 0 }
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
