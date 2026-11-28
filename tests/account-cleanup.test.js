const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Fitur admin "last change": hapus otomatis akun dormant +
// NOTIFIKASI IN-APP khusus admin (worker Edge Function).
//
// Jalur email Resend DIBATALKAN 2026-11-28 — peringatan H-1 dan
// konfirmasi hapus kini ditulis edge function ke tabel
// admin_notifications dan hanya dibaca admin di panel admin.
// Tes ini mengunci penghapusan jalur Resend: tidak ada lagi
// referensi Resend di logic.ts maupun index.ts.
//
// logic.ts adalah TypeScript murni tanpa import dan tanpa Deno —
// sintaksnya erasable saja sehingga `node --test` bisa me-require()
// langsung (Node >= 22.18 type stripping) dan logika diuji apa adanya,
// bukan lewat fixture. index.ts (Deno.serve + wiring Supabase /
// notifikasi in-app) dan schedule.sql diuji lewat assertion isi
// file, mengikuti gaya guard-test repo (tests/wave2-cron.test.js).
//
// Semua tanggal di tes ini memakai offset +07:00 eksplisit supaya
// perilakunya sama di TZ=Asia/Jakarta maupun TZ=UTC: yang diuji
// adalah hari KALENDER WIB, bukan zona waktu proses.

const logic = require('../supabase/functions/account-cleanup/logic.ts');
const {
  APP_TIMEZONE, WARNING_DAY, DELETE_DAY,
  lastChangeAt, daysInactive, deletionDate, nextDayDate, formatTanggalId,
  classifyUser, selectCandidates, warningNotification, deletionNotification,
} = logic;
const indexTs = fs.readFileSync('supabase/functions/account-cleanup/index.ts', 'utf8');
const logicTs = fs.readFileSync('supabase/functions/account-cleanup/logic.ts', 'utf8');
const scheduleSql = fs.readFileSync('supabase/schedule.sql', 'utf8');

// --- Helper ----------------------------------------------------------------

function user(overrides = {}) {
  return {
    id: 'user-1',
    email: 'pengguna@contoh.id',
    role: 'user',
    status: 'active',
    created_at: '2026-11-01T00:00:00Z',
    last_activity_at: null,
    last_sign_in_at: null,
    deletion_warning_sent_at: null,
    ...overrides,
  };
}

/** "Sekarang" beku: Sabtu 28 Nov 2026, 00:30 WIB. */
const NOW_WIB_0030 = new Date('2026-11-28T00:30:00+07:00');

// --- Ambang & seleksi kandidat ---------------------------------------------

test('cleanup: ambang peringatan hari ke-6; hapus hari ke-7 hanya bila sudah diperingatkan', () => {
  assert.equal(APP_TIMEZONE, 'Asia/Jakarta');
  assert.equal(WARNING_DAY, 6);
  assert.equal(DELETE_DAY, 7);

  // Terakhir aktif 22 Nov 2026 10:00 WIB -> 6 hari kalender WIB.
  const warn = user({ last_activity_at: '2026-11-22T10:00:00+07:00' });
  const cWarn = classifyUser(warn, NOW_WIB_0030);
  assert.equal(cWarn.action, 'warn');
  assert.equal(cWarn.daysInactive, 6);

  // Terakhir aktif 21 Nov 2026 10:00 WIB -> 7 hari kalender WIB.
  // BELUM pernah diperingatkan -> peringatan TERLAMBAT ('warn'),
  // BUKAN 'delete': tidak ada yang dihapus tanpa pernah diperingatkan.
  const del = user({ last_activity_at: '2026-11-21T10:00:00+07:00' });
  const cDel = classifyUser(del, NOW_WIB_0030);
  assert.equal(cDel.action, 'warn');
  assert.equal(cDel.daysInactive, 7);
  assert.equal(cDel.reason, 'tidak-aktif-7-hari-belum-diperingatkan');

  // Terakhir aktif 23 Nov 2026 -> 5 hari: masih aktif, dilewati.
  const active = user({ last_activity_at: '2026-11-23T10:00:00+07:00' });
  assert.equal(classifyUser(active, NOW_WIB_0030).action, 'skip');
});

