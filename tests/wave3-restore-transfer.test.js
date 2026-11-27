const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const backupJs = fs.readFileSync('web/finance-analysis-backup.js', 'utf8');
const uiBackupJs = fs.readFileSync('web/ui-feat-backup.js', 'utf8');
const cacheJs = fs.readFileSync('web/ui-feat-cache.js', 'utf8');
const offlineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
const importJs = fs.readFileSync('web/transaction-import.js', 'utf8');
const recordsJs = fs.readFileSync('web/supabase-records.js', 'utf8');
const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
const portfolioJs = fs.readFileSync('web/supabase-portfolio.js', 'utf8');
const coreJs = fs.readFileSync('web/supabase-core.js', 'utf8');
const transferSql = fs.readFileSync('supabase/migrations/20261128050000_wave3_transfer_rpc.sql', 'utf8');
const restoreSql = fs.readFileSync('supabase/migrations/20261128060000_wave3_restore_rpc.sql', 'utf8');

const plain = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

// IndexedDB palsu in-memory. getAll dapat mengembalikan urutan terbalik
// (membuktikan flush mengurutkan berdasarkan seq, bukan urutan getAll).
function createFakeDb({ reverseGetAll = false } = {}) {
  const stores = new Map();
  const keyPaths = new Map();
  const fireLater = (fn) => setTimeout(fn, 0);
  class Req {
    constructor() { this.result = undefined; this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; }
  }
  function makeStore(map, keyPath) {
    return {
      put(value) { const req = new Req(); map.set(value[keyPath], value); fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); }); return req; },
      get(key) { const req = new Req(); req.result = map.has(key) ? map.get(key) : undefined; fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); }); return req; },
      getAll() { const req = new Req(); const vals = [...map.values()]; req.result = reverseGetAll ? vals.reverse() : vals; fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); }); return req; },
      delete(key) { const req = new Req(); map.delete(key); fireLater(() => { if (req.onsuccess) req.onsuccess({ target: req }); }); return req; }
    };
  }
  const db = {
    get objectStoreNames() { return { contains: (name) => stores.has(name) }; },
    createObjectStore(name, opts) {
      if (!stores.has(name)) { stores.set(name, new Map()); keyPaths.set(name, (opts && opts.keyPath) || 'key'); }
      return makeStore(stores.get(name), keyPaths.get(name));
    },
    transaction(storeName) {
      const tx = { objectStore: (n) => makeStore(stores.get(n), keyPaths.get(n)), oncomplete: null, onerror: null };
      fireLater(() => { if (tx.oncomplete) tx.oncomplete(); });
      return tx;
    },
    onversionchange: null, onclose: null, close() {}
  };
  return { db, stores };
}

