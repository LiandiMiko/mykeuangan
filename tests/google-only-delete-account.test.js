const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');

// Gelombang 7c Item 3 — akun Google-only bisa hapus akun sendiri.
// Server (supabase/functions/delete-account/index.ts) dieksekusi nyata di
// vm seperti tests/wave3-edge-functions.test.js (Deno.env / createClient /
// fetch di-stub); klien (web/supabase-admin.js, web/ui-feat-account.js)
// dieksekusi nyata di vm seperti tests/admin-last-activity.test.js.
// Semua fixture ada di dalam repo; semua waktu memakai epoch (detik)
// supaya lolos di TZ=Asia/Jakarta DAN TZ=UTC.
//
// Desain yang diuji (lihat anti-slop/audit-046): penghapusan wajib
// dibuktikan autentikasi SEGAR. Akun Google-only membuktikannya dengan
// access token sesi yang baru diterbitkan lewat login ulang Google;
// server memeriksa klaim `amr` (entri oauth ≤ 10 menit — refresh token
// TIDAK menggeser amr, hanya login baru) DAN `iat` ≤ 10 menit.

const GOOGLE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const EMAIL_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER_GOOGLE_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const USERS = {
  [GOOGLE_ID]: { id: GOOGLE_ID, email: 'google@example.com', app_metadata: { provider: 'google', providers: ['google'] } },
  [EMAIL_ID]: { id: EMAIL_ID, email: 'email@example.com', app_metadata: { provider: 'email', providers: ['email'] } },
  [OTHER_GOOGLE_ID]: { id: OTHER_GOOGLE_ID, email: 'other@example.com', app_metadata: { provider: 'google', providers: ['google'] } },
};

/* ============================================================
   JWT rakitan tes (tanda tangan dummy — keaslian token diuji lewat
   stub getUser, seperti GoTrue memvalidasi tanda tangan di produksi)
   ============================================================ */
const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
const makeJwt = (payload) => `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.sig`;
const nowSec = () => Math.floor(Date.now() / 1000);

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return null; }
}

// Token OAuth Google rakitan: sub + app_metadata + amr oauth + iat.
// iatAgeSec/amrAgeSec = umur dalam detik (negatif = di masa depan).
function googleJwt({ sub = GOOGLE_ID, iatAgeSec = 120, amrAgeSec = 120, providers = ['google'], amrMethod = 'oauth' } = {}) {
  const now = nowSec();
  const payload = {
    sub, iat: now - iatAgeSec, exp: now + 3600, aud: 'authenticated',
    app_metadata: { provider: providers[0], providers },
  };
  if (amrMethod !== null) payload.amr = [{ method: amrMethod, timestamp: now - amrAgeSec }];
  return makeJwt(payload);
}

/* ============================================================
   Fake Supabase + loader vm edge function (pola wave3-edge-functions)
   ============================================================ */