test('cleanup: perubahan terakhir = yang paling baru dari login / perubahan data / dibuat', () => {
  // Login (25 Nov) lebih baru dari perubahan data (20 Nov) -> pakai login: 3 hari.
  const u = user({
    last_activity_at: '2026-11-20T10:00:00+07:00',
    last_sign_in_at: '2026-11-25T10:00:00+07:00',
  });
  assert.equal(lastChangeAt(u).toISOString(), '2026-11-25T03:00:00.000Z');
  assert.equal(classifyUser(u, NOW_WIB_0030).action, 'skip');

  // Sebaliknya: perubahan data (25 Nov) lebih baru dari login (20 Nov).
  const u2 = user({
    last_activity_at: '2026-11-25T10:00:00+07:00',
    last_sign_in_at: '2026-11-20T10:00:00+07:00',
  });
  assert.equal(lastChangeAt(u2).toISOString(), '2026-11-25T03:00:00.000Z');

  // Tanpa login maupun perubahan data: fallback ke created_at.
  // Hari ke-7 tanpa peringatan -> peringatan terlambat, bukan hapus.
  const u3 = user({ created_at: '2026-11-21T10:00:00+07:00' });
  assert.equal(classifyUser(u3, NOW_WIB_0030).action, 'warn');

  // Tanpa satu pun tanggal: jangan ditebak — skip, jangan hapus.
  const u4 = user({ created_at: null });
  const c4 = classifyUser(u4, NOW_WIB_0030);
  assert.equal(c4.action, 'skip');
  assert.equal(c4.reason, 'tanggal-perubahan-tidak-diketahui');
});

test('cleanup: admin dan suspended DIKECUALIKAN walau sudah 7+ hari tidak aktif', () => {
  const admin = user({
    role: 'admin',
    last_activity_at: '2026-11-01T10:00:00+07:00',
  });
  const cAdmin = classifyUser(admin, NOW_WIB_0030);
  assert.equal(cAdmin.action, 'skip');
  assert.equal(cAdmin.reason, 'admin-dikecualikan');

  const suspended = user({
    status: 'suspended',
    last_activity_at: '2026-11-01T10:00:00+07:00',
  });
  const cSusp = classifyUser(suspended, NOW_WIB_0030);
  assert.equal(cSusp.action, 'skip');
  assert.equal(cSusp.reason, 'status-bukan-active');

  // Admin yang dormant pun tidak masuk daftar hapus.
  const sel = selectCandidates([admin, suspended], NOW_WIB_0030);
  assert.deepEqual(sel.delete, []);
  assert.deepEqual(sel.warn, []);
  assert.equal(sel.skipped, 2);
});

test('cleanup: tidak ada peringatan ganda — yang sudah diperingatkan dilewati sampai hari ke-7', () => {
  const warned = user({
    last_activity_at: '2026-11-22T10:00:00+07:00',
    deletion_warning_sent_at: '2026-11-27T10:00:00+07:00',
  });
  const c = classifyUser(warned, NOW_WIB_0030);
  assert.equal(c.action, 'skip');
  assert.equal(c.reason, 'sudah-diperingatkan');

  // Hari ke-7: flag peringatan tidak lagi menahan penghapusan.
  const warnedDay7 = user({
    last_activity_at: '2026-11-21T10:00:00+07:00',
    deletion_warning_sent_at: '2026-11-27T10:00:00+07:00',
  });
  assert.equal(classifyUser(warnedDay7, NOW_WIB_0030).action, 'delete');
});

test('cleanup: tidak ada yang dihapus tanpa pernah diperingatkan (fail-closed)', () => {
  // Hari ke-7 dan ke-27 TANPA peringatan -> peringatan terlambat, bukan hapus.
  const d7 = user({ last_activity_at: '2026-11-21T10:00:00+07:00' });
  assert.equal(classifyUser(d7, NOW_WIB_0030).action, 'warn');
  const d27 = user({ last_activity_at: '2026-11-01T10:00:00+07:00' });
  assert.equal(classifyUser(d27, NOW_WIB_0030).action, 'warn');
  assert.equal(classifyUser(d27, NOW_WIB_0030).reason, 'tidak-aktif-7-hari-belum-diperingatkan');

  // Hari ke-7 DENGAN peringatan terkirim -> hapus (satu-satunya jalan ke 'delete').
  const d7warned = user({
    last_activity_at: '2026-11-21T10:00:00+07:00',
    deletion_warning_sent_at: '2026-11-27T10:00:00+07:00',
  });
  assert.equal(classifyUser(d7warned, NOW_WIB_0030).action, 'delete');

  // Konsekuensi fail-closed: bila insert notifikasi gagal total
  // (tidak ada flag peringatan yang pernah diset),
  // selectCandidates tidak menghapus siapa pun.
  const sel = selectCandidates([d7, d27], NOW_WIB_0030);
  assert.deepEqual(sel.delete, []);
  assert.equal(sel.warn.length, 2);
});

