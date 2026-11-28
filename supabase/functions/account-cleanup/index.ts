// supabase/functions/account-cleanup/index.ts
// ============================================================
// Edge function: hapus otomatis akun dormant + NOTIFIKASI
// IN-APP khusus admin (fitur admin "last change" — worker Edge
// Function).
//
// Peringatan H-1 dan konfirmasi hapus semula dikirim via email;
// sejak 2026-11-28 jalur email DIBATALKAN Liandi dan
// diganti notifikasi in-app: edge function menulis baris ke
// tabel public.admin_notifications, yang hanya bisa dibaca
// admin lewat RPC get_admin_notifications() (migrasi
// 20261128110000_admin_notifications.sql) dan ditampilkan di
// panel admin. TIDAK ada lagi pengiriman email dari function
// ini — secret email lama mungkin masih terpasang di
// Supabase, tetapi TIDAK dipakai di sini.
//
// Dipanggil HANYA oleh pg_cron (supabase/schedule.sql,
// mk-account-cleanup, harian 02:00 WIB = 19:00 UTC). Dijalankan
// dengan verify_jwt=false saat deploy — autentikasi memakai
// header x-cron-secret yang diverifikasi timing-safe terhadap
// CRON_SECRET (pola Gelombang 2.3, telegram-bot/jobs.ts:425),
// secret dibaca pg_cron dari Vault, bukan dari definisi job.
//
// Alur tiap jalan harian:
//   1. POST + x-cron-secret benar, atau tolak (405 / 403 / 500).
//   2. Ambil profiles (service_role) + auth.admin.listUsers
//      (paginasi) untuk last_sign_in_at; gabungkan.
//   3. Kandidat HANYA status='active' dan role != 'admin'
//      (lihat logic.ts: admin dan suspended dikecualikan).
//   4. Tidak aktif 6 hari & belum diperingatkan -> tulis
//      notifikasi peringatan ke admin_notifications; HANYA bila
//      insert sukses, set deletion_warning_sent_at = now()
//      (gagal -> run besok mencoba lagi, jangan set flag).
//   5. Tidak aktif >= 7 hari DAN sudah pernah diperingatkan ->
//      cabut webhook bot personal dulu (best-effort, pola
//      delete-account), lalu admin.deleteUser (ON DELETE CASCADE
//      menghapus semua data), lalu tulis notifikasi konfirmasi
//      (target_email dicatat SEBELUM penghapusan). Notifikasi
//      konfirmasi yang gagal ditulis dicatat sebagai error
//      tetapi TIDAK membatalkan penghapusan. User yang sudah
//      tidak ada dilewati (idempotent). Pengguna >= 7 hari yang
//      BELUM pernah diperingatkan TIDAK dihapus — mereka mendapat
//      peringatan TERLAMBAT dulu (tanggal hapus = run besok) dan
//      baru dihapus pada run berikutnya.
//   6. Catat run ke cron_job_runs (pola telegram-bot/jobs.ts):
//      created_count = akun dihapus, notified_count = notifikasi
//      in-app dibuat, skipped_count = pengguna dilewati.
//
// Karena penghapusan mensyaratkan peringatan SUDAH dibuat
// (lihat logic.ts: classifyUser), insert notifikasi yang selalu
// gagal berarti TIDAK ADA akun yang dihapus — fail-closed,
// bukan hapus diam-diam tanpa peringatan. Jangan pernah log
// isi notifikasi penuh atau nilai secret apa pun.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  APP_TIMEZONE,
  classifyUser,
  deletionDate,
  deletionNotification,
  lastChangeAt,
  nextDayDate,
  selectCandidates,
  warningNotification,
} from './logic.ts';
import type { AdminNotification, CleanupUser } from './logic.ts';

// --- CORS fail-closed (pola delete-account/index.ts) ----------------------
// ALLOWED_ORIGIN wajib diisi (daftar origin dipisah koma, tanpa trailing
// slash). '*' di daftar DITOLAK. Origin request yang tidak ada di daftar
// TIDAK mendapat header Access-Control-Allow-Origin sama sekali.
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

// --- Perbandingan constant-time (pola telegram-bot/core.ts:169) ------------
async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// --- Dekripsi token bot personal (pola delete-account/index.ts) ------------
// AES-GCM, kunci = SHA-256 dari TELEGRAM_TOKEN_ENCRYPTION_KEY. Dipakai
// untuk mencabut webhook bot pengguna sebelum akun dihapus (baris
// telegram_bots ikut terhapus lewat ON DELETE CASCADE, tetapi webhook
// di Telegram harus dicabut eksplisit).
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

