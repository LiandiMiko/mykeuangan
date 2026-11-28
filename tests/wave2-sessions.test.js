const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
const authJs = fs.readFileSync('web/supabase-auth.js', 'utf8');
const aiJs = fs.readFileSync('web/ui-ai.js', 'utf8');
const offlineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
const deleteAccountFn = fs.readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
const adminPasswordFn = fs.readFileSync('supabase/functions/admin-password/index.ts', 'utf8');

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
   T3 — ganti password sendiri (web/supabase-admin.js)
   ============================================================ */

function loadAdminClient({ signInOkPassword = 'password-lama-benar' } = {}) {
  const calls = [];
  const invokeCalls = [];
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
          if (email === 'user@example.com' && password === signInOkPassword) {
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
      from: () => { throw new Error('direct table access must not happen here'); },
      rpc: async () => ({ data: null, error: null })
    },
    fail: (error) => { if (error) throw error; },
    fetchAll: async () => [],
    setSetting: async () => {}
  };
  const sandbox = { console, __mkSb: core, sessionRole: 'user' };
  sandbox.window = sandbox;
  vm.runInNewContext(adminJs, sandbox);
  return { core, calls, invokeCalls, sandbox };
}

test('T3: password lama salah -> ditolak generik, updateUser & signOut tidak pernah dipanggil', async () => {
  const { core, calls } = loadAdminClient();
  await assert.rejects(
    () => core.handlers.api_updateOwnPassword('password-salah', 'password-baru-123'),
    /Password lama tidak valid/
  );
  assert.ok(calls.includes('signInWithPassword'), 'password lama harus diverifikasi dulu');
  assert.equal(calls.filter((c) => c === 'updateUser').length, 0, 'updateUser tidak boleh dipanggil');
  assert.equal(calls.filter((c) => c.startsWith('signOut')).length, 0, 'tidak ada sesi yang dicabut');
});

test('T3: password lama benar -> updateUser lalu signOut({scope: others}), sesi saat ini tetap jalan', async () => {
  const { core, calls } = loadAdminClient();
  await core.handlers.api_updateOwnPassword('password-lama-benar', 'password-baru-123');
  assert.deepEqual(calls, ['getUser', 'signInWithPassword', 'updateUser', 'signOut:others']);
});

test('T3: validasi panjang berjalan sebelum ada panggilan auth apa pun', async () => {
  const { core, calls } = loadAdminClient();
  await assert.rejects(() => core.handlers.api_updateOwnPassword('password-lama-benar', 'pendek'), /8 sampai 128/);
  await assert.rejects(() => core.handlers.api_updateOwnPassword('password-lama-benar', 'x'.repeat(129)), /8 sampai 128/);
  await assert.rejects(() => core.handlers.api_updateOwnPassword('', 'password-baru-123'), /password lama/);
  await assert.rejects(() => core.handlers.api_updateOwnPassword(undefined, 'password-baru-123'), /password lama/);
  assert.equal(calls.length, 0, 'validasi gagal tidak boleh menyentuh auth sama sekali');
});

/* ============================================================
   T4 — hapus akun dengan autentikasi ulang (klien + edge)
   ============================================================ */

test('T4: hapus akun tanpa password -> ditolak sebelum edge function dipanggil', async () => {
  const { core, invokeCalls } = loadAdminClient();
  await assert.rejects(() => core.handlers.api_deleteOwnAccount('HAPUS'), /password akun/);
  await assert.rejects(() => core.handlers.api_deleteOwnAccount('HAPUS', ''), /password akun/);
  await assert.rejects(() => core.handlers.api_deleteOwnAccount('SALAH', 'password-lama-benar'), /Ketik HAPUS/);
  assert.equal(invokeCalls.length, 0, 'edge function tidak boleh dipanggil tanpa password');
});

test('T4: hapus akun dengan password -> edge function menerima { confirmation, password }', async () => {
  const { core, invokeCalls } = loadAdminClient();
  await core.handlers.api_deleteOwnAccount('hapus', 'password-lama-benar');
  assert.deepEqual(plain(invokeCalls), [
    { fnName: 'delete-account', body: { confirmation: 'HAPUS', password: 'password-lama-benar' } }
  ]);
});

