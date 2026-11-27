const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');

const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
const coreTs = fs.readFileSync('supabase/functions/telegram-bot/core.ts', 'utf8');
const indexTs = fs.readFileSync('supabase/functions/telegram-bot/index.ts', 'utf8');
const jobsTs = fs.readFileSync('supabase/functions/telegram-bot/jobs.ts', 'utf8');
const commandsTs = fs.readFileSync('supabase/functions/telegram-bot/commands.ts', 'utf8');
const walletsTs = fs.readFileSync('supabase/functions/telegram-bot/wallets.ts', 'utf8');
const aiTs = fs.readFileSync('supabase/functions/telegram-bot/ai.ts', 'utf8');
const planningTs = fs.readFileSync('supabase/functions/telegram-bot/planning.ts', 'utf8');
const setupTs = fs.readFileSync('supabase/functions/telegram-setup/index.ts', 'utf8');
const adminOpsTs = fs.readFileSync('supabase/functions/admin-user-ops/index.ts', 'utf8');
const deleteAccountTs = fs.readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
const migrationSql = fs.readFileSync('supabase/migrations/20261128030000_wave2_personal_telegram_bots.sql', 'utf8');

// Objek yang dibuat di dalam vm context punya prototype berbeda, jadi
// deepStrictEqual lintas-realm gagal — bandingkan lewat JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  const storage = {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null
  };
  Object.defineProperty(storage, 'length', { get: () => map.size });
  return storage;
}

/* ============================================================
   Klien — handler bot personal (web/supabase-admin.js)
   ============================================================ */

function loadAdminClient({ statusConnected = true } = {}) {
  const invokeCalls = [];
  const rpcCalls = [];
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const core = {
    handlers: {},
    sb: {
      functions: {
        invoke: async (fnName, { body } = {}) => {
          invokeCalls.push({ fnName, body: plain(body || {}) });
          if (fnName === 'telegram-setup' && body && body.action === 'get_status') {
            return {
              data: statusConnected
                ? { success: true, connected: true, bot_username: 'mykeu_test_bot', bot_user_id: 123456789, created_at: '2026-11-28T00:00:00.000Z' }
                : { success: true, connected: false },
              error: null
            };
          }
          if (fnName === 'telegram-setup' && body && body.action === 'connect_bot') {
            return { data: { success: true, bot_username: 'mykeu_test_bot', bot_user_id: 123456789 }, error: null };
          }
          return { data: { success: true }, error: null };
        }
      },
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' } }, error: null }),
        signInWithPassword: async () => ({ data: { user: { id: 'u1' } }, error: null }),
        updateUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
        signOut: async () => ({ error: null })
      },
      from: () => { throw new Error('direct table access must not happen here'); },
      rpc: async (fnName, args) => {
        rpcCalls.push({ fnName, args: plain(args || {}) });
        return { data: null, error: null };
      }
    },
    fail: (error) => { if (error) throw error; },
    fetchAll: async () => [],
    setSetting: async () => {}
  };
  const sandbox = {
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    localStorage,
    sessionStorage,
    __mkSb: core,
    sessionRole: 'user'
  };
  sandbox.window = sandbox;
  vm.runInNewContext(adminJs, sandbox);
  return { core, invokeCalls, rpcCalls, localStorage, sessionStorage };
}

const TEST_TOKEN = '123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4yB5r6';

test('2.2: connect bot mengirim token SEKALI ke telegram-setup, tidak pernah disimpan lokal', async () => {
  const { core, invokeCalls, localStorage, sessionStorage } = loadAdminClient();
  const res = await core.handlers.api_connectTelegramBot(TEST_TOKEN);
  assert.equal(res.bot_username, 'mykeu_test_bot');
  const connectCalls = invokeCalls.filter((c) => c.fnName === 'telegram-setup' && c.body.action === 'connect_bot');
  assert.equal(connectCalls.length, 1, 'token harus dikirim tepat sekali ke telegram-setup');
  assert.equal(connectCalls[0].body.token, TEST_TOKEN);
  const allStored = [...localStorage._map.values(), ...sessionStorage._map.values()].join('\n');
  assert.ok(!allStored.includes(TEST_TOKEN), 'token bot tidak boleh tersimpan di localStorage/sessionStorage');
  assert.ok(!allStored.includes('123456789:AAE'), 'tidak boleh ada potongan token yang tersimpan');
});