function createFakeIndexedDB(fakeDb) {
  return {
    open() {
      const req = { result: fakeDb, onupgradeneeded: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    }
  };
}

/* ============================================================
   §6 — Migrasi transfer_between_wallets (SQL)
   ============================================================ */

test('S6: transfer_between_wallets mengunci kedua dompet FOR UPDATE dalam urutan id dan mengecek saldo + kepemilikan', () => {
  assert.match(transferSql, /create or replace function public\.transfer_between_wallets\(/);
  assert.match(transferSql, /for update/i);
  assert.match(transferSql, /least\(p_from, p_to\)/);
  assert.match(transferSql, /Saldo dompet asal tidak mencukupi/);
  assert.match(transferSql, /999999999999\.99/);
  assert.match(transferSql, /revoke all on function public\.transfer_between_wallets.*from public, anon/i);
  assert.match(transferSql, /grant execute on function public\.transfer_between_wallets.*to authenticated/i);
  // Idempotency: kunci yang sama mengembalikan baris lama, bukan duplikat.
  assert.match(transferSql, /idempotency_key = v_key/);
  assert.match(transferSql, /unique_violation/);
  // Saldo turunan memperhitungkan transaksi + transfer yang sudah ada.
  assert.match(transferSql, /opening_balance/);
  assert.match(transferSql, /from public\.transfers x/);
});

test('S3: restore_backup memvalidasi di dalam satu transaksi dan mendedup via legacy_id', () => {
  assert.match(restoreSql, /create or replace function public\.restore_backup\(p_payload jsonb\)/);
  assert.match(restoreSql, /revoke all on function public\.restore_backup\(jsonb\) from public, anon/i);
  assert.match(restoreSql, /grant execute on function public\.restore_backup\(jsonb\) to authenticated/i);
  // Dompet tak dikenal menggagalkan seluruh restore (atomic).
  assert.match(restoreSql, /Dompet tidak ditemukan: %/);
  // Bulan budget divalidasi (racun 2026-13 ditolak sebelum insert apa pun).
  assert.match(restoreSql, /\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/);
  assert.match(restoreSql, /Budget pada backup tidak valid/);
  // legacy_id untuk transfer + unique index di kedua tabel.
  assert.match(restoreSql, /add column if not exists legacy_id text/);
  assert.match(restoreSql, /transfers_user_legacy_id_uidx/);
  assert.match(restoreSql, /transactions_user_legacy_id_uidx/);
  // Cek saldo transfer SETELAH transaksi backup masuk.
  assert.match(restoreSql, /Saldo dompet asal tidak mencukupi untuk transfer pada backup/);
  // Semua 10 koleksi disebut di fungsi ini.
  for (const table of ['wallets', 'categories', 'entities', 'transactions', 'transfers', 'budgets', 'financial_goals', 'recurring', 'assets', 'settings']) {
    assert.match(restoreSql, new RegExp('public\\.' + table + '\\b'), 'restore_backup harus menyentuh ' + table);
  }
});

/* ============================================================
   §1/§2/§4 — prepareBackupRestorePayload & filter (murni)
   ============================================================ */

const Backup = require('../web/finance-analysis-backup.js');
const { parseTransactionCsv, MAX_DATA_ROWS } = require('../web/transaction-import.js');

const WALLET_BCA = { id: 'w-bca', name: 'BCA Utama', kind: 'bank', openingBalance: 1000000 };
const WALLET_CASH = { id: 'w-cash', name: 'Cash', kind: 'cash', openingBalance: 50000 };

function fullBackup(overrides = {}) {
  return {
    wallets: [WALLET_BCA, WALLET_CASH],
    transfers: [
      { id: 'tr-1', tanggal: '2026-11-05', kind: 'transfer', fromWallet: 'w-bca', toWallet: 'w-cash', nominal: 200000, fee: 0, keterangan: 'Tarik tunai' },
      { id: 'tr-2', tanggal: '2026-11-06', kind: 'transfer', fromWallet: 'w-cash', toWallet: 'w-bca', nominal: 50000, fee: 2500, keterangan: 'Setor' }
    ],
    entities: { UtangApp: ['PayLater X'], UtangPerson: ['Budi'], Piutang: ['Ani'] },
    transactions: [
      { id: 'tx-1', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletId: 'w-bca' },
      { id: 'tx-2', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletId: 'w-bca' }
    ],
    categories: { pemasukan: ['Gaji'], pengeluaran: ['Makan'] },
    budgets: [{ bulan: '2026-11', kategori: 'Makan', jumlah: 1000000 }],
    goals: [{ name: 'Dana Darurat', targetAmount: 5000000, currentAmount: 1000000 }],
    recurring: [{ tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 200000, dayOfMonth: 5 }],
    assets: [{ name: 'Emas Antam', type: 'Emas', symbol: 'XAU', quantity: 2, buyPrice: 1400000, value: 3000000 }],
    debtDueDates: { 'UtangPerson - Budi': '2026-12-01' },
    ...overrides
  };
}

test('S1: round-trip backup 2 transfer + 3 entitas -> restore mengenal 10 koleksi', () => {
  const plan = Backup.prepareBackupRestorePayload(fullBackup(), {
    wallets: [], transfers: [], entities: {}, transactions: [],
    categories: {}, budgets: [], goals: [], recurring: [], assets: [], debtDueDates: {}
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.newTransfers.length, 2);
  assert.equal(plan.newEntities.length, 3);
  assert.deepEqual(plan.newEntities.map((e) => e.grp).sort(), ['Piutang', 'UtangApp', 'UtangPerson']);
  assert.equal(plan.newTransactions.length, 2, 'dua kopi identik dengan id berbeda keduanya masuk');
  // 10 koleksi baru dikenali oleh payload.
  for (const key of ['newTransactions', 'newBudgets', 'newGoals', 'newCategories', 'newWallets', 'newRecurring', 'newAssets', 'newDebtDueDates', 'newTransfers', 'newEntities']) {
    assert.ok(key in plan, 'plan harus membawa ' + key);
  }
  const totalNew = plan.newTransactions.length + plan.newBudgets.length + plan.newGoals.length
    + plan.newCategories.length + plan.newWallets.length + plan.newRecurring.length
    + plan.newAssets.length + Object.keys(plan.newDebtDueDates).length
    + plan.newTransfers.length + plan.newEntities.length;
  assert.equal(totalNew, 2 + 1 + 1 + 2 + 2 + 1 + 1 + 1 + 2 + 3);
});

test('S2: backup merujuk dompet "BCA Lama" yang sudah dihapus -> restore dibatalkan dan menyebut dompet + transaksi', () => {
  const backup = fullBackup({
    wallets: [{ id: 'w-gone', name: 'BCA Lama', kind: 'bank', openingBalance: 0 }],
    transactions: [
      { id: 'tx-9', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 40000, keterangan: 'Nasi goreng', walletId: 'w-gone' }
    ],
    transfers: []
  });
  // Dompet BCA Lama TIDAK ada di backup sebagai dompet baru yang valid?
  // Di sini ia ADA di daftar wallets backup, tapi skenario "dihapus"
  // berarti: backup TIDAK membawa dompet itu sama sekali.
  const backupNoWallet = fullBackup({
    wallets: [WALLET_CASH],
    transactions: [
      { id: 'tx-9', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 40000, keterangan: 'Nasi goreng', walletId: 'w-gone' }
    ],
    transfers: [{ id: 'tr-9', tanggal: '2026-11-05', kind: 'transfer', fromWallet: 'w-gone', toWallet: 'w-cash', nominal: 10000, fee: 0, keterangan: 'x' }]
  });
  void backup;
  const plan = Backup.prepareBackupRestorePayload(backupNoWallet, {
    wallets: [WALLET_CASH], transfers: [], entities: {}, transactions: [],
    categories: {}, budgets: [], goals: [], recurring: [], assets: [], debtDueDates: {}
  });
  assert.equal(plan.newTransactions.length, 0, 'transaksi berdompet hilang tidak boleh masuk plan');
  assert.equal(plan.unmappedTransactions.length, 1);
  assert.equal(plan.unmappedTransactions[0].oldWalletName, 'w-gone');
  assert.equal(plan.unmappedTransactions[0].kategori, 'Makan');
  assert.equal(plan.unmappedTransactions[0].nominal, 40000);
  assert.equal(plan.unmappedTransfers.length, 1, 'transfer berdompet hilang juga tercatat');
});

test('S4: dua kopi identik (id berbeda, dompet sama) keduanya restore; restore ulang 0 baris', () => {
  const empty = {
    wallets: [WALLET_BCA], transfers: [], entities: {}, transactions: [],
    categories: {}, budgets: [], goals: [], recurring: [], assets: [], debtDueDates: {}
  };
  const backup = fullBackup({ wallets: [WALLET_BCA], transfers: [], entities: {} });
  const first = Backup.prepareBackupRestorePayload(backup, empty);
  assert.equal(first.newTransactions.length, 2);

  // DB sudah berisi satu kopi (id tx-1): tepat satu baris baru.
  const withOne = Backup.prepareBackupRestorePayload(backup, {
    ...empty,
    transactions: [{ id: 'tx-1', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletId: 'w-bca' }]
  });
  assert.equal(withOne.newTransactions.length, 1);
  assert.equal(withOne.newTransactions[0].id, 'tx-2');

  // Restore yang sama kedua kali: nol baris baru.
  const rerun = Backup.prepareBackupRestorePayload(backup, {
    ...empty,
    transactions: [
      { id: 'tx-1', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletId: 'w-bca' },
      { id: 'tx-2', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletId: 'w-bca' }
    ]
  });
  assert.equal(rerun.newTransactions.length, 0);
  assert.equal(rerun.skippedTransactions, 2);
});

test('S4: baris tanpa id tetap didedup signature lengkap (termasuk dompet), dan budget racun 2026-13 dilewati', () => {
  const plan = Backup.prepareBackupRestorePayload({
    transactions: [
      { tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletId: 'w-bca' },
      { tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletId: 'w-bca' }
    ],
    wallets: [WALLET_BCA],
    budgets: [{ bulan: '2026-13', kategori: 'Makan', jumlah: 100000 }]
  }, {
    wallets: [WALLET_BCA], transactions: [], budgets: [], categories: {},
    goals: [], recurring: [], assets: [], debtDueDates: {}, transfers: [], entities: {}
  });
  assert.equal(plan.newTransactions.length, 1, 'tanpa id, kopi kedua tetap dianggap duplikat signature');
  assert.equal(plan.newBudgets.length, 0, 'budget bulan 2026-13 tidak boleh masuk plan');
  assert.equal(plan.skippedBudgets, 1);
});

/* ============================================================
   §8 + §2/§3 klien — ui-feat-backup.js di vm
   ============================================================ */

function loadUiBackupSandbox() {
  const sandbox = {
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    DB: { wallets: [{ id: 'w1', name: 'BCA' }, { id: 'w2', name: 'Cash' }], debtDueDates: {} },
    Swal: { fire: async () => ({ isConfirmed: false }), showLoading: () => {}, showValidationMessage: () => {} },
    callServer: async () => ({}),
    refreshFromServer: async (x) => x,
    formatRupiah: (n) => 'Rp' + n,
    escapeHtmlJS: (s) => String(s),
    renderHtml: () => {},
    getSwalClass: () => '',
    showActionError: () => {},
    getFilteredReportTransactions: () => ({ txs: [], period: '' }),
    walletName: (id) => id,
    localToday: () => '2026-11-28',
    t: (k) => k,
    document: { createElement: () => ({ click: () => {} }), getElementById: () => null }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(uiBackupJs, sandbox);
  return sandbox;
}

test('S8: envelope backup baru memakai 600.000 iterasi; sandi 6/8/11 ditolak, 12 diterima', async () => {
  const sb = loadUiBackupSandbox();
  const snapshot = { wallets: [], transactions: [] };
  for (const bad of ['123456', '12345678', '12345678901']) {
    await assert.rejects(() => sb.encryptBackupPayload(snapshot, bad), /minimal 12 karakter/);
  }
  const env = await sb.encryptBackupPayload(snapshot, '123456789012');
  assert.equal(env.iterations, 600000);
  assert.equal(env.format, 'mykeuguech-encrypted-backup-v1');
  const back = await sb.decryptBackupPayload(env, '123456789012');
  assert.deepEqual(plain(back), snapshot);
});

test('S8: backup lama 150.000 iterasi tetap bisa dibuka', async () => {
  const sb = loadUiBackupSandbox();
  const password = 'katasandilama1';
  const snapshot = { wallets: [{ name: 'BCA' }], exportedAt: '2026-01-01' };
  // Buat envelope gaya lama secara manual (PBKDF2 150.000).
  const enc = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const keyMat = await webcrypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt']);
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(snapshot)));
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const legacyEnv = {
    format: 'mykeuguech-encrypted-backup-v1', kdf: 'PBKDF2-SHA256', iterations: 150000,
    salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct))
  };
  const back = await sb.decryptBackupPayload(legacyEnv, password);
  assert.deepEqual(plain(back), snapshot);
});

