const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');

// Gelombang 3.3 (S14–S19): edge functions + cooldown AI web.
// File-file TS Deno TIDAK bisa di-require langsung node --test, jadi tes
// ini mengeksekusi sumber aslinya di vm setelah type-stripping Node 24,
// dengan Deno.env / createClient / fetch yang di-stub — mengikuti gaya
// guard-test + vm-sandbox repo (tests/wave-v320-upgrades.test.js,
// tests/wave2-telegram-personal-bot.test.js).

const plain = (v) => JSON.parse(JSON.stringify(v));
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const REC_A = 'abcdef12-1111-4111-8111-111111111111';
const REC_B = 'abcdef12-2222-4222-8222-222222222222';

/* ============================================================
   Fake Supabase (query builder generik + auth + rpc)
   ============================================================ */
function createFakeDb(seed = {}, hooks = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const calls = { inserts: [], updates: [], deletes: [], upserts: [], rpc: [] };
  let rpcError = null;
  let idCounter = 1;
  const state = {
    tables, calls,
    setRpcError(e) { rpcError = e; },
    authGetUser: async (token) => {
      if (token === 'admin-token') return { data: { user: { id: ADMIN_ID, email: 'admin@example.com' } }, error: null };
      if (token === 'user-token') return { data: { user: { id: '33333333-3333-4333-8333-333333333333', email: 'user@example.com' } }, error: null };
      return { data: { user: null }, error: { message: 'invalid token' } };
    },
    updateUserByIdCalls: [],
    updateUserByIdError: null,
    deleteUserCalls: [],
    deleteUserError: null,
  };

  const matchFilters = (row, filters) => filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'neq') return String(v) !== String(val);
    if (op === 'gte') return v >= val;
    if (op === 'gt') return v > val;
    if (op === 'lt') return v < val;
    if (op === 'lte') return v <= val;
    return true;
  });

  class Builder {
    constructor(table, label) { this.table = table; this.label = label; this.filters = []; this.op = null; this.payload = null; this.upsertOpts = null; this.fromIdx = 0; this.toIdx = null; this.orderBys = []; }
    select() { return this; }
    eq(c, v) { this.filters.push(['eq', c, v]); return this; }
    neq(c, v) { this.filters.push(['neq', c, v]); return this; }
    gte(c, v) { this.filters.push(['gte', c, v]); return this; }
    gt(c, v) { this.filters.push(['gt', c, v]); return this; }
    lt(c, v) { this.filters.push(['lt', c, v]); return this; }
    lte(c, v) { this.filters.push(['lte', c, v]); return this; }
    or() { return this; }
    order(c, opts) { this.orderBys.push([c, opts && opts.ascending === false ? -1 : 1]); return this; }
    range(a, b) { this.fromIdx = a; this.toIdx = b; return this; }
    limit(n) { this.toIdx = (this.fromIdx || 0) + n - 1; return this; }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    update(patch) { this.op = 'update'; this.payload = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(row, opts) { this.op = 'upsert'; this.payload = row; this.upsertOpts = opts; return this; }
    async maybeSingle() { const r = await this._exec(); const d = r.data || []; return { data: d[0] ?? null, error: r.error }; }
    then(res, rej) { return this._exec().then(res, rej); }
    _exec() {
      const table = (tables[this.table] = tables[this.table] || []);
      let rows = table.filter((r) => matchFilters(r, this.filters));
      if (this.op === 'insert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => {
          const row = { ...r };
          if (row.id == null) row.id = `gen-${idCounter++}`;
          return row;
        });
        table.push(...list);
        calls.inserts.push({ table: this.table, rows: plain(list) });
        return Promise.resolve({ data: list, error: null });
      }
      if (this.op === 'upsert') {
        const row = { ...this.payload };
        if (row.id == null) row.id = `gen-${idCounter++}`;
        const keys = (this.upsertOpts && this.upsertOpts.onConflict ? String(this.upsertOpts.onConflict).split(',') : []).map((s) => s.trim()).filter(Boolean);
        const idx = keys.length ? table.findIndex((r) => keys.every((k) => String(r[k]) === String(row[k]))) : -1;
        if (idx >= 0) table[idx] = { ...table[idx], ...row };
        else table.push(row);
        calls.upserts.push({ table: this.table, row: plain(row) });
        return Promise.resolve({ data: [row], error: null });
      }
      if (this.op === 'update') {
        rows.forEach((r) => Object.assign(r, this.payload));
        calls.updates.push({ table: this.table, patch: plain(this.payload), rows: plain(rows) });
        return Promise.resolve({ data: rows, error: null });
      }
      if (this.op === 'delete') {
        tables[this.table] = table.filter((r) => !matchFilters(r, this.filters));
        calls.deletes.push({ table: this.table, rows: plain(rows) });
        return Promise.resolve({ data: rows, error: null });
      }
      for (const [col, dir] of this.orderBys) {
        rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -dir : String(a[col] ?? '') > String(b[col] ?? '') ? dir : 0));
      }
      if (this.toIdx !== null) rows = rows.slice(this.fromIdx, this.toIdx + 1);
      return Promise.resolve({ data: rows, error: null });
    }
  }

  function makeClient(label) {
    return {
      __label: label,
      from: (table) => new Builder(table, label),
      rpc: async (fn, args) => {
        calls.rpc.push({ fn, args: plain(args || {}), via: label });
        if (rpcError) return { data: null, error: rpcError };
        return { data: null, error: null };
      },
      auth: {
        getUser: (token) => state.authGetUser(token),
        admin: {
          updateUserById: async (id, attrs) => {
            state.updateUserByIdCalls.push({ id, attrs: plain(attrs) });
            if (hooks.onUpdateUserById) hooks.onUpdateUserById(id);
            if (state.updateUserByIdError) return { data: null, error: state.updateUserByIdError };
            return { data: { user: { id } }, error: null };
          },
          deleteUser: async (id) => {
            state.deleteUserCalls.push(id);
            if (hooks.onDeleteUser) hooks.onDeleteUser(id);
            if (state.deleteUserError) return { data: null, error: state.deleteUserError };
            return { data: {}, error: null };
          },
        },
      },
    };
  }
  return { state, makeClient };
}

