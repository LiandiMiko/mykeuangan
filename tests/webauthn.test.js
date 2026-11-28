const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');

// Gelombang 7c — WebAuthn / passkey server (supabase/functions/webauthn).
// Edge function TS Deno TIDAK bisa di-require langsung node --test, jadi
// tes ini mengeksekusi sumber aslinya di vm setelah type-stripping
// Node 24, dengan Deno.env / createClient yang di-stub — mengikuti gaya
// guard-test + vm-sandbox repo (tests/wave3-edge-functions.test.js).
// Bedanya dengan harness itu: (1) import supabase-js di webauthn adalah
// DINAMIS di dalam handler (sengaja — supaya helper murni tetap bisa
// diimpor langsung Node tanpa resolver `npm:`), jadi loader di sini
// mengganti `await import('npm:...')` dengan stub; (2) fake Builder
// mendukung `.is(col, null)` yang dipakai consumeChallenge.

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RP_ID = 'example.com';
const ORIGIN = 'https://example.com';

/* ============================================================
   Fake Supabase (query builder generik + auth)
   ============================================================ */
function createFakeDb(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const calls = { inserts: [], updates: [] };
  let idCounter = 1;

  const matchFilters = (row, filters) => filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'neq') return String(v) !== String(val);
    if (op === 'gte') return v >= val;
    if (op === 'gt') return v > val;
    if (op === 'lt') return v < val;
    if (op === 'lte') return v <= val;
    if (op === 'is') return val === null ? v == null : v === val;
    return true;
  });

  class Builder {
    constructor(table) { this.table = table; this.filters = []; this.op = null; this.payload = null; }
    select() { return this; }
    eq(c, v) { this.filters.push(['eq', c, v]); return this; }
    neq(c, v) { this.filters.push(['neq', c, v]); return this; }
    gte(c, v) { this.filters.push(['gte', c, v]); return this; }
    gt(c, v) { this.filters.push(['gt', c, v]); return this; }
    lt(c, v) { this.filters.push(['lt', c, v]); return this; }
    lte(c, v) { this.filters.push(['lte', c, v]); return this; }
    is(c, v) { this.filters.push(['is', c, v]); return this; }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    update(patch) { this.op = 'update'; this.payload = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    async maybeSingle() { const r = await this._exec(); const d = r.data || []; return { data: d[0] ?? null, error: r.error }; }
    then(res, rej) { return this._exec().then(res, rej); }
    _exec() {
      const table = (tables[this.table] = tables[this.table] || []);
      const rows = table.filter((r) => matchFilters(r, this.filters));
      if (this.op === 'insert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => {
          const row = { ...r };
          if (row.id == null) row.id = `gen-${idCounter++}`;
          return row;
        });
        table.push(...list);
        calls.inserts.push({ table: this.table, rows: JSON.parse(JSON.stringify(list)) });
        return Promise.resolve({ data: list, error: null });
      }
      if (this.op === 'update') {
        rows.forEach((r) => Object.assign(r, this.payload));
        calls.updates.push({ table: this.table, patch: JSON.parse(JSON.stringify(this.payload)), rows: JSON.parse(JSON.stringify(rows)) });
        return Promise.resolve({ data: rows, error: null });
      }
      if (this.op === 'delete') {
        tables[this.table] = table.filter((r) => !matchFilters(r, this.filters));
        return Promise.resolve({ data: rows, error: null });
      }
      return Promise.resolve({ data: rows, error: null });
    }
  }

  function makeClient(label) {
    return {
      __label: label,
      from: (table) => new Builder(table),
      auth: {
        getUser: async (token) => {
          if (token === 'user-token') return { data: { user: { id: USER_ID, email: 'user@example.com' } }, error: null };
          return { data: { user: null }, error: { message: 'invalid token' } };
        },
      },
    };
  }
  return { tables, calls, makeClient };
}

/* ============================================================
   Loader modul TS ke vm
   ============================================================ */
