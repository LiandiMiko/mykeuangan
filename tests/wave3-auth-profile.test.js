const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const policyJs = fs.readFileSync('web/password-policy.js', 'utf8');
const bridgeJs = fs.readFileSync('web/native-bridge.js', 'utf8');
const authJs = fs.readFileSync('web/supabase-auth.js', 'utf8');
const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
const accountJs = fs.readFileSync('web/ui-feat-account.js', 'utf8');
const nativeUxJs = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function baseSandbox(extra) {
  const sandbox = {
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout,
    clearTimeout,
    ...(extra || {})
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadPolicy(sandbox) {
  vm.runInNewContext(policyJs, sandbox);
  return sandbox.__mkPasswordPolicy;
}

/* ============================================================
   S5 — password & PIN policy (shared validator)
   ============================================================ */

function policySandbox() {
  const sandbox = baseSandbox();
  return { sandbox, policy: loadPolicy(sandbox) };
}

test('S5: password lemah ditolak dengan kode spesifik', () => {
  const { policy } = policySandbox();
  const cases = [
    ['aaaaaaaa', 'repeated_chars'],
    ['Abc12345', 'sequential'],
    ['password1', 'common_password'],
    ['qwertyui', 'common_password'],
    ['12345678', 'common_password'],
    ['passwordpassword', 'common_password'],
    ['pendek', 'too_short'],
    ['x'.repeat(129), 'too_long']
  ];
  for (const [pw, code] of cases) {
    const res = policy.validatePassword(pw, { email: 'user@example.com' });
    assert.equal(res.ok, false, `${pw} harus ditolak`);
    assert.ok(res.errors.some((e) => e.code === code), `${pw} harus membawa kode ${code}, dapat ${JSON.stringify(res.errors)}`);
    assert.match(res.errors[0].message, /./, 'pesan error harus terisi');
  }
});

test('S5: password mengandung local-part email ditolak; password kuat diterima', () => {
  const { policy } = policySandbox();
  const withEmail = policy.validatePassword('liandi2026!', { email: 'liandi@example.com' });
  assert.equal(withEmail.ok, false);
  assert.ok(withEmail.errors.some((e) => e.code === 'contains_email'));
  for (const good of ['K3u@ngan!9zQx', 'Tr4nsaksi#2026-Bulan', 'Dompet&Aman-88']) {
    const res = policy.validatePassword(good, { email: 'user@example.com' });
    assert.equal(res.ok, true, `${good} harus diterima`);
    assert.equal(res.errors.length, 0);
  }
});

test('S5: PIN — 111111, 123456, 654321, 1234 ditolak; 482917 diterima', () => {
  const { policy } = policySandbox();
  for (const [pin, code] of [['111111', 'pin_all_same'], ['123456', 'pin_sequential'], ['654321', 'pin_sequential'], ['1234', 'pin_sequential'], ['12a4', 'pin_format']]) {
    const res = policy.validatePin(pin);
    assert.equal(res.ok, false, `${pin} harus ditolak`);
    assert.ok(res.errors.some((e) => e.code === code), `${pin} harus membawa kode ${code}`);
  }
  assert.equal(policy.validatePin('482917').ok, true);
  assert.equal(policy.validatePin('4829').ok, true);
});

/* ============================================================
   S5 — admin client memakai policy (supabase-admin.js)
   ============================================================ */

function loadAdminClient() {
  const calls = [];
  const invokeCalls = [];
  const sandbox = baseSandbox({ sessionRole: 'admin', __mkFeat: {} });
  loadPolicy(sandbox);
  const core = {
    handlers: {},
    sb: {
      functions: {
        invoke: async (fnName, { body } = {}) => {
          invokeCalls.push({ fnName, body });
          return { data: { success: true }, error: null };
        }
      },
      auth: {
        getUser: async () => {
          calls.push('getUser');
          return { data: { user: { id: 'u1', email: 'user@example.com' } }, error: null };
        },
        signInWithPassword: async ({ email, password }) => {
          calls.push('signInWithPassword');
          if (email === 'user@example.com' && password === 'password-lama-benar') {
            return { data: { user: { id: 'u1', email } }, error: null };
          }
          return { data: null, error: new Error('Invalid login credentials') };
        },
        updateUser: async ({ password }) => {
          calls.push('updateUser');
          return { data: { user: { id: 'u1' } }, error: null };
        },
        signOut: async (opts) => {
          calls.push('signOut:' + ((opts && opts.scope) || 'global'));
          return { error: null };
        }
      },
      from: () => { throw new Error('unexpected from()'); },
      rpc: async () => ({ data: null, error: null })
    },
    fail: (error) => { if (error) throw error; },
    fetchAll: async () => [],
    setSetting: async () => {}
  };
  sandbox.__mkSb = core;
  vm.runInNewContext(adminJs, sandbox);
  return { core, calls, invokeCalls, sandbox };
}

test('S5: ganti password sendiri — password lemah ditolak sebelum ada panggilan auth', async () => {
  const { core, calls } = loadAdminClient();
  await assert.rejects(() => core.handlers.api_updateOwnPassword('password-lama-benar', 'aaaaaaaa'), /3 karakter sama/);
  await assert.rejects(() => core.handlers.api_updateOwnPassword('password-lama-benar', 'Abc12345'), /urutan berurutan/);
  await assert.rejects(() => core.handlers.api_updateOwnPassword('password-lama-benar', 'password1'), /terlalu umum/);
  assert.equal(calls.length, 0, 'validasi gagal tidak boleh menyentuh auth sama sekali');
  // Aturan email baru bisa dicek setelah getUser() (email belum diketahui
  // sebelumnya) — tapi tetap sebelum verifikasi password lama.
  await assert.rejects(() => core.handlers.api_updateOwnPassword('password-lama-benar', 'user2026!x'), /bagian dari alamat email/);
  assert.deepEqual(calls, ['getUser'], 'aturan email hanya boleh memanggil getUser, bukan signIn/updateUser');
});

test('S5: ganti password sendiri — password kuat lolos lalu updateUser + cabut sesi lain', async () => {
  const { core, calls } = loadAdminClient();
  await core.handlers.api_updateOwnPassword('password-lama-benar', 'K3u@ngan!9zQx');
  assert.deepEqual(calls, ['getUser', 'signInWithPassword', 'updateUser', 'signOut:others']);
});

test('S5: reset password admin — password lemah ditolak sebelum edge function dipanggil', async () => {
  const { core, invokeCalls } = loadAdminClient();
  await assert.rejects(() => core.handlers.api_adminSetPassword('u2', 'qwertyui'), /terlalu umum/);
  await assert.rejects(() => core.handlers.api_adminSetPassword('u2', '12345678'), /terlalu umum|urutan/);
  assert.equal(invokeCalls.length, 0, 'edge function tidak boleh dipanggil untuk password lemah');
});

test('S5: call-site register / recovery / admin memakai validator bersama', () => {
  assert.match(authJs, /checkPasswordPolicy\(pass, email/);
  assert.match(fs.readFileSync('web/supabase-auth-ui.js', 'utf8'), /checkPasswordPolicy\(pass, recoveryEmail/);
  assert.match(adminJs, /enforcePasswordPolicy\(newPassword/);
  assert.match(adminJs, /enforcePasswordPolicy\(password, null\)/);
  assert.match(accountJs, /checkPinPolicy\(pin\)/);
});

/* ============================================================
   S2 — OAuth native state (web/native-bridge.js)
   ============================================================ */

function loadBridge() {
  const storage = createStorage();
  const session = createStorage();
  const notices = [];
  const exchanges = [];
  const setSessions = [];
  const handledSessions = [];
  const listeners = {};
  const sandbox = baseSandbox({
    localStorage: storage,
    sessionStorage: session,
    document: {
      addEventListener: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
      getElementById: () => null,
      documentElement: { classList: { add: () => {}, contains: () => false } }
    },
    location: { origin: 'https://liandimiko.github.io', hostname: 'liandimiko.github.io' },
    navigator: {},
    open: () => {},
    Swal: { isVisible: () => false, close: () => {} }
  });
  let oauthUrl = '';
  sandbox.__mkSb = {
    sb: {
      auth: {
        signInWithOAuth: async ({ options }) => {
          oauthUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=x';
          return { data: { url: oauthUrl }, error: null };
        },
        exchangeCodeForSession: async (code) => {
          exchanges.push(code);
          return { data: { session: { access_token: 'sess', user: { id: 'u1' } } }, error: null };
        },
        setSession: async (tokens) => {
          setSessions.push(tokens);
          return { data: { session: { access_token: 'planted' } }, error: null };
        }
      }
    },
    showCoreNotice: async (title, msg) => { notices.push({ title, msg }); }
  };
  sandbox.__mkHandleNativeAuthSession = (session) => { handledSessions.push(session); };
  vm.runInNewContext(bridgeJs, sandbox);
  return { sandbox, storage, session, notices, exchanges, setSessions, handledSessions, get oauthUrl() { return oauthUrl; } };
}

test('S2: startNativeOAuth menyimpan state dan meneruskannya via queryParams', async () => {
  const { sandbox, session } = loadBridge();
  const res = await sandbox.startNativeOAuth(sandbox.__mkSb.sb, 'google');
  assert.equal(res.error, undefined);
  const stored = JSON.parse(session.getItem('mk_oauth_state_v1'));
  assert.match(stored.state, /^[A-Za-z0-9_-]{43}$/, 'state harus 32 byte base64url');
  assert.match(stored.nonce, /^[A-Za-z0-9_-]{43}$/, 'nonce harus 32 byte base64url');
  assert.ok(Date.now() - stored.createdAt < 5000);
});

test('S2: callback dengan state cocok diterima sekali; replay ditolak', async () => {
  const { sandbox, session, exchanges, handledSessions } = loadBridge();
  await sandbox.startNativeOAuth(sandbox.__mkSb.sb, 'google');
  const state = JSON.parse(session.getItem('mk_oauth_state_v1')).state;
  const url = `com.mykeuguech.app://auth-callback?code=CODE-1&state=${state}`;
  await sandbox.handleNativeAppUrlOpen(url);
  assert.deepEqual(exchanges, ['CODE-1'], 'exchangeCodeForSession dipanggil sekali');
  assert.equal(handledSessions.length, 1, 'sesi diteruskan ke handler');
  assert.equal(session.getItem('mk_oauth_state_v1'), null, 'state sekali pakai harus terhapus');
  await sandbox.handleNativeAppUrlOpen(url);
  assert.deepEqual(exchanges, ['CODE-1'], 'replay URL yang sama tidak boleh exchange lagi');
});

test('S2: state salah / hilang ditolak; exchangeCodeForSession tidak pernah dipanggil', async () => {
  const { sandbox, session, exchanges, notices } = loadBridge();
  await sandbox.startNativeOAuth(sandbox.__mkSb.sb, 'google');
  await sandbox.handleNativeAppUrlOpen('com.mykeuguech.app://auth-callback?code=CODE-X&state=state-salah');
  await sandbox.handleNativeAppUrlOpen('com.mykeuguech.app://auth-callback?code=CODE-Y');
  assert.deepEqual(exchanges, [], 'tidak ada exchange tanpa state yang cocok');
  assert.ok(notices.length >= 2, 'pengguna diberi tahu penolakan');
});

test('S2: URL hanya berisi access_token+refresh_token ditolak; setSession tidak pernah dipanggil', async () => {
  const { sandbox, session, exchanges, setSessions } = loadBridge();
  await sandbox.startNativeOAuth(sandbox.__mkSb.sb, 'google');
  const state = JSON.parse(session.getItem('mk_oauth_state_v1')).state;
  await sandbox.handleNativeAppUrlOpen(
    `com.mykeuguech.app://auth-callback?state=${state}#access_token=TOKEN-TANAM&refresh_token=REFRESH-TANAM`
  );
  assert.deepEqual(exchanges, [], 'tanpa code tidak ada exchange');
  assert.deepEqual(setSessions, [], 'setSession tidak boleh dipanggil untuk token mentah dari URL');
  assert.doesNotMatch(bridgeJs, /setSession\(\{\s*access_token/);
});

test('S2: state kedaluwarsa (>10 menit) ditolak', async () => {
  const { sandbox, session, exchanges } = loadBridge();
  const pair = sandbox.__mkNativeOAuth.storeOAuthState();
  const stored = JSON.parse(session.getItem('mk_oauth_state_v1'));
  session.setItem('mk_oauth_state_v1', JSON.stringify({ ...stored, createdAt: Date.now() - 11 * 60 * 1000 }));
  await sandbox.handleNativeAppUrlOpen(`com.mykeuguech.app://auth-callback?code=CODE-Z&state=${pair.state}`);
  assert.deepEqual(exchanges, [], 'state kedaluwarsa tidak boleh exchange');
});

/* ============================================================
   S3 — profil hilang / cache (web/supabase-auth.js)
   ============================================================ */

function loadAuthModule({ online, profileResult, cachedProfile }) {
  const storage = createStorage();
  const session = createStorage();
  if (cachedProfile) storage.setItem('mk_cached_profile_v1', JSON.stringify(cachedProfile));
  const signOutCalls = [];
  let readyCalls = 0;
  let reloaded = false;
  const navAdmin = { style: { display: 'none' } };
  const uiUsername = { textContent: '' };
  const uiRole = { textContent: '' };
  const listeners = {};
  const sandbox = baseSandbox({
    localStorage: storage,
    sessionStorage: session,
    document: {
      addEventListener: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
      getElementById: (id) => {
        if (id === 'nav-admin') return navAdmin;
        if (id === 'ui-username') return uiUsername;
        if (id === 'ui-role') return uiRole;
        return null;
      }
    },
    addEventListener: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
    setInterval: () => 0,
    clearInterval: () => {},
    location: { reload: () => { reloaded = true; } },
    navigator: { onLine: online }
  });
  const core = {
    sb: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => profileResult })
        })
      }),
      auth: {
        signOut: async () => { signOutCalls.push(1); return { error: null }; },
        getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' } }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => {}
      }
    },
    fail: (error) => { if (error) throw error; },
    resolveReady: () => { readyCalls++; },
    showCoreNotice: async () => {}
  };
  sandbox.__mkSb = core;
  vm.runInNewContext(authJs, sandbox);
  return {
    sandbox, storage, signOutCalls, navAdmin, uiUsername, uiRole, listeners,
    get readyCalls() { return readyCalls; },
    get reloaded() { return reloaded; }
  };
}