test('S2/S3: resolveRestoredWalletId mengembalikan null bila tidak cocok; payload RPC memakai nama dompet + legacyId', () => {
  const sb = loadUiBackupSandbox();
  assert.equal(sb.resolveRestoredWalletId('w1', {}), 'w1');
  assert.equal(sb.resolveRestoredWalletId('old-x', { 'old-x': 'Cash' }), 'w2');
  assert.equal(sb.resolveRestoredWalletId('old-gone', { 'old-gone': 'BCA Lama' }), null);
  assert.equal(sb.resolveRestoredWalletId('old-gone', {}), null);
  assert.equal(sb.resolveRestoredWalletId('', {}), null);

  const payload = sb.buildRestoreRpcPayload({
    newWallets: [{ name: 'BCA', kind: 'bank', openingBalance: 1000 }],
    newCategories: [{ tipe: 'Pengeluaran', name: 'Makan' }],
    newEntities: [{ grp: 'UtangPerson', name: 'Budi' }],
    newTransactions: [{ legacyId: 'tx-1', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, keterangan: 'Kopi', walletName: 'BCA' }],
    newTransfers: [{ legacyId: 'tr-1', tanggal: '2026-11-05', kind: 'transfer', fromWalletName: 'BCA', toWalletName: 'Cash', nominal: 200000, fee: 0, keterangan: '' }],
    newBudgets: [], newGoals: [], newRecurring: [], newAssets: [], newDebtDueDates: {}
  });
  assert.equal(payload.transactions[0].walletName, 'BCA');
  assert.equal(payload.transactions[0].legacyId, 'tx-1');
  assert.equal(payload.transfers[0].fromWalletName, 'BCA');
  assert.equal(payload.transfers[0].toWalletName, 'Cash');
  assert.deepEqual(plain(payload.entities), [{ grp: 'UtangPerson', name: 'Budi' }]);
});