test('2.2: token berformat salah ditolak di klien (tanpa memanggil server)', async () => {
  const { core, invokeCalls } = loadAdminClient();
  await assert.rejects(() => core.handlers.api_connectTelegramBot('bukan-token'), /Format token tidak valid/);
  await assert.rejects(() => core.handlers.api_connectTelegramBot(''), /Tempel token bot/);
  assert.equal(invokeCalls.length, 0, 'token salah tidak boleh sampai ke server');
});

test('2.2: get_status mengembalikan username bot tanpa token', async () => {
  const { core, invokeCalls } = loadAdminClient({ statusConnected: true });
  const res = await core.handlers.api_getTelegramBotStatus();
  assert.equal(res.connected, true);
  assert.equal(res.bot_username, 'mykeu_test_bot');
  assert.ok(!('token' in res) && !('token_encrypted' in res), 'status tidak boleh membawa token');
  assert.equal(invokeCalls.filter((c) => c.body.action === 'get_status').length, 1);
});

test('2.2: get_status saat belum terhubung -> connected false', async () => {
  const { core } = loadAdminClient({ statusConnected: false });
  const res = await core.handlers.api_getTelegramBotStatus();
  assert.equal(res.connected, false);
});

test('2.2: disconnect + rotate memanggil aksi yang benar di telegram-setup', async () => {
  const { core, invokeCalls } = loadAdminClient();
  await core.handlers.api_disconnectTelegramBot();
  await core.handlers.api_rotateTelegramBotWebhook();
  assert.ok(invokeCalls.some((c) => c.fnName === 'telegram-setup' && c.body.action === 'disconnect_bot'));
  assert.ok(invokeCalls.some((c) => c.fnName === 'telegram-setup' && c.body.action === 'rotate_webhook'));
});

test('2.2: OTP pairing tetap lewat RPC replace_telegram_pairing (8 digit)', async () => {
  const { core, rpcCalls } = loadAdminClient();
  const otp = await core.handlers.api_generateTelegramOTP();
  assert.match(otp, /^\d{8}$/);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fnName, 'replace_telegram_pairing');
  assert.equal(rpcCalls[0].args.p_otp, otp);
});

/* ============================================================
   OTP hash — konsistensi SHA-256 antara SQL (pgcrypto) dan Deno
   ============================================================ */

test('2.2: hash OTP SHA-256 hex konsisten (pgcrypto digest == WebCrypto)', async () => {
  // Nilai ini adalah SHA-256('12345678') — sama yang dihasilkan
  // encode(digest('12345678','sha256'),'hex') di Postgres dan
  // crypto.subtle.digest di Deno (lihat sha256Hex di core.ts).
  const expected = 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f';
  assert.equal(createHash('sha256').update('12345678').digest('hex'), expected);
  const buf = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('12345678'));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, expected, 'WebCrypto (dipakai webhook) harus sama dengan pgcrypto (dipakai RPC)');
  assert.ok(migrationSql.includes("encode(digest(p_otp, 'sha256'), 'hex')"), 'migrasi harus meng-hash OTP dengan pgcrypto SHA-256');
});