const SESSION = { user: { id: 'u1', email: 'user@example.com', user_metadata: { full_name: 'Liandi' } } };

test('S3: online + profil null + cache admin -> signOut, bukan admin, nav admin tersembunyi, tidak ready', async () => {
  const mod = loadAuthModule({
    online: true,
    profileResult: { data: null, error: null },
    cachedProfile: { userId: 'u1', displayName: 'Admin Lama', role: 'admin', status: 'active', savedAt: new Date().toISOString() }
  });
  await mod.sandbox.__mkAuthTest.finishLogin(SESSION);
  await sleep(10);
  assert.equal(mod.signOutCalls.length, 1, 'harus signOut');
  assert.notEqual(mod.sandbox.sessionRole, 'admin', 'role cache admin tidak boleh dipakai');
  assert.equal(mod.sandbox.sessionRole, 'user');
  assert.equal(mod.navAdmin.style.display, 'none', 'nav admin harus tersembunyi');
  assert.equal(mod.readyCalls, 0, 'resolveReady tidak boleh dipanggil saat profil hilang saat online');
});

test('S3: offline + cache admin segar -> identitas user (bukan admin), ready tetap jalan', async () => {
  const mod = loadAuthModule({
    online: false,
    profileResult: { data: null, error: new Error('network offline') },
    cachedProfile: { userId: 'u1', displayName: 'Admin Lama', role: 'admin', status: 'active', savedAt: new Date().toISOString() }
  });
  await mod.sandbox.__mkAuthTest.finishLogin(SESSION);
  await sleep(10);
  assert.equal(mod.sandbox.sessionRole, 'user', 'offline pun role admin cache harus diturunkan ke user');
  assert.equal(mod.sandbox.sessionUser, 'Admin Lama', 'nama tampilan cache masih boleh dipakai offline');
  assert.equal(mod.navAdmin.style.display, 'none');
  assert.equal(mod.readyCalls, 1, 'offline boleh ready dengan identitas turun');
});