/* ============================================================
   §5 — snapshot offline: UID + TTL 7 hari
   ============================================================ */

function loadCacheSandbox() {
  const { db, stores } = createFakeDb();
  db.createObjectStore('offline_snapshot', { keyPath: 'key' });
  let currentUid = 'user-a';
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    sessionUser: 'Alice',
    __mkFeat: {
      openOfflineDb: async () => db,
      IDB_SNAPSHOT_STORE: 'offline_snapshot',
      getPinDataKey: () => null,
      getCurrentUserId: async () => currentUid
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(cacheJs, sandbox);
  return { sandbox, stores, setUid: (u) => { currentUid = u; } };
}

test('S5: snapshot user A tidak bisa dimuat sebagai user B; snapshot 30 hari ditandai stale, bukan diterapkan', async () => {
  const { sandbox, stores, setUid } = loadCacheSandbox();
  await sandbox.saveOfflineSnapshot({ wallets: [{ name: 'BCA' }], transactions: [] });
  await sleep(450);
  const loadedA = await sandbox.loadOfflineSnapshot();
  assert.ok(loadedA && loadedA.data, 'pemilik yang sama bisa memuat snapshot');
  assert.equal(loadedA.userId, 'user-a');

  setUid('user-b');
  const loadedB = await sandbox.loadOfflineSnapshot();
  assert.equal(loadedB, null, 'UID berbeda -> null, snapshot orang lain tidak dirender');

  // Kembali sebagai A, lalu tuakan savedAt 30 hari.
  setUid('user-a');
  const rec = stores.get('offline_snapshot').get('latest');
  rec.savedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stale = await sandbox.loadOfflineSnapshot();
  assert.equal(stale.stale, true, 'snapshot 30 hari harus ditandai stale');
  assert.equal(stale.data, null, 'snapshot kedaluwarsa tidak boleh diterapkan');
});

test('S5: clearOfflineSnapshot menghapus snapshot (ganti akun)', async () => {
  const { sandbox } = loadCacheSandbox();
  await sandbox.saveOfflineSnapshot({ wallets: [] });
  await sleep(450);
  assert.ok(await sandbox.loadOfflineSnapshot(), 'snapshot tersimpan');
  assert.equal(await sandbox.clearOfflineSnapshot(), true);
  assert.equal(await sandbox.loadOfflineSnapshot(), null);
});

/* ============================================================
   §9 — CSV import
   ============================================================ */

test('S9: 501 baris data ditolak menyebut batas 500; 15 preamble + 500 data diterima', () => {
  const header = 'tanggal,tipe,kategori,nominal,keterangan,dompet';
  const row = (i) => `2026-11-${String((i % 28) + 1).padStart(2, '0')},Pengeluaran,Makan,${10000 + i},Item ${i},Cash`;
  const tooMany = [header, ...Array.from({ length: 501 }, (_, i) => row(i))].join('\n');
  assert.throws(() => parseTransactionCsv(tooMany, [], [{ id: 'w1', name: 'Cash' }]), /500 baris data/);

  const preamble = Array.from({ length: 15 }, (_, i) => `Catatan preamble ${i + 1}`);
  const okFile = [...preamble, header, ...Array.from({ length: 500 }, (_, i) => row(i))].join('\n');
  const res = parseTransactionCsv(okFile, [], [{ id: 'w1', name: 'Cash' }]);
  assert.equal(res.valid.length, 500, '15 preamble + 500 data harus diterima');
  assert.equal(MAX_DATA_ROWS, 500);
});

test('S9: kategori Ngawur ditolak menyebut baris + kategori; dompet kosong ditolak; nominal -50000 ditolak', () => {
  const wallets = [{ id: 'w1', name: 'Cash' }];
  const opts = { categories: { pengeluaran: ['Makan', 'Lainnya'], pemasukan: ['Gaji'] } };
  const csv = [
    'tanggal,tipe,kategori,nominal,keterangan,dompet',
    '2026-11-10,Pengeluaran,Ngawur,25000,Kopi,Cash',
    '2026-11-11,Pengeluaran,Makan,25000,Kopi,',
    '2026-11-12,Pengeluaran,Makan,-50000,Kopi,Cash',
    '2026-11-13,Pengeluaran,Makan,1000000000000,Kopi,Cash',
    '2026-11-14,Pengeluaran,Makan,25000,Kopi,Cash'
  ].join('\n');
  const res = parseTransactionCsv(csv, [], wallets, opts);
  assert.equal(res.valid.length, 1, 'hanya baris terakhir yang valid');
  assert.equal(res.invalidCount, 4);
  assert.match(res.rows[0].errors.join(' '), /Kategori tidak dikenal: Ngawur.*baris 2/);
  assert.match(res.rows[1].errors.join(' '), /Dompet wajib diisi.*baris 3/);
  assert.match(res.rows[2].errors.join(' '), /negatif/);
  assert.match(res.rows[3].errors.join(' '), /melebihi batas/);
});

test('S9: notasi mutasi bank (kurung akuntansi, DB/CR) tetap valid — bukan "negatif diam-diam"', () => {
  const csv = [
    'Tanggal;Uraian;Mutasi',
    '19/11/2026;TARIK TUNAI ATM;"(150.000)"',
    '19/11/2026;BAYAR QRIS MART;IDR 25.000DB'
  ].join('\n');
  const res = parseTransactionCsv(csv, [], [{ id: 'w-bca', name: 'BCA' }]);
  assert.equal(res.invalidCount, 0);
  assert.equal(res.valid[0].tipe, 'Pengeluaran');
  assert.equal(res.valid[0].nominal, 150000);
});

/* ============================================================
   §6/§10 — klien transfer + validasi (vm, stub sb)
   ============================================================ */

function loadPortfolioClient({ rpcImpl } = {}) {
  const rows = [];
  const calls = { rpc: [], inserts: [], selects: [] };
  const sb = {
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      if (rpcImpl) return rpcImpl(fn, args, rows);
      return { data: [{ id: 'trf-1', ...args }], error: null };
    },
    from: (table) => {
      if (table !== 'transfers') throw new Error('unexpected table ' + table);
      return {
        insert: async (row) => {
          calls.inserts.push(row);
          if (row.idempotency_key && rows.some((r) => r.idempotency_key === row.idempotency_key)) {
            return { error: { code: '23505', message: 'duplicate key' } };
          }
          rows.push({ ...row, id: 'trf-' + (rows.length + 1) });
          return { error: null };
        },
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => {
              calls.selects.push({ col, val });
              return { data: rows.find((r) => r[col] === val) || null, error: null };
            }
          })
        })
      };
    }
  };
  const core = {
    handlers: {}, sb,
    fail: (error) => { if (error) throw new Error(error.message || String(error)); },
    num: (v) => Number(v) || 0,
    ymd: (d) => d.toISOString().slice(0, 10),
    syncPeriod: async () => '',
    trxFromRow: (row) => row,
    fetchAll: async () => [],
    fetchCategoriesOnly: async () => ({}),
    fetchWalletsOnly: async () => ({ wallets: [] }),
    fetchWalletsAndTransfers: async () => ({
      wallets: [],
      transfers: rows.map((r) => ({
        id: r.id, tanggal: r.tanggal, kind: r.kind,
        fromWallet: r.from_wallet || '', toWallet: r.to_wallet || '', nominal: Number(r.nominal), fee: Number(r.fee), keterangan: r.keterangan || ''
      }))
    }),
    fetchAssetsOnly: async () => ({ assets: [] })
  };
  const sandbox = {
    console, __mkSb: core,
    DB: {
      wallets: [
        { id: 'w1', name: 'BCA', openingBalance: 100000 },
        { id: 'w2', name: 'Cash', openingBalance: 0 }
      ],
      transactions: [],
      transfers: []
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(portfolioJs, sandbox);
  return { core, rows, calls, sandbox };
}

const TRANSFER = { tanggal: '2026-11-28', kind: 'transfer', fromWallet: 'w1', toWallet: 'w2', nominal: 100000, fee: 0, keterangan: 'Pindah' };

test('S6: transfer 150.000 dari saldo 100.000 ditolak klien (saldo tidak mencukupi), RPC tidak dipanggil, 0 baris baru', async () => {
  const { core, rows, calls } = loadPortfolioClient();
  await assert.rejects(() => core.handlers.api_addTransfer({ ...TRANSFER, nominal: 150000 }), /Saldo dompet asal tidak mencukupi/);
  assert.equal(calls.rpc.length, 0);
  assert.equal(rows.length, 0);
});

test('S6: transfer tepat 100.000 lolos; 90.000 + fee 20.000 gagal; dompet asal tak dikenal gagal', async () => {
  const { core, calls } = loadPortfolioClient();
  const res = await core.handlers.api_addTransfer({ ...TRANSFER, nominal: 100000 });
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].fn, 'transfer_between_wallets');
  assert.equal(calls.rpc[0].args.p_nominal, 100000);
  assert.equal(calls.rpc[0].args.p_from, 'w1');
  assert.ok(res.transfers !== undefined || res.wallets !== undefined);

  await assert.rejects(() => core.handlers.api_addTransfer({ ...TRANSFER, nominal: 90000, fee: 20000 }), /tidak mencukupi/);
  await assert.rejects(() => core.handlers.api_addTransfer({ ...TRANSFER, fromWallet: 'w-lain' }), /Dompet asal tidak ditemukan/);
});