test('2.2: migrasi menyimpan otp_hash, menghapus kolom otp plaintext', () => {
  assert.ok(migrationSql.includes('otp_hash'), 'kolom otp_hash harus ada');
  assert.ok(/drop column if exists otp/i.test(migrationSql), 'kolom otp plaintext harus dihapus');
  assert.ok(migrationSql.includes('add primary key (otp_hash)'), 'otp_hash menjadi primary key');
  assert.ok(!/\.eq\('otp',/.test(indexTs), 'webhook tidak boleh lagi mencari OTP plaintext');
  assert.ok(indexTs.includes(".eq('otp_hash', otpHash)"), 'webhook mencari berdasarkan hash OTP');
});

/* ============================================================
   Migrasi — telegram_bots, RLS, dedup per bot, unlink
   ============================================================ */

test('2.2: tabel telegram_bots terenkripsi + RLS tanpa akses klien', () => {
  for (const col of ['user_id', 'bot_username', 'bot_user_id', 'token_encrypted', 'token_iv', 'webhook_secret', 'link_secret']) {
    assert.ok(migrationSql.includes(col), `kolom ${col} harus ada di telegram_bots`);
  }
  assert.ok(migrationSql.includes('enable row level security'), 'RLS harus aktif di telegram_bots');
  assert.ok(migrationSql.includes('revoke all on public.telegram_bots from public, anon, authenticated'), 'klien tidak boleh punya hak apa pun di telegram_bots');
  assert.ok(!/create policy[^\n]*telegram_bots/i.test(migrationSql), 'tidak boleh ada policy yang memberi akses klien ke telegram_bots');
  assert.ok(migrationSql.includes('on delete cascade'), 'hapus akun harus ikut menghapus baris bot');
});

test('2.2: telegram_chats hanya bisa dibaca baris sendiri; pairings tanpa akses klien', () => {
  assert.ok(/drop policy if exists "own rows" on public\.telegram_chats/i.test(migrationSql));
  assert.ok(/create policy "users_read_own_chats" on public\.telegram_chats\s+for select to authenticated/i.test(migrationSql),
    'policy baru telegram_chats harus SELECT-only');
  assert.ok(migrationSql.includes('revoke insert, update, delete on public.telegram_chats from authenticated'),
    'tulis langsung telegram_chats dari klien harus dicabut');
  assert.ok(/drop policy if exists "users_manage_own_pairings" on public\.telegram_pairings/i.test(migrationSql));
  assert.ok(migrationSql.includes('revoke all on public.telegram_pairings from authenticated'));
});

test('2.2: dedup update_id per bot + admin_unlink ikut hapus bot', () => {
  assert.ok(migrationSql.includes('add column if not exists bot_user_id bigint not null default 0'),
    'telegram_updates harus punya bot_user_id');
  assert.ok(migrationSql.includes('add primary key (bot_user_id, update_id)'),
    'dedup webhook harus per bot, bukan global');
  assert.ok(migrationSql.includes('delete from public.telegram_bots where user_id = p_target_user_id'),
    'admin_unlink_user_telegram harus ikut menghapus baris bot');
  assert.ok(indexTs.includes("insert({ update_id: update.update_id, bot_user_id: requestBotId })"),
    'webhook menulis dedup dengan bot_user_id');
});

/* ============================================================
   Webhook — token per pengguna, OTP terikat user, secret terpisah
   ============================================================ */

test('2.2: pairing OTP terikat ke pemilik bot (T7) — lookup difilter user_id', () => {
  assert.ok(indexTs.includes("if (knownUid) q = q.eq('user_id', knownUid)"),
    'bila webhook milik bot personal, lookup pairing harus difilter user_id pemilik bot');
  assert.ok(indexTs.includes('if (knownUid && pair.user_id !== knownUid)'),
    'pertahanan kedua: user_id hasil lookup harus sama dengan pemilik bot');
  assert.ok(indexTs.includes('sendWithToken(token, chat,'),
    'balasan pairing memakai token bot yang menerima pesan (chat belum terhubung)');
});

test('2.2: send() memakai token bot pemilik chat, bukan token bersama', () => {
  assert.ok(coreTs.includes('resolveBotTokenForChat(chat)'), 'send harus me-resolve token per chat');
  assert.ok(coreTs.includes("await sb.from('telegram_chats').select('user_id').eq('chat_id', chat)"),
    'resolusi token: chat -> user_id');
  assert.ok(coreTs.includes("await getBotRowByUser(uid)"), 'resolusi token: user_id -> baris bot');
  assert.ok(coreTs.includes('decryptBotToken(row.token_iv, row.token_encrypted)'),
    'token didekripsi dari penyimpanan terenkripsi');
  assert.ok(coreTs.includes('if (!row) return TOKEN;'),
    'fallback token bersama hanya bila pengguna belum memasang bot personal');
  assert.ok(coreTs.includes('tgWithToken(token, \'sendMessage\''),
    'sendMessage memakai token eksplisit per pengguna');
  assert.ok(!/export const send = \(chat[^)]*\) =>\s*tg\(/.test(coreTs),
    'send tidak boleh lagi memanggil tg() token bersama secara langsung');
});

test('2.2: webhook personal memverifikasi secret_token milik bot itu (T8)', () => {
  assert.ok(indexTs.includes("getBotRowByLink(linkSecret)"), 'webhook personal di-resolve dari link_secret di URL');
  assert.ok(indexTs.includes("safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', row.webhook_secret)"),
    'header secret_token dibandingkan dengan webhook_secret milik bot itu');
  assert.ok(indexTs.includes("return new Response('unknown bot', { status: 404 })"),
    'link_secret tak dikenal ditolak 404 tanpa rincian');
  assert.ok(indexTs.includes("return new Response('forbidden', { status: 403 })"),
    'secret_token salah ditolak 403 tanpa rincian');
  assert.ok(indexTs.includes('decryptBotToken(row.token_iv, row.token_encrypted)'),
    'token request didekripsi dari baris bot yang ter-resolve');
});

test('2.2: media (foto/voice) diunduh dengan token bot pemilik request', () => {
  // file_id hanya berlaku di bot yang menerima pesan — getFile + unduhan
  // dengan token bersama akan gagal untuk bot personal.
  assert.ok(aiTs.includes('const botToken = c.token ?? TOKEN;'),
    'handleMediaMessage memakai token bot dari Ctx (fallback token bersama untuk jalur legacy)');
  assert.ok(aiTs.includes("`https://api.telegram.org/bot${botToken}/getFile?file_id="),
    'getFile memakai token bot pemilik request');
  assert.ok(aiTs.includes("`https://api.telegram.org/file/bot${botToken}/${filePath}`"),
    'unduhan file memakai token bot pemilik request');
  assert.ok(!aiTs.includes('${TG}/getFile'), 'tidak boleh lagi memakai URL bot bersama untuk getFile');
  assert.ok(!aiTs.includes('file/bot${TOKEN}/'), 'tidak boleh lagi memakai token bersama untuk unduhan file');
  assert.ok(!aiTs.includes("TG,"), 'import TG yang tidak terpakai harus dihapus dari ai.ts');
});

test('2.2: telegram-setup tidak pernah mengembalikan token ke klien', () => {
  const getStatusBlock = setupTs.slice(setupTs.indexOf("if (action === 'get_status')"), setupTs.indexOf("if (action === 'connect_bot')"));
  assert.ok(getStatusBlock.includes('bot_username'), 'get_status mengembalikan username');
  assert.ok(!getStatusBlock.includes('token'), 'get_status tidak boleh menyebut token sama sekali');
  assert.ok(setupTs.includes("tgCall(token, 'getMe')"), 'token divalidasi lewat getMe sebelum disimpan');
  assert.ok(setupTs.includes('encryptBotToken(token)'), 'token dienkripsi sebelum disimpan');
  assert.ok(setupTs.includes("setWebhook"), 'webhook dipasang untuk bot yang terhubung');
  assert.ok(setupTs.includes('secret_token: webhookSecret'), 'setWebhook memakai secret_token per pengguna');
  assert.ok(setupTs.includes("if (claimed && (claimed as { user_id: string }).user_id !== user.id)"),
    'satu bot tidak boleh diklaim dua akun');
});

test('2.2: unlink & hapus akun mencabut webhook bot pengguna', () => {
  assert.ok(adminOpsTs.includes("await adminClient.from('telegram_bots').delete().eq('user_id', userId)"),
    'admin unlink menghapus baris bot');
  assert.ok(adminOpsTs.includes("deleteWebhook"), 'admin unlink memanggil deleteWebhook bot pengguna');
  assert.ok(deleteAccountTs.includes("await adminClient.from('telegram_bots')"),
    'hapus akun memeriksa baris bot sebelum menghapus pengguna');
  assert.ok(deleteAccountTs.includes("deleteWebhook"), 'hapus akun memanggil deleteWebhook bot pengguna');
  assert.ok(deleteAccountTs.includes('deleteUser(userId)') || deleteAccountTs.includes('admin.deleteUser(userId)'),
    'deleteWebhook dipanggil SEBELUM deleteUser (cascade menghapus barisnya)');
});

/* ============================================================
   Audit service_role — tiap query data pengguna harus berfilter
   ============================================================ */

const BOT_FILES = {
  'core.ts': coreTs,
  'index.ts': indexTs,
  'jobs.ts': jobsTs,
  'commands.ts': commandsTs,
  'wallets.ts': walletsTs,
  'ai.ts': aiTs,
  'planning.ts': planningTs
};

// Penanda bahwa sebuah query terikat ke pengguna/chat/bot tertentu.
const SCOPING_MARKERS = [
  'user_id', 'chat_id', 'link_secret', 'bot_user_id', 'update_id', 'otp_hash',
  "eq('id', uid)", 'eq("id", uid)'
];

// Pengecualian yang didokumentasikan: query job sistem yang memang harus
// meng-enumerasi (tanpa filter user), atau log/housekeeping tanpa data user.
const AUDIT_ALLOWLIST = [
  { file: 'jobs.ts', table: 'profiles', reason: 'getActiveUserIds: enumerasi id pengguna aktif untuk job snapshot harian; tidak membaca data pengguna.' },
  { file: 'jobs.ts', table: 'recurring', reason: 'runRecurring: job sistem meng-enumerasi baris recurring jatuh tempo; tiap baris membawa user_id-nya sendiri untuk insert + notifikasi, dan claim/rollback memakai id baris hasil enumerasi.' },
  { file: 'jobs.ts', table: 'cron_job_runs', reason: 'Log audit job (insert + update by run id); tidak berisi data pengguna.' },
  { file: 'index.ts', table: 'telegram_updates', reason: 'Housekeeping: hapus baris dedup lama berdasarkan received_at.' },
  { file: 'index.ts', table: 'telegram_pending', reason: 'Housekeeping: hapus temp kadaluarsa berdasarkan expires_at.' },
  { file: 'planning.ts', table: 'budgets', reason: 'copyBudget: rows dibangun tepat di atas pernyataan ini dengan user_id: c.uid per baris; insert hanya menerima variabel rows.' }
];

test('2.2: audit service_role — semua query bot terikat user/chat/bot atau ada di allowlist', () => {
  const usedAllowlist = new Set();
  const violations = [];
  for (const [file, src] of Object.entries(BOT_FILES)) {
    const re = /sb\.from\('([a-z_]+)'\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const table = m[1];
      const stmt = src.slice(m.index, src.indexOf(';', m.index));
      const scoped = SCOPING_MARKERS.some((marker) => stmt.includes(marker));
      if (scoped) continue;
      const allowed = AUDIT_ALLOWLIST.find((a) => a.file === file && a.table === table);
      if (allowed) {
        usedAllowlist.add(`${allowed.file}:${allowed.table}`);
        continue;
      }
      violations.push(`${file}: sb.from('${table}') tanpa filter user/chat/bot -> ${stmt.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(violations, [], `query service_role tanpa filter user:\n${violations.join('\n')}`);
  for (const a of AUDIT_ALLOWLIST) {
    assert.ok(usedAllowlist.has(`${a.file}:${a.table}`),
      `allowlist kedaluwarsa (tidak terpakai lagi): ${a.file} ${a.table} — ${a.reason}`);
  }
});