test('S3: cache basi (>24 jam) diabaikan bahkan saat offline', async () => {
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const mod = loadAuthModule({
    online: false,
    profileResult: { data: null, error: new Error('network offline') },
    cachedProfile: { userId: 'u1', displayName: 'Admin Lama', role: 'admin', status: 'active', savedAt: stale }
  });
  assert.equal(mod.sandbox.__mkAuthTest.readCachedProfile('u1'), null, 'readCachedProfile harus menolak cache basi');
  await mod.sandbox.__mkAuthTest.finishLogin(SESSION);
  await sleep(10);
  assert.equal(mod.sandbox.sessionUser, 'Liandi', 'nama fallback dipakai, bukan nama cache basi');
  assert.equal(mod.sandbox.sessionRole, 'user');
});

test('S3: online + profil admin aktif -> role admin, nav tampil, ready', async () => {
  const mod = loadAuthModule({
    online: true,
    profileResult: { data: { display_name: 'Bos', role: 'admin', status: 'active' }, error: null },
    cachedProfile: null
  });
  await mod.sandbox.__mkAuthTest.finishLogin(SESSION);
  await sleep(10);
  assert.equal(mod.sandbox.sessionRole, 'admin');
  assert.equal(mod.navAdmin.style.display, 'flex');
  assert.equal(mod.readyCalls, 1);
});