function createFetchStub(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: plain(opts.headers || {}), body: typeof opts.body === 'string' ? opts.body : undefined });
    return handler(calls[calls.length - 1]);
  };
  fn.calls = calls;
  return fn;
}

const okJson = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => '' });
const okText = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

/* ============================================================
   Loader modul TS ke vm (satu context per file, registry bersama)
   ============================================================ */
function createBotEnv(db, fetchStub, env, registry) {
  const envMap = new Map(Object.entries(env));
  const sandbox = {
    console,
    Deno: { env: { get: (k) => envMap.get(k), set: (k, v) => envMap.set(k, v) } },
    fetch: fetchStub,
    crypto: webcrypto,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextEncoder, TextDecoder,
    AbortSignal, Request, Response, Headers,
    setTimeout, clearTimeout,
    __deps: { supabase: { createClient: (_url, key) => db.makeClient(key === 'service-key' ? 'service' : 'anon') } },
    __mods: registry,
    __captureServe: (fn) => { sandbox.__handler = fn; },
    __handler: null,
  };
  sandbox.window = sandbox;
  return { sandbox, envMap };
}

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

const BOT_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: 'shared-token',
  TELEGRAM_WEBHOOK_SECRET: 'wh-secret',
  GEMINI_API_KEY: 'gemini-test-key',
  CRON_SECRET: 'cron-secret-123',
  APP_TIMEZONE: 'Asia/Jakarta',
};

function loadBotModules(db, fetchStub, env = {}) {
  const registry = {};
  const fullEnv = { ...BOT_ENV, ...env };
  const load = (rel) => {
    const { sandbox } = createBotEnv(db, fetchStub, fullEnv, registry);
    return { mod: loadTsModule(sandbox, rel), sandbox };
  };
  const core = load('supabase/functions/telegram-bot/core.ts').mod;
  const wallets = load('supabase/functions/telegram-bot/wallets.ts').mod;
  const planning = load('supabase/functions/telegram-bot/planning.ts').mod;
  const ai = load('supabase/functions/telegram-bot/ai.ts').mod;
  const commands = load('supabase/functions/telegram-bot/commands.ts').mod;
  const jobs = load('supabase/functions/telegram-bot/jobs.ts').mod;
  return { core, wallets, planning, ai, commands, jobs, registry };
}

function loadEdgeFunction(db, fetchStub, relPath, env = {}) {
  const registry = {};
  const { sandbox, envMap } = createBotEnv(db, fetchStub, { ...BOT_ENV, ...env }, registry);
  loadTsModule(sandbox, relPath);
  return { handler: sandbox.__handler, envMap, sandbox };
}

