// Optimistic locking (Gelombang 7c Item 2) — dua perangkat mengedit
// data yang sama harus KONFLIK, bukan timpa diam-diam.
//
// Bagian:
//   §1  Migrasi baru (string-match + idempotensi).
//   §2  Handler server bersyarat versi (vm, fake sb berversi yang
//       meniru PostgREST: update/delete hanya bila semua filter eq
//       cocok, trigger menaikkan version +1 tiap update).
//   §3  Logika murni + dialog konflik (vm, web/sync-conflict.js).
//   §4  Antrean offline: edit lama di-sync setelah server berubah
//       (vm, web/ui-feat-offline.js + sync-conflict.js).
//   §5  i18n paritas kunci sync.* + jaring pengaman MK_CONFLICT.
//   §6  Jalur impor CSV tidak berubah perilaku (insert baru saja).
//
// Objek vm lintas-realm: deepStrictEqual gagal — bandingkan lewat JSON.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const errorMessagesJs = fs.readFileSync('web/error-messages.js', 'utf8');
const coreJs = fs.readFileSync('web/supabase-core.js', 'utf8');
const recordsJs = fs.readFileSync('web/supabase-records.js', 'utf8');
const planningJs = fs.readFileSync('web/supabase-planning.js', 'utf8');
const portfolioJs = fs.readFileSync('web/supabase-portfolio.js', 'utf8');
const syncConflictJs = fs.readFileSync('web/sync-conflict.js', 'utf8');
const offlineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
const migrationSql = fs.readFileSync('supabase/migrations/20261128130000_optimistic_locking.sql', 'utf8');

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
   Fake sb berversi — meniru PostgREST + trigger bump_version.
   ============================================================ */

function createVersionedSb(seed) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed || {})) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const calls = { selects: [], updates: [], deletes: [], inserts: [], rpc: [] };
  const hooks = { beforeUpdate: null };
  let idSeq = 1000;

  function project(row, cols) {
    if (!cols || cols === '*') return { ...row };
    const out = {};
    for (const c of String(cols).split(',').map((x) => x.trim()).filter(Boolean)) out[c] = row[c];
    return out;
  }

  class Q {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.cols = '*';
      this.op = 'select';
      this.patch = null;
      this.rows = null;
      this.rangeFrom = 0;
      this.rangeTo = Infinity;
    }
    select(cols) { this.cols = cols || '*'; return this; }
    eq(c, v) { this.filters.push([c, v, 'eq']); return this; }
    gte(c, v) { this.filters.push([c, v, 'gte']); return this; }
    in(c, vals) { this.filters.push([c, vals, 'in']); return this; }
    order() { return this; }
    range(a, b) { this.rangeFrom = a; this.rangeTo = b; return this; }
    limit(n) { this.rangeTo = this.rangeFrom + n - 1; return this; }
    insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(row) { this.op = 'upsert'; this.rows = [row]; return this; }
    maybeSingle() { return this._run(true); }
    single() { return this._run(true); }
    then(res, rej) { return this._run(false).then(res, rej); }
    _match(row) {
      return this.filters.every(([c, v, kind]) => {
        if (kind === 'in') return Array.isArray(v) && v.map(String).includes(String(row[c]));
        if (kind === 'gte') return String(row[c]) >= String(v);
        return String(row[c]) === String(v);
      });
    }
    async _run(single) {
      const table = tables[this.table] || (tables[this.table] = []);
      if (this.op === 'insert') {
        const out = [];
        for (const r of this.rows) {
          const row = { ...r, id: r.id || ('id-' + (idSeq++)), version: 1 };
          table.push(row);
          out.push(row);
        }
        calls.inserts.push({ table: this.table, count: out.length });
        const data = single ? (out[0] ? project(out[0], this.cols) : null) : out.map((r) => project(r, this.cols));
        return { data, error: null };
      }
      if (this.op === 'update') {
        if (typeof hooks.beforeUpdate === 'function') hooks.beforeUpdate(this.table, this.patch, this.filters);
        const matched = table.filter((row) => this._match(row));
        for (const row of matched) {
          Object.assign(row, this.patch);
          row.version = (Number(row.version) || 1) + 1; // trigger bump_version
        }
        calls.updates.push({ table: this.table, filters: plain(this.filters), matched: matched.length });
        const data = single ? (matched[0] ? project(matched[0], this.cols) : null) : matched.map((r) => project(r, this.cols));
        return { data, error: null };
      }
      if (this.op === 'delete') {
        const matched = table.filter((row) => this._match(row));
        for (const row of matched) table.splice(table.indexOf(row), 1);
        calls.deletes.push({ table: this.table, filters: plain(this.filters), matched: matched.length });
        const data = single ? (matched[0] ? project(matched[0], this.cols) : null) : matched.map((r) => project(r, this.cols));
        return { data, error: null };
      }
      if (this.op === 'upsert') {
        // Hanya dipakai settings (setSetting): cocokkan key.
        const row = this.rows[0];
        const existing = table.find((r) => String(r.key) === String(row.key));
        if (existing) Object.assign(existing, row);
        else table.push({ ...row });
        return { data: null, error: null };
      }
      const rows = table.filter((row) => this._match(row)).slice(this.rangeFrom, this.rangeTo + 1);
      calls.selects.push({ table: this.table, filters: plain(this.filters) });
      const data = single ? (rows[0] ? project(rows[0], this.cols) : null) : rows.map((r) => project(r, this.cols));
      return { data, error: null };
    }
  }

  const sb = {
    from: (table) => new Q(table),
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: async () => ({ data: null, error: new Error('not used in tests') }) },
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args: plain(args || {}) });
      if (fn === 'save_budget_checked') {
        const budgets = tables.budgets || (tables.budgets = []);
        const found = budgets.find((b) => b.kategori === args.p_kategori && b.bulan === args.p_bulan);
        if (!found) {
          const row = { id: 'bgt-' + (idSeq++), kategori: args.p_kategori, bulan: args.p_bulan, jumlah: args.p_jumlah, version: 1 };
          budgets.push(row);
          return { data: [{ ...row, conflict: false, current_jumlah: null, current_version: null }], error: null };
        }
        if (args.p_expected_version !== null && args.p_expected_version !== undefined &&
            Number(found.version) !== Number(args.p_expected_version)) {
          return { data: [{ ...found, conflict: true, current_jumlah: found.jumlah, current_version: found.version }], error: null };
        }
        found.jumlah = args.p_jumlah;
        found.version = (Number(found.version) || 1) + 1;
        return { data: [{ ...found, conflict: false, current_jumlah: null, current_version: null }], error: null };
      }
      if (fn === 'delete_wallet_checked') {
        const wallets = tables.wallets || [];
        const found = wallets.find((w) => String(w.id) === String(args.p_wallet_id));
        if (!found) return { data: null, error: { message: 'Dompet tidak ditemukan.' } };
        if (args.p_expected_version !== null && args.p_expected_version !== undefined &&
            Number(found.version) !== Number(args.p_expected_version)) {
          return { data: { conflict: true, id: found.id, name: found.name, kind: found.kind, opening_balance: found.opening_balance, version: found.version }, error: null };
        }
        wallets.splice(wallets.indexOf(found), 1);
        return { data: { deleted: true, id: found.id }, error: null };
      }
      return { data: null, error: { message: 'Could not find the function public.' + fn + ' in the schema cache', code: 'PGRST202' } };
    }
  };
  return { sb, tables, calls, hooks };
}

