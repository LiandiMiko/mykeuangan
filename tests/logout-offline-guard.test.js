const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const authJs = fs.readFileSync('web/supabase-auth.js', 'utf8');
const deleteAccountHtml = fs.readFileSync('web/delete-account.html', 'utf8');

function makeLocalStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _has: (k) => store.has(k)
  };
}

function fakeOfflineDb(idbItems) {
  return {
    objectStoreNames: ['pending_transactions', 'offline_snapshot'],
    transaction() {
      return {
        objectStore() {
          return {
            getAll() {
              const req = {};
              setTimeout(() => {
                req.result = idbItems;
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            }
          };
        }
      };
    }
  };
}

// Loads web/supabase-auth.js in a vm sandbox with a scripted Swal and a
// controllable offline queue. Returns the sandbox plus spies.
function loadAuth({ queue = [], idbItems = null, swalScript = [], confirmScript = [] } = {}) {
  let localQueue = queue.map((x) => ({ ...x }));
  const localStorage = makeLocalStorage({
    lang: 'id',
    mk_offline_tx_queue_v1: JSON.stringify(localQueue),
    mk_gemini_api_key: 'k',
    mk_app_pin_hash: 'h',
    mk_cached_profile_v1: '{}'
  });
  const sessionRemoved = [];
  const swalCalls = [];
  const confirmCalls = [];
  let signOutCalled = false;
  let reloaded = false;
  let discardCalled = 0;
  let capturedBlob = null;
  let anchorClicked = false;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Blob: class FakeBlob {
      constructor(parts) { this.parts = parts; }
    },
    URL: {
      createObjectURL: (blob) => { capturedBlob = blob; return 'blob:fake'; },
      revokeObjectURL: () => {}
    },
    document: {
      documentElement: { classList: { contains: () => false } },
      addEventListener: () => {},
      getElementById: () => null,
      createElement: () => ({
        click: () => { anchorClicked = true; },
        remove: () => {},
        set href(v) { this._href = v; },
        get href() { return this._href; },
        set download(v) { this._download = v; },
        get download() { return this._download; }
      }),
      body: { appendChild: () => {}, removeChild: () => {} }
    },
    localStorage,
    sessionStorage: { removeItem: (k) => sessionRemoved.push(k) },
    navigator: { onLine: true },
    location: { reload: () => { reloaded = true; } },
    caches: { keys: async () => [], delete: async () => true },
    indexedDB: { deleteDatabase: () => ({ set onsuccess(fn) { setTimeout(fn, 0); } }) },
    setInterval: () => 0,
    Swal: {
      fire: async (opts) => {
        swalCalls.push(opts);
        return swalScript.length ? swalScript.shift() : {};
      }
    },
    sessionUser: 'Tester',
    getSwalClass: () => '',
    confirm: (msg) => { confirmCalls.push(msg); return confirmScript.length ? confirmScript.shift() : false; },
    flushOfflineQueue: async () => { localQueue = []; },
    discardFailedOfflineItems: async () => {
      discardCalled += 1;
      localQueue = localQueue.filter((x) => !x.failed);
      return discardCalled;
    }
  };
  sandbox.window = sandbox;
  sandbox.__mkSb = {
    sb: { auth: { signOut: async () => { signOutCalled = true; } } },
    fail: (e) => { if (e) throw e; },
    resolveReady: () => {},
    showCoreNotice: async () => {}
  };
  sandbox.__mkFeat = {
    readLocalQueue: () => localQueue.map((x) => ({ ...x })),
    openOfflineDb: async () => (idbItems ? fakeOfflineDb(idbItems) : null)
  };
  vm.runInNewContext(authJs, sandbox);
  return {
    sandbox,
    get signOutCalled() { return signOutCalled; },
    get reloaded() { return reloaded; },
    get discardCalled() { return discardCalled; },
    get swalCalls() { return swalCalls; },
    get confirmCalls() { return confirmCalls; },
    get capturedBlob() { return capturedBlob; },
    get anchorClicked() { return anchorClicked; },
    get queueLeft() { return localQueue.length; },
    keyRemoved: (k) => !localStorage._has(k),
    keyKept: (k) => localStorage._has(k)
  };
}

test('K3: logout with an empty offline queue purges immediately without prompting', async () => {
  const t = loadAuth({ queue: [] });
  await t.sandbox.logout();
  assert.equal(t.signOutCalled, true);
  assert.equal(t.reloaded, true);
  assert.equal(t.swalCalls.length, 0);
  assert.equal(t.keyRemoved('mk_offline_tx_queue_v1'), true);
  assert.equal(t.keyRemoved('mk_gemini_api_key'), true);
});

test('K3: logout with pending items blocks on Cancel and deletes nothing', async () => {
  const t = loadAuth({
    queue: [
      { localId: 'offline-1', op: 'api_addTransaction', payload: {} },
      { localId: 'offline-2', op: 'api_addTransaction', payload: {} }
    ],
    swalScript: [{}] // user presses Batal
  });
  await t.sandbox.logout();
  assert.equal(t.swalCalls.length, 1);
  assert.match(t.swalCalls[0].title, /2 transaksi offline/);
  assert.equal(t.swalCalls[0].confirmButtonText, 'Sinkronkan Sekarang');
  assert.equal(t.swalCalls[0].denyButtonText, 'Ekspor Darurat');
  assert.equal(t.signOutCalled, false);
  assert.equal(t.reloaded, false);
  assert.equal(t.keyKept('mk_offline_tx_queue_v1'), true);
  assert.equal(t.keyKept('mk_gemini_api_key'), true);
});

test('K3: logout syncs first and proceeds once the queue is empty', async () => {
  const t = loadAuth({
    queue: [{ localId: 'offline-1', op: 'api_addTransaction', payload: {} }],
    swalScript: [{ isConfirmed: true }] // Sinkronkan Sekarang
  });
  await t.sandbox.logout();
  assert.equal(t.queueLeft, 0);
  assert.equal(t.signOutCalled, true);
  assert.equal(t.reloaded, true);
});

test('K3: after a failed sync, discard-failed removes only failed items and logout proceeds', async () => {
  const t = loadAuth({
    queue: [
      { localId: 'offline-1', op: 'api_addTransaction', payload: {} },
      { localId: 'offline-2', op: 'api_addTransaction', payload: {}, failed: true, lastError: 'Ditolak server' }
    ],
    swalScript: [{ isConfirmed: true }, { isDenied: true }] // Sync, then Buang Item Gagal
  });
  t.sandbox.flushOfflineQueue = async () => {}; // sync changes nothing: still 2 items
  await t.sandbox.logout();
  assert.equal(t.swalCalls.length, 2);
  assert.match(t.swalCalls[1].title, /2 transaksi masih belum tersinkronisasi/);
  assert.match(t.swalCalls[1].text, /Ditolak server/);
  assert.match(t.swalCalls[1].text, /1 menunggu, 1 gagal/);
  assert.equal(t.discardCalled, 1);
  assert.equal(t.signOutCalled, true);
  assert.equal(t.reloaded, true);
});

test('K3: emergency export downloads the queue JSON and purges only after confirmation', async () => {
  const t = loadAuth({
    queue: [{ localId: 'offline-9', op: 'api_addTransaction', payload: { nominal: 50000 } }],
    swalScript: [{ isDenied: true }, { isConfirmed: true }] // Ekspor Darurat, then confirm logout
  });
  await t.sandbox.logout();
  assert.equal(t.anchorClicked, true);
  assert.ok(t.capturedBlob, 'expected a Blob download');
  assert.match(t.capturedBlob.parts[0], /offline-9/);
  assert.match(t.capturedBlob.parts[0], /Tester/);
  assert.equal(t.signOutCalled, true);
  assert.equal(t.reloaded, true);
});

test('K3: emergency export without the follow-up confirmation cancels logout entirely', async () => {
  const t = loadAuth({
    queue: [{ localId: 'offline-9', op: 'api_addTransaction', payload: {} }],
    swalScript: [{ isDenied: true }, {}] // Ekspor Darurat, then Batal on the confirm step
  });
  await t.sandbox.logout();
  assert.equal(t.anchorClicked, true);
  assert.equal(t.signOutCalled, false);
  assert.equal(t.reloaded, false);
  assert.equal(t.keyKept('mk_offline_tx_queue_v1'), true);
});

test('K3: logout({ force: true }) skips the guard (post account-deletion path)', async () => {
  const t = loadAuth({
    queue: [{ localId: 'offline-1', op: 'api_addTransaction', payload: {} }],
    swalScript: [{}]
  });
  await t.sandbox.logout({ force: true });
  assert.equal(t.swalCalls.length, 0);
  assert.equal(t.signOutCalled, true);
  assert.equal(t.reloaded, true);
});

test('K3: IndexedDB queue is read first and merged with localStorage without double counting', async () => {
  const t = loadAuth({
    queue: [
      { localId: 'offline-a', op: 'api_addTransaction', payload: {} },
      { localId: 'offline-b', op: 'api_addTransaction', payload: {} }
    ],
    idbItems: [{ localId: 'offline-a', op: 'api_addTransaction', payload: {} }],
    swalScript: [{}]
  });
  await t.sandbox.logout();
  assert.equal(t.swalCalls.length, 1);
  assert.match(t.swalCalls[0].title, /2 transaksi offline/);
  assert.equal(t.signOutCalled, false);
});

test('K3: without Swal the guard falls back to a native confirm and still blocks on Cancel', async () => {
  const t = loadAuth({
    queue: [{ localId: 'offline-1', op: 'api_addTransaction', payload: {} }],
    confirmScript: [false]
  });
  delete t.sandbox.Swal;
  await t.sandbox.logout();
  assert.equal(t.confirmCalls.length, 1);
  assert.match(t.confirmCalls[0], /1 transaksi offline/);
  assert.equal(t.signOutCalled, false);
  assert.equal(t.reloaded, false);
});

test('K3: logout source checks the queue first, awaits the IDB wipe, and clears the PIN key', () => {
  assert.match(authJs, /window\.logout = async function \(opts\)/);
  assert.match(authJs, /opts\.force/);
  assert.match(authJs, /getOfflineQueueSummary/);
  assert.match(authJs, /exportOfflineQueuePlaintext/);
  assert.match(authJs, /clearPinDataKey/);
  assert.match(authJs, /flushOfflineQueue\(false\)/);
  assert.match(authJs, /discardFailedOfflineItems/);
  assert.match(authJs, /guardOfflineQueueBeforeLogout/);
  assert.match(authJs, /await new Promise\([\s\S]*?deleteDatabase\(OFFLINE_IDB_NAME\)/);
  assert.match(authJs, /Sinkronkan Sekarang/);
  assert.match(authJs, /Ekspor Darurat/);
  assert.match(authJs, /Buang Item Gagal & Lanjutkan Logout/);
});

test('K3: delete-account page offers an emergency export before wiping local data', () => {
  assert.match(deleteAccountHtml, /readLocalOfflineQueue/);
  assert.match(deleteAccountHtml, /downloadOfflineQueueExport/);
  assert.match(deleteAccountHtml, /Ekspor Darurat/);
  assert.match(deleteAccountHtml, /deleteDatabase\('mykeuangan_offline_db'\)/);
  assert.match(deleteAccountHtml, /await new Promise\([\s\S]*?deleteDatabase/);
  // The export offer must run after the server deletion succeeds and before
  // the local wipe (signOut / localStorage.clear).
  const guardAt = deleteAccountHtml.indexOf('readLocalOfflineQueue()');
  const signOutAt = deleteAccountHtml.indexOf('await sb.auth.signOut()', guardAt);
  const clearAt = deleteAccountHtml.indexOf('localStorage.clear()', guardAt);
  assert.ok(guardAt > 0 && signOutAt > guardAt && clearAt > signOutAt,
    'expected queue guard -> signOut -> localStorage.clear order');
});