function loadWebAuthnModule(db, env = {}) {
  const envMap = new Map(Object.entries({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ...env,
  }));
  const registry = {};
  const sandbox = {
    console,
    Deno: { env: { get: (k) => envMap.get(k), set: (k, v) => envMap.set(k, v) } },
    crypto: webcrypto,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextEncoder, TextDecoder,
    Request, Response, Headers, URL,
    setTimeout, clearTimeout,
    __deps: { supabase: { createClient: (_url, key) => db.makeClient(key === 'service-key' ? 'service' : 'anon') } },
    __mods: registry,
    __captureServe: (fn) => { sandbox.__handler = fn; },
    __handler: null,
  };
  sandbox.window = sandbox;
  const relPath = 'supabase/functions/webauthn/index.ts';
  let js = stripTypeScriptTypes(fs.readFileSync(relPath, 'utf8'), { mode: 'strip' });
  // Import dinamis supabase-js -> stub fake.
  js = js.replace(/await import\(['"]npm:[^'"]+['"]\)/g, '__deps.supabase');
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]npm:[^'"]+['"];?/g, (_m, names) => `const { ${names.split(',').map((s) => s.trim()).filter(Boolean).join(', ')} } = __deps.supabase;`);
  js = js.replace(/Deno\.serve\(/g, '__captureServe(');
  const exported = [...js.matchAll(/export\s+(?:const|let|var|async function|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  js = js.replace(/export\s+(const|let|var|async function|function)\s/g, '$1 ');
  js += `\n__mods['./index'] = { ${exported.join(', ')} };`;
  vm.runInNewContext(js, sandbox, { filename: relPath });
  assert.ok(sandbox.__handler, 'handler harus ditangkap via Deno.serve');
  return { mod: sandbox.__mods['./index'], handler: sandbox.__handler };
}

async function postReq(handler, { token, body, origin = ORIGIN, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const req = new Request('https://example.supabase.co/functions/v1/webauthn', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
  });
  const res = await handler(req);
  let parsed = null;
  try { parsed = await res.json(); } catch (_) { parsed = null; }
  return { status: res.status, body: parsed, headers: res.headers };
}

/* ============================================================
   Pembangun artefak WebAuthn (test vector nyata, kunci P-256 asli)
   ============================================================ */
function cborEncode(value) {
  const out = [];
  const enc = (v) => {
    if (typeof v === 'number' && Number.isInteger(v)) {
      if (v >= 0) {
        if (v < 24) out.push(v);
        else if (v < 256) out.push(0x18, v);
        else if (v < 65536) out.push(0x19, v >> 8, v & 0xff);
        else { out.push(0x1a, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
      } else {
        const n = -1 - v;
        if (n < 24) out.push(0x20 + n);
        else if (n < 256) out.push(0x38, n);
        else if (n < 65536) out.push(0x39, n >> 8, n & 0xff);
        else throw new Error('neg int terlalu besar untuk tes');
      }
      return;
    }
    if (typeof v === 'string') {
      const bytes = new TextEncoder().encode(v);
      if (bytes.length < 24) out.push(0x60 + bytes.length);
      else if (bytes.length < 256) out.push(0x78, bytes.length);
      else throw new Error('string terlalu panjang untuk tes');
      out.push(...bytes);
      return;
    }
    if (v instanceof Uint8Array) {
      if (v.length < 24) out.push(0x40 + v.length);
      else if (v.length < 256) out.push(0x58, v.length);
      else throw new Error('bytes terlalu panjang untuk tes');
      out.push(...v);
      return;
    }
    if (Array.isArray(v)) {
      if (v.length < 24) out.push(0x80 + v.length);
      else throw new Error('array terlalu panjang untuk tes');
      v.forEach(enc);
      return;
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length < 24) out.push(0xa0 + keys.length);
      else throw new Error('map terlalu panjang untuk tes');
      for (const k of keys) { enc(/^-?\d+$/.test(k) ? Number(k) : k); enc(v[k]); }
      return;
    }
    if (v === false) { out.push(0xf4); return; }
    if (v === true) { out.push(0xf5); return; }
    if (v === null) { out.push(0xf6); return; }
    throw new Error('tipe CBOR tidak didukung di tes: ' + typeof v);
  };
  enc(value);
  return new Uint8Array(out);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  return new Uint8Array(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

async function makeKeyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
}

async function rpIdHash(rpId = RP_ID) {
  return new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
}

function clientDataBytes({ type, challenge, origin = ORIGIN }) {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
}

async function makeAssertion({ keyPair, challenge, counter, origin = ORIGIN, type = 'webauthn.get', rpId = RP_ID }) {
  const hash = await rpIdHash(rpId);
  const authData = new Uint8Array(37);
  authData.set(hash, 0);
  authData[32] = 0x05; // UP + UV
  authData[33] = (counter >>> 24) & 0xff;
  authData[34] = (counter >>> 16) & 0xff;
  authData[35] = (counter >>> 8) & 0xff;
  authData[36] = counter & 0xff;
  const clientData = clientDataBytes({ type, challenge, origin });
  const clientHash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', clientData));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);
  const signature = new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signed));
  return { authData, clientData, signature };
}

async function makeAttestation({ jwk, challenge, origin = ORIGIN, rpId = RP_ID, credId, counter = 0 }) {
  const hash = await rpIdHash(rpId);
  const xBytes = b64urlToBytes(jwk.x);
  const yBytes = b64urlToBytes(jwk.y);
  const cose = cborEncode({ 1: 2, 3: -7, '-1': 1, '-2': xBytes, '-3': yBytes });
  const authData = new Uint8Array(37 + 16 + 2 + credId.length + cose.length);
  authData.set(hash, 0);
  authData[32] = 0x45; // UP + UV + AT
  authData[33] = (counter >>> 24) & 0xff;
  authData[34] = (counter >>> 16) & 0xff;
  authData[35] = (counter >>> 8) & 0xff;
  authData[36] = counter & 0xff;
  authData[53] = 0;
  authData[54] = credId.length;
  authData.set(credId, 55);
  authData.set(cose, 55 + credId.length);
  const attestationObject = cborEncode({ fmt: 'none', attStmt: {}, authData });
  const clientData = clientDataBytes({ type: 'webauthn.create', challenge, origin });
  return { attestationObject, clientData };
}

// Alur lengkap via handler: begin enrollment -> finish-enrollment.
// Mengembalikan credentialId + artefak kunci untuk assertion berikut.
async function enrollViaHandler(handler, db) {
  const { pair, jwk } = await makeKeyPair();
  const credId = new TextEncoder().encode('cred-7c-1');
  const begun = await postReq(handler, { token: 'user-token', body: { action: 'begin', purpose: 'enrollment' } });
  assert.equal(begun.status, 200, 'begin enrollment harus 200');
  const att = await makeAttestation({ jwk, challenge: begun.body.challenge, credId });
  const done = await postReq(handler, {
    token: 'user-token',
    body: {
      action: 'finish-enrollment',
      credentialId: b64url(credId),
      attestationObject: b64url(att.attestationObject),
      clientDataJSON: b64url(att.clientData),
      transports: ['internal'],
    },
  });
  assert.equal(done.status, 200, 'finish-enrollment harus 200: ' + JSON.stringify(done.body));
  assert.equal(done.body.verified, true);
  return { pair, jwk, credId, credentialIdB64: b64url(credId), db };
}

/* ============================================================
   §1 — Helper murni (tanpa Deno, tanpa DB)
   ============================================================ */

test('7c §1: base64url encode/decode round-trip (tanpa padding)', async () => {
  const { mod } = loadWebAuthnModule(createFakeDb());
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 16, 32, 64, 128]);
  const enc = mod.base64UrlEncode(bytes);
  assert.equal(enc.includes('='), false, 'hasil encode tidak boleh mengandung padding');
  assert.equal(enc.includes('+'), false);
  assert.equal(enc.includes('/'), false);
  assert.deepEqual(Array.from(mod.base64UrlDecode(enc)), Array.from(bytes));
  assert.deepEqual(Array.from(mod.base64UrlDecode('')), []);
});

test('7c §1: cborDecode round-trip (map, int negatif, bytes, string, bool)', async () => {
  const { mod } = loadWebAuthnModule(createFakeDb());
  const value = { 1: 2, 3: -7, '-1': 1, '-2': new Uint8Array([9, 8, 7]), name: 'tes', ok: true, none: null };
  const decoded = mod.cborDecode(cborEncode(value), 0).value;
  assert.equal(decoded[1], 2);
  assert.equal(decoded[3], -7);
  assert.equal(decoded[-1], 1);
  assert.deepEqual(Array.from(decoded[-2]), [9, 8, 7]);
  assert.equal(decoded.name, 'tes');
  assert.equal(decoded.ok, true);
  assert.equal(decoded.none, null);
  assert.throws(() => mod.cborDecode(new Uint8Array([]), 0), /CBOR tidak lengkap/);
});

test('7c §1: parseAttestationObject membaca kunci EC P-256 asli; kunci RSA ditolak', async () => {
  const { mod } = loadWebAuthnModule(createFakeDb());
  const { jwk } = await makeKeyPair();
  const credId = new TextEncoder().encode('cred-7c-1');
  const att = await makeAttestation({ jwk, challenge: 'x', credId, counter: 7 });
  const parsed = mod.parseAttestationObject(att.attestationObject);
  assert.equal(parsed.fmt, 'none');
  assert.equal(parsed.credIdB64, b64url(credId));
  assert.equal(parsed.counter, 7);
  // JWK lahir di realm vm — bandingkan lewat JSON, bukan deepEqual ketat.
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.jwk)), jwk, 'JWK hasil parse harus sama dengan kunci asli');
  // COSE bukan EC P-256 (alg -257 / RSA) harus ditolak.
  const hash = await rpIdHash();
  const coseRsa = cborEncode({ 1: 3, 3: -257, '-1': 1, '-2': new Uint8Array(32).fill(1), '-3': new Uint8Array(32).fill(2) });
  const authData = new Uint8Array(37 + 16 + 2 + credId.length + coseRsa.length);
  authData.set(hash, 0);
  authData[32] = 0x45;
  authData[54] = credId.length;
  authData.set(credId, 55);
  authData.set(coseRsa, 55 + credId.length);
  assert.throws(
    () => mod.parseAttestationObject(cborEncode({ fmt: 'none', attStmt: {}, authData })),
    /bukan EC P-256/,
  );
  // Tanpa flag AT (0x40) harus ditolak.
  const noAt = new Uint8Array(authData);
  noAt[32] = 0x05;
  assert.throws(
    () => mod.parseAttestationObject(cborEncode({ fmt: 'none', attStmt: {}, authData: noAt })),
    /tanpa data kunci/,
  );
});