test('S6: retry kunci idempotency yang sama lewat RPC 23505 -> satu baris, tanpa throw', async () => {
  const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  let rpcCalls = 0;
  const { core, rows, calls } = loadPortfolioClient({
    rpcImpl: async (fn, args) => {
      rpcCalls += 1;
      if (rpcCalls === 2) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "transfers_user_idempotency_key_uidx"' } };
      rows.push({ id: 'trf-1', tanggal: args.p_tanggal, kind: 'transfer', from_wallet: args.p_from, to_wallet: args.p_to, nominal: args.p_nominal, fee: args.p_fee, keterangan: args.p_keterangan, idempotency_key: args.p_idempotency_key });
      return { data: [rows[0]], error: null };
    }
  });
  const first = await core.handlers.api_addTransfer({ ...TRANSFER, idempotencyKey: key });
  assert.equal(first.transfers.length, 1);
  const second = await core.handlers.api_addTransfer({ ...TRANSFER, idempotencyKey: key });
  assert.equal(second.transfers.length, 1, 'retry mengembalikan baris lama');
  assert.equal(rows.length, 1, 'tidak ada duplikat');
  assert.equal(calls.selects.length, 1, 'retry mengambil baris lama via idempotency_key');
});

test('S6: RPC belum ada di server -> error eksplisit migrasi, bukan insert diam-diam', async () => {
  const { core } = loadPortfolioClient({
    rpcImpl: async () => ({ data: null, error: { message: 'Could not find the function public.transfer_between_wallets in the schema cache', code: 'PGRST202' } })
  });
  await assert.rejects(() => core.handlers.api_addTransfer({ ...TRANSFER }), /migrasi transfer_between_wallets belum diterapkan/);
});