test('S3: listener online terdaftar untuk re-validasi saat koneksi kembali', () => {
  const mod = loadAuthModule({ online: true, profileResult: { data: { display_name: 'Bos', role: 'user', status: 'active' }, error: null } });
  assert.match(authJs, /addEventListener\('online'/);
  assert.ok((mod.listeners.online || []).length >= 1, 'handler online harus terdaftar');
});

/* ============================================================
   S4 + S6 — PIN & auto-lock (web/ui-feat-account.js)
   ============================================================ */

function loadAccountModule({ appVersion, swalImpl } = {}) {
  const storage = createStorage();
  const session = createStorage();
  const swalCalls = [];
  const logoutCalls = [];
  const listeners = {};
  let intervalCb = null;
  let intervalMs = 0;
  const sandbox = baseSandbox({
    localStorage: storage,
    sessionStorage: session,
    document: {
      addEventListener: (evt, fn, opts) => { (listeners[evt] = listeners[evt] || []).push(fn); },
      getElementById: () => null,
      visibilityState: 'visible',
      querySelector: () => null
    },
    setInterval: (fn, ms) => { intervalCb = fn; intervalMs = ms; return 1; },
    clearInterval: () => {},
    location: { reload: () => {} },
    navigator: { onLine: true },
    Swal: {
      fire: async (opts) => {
        swalCalls.push(opts || {});
        if (typeof swalImpl === 'function') return swalImpl(opts || {});
        return { isDenied: true };
      },
      isVisible: () => false,
      close: () => {},
      getPopup: () => null
    },
    getSwalClass: () => '',
    escapeHtmlJS: (s) => String(s == null ? '' : s),
    showActionError: () => {},
    updateDashboardTitle: () => {},
    openForm: () => {},
    openTransferModal: () => {},
    triggerReceiptOcr: () => {},
    switchView: () => {},
    t: (k) => k,
    callServer: async () => ({}),
    logout: () => { logoutCalls.push(1); },
    __mkFeat: {}
  });
  if (appVersion) sandbox.__mkAppVersion = appVersion;
  loadPolicy(sandbox);
  vm.runInNewContext(accountJs, sandbox);
  return {
    sandbox, storage, session, swalCalls, logoutCalls, listeners,
    get intervalCb() { return intervalCb; },
    get intervalMs() { return intervalMs; }
  };
}

async function sha256Hex(text) {
  const buf = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('S4: interval idle-check 15-30 detik dan listener aktivitas terpasang', () => {
  const mod = loadAccountModule();
  assert.ok(mod.intervalMs >= 15000 && mod.intervalMs <= 30000, `interval harus 15-30 detik, dapat ${mod.intervalMs}ms`);
  for (const evt of ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel']) {
    assert.ok((mod.listeners[evt] || []).length >= 1, `listener ${evt} harus terpasang`);
  }
});

test('S4: tab terlihat + tanpa input 121 detik -> terkunci; aktivitas di 119 detik mereset jam', async () => {
  const mod = loadAccountModule();
  const feat = mod.sandbox.__mkFeat.wave3Auth;
  mod.storage.setItem('mk_app_pin_hash', 'pbkdf2$' + 'aa'.repeat(32));
  mod.session.setItem('mk_pin_unlocked', '1');
  const T0 = Date.now();
  feat.autoLock.setLastActivityAt(T0);
  // Aktivitas di 119 detik: jam idle harus reset.
  feat.autoLock.noteActivity(T0 + 119000);
  assert.equal(feat.autoLock.checkIdleLock(T0 + 121000), false, 'baru 2 detik sejak aktivitas terakhir');
  // Tanpa input 121 detik sejak aktivitas terakhir -> kunci.
  assert.equal(feat.autoLock.checkIdleLock(T0 + 119000 + 121000), true, 'idle 121 detik harus mengunci');
  assert.equal(mod.session.getItem('mk_pin_unlocked'), null, 'mk_pin_unlocked harus dicabut saat lock');
  await sleep(30);
  assert.ok(mod.swalCalls.length >= 1, 'prompt PIN harus ditampilkan setelah lock');
});

test('S4: checkIdleLock tidak mengunci saat PIN belum diset', () => {
  const mod = loadAccountModule();
  const feat = mod.sandbox.__mkFeat.wave3Auth;
  feat.autoLock.setLastActivityAt(Date.now() - 99999999);
  assert.equal(feat.autoLock.checkIdleLock(Date.now()), false);
});

test('S6: hash legacy sebelum cut-off — PIN benar migrasi ke pbkdf2$, PIN salah tidak migrasi', async () => {
  const mod = loadAccountModule({ appVersion: '3.20.6' });
  const feat = mod.sandbox.__mkFeat.wave3Auth;
  const legacy = await sha256Hex('mkpin:1234');
  mod.storage.setItem('mk_app_pin_hash', legacy);
  assert.equal(await feat.verifyPinMatches('9999', legacy), false, 'PIN salah ditolak');
  assert.equal(mod.storage.getItem('mk_app_pin_hash'), legacy, 'PIN salah tidak boleh migrasi');
  assert.equal(await feat.verifyPinMatches('1234', legacy), true, 'PIN benar diterima sebelum cut-off');
  assert.match(mod.storage.getItem('mk_app_pin_hash'), /^pbkdf2\$/, 'hash tersimpan harus sudah pbkdf2$ setelah migrasi');
  // Hash baru yang bermigrasi harus bisa diverifikasi lagi.
  assert.equal(await feat.verifyPinMatches('1234', mod.storage.getItem('mk_app_pin_hash')), true);
});

test('S6: hash legacy setelah cut-off (v3.20.7) — ditolak mentah, hash tidak berubah', async () => {
  const mod = loadAccountModule({ appVersion: '3.20.7' });
  const feat = mod.sandbox.__mkFeat.wave3Auth;
  const legacy = await sha256Hex('mkpin:1234');
  mod.storage.setItem('mk_app_pin_hash', legacy);
  assert.equal(await feat.verifyPinMatches('1234', legacy), false, 'legacy ditolak setelah cut-off');
  assert.equal(mod.storage.getItem('mk_app_pin_hash'), legacy, 'hash tidak boleh berubah saat ditolak');
});

test('S6: derivePinHash selalu memakai prefix pbkdf2$ + iterasi 600rb (Gelombang 7b)', async () => {
  const mod = loadAccountModule();
  const feat = mod.sandbox.__mkFeat.wave3Auth;
  const hash = await feat.derivePinHash('4829', '00112233445566778899aabbccddeeff');
  assert.match(hash, /^pbkdf2\$600000\$[0-9a-f]{64}$/);
  assert.equal(feat.PIN_PBKDF2_ITERATIONS, 600000);
  assert.equal(feat.parsePinHashIterations(hash), 600000);
  // Format lama (tanpa segmen iterasi) dibaca sebagai 100rb.
  assert.equal(feat.parsePinHashIterations('pbkdf2$' + 'aa'.repeat(32)), 100000);
});

test('S6: verifyAppPinIfEnabled setelah cut-off — alur reset via password akun ditawarkan', async () => {
  const mod = loadAccountModule({
    appVersion: '3.20.7',
    swalImpl: (opts) => {
      if (opts.input === 'password') return { isConfirmed: true, value: 'pw-benar' };
      return {};
    }
  });
  mod.sandbox.__mkSb = {
    sb: {
      auth: {
        getUser: async () => ({ data: { user: { email: 'user@example.com' } }, error: null }),
        signInWithPassword: async ({ password }) => {
          if (password === 'pw-benar') return { data: {}, error: null };
          return { data: null, error: new Error('bad') };
        }
      }
    }
  };
  const legacy = await sha256Hex('mkpin:1234');
  mod.storage.setItem('mk_app_pin_hash', legacy);
  const ok = await mod.sandbox.__mkFeat.verifyAppPinIfEnabled();
  assert.equal(ok, true, 'setelah re-verifikasi password, app tidak lagi terkunci');
  assert.equal(mod.storage.getItem('mk_app_pin_hash'), null, 'hash legacy harus dihapus agar PIN baru dibuat');
  assert.ok(mod.swalCalls.some((c) => String(c.title || '').includes('PIN Lama')), 'pengguna harus diberi tahu PIN lama direset');
});

test('S6: saveInitialAppPin menolak PIN lemah (111111 / 123456)', async () => {
  const mod = loadAccountModule();
  assert.equal(await mod.sandbox.__mkFeat.saveInitialAppPin('111111'), false);
  assert.equal(await mod.sandbox.__mkFeat.saveInitialAppPin('123456'), false);
  assert.equal(await mod.sandbox.__mkFeat.saveInitialAppPin('482917'), true);
});

/* ============================================================
   S1 — WebAuthn interim (web/ui-feat-native-ux.js + edge draft)
   ============================================================ */

// CBOR encoder kecil untuk membangun attestationObject di tes.
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

const RP_ID = 'liandimiko.github.io';
const ORIGIN = 'https://liandimiko.github.io';

async function makeKeyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
}

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeAssertion({ keyPair, challenge, counter, origin, type }) {
  const rpIdHash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID)));
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = 0x05; // UP + UV
  authData[33] = (counter >>> 24) & 0xff;
  authData[34] = (counter >>> 16) & 0xff;
  authData[35] = (counter >>> 8) & 0xff;
  authData[36] = counter & 0xff;
  const clientData = new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
  const clientHash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', clientData));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);
  const signature = new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signed));
  return {
    id: 'cred-1',
    rawId: new TextEncoder().encode('cred-1').buffer,
    type: 'public-key',
    response: {
      clientDataJSON: clientData.buffer,
      authenticatorData: authData.buffer,
      signature: signature.buffer,
      userHandle: null
    }
  };
}