// Muat core ASLI (trxRow, mapper, conflict helpers, syncPeriod) +
// handler records/planning/portfolio di vm dengan fake sb di atas.
function loadHandlers(seed) {
  const { sb, tables, calls, hooks } = createVersionedSb(seed);
  const coreSandbox = {
    window: {
      supabase: { createClient: () => sb },
      APP_CONFIG: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' }
    },
    console
  };
  coreSandbox.window.window = coreSandbox.window;
  vm.runInNewContext(errorMessagesJs, coreSandbox);
  vm.runInNewContext(coreJs, coreSandbox);
  const realCore = coreSandbox.window.__mkSb;

  const sandbox = {
    console,
    __mkSb: realCore,
    DB: { wallets: [], transactions: [], transfers: [] },
    navigator: { onLine: true }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(errorMessagesJs, sandbox);
  vm.runInNewContext(recordsJs, sandbox);
  vm.runInNewContext(planningJs, sandbox);
  vm.runInNewContext(portfolioJs, sandbox);
  return { core: realCore, handlers: realCore.handlers, sb, tables, calls, hooks, sandbox };
}

const TX1 = { id: 'tx-1', tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Nasi goreng', wallet_id: 'w1', version: 1 };
const TX_PAYLOAD = { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Nasi goreng', walletId: 'w1' };
const GOAL1 = { id: 'g-1', name: 'Dana Darurat', target_amount: 5000000, current_amount: 1000000, target_date: '2027-06-01', created_at: '2026-11-01', version: 3 };
const BUDGET1 = { id: 'b-1', kategori: 'Makan', bulan: '2026-11', jumlah: 1000000, version: 2 };
const REC1 = { id: 'r-1', tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 200000, keterangan: '', day_of_month: 5, last_run: null, active: true, version: 1 };
const WALLET1 = { id: 'w1', name: 'BCA Utama', kind: 'bank', opening_balance: 1000000, sort: 1, version: 1 };

function seedAll() {
  return {
    transactions: [{ ...TX1 }],
    financial_goals: [{ ...GOAL1 }],
    budgets: [{ ...BUDGET1 }],
    recurring: [{ ...REC1 }],
    wallets: [{ ...WALLET1 }, { id: 'w2', name: 'Cash', kind: 'cash', opening_balance: 50000, sort: 2, version: 1 }],
    assets: [],
    settings: [],
    categories: [
      { tipe: 'pengeluaran', name: 'Makan' },
      { tipe: 'pemasukan', name: 'Gaji' }
    ]
  };
}

/* ============================================================
   §1 — Migrasi baru
   ============================================================ */

test('§1 migrasi menambahkan kolom version + trigger di 6 tabel, idempotent', () => {
  for (const table of ['transactions', 'financial_goals', 'budgets', 'recurring', 'wallets', 'assets']) {
    assert.match(migrationSql, new RegExp(`alter table public\\.${table}\\s+add column if not exists version integer not null default 1`, 'i'),
      `migrasi harus menambah version di ${table}`);
    assert.match(migrationSql, new RegExp(`'${table}'`, 'i'), `trigger harus dipasang di ${table}`);
  }
  assert.match(migrationSql, /create or replace function public\.bump_version\(\)/);
  assert.match(migrationSql, /new\.version := old\.version \+ 1/);
  assert.match(migrationSql, /drop trigger if exists bump_version_trigger/i);
  assert.match(migrationSql, /before update on public\./i);
  assert.doesNotMatch(migrationSql, /alter table public\.transactions\s+add column if not exists version integer not null default 1;\s*alter table public\.transactions/s,
    'kolom version tiap tabel hanya ditambah sekali');
});

test('§1 RPC save_budget_checked mengunci baris + membandingkan versi; delete_wallet_checked mendelegasikan ke delete_wallet lama', () => {
  assert.match(migrationSql, /create or replace function public\.save_budget_checked\(/);
  assert.match(migrationSql, /for update/i);
  assert.match(migrationSql, /p_expected_version is not null and v_row\.version <> p_expected_version/);
  assert.match(migrationSql, /conflict boolean/);
  assert.match(migrationSql, /create or replace function public\.delete_wallet_checked\(/);
  assert.match(migrationSql, /perform public\.delete_wallet\(p_wallet_id\)/);
  assert.match(migrationSql, /revoke all on function public\.save_budget_checked\(text, text, numeric, integer\) from public, anon/i);
  assert.match(migrationSql, /grant execute on function public\.save_budget_checked\(text, text, numeric, integer\) to authenticated/i);
  assert.match(migrationSql, /revoke all on function public\.delete_wallet_checked\(uuid, integer\) from public, anon/i);
  assert.match(migrationSql, /grant execute on function public\.delete_wallet_checked\(uuid, integer\) to authenticated/i);
  assert.match(migrationSql, /begin;/);
  assert.match(migrationSql, /commit;/);
  assert.doesNotMatch(migrationSql, /to_regproc\(/);
});

/* ============================================================
   §2 — Handler: dua perangkat edit record sama
   ============================================================ */

test('§2 dua perangkat edit transaksi sama: yang kedua KONFLIK (bukan timpa), yang pertama lolos + versi naik', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  // Perangkat A: edit dengan versi 1 (benar) -> sukses, versi jadi 2.
  const resA = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 60000 }, 1);
  assert.equal(resA.transaction.nominal, 60000);
  assert.equal(resA.transaction.version, 2, 'trigger menaikkan versi 1 -> 2');
  assert.equal(tables.transactions[0].nominal, 60000);

  // Perangkat B: edit dengan versi 1 (basi — dibuat sebelum A menyimpan).
  const err = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 70000, keterangan: 'B dari perangkat B' }, 1)
    .then(() => null, (e) => e);
  assert.ok(err, 'edit basi harus gagal');
  assert.equal(err.code, 'MK_CONFLICT');
  assert.equal(err.conflict.kind, 'transaction');
  assert.equal(err.conflict.operation, 'update');
  assert.equal(err.conflict.deletedByOther, false);
  assert.equal(err.conflict.current.nominal, 60000, 'current = nilai perangkat A di server');
  assert.equal(err.conflict.current.version, 2);
  assert.equal(err.conflict.mine.nominal, 70000, 'mine = nilai perangkat B');
  assert.equal(tables.transactions[0].nominal, 60000, 'server TIDAK tertimpa oleh B');
});

test('§2 sync normal tanpa konflik tetap lolos tanpa false positive (edit berurutan)', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  const r1 = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 55000 }, 1);
  assert.equal(r1.transaction.version, 2);
  const r2 = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 56000 }, 2);
  assert.equal(r2.transaction.version, 3);
  assert.equal(tables.transactions[0].nominal, 56000);
});