// --- Log run cron (pola telegram-bot/jobs.ts:362-397) ----------------------
// Sengaja TIDAK mencatat percobaan yang ditolak autentikasi (403):
// pemanggilnya belum teridentifikasi, dan mencatatnya akan membiarkan
// siapa pun membanjiri tabel log hanya dengan mengirim secret salah.
type JobRunCounts = { created?: number; notified?: number; skipped?: number };

async function logJobRunStart(job: string, invokedBy: string): Promise<string | null> {
  try {
    const { data, error } = await getAdminClient().from('cron_job_runs').insert({
      job, invoked_by: invokedBy, started_at: new Date().toISOString(), status: 'running',
    }).select('id');
    if (error) { console.error('cron_job_runs insert', error); return null; }
    return (data?.[0] as { id?: string } | undefined)?.id ?? null;
  } catch (e) {
    console.error('cron_job_runs insert', e);
    return null;
  }
}

async function logJobRunFinish(
  runId: string | null, status: 'ok' | 'error', counts: JobRunCounts, error?: string,
): Promise<void> {
  if (!runId) return;
  try {
    const { error: updErr } = await getAdminClient().from('cron_job_runs').update({
      finished_at: new Date().toISOString(), status,
      created_count: counts.created ?? 0,
      notified_count: counts.notified ?? 0,
      skipped_count: counts.skipped ?? 0,
      error: error ?? null,
    }).eq('id', runId);
    if (updErr) console.error('cron_job_runs update', updErr);
  } catch (e) {
    console.error('cron_job_runs update', e);
  }
}

// --- Notifikasi in-app khusus admin ----------------------------------------
// Tulis satu baris ke public.admin_notifications lewat klien
// service_role (service_role bypass RLS; RLS tabel memang
// menutup akses klien). target_user_id sengaja TANPA FK — baris
// 'deletion_done' harus bertahan setelah akunnya dihapus.
// Insert gagal -> { ok: false } supaya pemanggil TIDAK menandai
// peringatan sebagai dibuat (fail-closed).
async function insertAdminNotification(
  client: ReturnType<typeof createClient>,
  user: CleanupUser,
  notif: AdminNotification,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await client.from('admin_notifications').insert({
      type: notif.type,
      target_user_id: user.id,
      target_email: user.email,
      title: notif.title,
      body: notif.body,
    });
    if (error) {
      console.error('account-cleanup: gagal menulis notifikasi admin', user.id, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('account-cleanup: gagal menulis notifikasi admin', user.id, e);
    return { ok: false, error: String((e as Error).message || e) };
  }
}

// --- Klien Supabase (dibuat sekali, sesudah env dicek di handler) ---------
let sb: ReturnType<typeof createClient>;

function getAdminClient() {
  if (!sb) {
    sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return sb;
}

// --- Pengambilan data -------------------------------------------------------
const PAGE_SIZE = 1000;

async function fetchProfiles(): Promise<CleanupUser[]> {
  const client = getAdminClient();
  const out: CleanupUser[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from('profiles')
      .select('id,email,role,status,created_at,last_activity_at,deletion_warning_sent_at')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`gagal membaca profiles: ${error.message}`);
    const rows = (data ?? []) as CleanupUser[];
    out.push(...rows.map((r) => ({ ...r, last_sign_in_at: null as string | null })));
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function fetchLastSignIns(): Promise<Map<string, string | null>> {
  const client = getAdminClient();
  const map = new Map<string, string | null>();
  let page = 1;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`gagal membaca daftar auth users: ${error.message}`);
    for (const u of data.users) map.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < PAGE_SIZE) break;
    page++;
  }
  return map;
}

// --- Cabut webhook bot personal (best-effort, pola delete-account) ---------
async function revokeBotWebhook(userId: string): Promise<void> {
  try {
    const { data: botRow } = await getAdminClient().from('telegram_bots')
      .select('token_encrypted,token_iv').eq('user_id', userId).maybeSingle();
    if (!botRow) return;
    const token = await decryptBotToken(botRow.token_iv, botRow.token_encrypted);
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error('account-cleanup: gagal mencabut webhook bot', userId, e);
  }
}

