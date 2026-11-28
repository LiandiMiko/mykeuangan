const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const offlineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
const cacheJs = fs.readFileSync('web/ui-feat-cache.js', 'utf8');
const accountJs = fs.readFileSync('web/ui-feat-account.js', 'utf8');
const shellJs = fs.readFileSync('web/ui-shell.js', 'utf8');
const hooksJs = fs.readFileSync('web/ui-feat-hooks.js', 'utf8');

function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

// IndexedDB palsu (in-memory) yang cukup untuk openOfflineDb: open dengan
// onupgradeneeded, createObjectStore(keyPath), transaction put/get/getAll/delete.
function createFakeIndexedDB() {
  const databases = new Map();
  const fireLater = (fn) => setTimeout(fn, 0);
  class Req {
    constructor() { this.result = undefined; this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; }
  }
  function makeStore(map, keyPath) {
    return {
      put(value) {
        const req = new Req();
        map.set(value[keyPath], value);
        fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
      get(key) {
        const req = new Req();
        req.result = map.has(key) ? map.get(key) : undefined;
        fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
      getAll() {
        const req = new Req();
        req.result = [...map.values()];
        fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
      delete(key) {
        const req = new Req();
        map.delete(key);
        fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      }
    };
  }
  function makeDb(rec) {
    return {
      get objectStoreNames() {
        return { contains: (name) => rec.stores.has(name) };
      },
      createObjectStore(name, opts) {
        if (!rec.stores.has(name)) rec.stores.set(name, new Map());
        rec.keyPaths.set(name, (opts && opts.keyPath) || 'key');
        return makeStore(rec.stores.get(name), rec.keyPaths.get(name));
      },
      transaction(storeName) {
        const tx = {
          objectStore: (n) => makeStore(rec.stores.get(n), rec.keyPaths.get(n)),
          oncomplete: null,
          onerror: null
        };
        fireLater(() => { if (tx.oncomplete) tx.oncomplete(); });
        return tx;
      },
      onversionchange: null,
      onclose: null,
      close() {}
    };
  }
  return {
    _databases: databases,
    open(name, version) {
      const req = new Req();
      fireLater(() => {
        let rec = databases.get(name);
        if (!rec) {
          rec = { version: 0, stores: new Map(), keyPaths: new Map() };
          databases.set(name, rec);
        }
        req.result = makeDb(rec);
        if (version > rec.version) {
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
          rec.version = version;
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
  };
}

function makeSandbox({ fakeIdb, storage, session } = {}) {
  const sandbox = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    localStorage: storage || createStorage(),
    sessionStorage: session || createStorage(),
    indexedDB: fakeIdb || createFakeIndexedDB(),
    navigator: { onLine: true },
    document: { addEventListener: () => {}, getElementById: () => null },
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    console,
    DB: { transactions: [] },
    Swal: { fire: async () => ({}) },
    getSwalClass: () => '',
    t: (k) => k,
    escapeHtmlJS: (s) => String(s ?? ''),
    sessionUser: 'tester'
  };
  sandbox.window = sandbox;
  return sandbox;
}

async function makeDek(sandbox) {
  return sandbox.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
// Objek yang dibuat di dalam vm context punya prototype berbeda, jadi
// deepStrictEqual lintas-realm gagal — bandingkan lewat JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('K2: DEK wrap/unwrap PBKDF2 600k + AES-GCM round-trip, PIN salah ditolak', async () => {
  const sandbox = makeSandbox();
  vm.runInNewContext(offlineJs, sandbox);
  const pc = sandbox.__mkFeat.pinCrypto;
  assert.ok(pc, 'pinCrypto harus diekspor di __mkFeat');

  const dek = await makeDek(sandbox);
  const wrap = await pc.wrapPinDataKey(dek, '1234');
  assert.equal(wrap.format, 'mk-pin-dek-wrap-v1');
  assert.equal(wrap.kdf, 'PBKDF2-SHA256');
  assert.equal(wrap.iterations, 600000);
  assert.ok(wrap.salt && wrap.iv && wrap.wrappedKey);

  const unwrapped = await pc.unwrapPinDataKey(wrap, '1234');
  const env = await pc.encryptWithDek(unwrapped, JSON.stringify({ nominal: 125000 }));
  assert.deepEqual(JSON.parse(await pc.decryptWithDek(unwrapped, env)), { nominal: 125000 });

  await assert.rejects(() => pc.unwrapPinDataKey(wrap, '9999'), 'PIN salah harus gagal unwrap');
  const tampered = { iv: env.iv, ct: env.ct.slice(0, -2) + (env.ct.endsWith('AA') ? 'BB' : 'AA') };
  await assert.rejects(() => pc.decryptWithDek(unwrapped, tampered), 'ciphertext rusak harus gagal dekripsi');
});

test('K2: payload antrean offline terenkripsi, envelope tetap plaintext, export null saat terkunci', async () => {
  const sandbox = makeSandbox();
  vm.runInNewContext(offlineJs, sandbox);
  const feat = sandbox.__mkFeat;
  const dek = await makeDek(sandbox);
  feat.getPinDataKey = () => dek;

  const payload = { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'nasi padang rahasia', walletId: 'w1' };
  await feat.saveOfflineQueueItem({ localId: 'offline-1', op: 'api_addTransaction', payload, createdAt: '2026-11-28T00:00:00.000Z' });

  const raw = JSON.parse(sandbox.localStorage.getItem('mk_offline_tx_queue_v1'));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].localId, 'offline-1');
  assert.equal(raw[0].op, 'api_addTransaction');
  assert.equal(raw[0].payload.__enc, 1);
  assert.ok(raw[0].payload.iv && raw[0].payload.ct);
  assert.doesNotMatch(JSON.stringify(raw), /nasi padang rahasia/);
  assert.doesNotMatch(JSON.stringify(raw), /Makan/);

  assert.deepEqual(plain(await feat.decryptQueuePayload(raw[0])), payload);
  assert.deepEqual(plain(feat.getOfflineQueueSummary()), { pending: 1, failed: 0, total: 1 });
  const exported = await feat.exportOfflineQueuePlaintext();
  assert.equal(exported.length, 1);
  assert.deepEqual(plain(exported[0].payload), payload);

  // mergeQueuedOfflineTx memakai payload terdekripsi (diuji lewat cache di bawah
  // dengan antrean yang sama masih di memori sandbox ini).
  const merged = await (async () => {
    vm.runInNewContext(cacheJs, sandbox);
    return sandbox.mergeQueuedOfflineTx({ transactions: [] });
  })();
  assert.equal(merged.transactions.length, 1);
  assert.equal(merged.transactions[0].kategori, 'Makan');

  // Terkunci: DEK tidak ada di memori + PIN diset -> export null, tapi
  // ringkasan envelope tetap bekerja (untuk agen K3).
  feat.getPinDataKey = () => null;
  sandbox.localStorage.setItem('mk_app_pin_hash', 'pbkdf2$deadbeef');
  assert.equal(await feat.exportOfflineQueuePlaintext(), null);
  assert.deepEqual(plain(feat.getOfflineQueueSummary()), { pending: 1, failed: 0, total: 1 });
});

test('K2: snapshot IndexedDB terenkripsi, dekripsi gagal dianggap tidak ada', async () => {
  const sandbox = makeSandbox();
  vm.runInNewContext(offlineJs, sandbox);
  vm.runInNewContext(cacheJs, sandbox);
  const feat = sandbox.__mkFeat;
  const dek = await makeDek(sandbox);
  feat.getPinDataKey = () => dek;
  sandbox.localStorage.setItem('mk_app_pin_hash', 'pbkdf2$x');

  const data = { transactions: [{ id: 't1', nominal: 123456, keterangan: 'gaji rahasia' }], wallets: [{ id: 'w1' }], currentPeriod: '2026-11' };
  sandbox.saveOfflineSnapshot(data);
  await tick(600);

  const stores = sandbox.indexedDB._databases.get('mykeuangan_offline_db').stores;
  const rec = stores.get('offline_snapshot').get('latest');
  assert.ok(rec, 'snapshot record harus tersimpan');
  assert.equal(rec.user, 'tester');
  assert.ok(rec.savedAt);
  assert.equal(rec.data.__enc, 1);
  assert.doesNotMatch(JSON.stringify(rec), /gaji rahasia/);

  const loaded = await sandbox.loadOfflineSnapshot();
  assert.deepEqual(plain(loaded.data.transactions), plain(data.transactions));

  rec.data = { __enc: 1, iv: rec.data.iv, ct: 'AAAAAAAAAAAAAAAAAAAAAA==' };
  assert.equal(await sandbox.loadOfflineSnapshot(), null, 'dekripsi gagal harus dianggap snapshot tidak ada');
});

test('K2: snapshot plaintext lama dimigrasi ke terenkripsi saat load dengan DEK', async () => {
  const sandbox = makeSandbox();
  vm.runInNewContext(offlineJs, sandbox);
  vm.runInNewContext(cacheJs, sandbox);
  const feat = sandbox.__mkFeat;

  const db = await feat.openOfflineDb();
  await new Promise((resolve) => {
    const tx = db.transaction('offline_snapshot', 'readwrite');
    tx.objectStore('offline_snapshot').put({ key: 'latest', savedAt: '2026-11-01T00:00:00.000Z', user: 'tester', data: { transactions: [{ id: 't9' }], wallets: [] } });
    tx.oncomplete = () => resolve();
  });

  const plain = await sandbox.loadOfflineSnapshot();
  assert.equal(plain.data.transactions[0].id, 't9');

  const dek = await makeDek(sandbox);
  feat.getPinDataKey = () => dek;
  sandbox.localStorage.setItem('mk_app_pin_hash', 'pbkdf2$x');
  const migrated = await sandbox.loadOfflineSnapshot();
  assert.equal(migrated.data.transactions[0].id, 't9');
  const rec = sandbox.indexedDB._databases.get('mykeuangan_offline_db').stores.get('offline_snapshot').get('latest');
  assert.equal(rec.data.__enc, 1, 'snapshot lama harus sudah terenkripsi setelah load dengan DEK');
});

test('K2: snapshot tidak ditulis plaintext saat PIN diset tapi terkunci', async () => {
  const sandbox = makeSandbox();
  vm.runInNewContext(offlineJs, sandbox);
  vm.runInNewContext(cacheJs, sandbox);
  sandbox.localStorage.setItem('mk_app_pin_hash', 'pbkdf2$x');
  // Tanpa getPinDataKey -> DEK tidak tersedia (terkunci).
  sandbox.saveOfflineSnapshot({ transactions: [{ id: 't1' }] });
  await tick(600);
  const dbRec = sandbox.indexedDB._databases.get('mykeuangan_offline_db');
  const rec = dbRec && dbRec.stores.get('offline_snapshot') && dbRec.stores.get('offline_snapshot').get('latest');
  assert.equal(rec, undefined, 'tidak boleh ada snapshot plaintext saat terkunci');
});

test('T2: cooldown PIN tinggal di IndexedDB v3, backoff bertingkat, hapus localStorage tidak membuka kunci', async () => {
  const fakeIdb = createFakeIndexedDB();
  const storage = createStorage();
  const sandbox = makeSandbox({ fakeIdb, storage });
  vm.runInNewContext(offlineJs, sandbox);
  vm.runInNewContext(accountJs, sandbox);
  const pinLock = sandbox.__mkFeat.pinLock;

  assert.deepEqual(plain(await pinLock.readPinLockState()), { attempts: 0, lockedUntil: 0, lockoutCount: 0, failuresTotal: 0, passwordResetRequired: false });
  assert.equal(pinLock.lockoutDurationMs(1), 60000);
  assert.equal(pinLock.lockoutDurationMs(2), 5 * 60000);
  assert.equal(pinLock.lockoutDurationMs(3), 15 * 60000);
  assert.equal(pinLock.lockoutDurationMs(4), 60 * 60000);
  assert.equal(pinLock.lockoutDurationMs(9), 60 * 60000);

  const db = await sandbox.__mkFeat.openOfflineDb();
  assert.equal(db.objectStoreNames.contains('pin_lock_state'), true);
  assert.equal(sandbox.__mkFeat.IDB_VERSION, 3);

  for (let i = 0; i < 5; i++) await pinLock.recordFailedPinAttempt();
  let st = await pinLock.readPinLockState();
  assert.equal(st.lockoutCount, 1);
  assert.equal(st.failuresTotal, 5);
  assert.equal(st.attempts, 0);
  assert.ok(st.lockedUntil - Date.now() > 30000 && st.lockedUntil - Date.now() <= 60000, 'lockout ke-1 harus ~60 detik');
  assert.ok(pinLock.getPinCooldownSeconds() > 0);
  // State TIDAK di localStorage (sumber utama IndexedDB).
  assert.equal(storage.getItem('mk_pin_lock_state_v1'), null);
  const idbState = fakeIdb._databases.get('mykeuangan_offline_db').stores.get('pin_lock_state').get('state');
  assert.equal(idbState.lockoutCount, 1);

  // Hapus kunci localStorage (cara lama membobol cooldown) lalu muat ulang
  // konteks: state lockout harus tetap terbaca dari IndexedDB.
  storage.removeItem('mk_pin_lock_state_v1');
  const sandbox2 = makeSandbox({ fakeIdb, storage: createStorage() });
  vm.runInNewContext(offlineJs, sandbox2);
  vm.runInNewContext(accountJs, sandbox2);
  const pinLock2 = sandbox2.__mkFeat.pinLock;
  st = await pinLock2.readPinLockState();
  assert.equal(st.lockoutCount, 1);
  assert.ok(pinLock2.getPinCooldownSeconds() > 0, 'lockout harus bertahan walau localStorage dibersihkan');

  // Lockout ke-2 = 5 menit.
  await pinLock2.writePinLockState({ ...st, lockedUntil: Date.now() - 1000 });
  for (let i = 0; i < 5; i++) await pinLock2.recordFailedPinAttempt();
  st = await pinLock2.readPinLockState();
  assert.equal(st.lockoutCount, 2);
  assert.ok(st.lockedUntil - Date.now() > 240000 && st.lockedUntil - Date.now() <= 300000, 'lockout ke-2 harus ~5 menit');

  // Lockout ke-3 -> verifikasi password akun wajib.
  await pinLock2.writePinLockState({ ...st, lockedUntil: Date.now() - 1000 });
  for (let i = 0; i < 5; i++) await pinLock2.recordFailedPinAttempt();
  st = await pinLock2.readPinLockState();
  assert.equal(st.lockoutCount, 3);
  assert.equal(st.passwordResetRequired, true);
  assert.equal(pinLock2.isPinPasswordResetRequired(), true);
});

test('T1: PIN diverifikasi sebelum data dimuat/dirender, bukan sesudahnya', async () => {
  // Urutan sumber: gate PIN sebelum getInitialData di ui-shell.js.
  assert.ok(shellJs.indexOf('verifyAppPinIfEnabled') < shellJs.indexOf("callServer('getInitialData')"),
    'loadInitialAppData harus memanggil verifyAppPinIfEnabled sebelum getInitialData');
  assert.match(shellJs, /finishReadyUiState[\s\S]{0,400}mk_pin_unlocked/);
  assert.match(shellJs, /await root\.mergeQueuedOfflineTx/);

  // Wrapper renderAll: gate PIN sebelum _origRenderAll, dan tidak ada lagi
  // pemanggilan verifyAppPinIfEnabled sesudah _origRenderAll() dijalankan.
  assert.equal((hooksJs.match(/feat\.verifyAppPinIfEnabled\(\)/g) || []).length, 1,
    'verifyAppPinIfEnabled hanya dipanggil sekali, di gate sebelum render');
  assert.doesNotMatch(hooksJs, /_origRenderAll\(\);[\s\S]*verifyAppPinIfEnabled/);
  assert.ok(hooksJs.indexOf('mk_pin_unlocked') < hooksJs.indexOf('_origRenderAll()'),
    'renderAll harus mengecek PIN sebelum memanggil _origRenderAll');

  // Biometrik: DEK dicek sebelum sesi dianggap unlocked; unwrap DEK setelah PIN benar.
  assert.match(accountJs, /tryBiometricUnlock[\s\S]{0,600}hasPinDataKey\(\)/);
  assert.match(accountJs, /ensurePinDataKeyAfterUnlock/);
  assert.match(accountJs, /clearPinDataKey/);
  assert.match(accountJs, /mk_pin_data_key_wrap/);
});

test('T1: wrapper renderAll menahan render saat PIN terkunci, lanjut setelah unlock', async () => {
  const storage = createStorage({ mk_app_pin_hash: 'pbkdf2$x' });
  const session = createStorage();
  let origCalls = 0;
  let verifyCalls = 0;
  let verifyResult = false;
  const sandbox = {
    localStorage: storage,
    sessionStorage: session,
    document: { addEventListener: () => {} },
    addEventListener: () => {},
    console,
    renderAll: () => { origCalls += 1; },
    filterHistoriView: () => {},
    renderFinancialRatios: () => {},
    renderAssetAllocation: () => {},
    renderNetWorthChart: () => {},
    checkAndRenderDueRecurringBanner: () => {},
    refreshNotificationBell: () => {},
    isDataReady: false,
    __mkFeat: {
      verifyAppPinIfEnabled: async () => { verifyCalls += 1; return verifyResult; },
      handlePwaShortcutAction: () => {}
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(hooksJs, sandbox);

  sandbox.renderAll();
  await tick();
  assert.equal(verifyCalls, 1);
  assert.equal(origCalls, 0, 'render tidak boleh jalan saat PIN terkunci dan verifikasi gagal');

  verifyResult = true;
  sandbox.renderAll();
  await tick();
  assert.equal(verifyCalls, 2);
  assert.equal(origCalls, 1, 'render jalan setelah unlock berhasil');

  storage.removeItem('mk_app_pin_hash');
  sandbox.renderAll();
  assert.equal(origCalls, 2, 'tanpa PIN, render langsung jalan');
});

test('teks UI PIN jujur: enkripsi data lokal + backoff bertingkat + verifikasi password', () => {
  assert.match(accountJs, /mengenkripsi snapshot/);
  assert.match(accountJs, /AES-GCM 256-bit/);
  assert.match(accountJs, /60 detik → 5 → 15 → 60 menit/);
  assert.match(accountJs, /verifikasi password akun/);
  assert.match(accountJs, /promptAccountPasswordReverify/);
  assert.match(accountJs, /signInWithPassword/);
});

// ---------- Gelombang 7b: PBKDF2 100rb -> 600rb, migrasi transparan ----------
// Fixture "pengguna lama" dibuat dengan tangan (bukan lewat wrapPinDataKey /
// hashPin baru) supaya benar-benar mewakili format lama yang ada di
// perangkat pengguna: hash `pbkdf2$<hex>` (tanpa segmen iterasi = 100rb)
// dan wrap `{iterations: 100000}`.
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function makeLegacyWrap100k(sandbox, dek, pin) {
  const pc = sandbox.__mkFeat.pinCrypto;
  const salt = new Uint8Array(16);
  sandbox.crypto.getRandomValues(salt);
  const iv = new Uint8Array(12);
  sandbox.crypto.getRandomValues(iv);
  const kek = await pc.derivePinKek(pin, salt, 100000);
  const rawDek = await sandbox.crypto.subtle.exportKey('raw', dek);
  const wrapped = await sandbox.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawDek);
  return {
    format: 'mk-pin-dek-wrap-v1',
    kdf: 'PBKDF2-SHA256',
    iterations: 100000,
    salt: b64(salt),
    iv: b64(iv),
    wrappedKey: b64(new Uint8Array(wrapped))
  };
}

async function makeLegacyHash100k(feat, storage, pin, saltHex) {
  // Format lama ASLI: `pbkdf2$<hex>` tanpa segmen iterasi.
  const full = await feat.derivePinHash(pin, saltHex, 100000);
  assert.match(full, /^pbkdf2\$100000\$[0-9a-f]{64}$/);
  const legacy = full.replace(/^pbkdf2\$100000\$/, 'pbkdf2$');
  storage.setItem('mk_app_pin_salt', saltHex);
  storage.setItem('mk_app_pin_hash', legacy);
  return legacy;
}

async function exportDekHex(sandbox, dek) {
  return Buffer.from(await sandbox.crypto.subtle.exportKey('raw', dek)).toString('hex');
}

function loadAccountSandbox({ storage, fakeIdb } = {}) {
  const sandbox = makeSandbox({ fakeIdb, storage });
  // checkPinPolicy memanggil getPasswordPolicy() bila ada; tanpa policy
  // file, kembalikan null supaya fallback regex 4-6 digit dipakai.
  sandbox.getPasswordPolicy = () => null;
  vm.runInNewContext(offlineJs, sandbox);
  vm.runInNewContext(accountJs, sandbox);
  return sandbox;
}

test('7b (a): pengguna baru — hash PIN + wrap DEK langsung 600rb (format baru)', async () => {
  const sandbox = loadAccountSandbox();
  const feat = sandbox.__mkFeat.wave3Auth;
  const pc = sandbox.__mkFeat.pinCrypto;
  assert.equal(feat.PIN_PBKDF2_ITERATIONS, 600000);
  assert.equal(pc.KEK_ITERATIONS, 600000);

  const hash = await feat.hashPin('4829');
  assert.match(hash, /^pbkdf2\$600000\$[0-9a-f]{64}$/);
  assert.equal(await feat.verifyPinMatches('4829', hash), true);

  const dek = await makeDek(sandbox);
  const wrap = await pc.wrapPinDataKey(dek, '4829');
  assert.equal(wrap.iterations, 600000);

  // Jalur pembuatan PIN pertama end-to-end (onboarding): hash + wrap
  // yang tersimpan harus 600rb.
  const sandbox2 = loadAccountSandbox();
  assert.equal(await sandbox2.__mkFeat.saveInitialAppPin('4829'), true);
  assert.match(sandbox2.localStorage.getItem('mk_app_pin_hash'), /^pbkdf2\$600000\$[0-9a-f]{64}$/);
  assert.equal(JSON.parse(sandbox2.localStorage.getItem('mk_pin_data_key_wrap')).iterations, 600000);
});

test('7b (b+c): pengguna lama — unlock PIN benar migrasi hash + wrap ke 600rb, DEK tetap sama', async () => {
  const sandbox = loadAccountSandbox();
  const feat = sandbox.__mkFeat.wave3Auth;
  const pc = sandbox.__mkFeat.pinCrypto;
  const pinOps = sandbox.__mkFeat.pinDataKey;
  const storage = sandbox.localStorage;

  const dek = await makeDek(sandbox);
  const rawBefore = await exportDekHex(sandbox, dek);
  // Data "lama": dienkripsi dengan DEK lama sebelum migrasi.
  const secret = await pc.encryptWithDek(dek, 'saldo rahasia 125000');

  const legacyHash = await makeLegacyHash100k(feat, storage, '1234', '00112233445566778899aabbccddeeff');
  assert.match(legacyHash, /^pbkdf2\$[0-9a-f]{64}$/);
  assert.equal(feat.parsePinHashIterations(legacyHash), 100000);
  storage.setItem('mk_pin_data_key_wrap', JSON.stringify(await makeLegacyWrap100k(sandbox, dek, '1234')));

  // Unlock seperti alur produksi: verifikasi dulu (migrasi hash), lalu
  // ensurePinDataKeyAfterUnlock (unwrap + migrasi wrap).
  assert.equal(await feat.verifyPinMatches('1234', legacyHash), true);
  assert.match(storage.getItem('mk_app_pin_hash'), /^pbkdf2\$600000\$[0-9a-f]{64}$/,
    'hash harus sudah 600rb setelah verifikasi PIN benar');
  assert.equal(await pinOps.ensurePinDataKeyAfterUnlock('1234'), true);
  assert.equal(JSON.parse(storage.getItem('mk_pin_data_key_wrap')).iterations, 600000,
    'wrap harus sudah 600rb setelah unlock');

  // (c) DEK tidak berubah: byte-identik, dan data lama tetap terbaca.
  const dekAfter = sandbox.__mkFeat.getPinDataKey();
  assert.ok(dekAfter, 'DEK harus ada di memori setelah unlock');
  assert.equal(await exportDekHex(sandbox, dekAfter), rawBefore,
    'DEK hasil migrasi harus byte-identik dengan DEK lama (hanya bungkusnya yang berubah)');
  assert.equal(await pc.decryptWithDek(dekAfter, plain(secret)), 'saldo rahasia 125000');

  // Hash baru tetap bisa diverifikasi; unlock kedua tidak mengubah apa pun.
  const hashAfter = storage.getItem('mk_app_pin_hash');
  assert.equal(await feat.verifyPinMatches('1234', hashAfter), true);
  assert.equal(storage.getItem('mk_app_pin_hash'), hashAfter, 'hash 600rb tidak boleh dimigrasi ulang');
  assert.equal(JSON.parse(storage.getItem('mk_pin_data_key_wrap')).iterations, 600000);
});

test('7b (d): PIN salah TIDAK memigrasi apa pun (hash + wrap tetap 100rb)', async () => {
  const sandbox = loadAccountSandbox();
  const feat = sandbox.__mkFeat.wave3Auth;
  const storage = sandbox.localStorage;

  const dek = await makeDek(sandbox);
  const legacyHash = await makeLegacyHash100k(feat, storage, '1234', '00112233445566778899aabbccddeeff');
  const legacyWrap = JSON.stringify(await makeLegacyWrap100k(sandbox, dek, '1234'));
  storage.setItem('mk_pin_data_key_wrap', legacyWrap);

  assert.equal(await feat.verifyPinMatches('9999', legacyHash), false, 'PIN salah ditolak');
  assert.equal(storage.getItem('mk_app_pin_hash'), legacyHash, 'hash lama tidak boleh berubah saat PIN salah');
  assert.equal(storage.getItem('mk_pin_data_key_wrap'), legacyWrap, 'wrap lama tidak boleh berubah saat PIN salah');
  assert.equal(await feat.verifyPinMatches('9999', legacyHash), false, 'PIN salah kedua kali juga ditolak');
  assert.equal(storage.getItem('mk_app_pin_hash'), legacyHash);
  assert.equal(storage.getItem('mk_pin_data_key_wrap'), legacyWrap);

  // PIN benar sesudahnya tetap memigrasi (tidak ada kerusakan akibat
  // percobaan salah sebelumnya).
  assert.equal(await feat.verifyPinMatches('1234', legacyHash), true);
  assert.match(storage.getItem('mk_app_pin_hash'), /^pbkdf2\$600000\$/);
});

test('7b (e): migrasi hash tidak menyentuh state lockout PIN (backoff tetap berjalan)', async () => {
  const fakeIdb = createFakeIndexedDB();
  const storage = createStorage();
  const sandbox = loadAccountSandbox({ fakeIdb, storage });
  const feat = sandbox.__mkFeat.wave3Auth;
  const pinLock = sandbox.__mkFeat.pinLock;

  // Satu lockout sudah tercatat sebelum migrasi (5x salah = kunci 60 detik).
  for (let i = 0; i < 5; i++) await pinLock.recordFailedPinAttempt();
  let st = await pinLock.readPinLockState();
  assert.equal(st.lockoutCount, 1);
  assert.equal(st.failuresTotal, 5);

  const legacyHash = await makeLegacyHash100k(feat, storage, '1234', '00112233445566778899aabbccddeeff');
  assert.equal(await feat.verifyPinMatches('1234', legacyHash), true);
  assert.match(storage.getItem('mk_app_pin_hash'), /^pbkdf2\$600000\$/);

  st = await pinLock.readPinLockState();
  assert.equal(st.lockoutCount, 1, 'migrasi tidak boleh mengubah lockoutCount');
  assert.equal(st.failuresTotal, 5, 'migrasi tidak boleh mengubah failuresTotal');
  assert.ok(st.lockedUntil > Date.now(), 'cooldown 60 detik tetap berjalan setelah migrasi');
  assert.ok(pinLock.getPinCooldownSeconds() > 0);
});

test('7b (f): wrap rusak tetap ditangani seperti semula — DEK baru, tanpa crash, wrap baru 600rb', async () => {
  const sandbox = loadAccountSandbox();
  const feat = sandbox.__mkFeat.wave3Auth;
  const pc = sandbox.__mkFeat.pinCrypto;
  const pinOps = sandbox.__mkFeat.pinDataKey;
  const storage = sandbox.localStorage;

  storage.setItem('mk_app_pin_hash', await feat.hashPin('1234'));
  const dek = await makeDek(sandbox);
  const goodWrap = plain(await pc.wrapPinDataKey(dek, '1234'));
  const corrupt = { ...goodWrap, wrappedKey: b64(Buffer.from('rusakrusakrusakrusakrusakrusakru')) };
  storage.setItem('mk_pin_data_key_wrap', JSON.stringify(corrupt));

  assert.equal(await pinOps.ensurePinDataKeyAfterUnlock('1234'), true,
    'unlock dengan wrap rusak tidak boleh crash');
  assert.ok(sandbox.__mkFeat.getPinDataKey(), 'DEK baru harus tersedia setelah wrap rusak');
  assert.equal(JSON.parse(storage.getItem('mk_pin_data_key_wrap')).iterations, 600000,
    'wrap pengganti harus 600rb');

  // JSON wrap rusak total (bukan JSON) juga ditangani sama.
  storage.setItem('mk_pin_data_key_wrap', '{bukan-json');
  sandbox.__mkFeat.clearPinDataKey();
  assert.equal(await pinOps.ensurePinDataKeyAfterUnlock('1234'), true);
  assert.ok(sandbox.__mkFeat.getPinDataKey());
  assert.equal(JSON.parse(storage.getItem('mk_pin_data_key_wrap')).iterations, 600000);
});

test('7b: wrap tanpa field iterations dibuka dengan 100rb (fallback legacy)', async () => {
  const sandbox = makeSandbox();
  vm.runInNewContext(offlineJs, sandbox);
  const pc = sandbox.__mkFeat.pinCrypto;
  const dek = await makeDek(sandbox);
  const wrap = await makeLegacyWrap100k(sandbox, dek, '1234');
  delete wrap.iterations;
  const unwrapped = await pc.unwrapPinDataKey(wrap, '1234');
  assert.equal(await exportDekHex(sandbox, unwrapped), await exportDekHex(sandbox, dek));
  await assert.rejects(() => pc.unwrapPinDataKey(wrap, '9999'), 'PIN salah tetap ditolak pada wrap tanpa iterations');
});

test('7b: ganti PIN — hash + wrap hasil ganti PIN keduanya 600rb, DEK tetap sama, PIN lama ditolak', async () => {
  const sandbox = loadAccountSandbox();
  const feat = sandbox.__mkFeat.wave3Auth;
  const pinOps = sandbox.__mkFeat.pinDataKey;
  const storage = sandbox.localStorage;

  // Pengguna lama 100rb, unlock dulu (migrasi hash + wrap).
  const dek = await makeDek(sandbox);
  const rawBefore = await exportDekHex(sandbox, dek);
  const legacyHash = await makeLegacyHash100k(feat, storage, '1234', '00112233445566778899aabbccddeeff');
  storage.setItem('mk_pin_data_key_wrap', JSON.stringify(await makeLegacyWrap100k(sandbox, dek, '1234')));
  assert.equal(await feat.verifyPinMatches('1234', legacyHash), true);
  assert.equal(await pinOps.ensurePinDataKeyAfterUnlock('1234'), true);

  // Ganti PIN 1234 -> 5678 — jalur yang sama dengan
  // applyAccountSettingsUpdate: rewrap DEK yang sama + hashPin baru.
  assert.equal(await pinOps.rewrapPinDataKey('1234', '5678'), true);
  storage.setItem('mk_app_pin_hash', await feat.hashPin('5678'));
  assert.match(storage.getItem('mk_app_pin_hash'), /^pbkdf2\$600000\$[0-9a-f]{64}$/);
  assert.equal(JSON.parse(storage.getItem('mk_pin_data_key_wrap')).iterations, 600000);

  // PIN baru membuka DEK yang sama; PIN lama ditolak.
  sandbox.__mkFeat.clearPinDataKey();
  assert.equal(await pinOps.unwrapPinDataKey('5678'), true);
  assert.equal(await exportDekHex(sandbox, sandbox.__mkFeat.getPinDataKey()), rawBefore);
  sandbox.__mkFeat.clearPinDataKey();
  assert.equal(await pinOps.unwrapPinDataKey('1234'), false, 'PIN lama tidak boleh lagi membuka wrap');
  assert.equal(await feat.verifyPinMatches('5678', storage.getItem('mk_app_pin_hash')), true);
  assert.equal(await feat.verifyPinMatches('1234', storage.getItem('mk_app_pin_hash')), false);
});