function loadNativeUx({ credentialsGet, credentialsCreate, sbInvoke } = {}) {
  const storage = createStorage();
  const session = createStorage();
  const listeners = {};
  const sandbox = baseSandbox({
    localStorage: storage,
    sessionStorage: session,
    document: {
      addEventListener: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
      getElementById: () => null,
      querySelector: () => null,
      body: { contains: () => false },
      documentElement: { classList: { add: () => {}, contains: () => false } }
    },
    location: { origin: ORIGIN, hostname: RP_ID },
    navigator: {
      credentials: {
        get: credentialsGet || (async () => null),
        create: credentialsCreate || (async () => null)
      }
    },
    Swal: { fire: async () => ({}), isVisible: () => false, close: () => {}, getPopup: () => null },
    getSwalClass: () => '',
    sessionUser: 'Liandi',
    // Gelombang 7c: klien memanggil Edge Function lewat __mkSb.sb —
    // tes jalur server menyuplai invoke palsu; tanpa ini klien
    // melempar 'Klien Supabase belum siap untuk WebAuthn server.'
    __mkSb: sbInvoke ? { sb: { functions: { invoke: sbInvoke } } } : undefined
  });
  vm.runInNewContext(nativeUxJs, sandbox);
  return { sandbox, storage, session, listeners };
}

// Gelombang 7c — server WebAuthn palsu untuk tes jalur server klien.
// Meniru kontrak Edge Function `webauthn` (begin / finish-enrollment /
// finish-assertion) memakai helper murni edge yang asli + store memori.
// Melempar FunctionsHttpError seperti supabase-js v2 asli: error.context
// = Response-like dengan .json() -> { error } (pesan ramah server).
function httpError(message) {
  const err = new Error('Edge Function returned a non-2xx status code');
  err.name = 'FunctionsHttpError';
  err.context = { json: async () => ({ error: message }) };
  return err;
}

let edgeModPromise = null;
function getEdgeMod() {
  if (!edgeModPromise) edgeModPromise = import(pathToFileURL('supabase/functions/webauthn/index.ts').href);
  return edgeModPromise;
}