test('cleanup: selectCandidates memisahkan warn / delete / skipped', () => {
  const users = [
    user({ id: 'w1', last_activity_at: '2026-11-22T10:00:00+07:00' }),
    user({ id: 'd1', last_activity_at: '2026-11-21T10:00:00+07:00' }),
    user({ id: 'd2', last_activity_at: '2026-11-01T10:00:00+07:00' }),
    user({
      id: 'd3', last_activity_at: '2026-11-21T10:00:00+07:00',
      deletion_warning_sent_at: '2026-11-27T10:00:00+07:00',
    }),
    user({ id: 'a1', last_activity_at: '2026-11-27T10:00:00+07:00' }),
    user({ id: 'admin', role: 'admin', last_activity_at: '2026-11-01T10:00:00+07:00' }),
  ];
  const sel = selectCandidates(users, NOW_WIB_0030);
  // d1/d2 hari ke-7+ TANPA peringatan -> peringatan terlambat ('warn').
  assert.deepEqual(sel.warn.map((u) => u.id), ['w1', 'd1', 'd2']);
  // Hanya d3 (sudah diperingatkan) yang masuk 'delete'.
  assert.deepEqual(sel.delete.map((u) => u.id), ['d3']);
  assert.equal(sel.skipped, 2);
});

// --- Batas hari di WIB (tengah malam WIB, bukan UTC) ------------------------

test('cleanup: batas hari berganti tepat tengah malam WIB', () => {
  // Sekarang 28 Nov 00:30 WIB. Terakhir aktif 21 Nov 23:30 WIB:
  // selisih mentah baru ~6 hari 1 jam, tapi hari KALENDER WIB sudah 7
  // (21 -> 28). Tanpa peringatan -> 'warn' terlambat (bukan hapus).
  // Hitungan 24-jam mentah akan salah memberi 'warn' hari ke-6.
  const u = user({ last_activity_at: '2026-11-21T23:30:00+07:00' });
  assert.equal(daysInactive(lastChangeAt(u), NOW_WIB_0030), 7);
  assert.equal(classifyUser(u, NOW_WIB_0030).action, 'warn');
  assert.equal(classifyUser(u, NOW_WIB_0030).reason, 'tidak-aktif-7-hari-belum-diperingatkan');

  // Terakhir aktif 22 Nov 00:30 WIB -> 6 hari kalender WIB -> 'warn',
  // walau selisih mentahnya hampir 6 hari penuh.
  const u2 = user({ last_activity_at: '2026-11-22T00:30:00+07:00' });
  assert.equal(daysInactive(lastChangeAt(u2), NOW_WIB_0030), 6);
  assert.equal(classifyUser(u2, NOW_WIB_0030).action, 'warn');

  // Jebakan UTC: 21 Nov 16:00 UTC = 21 Nov 23:00 WIB. Hitungan
  // kalender UTC akan memberi 21 -> 27 = 6 hari (warn hari ke-6),
  // padahal di WIB sudah 21 -> 28 = 7 hari (warn terlambat).
  const u3 = user({ last_activity_at: '2026-11-21T16:00:00Z' });
  assert.equal(daysInactive(lastChangeAt(u3), NOW_WIB_0030), 7);
  assert.equal(classifyUser(u3, NOW_WIB_0030).action, 'warn');

  // Satu menit sebelum tengah malam WIB masih hari sebelumnya:
  // 27 Nov 23:59 WIB, terakhir aktif 21 Nov 10:00 WIB -> 6 hari.
  const beforeMidnight = new Date('2026-11-27T23:59:00+07:00');
  const u4 = user({ last_activity_at: '2026-11-21T10:00:00+07:00' });
  assert.equal(daysInactive(lastChangeAt(u4), beforeMidnight), 6);
  assert.equal(classifyUser(u4, beforeMidnight).action, 'warn');
});

