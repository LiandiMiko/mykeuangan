// Hotfix P0 (2026-11-28) — regresi untuk dua error live v3.20.16 yang
// dilaporkan Liandi (18:38–18:39 WIB):
//   (1) "column reference \"id\" is ambiguous" (Postgres 42702) — setiap
//       transfer antar dompet, beli aset, dan simpan anggaran GAGAL.
//       Akar masalah: fungsi PL/pgSQL yang mendeklarasikan
//       `RETURNS TABLE (id, ...)` memakai kolom OUT itu BARE di klausa
//       SQL (`where id = ...`, `and kategori = ...`, `returning id`),
//       sehingga PL/pgSQL tidak tahu nama itu variabel OUT atau kolom
//       tabel (default #variable_conflict = error -> 42702). Kelas
//       bugnya NAMA KOLOM OUT APA PUN, bukan hanya `id`: situs keempat
//       (`and kategori =` / `and bulan =` di SELECT awal
//       save_budget_checked) lolos dari audit pertama karena triase
//       hasil audit keliru menggolongkannya false positive — padahal
//       SELECT itu statement PERTAMA fungsi, jadi SEMUA simpan anggaran
//       gagal (baru maupun yang sudah ada), bukan hanya yang sudah ada.
//       Diperbaiki di migrasi 20261128140000_hotfix_ambiguous_id.sql
//       (kualifikasi `w.id` / `b.id` / `b.kategori` / `b.bulan` /
//       `assets.id`).
//   (2) "hasPin is not defined" (ReferenceError) — setiap set/ubah PIN
//       GAGAL. Akar masalah: `const hasPin` hanya didefinisikan di
//       `openAccountSettingsModal()`, tapi `applyAccountSettingsUpdate()`
//       memakainya. Diperbaiki dengan menghitung `hasPin` di dalam
//       `applyAccountSettingsUpdate()` (web/ui-feat-account.js).
//   (3) Celah sanitizer U9: kedua pesan mentah di atas lolos
//       `toUserErrorMessage` dan tampil apa adanya ke pengguna.
//       Diperbaiki dengan memperluas TECHNICAL_RE (web/error-messages.js).
//
// §1 memindai DEFINISI EFEKTIF setiap fungsi RETURNS TABLE: migrasi
// diterapkan berurutan berdasarkan nama file, dan `CREATE OR REPLACE`
// terakhir untuk satu nama fungsi adalah yang berjalan di produksi.
// Definisi lama yang sudah digantikan (040000/050000/130000 masih memuat
// baris buggy) TIDAK dihitung — yang diuji adalah yang efektif. Bila
// migrasi baru di masa depan memperkenalkan lagi referensi BARE ke kolom
// OUT, tes ini gagal.
//
// Catatan jujur: tes §1 adalah penjaga statis (pola regex atas teks SQL),
// bukan eksekusi SQL. Bukti eksekusinya ada di audit-047: repro 42702
// melawan produksi (rollback) + probe negatif pasca-perbaikan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

/* ============================================================
   §1 Penjaga SQL — tidak ada kolom OUT RETURNS TABLE yang
   dipakai BARE di badan fungsi yang efektif
   ============================================================ */

const MIG_DIR = 'supabase/migrations';

function stripSqlComments(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// Ambil semua fungsi RETURNS TABLE dari satu berkas SQL:
// { name, cols: [nama kolom OUT], body }.
function parseReturnsTableFunctions(sql) {
  const fns = [];
  const headRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = headRe.exec(sql))) {
    const name = m[1];
    // Cari `returns table (` di jendela setelah tanda kurung argumen —
    // berhenti bila ketemu definisi fungsi berikutnya duluan.
    const window = sql.slice(headRe.lastIndex, headRe.lastIndex + 2000);
    const nextFn = window.search(/create\s+(?:or\s+replace\s+)?function\s/i);
    const rt = /returns\s+table\s*\(/i.exec(window);
    if (!rt || (nextFn !== -1 && nextFn < rt.index)) continue;
    const colsStart = headRe.lastIndex + rt.index + rt[0].length;
    // Daftar kolom bisa memuat tipe berparameter (numeric(10,2)) —
    // hitung kedalaman kurung.
    let depth = 1;
    let i = colsStart;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    const colsText = sql.slice(colsStart, i - 1);
    const cols = colsText
      .split(',')
      .map((s) => s.trim().split(/\s+/)[0])
      .filter(Boolean);
    const bodyStart = sql.indexOf('$$', i);
    if (bodyStart === -1) continue;
    const bodyEnd = sql.indexOf('$$', bodyStart + 2);
    if (bodyEnd === -1) continue;
    fns.push({ name, cols, body: sql.slice(bodyStart + 2, bodyEnd) });
    headRe.lastIndex = bodyEnd + 2;
  }
  return fns;
}

