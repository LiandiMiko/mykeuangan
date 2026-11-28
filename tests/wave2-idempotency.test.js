const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const offlineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
const recordsJs = fs.readFileSync('web/supabase-records.js', 'utf8');
const portfolioJs = fs.readFileSync('web/supabase-portfolio.js', 'utf8');
const migrationSql = fs.readFileSync('supabase/migrations/20261128020000_wave2_offline_idempotency.sql', 'utf8');

// Objek yang dibuat di dalam vm context punya prototype berbeda, jadi
// deepStrictEqual lintas-realm gagal — bandingkan lewat JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
   Antrean offline (web/ui-feat-offline.js)
   ============================================================ */

function loadOfflineSandbox({ cryptoImpl } = {}) {
  const storage = createStorage();
  const sandbox = {
    crypto: cryptoImpl || webcrypto,
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
    navigator: { onLine: false },
    console,
    __mkFeat: {}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(offlineJs, sandbox);
  return { sandbox, storage };
}

function readQueue(storage) {
  const raw = storage.getItem('mk_offline_tx_queue_v1');
  return raw ? JSON.parse(raw) : [];
}

const TX_PAYLOAD = {
  tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan',
  nominal: 50000, keterangan: 'Nasi goreng', walletId: 'w1'
};

// callServer dibungkus waitAndWrapCallServer seperti di aplikasi: saat
// offline, mutasi masuk antrean; saat online, _rawCallServer dipanggil.
async function enqueueOffline(sandbox, fn, ...args) {
  if (!sandbox._rawCallServer) {
    sandbox.callServer = async () => { throw new Error('must not reach server while offline'); };
    sandbox.__mkFeat.waitAndWrapCallServer();
  }
  return sandbox.callServer(fn, ...args);
}

test('T13: enqueue transaksi offline menghasilkan kunci UUID, di payload dan di item', async () => {
  const { sandbox, storage } = loadOfflineSandbox();
  const res = await enqueueOffline(sandbox, 'api_addTransaction', TX_PAYLOAD);

  const queue = readQueue(storage);
  assert.equal(queue.length, 1, 'tepat satu item antrean');
  const item = queue[0];
  assert.equal(item.op, 'api_addTransaction');
  assert.match(item.idempotencyKey, UUID_RE, 'field top-level harus UUID v4');
  assert.match(item.payload.idempotencyKey, UUID_RE, 'kunci di dalam payload harus UUID v4');
  assert.equal(item.payload.idempotencyKey, item.idempotencyKey, 'kunci payload dan top-level harus sama');
  assert.equal(res.transaction.id, item.localId, 'respons optimistis memakai localId');
});

test('T13: dua item antrean berbeda mendapat kunci berbeda', async () => {
  const { sandbox, storage } = loadOfflineSandbox();
  await enqueueOffline(sandbox, 'api_addTransaction', TX_PAYLOAD);
  await enqueueOffline(sandbox, 'api_addTransaction', { ...TX_PAYLOAD, keterangan: 'Kopi pagi' });
  await enqueueOffline(sandbox, 'api_addTransfer', {
    tanggal: '2026-11-28', kind: 'transfer', fromWallet: 'w1', toWallet: 'w2', nominal: 100000, fee: 0, keterangan: ''
  });

  const queue = readQueue(storage);
  assert.equal(queue.length, 3);
  const keys = queue.map((x) => x.idempotencyKey);
  for (const key of keys) assert.match(key, UUID_RE);
  assert.equal(new Set(keys).size, 3, 'ketiga kunci harus berbeda');
  assert.equal(queue[2].op, 'api_addTransfer');
  assert.equal(queue[2].payload.idempotencyKey, queue[2].idempotencyKey, 'transfer juga membawa kunci di payload');
});

test('T13: kunci STABIL saat flush ulang — tidak dibuat ulang tiap percobaan', async () => {
  const { sandbox, storage } = loadOfflineSandbox();
  await enqueueOffline(sandbox, 'api_addTransaction', TX_PAYLOAD);
  const storedKey = readQueue(storage)[0].idempotencyKey;

  // Online, tapi server tidak terjangkau: flush gagal di tengah jalan
  // (respons hilang / jaringan putus) lalu dicoba lagi.
  sandbox.navigator.onLine = true;
  const flushedKeys = [];
  sandbox._rawCallServer = async (fn, payload) => {
    flushedKeys.push({ fn, key: payload.idempotencyKey });
    throw new Error('failed to fetch');
  };

  assert.equal(await sandbox.flushOfflineQueue(false), 0, 'flush gagal jaringan: 0 tersinkron');
  assert.equal(await sandbox.flushOfflineQueue(false), 0, 'flush ulang: 0 tersinkron');
  assert.equal(flushedKeys.length, 2, 'dua percobaan flush, dua pengiriman');
  assert.equal(flushedKeys[0].fn, 'api_addTransaction');
  assert.equal(flushedKeys[0].key, storedKey, 'flush pertama memakai kunci saat enqueue');
  assert.equal(flushedKeys[1].key, storedKey, 'flush kedua memakai kunci YANG SAMA — bukan kunci baru');
  assert.equal(readQueue(storage)[0].idempotencyKey, storedKey, 'item antrean tetap membawa kunci yang sama');
  assert.equal(readQueue(storage).length, 1, 'item gagal tidak terhapus dari antrean');
});

test('T13: update menimpa antrean add yang tertunda MEMPERTAHANKAN kunci lama', async () => {
  const { sandbox, storage } = loadOfflineSandbox();
  const res = await enqueueOffline(sandbox, 'api_addTransaction', TX_PAYLOAD);
  const localId = res.transaction.id;
  const originalKey = readQueue(storage)[0].idempotencyKey;

  await enqueueOffline(sandbox, 'api_updateTransaction', localId,
    { ...TX_PAYLOAD, kategori: 'Transport', nominal: 25000 });

  const queue = readQueue(storage);
  assert.equal(queue.length, 1, 'update menimpa antrean add, bukan menambah item');
  assert.equal(queue[0].op, 'api_addTransaction', 'op add dipertahankan');
  assert.equal(queue[0].idempotencyKey, originalKey, 'kunci lama dipertahankan');
  assert.equal(queue[0].payload.idempotencyKey, originalKey, 'kunci di payload baru tetap kunci lama');
  assert.equal(queue[0].payload.kategori, 'Transport', 'payload baru tetap dipakai');
});

test('T13: generator fallback tanpa randomUUID tetap menghasilkan UUID v4 berbeda', () => {
  const { sandbox } = loadOfflineSandbox({
    cryptoImpl: { getRandomValues: (arr) => webcrypto.getRandomValues(arr) }
  });
  const gen = sandbox.__mkFeat.generateIdempotencyKey;
  assert.equal(typeof gen, 'function', 'generator diekspor di __mkFeat untuk pengujian');
  const a = gen();
  const b = gen();
  assert.match(a, UUID_RE);
  assert.match(b, UUID_RE);
  assert.notEqual(a, b, 'dua kunci fallback harus berbeda');
});

/* ============================================================
   Dedup server — api_addTransaction (web/supabase-records.js)
   ============================================================ */

// trxRow/trxFromRow di sini mencerminkan web/supabase-core.js (validasi
// tanggal/tipe/kategori/nominal + field yang dikenal saja). Yang dieksekusi
// sungguhan oleh tes adalah logika idempotensi di api_addTransaction.
function makeTrxHelpers() {
  const trxRow = (d) => {
    if (!d || typeof d !== 'object') throw new Error('Data transaksi tidak valid.');
    const date = String(d.tanggal || '').slice(0, 10);
    const amount = Number(d.nominal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tanggal transaksi tidak valid.');
    if (d.tipe !== 'Pemasukan' && d.tipe !== 'Pengeluaran') throw new Error('Tipe transaksi tidak valid.');
    if (typeof d.kategori !== 'string' || !d.kategori.trim()) throw new Error('Kategori transaksi wajib diisi.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Nominal transaksi harus lebih dari 0.');
    const row = { tanggal: date, tipe: d.tipe, kategori: d.kategori.trim(), nominal: amount, keterangan: d.keterangan || '' };
    if (d.walletId) row.wallet_id = d.walletId;
    return row;
  };
  const trxFromRow = (row) => ({
    id: row.id, tanggal: row.tanggal, tipe: row.tipe, kategori: row.kategori,
    nominal: Number(row.nominal), keterangan: row.keterangan || '', walletId: row.wallet_id || ''
  });
  return { trxRow, trxFromRow };
}

function loadRecordsClient({ hideExistingOnSelect = false } = {}) {
  const rows = []; // "tabel" transactions di server
  const calls = { inserts: [], selects: [], updates: [], deletes: [] };
  const { trxRow, trxFromRow } = makeTrxHelpers();
  const sb = {
    from: (table) => {
      if (table !== 'transactions') throw new Error('unexpected table ' + table);
      return {
        insert: (row) => ({
          select: () => ({
            single: async () => {
              calls.inserts.push(row);
              if (row.idempotency_key && rows.some((r) => r.idempotency_key === row.idempotency_key)) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "transactions_user_idempotency_key_uidx"' } };
              }
              const saved = { ...row, id: 'srv-' + (rows.length + 1), version: 1 };
              rows.push(saved);
              return { data: saved, error: null };
            }
          })
        }),
        select: () => ({
          eq: (col, val) => ({
            maybeSingle: async () => {
              calls.selects.push({ col, val });
              if (hideExistingOnSelect) return { data: null, error: null };
              return { data: rows.find((r) => r[col] === val) || null, error: null };
            }
          })
        }),
        // Gelombang 7c: update BERSYARAT versi — .eq('id').eq('version')
        // harus berantai; versi tak cocok -> 0 baris (bukan timpa).
        update: (row) => {
          const conds = {};
          const chain = {
            eq: (col, val) => { conds[col] = val; return chain; },
            select: () => ({
              maybeSingle: async () => {
                calls.updates.push({ row: plain(row), col: 'id', val: conds.id });
                const found = rows.find((r) => String(r.id) === String(conds.id));
                if (!found) return { data: null, error: null };
                if (conds.version !== undefined && String(found.version || 1) !== String(conds.version)) {
                  return { data: null, error: null }; // versi bergerak -> 0 baris
                }
                Object.assign(found, row);
                found.version = (found.version || 1) + 1; // tiruan trigger bump_version()
                return { data: { ...found }, error: null };
              }
            })
          };
          return chain;
        },
        // Gelombang 7c: delete BERSYARAT versi — .eq('id').eq('version')
        // harus berantai; versi tak cocok -> 0 baris.
        delete: () => {
          const conds = {};
          const chain = {
            eq: (col, val) => { conds[col] = val; return chain; },
            select: () => ({
              maybeSingle: async () => {
                calls.deletes.push({ col: 'id', val: conds.id });
                const idx = rows.findIndex((r) => String(r.id) === String(conds.id));
                if (idx === -1) return { data: null, error: null };
                if (conds.version !== undefined && String(rows[idx].version || 1) !== String(conds.version)) {
                  return { data: null, error: null }; // versi bergerak -> 0 baris
                }
                const [gone] = rows.splice(idx, 1);
                return { data: { id: gone.id }, error: null };
              }
            })
          };
          return chain;
        }
      };
    }
  };
  const core = {
    handlers: {},
    sb,
    // fail() asli (supabase-core.js) membuang code error — karena itu
    // handler harus mengecek error.code SEBELUM memanggil fail().
    fail: (error) => { if (error) throw new Error(error.message || String(error)); },
    num: (v) => Number(v) || 0,
    syncPeriod: async () => '',
    // Helper optimistic locking (Gelombang 7c) — tiruan setia
    // supabase-core.js atas tabel palsu `rows`.
    createConflictError: (kind, details) => {
      const e = new Error('CONFLICT:' + kind);
      e.code = 'MK_CONFLICT';
      e.conflict = { kind, ...details };
      return e;
    },
    loadVersionedRow: async (table, id) => {
      const found = rows.find((r) => String(r.id) === String(id));
      return found ? { ...found, version: found.version || 1 } : null;
    },
    resolveExpectedVersion: async (table, id, columns, expectedVersion) => {
      const found = rows.find((r) => String(r.id) === String(id));
      const current = found ? { ...found, version: found.version || 1 } : null;
      if (expectedVersion === 'force') return { expected: current ? current.version : null, current, force: true };
      if (typeof expectedVersion === 'number') return { expected: expectedVersion, current, force: false };
      return { expected: current ? current.version : null, current, force: false };
    },
    trxRow,
    trxFromRow,
    fetchCategoriesOnly: async () => ({}),
    fetchEntitiesOnly: async () => ({}),
    fetchBudgetsOnly: async () => ({}),
    fetchRecurringOnly: async () => ({}),
    setSetting: async () => {}
  };
  const sandbox = { console, __mkSb: core };
  sandbox.window = sandbox;
  vm.runInNewContext(recordsJs, sandbox);
  return { core, rows, calls };
}

test('T13: api_addTransaction menyimpan kunci; insert ulang kunci sama -> baris lama, tanpa throw, tanpa duplikat', async () => {
  const { core, rows, calls } = loadRecordsClient();
  const key = '11111111-2222-4333-8444-555555555555';

  const first = await core.handlers.api_addTransaction({ ...TX_PAYLOAD, idempotencyKey: key });
  assert.equal(first.transaction.id, 'srv-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].idempotency_key, key, 'kunci tersimpan di baris server');

  // Retry setelah respons hilang: insert kedua menabrak unique index.
  const second = await core.handlers.api_addTransaction({ ...TX_PAYLOAD, idempotencyKey: key });
  assert.equal(second.transaction.id, 'srv-1', 'retry mengembalikan baris yang SUDAH ADA');
  assert.equal(rows.length, 1, 'tidak ada baris duplikat');
  assert.equal(calls.inserts.length, 2, 'insert kedua memang dicoba (lalu ditolak 23505)');
  assert.deepEqual(plain(calls.selects), [{ col: 'idempotency_key', val: key }],
    'handler mencari baris lama berdasarkan kunci');
});

test('T13: api_addTransaction tanpa kunci berperilaku seperti dulu (tanpa idempotency_key)', async () => {
  const { core, rows, calls } = loadRecordsClient();
  const res = await core.handlers.api_addTransaction({ ...TX_PAYLOAD });
  assert.equal(res.transaction.id, 'srv-1');
  assert.equal(rows.length, 1);
  assert.equal(calls.inserts[0].idempotency_key, undefined, 'tanpa kunci, kolom tidak dikirim');
  assert.equal(calls.selects.length, 0, 'tanpa kunci, tidak ada pencarian dedup');
});

test('T13: 23505 tapi baris lama tidak ditemukan (balapan) -> error asli dilempar lagi', async () => {
  const { core, rows } = loadRecordsClient({ hideExistingOnSelect: true });
  const key = '11111111-2222-4333-8444-555555555555';
  await core.handlers.api_addTransaction({ ...TX_PAYLOAD, idempotencyKey: key });
  assert.equal(rows.length, 1);
  await assert.rejects(
    () => core.handlers.api_addTransaction({ ...TX_PAYLOAD, idempotencyKey: key }),
    /duplicate key value/
  );
  assert.equal(rows.length, 1, 'tidak ada baris baru walau error dilempar');
});

test('T13: update/delete berdasar id idempotent — pemanggilan berulang tidak membuat baris baru', async () => {
  const { core, rows, calls } = loadRecordsClient();
  const { transaction } = await core.handlers.api_addTransaction({ ...TX_PAYLOAD });
  assert.equal(rows.length, 1);

  const upd1 = await core.handlers.api_updateTransaction(transaction.id, { ...TX_PAYLOAD, nominal: 60000 });
  const upd2 = await core.handlers.api_updateTransaction(transaction.id, { ...TX_PAYLOAD, nominal: 60000 });
  assert.equal(upd1.transaction.id, transaction.id);
  assert.equal(upd2.transaction.id, transaction.id);
  assert.equal(calls.updates.length, 2, 'update dipanggil dua kali ke id yang sama');
  assert.equal(calls.updates[0].val, transaction.id);
  assert.equal(calls.updates[1].val, transaction.id);
  assert.equal(calls.inserts.length, 1, 'update tidak pernah insert');
  assert.equal(rows.length, 1, 'update berulang tidak membuat baris baru');

  const del1 = await core.handlers.api_deleteTransaction(transaction.id);
  assert.equal(del1.deletedTransactionId, transaction.id);
  assert.equal(rows.length, 0);
  // Delete kedua atas id yang sama (Gelombang 7c, optimistic locking):
  // hapus-vs-hapus = sukses idempotent (alreadyDeleted), BUKAN error
  // "tidak ditemukan" — operasi ini "set to absent", bukan create.
  // Fetch-first di handler sudah tahu barisnya tiada, jadi tidak ada
  // panggilan delete kedua ke server.
  const del2 = await core.handlers.api_deleteTransaction(transaction.id);
  assert.equal(del2.deletedTransactionId, transaction.id);
  assert.equal(del2.alreadyDeleted, true);
  assert.equal(calls.deletes.length, 1, 'hapus kedua tidak sampai ke server (baris sudah diketahui tiada)');
  assert.equal(calls.inserts.length, 1, 'delete tidak pernah insert');
  assert.equal(rows.length, 0);
});

test('T13: jalur impor massal tidak disentuh (tetap fingerprint dedup, tanpa idempotency)', () => {
  const importBlock = recordsJs.slice(recordsJs.indexOf('api_importTransactions'), recordsJs.indexOf('api_addCategory'));
  assert.doesNotMatch(importBlock, /idempotency/);
  assert.match(importBlock, /transactionFingerprint/);
});

/* ============================================================
   Dedup server — api_addTransfer (web/supabase-portfolio.js)
   ============================================================ */

function loadPortfolioClient() {
  const rows = []; // "tabel" transfers di server
  const calls = { inserts: [], selects: [] };
  const sb = {
    from: (table) => {
      if (table !== 'transfers') throw new Error('unexpected table ' + table);
      return {
        insert: async (row) => {
          calls.inserts.push(row);
          if (row.idempotency_key && rows.some((r) => r.idempotency_key === row.idempotency_key)) {
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint "transfers_user_idempotency_key_uidx"' } };
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
    handlers: {},
    sb,
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
        fromWallet: r.from_wallet || '', toWallet: r.to_wallet || '',
        nominal: Number(r.nominal), fee: Number(r.fee), keterangan: r.keterangan || ''
      }))
    }),
    fetchAssetsOnly: async () => ({ assets: [] })
  };
  const sandbox = { console, __mkSb: core };
  sandbox.window = sandbox;
  vm.runInNewContext(portfolioJs, sandbox);
  return { core, rows, calls };
}

const TRANSFER_PAYLOAD = {
  tanggal: '2026-11-28', kind: 'transfer', fromWallet: 'w1', toWallet: 'w2',
  nominal: 100000, fee: 0, keterangan: 'Pindah dana'
};

test('T13: api_addTransfer menyimpan kunci; insert ulang kunci sama -> daftar lama, tanpa throw, tanpa duplikat', async () => {
  const { core, rows, calls } = loadPortfolioClient();
  const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  const first = await core.handlers.api_addTransfer({ ...TRANSFER_PAYLOAD, idempotencyKey: key });
  assert.equal(first.transfers.length, 1);
  assert.equal(first.transfers[0].id, 'trf-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].idempotency_key, key, 'kunci tersimpan di baris server');

  // Retry setelah respons hilang.
  const second = await core.handlers.api_addTransfer({ ...TRANSFER_PAYLOAD, idempotencyKey: key });
  assert.equal(second.transfers.length, 1, 'hasil retry berisi tepat satu transfer (yang lama)');
  assert.equal(second.transfers[0].id, 'trf-1');
  assert.equal(rows.length, 1, 'tidak ada transfer duplikat');
  assert.equal(calls.inserts.length, 2);
  assert.deepEqual(plain(calls.selects), [{ col: 'idempotency_key', val: key }]);
});

test('T13: api_addTransfer tanpa kunci berperilaku seperti dulu', async () => {
  const { core, rows, calls } = loadPortfolioClient();
  const res = await core.handlers.api_addTransfer({ ...TRANSFER_PAYLOAD });
  assert.equal(res.transfers.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(calls.inserts[0].idempotency_key, undefined);
  assert.equal(calls.selects.length, 0);
});

/* ============================================================
   Guard: migrasi + sumber (T13)
   ============================================================ */

test('T13: migrasi membuat kolom idempotency_key + unique index per pengguna di kedua tabel', () => {
  assert.match(migrationSql, /alter table public\.transactions\s+add column if not exists idempotency_key text/i);
  assert.match(migrationSql, /alter table public\.transfers\s+add column if not exists idempotency_key text/i);
  assert.match(migrationSql, /create unique index if not exists transactions_user_idempotency_key_uidx\s+on public\.transactions \(user_id, idempotency_key\)/i);
  assert.match(migrationSql, /create unique index if not exists transfers_user_idempotency_key_uidx\s+on public\.transfers \(user_id, idempotency_key\)/i);
  // Baris lama berkunci NULL tidak boleh saling bertabrakan — alasannya
  // terdokumentasi di migrasi.
  assert.match(migrationSql, /NULL berbeda dengan\s*\n-- NULL lain|NULL.*berbeda/i);
  assert.match(migrationSql, /begin;/i);
  assert.match(migrationSql, /commit;/i);
});

test('T13: kunci dibuat sekali saat enqueue (bukan saat flush) dan dikirim lewat payload', () => {
  assert.match(offlineJs, /function generateIdempotencyKey\(\)/);
  assert.match(offlineJs, /cryptoObj\.randomUUID\(\)/);
  assert.match(offlineJs, /getRandomValues/);
  // Ketiga situs enqueue membawa kunci; flush TIDAK membuat kunci baru.
  const enqueueBlock = offlineJs.slice(offlineJs.indexOf('async function queueOfflineMutation'));
  assert.match(enqueueBlock, /attachIdempotencyKey\(\{ localId, op, payload/);
  assert.match(enqueueBlock, /attachIdempotencyKey\(\{ localId, op: 'api_addTransfer'/);
  const flushBlock = offlineJs.slice(offlineJs.indexOf('async function flushOfflineQueue'), offlineJs.indexOf('const OFFLINE_MUTATIONS'));
  assert.doesNotMatch(flushBlock, /generateIdempotencyKey|attachIdempotencyKey/);
  assert.match(flushBlock, /_rawCallServer\('api_addTransaction', Object\.assign\(\{\}, payload\)\)/);
  assert.match(flushBlock, /_rawCallServer\('api_addTransfer', Object\.assign\(\{\}, payload\)\)/);
  // Server: kedua handler mengecek 23505 SEBELUM fail() (fail membuang code).
  for (const src of [recordsJs, portfolioJs]) {
    assert.match(src, /error\.code === '23505'/);
    assert.match(src, /\.eq\('idempotency_key', idempotencyKey\)\.maybeSingle\(\)/);
  }
});