function b64urlDecode(s) {
  return new Uint8Array(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

function createFakeWebAuthnServer(edge) {
  const challenges = new Map(); // challenge -> { purpose, expiresAt, used }
  const credentials = new Map(); // credentialIdB64 -> { jwk, counter }
  function newChallenge() {
    const bytes = new Uint8Array(32);
    webcrypto.getRandomValues(bytes);
    return b64url(bytes);
  }
  function consumeChallenge(challenge, purpose) {
    const row = challenges.get(challenge);
    if (!row || row.purpose !== purpose || row.used || row.expiresAt <= Date.now()) return false;
    row.used = true;
    return true;
  }
  async function invoke(_functionName, { body }) {
    const action = body && body.action;
    if (action === 'begin') {
      const purpose = body.purpose === 'enrollment' ? 'enrollment' : 'assertion';
      const challenge = newChallenge();
      challenges.set(challenge, { purpose, expiresAt: Date.now() + 5 * 60 * 1000, used: false });
      return { data: { challenge, rpId: RP_ID }, error: null };
    }
    if (action === 'finish-enrollment') {
      let parsed;
      let clientData;
      try {
        parsed = edge.parseAttestationObject(b64urlDecode(body.attestationObject));
        clientData = edge.parseClientData(b64urlDecode(body.clientDataJSON));
      } catch (e) {
        throw httpError('Attestation tidak dapat dibaca: ' + e.message);
      }
      if (parsed.credIdB64 !== body.credentialId) throw httpError('credentialId tidak cocok dengan attestation.');
      const challenge = String(clientData.challenge || '');
      if (!challenge || !consumeChallenge(challenge, 'enrollment')) throw httpError('Challenge tidak valid atau sudah dipakai.');
      if (!edge.verifyClientDataFields(clientData, 'webauthn.create', challenge, ORIGIN)) throw httpError('clientData tidak valid.');
      if (!(await edge.verifyRpIdHash(parsed.authData, RP_ID))) throw httpError('RP ID tidak cocok.');
      const flags = parsed.authData[32];
      if (!(flags & 0x01) || !(flags & 0x04)) throw httpError('Verifikasi pengguna (UV) wajib untuk pendaftaran.');
      credentials.set(parsed.credIdB64, { jwk: parsed.jwk, counter: parsed.counter });
      return { data: { verified: true, credentialId: parsed.credIdB64 }, error: null };
    }
    if (action === 'finish-assertion') {
      const cred = credentials.get(body.credentialId);
      if (!cred) throw httpError('Kredensial tidak dikenal.');
      let clientData;
      let authDataBytes;
      let clientBytes;
      let sigBytes;
      try {
        clientBytes = b64urlDecode(body.clientDataJSON);
        authDataBytes = b64urlDecode(body.authenticatorData);
        sigBytes = b64urlDecode(body.signature);
        clientData = edge.parseClientData(clientBytes);
      } catch (e) {
        throw httpError('Assertion tidak dapat dibaca: ' + e.message);
      }
      const challenge = String(clientData.challenge || '');
      if (!challenge || !consumeChallenge(challenge, 'assertion')) throw httpError('Challenge tidak valid atau sudah dipakai.');
      if (!edge.verifyClientDataFields(clientData, 'webauthn.get', challenge, ORIGIN)) throw httpError('clientData tidak valid.');
      if (!(await edge.verifyRpIdHash(authDataBytes, RP_ID))) throw httpError('RP ID tidak cocok.');
      const flags = authDataBytes[32];
      if (!(flags & 0x01) || !(flags & 0x04)) throw httpError('Verifikasi pengguna (UV) wajib.');
      const counter = ((authDataBytes[33] << 24) | (authDataBytes[34] << 16) | (authDataBytes[35] << 8) | authDataBytes[36]) >>> 0;
      if (counter > 0 && cred.counter > 0 && counter <= cred.counter) throw httpError('Counter tidak naik — kemungkinan kredensial terkloning.');
      const ok = await edge.verifyAssertionSignature(cred.jwk, authDataBytes, clientBytes, sigBytes);
      if (!ok) throw httpError('Tanda tangan tidak valid.');
      cred.counter = counter;
      return { data: { verified: true }, error: null };
    }
    throw httpError('Aksi tidak dikenal.');
  }
  return {
    invoke,
    challenges,
    credentials,
    seedCredential(credentialIdB64, jwk, counter = 0) { credentials.set(credentialIdB64, { jwk, counter }); },
  };
}

test('S1: assertion asli lolos; challenge salah, replay, dan {} palsu ditolak', async () => {
  const { pair, jwk } = await makeKeyPair();
  const mod = loadNativeUx();
  const wa = mod.sandbox.__mkFeat.webauthn;
  const challenge = 'tantangan-asli-123';
  const genuine = await makeAssertion({ keyPair: pair, challenge, counter: 1, origin: ORIGIN, type: 'webauthn.get' });
  const ok = await wa.verifyWebAuthnAssertion(genuine, {
    expectedChallenge: challenge, rpId: RP_ID, publicKeyJwk: jwk,
    storedCounter: 0, lastSignatureHash: '',
    onVerified: () => {}
  });
  assert.equal(ok, true, 'assertion asli harus lolos');
  // (a) challenge tidak cocok
  assert.equal(await wa.verifyWebAuthnAssertion(genuine, {
    expectedChallenge: 'tantangan-lain', rpId: RP_ID, publicKeyJwk: jwk, storedCounter: 0, lastSignatureHash: ''
  }), false, 'challenge salah harus ditolak');
  // (b) replay: tanda tangan sama seperti sebelumnya
  const sigHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new Uint8Array(genuine.response.signature))).toString('hex');
  assert.equal(await wa.verifyWebAuthnAssertion(genuine, {
    expectedChallenge: challenge, rpId: RP_ID, publicKeyJwk: jwk, storedCounter: 0, lastSignatureHash: sigHash
  }), false, 'assertion yang dipakai ulang harus ditolak');
  // (c) objek palsu {}
  assert.equal(await wa.verifyWebAuthnAssertion({}, {
    expectedChallenge: challenge, rpId: RP_ID, publicKeyJwk: jwk, storedCounter: 0, lastSignatureHash: ''
  }), false, '{} palsu harus ditolak');
  // counter tidak naik (counter 1 lagi, kunci sama) -> ditolak
  const again = await makeAssertion({ keyPair: pair, challenge, counter: 1, origin: ORIGIN, type: 'webauthn.get' });
  assert.equal(await wa.verifyWebAuthnAssertion(again, {
    expectedChallenge: challenge, rpId: RP_ID, publicKeyJwk: jwk, storedCounter: 1, lastSignatureHash: ''
  }), false, 'counter yang tidak naik harus ditolak');
  // origin salah -> ditolak
  const wrongOrigin = await makeAssertion({ keyPair: pair, challenge, counter: 2, origin: 'https://evil.example', type: 'webauthn.get' });
  assert.equal(await wa.verifyWebAuthnAssertion(wrongOrigin, {
    expectedChallenge: challenge, rpId: RP_ID, publicKeyJwk: jwk, storedCounter: 1, lastSignatureHash: ''
  }), false, 'origin salah harus ditolak');
});