// Pola berbahaya: kolom OUT dipakai tanpa kualifikasi tabel/alias.
// Yang TIDAK ditangkap (sengaja, supaya tidak false positive):
//   - daftar kolom INSERT `(user_id, tanggal, ...)`
//   - alias `... as <kolom>`
//   - daftar INTO `into id, tanggal, ...`
//   - referensi terkualifikasi `w.id`, `v_row.id`, `assets.id`
function bareOutRefs(body, cols) {
  const hits = [];
  for (const col of cols) {
    const patterns = [
      { label: 'WHERE/AND/OR', re: new RegExp(`(?:where|and|or)\\s+${col}\\s*=`, 'gi') },
      { label: 'RETURNING', re: new RegExp(`returning\\s+${col}\\b`, 'gi') },
      { label: 'ORDER BY', re: new RegExp(`order\\s+by\\s+${col}\\b`, 'gi') },
      { label: 'GROUP BY', re: new RegExp(`group\\s+by\\s+${col}\\b`, 'gi') },
      { label: 'SELECT', re: new RegExp(`select\\s+${col}\\s*(?:,|\\s+from)`, 'gi') }
    ];
    for (const { label, re } of patterns) {
      const found = re.exec(body);
      if (found) hits.push(`${label} <${col}>: "${found[0].trim()}"`);
    }
  }
  return hits;
}

function effectiveReturnsTableFunctions() {
  const files = fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  assert.ok(files.length > 0, 'tidak ada berkas migrasi ditemukan');
  const effective = new Map(); // nama fungsi -> { file, cols, body }
  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(`${MIG_DIR}/${file}`, 'utf8'));
    for (const fn of parseReturnsTableFunctions(sql)) {
      effective.set(fn.name, { file, cols: fn.cols, body: fn.body });
    }
  }
  return effective;
}

test('§1 guard SQL: definisi EFEKTIF fungsi RETURNS TABLE bebas referensi BARE ke kolom OUT', () => {
  const effective = effectiveReturnsTableFunctions();
  assert.ok(effective.size >= 3, `diharapkan >= 3 fungsi RETURNS TABLE, dapat ${effective.size}`);
  const problems = [];
  for (const [name, fn] of effective) {
    const hits = bareOutRefs(fn.body, fn.cols);
    if (hits.length > 0) {
      problems.push(`${name} (efektif dari ${fn.file}): ${hits.join('; ')}`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    'Referensi BARE ke kolom OUT = 42702 saat fungsi dipanggil. Kualifikasi dengan alias tabel (w.id / b.id / assets.id):\n' +
      problems.join('\n')
  );
});

test('§1 guard SQL: tiga fungsi yang diperbaiki hotfix P0 efektif dari migrasi 20261128140000 dan terkualifikasi', () => {
  const effective = effectiveReturnsTableFunctions();
  const hotfixFile = '20261128140000_hotfix_ambiguous_id.sql';
  for (const name of ['transfer_between_wallets', 'create_asset_with_expense', 'save_budget_checked']) {
    const fn = effective.get(name);
    assert.ok(fn, `${name} tidak ditemukan di migrasi`);
    assert.equal(
      fn.file,
      hotfixFile,
      `${name} efektif dari ${fn.file}, bukan ${hotfixFile} — migrasi hotfix tidak menggantikan definisi lama`
    );
  }
  const transfer = effective.get('transfer_between_wallets').body;
  assert.match(transfer, /where w\.id = p_from for update/, 'transfer: w.id = p_from');
  assert.match(transfer, /where w\.id = v_first_id for update/, 'transfer: w.id = v_first_id');
  assert.match(transfer, /where w\.id = v_second_id for update/, 'transfer: w.id = v_second_id');
  const saveBudget = effective.get('save_budget_checked').body;
  assert.match(saveBudget, /from public\.budgets as b/, 'save_budget_checked: FROM memakai alias b');
  assert.match(saveBudget, /where b\.user_id = auth\.uid\(\)/, 'save_budget_checked: b.user_id');
  assert.match(saveBudget, /and b\.kategori = btrim\(p_kategori\)/, 'save_budget_checked: b.kategori');
  assert.match(saveBudget, /and b\.bulan = p_bulan/, 'save_budget_checked: b.bulan');
  assert.match(
    saveBudget,
    /where b\.id = v_row\.id/,
    'save_budget_checked: b.id = v_row.id'
  );
  assert.match(
    effective.get('create_asset_with_expense').body,
    /returning assets\.id into v_asset_id/,
    'create_asset_with_expense: returning assets.id'
  );
});

/* ============================================================
   §2 Regresi hasPin — applyAccountSettingsUpdate dengan PIN
   (pola sandbox dari tests/pin-encryption-gating.test.js)
   ============================================================ */

function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  };
}

