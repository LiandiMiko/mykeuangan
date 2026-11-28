/* tests/wave5-execution-tests.test.js — Gelombang 5.1 (Q1/Q6/Q8)
   Tes EKSEKUSI untuk area berisiko tertinggi Gelombang 1-3 yang selama ini
   hanya string-match atas teks sumber (lihat inventarisasi di bawah).
   Tes di sini memanggil fungsi/logika sungguhan lewat vm / require, dengan
   DB Supabase + fetch Telegram palsu — bukan assert.match atas sumber.

   Inventarisasi 326 tes lama (per tes: eksekusi = memanggil logika lewat
   require/vm/spawn; string-match = hanya assert atas teks sumber):
     finance-analysis 27/0, finance-pro 8/0, transaction-import 6/0,
     wave-v320-upgrades 9/5, logout-offline-guard 9/2,
     pin-encryption-gating 8/1, wave1-admin-hardening 2/3,
     wave2-cron 0/5, wave2-idempotency 12/2, wave2-sessions 12/5,
     wave2-telegram-personal-bot 7 eksekusi klien + 1 primitif kripto / 10,
     wave2-xss-csp 12/5, wave3-auth-profile 28/2, wave3-database 2/26
     (butuh Postgres — tetap Belum Diverifikasi), wave3-edge-functions 23/2,
     wave3-frontend-cdn-build 9/0, wave3-restore-transfer 20/7,
     wave4-low-hardening 16/13, android-m3-ui 1/2, calendar-render 0/3,
     i18n-build 2/5, pro-web-ui 1/9, updates-view 0/4.
   Total lama ±215 eksekusi / ±111 string-match dari 326 tes.
   File ini menutup celah terbesar: webhook Telegram T7/T8 (A),
   cron handleJob/runRecurring 2.3 (B), batas kebijakan password/PIN S5 (C),
   fetch handler service worker (D), dan filter restore S26-S28 (E).
   Yang tetap string-match / Belum Diverifikasi: RLS + migrasi SQL (butuh
   Postgres), edge function Deno yang tidak terjangkau harness TS di sini
   (admin-password, admin-user-ops, delete-account, telegram-setup,
   webauthn — perilakunya sudah dieksekusi di wave3-edge-functions /
   wave2-sessions), dan render kalender (butuh DOM).

   Semua fixture ada di dalam file ini; tidak ada file di luar repo.
   Tes lolos di TZ=Asia/Jakarta dan TZ=UTC: tanggal "hari ini" selalu
   dihitung dalam zona Asia/Jakarta (sama seperti kode bot). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');

let stripTypeScriptTypes = null;
try {
  ({ stripTypeScriptTypes } = require('node:module'));
} catch (_) { /* di bawah: gagal lantang, bukan lolos diam-diam */ }
if (typeof stripTypeScriptTypes !== 'function') {
  throw new Error('Tes ini butuh Node >= 22.13 (stripTypeScriptTypes dari node:module).');
}

const plain = (v) => JSON.parse(JSON.stringify(v));
// "Hari ini" versi bot: selalu Asia/Jakarta, apa pun TZ host.
const wibToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const wibDay = () => Number(wibToday().slice(8, 10));
const futureIso = (ms) => new Date(Date.now() + ms).toISOString();
const pastIso = (ms) => new Date(Date.now() - ms).toISOString();

/* ============================================================
   Fake Supabase client (in-memory) — cukup untuk pola query yang
   dipakai telegram-bot: select/insert/update/delete/upsert + eq,
   neq, gt, gte, lt, lte, or(), order(), range(), maybeSingle(),
   rpc() untuk consume_telegram_pairing_attempt dan
   purge_expired_telegram_pairings.
   ============================================================ */
function createFakeDb(seed = {}, opts = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const calls = { inserts: [], updates: [], deletes: [], upserts: [], rpc: [], selects: [] };
  let seq = 0;
  const table = (name) => (tables[name] = tables[name] || []);

  const matchOne = (row, f) => {
    const v = row[f.col];
    if (f.op === 'eq') return v === f.val;
    if (f.op === 'neq') return v !== f.val;
    if (f.op === 'gt') return v > f.val;
    if (f.op === 'gte') return v >= f.val;
    if (f.op === 'lt') return v < f.val;
    if (f.op === 'lte') return v <= f.val;
    if (f.op === 'is') return f.val === null ? (v === null || v === undefined) : v === f.val;
    return true;
  };
  // .or('a.is.null,a.neq.2026-11-28'): koma = ATAU antar kondisi.
  const matchOrs = (row, ors) => ors.length === 0 || ors.some((group) => group.some((f) => matchOne(row, f)));

  class Builder {
    constructor(name) {
      this.name = name; this.mode = 'select'; this.filters = []; this.ors = [];
      this.orderBys = []; this.fromIdx = 0; this.toIdx = null;
      this.patch = null; this.rows = null; this.upsertOpts = null;
    }
    select() { return this; }
    eq(col, val) { this.filters.push({ col, op: 'eq', val }); return this; }
    neq(col, val) { this.filters.push({ col, op: 'neq', val }); return this; }
    gt(col, val) { this.filters.push({ col, op: 'gt', val }); return this; }
    gte(col, val) { this.filters.push({ col, op: 'gte', val }); return this; }
    lt(col, val) { this.filters.push({ col, op: 'lt', val }); return this; }
    lte(col, val) { this.filters.push({ col, op: 'lte', val }); return this; }
    or(str) {
      const group = String(str).split(',').map((part) => {
        const m = part.match(/^([^.]+)\.(is|eq|neq|gt|gte|lt|lte)\.(.*)$/);
        if (!m) throw new Error('fake .or() tidak mendukung: ' + part);
        return { col: m[1], op: m[2], val: m[2] === 'is' && m[3] === 'null' ? null : m[3] };
      });
      this.ors.push(group);
      return this;
    }
    order(col, { ascending = true } = {}) { this.orderBys.push([col, ascending ? 1 : -1]); return this; }
    range(from, to) { this.fromIdx = from; this.toIdx = to; return this; }
    insert(rows) { this.mode = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch) { this.mode = 'update'; this.patch = patch; return this; }
    delete() { this.mode = 'delete'; return this; }
    upsert(row, upsertOpts) { this.mode = 'upsert'; this.rows = [row]; this.upsertOpts = upsertOpts || {}; return this; }
    async maybeSingle() {
      const { data, error } = await this._exec();
      if (error) return { data: null, error };
      return { data: data && data.length ? data[0] : null, error: null };
    }
    then(resolve, reject) { return this._exec().then(resolve, reject); }
    _matched() { return table(this.name).filter((r) => this.filters.every((f) => matchOne(r, f)) && matchOrs(r, this.ors)); }
    async _exec() {
      const rows = table(this.name);
      if (this.mode === 'select') {
        let out = this._matched();
        for (const [col, dir] of this.orderBys) {
          out = [...out].sort((a, b) => {
            const av = a[col]; const bv = b[col];
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            return (String(av ?? '') < String(bv ?? '') ? -dir : String(av ?? '') > String(bv ?? '') ? dir : 0);
          });
        }
        if (this.toIdx !== null) out = out.slice(this.fromIdx, this.toIdx + 1);
        calls.selects.push({ table: this.name, count: out.length });
        return { data: plain(out), error: null };
      }
      if (this.mode === 'insert') {
        if (opts.failInsert && opts.failInsert[this.name]) {
          return { data: null, error: { message: 'fake insert gagal: ' + this.name } };
        }
        // Unique (update_id, bot_user_id) di telegram_updates — dedup 23505.
        if (this.name === 'telegram_updates') {
          for (const r of this.rows) {
            if (rows.some((x) => x.update_id === r.update_id && x.bot_user_id === r.bot_user_id)) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
          }
        }
        const inserted = this.rows.map((r) => {
          const row = { ...r };
          if (row.id === undefined) row.id = `fake-${++seq}`;
          rows.push(row);
          return row;
        });
        calls.inserts.push({ table: this.name, rows: plain(inserted) });
        return { data: plain(inserted), error: null };
      }
      if (this.mode === 'update') {
        const matched = this._matched();
        for (const r of matched) Object.assign(r, this.patch);
        calls.updates.push({ table: this.name, rows: plain(matched), patch: plain(this.patch) });
        return { data: plain(matched), error: null };
      }
      if (this.mode === 'delete') {
        const matched = this._matched();
        for (const r of matched) rows.splice(rows.indexOf(r), 1);
        calls.deletes.push({ table: this.name, rows: plain(matched) });
        return { data: plain(matched), error: null };
      }
      if (this.mode === 'upsert') {
        const conflictCols = String(this.upsertOpts.onConflict || '').split(',').map((s) => s.trim()).filter(Boolean);
        const out = [];
        for (const r of this.rows) {
          const row = { ...r };
          const idx = conflictCols.length
            ? rows.findIndex((x) => conflictCols.every((c) => x[c] === row[c]))
            : -1;
          if (idx >= 0) Object.assign(rows[idx], row);
          else { if (row.id === undefined) row.id = `fake-${++seq}`; rows.push(row); }
          out.push(row);
        }
        calls.upserts.push({ table: this.name, rows: plain(out) });
        return { data: plain(out), error: null };
      }
      throw new Error('mode fake DB tidak dikenal: ' + this.mode);
    }
  }

  const db = {
    tables, calls,
    from: (name) => new Builder(name),
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args: plain(args || {}) });
      if (fn === 'consume_telegram_pairing_attempt') return { data: opts.pairingAllowed !== false, error: null };
      if (fn === 'purge_expired_telegram_pairings') {
        return opts.purgeError ? { data: null, error: opts.purgeError } : { data: null, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getUser: async (token) => ({
        data: { user: token === 'valid-user-token' ? { id: 'user-a' } : null }, error: null,
      }),
    },
  };
  return db;
}