// --- Handler ----------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('account-cleanup: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi');
    return jsonResponse(req, { error: 'Fungsi account-cleanup belum dikonfigurasi.' }, 500);
  }
  if (!cronSecret) {
    console.error('account-cleanup: CRON_SECRET belum dikonfigurasi');
    return jsonResponse(req, { error: 'Fungsi account-cleanup belum dikonfigurasi.' }, 500);
  }
  if (!await safeEqual(req.headers.get('x-cron-secret') ?? '', cronSecret)) {
    return jsonResponse(req, { error: 'forbidden' }, 403);
  }

  const runId = await logJobRunStart('account-cleanup', 'cron');
  const now = new Date();
  const errors: string[] = [];
  let warned = 0;
  let deleted = 0;
  let notificationsSent = 0;
  let skipped = 0;

  try {
    const profiles = await fetchProfiles();
    const signIns = await fetchLastSignIns();
    const users: CleanupUser[] = profiles.map((p) => ({
      ...p,
      last_sign_in_at: signIns.get(p.id) ?? null,
    }));
    const { warn, delete: toDelete, skipped: skippedCount } = selectCandidates(users, now);
    skipped = skippedCount;

    // 1) Peringatan H-1 — flag HANYA diset bila notifikasi
    //    benar-benar tertulis ke admin_notifications.
    //    Peringatan terlambat (sudah >= 7 hari tapi belum pernah
    //    diperingatkan) memakai tanggal hapus = run besok, bukan
    //    tanggal yang sudah lewat.
    for (const user of warn) {
      const lastChange = lastChangeAt(user);
      if (!lastChange) { skipped++; continue; } // tidak mungkin (sudah diklasifikasi), jaga-jaga
      const c = classifyUser(user, now);
      const delDate = c.reason === 'tidak-aktif-7-hari-belum-diperingatkan'
        ? nextDayDate(now)
        : deletionDate(lastChange);
      const made = await insertAdminNotification(
        getAdminClient(), user,
        warningNotification(user, lastChange, c.daysInactive, delDate),
      );
      if (!made.ok) {
        errors.push(`peringatan ${user.id}: ${made.error ?? 'gagal-tulis-notifikasi'}`);
        continue; // jangan set flag — run besok mencoba lagi
      }
      notificationsSent++;
      const { error: flagErr } = await getAdminClient().from('profiles')
        .update({ deletion_warning_sent_at: now.toISOString() })
        .eq('id', user.id);
      if (flagErr) {
        errors.push(`peringatan ${user.id}: gagal menandai flag (${flagErr.message})`);
        continue;
      }
      warned++;
    }

    // 2) Hapus akun dormant >= 7 hari YANG SUDAH diperingatkan.
    //    (selectCandidates hanya memasukkan yang flag peringatannya
    //    terisi — lihat logic.ts. Tanpa peringatan dibuat, tidak
    //    ada penghapusan.)
    for (const user of toDelete) {
      const lastChange = lastChangeAt(user);
      if (!lastChange) { skipped++; continue; } // tidak mungkin, jaga-jaga
      // user.email sudah ada di memori (dibaca SEBELUM penghapusan)
      // dan dipakai deletionNotification — setelah deleteUser,
      // alamat ini sudah tidak ada di database.
      await revokeBotWebhook(user.id);
      const { error: deleteErr } = await getAdminClient().auth.admin.deleteUser(user.id);
      if (deleteErr) {
        // Idempotent: user sudah tidak ada (mis. dihapus admin manual
        // di antara pembacaan daftar dan penghapusan) -> lewati saja.
        if (/not found|user not found|no user/i.test(deleteErr.message)) {
          skipped++;
          continue;
        }
        errors.push(`hapus ${user.id}: ${deleteErr.message}`);
        continue;
      }
      deleted++;
      // Notifikasi konfirmasi adalah pemberitahuan; kegagalannya
      // dicatat tetapi TIDAK membatalkan penghapusan yang sudah
      // terjadi. target_user_id tanpa FK — baris ini bertahan
      // sebagai bukti meski akun sudah terhapus.
      const made = await insertAdminNotification(
        getAdminClient(), user,
        deletionNotification(user, lastChange),
      );
      if (made.ok) notificationsSent++;
      else errors.push(`konfirmasi-hapus ${user.id}: ${made.error ?? 'gagal-tulis-notifikasi'}`);
    }

    const status = errors.length > 0 ? 'error' : 'ok';
    await logJobRunFinish(runId, status, { created: deleted, notified: notificationsSent, skipped },
      errors.length > 0 ? errors.join(' | ').slice(0, 500) : undefined);
    return jsonResponse(req, {
      success: true,
      job: 'account-cleanup',
      timezone: APP_TIMEZONE,
      warned,
      deleted,
      skipped,
      notifications_sent: notificationsSent,
      errors,
      run_id: runId,
    });
  } catch (e) {
    const msg = String((e as Error).message || e);
    await logJobRunFinish(runId, 'error', { created: deleted, notified: notificationsSent, skipped }, msg.slice(0, 500));
    console.error('account-cleanup', e);
    return jsonResponse(req, { error: msg }, 500);
  }
});