test('S6/S10: saldo turunan memakai aturan cashDelta (Utang Pemasukan = 0); updateWallet tanpa field valid ditolak; aset tanpa dompet divalidasi', async () => {
  const { core, sandbox } = loadPortfolioClient();
  sandbox.DB.transactions = [
    { tanggal: '2026-11-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 50000, walletId: 'w1' },
    { tanggal: '2026-11-02', tipe: 'Pemasukan', kategori: 'UtangPerson - Budi', nominal: 999999, walletId: 'w1' },
    { tanggal: '2026-11-03', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 20000, walletId: 'w1' }
  ];
  // 100.000 + 50.000 + 0 (utang masuk bukan kas) - 20.000 = 130.000
  assert.equal(core.computeWalletBalanceFromState(sandbox.DB, 'w1'), 130000);
  assert.equal(core.computeWalletBalanceFromState(sandbox.DB, 'w-tidak-ada'), null);

  await assert.rejects(() => core.handlers.api_updateWallet('w1', { kind: 'bogus', name: '' }), /tidak valid|Tidak ada perubahan|wajib diisi/);
  await assert.rejects(() => core.handlers.api_updateWallet('w1', {}), /Tidak ada perubahan dompet yang valid/);
  await assert.rejects(() => core.handlers.api_addAssetV2({ name: '', type: 'Other', quantity: -1, value: -5 }), /Nama aset|Jumlah aset|Nilai aset/);
  await assert.rejects(() => core.handlers.api_addAssetV2({ name: 'X', type: 'Nope', quantity: 1, value: 100 }), /Jenis aset tidak valid/);
});

/* ============================================================
   §7 — antrean offline (vm)
   ============================================================ */

function loadOfflineSandbox({ online = false, rawImpl } = {}) {
  const storage = createStorage();
  const { db } = createFakeDb({ reverseGetAll: true });
  const rawCalls = [];
  const sandbox = {
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    localStorage: storage,
    sessionStorage: createStorage(),
    document: { getElementById: () => null, addEventListener: () => {} },
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    navigator: { onLine: online },
    indexedDB: createFakeIndexedDB(db),
    DB: { transactions: [], transfers: [] },
    refreshFromServer: async (res) => res,
    __mkFeat: {}
  };
  sandbox.window = sandbox;
  sandbox.callServer = async (fn, ...args) => {
    rawCalls.push({ fn, args });
    if (rawImpl) return rawImpl(fn, args, rawCalls);
    if (fn === 'api_addTransaction') return { transaction: { id: 'srv-' + rawCalls.length, ...(args[0] || {}) } };
    if (fn === 'api_addTransfer') return { transfers: [], wallets: [] };
    if (fn === 'api_saveBudget') return { budgets: [{ kategori: args[0], bulan: args[1], jumlah: args[2] }] };
    if (fn === 'api_savePeriod') return args[0];
    return {};
  };
  vm.runInNewContext(offlineJs, sandbox);
  sandbox.__mkFeat.waitAndWrapCallServer();
  return { sandbox, storage, rawCalls };
}

function readQueue(storage) {
  const raw = storage.getItem('mk_offline_tx_queue_v1');
  return raw ? JSON.parse(raw) : [];
}

test('S7: 5 op campuran di-flush sesuai urutan enqueue (bukan urutan getAll)', async () => {
  const { sandbox, storage, rawCalls } = loadOfflineSandbox({ online: false });
  await sandbox.callServer('api_addTransaction', { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 10000 });
  await sandbox.callServer('api_saveBudget', 'Makan', '2026-11', 500000);
  await sandbox.callServer('api_savePeriod', '2026-11');
  await sandbox.callServer('api_deleteTransfer', 'tr-1');
  await sandbox.callServer('api_addWallet', { name: 'Dana', kind: 'ewallet', openingBalance: 0 });
  const queued = readQueue(storage);
  assert.equal(queued.length, 5);
  assert.deepEqual(queued.map((q) => q.seq), [1, 2, 3, 4, 5], 'seq monoton saat enqueue');
  assert.deepEqual(queued.map((q) => q.op), ['api_addTransaction', 'api_saveBudget', 'api_savePeriod', 'api_deleteTransfer', 'api_addWallet']);

  sandbox.navigator.onLine = true;
  const synced = await sandbox.flushOfflineQueue(true);
  assert.equal(synced, 5);
  assert.deepEqual(rawCalls.map((c) => c.fn), ['api_addTransaction', 'api_saveBudget', 'api_savePeriod', 'api_deleteTransfer', 'api_addWallet']);
  assert.equal(readQueue(storage).length, 0);
});

test('S7: update ditolak server -> delete untuk target yang sama tidak pernah jalan; update gagal permanen setelah 3 percobaan', async () => {
  const { sandbox, storage, rawCalls } = loadOfflineSandbox({
    online: true,
    rawImpl: async (fn) => {
      if (fn === 'api_updateTransaction') throw new Error('Transaksi ditolak server');
      return {};
    }
  });
  // Susun antrean langsung (melewati coalescing enqueue): update lalu delete tx-1.
  await sandbox.__mkFeat.saveOfflineQueueItem({ localId: 'offline-upd-tx-1', op: 'api_updateTransaction', targetId: 'tx-1', payload: { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 10000 }, createdAt: new Date().toISOString() });
  await sandbox.__mkFeat.saveOfflineQueueItem({ localId: 'offline-del-tx-1', op: 'api_deleteTransaction', targetId: 'tx-1', createdAt: new Date().toISOString() });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sandbox.flushOfflineQueue(true);
    assert.equal(rawCalls.filter((c) => c.fn === 'api_deleteTransaction').length, 0, 'delete tidak boleh menyalip update yang gagal (percobaan ' + attempt + ')');
  }
  const queue = readQueue(storage);
  const upd = queue.find((q) => q.op === 'api_updateTransaction');
  assert.ok(upd && upd.failed, 'update gagal permanen setelah 3 percobaan');
  assert.equal(upd.retryCount, 3);
  assert.ok(queue.some((q) => q.op === 'api_deleteTransaction'), 'delete tetap antre, tidak hilang');
});