function createFetchStub(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({
      url: String(url), method: opts.method || 'GET',
      body: typeof opts.body === 'string' ? opts.body : undefined,
    });
    return handler(calls[calls.length - 1]);
  };
  fn.calls = calls;
  return fn;
}
const okJson = (data) => ({
  ok: true, status: 200,
  json: async () => data, text: async () => JSON.stringify(data),
});

/* ============================================================
   Loader modul TS ke vm (pola yang sama dengan
   wave3-edge-functions.test.js): strip tipe, ganti import npm:
   dan relatif, tangkap Deno.serve sebagai handler.
   ============================================================ */
function loadTsModule(sandbox, relPath) {
  const src = fs.readFileSync(relPath, 'utf8');
  let js = stripTypeScriptTypes(src, { mode: 'strip' });
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]npm:[^'"]+['"];?/g, (_m, names) => `const { ${names.split(',').map((s) => s.trim()).filter(Boolean).join(', ')} } = __deps.supabase;`);
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([^'"]+)['"];?/g, (_m, names, mod) => `const { ${names.split(',').map((s) => s.trim()).filter(Boolean).join(', ')} } = __mods['./${mod}'];`);
  js = js.replace(/Deno\.serve\(/g, '__captureServe(');
  const exported = [...js.matchAll(/export\s+(?:const|let|var|async function|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  js = js.replace(/export\s+(const|let|var|async function|function)\s/g, '$1 ');
  const key = './' + relPath.split('/').pop();
  js += `\n__mods['${key}'] = { ${exported.join(', ')} };`;
  vm.runInNewContext(js, sandbox, { filename: relPath });
  return sandbox.__mods[key];
}

// Muat seluruh modul telegram-bot (core -> wallets -> planning -> ai ->
// commands -> jobs -> index) dengan satu fake DB + satu fetch stub.
function loadBot(db, fetchStub, envOverrides = {}) {
  const registry = {};
  const envMap = new Map(Object.entries({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    TELEGRAM_BOT_TOKEN: 'shared-token',
    TELEGRAM_WEBHOOK_SECRET: 'wh-secret',
    TELEGRAM_OTP_HMAC_SECRET: 'pepper-test-123',
    TELEGRAM_TOKEN_ENCRYPTION_KEY: 'enc-key-test-123',
    GEMINI_API_KEY: 'gemini-test-key',
    CRON_SECRET: 'cron-secret-123',
    APP_TIMEZONE: 'Asia/Jakarta',
    ...envOverrides,
  }));
  const load = (rel) => {
    const sandbox = {
      console,
      Deno: { env: { get: (k) => envMap.get(k), set: (k, v) => envMap.set(k, v) } },
      fetch: fetchStub,
      crypto: webcrypto,
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      TextEncoder, TextDecoder, AbortSignal, Request, Response, Headers, URL,
      Math, Date, JSON, Object, Array, Promise, Number, String, Boolean, RegExp, Error, Map, Set, Intl,
      setTimeout, clearTimeout,
      __deps: { supabase: { createClient: () => db } },
      __mods: registry,
      __captureServe: (fn) => { sandbox.__handler = fn; },
      __handler: null,
    };
    sandbox.window = sandbox;
    return { mod: loadTsModule(sandbox, rel), sandbox };
  };
  const core = load('supabase/functions/telegram-bot/core.ts').mod;
  load('supabase/functions/telegram-bot/wallets.ts');
  load('supabase/functions/telegram-bot/planning.ts');
  load('supabase/functions/telegram-bot/ai.ts');
  load('supabase/functions/telegram-bot/commands.ts');
  const jobs = load('supabase/functions/telegram-bot/jobs.ts').mod;
  const index = load('supabase/functions/telegram-bot/index.ts');
  return { core, jobs, handler: index.sandbox.__handler };
}

// HMAC-SHA256 OTP persis seperti hmacOtpHex di index.ts + telegram_otp_hash() SQL.
const hmacOtp = (otp) => createHmac('sha256', 'pepper-test-123').update(otp).digest('hex');

// Baris bot personal: token dienkripsi dengan encryptBotToken sungguhan.
async function makeBotRow(core, { userId, botUserId, token, webhookSecret, linkSecret }) {
  const { iv, cipher } = await core.encryptBotToken(token);
  return {
    user_id: userId, bot_username: 'bot_' + userId, bot_user_id: botUserId,
    token_encrypted: cipher, token_iv: iv,
    webhook_secret: webhookSecret, link_secret: linkSecret,
  };
}

function webhookReq(url, { secret, body }) {
  const headers = { 'content-type': 'application/json' };
  if (secret !== undefined) headers['x-telegram-bot-api-secret-token'] = secret;
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}
const tgUpdate = (updateId, text, chatId = 555, firstName = 'Budi') => ({
  update_id: updateId,
  message: { text, from: { first_name: firstName }, chat: { id: chatId } },
});

/* ============================================================
   A — Webhook Telegram: T7 (pairing terikat pemilik bot) dan
   T8 (secret webhook per bot). Sebelum Gelombang 5.1, 10 dari
   18 tes wave2-telegram hanya string-match atas sumber TS.
   ============================================================ */

test('5.1 T8: ?bot=tidak-dikenal -> 404, tanpa baca pairing, tanpa panggil Telegram', async () => {
  const db = createFakeDb({ telegram_pairings: [{ user_id: 'user-a', otp_hash: hmacOtp('12345678'), expires_at: futureIso(600000) }] });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { handler } = loadBot(db, fetchStub);
  const res = await handler(webhookReq('https://x.supabase.co/?bot=link-asing', {
    secret: 'apa-pun', body: tgUpdate(1, '/start PAIR_12345678'),
  }));
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'unknown bot');
  assert.equal(fetchStub.calls.length, 0, 'tidak ada panggilan Telegram');
  assert.equal(db.tables.telegram_pairings.length, 1, 'pairing tidak tersentuh');
  assert.equal(db.calls.selects.filter((s) => s.table === 'telegram_pairings').length, 0);
});

test('5.1 T8: bot dikenal tapi secret header salah -> 403, pairing tidak tersentuh', async () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { core, handler } = loadBot(db, fetchStub);
  db.tables.telegram_bots = [await makeBotRow(core, {
    userId: 'user-b', botUserId: 777001, token: 'owner-token-b',
    webhookSecret: 'wh-b', linkSecret: 'link-b',
  })];
  const res = await handler(webhookReq('https://x.supabase.co/?bot=link-b', {
    secret: 'secret-salah', body: tgUpdate(2, '/start PAIR_12345678'),
  }));
  assert.equal(res.status, 403);
  assert.equal(await res.text(), 'forbidden');
  assert.equal(fetchStub.calls.length, 0);
});

test('5.1 T7: OTP milik user A lewat bot user B -> ditolak, pairing A TIDAK terpakai', async () => {
  const db = createFakeDb({
    profiles: [{ id: 'user-a', status: 'active' }, { id: 'user-b', status: 'active' }],
    telegram_pairings: [{ user_id: 'user-a', otp_hash: hmacOtp('12345678'), expires_at: futureIso(600000) }],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { core, handler } = loadBot(db, fetchStub);
  db.tables.telegram_bots = [await makeBotRow(core, {
    userId: 'user-b', botUserId: 777001, token: 'owner-token-b',
    webhookSecret: 'wh-b', linkSecret: 'link-b',
  })];
  const res = await handler(webhookReq('https://x.supabase.co/?bot=link-b', {
    secret: 'wh-b', body: tgUpdate(3, '/start PAIR_12345678'),
  }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  // Pairing milik A tetap ada (lookup difilter user_id pemilik bot).
  assert.equal(db.tables.telegram_pairings.length, 1, 'pairing A tidak boleh terhapus');
  assert.equal(db.tables.telegram_chats?.length || 0, 0, 'chat tidak boleh tertaut');
  assert.equal(fetchStub.calls.length, 1);
  assert.match(fetchStub.calls[0].url, /botowner-token-b\/sendMessage/);
  assert.match(fetchStub.calls[0].body, /Kode pairing salah atau sudah kedaluwarsa/);
});

test('5.1 T7: OTP milik pemilik bot -> pairing terpakai, chat tertaut, balasan via token pemilik', async () => {
  const db = createFakeDb({
    profiles: [{ id: 'user-b', status: 'active' }],
    telegram_pairings: [{ user_id: 'user-b', otp_hash: hmacOtp('87654321'), expires_at: futureIso(600000) }],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { core, handler } = loadBot(db, fetchStub);
  db.tables.telegram_bots = [await makeBotRow(core, {
    userId: 'user-b', botUserId: 777001, token: 'owner-token-b',
    webhookSecret: 'wh-b', linkSecret: 'link-b',
  })];
  const res = await handler(webhookReq('https://x.supabase.co/?bot=link-b', {
    secret: 'wh-b', body: tgUpdate(4, '/start PAIR_87654321'),
  }));
  assert.equal(res.status, 200);
  assert.equal(db.tables.telegram_pairings.length, 0, 'pairing single-use: terhapus setelah dipakai');
  assert.equal(db.tables.telegram_chats.length, 1);
  assert.equal(db.tables.telegram_chats[0].user_id, 'user-b');
  assert.equal(db.tables.telegram_chats[0].chat_id, 555);
  assert.equal(fetchStub.calls.length, 1);
  assert.match(fetchStub.calls[0].url, /botowner-token-b\/sendMessage/);
  assert.doesNotMatch(fetchStub.calls[0].url, /shared-token/);
  assert.match(fetchStub.calls[0].body, /berhasil terhubung/);
});

test('5.1 T7: OTP kedaluwarsa -> ditolak dan barisnya TIDAK terhapus (bukan pairing yang salah)', async () => {
  const db = createFakeDb({
    profiles: [{ id: 'user-b', status: 'active' }],
    telegram_pairings: [{ user_id: 'user-b', otp_hash: hmacOtp('11223344'), expires_at: pastIso(60000) }],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { core, handler } = loadBot(db, fetchStub);
  db.tables.telegram_bots = [await makeBotRow(core, {
    userId: 'user-b', botUserId: 777001, token: 'owner-token-b',
    webhookSecret: 'wh-b', linkSecret: 'link-b',
  })];
  await handler(webhookReq('https://x.supabase.co/?bot=link-b', {
    secret: 'wh-b', body: tgUpdate(5, '/start PAIR_11223344'),
  }));
  assert.equal(db.tables.telegram_pairings.length, 1, 'baris kedaluwarsa tidak ikut terhapus oleh percobaan ini');
  assert.equal(db.tables.telegram_chats?.length || 0, 0);
  assert.match(fetchStub.calls[0].body, /sudah kedaluwarsa/);
});

test('5.1 T7: throttle pairing -> percobaan diblokir sebelum lookup OTP', async () => {
  const db = createFakeDb({
    profiles: [{ id: 'user-b', status: 'active' }],
    telegram_pairings: [{ user_id: 'user-b', otp_hash: hmacOtp('87654321'), expires_at: futureIso(600000) }],
  }, { pairingAllowed: false });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { core, handler } = loadBot(db, fetchStub);
  db.tables.telegram_bots = [await makeBotRow(core, {
    userId: 'user-b', botUserId: 777001, token: 'owner-token-b',
    webhookSecret: 'wh-b', linkSecret: 'link-b',
  })];
  await handler(webhookReq('https://x.supabase.co/?bot=link-b', {
    secret: 'wh-b', body: tgUpdate(6, '/start PAIR_87654321'),
  }));
  assert.equal(db.tables.telegram_pairings.length, 1, 'pairing tidak boleh terpakai saat throttle');
  assert.match(fetchStub.calls[0].body, /Terlalu banyak percobaan/);
  assert.ok(db.calls.rpc.some((r) => r.fn === 'consume_telegram_pairing_attempt'));
});

test('5.1 T8: webhook bersama — secret salah 403; secret benar memproses dengan token bersama', async () => {
  const db = createFakeDb({ profiles: [{ id: 'user-a', status: 'active' }] });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { handler } = loadBot(db, fetchStub);
  const wrong = await handler(webhookReq('https://x.supabase.co/', {
    secret: 'bukan-secret', body: tgUpdate(7, '/start'),
  }));
  assert.equal(wrong.status, 403);
  assert.equal(fetchStub.calls.length, 0);
  const ok = await handler(webhookReq('https://x.supabase.co/', {
    secret: 'wh-secret', body: tgUpdate(8, '/start'),
  }));
  assert.equal(ok.status, 200);
  assert.equal(fetchStub.calls.length, 1, 'chat belum terhubung tetap dibalas');
  assert.match(fetchStub.calls[0].url, /botshared-token\/sendMessage/);
  assert.match(fetchStub.calls[0].body, /Chat belum terhubung/);
});

test('5.1 T8: token bot rusak (dekripsi gagal) -> 500 misconfigured bot, bukan fallback diam-diam', async () => {
  const db = createFakeDb({
    telegram_bots: [{
      user_id: 'user-b', bot_username: 'bot_rusak', bot_user_id: 777002,
      token_encrypted: 'AAAA', token_iv: 'AAAA',
      webhook_secret: 'wh-rusak', link_secret: 'link-rusak',
    }],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { handler } = loadBot(db, fetchStub);
  const res = await handler(webhookReq('https://x.supabase.co/?bot=link-rusak', {
    secret: 'wh-rusak', body: tgUpdate(9, '/saldo'),
  }));
  assert.equal(res.status, 500);
  assert.equal(await res.text(), 'misconfigured bot');
  assert.equal(fetchStub.calls.length, 0, 'tidak ada pesan yang terkirim dari bot yang salah');
});

test('5.1 T7: update_id sama dikirim dua kali -> balasan kedua "dup", perintah jalan sekali', async () => {
  const db = createFakeDb({ profiles: [{ id: 'user-a', status: 'active' }] });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { handler } = loadBot(db, fetchStub);
  const url = 'https://x.supabase.co/';
  const first = await handler(webhookReq(url, { secret: 'wh-secret', body: tgUpdate(2001, '/start') }));
  assert.equal(first.status, 200);
  assert.equal(await first.text(), 'ok');
  assert.equal(fetchStub.calls.length, 1);
  const second = await handler(webhookReq(url, { secret: 'wh-secret', body: tgUpdate(2001, '/start') }));
  assert.equal(await second.text(), 'dup');
  assert.equal(fetchStub.calls.length, 1, 'perintah tidak dieksekusi dua kali');
  assert.equal(db.tables.telegram_updates.length, 1);
});

test('5.1 T7: /saldo dari chat terdaftar dibalas via token bot PEMILIK, bukan token bersama', async () => {
  const db = createFakeDb({
    profiles: [{ id: 'user-b', status: 'active' }],
    telegram_chats: [{ chat_id: 777, user_id: 'user-b', name: 'Budi' }],
    wallets: [{ id: 'w1', user_id: 'user-b', name: 'BCA', kind: 'bank', opening_balance: 0, sort: 1 }],
    transactions: [], assets: [], settings: [], transfers: [],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { core, handler } = loadBot(db, fetchStub);
  db.tables.telegram_bots = [await makeBotRow(core, {
    userId: 'user-b', botUserId: 777001, token: 'owner-token-b',
    webhookSecret: 'wh-b', linkSecret: 'link-b',
  })];
  const res = await handler(webhookReq('https://x.supabase.co/?bot=link-b', {
    secret: 'wh-b', body: tgUpdate(3001, '/saldo', 777),
  }));
  assert.equal(res.status, 200);
  assert.equal(fetchStub.calls.length, 1);
  assert.match(fetchStub.calls[0].url, /botowner-token-b\/sendMessage/);
  assert.doesNotMatch(fetchStub.calls[0].url, /shared-token/);
  assert.match(fetchStub.calls[0].body, /Saldo & Ringkasan/);
});

/* ============================================================
   B — Cron 2.3: handleJob + runRecurring. Sebelum Gelombang 5.1,
   kelima tes wave2-cron hanya string-match (schedule.sql,
   migrasi, README). Di sini perilaku dieksekusi lewat handleJob
   sungguhan dengan fake DB.
   ============================================================ */

function cronReq(secret) {
  const headers = { 'content-type': 'application/json' };
  if (secret !== undefined) headers['x-cron-secret'] = secret;
  return new Request('https://x.supabase.co/', { method: 'POST', headers, body: '{}' });
}

function recurringRow(id, userId, day, lastRun = null) {
  return {
    id, user_id: userId, active: true, day_of_month: day,
    last_run: lastRun, tipe: 'Pengeluaran', kategori: 'Makanan',
    nominal: 25000, keterangan: 'Kopi',
  };
}

test('5.1 2.3: handleJob recurring — hanya user aktif dibuatkan, klaim sekali, log ok, purge jalan', async () => {
  const today = wibToday();
  const day = wibDay();
  const db = createFakeDb({
    profiles: [
      { id: 'user-a', status: 'active' },
      { id: 'user-b', status: 'active' },
      { id: 'user-c', status: 'suspended' },
    ],
    recurring: [
      recurringRow('r1', 'user-a', day),
      recurringRow('r2', 'user-a', day, '2020-01-01'),
      recurringRow('r3', 'user-b', day),
      recurringRow('r4', 'user-c', day),
      recurringRow('r5', 'user-a', day, today),
    ],
    wallets: [
      { id: 'w-a', user_id: 'user-a', name: 'BCA', kind: 'bank', opening_balance: 0, sort: 1 },
      { id: 'w-b', user_id: 'user-b', name: 'Cash', kind: 'cash', opening_balance: 0, sort: 1 },
    ],
    telegram_chats: [
      { chat_id: 111, user_id: 'user-a' },
      { chat_id: 222, user_id: 'user-b' },
    ],
    settings: [], transactions: [],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { jobs } = loadBot(db, fetchStub);
  const res = await jobs.handleJob(cronReq('cron-secret-123'), 'recurring');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created, 3, 'r1+r2+r3; r4 suspended, r5 sudah diklaim hari ini');
  assert.equal(body.skipped, 0);
  assert.equal(body.notified, 2, 'satu pesan per pengguna');
  assert.equal(body.run_id, 'fake-1', 'baris log pertama');
  assert.equal(db.tables.transactions.length, 3);
  assert.deepEqual(db.tables.transactions.map((t) => t.user_id).sort(), ['user-a', 'user-a', 'user-b']);
  const byId = Object.fromEntries(db.tables.recurring.map((r) => [r.id, r]));
  assert.equal(byId.r1.last_run, today, 'r1 diklaim');
  assert.equal(byId.r2.last_run, today, 'r2 diklaim');
  assert.equal(byId.r3.last_run, today, 'r3 diklaim');
  assert.equal(byId.r4.last_run, null, 'r4 suspended tidak diklaim');
  assert.equal(byId.r5.last_run, today, 'r5 tetap (sudah diklaim sebelumnya)');
  assert.equal(db.tables.cron_job_runs.length, 1);
  assert.equal(db.tables.cron_job_runs[0].status, 'ok');
  assert.equal(db.tables.cron_job_runs[0].created_count, 3);
  assert.equal(db.tables.cron_job_runs[0].skipped_count, 0);
  assert.equal(db.tables.cron_job_runs[0].notified_count, 2);
  assert.equal(db.tables.cron_job_runs[0].invoked_by, 'cron');
  assert.ok(db.calls.rpc.some((r) => r.fn === 'purge_expired_telegram_pairings'), 'purge OTP kedaluwarsa dipanggil');
  const sent = fetchStub.calls.filter((c) => c.url.includes('/sendMessage'));
  assert.equal(sent.length, 2, 'notifikasi ke kedua chat');
  assert.ok(sent.every((c) => c.body.includes('Recurring hari ini')));
});

test('5.1 2.3: runRecurring dibatasi 200 per run — sisanya skipped dan TIDAK diklaim', async () => {
  const day = wibDay();
  const rows = [];
  for (let i = 0; i < 201; i++) rows.push(recurringRow(`r${i}`, 'user-a', day));
  const db = createFakeDb({
    profiles: [{ id: 'user-a', status: 'active' }],
    recurring: rows,
    wallets: [{ id: 'w-a', user_id: 'user-a', name: 'BCA', kind: 'bank', opening_balance: 0, sort: 1 }],
    telegram_chats: [{ chat_id: 111, user_id: 'user-a' }],
    settings: [], transactions: [],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { jobs } = loadBot(db, fetchStub);
  const res = await jobs.handleJob(cronReq('cron-secret-123'), 'recurring');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created, 200);
  assert.equal(body.skipped, 1);
  assert.equal(db.tables.transactions.length, 200);
  const byId = Object.fromEntries(db.tables.recurring.map((r) => [r.id, r]));
  assert.equal(byId.r200.last_run, null, 'baris ke-201 tidak diklaim — diambil run berikutnya');
  assert.equal(byId.r199.last_run, wibToday());
  assert.equal(db.tables.cron_job_runs[0].skipped_count, 1);
  assert.equal(db.tables.cron_job_runs[0].created_count, 200);
});

test('5.1 2.3: tanpa cron secret dan tanpa auth -> 403 dan TIDAK dicatat di cron_job_runs', async () => {
  const db = createFakeDb({ profiles: [{ id: 'user-a', status: 'active' }], recurring: [] });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { jobs } = loadBot(db, fetchStub);
  const res = await jobs.handleJob(cronReq(), 'recurring');
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'forbidden' });
  assert.equal(db.tables.cron_job_runs?.length || 0, 0, 'percobaan ditolak tidak membanjiri tabel log');
});

test('5.1 2.3: job tidak dikenal -> 400 dan log berstatus error berisi nama job', async () => {
  const db = createFakeDb({});
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { jobs } = loadBot(db, fetchStub);
  const res = await jobs.handleJob(cronReq('cron-secret-123'), 'ngawur');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'unknown job' });
  assert.equal(db.tables.cron_job_runs.length, 1);
  assert.equal(db.tables.cron_job_runs[0].status, 'error');
  assert.match(db.tables.cron_job_runs[0].error, /unknown job: ngawur/);
});

test('5.1 2.3: insert cron_job_runs gagal -> job tetap jalan, respons tetap 200', async () => {
  const day = wibDay();
  const db = createFakeDb({
    profiles: [{ id: 'user-a', status: 'active' }],
    recurring: [recurringRow('r1', 'user-a', day)],
    wallets: [{ id: 'w-a', user_id: 'user-a', name: 'BCA', kind: 'bank', opening_balance: 0, sort: 1 }],
    telegram_chats: [{ chat_id: 111, user_id: 'user-a' }],
    settings: [], transactions: [],
  }, { failInsert: { cron_job_runs: true } });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { jobs } = loadBot(db, fetchStub);
  const res = await jobs.handleJob(cronReq('cron-secret-123'), 'recurring');
  assert.equal(res.status, 200, 'pencatatan tidak boleh merusak job');
  const body = await res.json();
  assert.equal(body.created, 1);
  assert.equal(body.run_id, null, 'tanpa baris log, run_id null');
  assert.equal(db.tables.transactions.length, 1);
});

/* ============================================================
   C — Kebijakan password & PIN (S5): batas-batas yang belum
   diuji wave3-auth-profile — urutan dengan nol di depan,
   langkah bukan ±1, kata umum + angka, local-part email.
   ============================================================ */

function loadPolicy() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInNewContext(fs.readFileSync('web/password-policy.js', 'utf8'), sandbox);
  return sandbox.__mkPasswordPolicy;
}
const codes = (r) => [...r.errors].map((e) => String(e.code)); // [...x] agar array host-realm (deepStrictEqual lintas vm gagal)

test('5.1 S5: PIN — urutan naik/turun ditolak, langkah 2 dan putaran diterima', () => {
  const policy = loadPolicy();
  assert.deepEqual(codes(policy.validatePin('012345')), ['pin_sequential'], 'naik dari 0 tetap urutan');
  assert.deepEqual(codes(policy.validatePin('543210')), ['pin_sequential'], 'turun');
  assert.deepEqual(codes(policy.validatePin('123450')), [], 'putus di akhir bukan urutan penuh');
  assert.deepEqual(codes(policy.validatePin('135791')), [], 'langkah 2 bukan urutan ±1');
  assert.deepEqual(codes(policy.validatePin('000000')), ['pin_all_same']);
  assert.deepEqual(codes(policy.validatePin('121212')), [], 'pola berulang 12 bukan semua-sama/bukan urutan');
  assert.deepEqual(codes(policy.validatePin('123')), ['pin_format']);
  assert.deepEqual(codes(policy.validatePin('1234567')), ['pin_format']);
  assert.deepEqual(codes(policy.validatePin('12a4')), ['pin_format']);
  assert.deepEqual(codes(policy.validatePin('')), ['pin_format']);
  assert.equal(policy.validatePin(482917).ok, true, 'angka (bukan string) tetap diterima');
  assert.equal(policy.validatePin('482917').ok, true);
});

test('5.1 S5: PIN — 111111 hanya pin_all_same (bukan juga sequential)', () => {
  const policy = loadPolicy();
  assert.deepEqual(codes(policy.validatePin('111111')), ['pin_all_same']);
  assert.equal(policy.firstPinError('111111'), 'PIN tidak boleh semua digit sama (mis. 111111).');
  assert.equal(policy.firstPinError('482917'), '');
  assert.equal(policy.firstPinError('1234', { lang: 'en' }), 'PIN must not be a sequential run (e.g. 123456 or 654321).');
});

test('5.1 S5: password — urutan 4 huruf/angka di mana saja ditolak', () => {
  const policy = loadPolicy();
  assert.ok(codes(policy.validatePassword('abcdefg1')).includes('sequential'));
  assert.ok(codes(policy.validatePassword('Kopi1234!')).includes('sequential'), '1234 di akhir tetap urutan');
  assert.ok(codes(policy.validatePassword('zz1234x!')).includes('sequential'), 'urutan setelah awalan tetap dihitung');
  assert.ok(codes(policy.validatePassword('xxabcdxx1')).includes('sequential'));
  assert.ok(codes(policy.validatePassword('fedcba99')).includes('sequential'), 'turun juga dihitung');
  assert.equal(policy.validatePassword('a1b2c3d4!').ok, true, 'selang-seling bukan urutan');
  assert.equal(policy.validatePassword('Kopi-Pagi-2026!').ok, true);
});

test('5.1 S5: password — 3 karakter sama berurutan ditolak, 2 masih boleh', () => {
  const policy = loadPolicy();
  assert.ok(codes(policy.validatePassword('aaaB1234')).includes('repeated_chars'));
  assert.deepEqual(
    codes(policy.validatePassword('aaaB1234')).sort(),
    ['repeated_chars', 'sequential'],
    'dua pelanggaran dilaporkan sekaligus',
  );
  assert.equal(policy.validatePassword('aaKopi-2026!').ok, true, 'dua huruf sama berurutan masih boleh');
});

test('5.1 S5: password — kata umum dengan angka di belakang tetap ditolak', () => {
  const policy = loadPolicy();
  for (const pw of ['password2024', 'qwerty99', 'letmein123', 'dragon2026!', 'Passw0rd!!', 'admin1234']) {
    assert.ok(codes(policy.validatePassword(pw)).includes('common_password'), pw);
  }
  assert.equal(policy.validatePassword('Kopi-Pagi-2026!').ok, true);
  assert.equal(policy.validatePassword('Gajah-Terbang-77').ok, true);
});

test('5.1 S5: password — local-part email ditolak tanpa peduli huruf besar/kecil', () => {
  const policy = loadPolicy();
  const email = 'Liandi.Miko24@gmail.com';
  assert.ok(codes(policy.validatePassword('Liandi.Miko24-Kopi!', { email })).includes('contains_email'));
  assert.ok(codes(policy.validatePassword('xxLIANDI.MIKO24xx', { email })).includes('contains_email'), 'case-insensitive');
  assert.equal(policy.containsEmailLocalPart('xxLIANDI.MIKO24xx', email), true);
  assert.equal(policy.containsEmailLocalPart('miko24-kopi!', email), false, 'hanya sebagian local-part bukan pelanggaran');
  // Local-part < 3 karakter tidak dihitung (tidak ada cukup sinyal).
  assert.equal(policy.validatePassword('Ab-2026-Kopi!', { email: 'ab@x.com' }).ok, true);
  assert.equal(policy.containsEmailLocalPart('Ab-2026', 'ab@x.com'), false);
});

test('5.1 S5: password — panjang 8..128, pesan pertama sesuai bahasa', () => {
  const policy = loadPolicy();
  assert.deepEqual(codes(policy.validatePassword('Abc123!')), ['too_short']);
  assert.deepEqual(codes(policy.validatePassword('a'.repeat(129))), ['too_long']);
  assert.equal(policy.validatePassword('Kopi-99!').ok, true, 'tepat 8 karakter diterima');
  assert.equal(policy.validatePassword('Kopi-Pagi-2026!'.repeat(9).slice(0, 128)).ok, true, 'tepat 128 karakter diterima');
  assert.equal(policy.firstPasswordError('Abc123!'), 'Password harus terdiri dari 8 sampai 128 karakter.');
  assert.equal(policy.firstPasswordError('Abc123!', { lang: 'en' }), 'Password must be 8 to 128 characters.');
  assert.equal(policy.firstPasswordError('Kopi-Pagi-2026!'), '');
});

/* ============================================================
   D — Service worker fetch handler. Tes wave4 hanya mengeksekusi
   kunci cache HTML + batas 200 entri + kuota; cabang bypass API
   dan stale-while-revalidate non-HTML belum pernah dieksekusi.
   ============================================================ */

function loadSw({ quotaUsage = 0, quotaTotal = 0, fetchImpl = null } = {}) {
  const listeners = {};
  const store = new Map();
  const cache = {
    async match(req) { const k = typeof req === 'string' ? req : req.url; return store.get(k); },
    async put(req, res) { const k = typeof req === 'string' ? req : req.url; store.set(k, res); },
    async delete(req) { const k = typeof req === 'string' ? req : req.url; return store.delete(k); },
    async keys() { return [...store.keys()].map((k) => ({ url: k })); },
    async addAll(urls) { for (const u of urls) store.set(u, new Response('precached')); },
  };
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      registration: undefined,
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      keys: async () => ['mykeuangan-test'],
      match: async (req) => cache.match(req),
    },
    fetch: fetchImpl || (async () => new Response('network-body', { status: 200 })),
    Response, Request, URL,
    navigator: { storage: { estimate: async () => ({ usage: quotaUsage, quota: quotaTotal }) } },
    console, setTimeout, clearTimeout, Date, JSON, Math, Object, Array, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/sw.js', 'utf8').replace(/__BUILD_ID__/g, 'test'), sandbox);
  return { listeners, store, sandbox };
}

function swFetchEvent(url, { method = 'GET', mode = '', accept = '' } = {}) {
  const ev = {
    request: {
      method, url, mode,
      headers: { get: (name) => (name.toLowerCase() === 'accept' ? accept : null) },
    },
    _waits: [],
    respondWith(p) { this._promise = p; },
    waitUntil(p) { this._waits.push(p); },
  };
  return ev;
}

async function runSwFetch(sw, ev) {
  sw.listeners.fetch(ev);
  if (ev._promise) await ev._promise;
  await Promise.all(ev._waits);
}

test('5.1 SW: host API dilewati — tidak respondWith, tidak masuk cache', async () => {
  const sw = loadSw();
  const urls = [
    'https://xyz.supabase.co/rest/v1/transactions',
    'https://generativelanguage.googleapis.com/v1/models:generate',
    'https://api.coingecko.com/api/v3/simple/price',
    'https://latest.currency-api.pages.dev/v1/currencies/idr.json',
    'https://app.example/x/currency-api/data.json',
    'https://app.example/version.json',
  ];
  for (const url of urls) {
    const ev = swFetchEvent(url);
    sw.listeners.fetch(ev);
    assert.equal(ev._promise, undefined, `tanpa respondWith: ${url}`);
    await Promise.all(ev._waits);
  }
  assert.equal(sw.store.size, 0, 'tidak ada yang tercache dari host API');
});

test('5.1 SW: non-GET dan skema non-http(s) dilewati tanpa respondWith', () => {
  const sw = loadSw();
  const post = swFetchEvent('https://app.example/api/x', { method: 'POST' });
  sw.listeners.fetch(post);
  assert.equal(post._promise, undefined, 'POST tidak diintersep');
  const ext = swFetchEvent('chrome-extension://abc/index.html');
  sw.listeners.fetch(ext);
  assert.equal(ext._promise, undefined, 'skema chrome-extension tidak diintersep');
});

test('5.1 SW: aset non-HTML — cache dulu, revalidasi latar, offline miss -> 503', async () => {
  const sw = loadSw();
  // 1) Miss + jaringan hidup: isi cache, kembalikan body jaringan.
  const ev1 = swFetchEvent('https://app.example/icons/icon-192.png', { accept: 'image/png' });
  await runSwFetch(sw, ev1);
  assert.equal(await ev1._promise.then((r) => r.text()), 'network-body');
  assert.ok(sw.store.has('https://app.example/icons/icon-192.png'), 'aset tercache setelah fetch');

  // 2) Hit: body cache langsung, tanpa menunggu jaringan.
  sw.sandbox.fetch = async () => new Response('network-baru', { status: 200 });
  const ev2 = swFetchEvent('https://app.example/icons/icon-192.png', { accept: 'image/png' });
  await runSwFetch(sw, ev2);
  assert.equal(await ev2._promise.then((r) => r.text()), 'network-body', 'stale-while-revalidate: cache dulu');
  assert.equal(await sw.store.get('https://app.example/icons/icon-192.png').text(), 'network-baru', 'latar memperbarui cache');

  // 3) Miss + jaringan mati: 503 Offline, bukan throw.
  const swOffline = loadSw({ fetchImpl: async () => { throw new Error('offline'); } });
  const ev3 = swFetchEvent('https://app.example/assets/app.js', { accept: 'application/javascript' });
  await runSwFetch(swOffline, ev3);
  const res3 = await ev3._promise;
  assert.equal(res3.status, 503);
  assert.equal(res3.statusText, 'Offline');
});

test('5.1 SW: HTML non-utama berkunci query; offline fallback ke precache ./index.html', async () => {
  const sw = loadSw();
  const installEv = { waitUntil(p) { this._p = p; } };
  sw.listeners.install(installEv);
  await installEv._p;
  assert.ok(sw.store.has('./index.html'), 'precache ./index.html');

  const ev1 = swFetchEvent('https://app.example/privacy.html?v=2', { mode: 'navigate', accept: 'text/html' });
  await runSwFetch(sw, ev1);
  assert.ok(sw.store.has('/privacy.html?v=2'), 'HTML non-utama berkunci path+query sendiri');

  const swOffline = loadSw({ fetchImpl: async () => { throw new Error('offline'); } });
  const installEv2 = { waitUntil(p) { this._p = p; } };
  swOffline.listeners.install(installEv2);
  await installEv2._p;
  const ev2 = swFetchEvent('https://app.example/privacy.html?v=9', { mode: 'navigate', accept: 'text/html' });
  await runSwFetch(swOffline, ev2);
  assert.equal(await ev2._promise.then((r) => r.text()), 'precached', 'fallback offline: ./index.html');
});

/* ============================================================
   E — Filter restore (S26-S28): filterNewBackup* diekspor dari
   finance-analysis-backup.js tapi selama ini hanya diuji lewat
   prepareBackupRestorePayload secara tidak langsung. Di sini
   tiap filter diuji langsung, termasuk jalur unmapped yang dulu
   diam-diam mengalihkan ke dompet pertama.
   ============================================================ */
const Backup = require('../web/finance-analysis-backup.js');

const EXISTING_WALLETS = [
  { id: 'w-bca', name: 'BCA' },
  { id: 'w-cash', name: 'Cash' },
];
const WALLET_BY_OLD_ID = { 'old-bca': 'BCA', 'old-cash': 'Cash', 'old-hilang': 'BCA Lama' };

test('5.1 S26: filterNewBackupTransfers — unmapped masuk unmapped, bukan dialihkan diam-diam', () => {
  const { added, skipped, unmapped } = Backup.filterNewBackupTransfers([
    { id: 't1', tanggal: '2026-11-01', kind: 'transfer', nominal: 100000, fee: 0, fromWallet: 'old-bca', toWallet: 'old-cash', keterangan: 'pindah' },
    { id: 't2', tanggal: '2026-11-02', kind: 'transfer', nominal: 50000, fee: 0, fromWallet: 'old-bca', toWallet: 'old-tidak-ada', keterangan: 'tujuan hilang' },
    { id: 't3', tanggal: '2026-11-03', kind: 'transfer', nominal: 50000, fee: 0, fromWallet: 'old-bca', toWallet: 'old-bca', keterangan: 'dompet sama' },
    { id: 't4', tanggal: '2026-11-04', kind: 'transfer', nominal: 0, fee: 0, fromWallet: 'old-bca', toWallet: 'old-cash' },
    { id: 't5', tanggal: '2026-11-05', kind: 'transfer', nominal: -100, fee: 0, fromWallet: 'old-bca', toWallet: 'old-cash' },
    { id: 't6', tanggal: '2026-11-06', kind: 'investasi', nominal: 200000, fee: 0, fromWallet: 'old-bca', toWallet: 'old-tidak-ada', keterangan: 'beli emas' },
    { id: 't7', tanggal: '2026-1-1', kind: 'transfer', nominal: 1000, fee: 0, fromWallet: 'old-bca', toWallet: 'old-cash' },
    { id: 't8', tanggal: '2026-11-08', kind: 'transfer', nominal: 1000, fee: 99999999999999, fromWallet: 'old-bca', toWallet: 'old-cash' },
  ], [], WALLET_BY_OLD_ID, EXISTING_WALLETS);
  assert.equal(added.length, 2, 't1 transfer + t6 investasi (investasi tidak butuh dompet tujuan)');
  assert.equal(added[0].fromWalletName, 'BCA');
  assert.equal(added[0].toWalletName, 'Cash');
  assert.equal(added[1].kind, 'investasi');
  assert.equal(added[1].toWalletName, '');
  assert.equal(unmapped.length, 1, 'hanya t2 yang unmapped');
  assert.equal(unmapped[0].missingWalletName, 'dompet tidak dikenal');
  assert.equal(skipped, 6, 't2 unmapped + t3 sama + t4 nol + t5 negatif + t7 tanggal + t8 fee raksasa');
});

test('5.1 S26: filterNewBackupTransfers — id sudah ada dilewati; tanpa id didedup signature', () => {
  const existing = [{ id: 't1', tanggal: '2026-11-01', kind: 'transfer', fromWalletName: 'BCA', toWalletName: 'Cash', nominal: 100000, fee: 0, keterangan: '' }];
  const { added, skipped } = Backup.filterNewBackupTransfers([
    { id: 't1', tanggal: '2026-11-01', kind: 'transfer', nominal: 100000, fromWallet: 'old-bca', toWallet: 'old-cash' },
    { tanggal: '2026-11-02', kind: 'transfer', nominal: 50000, fromWallet: 'old-bca', toWallet: 'old-cash', keterangan: 'kopi' },
    { tanggal: '2026-11-02', kind: 'transfer', nominal: 50000, fromWallet: 'old-bca', toWallet: 'old-cash', keterangan: 'kopi' },
  ], existing, WALLET_BY_OLD_ID, EXISTING_WALLETS);
  assert.equal(added.length, 1, 'hanya satu dari dua transfer tanpa id yang identik');
  assert.equal(skipped, 2, 'id duplikat + signature duplikat');
});

test('5.1 S27: filterNewBackupWallets — nama duplikat dilewati tapi pemetaan id lama tetap dibangun', () => {
  const { added, skipped, walletNameByOldId } = Backup.filterNewBackupWallets([
    { id: 'old-bca', name: 'BCA', kind: 'bank', openingBalance: 100000 },
    { id: 'old-baru', name: '  BNI  ', kind: 'ewallet', openingBalance: -5000 },
    { id: 'old-aneh', name: 'Dompet Aneh', kind: 'tidak-dikenal', openingBalance: 0 },
    { id: 'old-kosong', name: '   ', kind: 'bank' },
  ], EXISTING_WALLETS);
  assert.equal(added.length, 2);
  assert.deepEqual(added[0], { name: 'BNI', kind: 'ewallet', openingBalance: 0 }, 'saldo negatif dijepit ke 0');
  assert.deepEqual(added[1], { name: 'Dompet Aneh', kind: 'bank', openingBalance: 0 }, 'kind asing jadi bank');
  assert.equal(skipped, 2, 'BCA duplikat + nama kosong');
  assert.equal(walletNameByOldId['old-bca'], 'BCA', 'dompet yang sudah ada tetap terpetakan untuk restore transaksi');
  assert.equal(walletNameByOldId['old-baru'], 'BNI');
});

test('5.1 S27: filterNewBackupEntities — bentuk objek, grup tak dikenal, duplikat case-insensitive', () => {
  const { added, skipped } = Backup.filterNewBackupEntities({
    UtangApp: ['Kredivo', 'kredivo', '  '],
    UtangPerson: ['Budi'],
    Piutang: ['Sinta', 'SINTA'],
    GrupNgawur: ['X'],
  }, { UtangApp: ['Kredivo'], UtangPerson: [], Piutang: [] });
  assert.deepEqual(added, [{ grp: 'UtangPerson', name: 'Budi' }, { grp: 'Piutang', name: 'Sinta' }]);
  assert.equal(skipped, 4, 'Kredivo duplikat + kredivo duplikat + nama kosong + SINTA duplikat (GrupNgawur diabaikan sebagai grup)');
});

test('5.1 S28: filter recurring & aset lewat prepareBackupRestorePayload — validasi batas dan dedup', () => {
  // filterNewBackupRecurring / filterNewBackupAssets tidak diekspor modul —
  // jalurnya diuji lewat prepareBackupRestorePayload yang memanggil keduanya.
  const payload = Backup.prepareBackupRestorePayload({
    recurring: [
      { tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 500000, dayOfMonth: 15, keterangan: 'PLN' },
      { tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 500000, dayOfMonth: 15, keterangan: 'PLN' },
      { tipe: 'Pengeluaran', kategori: 'Air', nominal: 100000, dayOfMonth: 0 },
      { tipe: 'Pengeluaran', kategori: 'Air', nominal: 100000, dayOfMonth: 32 },
      { tipe: 'Pengeluaran', kategori: 'Air', nominal: 0, dayOfMonth: 5 },
      { tipe: 'Ngawur', kategori: 'Air', nominal: 100000, dayOfMonth: 5 },
    ],
    assets: [
      { name: 'BTC', type: 'Crypto', symbol: 'btc', quantity: -2, buyPrice: -100, value: 5000000 },
      { name: 'BTC', type: 'Crypto', symbol: 'BTC', quantity: 1, buyPrice: 100, value: 100 },
      { name: 'Emas Antam', type: 'Emas', symbol: '', quantity: 5, buyPrice: 1000000, value: 5000000 },
      { name: 'Aneh', type: 'TidakAda', symbol: 'X', quantity: 1, buyPrice: 1, value: 1 },
      { name: '   ', type: 'Crypto', symbol: 'Y', quantity: 1, buyPrice: 1, value: 1 },
    ],
  }, {});
  assert.equal(payload.valid, true);
  assert.equal(payload.newRecurring.length, 1);
  assert.equal(payload.skippedRecurring, 5);
  assert.equal(payload.newRecurring[0].active, true, 'default aktif');
  assert.equal(payload.newAssets.length, 3);
  assert.equal(payload.skippedAssets, 2, 'BTC duplikat + nama kosong');
  assert.deepEqual(
    payload.newAssets[0],
    { name: 'BTC', type: 'Crypto', symbol: 'BTC', quantity: 0, buyPrice: 0, value: 5000000 },
    'quantity/buyPrice negatif dijepit ke 0, symbol jadi huruf besar',
  );
  assert.equal(payload.newAssets[2].type, 'Other', 'tipe asing jadi Other');
});