test('7c §1: verifyClientDataFields + verifyRpIdHash', async () => {
  const { mod } = loadWebAuthnModule(createFakeDb());
  const clientData = mod.parseClientData(clientDataBytes({ type: 'webauthn.get', challenge: 'c1' }));
  assert.equal(mod.verifyClientDataFields(clientData, 'webauthn.get', 'c1', ORIGIN), true);
  assert.equal(mod.verifyClientDataFields(clientData, 'webauthn.create', 'c1', ORIGIN), false, 'type salah');
  assert.equal(mod.verifyClientDataFields(clientData, 'webauthn.get', 'lain', ORIGIN), false, 'challenge salah');
  assert.equal(mod.verifyClientDataFields(clientData, 'webauthn.get', 'c1', 'https://evil.example'), false, 'origin salah');
  assert.equal(mod.verifyClientDataFields(clientData, 'webauthn.get', 'c1', ''), false, 'origin kosong tidak boleh lolos');
  const authData = new Uint8Array(37);
  authData.set(await rpIdHash(), 0);
  assert.equal(await mod.verifyRpIdHash(authData, RP_ID), true);
  assert.equal(await mod.verifyRpIdHash(authData, 'lain.example'), false);
  assert.equal(await mod.verifyRpIdHash(authData, ''), true, 'tanpa rpId tidak ada yang dicek');
  assert.equal(await mod.verifyRpIdHash(new Uint8Array(10), RP_ID), false, 'authData pendek ditolak');
});