test('S1: tryBiometricUnlock server — palsu ditolak, asli diterima (challenge dari server)', async () => {
  const edge = await getEdgeMod();
  const server = createFakeWebAuthnServer(edge);
  const { pair, jwk } = await makeKeyPair();
  const credIdB64 = b64url(new TextEncoder().encode('cred-1'));
  server.seedCredential(credIdB64, jwk, 0);
  let mode = 'fake';
  const mod = loadNativeUx({
    sbInvoke: server.invoke,
    credentialsGet: async ({ publicKey }) => {
      // Challenge datang dari server lewat publicKey (bukan sessionStorage).
      const challengeB64 = b64url(new Uint8Array(publicKey.challenge));
      if (mode === 'fake') return {};
      if (mode === 'wrong-challenge') {
        return makeAssertion({ keyPair: pair, challenge: 'bukan-challenge-ini', counter: 1, origin: ORIGIN, type: 'webauthn.get' });
      }
      return makeAssertion({ keyPair: pair, challenge: challengeB64, counter: 1, origin: ORIGIN, type: 'webauthn.get' });
    }
  });
  mod.storage.setItem('mk_biometric_pin_enabled', '1');
  mod.storage.setItem('mk_biometric_cred_id', credIdB64);
  // Jalur server TIDAK boleh bergantung pada kunci lokal interim:
  // sengaja tidak mengisi mk_webauthn_pubkey_v1 / counter.

  mode = 'fake';
  assert.equal(await mod.sandbox.__mkFeat.tryBiometricUnlock(), false, '{} palsu tidak boleh membuka kunci');
  mode = 'wrong-challenge';
  assert.equal(await mod.sandbox.__mkFeat.tryBiometricUnlock(), false, 'challenge tidak cocok tidak boleh membuka kunci');
  mode = 'genuine';
  assert.equal(await mod.sandbox.__mkFeat.tryBiometricUnlock(), true, 'assertion asli harus membuka kunci');
  assert.equal(server.credentials.get(credIdB64).counter, 1, 'counter server harus naik setelah unlock');
});

test('S1: enrollment server menyimpan public key di server dan menolak challenge salah', async () => {
  const edge = await getEdgeMod();
  const server = createFakeWebAuthnServer(edge);
  const { jwk } = await makeKeyPair();
  const xBytes = new Uint8Array(Buffer.from(jwk.x.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  const yBytes = new Uint8Array(Buffer.from(jwk.y.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  const credId = new TextEncoder().encode('cred-1');
  const rpIdHash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID)));
  const cose = cborEncode({ 1: 2, 3: -7, '-1': 1, '-2': xBytes, '-3': yBytes });
  const authData = new Uint8Array(37 + 16 + 2 + credId.length + cose.length);
  authData.set(rpIdHash, 0);
  authData[32] = 0x45; // UP + UV + AT
  authData[53] = 0;
  authData[54] = credId.length;
  authData.set(credId, 55);
  authData.set(cose, 55 + credId.length);
  const attestationObject = cborEncode({ fmt: 'none', attStmt: {}, authData });
  const mod = loadNativeUx({
    sbInvoke: server.invoke,
    credentialsCreate: async ({ publicKey }) => {
      // Challenge datang dari server lewat publicKey (bukan sessionStorage).
      const clientChallenge = b64url(new Uint8Array(publicKey.challenge));
      const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: clientChallenge, origin: ORIGIN }));
      return {
        rawId: credId.buffer,
        response: { attestationObject: attestationObject.buffer, clientDataJSON: clientData.buffer }
      };
    }
  });
  const credIdB64 = await mod.sandbox.__mkFeat.webauthn.enrollWebAuthnCredential();
  assert.equal(credIdB64, b64url(credId), 'enrollment mengembalikan credentialId');
  assert.deepEqual(server.credentials.get(credIdB64).jwk, jwk, 'public key harus tersimpan di server');
  assert.equal(mod.storage.getItem('mk_webauthn_pubkey_v1'), null, 'server flow tidak menyimpan kunci di localStorage');
  assert.equal(mod.session.getItem('mk_webauthn_challenge_v1'), null, 'challenge server tidak memakai sessionStorage');

  // Challenge salah (authenticator menjawab challenge yang bukan dari
  // server) -> enrollment melempar pesan ramah server.
  const server2 = createFakeWebAuthnServer(edge);
  const mod2 = loadNativeUx({
    sbInvoke: server2.invoke,
    credentialsCreate: async () => {
      const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: 'salah', origin: ORIGIN }));
      return {
        rawId: credId.buffer,
        response: { attestationObject: attestationObject.buffer, clientDataJSON: clientData.buffer }
      };
    }
  });
  await assert.rejects(
    () => mod2.sandbox.__mkFeat.webauthn.enrollWebAuthnCredential(),
    /Challenge tidak valid atau sudah dipakai/,
    'challenge salah harus ditolak server dengan pesan yang jelas',
  );
  assert.equal(server2.credentials.size, 0, 'enrollment gagal tidak boleh menyimpan kredensial');
});

test('S1: helper verifikasi edge function memverifikasi tanda tangan asli', async () => {
  const edge = await import(pathToFileURL('supabase/functions/webauthn/index.ts').href);
  const { pair, jwk } = await makeKeyPair();
  const challenge = 'edge-challenge-1';
  const assertion = await makeAssertion({ keyPair: pair, challenge, counter: 1, origin: ORIGIN, type: 'webauthn.get' });
  const ok = await edge.verifyAssertionSignature(
    jwk,
    new Uint8Array(assertion.response.authenticatorData),
    new Uint8Array(assertion.response.clientDataJSON),
    new Uint8Array(assertion.response.signature)
  );
  assert.equal(ok, true, 'edge helper harus memverifikasi tanda tangan asli');
  const bad = await edge.verifyAssertionSignature(
    jwk,
    new Uint8Array(assertion.response.authenticatorData),
    new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: 'lain', origin: ORIGIN })),
    new Uint8Array(assertion.response.signature)
  );
  assert.equal(bad, false, 'clientData yang diubah harus menggagalkan verifikasi');
  assert.equal(edge.verifyClientDataFields(
    { type: 'webauthn.get', challenge, origin: ORIGIN }, 'webauthn.get', challenge, ORIGIN
  ), true);
  assert.equal(edge.verifyClientDataFields(
    { type: 'webauthn.get', challenge: 'lain', origin: ORIGIN }, 'webauthn.get', challenge, ORIGIN
  ), false);
});