test('§2 pemanggil lama tanpa expectedVersion tetap terlindungi (fetch-first)', async () => {
  const { handlers, tables, calls } = loadHandlers(seedAll());
  // Tanpa versi: handler membaca versi kini (1) lalu update bersyarat.
  const res = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 65000 });
  assert.equal(res.transaction.nominal, 65000);
  assert.equal(res.transaction.version, 2);
  assert.ok(calls.selects.some((s) => s.table === 'transactions'), 'fetch-first membaca baris dulu');
  // ...dan tetap konflik bila versi bergerak di antara baca-tulis:
  // (disimulasikan dengan hook: update pertama dikalahkan).
  let bumped = false;
  const h2 = loadHandlers(seedAll());
  h2.hooks.beforeUpdate = (table, patch, filters) => {
    if (!bumped && table === 'transactions') {
      bumped = true;
      h2.tables.transactions[0].version = 99; // penulis lain menyalip
    }
  };
  const err = await h2.handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 66000 })
    .then(() => null, (e) => e);
  assert.ok(err && err.code === 'MK_CONFLICT', 'balapan baca-tulis harus konflik, bukan timpa');
  assert.equal(h2.tables.transactions[0].nominal, 50000, 'nilai server tidak berubah');
});

test('§2 force-save setelah dialog (pilihan "Pakai versi saya") menimpa dengan persetujuan', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 60000 }, 1);
  const err = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 70000 }, 1)
    .then(() => null, (e) => e);
  assert.equal(err.code, 'MK_CONFLICT');
  const forced = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 70000 }, 'force');
  assert.equal(forced.transaction.nominal, 70000);
  assert.equal(forced.transaction.version, 3);
  assert.equal(tables.transactions[0].nominal, 70000);
});

test('§2 update atas record yang sudah dihapus perangkat lain -> konflik deletedByOther (bukan "tidak ditemukan")', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  tables.transactions.length = 0; // perangkat lain menghapus
  const err = await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 70000 }, 1)
    .then(() => null, (e) => e);
  assert.ok(err && err.code === 'MK_CONFLICT');
  assert.equal(err.conflict.deletedByOther, true);
  assert.equal(err.conflict.current, null);
  assert.equal(err.conflict.mine.nominal, 70000);
});

/* ============================================================
   §2 — Hapus vs edit bersamaan
   ============================================================ */

test('§2 hapus vs edit: hapus dengan versi basi KONFLIK; hapus dengan versi benar lolos', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 60000 }, 1); // perangkat A edit
  const err = await handlers.api_deleteTransaction('tx-1', 1).then(() => null, (e) => e);
  assert.ok(err && err.code === 'MK_CONFLICT', 'hapus basi harus konflik');
  assert.equal(err.conflict.operation, 'delete');
  assert.equal(err.conflict.current.nominal, 60000);
  assert.equal(tables.transactions.length, 1, 'record TIDAK terhapus oleh hapusan basi');

  const ok = await handlers.api_deleteTransaction('tx-1', 2); // versi kini
  assert.equal(ok.deletedTransactionId, 'tx-1');
  assert.equal(tables.transactions.length, 0);
});

test('§2 hapus dua kali (perangkat lain sudah menghapus) = sukses idempotent, bukan error', async () => {
  const { handlers } = loadHandlers(seedAll());
  const first = await handlers.api_deleteTransaction('tx-1', 1);
  assert.equal(first.deletedTransactionId, 'tx-1');
  assert.equal(first.alreadyDeleted, undefined);
  const second = await handlers.api_deleteTransaction('tx-1', 1);
  assert.equal(second.deletedTransactionId, 'tx-1');
  assert.equal(second.alreadyDeleted, true);
});

test('§2 force-delete setelah dialog ("Tetap hapus") menghapus walau versi bergerak', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  await handlers.api_updateTransaction('tx-1', { ...TX_PAYLOAD, nominal: 60000 }, 1);
  await assert.rejects(() => handlers.api_deleteTransaction('tx-1', 1), (e) => e.code === 'MK_CONFLICT');
  const res = await handlers.api_deleteTransaction('tx-1', 'force');
  assert.equal(res.deletedTransactionId, 'tx-1');
  assert.equal(tables.transactions.length, 0);
});

/* ============================================================
   §2 — Goal, budget, recurring, wallet
   ============================================================ */

test('§2 goal: edit basi konflik + current lengkap; edit benar lolos; hapus basi konflik; hapus ganda idempotent', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  const ok = await handlers.api_saveGoal({ id: 'g-1', name: 'Dana Darurat', targetAmount: 5000000, currentAmount: 1500000, targetDate: '2027-06-01' }, 3);
  assert.equal(ok.goal.currentAmount, 1500000);
  assert.equal(ok.goal.version, 4);

  const err = await handlers.api_saveGoal({ id: 'g-1', name: 'Dana Darurat', targetAmount: 6000000, currentAmount: 1000000, targetDate: '2027-06-01' }, 3)
    .then(() => null, (e) => e);
  assert.ok(err && err.code === 'MK_CONFLICT');
  assert.equal(err.conflict.kind, 'goal');
  assert.equal(err.conflict.current.currentAmount, 1500000);
  assert.equal(err.conflict.current.version, 4);

  const delErr = await handlers.api_deleteGoal('g-1', 3).then(() => null, (e) => e);
  assert.ok(delErr && delErr.code === 'MK_CONFLICT', 'hapus goal basi harus konflik');
  assert.equal(tables.financial_goals.length, 1);
  const del = await handlers.api_deleteGoal('g-1', 4);
  assert.equal(del.deletedGoalId, 'g-1');
  const del2 = await handlers.api_deleteGoal('g-1', 4);
  assert.equal(del2.alreadyDeleted, true);
});

test('§2 budget: upsert basi KONFLIK via RPC; upsert benar lolos; insert baru tanpa versi lolos', async () => {
  const { handlers, tables, calls } = loadHandlers(seedAll());
  const err = await handlers.api_saveBudget('Makan', '2026-11', 1200000, 1).then(() => null, (e) => e);
  assert.ok(err && err.code === 'MK_CONFLICT', 'budget versi 1 (server versi 2) harus konflik');
  assert.equal(err.conflict.kind, 'budget');
  assert.equal(err.conflict.current.jumlah, 1000000);
  assert.equal(tables.budgets[0].jumlah, 1000000, 'server tidak tertimpa');
  assert.equal(calls.rpc[0].fn, 'save_budget_checked');

  const ok = await handlers.api_saveBudget('Makan', '2026-11', 1200000, 2);
  assert.equal(tables.budgets[0].jumlah, 1200000);
  assert.equal(tables.budgets[0].version, 3);

  const created = await handlers.api_saveBudget('Transport', '2026-11', 500000);
  assert.equal(created.budgets.find((b) => b.kategori === 'Transport').jumlah, 500000);
});

