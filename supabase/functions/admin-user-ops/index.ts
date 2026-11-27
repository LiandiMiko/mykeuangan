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

// --- Audit lewat RPC (Gelombang 3.3, S14) -----------------------------------
// Migrasi Gelombang 3 (20261128040000_wave3_database.sql) mencabut
// INSERT langsung ke admin_audit_logs; semua pencatatan HARUS lewat
// admin_log_action() dengan allowlist aksi. Bentuk panggilan edge
// function menurut migrasi itu: adminClient (service_role) dengan actor
// eksplisit (p_actor_user_id/p_actor_email) — JWT service_role tidak
// membawa auth.uid(), jadi tanpa actor RPC menolak. Gagal audit di sini
// best-effort (dicatat ke console) supaya aksi admin tidak gagal hanya
// karena log — pengecualian: reset password di admin-password/index.ts
// yang gagal auditnya dikembalikan 500.
async function logAdminAction(
  adminClient: ReturnType<typeof createClient>,
  action: string,
  targetUserId: string,
  targetEmail: string,
  details: Record<string, unknown>,
  actorUserId: string,
  actorEmail: string,
): Promise<void> {
  const { error } = await adminClient.rpc('admin_log_action', {
    p_action: action,
    p_target_user_id: targetUserId,
    p_target_email: targetEmail,
    p_details: details,
    p_actor_user_id: actorUserId,
    p_actor_email: actorEmail,
  });
  if (error) console.error('admin-user-ops: audit log gagal', action, error.message);
}

// --- Notifikasi pemilik akun via Telegram (Gelombang 3.3, S14) -------------
// Best-effort, mekanisme sama seperti admin-password/index.ts: bot
// personal pemilik akun dulu, fallback token env bersama. Bila tidak ada
// chat tertaut / token, kembalikan alasan — dicatat di audit.
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
    console.error('admin-user-ops: notify telegram gagal', e);
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

    // S14: beri tahu pemilik akun, lalu audit lewat RPC (bukan INSERT
    // langsung — dicabut migrasi Gelombang 3).
    const notify = await notifyUserByTelegram(
      adminClient,
      userId,
      isRoleChange
        ? `⚠️ <b>Role akun Anda diubah oleh admin.</b>\n\nRole baru: <b>${newValue}</b>\n\nBila ini bukan permintaan Anda, segera hubungi admin MyKeuGuech.`
        : `⚠️ <b>Status akun Anda diubah oleh admin.</b>\n\nStatus baru: <b>${newValue}</b>\n\nBila ini bukan permintaan Anda, segera hubungi admin MyKeuGuech.`,
    );
    await logAdminAction(
      adminClient,
      isRoleChange ? `role_${newValue}` : `status_${newValue}`,
      userId,
      target.email || '',
      isRoleChange
        ? { old_role: target.role, new_role: newValue, telegram_notified: notify.notified, telegram_reason: notify.reason }
        : { old_status: target.status, new_status: newValue, telegram_notified: notify.notified, telegram_reason: notify.reason },
      authData.user.id,
      requester.email || '',
    );
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
    // unlink_telegram: tidak ada notifikasi — chat target baru saja
    // dihapus, jadi tidak ada lagi jalur Telegram ke pemilik akun.
    await logAdminAction(adminClient, 'unlink_telegram', userId, target.email || '', {
      chats_removed: (deletedChats || []).length, bots_removed: botRow ? 1 : 0,
    }, authData.user.id, requester.email || '');
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
  // S14: beri tahu pemilik akun DAHULU — telegram_chats ikut terhapus
  // (ON DELETE CASCADE) begitu auth user dihapus, jadi setelah delete
  // tidak ada lagi jalur notifikasi. Lalu audit lewat RPC, baru hapus.
  const notify = await notifyUserByTelegram(
    adminClient,
    userId,
    '🗑️ <b>Akun Anda telah dihapus oleh admin.</b>\n\nBila ini bukan permintaan Anda, segera hubungi admin MyKeuGuech.',
  );
  await logAdminAction(adminClient, 'delete_user', userId, target.email || '', {
    target_role: target.role, telegram_notified: notify.notified, telegram_reason: notify.reason,
  }, authData.user.id, requester.email || '');

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) return jsonResponse(req, { error: deleteError.message || 'Gagal menghapus pengguna.' }, 500);
  return jsonResponse(req, { success: true });
});