test('T4: edge delete-account memverifikasi password di server sebelum menghapus', () => {
  assert.match(deleteAccountFn, /signInWithPassword\(\{\s*email: authData\.user\.email,\s*password: body\.password,?\s*\}\)/);
  assert.match(deleteAccountFn, /Kata sandi tidak valid\./);
  // Verifikasi password harus terjadi SEBELUM penghapusan dan SEBELUM
  // guard admin-terakhir (yang hanya relevan bila password sudah benar).
  const verifyAt = deleteAccountFn.indexOf('signInWithPassword');
  assert.ok(verifyAt > 0 && verifyAt < deleteAccountFn.indexOf('adminClient.auth.admin.deleteUser'),
    'verifikasi password harus mendahului deleteUser');
  assert.ok(verifyAt < deleteAccountFn.indexOf('satu-satunya administrator aktif'),
    'verifikasi password harus mendahului guard admin-terakhir');
  // Perilaku lama tetap utuh: konfirmasi HAPUS + guard admin-terakhir.
  assert.match(deleteAccountFn, /\['HAPUS', 'DELETE'\]/);
  assert.match(deleteAccountFn, /satu-satunya administrator aktif/);
  assert.match(deleteAccountFn, /adminClient\.auth\.admin\.deleteUser\(userId\)/);
});

/* ============================================================
   T4 — logout fail-closed (web/supabase-auth.js)
   ============================================================ */