test('cleanup: tanggal penghapusan = perubahan terakhir + 7 hari, format Indonesia', () => {
  const last = new Date('2026-11-21T10:00:00+07:00');
  assert.equal(formatTanggalId(deletionDate(last)), '28 November 2026');
  assert.equal(formatTanggalId(last), '21 November 2026');
});

// --- Isi notifikasi in-app ------------------------------------------------

test('cleanup: notifikasi peringatan H-1 — type, judul, tanggal hapus, cara mempertahankan akun', () => {
  const u = user({ last_activity_at: '2026-11-22T10:00:00+07:00' });
  const last = lastChangeAt(u);
  const notif = warningNotification(u, last, 6, deletionDate(last));

  assert.equal(notif.type, 'deletion_warning');
  assert.equal(notif.title, 'Akun pengguna@contoh.id akan dihapus besok');

  // Tanggal terakhir aktif + tanggal penghapusan (last + 7 hari = 29 Nov).
  assert.match(notif.body, /22 November 2026/);
  assert.match(notif.body, /29 November 2026/);
  assert.match(notif.body, /6 hari/);
  assert.match(notif.body, /tidak bisa dikembalikan/);
  // Cara mempertahankan akun: buka aplikasi / lakukan perubahan sebelum tanggal itu.
  assert.match(notif.body, /membuka aplikasi MyKeuGuech dan melakukan perubahan apa pun sebelum 29 November 2026/);
  assert.match(notif.body, /Login saja sudah cukup untuk membatalkan penghapusan ini/);
  // Notifikasi ditujukan ke admin: menyebut email target.
  assert.ok(notif.body.includes('pengguna@contoh.id'));
  assert.ok(notif.title.length > 10 && notif.body.length > 100);
});

test('cleanup: notifikasi konfirmasi sesudah hapus — type, alasan 7 hari, tidak bisa dipulihkan', () => {
  const u = user({ last_activity_at: '2026-11-21T10:00:00+07:00' });
  const notif = deletionNotification(u, lastChangeAt(u));

  assert.equal(notif.type, 'deletion_done');
  assert.equal(notif.title, 'Akun pengguna@contoh.id sudah dihapus');
  assert.match(notif.body, /sudah dihapus otomatis/);
  assert.match(notif.body, /7 hari/);
  assert.match(notif.body, /21 November 2026/);
  assert.match(notif.body, /tidak bisa dikembalikan/);
  assert.match(notif.body, /tidak bisa dipulihkan/);
  assert.ok(notif.body.includes('pengguna@contoh.id'));
});

test('cleanup: notifikasi peringatan TERLAMBAT — jumlah hari dan tanggal hapus jujur (bukan tanggal lewat)', () => {
  // Pengguna sudah 8 hari tidak aktif dan belum pernah diperingatkan:
  // notifikasi harus menyebut "8 hari" dan tanggal hapus = run besok
  // (29 Nov), BUKAN last+7 (= 28 Nov, sudah lewat hari ini).
  const u = user({ last_activity_at: '2026-11-20T10:00:00+07:00' });
  const last = lastChangeAt(u);
  const notif = warningNotification(u, last, 8, nextDayDate(NOW_WIB_0030));
  assert.equal(notif.type, 'deletion_warning');
  assert.match(notif.body, /8 hari/);
  assert.match(notif.body, /29 November 2026/);
  assert.doesNotMatch(notif.body, /28 November 2026/);
  assert.match(notif.body, /20 November 2026/);
});

// --- Guard: logic.ts murni (tanpa Deno / secret / Resend) ------------------