// loadAccountModule mengembalikan sandbox + pencatat panggilan.
function loadAccountModule() {
  const storage = createStorage();
  const session = createStorage();
  const swalCalls = [];
  const serverCalls = [];
  const swalPinQueue = [];
  const sandbox = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    localStorage: storage,
    sessionStorage: session,
    indexedDB: { open: () => { throw new Error('indexedDB tidak tersedia di tes ini'); } },
    navigator: { onLine: true },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      documentElement: { classList: { contains: () => false } }
    },
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    console,
    DB: { transactions: [] },
    Swal: {
      fire: async (opts = {}) => {
        swalCalls.push(opts);
        // Prompt verifikasi PIN (input password): jawab dari antrean.
        if (opts && opts.input === 'password') {
          const pin = swalPinQueue.shift();
          return pin === undefined ? { isConfirmed: false, value: '' } : { isConfirmed: true, value: pin };
        }
        return {};
      },
      showValidationMessage: () => {},
      showLoading: () => {}
    },
    getSwalClass: () => '',
    t: (k) => k,
    escapeHtmlJS: (s) => String(s ?? ''),
    sessionUser: 'tester',
    callServer: async (action, payload) => {
      serverCalls.push({ action, payload });
      if (action === 'api_updateOwnProfile') return { displayName: payload };
      return {};
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/ui-feat-offline.js', 'utf8'), sandbox, { filename: 'ui-feat-offline.js' });
  vm.runInContext(fs.readFileSync('web/ui-feat-account.js', 'utf8'), sandbox, { filename: 'ui-feat-account.js' });
  const apply = sandbox.__mkFeat.applyAccountSettingsUpdate;
  const promptVerify = sandbox.__mkFeat.promptVerifyCurrentPin;
  assert.equal(typeof apply, 'function', 'applyAccountSettingsUpdate harus terekspos di __mkFeat');
  assert.equal(typeof promptVerify, 'function', 'promptVerifyCurrentPin harus terekspos di __mkFeat');
  return { sandbox, storage, session, swalCalls, serverCalls, swalPinQueue, apply, promptVerify };
}

const NEW_HASH_RE = /^pbkdf2\$600000\$[0-9a-f]+$/i;

function lastSuccessSwal(swalCalls) {
  return [...swalCalls].reverse().find((c) => c && c.icon === 'success');
}

// Fungsi ini menelan error (catch -> showActionError bila ada); karena
// itu tes TIDAK menegaskan "tidak throw", melainkan HASILNYA: hash
// tersimpan + Swal sukses muncul. Bila ReferenceError masih ada, kedua
// hasil itu tidak terjadi (fungsi berhenti sebelum hashPin + Swal).
test('§2 hasPin: set PIN baru (belum ada PIN) menyimpan hash 600k + Swal sukses', async () => {
  const { storage, swalCalls, apply } = loadAccountModule();
  assert.equal(storage.getItem('mk_app_pin_hash'), null);
  await apply({ displayName: 'tester', pin: '111111' });
  const hash = storage.getItem('mk_app_pin_hash');
  assert.match(hash || '', NEW_HASH_RE, 'hash PIN baru harus format pbkdf2$600000$<hex>');
  assert.ok(lastSuccessSwal(swalCalls), 'Swal sukses harus muncul setelah set PIN');
  assert.ok(storage.getItem('mk_pin_data_key_wrap'), 'wrap DEK harus tersimpan');
});