test('7c §1: verifyAssertionSignature — tanda tangan P-256 asli lolos, yang diubah ditolak', async () => {
  const { mod } = loadWebAuthnModule(createFakeDb());
  const { pair, jwk } = await makeKeyPair();
  const other = await makeKeyPair();
  const assertion = await makeAssertion({ keyPair: pair, challenge: 'sig-1', counter: 3 });
  assert.equal(
    await mod.verifyAssertionSignature(jwk, assertion.authData, assertion.clientData, assertion.signature),
    true, 'tanda tangan asli harus lolos',
  );
  // clientData diubah (challenge lain) -> tanda tangan tidak cocok.
  const tamperedClient = clientDataBytes({ type: 'webauthn.get', challenge: 'sig-lain' });
  assert.equal(
    await mod.verifyAssertionSignature(jwk, assertion.authData, tamperedClient, assertion.signature),
    false, 'clientData yang diubah harus menggagalkan verifikasi',
  );
  // Satu byte tanda tangan diubah -> gagal.
  const badSig = new Uint8Array(assertion.signature);
  badSig[10] ^= 0xff;
  assert.equal(
    await mod.verifyAssertionSignature(jwk, assertion.authData, assertion.clientData, badSig),
    false, 'tanda tangan yang diubah harus ditolak',
  );
  // Kunci orang lain -> gagal.
  assert.equal(
    await mod.verifyAssertionSignature(other.jwk, assertion.authData, assertion.clientData, assertion.signature),
    false, 'kunci yang salah harus menolak tanda tangan',
  );
});