test('S7: add->update->delete transaksi offline baru ter-koalescing jadi nol panggilan server', async () => {
  const { sandbox, storage, rawCalls } = loadOfflineSandbox({ online: false });
  const added = await sandbox.callServer('api_addTransaction', { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 10000 });
  const localId = added.transaction.id;
  await sandbox.callServer('api_updateTransaction', localId, { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 12000 });
  await sandbox.callServer('api_deleteTransaction', localId);
  assert.equal(readQueue(storage).length, 0, 'add yang lalu dihapus offline tidak meninggalkan antrean');
  sandbox.navigator.onLine = true;
  await sandbox.flushOfflineQueue(true);
  assert.equal(rawCalls.length, 0);
});

test('S7: api_saveBudget offline diantrekan lalu tersinkron; api_savePeriod offline TIDAK dilaporkan tersimpan', async () => {
  const { sandbox, storage, rawCalls } = loadOfflineSandbox({ online: false });
  const budgetRes = await sandbox.callServer('api_saveBudget', 'Makan', '2026-11', 500000);
  assert.equal(budgetRes._offlineQueued, true);
  const periodRes = await sandbox.callServer('api_savePeriod', '2026-11');
  assert.equal(periodRes._offlineQueued, true, 'periode offline harus antre, bukan "sukses"');
  assert.notEqual(periodRes, '2026-11', 'jangan kembalikan args[0] sebagai sukses palsu');
  assert.equal(readQueue(storage).length, 2);
  sandbox.navigator.onLine = true;
  await sandbox.flushOfflineQueue(true);
  assert.deepEqual(rawCalls.map((c) => c.fn), ['api_saveBudget', 'api_savePeriod']);
});

/* ============================================================
   §10 — trxRow MAX_NOMINAL + id carry; import per baris; entitas
   ============================================================ */