test('§2 hasPin: ubah PIN dengan PIN lama benar membungkus ulang DEK YANG SAMA (tanpa ReferenceError)', async () => {
  const { sandbox, storage, swalCalls, swalPinQueue, apply, promptVerify } = loadAccountModule();
  await apply({ displayName: 'tester', pin: '111111' });
  const dekBefore = sandbox.__mkFeat.getPinDataKey();
  assert.ok(dekBefore, 'DEK harus ada setelah PIN pertama dibuat');
  const hashBefore = storage.getItem('mk_app_pin_hash');

  // Verifikasi PIN lama lewat jalur UI (mengisi lastVerifiedPin).
  swalPinQueue.push('111111');
  assert.equal(await promptVerify('Verifikasi PIN saat ini'), true, 'PIN lama yang benar harus lolos verifikasi');

  await apply({ displayName: 'tester', pin: '222222' });
  const hashAfter = storage.getItem('mk_app_pin_hash');
  assert.match(hashAfter || '', NEW_HASH_RE, 'hash PIN baru harus format pbkdf2$600000$<hex>');
  assert.notEqual(hashAfter, hashBefore, 'hash harus berubah setelah ganti PIN');
  assert.strictEqual(
    sandbox.__mkFeat.getPinDataKey(),
    dekBefore,
    'DEK harus SAMA (rewrap, bukan DEK baru) — data lokal tidak perlu dienkripsi ulang'
  );
  assert.ok(lastSuccessSwal(swalCalls), 'Swal sukses harus muncul setelah ubah PIN');

  // PIN baru benar-benar berlaku, PIN lama tidak lagi.
  swalPinQueue.push('222222');
  assert.equal(await promptVerify('Verifikasi PIN saat ini'), true, 'PIN baru harus lolos verifikasi');
});

test('§2 hasPin: PIN lama salah -> verifikasi gagal, lalu ubah PIN tetap berhasil lewat fallback DEK baru', async () => {
  const { sandbox, storage, swalCalls, swalPinQueue, apply, promptVerify } = loadAccountModule();
  await apply({ displayName: 'tester', pin: '111111' });
  const dekBefore = sandbox.__mkFeat.getPinDataKey();

  // PIN lama salah: verifikasi menolak, lockout tercatat (1 percobaan),
  // lastVerifiedPin tetap kosong.
  swalPinQueue.push('999999');
  assert.equal(await promptVerify('Verifikasi PIN saat ini'), false, 'PIN lama yang salah harus ditolak');
  const lockState = JSON.parse(storage.getItem('mk_pin_lock_state_v1') || 'null');
  assert.ok(lockState && lockState.attempts >= 1, 'percobaan gagal harus tercatat di state lockout');

  // Tanpa lastVerifiedPin, rewrap dilewati -> fallback createPinDataKey.
  await apply({ displayName: 'tester', pin: '333333' });
  const hashAfter = storage.getItem('mk_app_pin_hash');
  assert.match(hashAfter || '', NEW_HASH_RE, 'hash PIN baru harus tersimpan walau PIN lama salah');
  assert.notStrictEqual(
    sandbox.__mkFeat.getPinDataKey(),
    dekBefore,
    'fallback membuat DEK baru (rewrap mustahil tanpa PIN lama yang benar)'
  );
  assert.ok(lastSuccessSwal(swalCalls), 'Swal sukses harus muncul setelah ubah PIN via fallback');

  // Jalur unit rewrapPinDataKey: rewrap HANYA memverifikasi PIN lama
  // bila DEK belum ada di memori (jalur unwrap). Bila DEK sudah di
  // memori (baru dibuat/di-unlock di sesi ini), PIN lama tidak dicek
  // lagi — itu benar secara desain, karena lastVerifiedPin hanya diisi
  // setelah verifikasi berhasil. Jadi uji kontrak yang sebenarnya:
  // kosongkan dulu memori DEK, lalu PIN lama salah -> false, PIN lama
  // benar -> true (DEK kembali di memori, terbungkus PIN baru).
  const rewrap = sandbox.__mkFeat.pinDataKey.rewrapPinDataKey;
  assert.equal(typeof rewrap, 'function');
  sandbox.__mkFeat.clearPinDataKey();
  assert.equal(await rewrap('999999', '444444'), false, 'rewrap tanpa DEK di memori + PIN lama salah harus false');
  assert.equal(await rewrap('333333', '444444'), true, 'rewrap tanpa DEK di memori + PIN lama benar harus true');
  assert.ok(sandbox.__mkFeat.getPinDataKey(), 'DEK harus kembali ada di memori setelah rewrap berhasil');
});