/* ============================================================
   §2 — Handler HTTP (begin / finish-enrollment / finish-assertion)
   ============================================================ */

test('7c §2: tanpa JWT -> 401; token tidak valid -> 401; method bukan POST -> 405', async () => {
  const { handler } = loadWebAuthnModule(createFakeDb());
  const noAuth = await postReq(handler, { body: { action: 'begin', purpose: 'assertion' } });
  assert.equal(noAuth.status, 401);
  assert.match(noAuth.body.error, /Sesi login tidak valid/);
  const badToken = await postReq(handler, { token: 'token-palsu', body: { action: 'begin', purpose: 'assertion' } });
  assert.equal(badToken.status, 401);
  const get = await postReq(handler, { token: 'user-token', body: {}, method: 'GET' });
  assert.equal(get.status, 405);
});

test('7c §2: OPTIONS menjawab CORS; env Supabase hilang -> 500 yang jelas', async () => {
  const { handler } = loadWebAuthnModule(createFakeDb());
  const optReq = new Request('https://example.supabase.co/functions/v1/webauthn', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  const optRes = await handler(optReq);
  assert.equal(optRes.status, 200);
  assert.equal(optRes.headers.get('Access-Control-Allow-Origin'), '*');
  const noEnv = loadWebAuthnModule(createFakeDb(), { SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
  const res = await postReq(noEnv.handler, { token: 'user-token', body: { action: 'begin', purpose: 'assertion' } });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /belum dikonfigurasi/);
});

test('7c §2: begin menerbitkan challenge sekali pakai kedaluwarsa 5 menit', async () => {
  const db = createFakeDb();
  const { handler } = loadWebAuthnModule(db);
  const before = Date.now();
  const res = await postReq(handler, { token: 'user-token', body: { action: 'begin', purpose: 'enrollment' } });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.challenge, 'string');
  assert.ok(res.body.challenge.length >= 40, 'challenge 32 byte base64url ~43 karakter');
  assert.equal(res.body.rpId, RP_ID, 'rpId diturunkan dari origin');
  const rows = db.tables.webauthn_challenges;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USER_ID);
  assert.equal(rows[0].challenge, res.body.challenge);
  assert.equal(rows[0].purpose, 'enrollment');
  assert.equal(rows[0].used_at, undefined);
  const ttlMs = Date.parse(rows[0].expires_at) - before;
  assert.ok(ttlMs > 4.5 * 60 * 1000 && ttlMs <= 5 * 60 * 1000 + 5000, `TTL harus ~5 menit, dapat ${ttlMs}ms`);
  // Tanpa purpose -> default assertion.
  const res2 = await postReq(handler, { token: 'user-token', body: { action: 'begin' } });
  assert.equal(res2.status, 200);
  assert.equal(db.tables.webauthn_challenges[1].purpose, 'assertion');
  // Aksi tidak dikenal -> 400.
  const bad = await postReq(handler, { token: 'user-token', body: { action: 'ngawur' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Aksi tidak dikenal/);
});

test('7c §2: enrollment penuh menyimpan JWK EC P-256; challenge terpakai ulang ditolak', async () => {
  const db = createFakeDb();
  const { handler } = loadWebAuthnModule(db);
  const { jwk, credentialIdB64 } = await enrollViaHandler(handler, db);
  const creds = db.tables.webauthn_credentials;
  assert.equal(creds.length, 1);
  assert.equal(creds[0].user_id, USER_ID);
  assert.equal(creds[0].credential_id, credentialIdB64);
  // Baris lahir di realm vm — bandingkan lewat JSON, bukan deepEqual ketat.
  assert.deepEqual(JSON.parse(JSON.stringify(creds[0].public_key)), jwk);
  assert.equal(creds[0].counter, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(creds[0].transports)), ['internal']);
  // Challenge enrollment sudah ditandai terpakai.
  assert.ok(db.tables.webauthn_challenges[0].used_at, 'challenge harus ditandai used_at');

  // Coba enrollment kedua dengan challenge YANG SAMA (replay) -> 400.
  const { pair } = await makeKeyPair();
  const credId2 = new TextEncoder().encode('cred-7c-2');
  const challenge = db.tables.webauthn_challenges[0].challenge;
  const att2 = await makeAttestation({ jwk, challenge, credId: credId2 });
  const replay = await postReq(handler, {
    token: 'user-token',
    body: {
      action: 'finish-enrollment',
      credentialId: b64url(credId2),
      attestationObject: b64url(att2.attestationObject),
      clientDataJSON: b64url(att2.clientData),
      transports: ['internal'],
    },
  });
  assert.equal(replay.status, 400);
  assert.match(replay.body.error, /Challenge tidak valid atau sudah dipakai/);
  assert.equal(db.tables.webauthn_credentials.length, 1, 'replay tidak boleh menambah kredensial');
  void pair;
});

test('7c §2: enrollment menolak challenge kedaluwarsa, origin salah, dan credentialId tidak cocok', async () => {
  const db = createFakeDb();
  const { handler } = loadWebAuthnModule(db);
  const { jwk } = await makeKeyPair();
  const credId = new TextEncoder().encode('cred-7c-9');

  // (a) challenge kedaluwarsa: tanam langsung baris yang sudah lewat.
  const expired = 'challenge-kedaluwarsa-1';
  db.tables.webauthn_challenges = [{
    id: 'gen-1', user_id: USER_ID, challenge: expired, purpose: 'enrollment',
    expires_at: new Date(Date.now() - 60 * 1000).toISOString(), used_at: null,
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  }];
  const attExpired = await makeAttestation({ jwk, challenge: expired, credId });
  const resExpired = await postReq(handler, {
    token: 'user-token',
    body: {
      action: 'finish-enrollment', credentialId: b64url(credId),
      attestationObject: b64url(attExpired.attestationObject), clientDataJSON: b64url(attExpired.clientData),
    },
  });
  assert.equal(resExpired.status, 400);
  assert.match(resExpired.body.error, /Challenge tidak valid atau sudah dipakai/);

  // (b) origin salah di clientData.
  const begun = await postReq(handler, { token: 'user-token', body: { action: 'begin', purpose: 'enrollment' } });
  const attWrongOrigin = await makeAttestation({ jwk, challenge: begun.body.challenge, origin: 'https://evil.example', credId });
  const resOrigin = await postReq(handler, {
    token: 'user-token', origin: ORIGIN,
    body: {
      action: 'finish-enrollment', credentialId: b64url(credId),
      attestationObject: b64url(attWrongOrigin.attestationObject), clientDataJSON: b64url(attWrongOrigin.clientData),
    },
  });
  assert.equal(resOrigin.status, 400);
  assert.match(resOrigin.body.error, /clientData tidak valid/);

  // (c) credentialId body tidak cocok dengan attestation.
  const begun2 = await postReq(handler, { token: 'user-token', body: { action: 'begin', purpose: 'enrollment' } });
  const att2 = await makeAttestation({ jwk, challenge: begun2.body.challenge, credId });
  const resMismatch = await postReq(handler, {
    token: 'user-token',
    body: {
      action: 'finish-enrollment', credentialId: b64url(new TextEncoder().encode('cred-lain')),
      attestationObject: b64url(att2.attestationObject), clientDataJSON: b64url(att2.clientData),
    },
  });
  assert.equal(resMismatch.status, 400);
  assert.match(resMismatch.body.error, /credentialId tidak cocok/);

  // (d) field tidak lengkap -> 400.
  const resIncomplete = await postReq(handler, { token: 'user-token', body: { action: 'finish-enrollment', credentialId: 'x' } });
  assert.equal(resIncomplete.status, 400);
  assert.match(resIncomplete.body.error, /tidak lengkap/);
});

test('7c §2: assertion penuh lolos + counter naik; replay challenge yang sama ditolak', async () => {
  const db = createFakeDb();
  const { handler } = loadWebAuthnModule(db);
  const { pair, credentialIdB64 } = await enrollViaHandler(handler, db);

  const begun = await postReq(handler, { token: 'user-token', body: { action: 'begin', purpose: 'assertion' } });
  assert.equal(begun.status, 200);
  const assertion = await makeAssertion({ keyPair: pair, challenge: begun.body.challenge, counter: 1 });
  const payload = {
    action: 'finish-assertion',
    credentialId: credentialIdB64,
    clientDataJSON: b64url(assertion.clientData),
    authenticatorData: b64url(assertion.authData),
    signature: b64url(assertion.signature),
    userHandle: '',
  };
  const ok = await postReq(handler, { token: 'user-token', body: payload });
  assert.equal(ok.status, 200, 'assertion asli harus 200: ' + JSON.stringify(ok.body));
  assert.equal(ok.body.verified, true);
  assert.equal(db.tables.webauthn_credentials[0].counter, 1, 'counter tersimpan harus naik ke 1');
  assert.ok(db.tables.webauthn_credentials[0].last_used_at, 'last_used_at harus diisi');

  // Replay payload yang SAMA PERSIS (challenge sudah terpakai) -> 400.
  const replay = await postReq(handler, { token: 'user-token', body: payload });
  assert.equal(replay.status, 400);
  assert.match(replay.body.error, /Challenge tidak valid atau sudah dipakai/);
  assert.equal(db.tables.webauthn_credentials[0].counter, 1, 'counter tidak boleh berubah oleh replay');
});

test('7c §2: assertion menolak counter yang tidak naik (anti-kloning), kredensial tak dikenal, dan tanda tangan buruk', async () => {
  const db = createFakeDb();
  const { handler } = loadWebAuthnModule(db);
  const { pair, credentialIdB64 } = await enrollViaHandler(handler, db);

  async function attemptAssertion({ keyPair = pair, counter, credentialId = credentialIdB64, challengeOverride } = {}) {
    const begun = challengeOverride
      ? { body: { challenge: challengeOverride } }
      : await postReq(handler, { token: 'user-token', body: { action: 'begin', purpose: 'assertion' } });
    const assertion = await makeAssertion({ keyPair, challenge: begun.body.challenge, counter });
    return postReq(handler, {
      token: 'user-token',
      body: {
        action: 'finish-assertion',
        credentialId,
        clientDataJSON: b64url(assertion.clientData),
        authenticatorData: b64url(assertion.authData),
        signature: b64url(assertion.signature),
        userHandle: '',
      },
    });
  }

  // Naikkan counter tersimpan ke 5 dulu (assertion sah).
  const first = await attemptAssertion({ counter: 5 });
  assert.equal(first.status, 200, 'assertion counter 5 harus lolos: ' + JSON.stringify(first.body));
  assert.equal(db.tables.webauthn_credentials[0].counter, 5);

  // Counter sama (5) -> kloning -> 400.
  const same = await attemptAssertion({ counter: 5 });
  assert.equal(same.status, 400);
  assert.match(same.body.error, /Counter tidak naik/);
  // Counter lebih kecil (3) -> 400.
  const lower = await attemptAssertion({ counter: 3 });
  assert.equal(lower.status, 400);
  assert.match(lower.body.error, /Counter tidak naik/);
  // Counter naik (6) -> lolos lagi.
  const higher = await attemptAssertion({ counter: 6 });
  assert.equal(higher.status, 200);
  assert.equal(db.tables.webauthn_credentials[0].counter, 6);

  // Kredensial tidak dikenal -> 404.
  const unknown = await attemptAssertion({ counter: 7, credentialId: b64url(new TextEncoder().encode('cred-asing')) });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /Kredensial tidak dikenal/);

  // Tanda tangan dari kunci lain (tapi credentialId benar) -> 400.
  const other = await makeKeyPair();
  const badSig = await attemptAssertion({ keyPair: other.pair, counter: 8 });
  assert.equal(badSig.status, 400);
  assert.match(badSig.body.error, /Tanda tangan tidak valid/);
});