function createFakeDb(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const state = {
    tables,
    deleteUserCalls: [],
    deleteUserError: null,
    authGetUser: (token) => {
      if (token === 'google-session-token') return { data: { user: { ...USERS[GOOGLE_ID] } }, error: null };
      if (token === 'email-session-token') return { data: { user: { ...USERS[EMAIL_ID] } }, error: null };
      // Token JWT rakitan: dekode klaim seperti GoTrue; app_metadata
      // diambil dari klaim token (di produksi klaim dan DB konsisten —
      // kecuali pada kasus yang memang menguji inkonsistensi itu).
      const claims = decodeJwtPayload(token);
      if (!claims || typeof claims.sub !== 'string' || !USERS[claims.sub]) {
        return { data: { user: null }, error: { message: 'invalid token' } };
      }
      const base = USERS[claims.sub];
      return { data: { user: { ...base, app_metadata: claims.app_metadata || base.app_metadata } }, error: null };
    },
    signInWithPassword: async ({ email, password }) => {
      if (email === 'email@example.com' && password === 'Benar#1234') return { data: {}, error: null };
      return { data: {}, error: { message: 'Invalid login credentials' } };
    },
  };
  const matchFilters = (row, filters) => filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'neq') return String(v) !== String(val);
    return true;
  });
  class Builder {
    constructor(table) { this.table = table; this.filters = []; this.toIdx = null; this.fromIdx = 0; }
    select() { return this; }
    eq(c, v) { this.filters.push(['eq', c, v]); return this; }
    neq(c, v) { this.filters.push(['neq', c, v]); return this; }
    limit(n) { this.toIdx = (this.fromIdx || 0) + n - 1; return this; }
    async maybeSingle() { const r = await this._exec(); const d = r.data || []; return { data: d[0] ?? null, error: r.error }; }
    then(res, rej) { return this._exec().then(res, rej); }
    _exec() {
      let rows = (tables[this.table] || []).filter((r) => matchFilters(r, this.filters));
      if (this.toIdx !== null) rows = rows.slice(this.fromIdx, this.toIdx + 1);
      return Promise.resolve({ data: rows, error: null });
    }
  }
  function makeClient() {
    return {
      from: (table) => new Builder(table),
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: (token) => state.authGetUser(token),
        signInWithPassword: (args) => state.signInWithPassword(args),
        admin: {
          deleteUser: async (id) => {
            state.deleteUserCalls.push(id);
            if (state.deleteUserError) return { data: null, error: state.deleteUserError };
            return { data: {}, error: null };
          },
        },
      },
    };
  }
  return { state, makeClient };
}

function createFetchStub() {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  fn.calls = calls;
  return fn;
}