test('§2 recurring: edit basi konflik; toggle + markRun retry otomatis sekali saat versi bergerak (tanpa dialog)', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  const err = await handlers.api_saveRecurring({ id: 'r-1', tipe: 'Pengeluaran', kategori: 'Listrik', nominal: 250000, dayOfMonth: 5, keterangan: '', active: true }, 99)
    .then(() => null, (e) => e);
  assert.ok(err && err.code === 'MK_CONFLICT');
  assert.equal(err.conflict.kind, 'recurring');
  assert.equal(err.conflict.current.nominal, 200000);

  // Toggle: penulis lain menyalip tepat sebelum update pertama.
  let bumped = false;
  const h2 = loadHandlers(seedAll());
  h2.hooks.beforeUpdate = (table, patch, filters) => {
    if (!bumped && table === 'recurring') {
      bumped = true;
      h2.tables.recurring[0].version = 5; // balapan
    }
  };
  const toggled = await h2.handlers.api_toggleRecurring('r-1', false);
  assert.equal(toggled.recurring[0].active, 'false', 'toggle berhasil setelah retry dengan versi segar');
  assert.equal(h2.tables.recurring[0].version, 6, 'versi naik sekali (bump balapan + update retry)');

  const marked = await h2.handlers.api_markRecurringRun(['r-1'], '2026-11-28');
  assert.equal(marked.recurring[0].lastRun, '2026-11-28');
});

test('§2 wallet: update basi konflik (mine dari base+patch); delete basi konflik via RPC; delete benar lolos', async () => {
  const { handlers, tables, calls } = loadHandlers(seedAll());
  await handlers.api_updateWallet('w1', { name: 'BCA Baru' }, 1);
  assert.equal(tables.wallets[0].name, 'BCA Baru');
  assert.equal(tables.wallets[0].version, 2);

  const base = { id: 'w1', name: 'BCA Utama', kind: 'bank', openingBalance: 1000000 };
  const err = await handlers.api_updateWallet('w1', { name: 'BCA Lama', __base: base }, 1)
    .then(() => null, (e) => e);
  assert.ok(err && err.code === 'MK_CONFLICT');
  assert.equal(err.conflict.kind, 'wallet');
  assert.equal(err.conflict.mine.name, 'BCA Lama');
  assert.equal(err.conflict.current.name, 'BCA Baru');

  const delErr = await handlers.api_deleteWallet('w1', 1).then(() => null, (e) => e);
  assert.ok(delErr && delErr.code === 'MK_CONFLICT', 'hapus dompet basi harus konflik');
  assert.equal(calls.rpc[calls.rpc.length - 1].fn, 'delete_wallet_checked');
  const del = await handlers.api_deleteWallet('w1', 2);
  assert.equal(tables.wallets.find((w) => w.id === 'w1'), undefined);
  assert.ok(del.wallets.some((w) => w.id === 'w2'));
});

test('§2 getInitialData + mapper membawa version (form bisa membaca versi yang diedit)', async () => {
  const { core } = loadHandlers(seedAll());
  const data = await core.handlers.getInitialData();
  assert.equal(data.transactions[0].version, 1);
  assert.equal(data.budgets[0].version, 2);
  assert.equal(data.goals[0].version, 3);
  assert.equal(data.recurring[0].version, 1);
  assert.equal(data.wallets[0].version, 1);
  assert.equal(core.trxFromRow({ ...TX1, version: 7 }).version, 7);
  assert.equal(core.trxFromRow({ ...TX1, version: undefined }).version, 1, 'tanpa versi -> 1 (server lama)');
});

/* ============================================================
   §3 — Logika murni + dialog konflik (web/sync-conflict.js)
   ============================================================ */

function loadI18n() {
  const html = fs.readFileSync('src/i18n.html', 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'expected <script> block in src/i18n.html');
  const sandbox = {
    localStorage: { getItem: () => 'id', setItem: () => {} },
    document: { addEventListener: () => {}, querySelectorAll: () => [] },
    window: {}
  };
  return vm.runInNewContext(`${scriptMatch[1]}\n({ id: I18N.id, en: I18N.en, t });`, sandbox);
}