test('7c §2: assertion menolak challenge kedaluwarsa dan origin salah', async () => {
  const db = createFakeDb();
  const { handler } = loadWebAuthnModule(db);
  const { pair, credentialIdB64 } = await enrollViaHandler(handler, db);

  // Challenge kedaluwarsa: tanam baris lewat, lalu assertion memakainya.
  const expired = 'challenge-assertion-kedaluwarsa';
  db.tables.webauthn_challenges.push({
    id: 'gen-9', user_id: USER_ID, challenge: expired, purpose: 'assertion',
    expires_at: new Date(Date.now() - 60 * 1000).toISOString(), used_at: null,
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const assertion = await makeAssertion({ keyPair: pair, challenge: expired, counter: 10 });
  const resExpired = await postReq(handler, {
    token: 'user-token',
    body: {
      action: 'finish-assertion', credentialId: credentialIdB64,
      clientDataJSON: b64url(assertion.clientData), authenticatorData: b64url(assertion.authData),
      signature: b64url(assertion.signature), userHandle: '',
    },
  });
  assert.equal(resExpired.status, 400);
  assert.match(resExpired.body.error, /Challenge tidak valid atau sudah dipakai/);

  // Origin salah.
  const begun = await postReq(handler, { token: 'user-token', body: { action: 'begin', purpose: 'assertion' } });
  const wrongOrigin = await makeAssertion({ keyPair: pair, challenge: begun.body.challenge, counter: 11, origin: 'https://evil.example' });
  const resOrigin = await postReq(handler, {
    token: 'user-token',
    body: {
      action: 'finish-assertion', credentialId: credentialIdB64,
      clientDataJSON: b64url(wrongOrigin.clientData), authenticatorData: b64url(wrongOrigin.authData),
      signature: b64url(wrongOrigin.signature), userHandle: '',
    },
  });
  assert.equal(resOrigin.status, 400);
  assert.match(resOrigin.body.error, /clientData tidak valid/);
});

/* ============================================================
   §3 — Guard migrasi + flag klien
   ============================================================ */

test('7c §3: migrasi 20261128070000 memuat tabel + RLS + policy + revoke purge (guard)', () => {
  const mig = fs.readFileSync('supabase/migrations/20261128070000_wave3_webauthn.sql', 'utf8');
  assert.doesNotMatch(mig, /DRAFT — BELUM DIVERIFIKASI/, 'label DRAFT harus sudah dicabut setelah verifikasi 7c');
  assert.match(mig, /create table if not exists public\.webauthn_credentials/);
  assert.match(mig, /create table if not exists public\.webauthn_challenges/);
  assert.match(mig, /constraint webauthn_credentials_public_key_is_ec check/);
  assert.match(mig, /alter table public\.webauthn_credentials enable row level security/);
  assert.match(mig, /alter table public\.webauthn_challenges enable row level security/);
  assert.match(mig, /create policy webauthn_credentials_select_own/);
  assert.match(mig, /create policy webauthn_credentials_delete_own/);
  assert.match(mig, /create policy webauthn_challenges_none/);
  assert.match(mig, /using \(false\)/);
  assert.match(mig, /purge_expired_webauthn_challenges/);
  // Pelajaran Wave 4: revoke harus dari public, anon (dan authenticated).
  assert.match(mig, /revoke execute on function public\.purge_expired_webauthn_challenges\(\)\s*\n?\s*from public, anon, authenticated/);
  assert.match(mig, /grant execute on function public\.purge_expired_webauthn_challenges\(\)\s*\n?\s*to service_role/);
  // Jebakan yang diketahui tidak boleh muncul: hmac/digest tanpa
  // kualifikasi skema, dan to_regproc dengan daftar argumen.
  assert.doesNotMatch(mig, /(?<!extensions\.)\bhmac\s*\(/);
  assert.doesNotMatch(mig, /(?<!extensions\.)\bdigest\s*\(/);
  assert.doesNotMatch(mig, /to_regproc\s*\(/);
});

test('7c §3: edge function tidak lagi berlabel DRAFT; klien mengaktifkan jalur server', () => {
  const edge = fs.readFileSync('supabase/functions/webauthn/index.ts', 'utf8');
  assert.doesNotMatch(edge, /DRAFT — BELUM DIVERIFIKASI/);
  assert.match(edge, /TERVERIFIKASI Gelombang 7c/);
  const ux = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');
  assert.match(ux, /const WEBAUTHN_SERVER_ENABLED = true;/);
  assert.doesNotMatch(ux, /WEBAUTHN_SERVER_ENABLED = false/);
  // Pesan server harus ramah untuk awam: tidak ada error mentah Inggris
  // yang dilempar ke pengguna dari jalur server.
  assert.match(ux, /extractWebAuthnServerError/);
  assert.match(ux, /Tidak dapat terhubung ke server\. Periksa koneksi internet/);
  assert.match(ux, /Verifikasi server gagal\. Coba lagi atau gunakan PIN/);
});