function loadAuthModule({ signOutThrows = true } = {}) {
  const storage = createStorage({
    'sb-usauytablxbiktnepwsi-auth-token': JSON.stringify({ access_token: 'stale-token' }),
    'sb-usauytablxbiktnepwsi-auth-token-code-verifier': 'verifier-lama',
    mk_gemini_api_key: 'v1:abc',
    mk_other_key: 'harus-tetap-ada'
  });
  const session = createStorage({ mk_pin_unlocked: '1' });
  const signOutCalls = [];
  let reloaded = false;
  const core = {
    sb: {
      auth: {
        signOut: async (opts) => {
          signOutCalls.push((opts && opts.scope) || 'global');
          if (signOutThrows) throw new Error('offline');
          return { error: null };
        },
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => {}
      }
    },
    fail: (error) => { if (error) throw error; },
    resolveReady: () => {},
    showCoreNotice: async () => {}
  };
  const sandbox = {
    console,
    __mkSb: core,
    localStorage: storage,
    sessionStorage: session,
    document: { addEventListener: () => {}, getElementById: () => null },
    setInterval: () => 0,
    clearInterval: () => {},
    location: { reload: () => { reloaded = true; } },
    navigator: { onLine: false },
    indexedDB: {
      deleteDatabase: () => {
        const req = { onsuccess: null, onerror: null, onblocked: null };
        setTimeout(() => { if (typeof req.onsuccess === 'function') req.onsuccess(); }, 0);
        return req;
      }
    },
    caches: { keys: async () => [], delete: async () => true }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(authJs, sandbox);
  return { sandbox, storage, session, signOutCalls, get reloaded() { return reloaded; } };
}

test('T4: logout saat signOut server gagal tetap menghapus token lokal + reload', async () => {
  const { sandbox, storage, signOutCalls } = loadAuthModule({ signOutThrows: true });
  await sandbox.logout();
  assert.deepEqual(signOutCalls, ['global', 'local'],
    'logout harus mencoba signOut global lalu signOut local');
  assert.equal(storage.getItem('sb-usauytablxbiktnepwsi-auth-token'), null, 'token sesi lama harus hilang');
  assert.equal(storage.getItem('sb-usauytablxbiktnepwsi-auth-token-code-verifier'), null, 'code verifier harus ikut hilang');
  assert.equal(storage.getItem('mk_gemini_api_key'), null, 'kunci LOGOUT_STORAGE_KEYS tetap dibersihkan');
  assert.equal(storage.getItem('mk_other_key'), 'harus-tetap-ada', 'kunci di luar pola auth-token tidak boleh ikut terhapus');
});

test('T4: sumber logout menyapu kunci sb-*-auth-token dan bootAuth tidak bisa pulih dari token basi', () => {
  assert.match(authJs, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(authJs, /\/\^sb-\[\^-\]\+-auth-token\//);
  // Kunci token memang TIDAK ada di LOGOUT_STORAGE_KEYS (itu celahnya) —
  // sapuan pola di atas yang menutupnya.
  const keysBlock = authJs.slice(authJs.indexOf('LOGOUT_STORAGE_KEYS = ['), authJs.indexOf('];', authJs.indexOf('LOGOUT_STORAGE_KEYS')));
  assert.doesNotMatch(keysBlock, /auth-token/);
  // Setelah reload, bootAuth memulai dari getSession(), bukan dari
  // localStorage langsung — tanpa token, tidak ada sesi yang pulih.
  const bootBlock = authJs.slice(authJs.indexOf('core.bootAuth'));
  assert.match(bootBlock, /sb\.auth\.getSession\(\)/);
  assert.match(bootBlock, /showLogin\(\)/);
});

/* ============================================================
   S20 — kunci Gemini terenkripsi dengan DEK (web/ui-ai.js)
   ============================================================ */

function makeGeminiSandbox() {
  const storage = createStorage();
  const sandbox = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    localStorage: storage,
    sessionStorage: createStorage(),
    document: { getElementById: () => null, addEventListener: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    navigator: { onLine: true },
    console,
    __mkFeat: {}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(offlineJs, sandbox);
  vm.runInNewContext(aiJs, sandbox);
  return { sandbox, storage };
}

async function makeDek(sandbox) {
  return sandbox.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

test('S20: kunci Gemini round-trip terenkripsi, plaintext tidak pernah tersimpan', async () => {
  const { sandbox, storage } = makeGeminiSandbox();
  const dek = await makeDek(sandbox);
  sandbox.__mkFeat.getPinDataKey = () => dek;

  await sandbox.saveGeminiApiKey('AIza-test-123456');
  const stored = storage.getItem('mk_gemini_api_key');
  assert.ok(stored.startsWith('v1:'), 'format tersimpan harus berprefix v1:');
  assert.doesNotMatch(stored, /AIza-test-123456/, 'plaintext key tidak boleh ada di storage');
  assert.equal(await sandbox.getGeminiApiKeyAsync(), 'AIza-test-123456');
  // Pembaca sinkron tidak bisa mendekripsi nilai terenkripsi.
  assert.equal(sandbox.getGeminiApiKey(), '');
  // Badge status tetap tahu ada key tersimpan tanpa mendekripsi.
  assert.equal(sandbox.hasStoredGeminiApiKey(), true);
});

test('S20: dekripsi dengan DEK berbeda gagal (kunci tidak bisa dibaca PIN lain)', async () => {
  const { sandbox, storage } = makeGeminiSandbox();
  const dekA = await makeDek(sandbox);
  sandbox.__mkFeat.getPinDataKey = () => dekA;
  await sandbox.saveGeminiApiKey('AIza-rahasia');
  assert.ok(storage.getItem('mk_gemini_api_key').startsWith('v1:'));

  const otherDek = await makeDek(sandbox);
  sandbox.__mkFeat.getPinDataKey = () => otherDek;
  assert.equal(await sandbox.getGeminiApiKeyAsync(), '', 'DEK berbeda harus gagal dekripsi');
});

test('S20: nilai plaintext lama dimigrasi (dipakai sekali, lalu tersimpan terenkripsi)', async () => {
  const { sandbox, storage } = makeGeminiSandbox();
  const dek = await makeDek(sandbox);
  sandbox.__mkFeat.getPinDataKey = () => dek;
  storage.setItem('mk_gemini_api_key', 'AIza-legacy-999');

  assert.equal(await sandbox.getGeminiApiKeyAsync(), 'AIza-legacy-999', 'nilai lama dipakai sekali');
  const migrated = storage.getItem('mk_gemini_api_key');
  assert.ok(migrated.startsWith('v1:'), 'nilai lama harus sudah termigrasi ke terenkripsi');
  assert.doesNotMatch(migrated, /AIza-legacy-999/);
  assert.equal(await sandbox.getGeminiApiKeyAsync(), 'AIza-legacy-999', 'nilai termigrasi tetap terbaca');
});

test('S20: tanpa DEK, simpan ditolak dan baca mengembalikan kosong (tanpa fallback plaintext)', async () => {
  const { sandbox, storage } = makeGeminiSandbox();
  sandbox.__mkFeat.getPinDataKey = () => null;

  await assert.rejects(() => sandbox.saveGeminiApiKey('AIza-baru'), /PIN/);
  assert.equal(storage.getItem('mk_gemini_api_key'), null, 'tidak boleh ada yang tersimpan saat ditolak');

  storage.setItem('mk_gemini_api_key', 'AIza-legacy-999');
  assert.equal(await sandbox.getGeminiApiKeyAsync(), '', 'legacy tanpa DEK harus mengembalikan kosong');
  assert.equal(storage.getItem('mk_gemini_api_key'), 'AIza-legacy-999', 'nilai legacy tidak dihapus diam-diam');

  const dek = await makeDek(sandbox);
  sandbox.__mkFeat.getPinDataKey = () => dek;
  storage.setItem('mk_gemini_api_key', await sandbox.encryptGeminiApiKey('AIza-terenkripsi'));
  sandbox.__mkFeat.getPinDataKey = () => null;
  assert.equal(await sandbox.getGeminiApiKeyAsync(), '', 'nilai terenkripsi tanpa DEK harus mengembalikan kosong');
});

test('S20: UI menjelaskan enkripsi PIN + risiko lupa PIN, dan tidak ada lagi simpan plaintext', () => {
  assert.match(aiJs, /disimpan terenkripsi dengan PIN aplikasi/);
  assert.match(aiJs, /tidak pernah dikirim ke server mana pun kecuali API Google AI/);
  assert.match(aiJs, /Jika Anda lupa PIN, kunci yang tersimpan tidak bisa dipulihkan dan harus dimasukkan ulang/);
  assert.match(aiJs, /saveGeminiApiKey\(res\.value\.key\)/);
  assert.doesNotMatch(aiJs, /setItem\(GEMINI_KEY_STORAGE, res\.value\.key\)/);
  // Semua pemanggil AI memakai getter asinkron, bukan pembaca sinkron.
  const featAi = fs.readFileSync('web/ui-feat-ai.js', 'utf8');
  const proInsights = fs.readFileSync('web/ui-pro-insights.js', 'utf8');
  assert.doesNotMatch(featAi, /getGeminiApiKey\(\)/);
  assert.match(featAi, /getGeminiApiKeyAsync\(\)/);
  assert.doesNotMatch(proInsights, /getGeminiApiKey\(\)/);
  assert.match(proInsights, /getGeminiApiKeyAsync\(\)/);
  // Tidak ada lagi pembacaan langsung localStorage key Gemini di luar ui-ai.js
  // (kecuali daftar kunci logout di supabase-auth.js).
  for (const file of ['web/ui-feat-ai.js', 'web/ui-pro-insights.js', 'web/ui-feat-account.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /localStorage\.getItem\('mk_gemini_api_key'\)/);
  }
});

/* ============================================================
   Guard UI + item terbuka yang sengaja tidak diimplementasi
   ============================================================ */

test('T3: UI ganti password meminta password lama; reset admin tidak berubah', () => {
  const adminUi = fs.readFileSync('web/ui-admin.js', 'utf8');
  assert.match(adminUi, /promptNewPassword\('Ganti password akun Anda', \{ requireCurrent: true \}\)/);
  assert.match(adminUi, /callServer\('api_updateOwnPassword', result\.oldPassword, result\.newPassword\)/);
  assert.match(adminUi, /admin-current-password/);
  assert.match(adminUi, /sesi di perangkat lain akan dicabut/);
  // Reset oleh admin tetap tanpa password lama (admin tidak mengetahuinya).
  assert.match(adminUi, /promptNewPassword\(`Atur password untuk/);
  assert.match(adminUi, /callServer\('api_adminSetPassword', uid, password\)/);
});

test('T4: UI hapus akun meminta password + meneruskannya ke server', () => {
  const accountJs = fs.readFileSync('web/ui-feat-account.js', 'utf8');
  assert.match(accountJs, /del-acc-password/);
  assert.match(accountJs, /callServer\('api_deleteOwnAccount', confirmRes\.value\.confirmation, confirmRes\.value\.password\)/);
});

test('T3: modal recovery password tidak berubah (link email recovery adalah autentikasinya)', () => {
  const recoveryJs = fs.readFileSync('web/supabase-auth-ui.js', 'utf8');
  assert.match(recoveryJs, /showPasswordRecoveryModal/);
  assert.match(recoveryJs, /sb\.auth\.updateUser\(\{ password: pass \}\)/);
  assert.doesNotMatch(recoveryJs, /signInWithPassword/);
});

test('Item terbuka (DITUTUP Gelombang 7a): reset password admin kini mencabut sesi target via RPC', () => {
  // Dulu (auth-js 2.65.0): admin.signOut(jwt, scope) menerima JWT
  // pengguna yang sesinya mau dicabut — BUKAN userId. Edge function
  // admin-password hanya memegang JWT admin pemanggil, bukan JWT
  // target, jadi memanggilnya akan mencabut sesi admin sendiri.
  // Gelombang 7a membuktikan keterbatasan itu MASIH berlaku di
  // supabase-js 2.119.2 (tidak ada API admin berbasis user-id
  // untuk sesi) dan menutupnya lewat RPC SECURITY DEFINER
  // admin_revoke_user_sessions() (migrasi 20261128120000):
  // DELETE FROM auth.sessions WHERE user_id = target — persis yang
  // dilakukan GoTrue saat /logout. Keterbatasan jujur: access
  // token yang sudah diterbitkan tetap valid sampai `exp` (±1 jam).
  assert.match(adminPasswordFn, /updateUserById\(userId, \{ password \}\)/);
  assert.doesNotMatch(adminPasswordFn, /admin\.signOut\(/);
  assert.match(adminPasswordFn, /revokeUserSessions\(adminClient, userId\)/);
  assert.match(adminPasswordFn, /admin_revoke_user_sessions/);
  const mig = fs.readFileSync('supabase/migrations/20261128120000_admin_revoke_user_sessions.sql', 'utf8');
  assert.match(mig, /delete from auth\.sessions where user_id = p_target_user_id;/);
  assert.match(mig, /grant execute on function public\.admin_revoke_user_sessions\(uuid\) to service_role;/);
});