test('cleanup: logic.ts murni — tanpa Deno, tanpa env, tanpa Resend', () => {
  assert.doesNotMatch(logicTs, /Deno\./);
  assert.doesNotMatch(logicTs, /process\.env/);
  assert.doesNotMatch(logicTs, /RESEND_API_KEY/);
  assert.doesNotMatch(logicTs, /@resend\.dev/);
  // Jalur email Resend sudah dihapus total: tidak ada lagi nama
  // Resend, URL API-nya, atau pembangun email/payload-nya.
  assert.doesNotMatch(logicTs, /RESEND/i);
  assert.doesNotMatch(logicTs, /resend/i);
  assert.doesNotMatch(logicTs, /api\.resend\.com/);
  assert.doesNotMatch(logicTs, /warningEmail|deletionEmail|buildResendPayload/);
  assert.doesNotMatch(logicTs, /CleanupEmail/);
  // Penggantinya: pembangun notifikasi in-app.
  assert.match(logicTs, /export function warningNotification\(/);
  assert.match(logicTs, /export function deletionNotification\(/);
  assert.match(logicTs, /export interface AdminNotification/);
  assert.match(logicTs, /type: 'deletion_warning' \| 'deletion_done'/);
  assert.match(logicTs, /export const APP_TIMEZONE = 'Asia\/Jakarta';/);
});

// --- Guard: index.ts (wiring) ----------------------------------------------

test('cleanup: index.ts menolak method bukan POST dan secret cron yang salah', () => {
  assert.match(indexTs, /if \(req\.method !== 'POST'\) return jsonResponse\(req, \{ error: 'Method not allowed\.' \}, 405\);/);
  assert.match(indexTs, /await safeEqual\(req\.headers\.get\('x-cron-secret'\) \?\? '', cronSecret\)/);
  assert.match(indexTs, /return jsonResponse\(req, \{ error: 'forbidden' \}, 403\);/);
  // Tanpa CRON_SECRET yang dikonfigurasi -> 500 (bukan lolos diam-diam).
  assert.match(indexTs, /if \(!cronSecret\) \{/);
  // safeEqual timing-safe: bandingkan hash SHA-256, bukan === mentah.
  assert.match(indexTs, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(indexTs, /diff \|= va\[i\] \^ vb\[i\];/);
});

test('cleanup: index.ts memakai supabase-js versi yang sama dengan telegram-bot', () => {
  assert.match(indexTs, /from 'npm:@supabase\/supabase-js@2\.45\.4';/);
  assert.match(indexTs, /from '\.\/logic\.ts';/);
});

test('cleanup: index.ts mengambil profiles + last_sign_in_at (paginasi) lalu menggabungkan', () => {
  assert.match(indexTs, /\.from\('profiles'\)/);
  assert.match(indexTs, /select\('id,email,role,status,created_at,last_activity_at,deletion_warning_sent_at'\)/);
  assert.match(indexTs, /auth\.admin\.listUsers\(\{ page, perPage: PAGE_SIZE \}\)/);
  assert.match(indexTs, /last_sign_in_at: signIns\.get\(p\.id\) \?\? null/);
  assert.match(indexTs, /selectCandidates\(users, now\)/);
});

test('cleanup: index.ts mencabut webhook bot personal lalu deleteUser, notifikasi konfirmasi sesudah hapus', () => {
  // Urutan: revoke webhook -> deleteUser -> tulis notifikasi konfirmasi.
  const revokeIdx = indexTs.indexOf('await revokeBotWebhook(user.id);');
  const deleteIdx = indexTs.indexOf('auth.admin.deleteUser(user.id)');
  const notifIdx = indexTs.indexOf('deletionNotification(user, lastChange)');
  assert.ok(revokeIdx > 0 && deleteIdx > 0 && notifIdx > 0, 'revoke, delete, notifikasi harus ada');
  assert.ok(revokeIdx < deleteIdx && deleteIdx < notifIdx, 'urutan: cabut webhook -> hapus -> notifikasi konfirmasi');
  // Notifikasi konfirmasi memakai insertAdminNotification; gagal
  // menulis dicatat tapi TIDAK membatalkan penghapusan.
  assert.match(indexTs, /insertAdminNotification\(\s*getAdminClient\(\), user,\s*deletionNotification\(user, lastChange\),?\s*\)/);
  assert.match(indexTs, /konfirmasi-hapus \$\{user\.id\}: \$\{made\.error \?\? 'gagal-tulis-notifikasi'\}/);
  // Idempotent: user yang sudah tidak ada dilewati, bukan error.
  assert.match(indexTs, /\/not found\|user not found\|no user\/i\.test\(deleteErr\.message\)/);
  // Dekripsi bot memakai pola yang sama dengan delete-account (AES-GCM + SHA-256).
  assert.match(indexTs, /decryptBotToken\(botRow\.token_iv, botRow\.token_encrypted\)/);
  assert.match(indexTs, /deleteWebhook/);
  assert.match(indexTs, /AbortSignal\.timeout\(10000\)/);
});

test('cleanup: index.ts TIDAK lagi memakai Resend — peringatan via notifikasi in-app', () => {
  // Tidak ada lagi pembacaan secret Resend atau fetch ke Resend.
  assert.doesNotMatch(indexTs, /RESEND_API_KEY/);
  assert.doesNotMatch(indexTs, /RESEND_FROM_EMAIL/);
  assert.doesNotMatch(indexTs, /RESEND_API_URL|api\.resend\.com/);
  assert.doesNotMatch(indexTs, /sendResendEmail|warningEmail|deletionEmail|buildResendPayload/);
  assert.doesNotMatch(indexTs, /emails_sent|emailsSent/);
  // Penggantinya: insert ke admin_notifications via insertAdminNotification.
  assert.match(indexTs, /async function insertAdminNotification\(/);
  assert.match(indexTs, /\.from\('admin_notifications'\)\.insert\(\{/);
  assert.match(indexTs, /type: notif\.type,/);
  assert.match(indexTs, /target_user_id: user\.id,/);
  assert.match(indexTs, /target_email: user\.email,/);
  // Insert gagal -> { ok: false } (fail-closed, bukan lanjut diam-diam).
  assert.match(indexTs, /return \{ ok: false, error: error\.message \};/);
  // Tidak ada console.log (hanya console.error untuk pesan singkat).
  assert.doesNotMatch(indexTs, /console\.log\(/);
  // Flag peringatan HANYA diset bila notifikasi tertulis.
  const notifIdx = indexTs.indexOf('warningNotification(user, lastChange, c.daysInactive, delDate)');
  const flagIdx = indexTs.indexOf('deletion_warning_sent_at: now.toISOString()');
  assert.ok(notifIdx > 0 && flagIdx > 0 && notifIdx < flagIdx, 'tulis notifikasi dulu, baru set flag');
  assert.match(indexTs, /if \(!made\.ok\) \{[\s\S]*?continue; \/\/ jangan set flag/);
  // Invariant fail-closed: penghapusan mensyaratkan peringatan dibuat.
  assert.match(indexTs, /tidak-aktif-7-hari-belum-diperingatkan/);
  assert.match(indexTs, /nextDayDate\(now\)/);
});

test('cleanup: index.ts mencatat run ke cron_job_runs seperti telegram-bot', () => {
  assert.match(indexTs, /getAdminClient\(\)\.from\('cron_job_runs'\)\.insert\(/);
  assert.match(indexTs, /job, invoked_by: invokedBy, started_at: .*?, status: 'running'/);
  assert.match(indexTs, /getAdminClient\(\)\.from\('cron_job_runs'\)\.update\(/);
  assert.match(indexTs, /created_count: counts\.created/);
  assert.match(indexTs, /notified_count: counts\.notified/);
  assert.match(indexTs, /skipped_count: counts\.skipped/);
  assert.match(indexTs, /logJobRunStart\('account-cleanup', 'cron'\)/);
  // created = akun dihapus, notified = notifikasi in-app dibuat.
  assert.match(indexTs, /\{ created: deleted, notified: notificationsSent, skipped \}/);
  // Response JSON memakai nama field baru (bukan emails_sent).
  assert.match(indexTs, /notifications_sent: notificationsSent,/);
  assert.doesNotMatch(indexTs, /emails_sent|emailsSent/);
});

test('cleanup: index.ts CORS fail-closed seperti delete-account', () => {
  assert.match(indexTs, /filter\(\(s\) => s && s !== '\*'\)/);
  assert.match(indexTs, /const DEFAULT_ALLOWED_ORIGIN = 'https:\/\/liandimiko\.github\.io';/);
});

// --- Guard: schedule.sql -----------------------------------------------------

test('cleanup: schedule.sql menambah mk-account-cleanup harian 02:00 WIB dari Vault', () => {
  assert.ok(scheduleSql.includes("cron.unschedule('mk-account-cleanup')"), 'job lama di-unschedule dulu');
  assert.match(scheduleSql, /cron\.schedule\('mk-account-cleanup', '0 19 \* \* \*'/);
  assert.match(scheduleSql, /functions\/v1\/account-cleanup/);
  assert.match(scheduleSql, /'x-cron-secret', \(select decrypted_secret from vault\.decrypted_secrets where name = 'cron_secret'\)/);
  // Placeholder <PROJECT_REF> TIDAK diganti nilai asli.
  assert.match(scheduleSql, /https:\/\/<PROJECT_REF>\.supabase\.co\/functions\/v1\/account-cleanup/);
  assert.doesNotMatch(scheduleSql, /usauytablxbiktnepwsi/);
  // 4 job lama tidak berubah.
  for (const [name, expr] of [
    ['mk-daily-reminder', '0 14 * * *'],
    ['mk-weekly-report', '0 13 * * 0'],
    ['mk-recurring', '0 18 * * *'],
    ['mk-snapshot', '0 16 * * *'],
  ]) {
    assert.ok(scheduleSql.includes(`cron.schedule('${name}', '${expr}'`), `job lama ${name} harus tetap ada`);
  }
});

test('cleanup: schedule.sql menambah mk-webauthn-purge harian 03:00 WIB (panggil SQL langsung, tanpa HTTP/secret)', () => {
  // Penutup keputusan purge yang tertunda sejak PR #16 (Gelombang 7c Item 3):
  // tantangan WebAuthn kedaluwarsa dibersihkan pg_cron langsung — fungsinya
  // sudah SECURITY DEFINER + EXECUTE hanya service_role, jadi tidak butuh
  // edge function, CRON_SECRET, atau Vault.
  assert.ok(scheduleSql.includes("cron.unschedule('mk-webauthn-purge')"), 'job lama di-unschedule dulu (terjaga)');
  assert.match(
    scheduleSql,
    /cron\.schedule\('mk-webauthn-purge', '0 20 \* \* \*', \$\$\n\s*select public\.purge_expired_webauthn_challenges\(\);/,
    'job harian 03:00 WIB memanggil fungsi purge langsung',
  );
  // Tidak ada HTTP hop untuk job ini: tidak ada net.http_post di antara
  // schedule mk-webauthn-purge dan penutup $$); berikutnya.
  const purgeBlock = scheduleSql.slice(scheduleSql.indexOf("cron.schedule('mk-webauthn-purge'"));
  const purgeStmt = purgeBlock.slice(0, purgeBlock.indexOf('$$);'));
  assert.doesNotMatch(purgeStmt, /net\.http_post/, 'purge tidak boleh lewat HTTP');
  assert.doesNotMatch(purgeStmt, /cron_secret/, 'purge tidak boleh memakai CRON_SECRET');
  // 5 job lama tidak berubah.
  for (const [name, expr] of [
    ['mk-daily-reminder', '0 14 * * *'],
    ['mk-weekly-report', '0 13 * * 0'],
    ['mk-recurring', '0 18 * * *'],
    ['mk-snapshot', '0 16 * * *'],
    ['mk-account-cleanup', '0 19 * * *'],
  ]) {
    assert.ok(scheduleSql.includes(`cron.schedule('${name}', '${expr}'`), `job lama ${name} harus tetap ada`);
  }
});

test('cleanup: schedule.sql meng-guard unschedule — job yang belum ada tidak boleh error', () => {
  // Bukti 2026-11-28: cron.unschedule('mk-account-cleanup') tanpa guard
  // gagal XX000 "could not find valid entry for job" karena job itu
  // belum pernah dijadwalkan; run schedule.sql pun berhenti di situ.
  // Setiap unschedule harus dijaga where exists (cron.job).
  for (const name of [
    'mk-daily-reminder',
    'mk-weekly-report',
    'mk-recurring',
    'mk-snapshot',
    'mk-account-cleanup',
    'mk-webauthn-purge',
  ]) {
    assert.ok(
      scheduleSql.includes(
        `cron.unschedule('${name}') where exists (select 1 from cron.job where jobname = '${name}')`,
      ),
      `unschedule ${name} harus dijaga where exists (cron.job)`,
    );
  }
  // Tidak boleh ada lagi unschedule telanjang (tanpa where exists).
  // Baris komentar (contoh di akhir file) dikecualikan.
  const bare = scheduleSql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'))
    .filter((line) => /cron\.unschedule\('[^']+'\);?\s*$/.test(line));
  assert.deepEqual(bare, [], 'tidak boleh ada cron.unschedule tanpa guard');
  // Komentar lama yang salah ("tidak error, mengembalikan false") harus sudah diperbaiki.
  assert.doesNotMatch(scheduleSql, /tidak error \(mengembalikan false\)/);
});