function loadRecordsClient() {
  const inserted = [];
  const calls = { inserts: [] };
  const chainable = (data) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      range: async () => ({ data, error: null }),
      maybeSingle: async () => ({ data: Array.isArray(data) ? (data[0] || null) : data, error: null }),
      single: async () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
      then: (resolve) => resolve({ data, error: null })
    };
    return q;
  };
  const sb = {
    rpc: async (fn, args) => {
      calls.rpc = { fn, args };
      return { data: { inserted: { transactions: 1 } }, error: null };
    },
    from: (table) => {
      if (table === 'transactions') {
        return {
          select: () => chainable([]),
          insert: (rows) => {
            calls.inserts.push(rows);
            inserted.push(...rows);
            return { select: () => Promise.resolve({ data: rows.map((r, i) => ({ id: 'srv-' + i, ...r })), error: null }) };
          },
          update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'x' }, error: null }) }) }) }),
          delete: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'x' }, error: null }) }) }) })
        };
      }
      if (table === 'categories') return { select: () => chainable([{ tipe: 'pengeluaran', name: 'Makan' }, { tipe: 'pemasukan', name: 'Gaji' }]) };
      if (table === 'entities') return { select: () => chainable([]), upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) };
      if (table === 'wallets') return { select: () => chainable([{ id: 'w1' }]) };
      if (table === 'settings') return { select: () => chainable([]) };
      if (table === 'budgets' || table === 'recurring') return { select: () => chainable([]) };
      return { select: () => chainable([]) };
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: {}
  };
  const core = {
    handlers: {}, sb,
    fail: (error) => { if (error) throw new Error(error.message || String(error)); },
    num: (v) => Number(v) || 0,
    syncPeriod: async () => '',
    ymd: (d) => d.toISOString().slice(0, 10),
    trxRow: null, // diisi dari core asli di bawah
    trxFromRow: (row) => ({ id: row.id, tanggal: row.tanggal, tipe: row.tipe, kategori: row.kategori, nominal: Number(row.nominal), keterangan: row.keterangan || '', walletId: row.wallet_id || '' }),
    fetchCategoriesOnly: async () => ({ categories: { pemasukan: ['Gaji'], pengeluaran: ['Makan'] } }),
    fetchEntitiesOnly: async () => ({ entities: { UtangApp: [], UtangPerson: [], Piutang: [] } }),
    fetchBudgetsOnly: async () => ({ budgets: [] }),
    fetchRecurringOnly: async () => ({ recurring: [] }),
    fetchAll: async () => [],
    setSetting: async () => {}
  };
  // trxRow asli dari supabase-core.js (butuh stub window.supabase).
  const coreSandbox = {
    window: {
      supabase: { createClient: () => sb },
      APP_CONFIG: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' }
    },
    console
  };
  coreSandbox.window.window = coreSandbox.window;
  vm.runInNewContext(coreJs, coreSandbox);
  const realCore = coreSandbox.window.__mkSb;
  core.trxRow = realCore.trxRow;
  core.fetchAll = realCore.fetchAll;
  const sandbox = { console, __mkSb: core };
  sandbox.window = sandbox;
  vm.runInNewContext(recordsJs, sandbox);
  return { core, inserted, calls, realCore };
}

test('S10: trxRow menolak nominal > MAX dan membawa id sebagai legacy_id', () => {
  const { realCore } = loadRecordsClient();
  assert.throws(() => realCore.trxRow({ tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 1000000000000 }), /melebihi/);
  assert.equal(realCore.MAX_NOMINAL, 999999999999.99);
  const row = realCore.trxRow({ tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, id: 'tx-abc' });
  assert.equal(row.legacy_id, 'tx-abc');
  const ok = realCore.trxRow({ tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 999999999999.99 });
  assert.equal(ok.nominal, 999999999999.99);
});

test('S10: api_importTransactions melaporkan baris gagal per indeks (kategori + dompet asing)', async () => {
  const { core } = loadRecordsClient();
  await assert.rejects(
    () => core.handlers.api_importTransactions([
      { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, walletId: 'w1' },
      { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Ngawur', nominal: 25000, walletId: 'w1' },
      { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 25000, walletId: 'w-asing' }
    ]),
    (err) => /baris 2/.test(err.message) && /baris 3/.test(err.message) && /Ngawur/.test(err.message)
  );
});

test('S10: api_addEntity menolak nama kosong / grup tak dikenal; api_restoreBackup memanggil RPC satu kali', async () => {
  const { core, calls } = loadRecordsClient();
  await assert.rejects(() => core.handlers.api_addEntity('UtangPerson', '   '), /Nama entitas wajib diisi/);
  await assert.rejects(() => core.handlers.api_addEntity('GrupNgawur', 'Budi'), /Grup entitas tidak valid/);
  const res = await core.handlers.api_restoreBackup({ wallets: [], transactions: [] });
  assert.equal(calls.rpc.fn, 'restore_backup');
  assert.deepEqual(plain(res.restored), { inserted: { transactions: 1 } });
});

/* ============================================================
   §10 (koordinator, final assembly): api_saveDebtDueDates menolak
   entri tak valid — tidak lagi dibuang diam-diam lalu sukses.
   ============================================================ */

function loadAdminClient() {
  const calls = { settings: [] };
  const core = {
    sb: { functions: { invoke: async () => ({ data: { success: true }, error: null }) } },
    fail: (e) => { if (e) throw e; },
    fetchAll: async () => [],
    setSetting: async (k, v) => { calls.settings.push([k, v]); },
    handlers: {}
  };
  const sandbox = { console, window: { __mkSb: core } };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(adminJs, sandbox);
  return { core, calls };
}

test('S10: api_saveDebtDueDates menolak entri tak valid dan tidak menyimpan apa pun', async () => {
  const { core, calls } = loadAdminClient();
  const ok = await core.handlers.api_saveDebtDueDates({ 'UtangPerson - Budi': '2026-12-01' });
  assert.deepEqual(plain(ok), { debtDueDates: { 'UtangPerson - Budi': '2026-12-01' } });
  assert.equal(calls.settings.length, 1);
  await assert.rejects(
    () => core.handlers.api_saveDebtDueDates({ 'UtangPerson - Budi': '2026-02-30', 'UtangPerson - Ani': '2026-12-15' }),
    (err) => /tidak valid/.test(err.message) && /UtangPerson - Budi/.test(err.message)
  );
  assert.equal(calls.settings.length, 1); // tidak ada penyimpanan pada input tak valid
  await assert.rejects(() => core.handlers.api_saveDebtDueDates({ 'UtangPerson - Budi': 'bukan-tanggal' }), /tidak valid/);
  await assert.rejects(() => core.handlers.api_saveDebtDueDates(null), /tidak valid/);
});