function loadConflictSandbox({ swalResponses = [], lang = 'id' } = {}) {
  const i18n = loadI18n();
  const storage = createStorage();
  const swalCalls = [];
  const sandbox = {
    console,
    localStorage: storage,
    sessionStorage: createStorage(),
    document: { getElementById: () => null, addEventListener: () => {} },
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    navigator: { onLine: true },
    __mkFeat: {},
    t: (key) => (lang === 'en' ? (i18n.en[key] || key) : (i18n.id[key] || key)),
    Swal: {
      fire: async (opts) => {
        swalCalls.push(opts);
        const next = swalResponses.shift();
        if (typeof next === 'function') return next(opts);
        return next || { isConfirmed: false };
      }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(errorMessagesJs, sandbox);
  vm.runInNewContext(syncConflictJs, sandbox);
  return { sandbox, sc: sandbox.__mkFeat.syncConflict, storage, swalCalls, i18n };
}

const TX_BASE = { id: 'tx-1', tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Nasi goreng', walletId: 'w1', version: 1 };
const TX_MINE = { ...TX_BASE, nominal: 60000 };
const TX_SERVER = { ...TX_BASE, nominal: 50000, keterangan: 'Nasi goreng + es teh', version: 2 };

test('§3 diff: field yang hanya saya ubah vs hanya server yang ubah teratribusi benar; merge menggabungkan keduanya', () => {
  const { sc } = loadConflictSandbox();
  const diffs = sc.diffConflictFields(TX_BASE, TX_MINE, TX_SERVER, 'transaction');
  assert.equal(diffs.length, 2);
  const byField = Object.fromEntries(diffs.map((d) => [d.field, d]));
  assert.equal(byField.nominal.changedByMe, true);
  assert.equal(byField.nominal.changedByServer, false);
  assert.equal(byField.nominal.bothChanged, false);
  assert.equal(byField.keterangan.changedByMe, false);
  assert.equal(byField.keterangan.changedByServer, true);
  assert.equal(byField.keterangan.bothChanged, false);

  const { merged, unmergeableFields } = sc.mergeConflictValues(TX_BASE, TX_MINE, TX_SERVER, 'transaction');
  assert.deepEqual(plain(unmergeableFields), []);
  assert.equal(merged.nominal, 60000, 'nominal dari saya');
  assert.equal(merged.keterangan, 'Nasi goreng + es teh', 'keterangan dari server');
  assert.equal(merged.kategori, 'Makan', 'field tak berubah tetap');
});

test('§3 diff: field yang diubah KEDUA belah pihak -> bothChanged, merge DITOLAK', () => {
  const { sc } = loadConflictSandbox();
  const mine = { ...TX_BASE, nominal: 60000 };
  const server = { ...TX_BASE, nominal: 75000, version: 2 };
  const diffs = sc.diffConflictFields(TX_BASE, mine, server, 'transaction');
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].bothChanged, true);
  const { merged, unmergeableFields } = sc.mergeConflictValues(TX_BASE, mine, server, 'transaction');
  assert.equal(merged, null);
  assert.deepEqual(plain(unmergeableFields), ['nominal']);
});

test('§3 diff tanpa base -> merge tidak ditawarkan (tidak bisa diatribusikan)', () => {
  const { sc } = loadConflictSandbox();
  const { merged } = sc.mergeConflictValues(null, TX_MINE, TX_SERVER, 'transaction');
  assert.equal(merged, null);
  const diffs = sc.diffConflictFields(null, TX_MINE, TX_SERVER, 'transaction');
  assert.ok(diffs.every((d) => d.bothChanged === true));
});

test('§3 format nilai: nominal jadi Rp, active jadi Ya/Tidak, tanggal apa adanya', () => {
  const { sc } = loadConflictSandbox();
  assert.equal(sc.formatMoney(1500000), 'Rp 1.500.000');
  assert.equal(sc.formatMoney(0), 'Rp 0');
  assert.equal(sc.formatConflictValue('nominal', 50000), 'Rp 50.000');
  assert.equal(sc.formatConflictValue('active', true), 'Ya');
  assert.equal(sc.formatConflictValue('active', 'false'), 'Tidak');
  assert.equal(sc.formatConflictValue('tanggal', '2026-11-28'), '2026-11-28');
  assert.equal(sc.formatConflictValue('keterangan', ''), '—');
  assert.equal(sc.recordLabel({ kind: 'transaction', current: TX_SERVER }), 'Makan — Rp 50.000, 2026-11-28');
  assert.equal(sc.recordLabel({ kind: 'budget', current: { kategori: 'Makan', bulan: '2026-11' } }), 'Anggaran Makan (2026-11)');
});

test('§3 dialog edit-vs-edit menampilkan tabel perubahan (Rp saya vs Rp server) + opsi Gabungkan; pilihan dikembalikan', async () => {
  const { sc, swalCalls } = loadConflictSandbox({
    swalResponses: [{ isConfirmed: true, value: 'merge' }]
  });
  const conflict = {
    kind: 'transaction', id: 'tx-1', operation: 'update',
    mine: TX_MINE, current: TX_SERVER, base: TX_BASE, deletedByOther: false,
    op: 'api_updateTransaction', args: ['tx-1', TX_MINE]
  };
  const choice = await sc.showSyncConflictDialog(conflict);
  assert.equal(choice, 'merge');
  assert.equal(swalCalls.length, 1);
  const opts = swalCalls[0];
  assert.equal(opts.input, 'radio');
  assert.ok(opts.html.includes('Rp 60.000'), 'html dialog memuat nilai saya');
  assert.ok(opts.html.includes('Rp 50.000'), 'html dialog memuat nilai server');
  assert.ok(opts.html.includes('Nasi goreng + es teh'), 'html dialog memuat keterangan server');
  assert.ok(!opts.html.includes('CONFLICT'), 'tidak ada error mentah di dialog');
  assert.ok(!opts.html.includes('MK_CONFLICT'), 'tidak ada kode error di dialog');
  assert.equal(opts.inputOptions.merge, 'Gabungkan keduanya');
  assert.equal(opts.inputOptions.mine, 'Pakai versi saya');
  assert.equal(opts.inputOptions.theirs, 'Pakai versi terbaru');
});

test('§3 dialog tanpa opsi Gabungkan bila ada field bentrok ganda; dialog hapus-vs-edit dan sudah-dihapus', async () => {
  const { sc, swalCalls } = loadConflictSandbox({
    swalResponses: [
      { isConfirmed: true, value: 'mine' },
      { isConfirmed: true, value: 'mine' },
      { isConfirmed: true, value: 'restore' }
    ]
  });
  // Field nominal diubah kedua belah pihak -> tanpa merge.
  const c1 = await sc.showSyncConflictDialog({
    kind: 'transaction', id: 'tx-1', operation: 'update',
    mine: { ...TX_BASE, nominal: 60000 }, current: { ...TX_BASE, nominal: 75000, version: 2 }, base: TX_BASE,
    op: 'api_updateTransaction', args: ['tx-1', { ...TX_BASE, nominal: 60000 }]
  });
  assert.equal(c1, 'mine');
  assert.equal(swalCalls[0].inputOptions.merge, undefined, 'merge tidak ditawarkan');
  assert.match(swalCalls[0].html, /kedua perangkat/);

  // Hapus-vs-edit: opsi Tetap hapus / Batal.
  const c2 = await sc.showSyncConflictDialog({
    kind: 'transaction', id: 'tx-1', operation: 'delete',
    mine: null, current: TX_SERVER, base: null, deletedByOther: false,
    op: 'api_deleteTransaction', args: ['tx-1']
  });
  assert.equal(c2, 'mine');
  assert.equal(swalCalls[1].inputOptions.mine, 'Tetap hapus');
  assert.equal(swalCalls[1].inputOptions.theirs, 'Batal — simpan versi terbaru');

  // Sudah dihapus perangkat lain: opsi Pulihkan / Biarkan terhapus.
  const c3 = await sc.showSyncConflictDialog({
    kind: 'transaction', id: 'tx-1', operation: 'update',
    mine: TX_MINE, current: null, base: TX_BASE, deletedByOther: true,
    op: 'api_updateTransaction', args: ['tx-1', TX_MINE]
  });
  assert.equal(c3, 'restore');
  assert.equal(swalCalls[2].inputOptions.restore, 'Pulihkan sebagai data baru');
  assert.equal(swalCalls[2].inputOptions.theirs, 'Biarkan terhapus');
});

test('§3 buildForceArgs: mine -> tambah force; merge -> payload gabungan tanpa id/version; restore -> insert baru tanpa id', () => {
  const { sc } = loadConflictSandbox();
  const conflict = {
    kind: 'transaction', id: 'tx-1', operation: 'update',
    mine: TX_MINE, current: TX_SERVER, base: TX_BASE, deletedByOther: false,
    op: 'api_updateTransaction', args: ['tx-1', TX_MINE]
  };
  assert.deepEqual(plain(sc.buildForceArgs(conflict, 'mine')), {
    callOp: 'api_updateTransaction', callArgs: ['tx-1', TX_MINE, 'force']
  });
  const merged = sc.buildForceArgs(conflict, 'merge');
  assert.equal(merged.callOp, 'api_updateTransaction');
  assert.equal(merged.callArgs[0], 'tx-1');
  assert.equal(merged.callArgs[1].nominal, 60000);
  assert.equal(merged.callArgs[1].keterangan, 'Nasi goreng + es teh');
  assert.equal(merged.callArgs[1].id, undefined, 'id tidak boleh bocor ke payload (trxRow memakai id sebagai legacy_id)');
  assert.equal(merged.callArgs[1].version, undefined);
  assert.equal(merged.callArgs[2], 'force');

  assert.equal(sc.buildForceArgs(conflict, 'theirs'), null, 'theirs tidak memanggil server');
  assert.equal(sc.buildForceArgs(conflict, 'cancel'), null);

  const deleted = { ...conflict, deletedByOther: true, current: null };
  const restored = sc.buildForceArgs(deleted, 'restore');
  assert.equal(restored.callOp, 'api_addTransaction');
  assert.equal(restored.callArgs[0].nominal, 60000);
  assert.equal(restored.callArgs[0].id, undefined, 'restore memakai id baru dari server');
  assert.equal(restored.callArgs[0].version, undefined);

  const budgetConflict = {
    kind: 'budget', id: 'b-1', operation: 'update',
    mine: { kategori: 'Makan', bulan: '2026-11', jumlah: 1200000 },
    current: { id: 'b-1', kategori: 'Makan', bulan: '2026-11', jumlah: 1000000, version: 2 },
    base: { kategori: 'Makan', bulan: '2026-11', jumlah: 1000000 },
    op: 'api_saveBudget', args: ['Makan', '2026-11', 1200000]
  };
  assert.deepEqual(plain(sc.buildForceArgs(budgetConflict, 'mine')).callArgs, ['Makan', '2026-11', 1200000, 'force']);
});

test('§3 handleOnlineConflict: mine memanggil force-save; theirs me-refresh dari server; bukan konflik diteruskan', async () => {
  const { sc } = loadConflictSandbox({ swalResponses: [{ isConfirmed: true, value: 'mine' }] });
  const calls = [];
  const call = async (op, ...args) => { calls.push({ op, args: plain(args) }); return { transaction: { id: 'tx-1', nominal: 60000 } }; };
  let refreshed = null;
  const refresh = async (p) => { refreshed = p; };
  const err = new Error('CONFLICT:transaction');
  err.code = 'MK_CONFLICT';
  err.conflict = {
    kind: 'transaction', id: 'tx-1', operation: 'update',
    mine: TX_MINE, current: TX_SERVER, base: TX_BASE, deletedByOther: false,
    op: 'api_updateTransaction', args: ['tx-1', TX_MINE]
  };
  const r = await sc.handleOnlineConflict(err, call, refresh);
  assert.equal(r.handled, true);
  assert.equal(r.result.transaction.nominal, 60000);
  assert.deepEqual(calls[0], { op: 'api_updateTransaction', args: ['tx-1', TX_MINE, 'force'] });

  const notConflict = await sc.handleOnlineConflict(new Error('jaringan putus'), call, refresh);
  assert.equal(notConflict.handled, false);
});

test('§3 parkir konflik: disimpan di localStorage, dibaca lagi, dihapus per kunci; prompt berurutan memakai resolver', async () => {
  const { sc, storage, swalCalls } = loadConflictSandbox({
    swalResponses: [
      { isConfirmed: true }, // ringkasan: Lihat & Putuskan
      { isConfirmed: true, value: 'theirs' },
      { isConfirmed: true, value: 'mine' }
    ]
  });
  const c1 = { kind: 'transaction', id: 'tx-1', operation: 'update', mine: TX_MINE, current: TX_SERVER, base: TX_BASE, op: 'api_updateTransaction', args: ['tx-1', TX_MINE] };
  const c2 = { kind: 'budget', id: 'b-1', operation: 'update', mine: { kategori: 'Makan', bulan: '2026-11', jumlah: 1200000 }, current: { kategori: 'Makan', bulan: '2026-11', jumlah: 1000000 }, base: { kategori: 'Makan', bulan: '2026-11', jumlah: 1000000 }, op: 'api_saveBudget', args: ['Makan', '2026-11', 1200000] };
  sc.parkSyncConflict(c1);
  sc.parkSyncConflict(c2);
  assert.equal(sc.getParkedSyncConflicts().length, 2);
  sc.parkSyncConflict(c1); // parkir ulang kunci sama tidak duplikat
  assert.equal(sc.getParkedSyncConflicts().length, 2);

  const resolved = [];
  const count = await sc.promptParkedSyncConflicts(async (conflict, choice) => {
    resolved.push({ key: conflict.key, choice });
    return null;
  });
  assert.equal(count, 2);
  assert.deepEqual(resolved.map((r) => r.choice), ['theirs', 'mine']);
  assert.equal(sc.getParkedSyncConflicts().length, 0, 'yang diputuskan terhapus dari parkir');
  assert.equal(swalCalls[0].title, 'Beberapa perubahan bentrok');
});

/* ============================================================
   §4 — Antrean offline: edit lama di-sync setelah server berubah
   ============================================================ */

function loadOfflineConflictSandbox({ swalResponses = [] } = {}) {
  const i18n = loadI18n();
  const storage = createStorage();
  const swalCalls = [];
  // Server tiruan: satu transaksi berversi.
  let serverTx = { id: 'tx-1', tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Nasi goreng', walletId: 'w1', version: 1 };
  const serverCalls = [];
  function conflictError(kind, details) {
    const e = new Error('CONFLICT:' + kind);
    e.code = 'MK_CONFLICT';
    e.conflict = { kind, ...details };
    return e;
  }
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
    navigator: { onLine: false },
    DB: {
      transactions: [{ id: 'tx-1', tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Nasi goreng', walletId: 'w1', version: 1 }],
      transfers: [],
      budgets: [],
      goals: [],
      recurring: [],
      wallets: []
    },
    refreshFromServer: async (payload) => {
      if (!payload) return;
      if (payload.transaction) {
        const idx = sandbox.DB.transactions.findIndex((x) => String(x.id) === String(payload.transaction.id));
        if (idx === -1) sandbox.DB.transactions.push(payload.transaction);
        else sandbox.DB.transactions[idx] = payload.transaction;
      }
      if (Array.isArray(payload.transactions)) sandbox.DB.transactions = payload.transactions;
      if (payload.deletedTransactionId) {
        sandbox.DB.transactions = sandbox.DB.transactions.filter((x) => String(x.id) !== String(payload.deletedTransactionId));
      }
      if (Array.isArray(payload.budgets)) sandbox.DB.budgets = payload.budgets;
      if (Array.isArray(payload.goals)) sandbox.DB.goals = payload.goals;
      if (Array.isArray(payload.recurring)) sandbox.DB.recurring = payload.recurring;
    },
    refreshNotificationBell: () => {},
    __mkFeat: {},
    t: (key) => i18n.id[key] || key,
    Swal: {
      fire: async (opts) => {
        swalCalls.push(opts);
        const next = swalResponses.shift();
        if (typeof next === 'function') return next(opts);
        return next || { isConfirmed: false };
      }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(errorMessagesJs, sandbox);
  vm.runInNewContext(syncConflictJs, sandbox);
  vm.runInNewContext(offlineJs, sandbox);
  // callServer awal: tidak boleh sampai ke server saat offline.
  sandbox.callServer = async () => { throw new Error('must not reach server while offline'); };
  sandbox.__mkFeat.waitAndWrapCallServer();
  const server = {
    get tx() { return serverTx; },
    setTx(next) { serverTx = next; },
    calls: serverCalls,
    async raw(fn, ...args) {
      serverCalls.push({ fn, args: plain(args) });
      if (fn === 'getInitialData') {
        return {
          transactions: [{ ...serverTx, walletId: serverTx.walletId }],
          budgets: [], goals: [], recurring: [], wallets: []
        };
      }
      if (fn === 'api_updateTransaction') {
        const [id, payload, expectedVersion] = args;
        if (expectedVersion === 'force') {
          serverTx = { ...serverTx, ...payload, id: serverTx.id, version: serverTx.version + 1 };
          delete serverTx.__base;
          return { transaction: { ...serverTx } };
        }
        if (serverTx === null) {
          throw conflictError('transaction', {
            operation: 'update', id, mine: payload, current: null, base: payload.__base || null,
            deletedByOther: true, op: 'api_updateTransaction', args: [id, payload]
          });
        }
        if (expectedVersion !== serverTx.version) {
          throw conflictError('transaction', {
            operation: 'update', id, mine: payload, current: { ...serverTx }, base: payload.__base || null,
            deletedByOther: false, op: 'api_updateTransaction', args: [id, payload]
          });
        }
        serverTx = { ...serverTx, ...payload, id: serverTx.id, version: serverTx.version + 1 };
        delete serverTx.__base;
        return { transaction: { ...serverTx } };
      }
      if (fn === 'api_deleteTransaction') {
        const [id, expectedVersion] = args;
        if (serverTx === null) return { deletedTransactionId: id, alreadyDeleted: true };
        if (expectedVersion !== 'force' && expectedVersion !== serverTx.version) {
          throw conflictError('transaction', {
            operation: 'delete', id, mine: null, current: { ...serverTx }, base: null,
            deletedByOther: false, op: 'api_deleteTransaction', args: [id]
          });
        }
        serverTx = null;
        return { deletedTransactionId: id };
      }
      return {};
    }
  };
  sandbox._rawCallServer = (...args) => server.raw(...args);
  return { sandbox, storage, swalCalls, server };
}

function readQueue(storage) {
  const raw = storage.getItem('mk_offline_tx_queue_v1');
  return raw ? JSON.parse(raw) : [];
}

function readParked(storage) {
  const raw = storage.getItem('mk_sync_conflicts_v1');
  return raw ? JSON.parse(raw) : [];
}

test('§4 edit offline lalu sync setelah server berubah -> KONFLIK diparkir (bukan timpa, bukan retry), lalu "Pakai versi saya" menimpa dengan persetujuan', async () => {
  const { sandbox, storage, swalCalls, server } = loadOfflineConflictSandbox({
    swalResponses: [
      // Ringkasan konflik: pada titik ini konflik SUDAH terparkir
      // tetapi BELUM diputuskan — server harus masih 99.999.
      () => {
        assert.equal(readParked(storage).length, 1, 'konflik terparkir saat dialog ringkasan tampil');
        assert.equal(server.tx.nominal, 99999, 'server belum tertimpa sebelum keputusan pengguna');
        assert.equal(server.tx.version, 2);
        return { isConfirmed: true };
      },
      { isConfirmed: true, value: 'mine' } // dialog konflik: Pakai versi saya
    ]
  });
  // Offline: edit transaksi (base versi 1 ditangkap saat enqueue).
  const queued = await sandbox.callServer('api_updateTransaction', 'tx-1', { ...TX_PAYLOAD, nominal: 60000 });
  assert.equal(queued._offlineQueued, true);
  const items = readQueue(storage);
  assert.equal(items.length, 1);
  assert.equal(items[0].baseVersion, 1, 'versi saat edit dibuat tersimpan di item antrean');
  assert.equal(items[0].base.nominal, 50000, 'snapshot base tersimpan');

  // Perangkat lain mengubah record di server (versi 1 -> 2).
  server.setTx({ ...server.tx, nominal: 99999, keterangan: 'Nasi goreng + es teh', version: 2 });

  // Online + flush: konflik terdeteksi, server TIDAK tertimpa.
  sandbox.navigator.onLine = true;
  const synced = await sandbox.flushOfflineQueue(false);
  assert.equal(synced, 0, 'tidak ada yang tersinkronisasi diam-diam');
  assert.equal(readQueue(storage).length, 0, 'item konflik keluar dari antrean (tidak di-retry)');
  assert.equal(readParked(storage).length, 0, 'konflik sudah diputuskan lewat dialog -> parkir bersih');
  assert.equal(server.tx.nominal, 60000, 'pilihan "Pakai versi saya" menulis ulang paksa');
  assert.equal(server.tx.version, 3);
  assert.ok(swalCalls.some((c) => c.title === 'Beberapa perubahan bentrok'), 'dialog ringkasan tampil');
  assert.ok(swalCalls.some((c) => c.title === 'Ada perubahan yang bentrok'), 'dialog konflik tampil');
  const conflictDialog = swalCalls.find((c) => c.title === 'Ada perubahan yang bentrok');
  assert.ok(conflictDialog.html.includes('Rp 60.000'), 'dialog memuat nilai saya');
  assert.ok(conflictDialog.html.includes('Rp 99.999'), 'dialog memuat nilai server');
});

test('§4 edit offline lalu sync: pilihan "Pakai versi terbaru" membuang edit saya + state lokal ikut server', async () => {
  const { sandbox, storage, swalCalls, server } = loadOfflineConflictSandbox({
    swalResponses: [
      { isConfirmed: true },
      { isConfirmed: true, value: 'theirs' }
    ]
  });
  await sandbox.callServer('api_updateTransaction', 'tx-1', { ...TX_PAYLOAD, nominal: 60000 });
  server.setTx({ ...server.tx, nominal: 99999, keterangan: 'Nasi goreng + es teh', version: 2 });
  sandbox.navigator.onLine = true;
  await sandbox.flushOfflineQueue(false);
  assert.equal(readQueue(storage).length, 0);
  assert.equal(readParked(storage).length, 0);
  assert.equal(server.tx.nominal, 99999, 'server tetap 99.999');
  assert.equal(server.tx.version, 2);
  assert.equal(sandbox.DB.transactions[0].nominal, 99999, 'state lokal ikut server setelah konflik diputuskan');
});

test('§4 edit offline lalu sync TANPA perubahan server -> lolos normal, tanpa dialog, tanpa false positive', async () => {
  const { sandbox, storage, swalCalls, server } = loadOfflineConflictSandbox({ swalResponses: [] });
  await sandbox.callServer('api_updateTransaction', 'tx-1', { ...TX_PAYLOAD, nominal: 60000 });
  sandbox.navigator.onLine = true;
  const synced = await sandbox.flushOfflineQueue(true);
  assert.equal(synced, 1);
  assert.equal(readQueue(storage).length, 0);
  assert.equal(readParked(storage).length, 0, 'tidak ada konflik terparkir');
  assert.equal(server.tx.nominal, 60000);
  assert.equal(server.tx.version, 2);
  assert.equal(swalCalls.length, 0, 'tidak ada dialog konflik');
});

test('§4 hapus offline vs edit di server -> konflik delete diparkir; hapus offline atas record yang sudah dihapus -> sukses idempotent', async () => {
  const { sandbox, storage, server } = loadOfflineConflictSandbox({
    swalResponses: [
      { isConfirmed: true },
      { isConfirmed: true, value: 'theirs' } // Batal — simpan versi terbaru
    ]
  });
  await sandbox.callServer('api_deleteTransaction', 'tx-1');
  const items = readQueue(storage);
  assert.equal(items.length, 1);
  assert.equal(items[0].op, 'api_deleteTransaction');
  assert.equal(items[0].baseVersion, 1);

  server.setTx({ ...server.tx, nominal: 88888, version: 2 }); // perangkat lain mengedit
  sandbox.navigator.onLine = true;
  await sandbox.flushOfflineQueue(false);
  assert.equal(readQueue(storage).length, 0);
  assert.equal(server.tx.nominal, 88888, 'hapusan basi tidak menghapus edit perangkat lain');
  assert.equal(sandbox.DB.transactions[0].nominal, 88888, 'state lokal ikut server');

  // Skenario kedua: record sudah dihapus di server sebelum hapusan offline sampai.
  const s2 = loadOfflineConflictSandbox({ swalResponses: [] });
  await s2.sandbox.callServer('api_deleteTransaction', 'tx-1');
  s2.server.setTx(null);
  s2.sandbox.navigator.onLine = true;
  const synced2 = await s2.sandbox.flushOfflineQueue(true);
  assert.equal(synced2, 1, 'hapus atas record yang sudah tiada dihitung sukses');
  assert.equal(readQueue(s2.storage).length, 0);
  assert.equal(readParked(s2.storage).length, 0);
});

test('§4 update offline atas record yang sudah dihapus di server -> konflik deletedByOther diparkir dengan pilihan pulihkan', async () => {
  const { sandbox, storage, swalCalls, server } = loadOfflineConflictSandbox({
    swalResponses: [
      { isConfirmed: true },
      (opts) => {
        assert.equal(opts.inputOptions.restore, 'Pulihkan sebagai data baru');
        return { isConfirmed: true, value: 'restore' };
      }
    ]
  });
  await sandbox.callServer('api_updateTransaction', 'tx-1', { ...TX_PAYLOAD, nominal: 60000 });
  server.setTx(null); // perangkat lain menghapus
  sandbox.navigator.onLine = true;
  await sandbox.flushOfflineQueue(false);
  assert.equal(readQueue(storage).length, 0);
  // Restore memakai api_addTransaction — server tiruan mengembalikan {}
  // untuk op itu, jadi yang diassert adalah dialognya (bukan hasil server).
  assert.ok(swalCalls.some((c) => c.title === 'Data sudah dihapus di perangkat lain'));
});

/* ============================================================
   §5 — i18n + jaring pengaman + wiring build
   ============================================================ */

test('§5 semua kunci sync.* ada berpasangan ID/EN dan tidak kosong', () => {
  const { id, en } = loadI18n();
  const syncId = Object.keys(id).filter((k) => k.startsWith('sync.')).sort();
  const syncEn = Object.keys(en).filter((k) => k.startsWith('sync.')).sort();
  assert.ok(syncId.length >= 40, `diharapkan >= 40 kunci sync.*, dapat ${syncId.length}`);
  assert.deepEqual(syncId, syncEn, 'kunci sync.* ID dan EN harus identik');
  for (const key of syncId) {
    assert.ok(id[key].trim().length > 0, `${key} (id) tidak boleh kosong`);
    assert.ok(en[key].trim().length > 0, `${key} (en) tidak boleh kosong`);
    assert.notEqual(id[key], key, `${key} (id) harus terisi, bukan kunci mentah`);
  }
});

test('§5 toUserErrorMessage memetakan MK_CONFLICT ke kalimat ramah (jaring pengaman), bukan error mentah', () => {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.runInNewContext(errorMessagesJs, sandbox);
  const err = new Error('CONFLICT:transaction');
  err.code = 'MK_CONFLICT';
  assert.equal(
    sandbox.toUserErrorMessage(err, 'id'),
    'Data ini baru saja diubah di perangkat lain. Muat ulang dan coba lagi.'
  );
  assert.equal(
    sandbox.toUserErrorMessage(err, 'en'),
    'This record was just changed on another device. Reload and try again.'
  );
  assert.doesNotMatch(sandbox.toUserErrorMessage(err, 'id'), /CONFLICT/);
});

test('§5 build.mjs memuat sync-conflict.js sebelum ui-feat-offline.js; @depends-on konsisten', () => {
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');
  const featBlock = /const UI_FEATURES_MODULES = \[([\s\S]*?)\];/.exec(buildMjs)[1];
  const order = [...featBlock.matchAll(/'([^']+\.js)'/g)].map((m) => m[1]);
  assert.ok(order.indexOf('sync-conflict.js') !== -1, 'sync-conflict.js harus di UI_FEATURES_MODULES');
  assert.ok(order.indexOf('sync-conflict.js') < order.indexOf('ui-feat-offline.js'),
    'sync-conflict.js harus dimuat sebelum ui-feat-offline.js');
  assert.match(syncConflictJs, /\/\/ @depends-on: error-messages\.js/);
  assert.match(offlineJs, /\/\/ @depends-on: error-messages\.js, sync-conflict\.js/);
  assert.match(fs.readFileSync('web/supabase-core.js', 'utf8'), /createConflictError/);
  assert.match(fs.readFileSync('web/supabase-records.js', 'utf8'), /\.eq\('version', resolved\.expected\)/);
  assert.match(fs.readFileSync('web/supabase-planning.js', 'utf8'), /save_budget_checked/);
  assert.match(fs.readFileSync('web/supabase-portfolio.js', 'utf8'), /delete_wallet_checked/);
});

/* ============================================================
   §6 — Jalur impor CSV tidak berubah perilaku
   ============================================================ */

test('§6 impor CSV tetap insert baris baru + dedup fingerprint; baris baru mendapat version 1', async () => {
  const { handlers, tables } = loadHandlers(seedAll());
  const res = await handlers.api_importTransactions([
    { tanggal: '2026-11-28', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 50000, keterangan: 'Nasi goreng', walletId: 'w1' },
    { tanggal: '2026-11-27', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 8000000, keterangan: 'Gaji Nov', walletId: 'w1' }
  ]);
  assert.equal(res.addedCount, 1, 'baris duplikat (fingerprint sama) dilewati');
  assert.equal(res.skippedCount, 1);
  assert.equal(tables.transactions.length, 2);
  const added = tables.transactions.find((t) => t.kategori === 'Gaji');
  assert.ok(added, 'baris baru masuk');
  assert.equal(added.version, 1, 'baris impor baru berversi 1');
  assert.equal(tables.transactions.find((t) => t.id === 'tx-1').version, 1, 'baris lama tidak tersentuh impor');
  assert.equal(tables.transactions.find((t) => t.id === 'tx-1').nominal, 50000);
});