test('S1: alur server AKTIF — flag menyala, label DRAFT dicabut (Gelombang 7c)', () => {
  assert.equal(loadNativeUx().sandbox.__mkFeat.webauthn.WEBAUTHN_SERVER_ENABLED, true,
    'server flow aktif setelah diverifikasi di Deno + unit test (Gelombang 7c)');
  const edgeSrc = fs.readFileSync('supabase/functions/webauthn/index.ts', 'utf8');
  assert.doesNotMatch(edgeSrc, /DRAFT — BELUM DIVERIFIKASI/);
  assert.match(edgeSrc, /TERVERIFIKASI Gelombang 7c/);
  const migSrc = fs.readFileSync('supabase/migrations/20261128070000_wave3_webauthn.sql', 'utf8');
  assert.doesNotMatch(migSrc, /DRAFT — BELUM DIVERIFIKASI/);
  assert.match(migSrc, /DIVERIFIKASI Gelombang 7c/);
  assert.match(migSrc, /create table if not exists public\.webauthn_credentials/);
  assert.match(migSrc, /create table if not exists public\.webauthn_challenges/);
});

test('S1: server tidak terjangkau saat unlock -> PIN tetap bisa (tidak dihitung gagal); penolakan server -> dihitung gagal', async () => {
  const edge = await getEdgeMod();
  const { pair, jwk } = await makeKeyPair();
  const credIdB64 = b64url(new TextEncoder().encode('cred-1'));

  // (a) begin melempar FunctionsFetchError (jaringan putus) -> unlock
  // mengembalikan false TANPA menambah counter kegagalan.
  const fetchFail = new Error('Failed to send a request to the Edge Function');
  fetchFail.name = 'FunctionsFetchError';
  const modA = loadNativeUx({
    sbInvoke: async () => { throw fetchFail; },
    credentialsGet: async () => { throw new Error('tidak boleh dipanggil saat server mati'); },
  });
  modA.storage.setItem('mk_biometric_pin_enabled', '1');
  modA.storage.setItem('mk_biometric_cred_id', credIdB64);
  assert.equal(await modA.sandbox.__mkFeat.tryBiometricUnlock(), false);
  assert.equal(
    modA.sandbox.__mkFeat.biometricLock.readBiometricLockState().failures, 0,
    'server tidak terjangkau tidak boleh dihitung sebagai kegagalan biometrik',
  );

  // (b) server menolak assertion (tanda tangan tidak valid) -> unlock
  // false DAN dihitung sebagai kegagalan (pembatas percobaan jalan).
  const serverB = createFakeWebAuthnServer(edge);
  serverB.seedCredential(credIdB64, jwk, 0);
  const rejectingInvoke = async (fn, args) => {
    if (args.body.action === 'finish-assertion') throw httpError('Tanda tangan tidak valid.');
    return serverB.invoke(fn, args);
  };
  const modB = loadNativeUx({
    sbInvoke: rejectingInvoke,
    credentialsGet: async ({ publicKey }) => {
      const challengeB64 = b64url(new Uint8Array(publicKey.challenge));
      return makeAssertion({ keyPair: pair, challenge: challengeB64, counter: 1, origin: ORIGIN, type: 'webauthn.get' });
    },
  });
  modB.storage.setItem('mk_biometric_pin_enabled', '1');
  modB.storage.setItem('mk_biometric_cred_id', credIdB64);
  assert.equal(await modB.sandbox.__mkFeat.tryBiometricUnlock(), false);
  assert.equal(
    modB.sandbox.__mkFeat.biometricLock.readBiometricLockState().failures, 1,
    'penolakan server harus dihitung sebagai kegagalan biometrik',
  );
});

test('S1: pesan error server dibaca dari FunctionsHttpError; fallback tetap ramah untuk awam', async () => {
  const mod = loadNativeUx();
  const wa = mod.sandbox.__mkFeat.webauthn;
  const httpErr = new Error('Edge Function returned a non-2xx status code');
  httpErr.name = 'FunctionsHttpError';
  httpErr.context = { json: async () => ({ error: 'Tanda tangan tidak valid.' }) };
  assert.equal(await wa.extractWebAuthnServerError(httpErr), 'Tanda tangan tidak valid.');
  // Body tidak terbaca / tanpa context -> string kosong (pemanggil pakai fallback).
  assert.equal(await wa.extractWebAuthnServerError({ name: 'FunctionsFetchError', message: 'Failed to send a request' }), '');
  assert.equal(await wa.extractWebAuthnServerError({ context: { json: async () => { throw new Error('rusak'); } } }), '');
  assert.match(wa.webAuthnServerFailureMessage({ name: 'FunctionsFetchError' }), /Periksa koneksi internet/);
  assert.match(wa.webAuthnServerFailureMessage({ name: 'FunctionsRelayError' }), /Server sedang bermasalah/);
  assert.match(wa.webAuthnServerFailureMessage({ name: 'FunctionsHttpError' }), /Verifikasi server gagal/);
  assert.equal(wa.isWebAuthnServerRejection(new Error('Tanda tangan tidak valid.')), true);
  assert.equal(wa.isWebAuthnServerRejection(new Error('Counter tidak naik — kemungkinan kredensial terkloning.')), true);
  assert.equal(wa.isWebAuthnServerRejection(new Error('Tidak dapat terhubung ke server.')), false);
  // formatBiometricFailureReason tidak boleh membocorkan teks teknis Inggris.
  assert.match(mod.sandbox.formatBiometricFailureReason({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' }), /Verifikasi server gagal/);
  assert.match(mod.sandbox.formatBiometricFailureReason({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }), /Periksa koneksi internet/);
});