function postReq(path, token, body, origin) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  return new Request(`https://example.supabase.co${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

const jobsTs = fs.readFileSync('supabase/functions/telegram-bot/jobs.ts', 'utf8');
const coreTs = fs.readFileSync('supabase/functions/telegram-bot/core.ts', 'utf8');
const commandsTs = fs.readFileSync('supabase/functions/telegram-bot/commands.ts', 'utf8');
const aiTs = fs.readFileSync('supabase/functions/telegram-bot/ai.ts', 'utf8');
const adminPwTs = fs.readFileSync('supabase/functions/admin-password/index.ts', 'utf8');
const adminOpsTs = fs.readFileSync('supabase/functions/admin-user-ops/index.ts', 'utf8');
const setupTs = fs.readFileSync('supabase/functions/telegram-setup/index.ts', 'utf8');
const deleteAccountTs = fs.readFileSync('supabase/functions/delete-account/index.ts', 'utf8');

/* ============================================================
   §1 CORS fail-closed
   ============================================================ */
test('3.3 CORS: ALLOWED_ORIGIN unset -> tidak ada header * (fail-closed), default aman tanpa Origin', async () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({}));
  const { handler, envMap } = loadEdgeFunction(db, fetchStub, 'supabase/functions/admin-password/index.ts', {});
  envMap.delete('ALLOWED_ORIGIN');
  const evil = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.notEqual(evil.headers.get('access-control-allow-origin'), '*');
  const noOrigin = await handler(new Request('https://x/', { method: 'OPTIONS' }));
  assert.equal(noOrigin.headers.get('access-control-allow-origin'), 'https://liandimiko.github.io');
  assert.equal(noOrigin.headers.get('vary'), 'Origin');
});

test('3.3 CORS: dua origin dikonfigurasi -> yang cocok di-echo, yang tidak cocok tidak di-echo; * ditolak', async () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({}));
  const { handler, envMap } = loadEdgeFunction(db, fetchStub, 'supabase/functions/admin-password/index.ts', {});
  envMap.set('ALLOWED_ORIGIN', 'https://a.example,https://b.example');
  const ok = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://b.example' } }));
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://b.example');
  assert.equal(ok.headers.get('vary'), 'Origin');
  const bad = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  envMap.set('ALLOWED_ORIGIN', '*');
  const star = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(star.headers.get('access-control-allow-origin'), null);
});

test('3.3 CORS: telegram-setup memakai ALLOWED_ORIGIN (tunggal), bukan ALLOWED_ORIGINS jamak', async () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({}));
  const { handler, envMap } = loadEdgeFunction(db, fetchStub, 'supabase/functions/telegram-setup/index.ts', {});
  envMap.delete('ALLOWED_ORIGIN');
  envMap.set('ALLOWED_ORIGINS', 'https://b.example');
  const legacy = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://b.example' } }));
  assert.equal(legacy.headers.get('access-control-allow-origin'), null, 'var jamak lama tidak boleh lagi dihormati');
  envMap.set('ALLOWED_ORIGIN', 'https://a.example,https://b.example');
  const ok = await handler(new Request('https://x/', { method: 'OPTIONS', headers: { origin: 'https://b.example' } }));
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://b.example');
});

test('3.3 CORS: jobs.ts — WebView native tetap diizinkan, origin asing ditolak', () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({}));
  const { jobs } = loadBotModules(db, fetchStub, {});
  const req = (origin) => ({ headers: { get: (n) => (String(n).toLowerCase() === 'origin' ? origin : null) } });
  assert.equal(jobs.buildCorsHeaders(req('https://localhost'))['Access-Control-Allow-Origin'], 'https://localhost');
  assert.equal(jobs.buildCorsHeaders(req('capacitor://localhost'))['Access-Control-Allow-Origin'], 'capacitor://localhost');
  assert.ok(!('Access-Control-Allow-Origin' in jobs.buildCorsHeaders(req('https://evil.example'))));
});

test('3.3 CORS: tidak ada lagi fail-open || "*" di file yang dimiliki Wave 3.3', () => {
  for (const [name, src] of [['admin-password', adminPwTs], ['admin-user-ops', adminOpsTs], ['telegram-setup', setupTs], ['jobs', jobsTs]]) {
    assert.ok(!src.includes("|| '*'"), `${name}: masih ada default '*'`);
    assert.ok(!src.includes("includes('*')) return '*'"), `${name}: masih menghormati '*'`);
  }
  // delete-account diperbaiki koordinator saat final assembly
  // (Wave 3.3 S14) — fail-closed seperti keempat fungsi lainnya.
  assert.ok(!deleteAccountTs.includes("|| '*'"), 'delete-account masih ada default \'*\'');
  assert.ok(!deleteAccountTs.includes("includes('*')) return '*'"), 'delete-account masih menghormati \'*\'');
});

/* ============================================================
   §2 CoinGecko header + currency-api pin
   ============================================================ */
test('3.3 CoinGecko: kunci dikirim sebagai header x-cg-demo-api-key, TIDAK PERNAH di URL', async () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({ bitcoin: { idr: 100, usd: 1 } }));
  const { jobs } = loadBotModules(db, fetchStub, { COINGECKO_API_KEY: 'cg-test-key' });
  const res = await jobs.fetchCoinGeckoSimple(['bitcoin'], true);
  assert.equal(res.bitcoin.idr, 100);
  assert.equal(fetchStub.calls.length, 1);
  assert.ok(!fetchStub.calls[0].url.includes('x_cg_demo_api_key'), 'URL tidak boleh memuat nama param kunci');
  assert.ok(!fetchStub.calls[0].url.includes('cg-test-key'), 'URL tidak boleh memuat nilai kunci');
  assert.equal(fetchStub.calls[0].headers['x-cg-demo-api-key'], 'cg-test-key');
});

test('3.3 CoinGecko: 401/403 retry tanpa kunci (header ikut dicopot)', async () => {
  const db = createFakeDb();
  let n = 0;
  const fetchStub = createFetchStub(() => {
    n++;
    if (n === 1) return { ok: false, status: 401, json: async () => ({}), text: async () => '' };
    return okJson({ bitcoin: { idr: 100, usd: 1 } });
  });
  const { jobs } = loadBotModules(db, fetchStub, { COINGECKO_API_KEY: 'cg-test-key' });
  const res = await jobs.fetchCoinGeckoSimple(['bitcoin'], true);
  assert.equal(res.bitcoin.idr, 100);
  assert.equal(fetchStub.calls.length, 2);
  assert.equal(fetchStub.calls[0].headers['x-cg-demo-api-key'], 'cg-test-key');
  assert.ok(!('x-cg-demo-api-key' in (fetchStub.calls[1].headers || {})), 'retry tanpa kunci');
});

test('3.3 currency-api: ter-pin ke 2026.11.27, tidak ada @latest di jobs.ts', async () => {
  assert.ok(!jobsTs.includes('currency-api@latest'), 'jobs.ts masih mengandung @latest');
  assert.match(jobsTs, /CURRENCY_API_VERSION = '2026\.11\.27';/);
  const versionFile = fs.readFileSync(require('node:path').join(__dirname, '..', 'wave3-currency-api-version.txt'), 'utf8');
  assert.equal(versionFile.split('\n')[0].trim(), '2026.11.27');
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({ idr: { usd: 1 / 16000 } }));
  const { jobs } = loadBotModules(db, fetchStub, {});
  const rates = await jobs.fetchCurrencyApiIdr();
  assert.equal(rates.usd, 1 / 16000);
  assert.ok(fetchStub.calls[0].url.includes('@2026.11.27'), 'URL jsdelivr memakai versi pin');
});

/* ============================================================
   §3 Admin reset: audit RPC + notifikasi + kebijakan password
   ============================================================ */
function seedAdminDb() {
  return createFakeDb({
    profiles: [
      { id: ADMIN_ID, email: 'admin@example.com', role: 'admin', status: 'active' },
      { id: TARGET_ID, email: 'korban@example.com', role: 'user', status: 'active' },
    ],
    telegram_chats: [{ chat_id: 111, user_id: TARGET_ID }],
  });
}

test('3.3 admin reset: sukses -> tepat 1 RPC audit reset_password + notifikasi ke chat tertaut', async () => {
  const db = seedAdminDb();
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { handler } = loadEdgeFunction(db, fetchStub, 'supabase/functions/admin-password/index.ts', {});
  const res = await handler(postReq('/functions/v1/admin-password', 'admin-token', { userId: TARGET_ID, password: 'Kuat#2026!' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
  assert.equal(db.state.updateUserByIdCalls.length, 1);
  assert.equal(db.state.calls.rpc.length, 1);
  const rpc = db.state.calls.rpc[0];
  assert.equal(rpc.fn, 'admin_log_action');
  // Bentuk panggilan edge function menurut migrasi 20261128040000:
  // adminClient (service_role) + actor eksplisit.
  assert.equal(rpc.via, 'service', 'RPC audit lewat service_role dengan actor eksplisit');
  assert.equal(rpc.args.p_actor_user_id, ADMIN_ID);
  assert.equal(rpc.args.p_actor_email, 'admin@example.com');
  assert.ok(String(rpc.args.p_action).includes('password'), 'action mengandung password');
  assert.equal(rpc.args.p_target_user_id, TARGET_ID);
  assert.equal(rpc.args.p_target_email, 'korban@example.com');
  assert.equal(rpc.args.p_details.telegram_notified, true);
  const sends = fetchStub.calls.filter((c) => c.url.includes('/sendMessage'));
  assert.equal(sends.length, 1);
  assert.equal(JSON.parse(sends[0].body).chat_id, 111);
  assert.match(JSON.parse(sends[0].body).text, /direset oleh admin/);
  assert.ok(!db.state.calls.inserts.some((i) => i.table === 'admin_audit_logs'), 'tidak ada INSERT langsung ke admin_audit_logs');
});

test('3.3 admin reset: audit gagal -> 500 yang lantang (password sudah berubah, tapi audit gagal)', async () => {
  const db = seedAdminDb();
  db.state.setRpcError({ message: 'RPC boom' });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { handler } = loadEdgeFunction(db, fetchStub, 'supabase/functions/admin-password/index.ts', {});
  const res = await handler(postReq('/functions/v1/admin-password', 'admin-token', { userId: TARGET_ID, password: 'Kuat#2026!' }));
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /audit gagal/i);
  assert.equal(db.state.updateUserByIdCalls.length, 1, 'password tetap sudah diubah sebelum audit');
});

test('3.3 admin reset: tanpa audit/notifikasi saat reset gagal (password umum, non-admin)', async () => {
  const db = seedAdminDb();
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { handler } = loadEdgeFunction(db, fetchStub, 'supabase/functions/admin-password/index.ts', {});
  const badPw = await handler(postReq('/functions/v1/admin-password', 'admin-token', { userId: TARGET_ID, password: 'password' }));
  assert.equal(badPw.status, 400);
  assert.match((await badPw.json()).error, /terlalu umum/);
  const nonAdmin = await handler(postReq('/functions/v1/admin-password', 'user-token', { userId: TARGET_ID, password: 'Kuat#2026!' }));
  assert.equal(nonAdmin.status, 403);
  assert.equal(db.state.updateUserByIdCalls.length, 0);
  assert.equal(db.state.calls.rpc.length, 0);
  assert.equal(fetchStub.calls.filter((c) => c.url.includes('/sendMessage')).length, 0);
});

test('3.3 kebijakan password server: urutan identik, sekuensial, local-part email ditolak', async () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({}));
  const registry = {};
  const { sandbox } = createBotEnv(db, fetchStub, BOT_ENV, registry);
  const mod = loadTsModule(sandbox, 'supabase/functions/admin-password/index.ts');
  assert.equal(mod.validateAdminPassword('Kuat#2026!'), null);
  assert.match(mod.validateAdminPassword('Kuaaat#2026'), /3 karakter identik/);
  assert.match(mod.validateAdminPassword('Abcd#2026'), /berurutan/);
  assert.match(mod.validateAdminPassword('4321#Kuat'), /berurutan/);
  assert.match(mod.validateAdminPassword('qwerty'), /terlalu umum|8–128/);
  assert.match(mod.validateAdminPassword('password'), /terlalu umum/);
  assert.match(mod.validateAdminPassword('12345678'), /berurutan/, '12345678 ditolak duluan oleh aturan sekuensial');
  assert.match(mod.validateAdminPassword('Korban#2026!', 'korban'), /alamat email/);
  assert.equal(mod.validateAdminPassword('Korban#2026!', 'ab'), null, 'local-part < 3 karakter diabaikan');
  // Validasi ujung-ke-ujung: password mengandung local-part target ditolak 400.
  const db2 = seedAdminDb();
  const { handler: h2 } = loadEdgeFunction(db2, fetchStub, 'supabase/functions/admin-password/index.ts', {});
  const res = await h2(postReq('/functions/v1/admin-password', 'admin-token', { userId: TARGET_ID, password: 'Korban#2026!' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /alamat email/);
  assert.equal(db2.state.updateUserByIdCalls.length, 0);
});

test('3.3 admin-user-ops: role/status + delete_user audit lewat RPC (bentuk migrasi 20261128040000) dan notifikasi pemilik akun', async () => {
  const events = [];
  const db = createFakeDb({
    profiles: [
      { id: ADMIN_ID, email: 'admin@example.com', role: 'admin', status: 'active' },
      { id: TARGET_ID, email: 'korban@example.com', role: 'user', status: 'active' },
    ],
    telegram_chats: [{ chat_id: 222, user_id: TARGET_ID }],
  }, { onDeleteUser: () => events.push('delete-user') });
  const fetchStub = createFetchStub((call) => { if (call.url.includes('/sendMessage')) events.push('tg-send'); return okJson({ ok: true }); });
  const { handler } = loadEdgeFunction(db, fetchStub, 'supabase/functions/admin-user-ops/index.ts', {});
  const roleRes = await handler(postReq('/functions/v1/admin-user-ops', 'admin-token', { action: 'set_user_role', userId: TARGET_ID, role: 'admin' }));
  assert.equal(roleRes.status, 200);
  assert.equal((await roleRes.json()).success, true);
  const roleRpc = db.state.calls.rpc.find((r) => r.args.p_action === 'role_admin');
  assert.ok(roleRpc, 'audit role_admin lewat RPC');
  assert.equal(roleRpc.via, 'service');
  assert.equal(roleRpc.args.p_actor_user_id, ADMIN_ID);
  assert.equal(roleRpc.args.p_details.telegram_notified, true);
  assert.ok(!db.state.calls.inserts.some((i) => i.table === 'admin_audit_logs'));
  const sends = fetchStub.calls.filter((c) => c.url.includes('/sendMessage'));
  assert.equal(sends.length, 1);
  assert.match(JSON.parse(sends[0].body).text, /Role akun Anda diubah/);

  // delete_user: notifikasi HARUS sebelum delete (chat ikut terhapus cascade).
  const delRes = await handler(postReq('/functions/v1/admin-user-ops', 'admin-token', { action: 'delete_user', userId: TARGET_ID, confirmation: 'HAPUS' }));
  assert.equal(delRes.status, 200);
  assert.ok(db.state.calls.rpc.some((r) => r.args.p_action === 'delete_user'));
  assert.ok(events.indexOf('tg-send') < events.indexOf('delete-user'), 'notifikasi mendahului penghapusan');
  assert.deepEqual(db.state.deleteUserCalls, [TARGET_ID]);
});

test('3.3 migrasi 20261128040000: bentuk RPC audit + allowlist + purge sesuai yang dipakai edge function', () => {
  const migration = fs.readFileSync('supabase/migrations/20261128040000_wave3_database.sql', 'utf8');
  assert.match(migration, /p_actor_user_id uuid default null/);
  assert.match(migration, /role_\(user\|admin\)\|status_\(active\|suspended\)\|unlink_telegram\|delete_user\|reset_password/);
  assert.match(migration, /grant execute on function public\.admin_log_action\(text, uuid, text, jsonb, uuid, text\) to authenticated, service_role;/);
  assert.match(migration, /create or replace function public\.purge_expired_telegram_pairings\(\)/);
  assert.match(migration, /grant execute on function public\.purge_expired_telegram_pairings\(\) to service_role;/);
  // Semua action yang ditulis edge function Wave 3.3 ada di allowlist migrasi.
  for (const action of ['reset_password', 'role_admin', 'status_suspended', 'unlink_telegram', 'delete_user']) {
    assert.ok(migration.includes(action), `allowlist migrasi harus memuat ${action}`);
  }
});

/* ============================================================
   §4 Batas nominal + tanggal batch
   ============================================================ */
test('3.4 nominal: MAX_NOMINAL 999.999.999.999,99 — batas diterima, di atasnya ditolak', () => {
  assert.match(coreTs, /MAX_NOMINAL = 999_999_999_999\.99;/);
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({}));
  const { core } = loadBotModules(db, fetchStub, {});
  assert.equal(core.validateNominal(999999999999.99).ok, true);
  assert.equal(core.validateNominal(999999999999).ok, true);
  assert.equal(core.validateNominal(1000000000000).ok, false);
  assert.match(core.validateNominal(1000000000000).error, /melebihi batas/);
  assert.equal(core.validateNominal(0).ok, false);
  assert.equal(core.validateNominal(-5).ok, false);
  assert.equal(core.isValidCalendarDate('2026-02-28'), true);
  assert.equal(core.isValidCalendarDate('2026-02-30'), false);
  assert.equal(core.isValidCalendarDate('2026-13-01'), false);
  assert.equal(core.isValidCalendarDate('2026-13-40'), false);
});

test('3.4 batch parser: tolak nominal raksasa & tanggal kalender tidak valid; terima yang valid', () => {
  const db = createFakeDb();
  const fetchStub = createFetchStub(() => okJson({}));
  const { commands } = loadBotModules(db, fetchStub, {});
  const huge = commands.parseBatchLine('Pengeluaran | Makan | 999999999999999', '2026-11-28');
  assert.equal(huge.ok, false);
  assert.match(huge.error, /melebihi batas/);
  const feb30 = commands.parseBatchLine('[2026-02-30] Pengeluaran | Makan | 50000', '2026-11-28');
  assert.equal(feb30.ok, false);
  assert.match(feb30.error, /Tanggal tidak valid/);
  const month13 = commands.parseBatchLine('[2026-13-40] Pengeluaran | Makan | 50000', '2026-11-28');
  assert.equal(month13.ok, false);
  assert.match(month13.error, /Tanggal tidak valid/);
  const okDate = commands.parseBatchLine('[2026-02-28] Pengeluaran | Makan | 50000', '2026-11-28');
  assert.equal(okDate.ok, true);
  assert.equal(okDate.data.tanggal, '2026-02-28');
  const okMax = commands.parseBatchLine('Pengeluaran | Makan | 999999999999', '2026-11-28');
  assert.equal(okMax.ok, true);
  assert.equal(okMax.data.nominal, 999999999999);
});

test('3.4 /batch 51 baris: hanya 50 diproses, sisanya error per baris; batch ke-2 dalam 1 menit ditolak', async () => {
  const db = createFakeDb({ categories: [], wallets: [], settings: [] });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { commands } = loadBotModules(db, fetchStub, {});
  const ctx = { chat: 999, uid: 'u1', name: 'T' };
  const lines = Array.from({ length: 51 }, (_v, i) => `Pengeluaran | Makan${i} | 10000`);
  await commands.handleBatch(ctx, `/batch\n${lines.join('\n')}`);
  const inserted = db.state.calls.inserts.filter((i) => i.table === 'transactions');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].rows.length, 50, 'maks 50 baris per /batch');
  const msg = JSON.parse(fetchStub.calls.filter((c) => c.url.includes('/sendMessage')).at(-1).body).text;
  assert.match(msg, /50 transaksi tersimpan/);
  assert.match(msg, /1 baris dilewati/);
  await commands.handleBatch(ctx, '/batch\nPengeluaran | Makan | 10000');
  assert.equal(db.state.calls.inserts.filter((i) => i.table === 'transactions').length, 1, 'batch ke-2 tidak insert lagi');
  const msg2 = JSON.parse(fetchStub.calls.filter((c) => c.url.includes('/sendMessage')).at(-1).body).text;
  assert.match(msg2, /1 kali per menit/);
});

test('3.4 /tambah menolak nominal di atas batas; /transfer di wallets.ts juga', async () => {
  const db = createFakeDb({ categories: [], wallets: [] });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { commands, wallets } = loadBotModules(db, fetchStub, {});
  const ctx = { chat: 777, uid: 'u1', name: 'T' };
  await commands.handleTambah(ctx, 'Pengeluaran Makan 999999999999999');
  assert.equal(db.state.calls.inserts.filter((i) => i.table === 'transactions').length, 0);
  const msg = JSON.parse(fetchStub.calls.filter((c) => c.url.includes('/sendMessage')).at(-1).body).text;
  assert.match(msg, /melebihi batas/);
  await commands.handleTambah(ctx, 'Pengeluaran Makan 50000');
  assert.equal(db.state.calls.inserts.filter((i) => i.table === 'transactions').length, 1);

  // Transfer (satu-satunya call-site wallets.ts yang diubah).
  const db2 = createFakeDb({
    wallets: [
      { id: 'w1', user_id: 'u1', name: 'BCA', kind: 'bank', opening_balance: 0, sort: 1 },
      { id: 'w2', user_id: 'u1', name: 'Cash', kind: 'cash', opening_balance: 0, sort: 2 },
    ],
    transactions: [], transfers: [], assets: [], settings: [],
  });
  const fetch2 = createFetchStub(() => okJson({ ok: true }));
  const mods2 = loadBotModules(db2, fetch2, {});
  await mods2.wallets.handleTransfer({ chat: 777, uid: 'u1', name: 'T' }, 'bca cash 999999999999999');
  assert.equal(db2.state.calls.inserts.filter((i) => i.table === 'transfers').length, 0);
  const msg2 = JSON.parse(fetch2.calls.filter((c) => c.url.includes('/sendMessage')).at(-1).body).text;
  assert.match(msg2, /melebihi batas/);
  void wallets;
});

/* ============================================================
   §5 Gemini guard (bot) + cooldown web
   ============================================================ */
function geminiFetchStub() {
  return createFetchStub((call) => {
    if (call.url.includes('generativelanguage.googleapis.com')) {
      return okJson({ output_text: JSON.stringify({ tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 25000, keterangan: 'kopi', tanggal: '2026-11-28' }) });
    }
    if (call.url.includes('/getFile')) return okJson({ ok: true, result: { file_path: 'x.jpg', file_size: 100 } });
    if (call.url.includes('/file/bot')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, json: async () => ({}), text: async () => '' };
    return okJson({ ok: true });
  });
}

test('3.5 Gemini guard: 11x OCR untuk 1 user -> fetch Gemini maks 10x, ke-11 pesan kuota', async () => {
  const db = createFakeDb({
    categories: [{ user_id: 'u-media', tipe: 'pengeluaran', name: 'Makanan' }],
    wallets: [],
  });
  const fetchStub = geminiFetchStub();
  const { ai } = loadBotModules(db, fetchStub, {});
  const ctx = { chat: 555, uid: 'u-media', name: 'T', token: 'bot-token' };
  for (let i = 0; i < 11; i++) {
    await ai.handleMediaMessage(ctx, { photo: [{ file_id: 'f1' }] });
  }
  const geminiCalls = fetchStub.calls.filter((c) => c.url.includes('generativelanguage'));
  assert.equal(geminiCalls.length, 10, 'kuota OCR 10/jam');
  const sends = fetchStub.calls.filter((c) => c.url.includes('/sendMessage'));
  assert.match(JSON.parse(sends.at(-1).body).text, /Kuota AI sudah habis.*Coba lagi nanti/);
});

test('3.5 Gemini guard: dua /insight cepat -> yang ke-2 "masih diproses" (lock 30 detik)', async () => {
  const db = createFakeDb({
    transactions: [{ id: 't1', user_id: 'u-insight', tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makanan', nominal: 50000 }],
    settings: [
      { user_id: 'u-insight', key: 'payrollDay', value: '1' },
      { user_id: 'u-insight', key: 'currentPeriod', value: '2026-11' },
    ],
  });
  const fetchStub = createFetchStub((call) => {
    if (call.url.includes('generativelanguage.googleapis.com')) return okJson({ output_text: 'Insight bagus.' });
    return okJson({ ok: true });
  });
  const { ai } = loadBotModules(db, fetchStub, {});
  const ctx = { chat: 556, uid: 'u-insight', name: 'T' };
  await ai.handleInsight(ctx);
  await ai.handleInsight(ctx);
  const geminiCalls = fetchStub.calls.filter((c) => c.url.includes('generativelanguage'));
  assert.equal(geminiCalls.length, 1, 'insight ke-2 tidak memanggil Gemini');
  const sends = fetchStub.calls.filter((c) => c.url.includes('/sendMessage'));
  assert.match(JSON.parse(sends.at(-1).body).text, /masih diproses/);
  assert.match(aiTs, /GEMINI_OCR_LIMIT_PER_HOUR = 10;/);
  assert.match(aiTs, /GEMINI_INSIGHT_LIMIT_PER_HOUR = 3;/);
  assert.match(aiTs, /GEMINI_MAX_MODEL_CANDIDATES = 4;/);
});

/* ============================================================
   §6 Recurring: prefix ambigu tidak pernah menghapus
   ============================================================ */
test('3.6 recurring: hapus <prefix bersama> tidak menghapus apa pun; hapus <UUID lengkap> + ya menghapus tepat satu', async () => {
  const db = createFakeDb({
    recurring: [
      { id: REC_A, user_id: 'u-rec', tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 100000, day_of_month: 5, active: true },
      { id: REC_B, user_id: 'u-rec', tipe: 'Pengeluaran', kategori: 'Internet', nominal: 200000, day_of_month: 5, active: true },
    ],
  });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { planning } = loadBotModules(db, fetchStub, {});
  const ctx = { chat: 666, uid: 'u-rec', name: 'T' };
  const sendTexts = () => fetchStub.calls.filter((c) => c.url.includes('/sendMessage')).map((c) => JSON.parse(c.body).text);

  await planning.handleRecurring(ctx, 'hapus abcdef12');
  assert.equal(db.state.calls.deletes.filter((d) => d.table === 'recurring').length, 0, 'prefix ambigu: tidak ada yang dihapus');
  assert.match(sendTexts().at(-1), /cocok dengan 2 recurring/);

  await planning.handleRecurring(ctx, `hapus ${REC_A}`);
  assert.equal(db.state.calls.deletes.filter((d) => d.table === 'recurring').length, 0, 'hapus butuh konfirmasi dulu');
  assert.match(sendTexts().at(-1), /mengonfirmasi/);

  await planning.handleRecurring(ctx, `hapus ${REC_A} ya`);
  const dels = db.state.calls.deletes.filter((d) => d.table === 'recurring');
  assert.equal(dels.length, 1);
  assert.equal(dels[0].rows[0].id, REC_A);
  assert.equal(db.state.tables.recurring.length, 1);
  assert.equal(db.state.tables.recurring[0].id, REC_B, 'recurring lain tidak tersentuh');

  await planning.handleRecurring(ctx, `toggle ${REC_B}`);
  assert.equal(db.state.tables.recurring[0].active, false, 'toggle UUID lengkap tetap jalan');
});

/* ============================================================
   §7 + purge: cron memanggil purge_expired_telegram_pairings (best-effort)
   ============================================================ */
test('3.7 cron: handleJob memanggil purge_expired_telegram_pairings; job tetap jalan bila RPC belum ada', async () => {
  const db = createFakeDb({ telegram_chats: [], profiles: [], cron_job_runs: [] });
  const fetchStub = createFetchStub(() => okJson({ ok: true }));
  const { jobs } = loadBotModules(db, fetchStub, {});
  const cronReq = () => new Request('https://x/functions/v1/telegram-bot', { method: 'POST', headers: { 'x-cron-secret': 'cron-secret-123' } });
  const res = await jobs.handleJob(cronReq(), 'daily');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sent, 0);
  assert.ok(db.state.calls.rpc.some((r) => r.fn === 'purge_expired_telegram_pairings'), 'purge dipanggil di jalur cron');

  db.state.setRpcError({ message: 'function purge_expired_telegram_pairings does not exist' });
  const res2 = await jobs.handleJob(cronReq(), 'daily');
  assert.equal(res2.status, 200, 'purge gagal tidak boleh merusak job');
  assert.equal((await res2.json()).sent, 0);
});

/* ============================================================
   §5 web ui-ai.js: cooldown 10 detik + kuota harian 50
   ============================================================ */
function loadUiAi({ usageSeed = null } = {}) {
  const uiAiJs = fs.readFileSync('web/ui-ai.js', 'utf8');
  const storageMap = new Map();
  const b64 = (s) => Buffer.from(s, 'binary').toString('base64');
  const unb64 = (s) => Buffer.from(s, 'base64').toString('binary');
  // Kunci Gemini terenkripsi 'v1:' (IV 12 byte nol + ciphertext = key).
  storageMap.set('mk_gemini_api_key', 'v1:' + Buffer.from(Buffer.concat([Buffer.alloc(12), Buffer.from('AIzaTestKey')])).toString('base64'));
  if (usageSeed) storageMap.set('mk_gemini_ai_usage', JSON.stringify(usageSeed));
  const fetchCalls = [];
  const elements = {};
  const makeEl = () => ({ textContent: '', className: '', disabled: false, _html: '', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} });
  const sandbox = {
    console,
    window: null,
    document: { getElementById: (id) => (elements[id] = elements[id] || makeEl()) },
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
    },
    fetch: async (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      return { ok: true, status: 200, json: async () => ({ output_text: '{"healthScore":80}' }), text: async () => '' };
    },
    setTimeout, clearTimeout,
    DB: { currentPeriod: '2026-11', payrollDay: 1, transactions: [] },
    FinanceAnalysis: {
      CASHFLOW_ANALYSIS_SCHEMA: {},
      buildEnrichedAiSnapshot: () => ({ period: '2026-11', savingsRate: 10, healthRatios: { emergencyRunwayMonths: 3, debtToAssetPct: 5 } }),
      buildGeminiCashflowPrompt: () => 'prompt',
      buildGeminiSystemInstruction: () => 'sys',
      parseGeminiCashflowResponse: () => ({ healthScore: 80, statusLabel: 'Sehat', ringkasan: 'Ringkasan tes.', sorotan: ['a'], bocorAnggaran: [], rekomendasi: ['b'] }),
    },
    Swal: { fire: async () => ({ isConfirmed: false }) },
    escapeHtmlJS: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    renderHtml: (el, html) => { el._html = html; },
    getSwalClass: () => '',
    currentLang: 'id',
    localToday: () => '2026-11-28',
    saveAiAnalysisCache: () => {},
    t: (k) => k,
  };
  sandbox.window = sandbox;
  sandbox.__mkFeat = {
    getPinDataKey: () => 'dek',
    pinCrypto: {
      b64ToBytes: (s) => Uint8Array.from(Buffer.from(s, 'base64')),
      bytesToB64: (b) => Buffer.from(b).toString('base64'),
      encryptWithDek: async (_dek, pt) => ({ iv: b64('\0'.repeat(12)), ct: b64(pt) }),
      decryptWithDek: async (_dek, { ct }) => unb64(ct),
    },
  };
  vm.runInNewContext(uiAiJs, sandbox);
  return { sandbox, storageMap, fetchCalls, elements };
}

test('3.5 web AI: analisis ke-2 dalam 10 detik diblokir (cooldown), tanpa fetch Gemini', async () => {
  const { sandbox, fetchCalls, elements } = loadUiAi();
  await sandbox.runAiCashflowAnalysis();
  assert.equal(fetchCalls.length, 1, 'panggilan pertama sampai ke Gemini');
  assert.match(elements.aiAnalysisResult._html, /Kuota AI hari ini: 1\/50/);
  await sandbox.runAiCashflowAnalysis();
  assert.equal(fetchCalls.length, 1, 'panggilan ke-2 diblokir sebelum fetch');
  assert.match(elements.aiAnalysisResult._html, /Tunggu \d+ detik.*jeda minimal 10 detik/);
  assert.equal(sandbox.checkAiCooldown().allowed, false);
  assert.equal(sandbox.checkAiCooldown().reason, 'cooldown');
});

test('3.5 web AI: kuota harian 50 habis -> diblokir dengan pesan kuota', async () => {
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { sandbox, fetchCalls, elements } = loadUiAi({ usageSeed: { date: todayKey, count: 50, lastAt: Date.now() - 60000 } });
  await sandbox.runAiCashflowAnalysis();
  assert.equal(fetchCalls.length, 0, 'tidak ada fetch saat kuota harian habis');
  assert.match(elements.aiAnalysisResult._html, /Kuota analisis AI hari ini sudah habis/);
  assert.equal(sandbox.getAiDailyUsage().count, 50);
  assert.equal(sandbox.AI_DAILY_LIMIT, 50);
  assert.equal(sandbox.AI_COOLDOWN_MS, 10000);
});

// ============================================================
// Gelombang 4.5 — bot endpoint tidak membalas 'ok' untuk GET.
// Webhook Telegram hanya memakai POST; jawaban 200 'ok' membuat
// endpoint tampak sehat bagi pemindai dan menyembunyikan bahwa
// secret check hanya berjalan di cabang POST.
// ============================================================
test('4.5 telegram-bot: GET (dan metode non-POST lain) dijawab 405, bukan 200 ok', async () => {
  const db = createFakeDb({});
  const fetchStub = createFetchStub(() => okJson({}));
  // index.ts mengimpor semua modul bot — muat dulu ke registry bersama
  // (loadEdgeFunction saja tidak cukup: __mods-nya kosong).
  const { registry } = loadBotModules(db, fetchStub);
  const { sandbox } = createBotEnv(db, fetchStub, { ...BOT_ENV }, registry);
  loadTsModule(sandbox, 'supabase/functions/telegram-bot/index.ts');
  const handler = sandbox.__handler;
  assert.equal(typeof handler, 'function', 'handler Deno.serve harus tertangkap');
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/telegram-bot', { method }));
    assert.equal(res.status, 405, `${method} harus 405`);
    assert.equal(await res.text(), 'Method Not Allowed');
  }
  assert.equal(fetchStub.calls.length, 0, 'tidak ada panggilan keluar untuk metode non-POST');
});