function loadDeleteAccount(db, fetchStub, profilesSeed) {
  const envMap = new Map(Object.entries({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  }));
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
    __deps: { supabase: { createClient: () => db.makeClient() } },
    __mods: {},
    __captureServe: (fn) => { sandbox.__handler = fn; },
    __handler: null,
  };
  sandbox.window = sandbox;
  let js = fs.readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
  js = stripTypeScriptTypes(js, { mode: 'strip' });
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]npm:[^'"]+['"];?/g, (_m, names) => `const { ${names.split(',').map((s) => s.trim()).filter(Boolean).join(', ')} } = __deps.supabase;`);
  js = js.replace(/Deno\.serve\(/g, '__captureServe(');
  vm.runInNewContext(js, sandbox, { filename: 'supabase/functions/delete-account/index.ts' });
  return { handler: sandbox.__handler, db };
}

function postReq(path, token, body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`https://example.supabase.co${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

const DEFAULT_PROFILES = [
  { id: GOOGLE_ID, role: 'user', status: 'active' },
  { id: EMAIL_ID, role: 'user', status: 'active' },
];

async function callDeleteAccount({ headerToken, body, profiles = DEFAULT_PROFILES }) {
  const db = createFakeDb({ profiles, telegram_bots: [] });
  const fetchStub = createFetchStub();
  const { handler } = loadDeleteAccount(db, fetchStub, profiles);
  const res = await handler(postReq('/functions/v1/delete-account', headerToken, body));
  const json = await res.json();
  return { res, json, db, fetchStub };
}

/* ============================================================
   §1 Server — jalur OAuth Google-only
   ============================================================ */
test('OAuth: Google-only tanpa bukti segar DITOLAK (401), tidak ada penghapusan', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS' },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Kata sandi tidak valid.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: token basi (amr + iat 30 menit lalu) DITOLAK', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({ iatAgeSec: 1800, amrAgeSec: 1800 }) },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: token milik user lain DITOLAK', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({ sub: OTHER_GOOGLE_ID }) },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: token provider lain (amr password, providers email) DITOLAK', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({ providers: ['email'], amrMethod: 'password' }) },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: token segar milik sendiri DITERIMA sampai tahap penghapusan', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({}) },
  });
  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(db.state.deleteUserCalls, [GOOGLE_ID]);
});

test('OAuth: iat segar tapi amr basi (sesi curian yang di-refresh) DITOLAK', async () => {
  // Inilah tes kunci desain: refresh mencetak iat baru, tapi amr tetap
  // di waktu login lama. Bila server hanya memeriksa iat, tes ini lolos
  // (dan sesi curian bisa menghapus akun) — harus 401.
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({ iatAgeSec: 60, amrAgeSec: 7200 }) },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: token tanpa klaim amr DITOLAK', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({ amrMethod: null }) },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: token malformed (bukan JWT) DITOLAK', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: 'bukan-jwt' },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: iat di masa depan DITOLAK (toleransi skew hanya 60 detik)', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({ iatAgeSec: -3600, amrAgeSec: 120 }) },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: akun ber-password yang mencoba jalur OAuth DITOLAK (wajib password)', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'email-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({ sub: EMAIL_ID }) },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Verifikasi ulang gagal.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: satu-satunya admin aktif tetap tidak boleh hapus diri (400) di jalur baru', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', oauth_token: googleJwt({}) },
    profiles: [
      { id: GOOGLE_ID, role: 'admin', status: 'active' },
      { id: EMAIL_ID, role: 'user', status: 'active' },
    ],
  });
  assert.equal(res.status, 400);
  assert.match(json.error, /satu-satunya administrator aktif/);
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: konfirmasi salah tetap ditolak sebelum verifikasi apa pun', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'SALAH', oauth_token: googleJwt({}) },
  });
  assert.equal(res.status, 400);
  assert.match(json.error, /Ketik HAPUS/);
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('OAuth: verifikasi bukti segar terjadi SEBELUM deleteUser (guard statis)', () => {
  const src = fs.readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
  const deleteAt = src.indexOf('adminClient.auth.admin.deleteUser');
  assert.ok(deleteAt > 0, 'deleteUser harus ada');
  assert.ok(src.indexOf('isFreshTimestamp(oauthAt') > 0, 'cek kesegaran amr harus ada');
  assert.ok(src.indexOf('isFreshTimestamp(oauthAt') < deleteAt, 'cek kesegaran harus sebelum deleteUser');
  assert.ok(src.indexOf("providersOf(authData.user)") < deleteAt, 'cek Google-only harus sebelum deleteUser');
  assert.ok(src.indexOf('oauth_token') < deleteAt, 'cabang oauth_token harus sebelum deleteUser');
});

/* ============================================================
   §2 Server — jalur password (regresi: perilaku lama tak berubah)
   ============================================================ */
test('Password: akun ber-password + password benar tetap DITERIMA', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'email-session-token',
    body: { confirmation: 'HAPUS', password: 'Benar#1234' },
  });
  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(db.state.deleteUserCalls, [EMAIL_ID]);
});

test('Password: password salah DITOLAK', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'email-session-token',
    body: { confirmation: 'HAPUS', password: 'Salah#1234' },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Kata sandi tidak valid.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

test('Password: Google-only yang mengirim password (tidak punya) DITOLAK seperti dulu', async () => {
  const { res, json, db } = await callDeleteAccount({
    headerToken: 'google-session-token',
    body: { confirmation: 'HAPUS', password: 'apa-pun' },
  });
  assert.equal(res.status, 401);
  assert.equal(json.error, 'Kata sandi tidak valid.');
  assert.deepEqual(db.state.deleteUserCalls, []);
});

/* ============================================================
   §3 Klien — web/supabase-admin.js (vm, pola admin-last-activity)
   ============================================================ */
function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function loadSupabaseAdmin(invokeImpl) {
  const invokeCalls = [];
  const core = {
    sb: {
      functions: {
        invoke: async (fnName, opts) => {
          // Simpan salinan polos (JSON) — objek lintas-realm vm gagal
          // deepStrictEqual karena prototipe berbeda (pelajaran tes ini).
          invokeCalls.push(JSON.parse(JSON.stringify({ fnName, body: opts && opts.body })));
          return invokeImpl ? invokeImpl(fnName, opts && opts.body) : { data: { success: true }, error: null };
        },
      },
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      rpc: async () => ({ data: null, error: null }),
    },
    fail: (error) => { if (error) throw new Error(error.message || String(error)); },
    fetchAll: async () => [],
    setSetting: async () => {},
    handlers: {},
  };
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.__mkSb = core;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/supabase-admin.js', 'utf8'), sandbox, { filename: 'supabase-admin.js' });
  assert.ok(core.handlers.api_deleteOwnAccount, 'supabase-admin.js harus mengekspos api_deleteOwnAccount');
  return { core, invokeCalls, sandbox };
}

test('admin: api_deleteOwnAccount meneruskan oauth_token tanpa password', async () => {
  const { core, invokeCalls } = loadSupabaseAdmin();
  const ok = await core.handlers.api_deleteOwnAccount('HAPUS', null, 'fresh-token-abc');
  assert.equal(ok, true);
  assert.deepEqual(invokeCalls, [
    { fnName: 'delete-account', body: { confirmation: 'HAPUS', oauth_token: 'fresh-token-abc' } },
  ]);
});

test('admin: api_deleteOwnAccount jalur password tidak berubah', async () => {
  const { core, invokeCalls } = loadSupabaseAdmin();
  const ok = await core.handlers.api_deleteOwnAccount('HAPUS', 'KataSandi#1');
  assert.equal(ok, true);
  assert.deepEqual(invokeCalls, [
    { fnName: 'delete-account', body: { confirmation: 'HAPUS', password: 'KataSandi#1' } },
  ]);
});

test('admin: tanpa password dan tanpa token tetap melempar (minta password)', async () => {
  const { core, invokeCalls } = loadSupabaseAdmin();
  await assert.rejects(() => core.handlers.api_deleteOwnAccount('HAPUS', ''), /Masukkan password/);
  await assert.rejects(() => core.handlers.api_deleteOwnAccount('HAPUS'), /Masukkan password/);
  assert.deepEqual(invokeCalls, []);
});

test('admin: konfirmasi salah melempar sebelum invoke', async () => {
  const { core, invokeCalls } = loadSupabaseAdmin();
  await assert.rejects(() => core.handlers.api_deleteOwnAccount('SALAH', 'pw'), /Ketik HAPUS/);
  assert.deepEqual(invokeCalls, []);
});

test('admin: error server (mis. Verifikasi ulang gagal.) diteruskan sebagai pesan', async () => {
  const { core } = loadSupabaseAdmin(() => ({ data: null, error: { message: 'Verifikasi ulang gagal.', context: null } }));
  await assert.rejects(
    () => core.handlers.api_deleteOwnAccount('HAPUS', null, 'token-basi'),
    /Verifikasi ulang gagal\./,
  );
});

/* ============================================================
   §4 Klien — web/ui-feat-account.js (vm + Swal/callServer stub)
   ============================================================ */
function loadAccountUi({ user, session } = {}) {
  const localStorage = createStorage({ lang: 'id' });
  const sessionStorage = createStorage({});
  const inputValues = { 'del-acc-confirm': 'HAPUS', 'del-acc-password': 'KataSandi#1' };
  const swalCalls = [];
  const oauthCalls = [];
  const callServerCalls = [];
  const logoutCalls = [];
  const authCallbacks = [];
  const sb = {
    auth: {
      getUser: async () => ({ data: { user: user || null }, error: null }),
      getSession: async () => ({ data: { session: session || null }, error: null }),
      signInWithOAuth: async (opts) => { oauthCalls.push(opts); return { data: {}, error: null }; },
      signInWithPassword: async () => ({ data: {}, error: null }),
      onAuthStateChange: (cb) => {
        authCallbacks.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  const sandbox = {
    localStorage,
    sessionStorage,
    document: {
      documentElement: { classList: { contains: () => false } },
      addEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: (id) => (inputValues[id] !== undefined ? { value: inputValues[id] } : null),
      visibilityState: 'visible',
    },
    navigator: { onLine: true },
    location: { origin: 'https://liandimiko.github.io', pathname: '/mykeuangan/' },
    Swal: {
      fire: async (opts) => {
        swalCalls.push(opts);
        if (opts && typeof opts.preConfirm === 'function') {
          const v = opts.preConfirm();
          if (v === false) return { isConfirmed: false, value: undefined };
          return { isConfirmed: true, value: v };
        }
        if (opts && typeof opts.didOpen === 'function') opts.didOpen();
        return { isConfirmed: true, value: {} };
      },
      showValidationMessage: () => {},
      showLoading: () => {},
      close: () => {},
    },
    getSwalClass: () => '',
    // JANGAN pasang callServer di sini: ui-state.js menimpa
    // window.callServer tanpa syarat (Object.assign di akhir file,
    // defaultCallServer). Stub dipasang SETELAH semua modul dimuat
    // (lihat akhir loadAccountUi) — ui-feat-account.js membaca global
    // itu saat dipanggil, jadi penugasan belakangan tetap berlaku.
    console,
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextEncoder, TextDecoder,
    crypto: webcrypto,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.__mkSb = { sb };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/error-messages.js', 'utf8'), sandbox, { filename: 'error-messages.js' });
  vm.runInContext(fs.readFileSync('web/ui-state.js', 'utf8'), sandbox, { filename: 'ui-state.js' });
  const i18nHtml = fs.readFileSync('src/i18n.html', 'utf8');
  const scriptMatch = i18nHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'expected <script> block in src/i18n.html');
  vm.runInContext(scriptMatch[1], sandbox, { filename: 'i18n.html' });
  vm.runInContext(fs.readFileSync('web/ui-feat-account.js', 'utf8'), sandbox, { filename: 'ui-feat-account.js' });
  assert.ok(sandbox.__mkFeat && sandbox.__mkFeat.googleDelete, 'ui-feat-account.js harus mengekspos __mkFeat.googleDelete');
  // Pasang stub callServer SETELAH ui-state.js (ia menimpa callServer
  // dengan defaultCallServer saat dimuat — lihat komentar di atas).
  // Salinan polos (JSON) supaya deepStrictEqual lintas-realm lolos.
  sandbox.callServer = async (fn, ...args) => {
    callServerCalls.push(JSON.parse(JSON.stringify({ fn, args })));
    return true;
  };
  sandbox.logout = async (opts) => { logoutCalls.push(JSON.parse(JSON.stringify(opts))); };
  return {
    sandbox, swalCalls, oauthCalls, callServerCalls, logoutCalls, authCallbacks,
    sessionStorage, localStorage,
    setInput: (id, value) => { inputValues[id] = value; },
    googleDelete: sandbox.__mkFeat.googleDelete,
  };
}

const googleUser = { ...USERS[GOOGLE_ID] };
const emailUser = { ...USERS[EMAIL_ID] };

test('ui: deteksi Google-only dari app_metadata.providers', () => {
  const { googleDelete } = loadAccountUi();
  assert.equal(googleDelete.isGoogleOnlyAccount({ app_metadata: { providers: ['google'] } }), true);
  assert.equal(googleDelete.isGoogleOnlyAccount({ app_metadata: { providers: ['email'] } }), false);
  assert.equal(googleDelete.isGoogleOnlyAccount({ app_metadata: { providers: ['google', 'email'] } }), false);
  assert.equal(googleDelete.isGoogleOnlyAccount({ app_metadata: { provider: 'google' } }), true);
  assert.equal(googleDelete.isGoogleOnlyAccount({ app_metadata: {} }), false);
  assert.equal(googleDelete.isGoogleOnlyAccount({}), false);
  assert.equal(googleDelete.isGoogleOnlyAccount(null), false);
  assert.deepEqual(googleDelete.authProvidersOf({ app_metadata: { providers: ['google'] } }), ['google']);
});

test('ui: kesegaran token lokal — segar, basi, dan iat-segar-amr-basi', () => {
  const { googleDelete } = loadAccountUi();
  assert.equal(googleDelete.isFreshGoogleSessionToken(googleJwt({})), true);
  assert.equal(googleDelete.isFreshGoogleSessionToken(googleJwt({ iatAgeSec: 1800, amrAgeSec: 1800 })), false);
  // Kunci (sama seperti server): refresh mencetak iat baru tapi amr basi.
  assert.equal(googleDelete.isFreshGoogleSessionToken(googleJwt({ iatAgeSec: 60, amrAgeSec: 7200 })), false);
  assert.equal(googleDelete.isFreshGoogleSessionToken(googleJwt({ amrMethod: null })), false);
  assert.equal(googleDelete.isFreshGoogleSessionToken(googleJwt({ amrMethod: 'password' })), false);
  assert.equal(googleDelete.isFreshGoogleSessionToken('bukan-jwt'), false);
  assert.equal(googleDelete.isFreshGoogleSessionToken(null), false);
  assert.equal(googleDelete.isFreshGoogleSessionToken(googleJwt({ iatAgeSec: -3600 })), false);
});

test('ui: Google-only + sesi sudah segar → dialog akhir, kirim oauth_token, tanpa redirect', async () => {
  const freshToken = googleJwt({});
  const ctx = loadAccountUi({ user: googleUser, session: { access_token: freshToken, user: googleUser } });
  await ctx.sandbox.deleteOwnAccountFlow();
  assert.deepEqual(ctx.oauthCalls, []);
  assert.deepEqual(ctx.callServerCalls, [
    { fn: 'api_deleteOwnAccount', args: ['HAPUS', null, freshToken] },
  ]);
  assert.deepEqual(ctx.logoutCalls, [{ force: true }]);
  // Dialog akhir tidak menampilkan kolom password.
  const firstDialog = ctx.swalCalls[0];
  assert.match(firstDialog.html, /login ulang Google/);
  assert.doesNotMatch(firstDialog.html, /del-acc-password/);
});

test('ui: Google-only + sesi basi → minta login ulang Google (prompt select_account) + penanda resume', async () => {
  const staleToken = googleJwt({ iatAgeSec: 1800, amrAgeSec: 1800 });
  const ctx = loadAccountUi({ user: googleUser, session: { access_token: staleToken, user: googleUser } });
  await ctx.sandbox.deleteOwnAccountFlow();
  assert.equal(ctx.oauthCalls.length, 1);
  assert.equal(ctx.oauthCalls[0].provider, 'google');
  assert.equal(ctx.oauthCalls[0].options.redirectTo, 'https://liandimiko.github.io/mykeuangan/');
  assert.equal(ctx.oauthCalls[0].options.queryParams.prompt, 'select_account');
  assert.deepEqual(ctx.callServerCalls, []);
  const pending = JSON.parse(ctx.sessionStorage.getItem('mk_delete_account_google_pending_v1'));
  assert.equal(pending.confirmation, 'HAPUS');
  assert.ok(Date.now() - pending.startedAt < 5000);
  assert.match(ctx.swalCalls[0].html, /login ulang dengan Google/);
  assert.match(ctx.swalCalls[0].confirmButtonText, /Lanjutkan dengan Google/);
});

test('ui: akun ber-password → dialog lama (password), tanpa OAuth', async () => {
  const ctx = loadAccountUi({ user: emailUser, session: { access_token: 'email-session-token', user: emailUser } });
  await ctx.sandbox.deleteOwnAccountFlow();
  assert.deepEqual(ctx.oauthCalls, []);
  assert.deepEqual(ctx.callServerCalls, [
    { fn: 'api_deleteOwnAccount', args: ['HAPUS', 'KataSandi#1'] },
  ]);
  assert.deepEqual(ctx.logoutCalls, [{ force: true }]);
  assert.match(ctx.swalCalls[0].html, /del-acc-password/);
});

test('ui: resume setelah kembali dari Google → dialog akhir + kirim token segar + penanda dibersihkan', async () => {
  const freshToken = googleJwt({});
  const ctx = loadAccountUi({ user: googleUser, session: { access_token: freshToken, user: googleUser } });
  // Beri kesempatan panggilan resume saat-modul-dimuat selesai dulu
  // (ia berjalan fire-and-forget dan memakai flag sekali-jalan; tanpa
  // jeda ini, panggilan eksplisit di bawah ditolak karena flag masih
  // terkunci oleh panggilan saat-load yang belum membaca penanda).
  await new Promise((r) => setTimeout(r, 0));
  ctx.sessionStorage.setItem('mk_delete_account_google_pending_v1', JSON.stringify({ confirmation: 'HAPUS', startedAt: Date.now() }));
  await ctx.googleDelete.maybeResumeGoogleDeleteAccount();
  assert.deepEqual(ctx.callServerCalls, [
    { fn: 'api_deleteOwnAccount', args: ['HAPUS', null, freshToken] },
  ]);
  assert.deepEqual(ctx.logoutCalls, [{ force: true }]);
  assert.equal(ctx.sessionStorage.getItem('mk_delete_account_google_pending_v1'), null);
});

test('ui: resume dengan penanda kedaluwarsa (> 10 menit) → diam, penanda dibersihkan', async () => {
  const freshToken = googleJwt({});
  const ctx = loadAccountUi({ user: googleUser, session: { access_token: freshToken, user: googleUser } });
  await new Promise((r) => setTimeout(r, 0));
  ctx.sessionStorage.setItem('mk_delete_account_google_pending_v1', JSON.stringify({ confirmation: 'HAPUS', startedAt: Date.now() - 11 * 60 * 1000 }));
  const swalBefore = ctx.swalCalls.length;
  await ctx.googleDelete.maybeResumeGoogleDeleteAccount();
  assert.deepEqual(ctx.callServerCalls, []);
  assert.equal(ctx.swalCalls.length, swalBefore);
  assert.equal(ctx.sessionStorage.getItem('mk_delete_account_google_pending_v1'), null);
});

test('ui: resume dengan sesi basi (bukan fresh login) → beri tahu kedaluwarsa, jangan hapus', async () => {
  const staleToken = googleJwt({ iatAgeSec: 1800, amrAgeSec: 1800 });
  const ctx = loadAccountUi({ user: googleUser, session: { access_token: staleToken, user: googleUser } });
  await new Promise((r) => setTimeout(r, 0));
  ctx.sessionStorage.setItem('mk_delete_account_google_pending_v1', JSON.stringify({ confirmation: 'HAPUS', startedAt: Date.now() }));
  await ctx.googleDelete.maybeResumeGoogleDeleteAccount();
  assert.deepEqual(ctx.callServerCalls, []);
  assert.equal(ctx.sessionStorage.getItem('mk_delete_account_google_pending_v1'), null);
  assert.ok(ctx.swalCalls.some((c) => /Kedaluwarsa/.test(c.title || '')), 'harus ada dialog info kedaluwarsa');
});

test('ui: resume terdaftar pada SIGNED_IN (deep link native / callback belakangan)', async () => {
  const ctx = loadAccountUi({ user: googleUser, session: null });
  assert.equal(ctx.authCallbacks.length, 1);
  // Simulasi event SIGNED_IN tanpa penanda: tidak boleh melempar / dialog.
  await ctx.authCallbacks[0]('SIGNED_IN');
  assert.deepEqual(ctx.callServerCalls, []);
  assert.deepEqual(ctx.swalCalls, []);
});

/* ============================================================
   §5 Regresi jalur admin auto-hapus (account-cleanup, service-role)
   — function ini TIDAK melewati delete-account dan TIDAK diubah.
   ============================================================ */
test('cleanup: account-cleanup tetap memakai service-role + x-cron-secret, tanpa delete-account', () => {
  const src = fs.readFileSync('supabase/functions/account-cleanup/index.ts', 'utf8');
  assert.match(src, /auth\.admin\.deleteUser/);
  assert.match(src, /x-cron-secret/);
  // Tidak memanggil edge function delete-account (hanya menyebutnya di
  // komentar sebagai pola yang ditiru) dan tidak mengenal oauth_token.
  assert.doesNotMatch(src, /functions\.invoke\(['"]delete-account['"]/);
  assert.doesNotMatch(src, /oauth_token/);
});

test('wiring: resume + OAuth terpasang di sumber klien', () => {
  const ui = fs.readFileSync('web/ui-feat-account.js', 'utf8');
  assert.match(ui, /mk_delete_account_google_pending_v1/);
  assert.match(ui, /signInWithOAuth\(\{\s*provider: 'google'/);
  assert.match(ui, /prompt: 'select_account'/);
  assert.match(ui, /onAuthStateChange\(\(event\) => \{\s*if \(event === 'SIGNED_IN'/);
  assert.match(ui, /maybeResumeGoogleDeleteAccount\(\)/);
  const admin = fs.readFileSync('web/supabase-admin.js', 'utf8');
  assert.match(admin, /async api_deleteOwnAccount\(confirmation, password, oauthToken\)/);
  assert.match(admin, /oauth_token: oauthToken/);
});