test('§2 hasPin: ubah nama tampilan saja (tanpa PIN) memanggil server + Swal sukses', async () => {
  const { sandbox, serverCalls, swalCalls, apply } = loadAccountModule();
  await apply({ displayName: 'tester-baru', pin: '' });
  assert.deepEqual(serverCalls, [{ action: 'api_updateOwnProfile', payload: 'tester-baru' }]);
  assert.equal(sandbox.sessionUser, 'tester-baru', 'sessionUser harus diperbarui dari jawaban server');
  assert.ok(lastSuccessSwal(swalCalls), 'Swal sukses harus muncul');
  assert.equal(sandbox.localStorage.getItem('mk_app_pin_hash'), null, 'tanpa PIN, tidak ada hash yang dibuat');
});

/* ============================================================
   §3 Sanitizer — pesan server/Postgres mentah tidak pernah
   tampil ke pengguna (pola sandbox dari wave4 §4.2)
   ============================================================ */

function loadUiModules(lang) {
  const localStorage = createStorage(lang ? { lang } : {});
  const swalCalls = [];
  const consoleErrors = [];
  const sandbox = {
    window: null,
    console: { ...console, error: (...a) => consoleErrors.push(a) },
    localStorage,
    document: { documentElement: { classList: { contains: () => false } } },
    Swal: { fire: (opts) => { swalCalls.push(opts); return Promise.resolve({}); } },
    t: (k) => k
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/error-messages.js', 'utf8'), sandbox, { filename: 'error-messages.js' });
  vm.runInContext(fs.readFileSync('web/ui-state.js', 'utf8'), sandbox, { filename: 'ui-state.js' });
  return { sandbox, swalCalls, consoleErrors };
}

test('§3 sanitizer: dua pesan mentah live P0 (42702 + ReferenceError) digeneralisasi, id dan en', () => {
  const { sandbox } = loadUiModules('id');
  const f = sandbox.toUserErrorMessage;
  assert.equal(
    f(new Error('column reference "id" is ambiguous'), 'id'),
    'Terjadi kesalahan. Coba lagi.',
    'pesan Postgres 42702 tidak boleh tampil mentah'
  );
  assert.equal(
    f(new Error('column reference "id" is ambiguous'), 'en'),
    'Something went wrong. Please try again.'
  );
  assert.equal(
    f(new Error('hasPin is not defined'), 'id'),
    'Terjadi kesalahan. Coba lagi.',
    'ReferenceError tidak boleh tampil mentah'
  );
  assert.equal(
    f(new Error('hasPin is not defined'), 'en'),
    'Something went wrong. Please try again.'
  );
  // Varian lain dari keluarga yang sama.
  assert.equal(f(new Error('column "foo" is ambiguous'), 'id'), 'Terjadi kesalahan. Coba lagi.');
  assert.equal(f(new Error('syntax error at or near "where"'), 'id'), 'Terjadi kesalahan. Coba lagi.');
  assert.equal(f(new Error('PGRST204: Could not find the table'), 'id'), 'Terjadi kesalahan. Coba lagi.');
});

test('§3 sanitizer: showActionError menampilkan pesan ramah, mentah hanya di console', () => {
  const { sandbox, swalCalls, consoleErrors } = loadUiModules('id');
  sandbox.showActionError(new Error('column reference "id" is ambiguous'));
  assert.equal(swalCalls.length, 1, 'showActionError harus menampilkan satu Swal');
  assert.equal(swalCalls[0].text, 'Terjadi kesalahan. Coba lagi.');
  assert.doesNotMatch(swalCalls[0].text, /column reference|ambiguous/);
  assert.ok(
    consoleErrors.length >= 1 && String(consoleErrors[0]).includes('column reference "id" is ambiguous'),
    'pesan mentah tetap tercatat di console untuk diagnosis'
  );
});

test('§3 sanitizer: pesan ramah aplikasi sendiri tetap lolos apa adanya (bukan over-generalisasi)', () => {
  const { sandbox } = loadUiModules('id');
  const f = sandbox.toUserErrorMessage;
  assert.equal(
    f(new Error('Saldo dompet asal tidak mencukupi untuk transfer ini.'), 'id'),
    'Saldo dompet asal tidak mencukupi untuk transfer ini.'
  );
  assert.equal(
    f(new Error('Dompet asal tidak ditemukan atau bukan milik Anda.'), 'id'),
    'Dompet asal tidak ditemukan atau bukan milik Anda.'
  );
});
