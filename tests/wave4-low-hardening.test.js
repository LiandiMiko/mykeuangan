const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Gelombang 4 — Hardening rendah (R1–R22).
// Gaya tes mengikuti repo: asersi statis atas SQL/workflow/dokumen untuk
// hal yang tidak bisa dieksekusi tanpa Postgres/Deno, plus eksekusi nyata
// lewat vm untuk logika JS (lihat bagian bawah file). Semua fixture ada
// di dalam repo dan ter-commit (pelajaran Gelombang 3: tidak ada file
// di luar repo, tidak ada ketergantungan pada web/vendor/ di mesin dev).

const MIG4 = 'supabase/migrations/20261128080000_wave4_low_hardening.sql';
const mig4 = fs.readFileSync(MIG4, 'utf8');
const MIG9 = 'supabase/migrations/20261128090000_wave4_cycle_for_date_revoke_fix.sql';
const mig9 = fs.readFileSync(MIG9, 'utf8');
const schemaSql = fs.readFileSync('db/schema.sql', 'utf8');
const gitignore = fs.readFileSync('.gitignore', 'utf8');
const deployYml = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const androidYml = fs.readFileSync('.github/workflows/android-build.yml', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const playstoreGuide = fs.readFileSync('docs/ANDROID_PLAYSTORE_GUIDE.md', 'utf8');
const scheduleSql = fs.readFileSync('supabase/schedule.sql', 'utf8');
const webauthnDraft = fs.readFileSync('supabase/migrations/20261128070000_wave3_webauthn.sql', 'utf8');

/* ============================================================
   4.1 Database & skrip — migrasi Wave 4
   ============================================================ */

test('4.1 migrasi Wave 4: satu transaksi, idempotent, tidak menyentuh WebAuthn', () => {
  assert.match(mig4, /^\s*begin;/m, 'migrasi harus dibuka begin;');
  assert.match(mig4, /commit;\s*$/m, 'migrasi harus ditutup commit;');
  assert.doesNotMatch(mig4, /webauthn_credentials|webauthn_challenges|create or replace function public\.webauthn/i, 'migrasi Wave 4 tidak boleh mengubah objek WebAuthn (header boleh menyebut nomornya sebagai penanda urutan)');
  // Semua ADD CONSTRAINT dijaga keberadaannya (idempotent).
  for (const name of [
    'recurring_nominal_nonnegative', 'budgets_jumlah_nonnegative',
    'wallets_opening_balance_nonnegative', 'asset_value_history_nonnegative',
    'financial_goal_history_nonnegative', 'settings_payrollday_valid'
  ]) {
    assert.match(mig4, new RegExp(`conname = '${name}'`), `penjaga idempotency untuk ${name} hilang`);
  }
});

test('4.1 migrasi Wave 4: CHECK nominal negatif + payrollDay (NOT VALID)', () => {
  assert.match(mig4, /recurring_nominal_nonnegative check \(nominal >= 0\) not valid/);
  assert.match(mig4, /budgets_jumlah_nonnegative check \(jumlah >= 0\) not valid/);
  assert.match(mig4, /wallets_opening_balance_nonnegative check \(opening_balance >= 0\) not valid/);
  assert.match(mig4, /asset_value_history_nonnegative check \(/);
  assert.match(mig4, /financial_goal_history_nonnegative check \(/);
  // payrollDay: hanya bila key = 'payrollDay'; '' (default) diizinkan; 1..31.
  assert.match(mig4, /settings_payrollday_valid check \(\s*key <> 'payrollDay' or value = '' or value ~ '\^\(\[1-9\]\|\[12\]\[0-9\]\|3\[01\]\)\$'/);
  // Baris lama dilaporkan, bukan digagalkan (NOT VALID + RAISE NOTICE).
  assert.match(mig4, /raise notice 'Wave 4 §2/);
  // Yang sudah punya CHECK di Gelombang 3 tidak disentuh lagi.
  assert.doesNotMatch(mig4, /transactions_nominal_capped|transfers_nominal_capped|assets_nonnegative/);
});

test('4.1 migrasi Wave 4: cycle_for_date dicabut dari PUBLIC + search_path dipin', () => {
  // §1 di 080000 CACAT dan tidak pernah berjalan di produksi:
  // penjaganya memakai to_regproc('...cycle_for_date(date, int)')
  // yang SELALU NULL (to_regproc tidak menerima daftar argumen),
  // sehingga blok DO selalu mengambil cabang ELSE. Perbaikan yang
  // benar ada di migrasi 090000 (di bawah) — test ini menegaskan
  // isi 090000, bukan 080000.
  assert.match(mig9, /revoke all on function public\.cycle_for_date\(date, int\) from public, anon;/);
  assert.match(mig9, /grant execute on function public\.cycle_for_date\(date, int\) to authenticated;/);
  assert.match(mig9, /alter function public\.cycle_for_date\(date, int\) set search_path = public;/);
  // Penjaga harus to_regprocedure (menerima daftar argumen).
  assert.match(mig9, /to_regprocedure\('public\.cycle_for_date\(date, int\)'\) is not null/);
  // Bertahan bila fungsi belum ada (database dari migrasi saja).
  assert.match(mig9, /cycle_for_date\(\) belum ada di database ini/);
});

test('4.1 guard repo: to_regproc tidak boleh dipakai dengan daftar argumen', () => {
  // to_regproc('nama(tipe, ...)') SELALU mengembalikan NULL —
  // itu yang membuat §1 migrasi 080000 diam-diam tidak berjalan.
  // Yang benar untuk signature lengkap: to_regprocedure(...).
  // to_regproc polos ('public.is_admin()') tetap sah dan dipakai
  // penjaga schema.sql — guard ini hanya menolak yang berargumen.
  const sqlFiles = ['db/schema.sql'];
  const fs2 = require('node:fs');
  const path = require('node:path');
  const walk = (dir) => {
    for (const e of fs2.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.sql')) sqlFiles.push(p);
    }
  };
  walk('supabase/migrations');
  // Pengecualian yang didokumentasikan: 080000 masih mengandung
  // to_regproc berargumen yang cacat — itu cacat yang diperbaiki
  // 090000, dan migrasi lama tidak diedit. File lain tidak boleh
  // mengulanginya.
  const knownBad = new Set(['supabase/migrations/20261128080000_wave4_low_hardening.sql']);
  for (const f of sqlFiles) {
    if (knownBad.has(f.replace(/\\/g, '/'))) continue;
    const sql = fs2.readFileSync(f, 'utf8');
    // Komentar menjelaskan cacatnya (mis. di header 090000) — yang
    // dilarang hanya pemakaian sebagai KODE, jadi komentar dihapus
    // dulu sebelum pemindaian.
    const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/to_regproc\('([^']*)'\)/g)) {
      assert.ok(!m[1].includes(','), `${f}: to_regproc dipakai dengan daftar argumen (${m[1]}) — selalu NULL; pakai to_regprocedure`);
    }
  }
});

test('4.1 migrasi WebAuthn 070000 tetap DRAF dan tidak diubah Gelombang 4', () => {
  assert.match(webauthnDraft, /DRAFT — BELUM DIVERIFIKASI, JANGAN DEPLOY DULU/);
  assert.match(webauthnDraft, /BELUM pernah dijalankan/);
});

/* ============================================================
   4.1 Database & skrip — db/schema.sql tidak menimpa hardening
   ============================================================ */

test('4.1 schema.sql: penjaga tolak jalankan ulang di database bermigrasi', () => {
  assert.match(schemaSql, /JANGAN dijalankan ulang di database yang sudah dimigrasi/);
  assert.match(schemaSql, /to_regproc\('public\.is_admin\(\)'\) is not null/);
  assert.match(schemaSql, /to_regclass\('public\.admin_audit_logs'\) is not null/);
  assert.match(schemaSql, /raise exception 'schema\.sql adalah bootstrap v1/);
});

test('4.1 schema.sql: idempotent — IF NOT EXISTS + DROP POLICY IF EXISTS', () => {
  const creates = [...schemaSql.matchAll(/^create table if not exists public\./gm)];
  assert.ok(creates.length >= 9, `harapkan >= 9 CREATE TABLE, dapat ${creates.length}`);
  assert.doesNotMatch(schemaSql, /^create table public\./m, 'masih ada CREATE TABLE tanpa IF NOT EXISTS');
  assert.doesNotMatch(schemaSql, /^create index \S+ +on/m, 'masih ada CREATE INDEX tanpa IF NOT EXISTS');
  assert.match(schemaSql, /drop policy if exists "own rows" on public\.%I/);
});

test('4.1 schema.sql: cycle_for_date dipin search_path + revoke PUBLIC', () => {
  assert.match(schemaSql, /create or replace function public\.cycle_for_date\(d date, payroll_day int\)\s*returns text\s*language sql\s*stable\s*set search_path = public/);
  assert.match(schemaSql, /revoke all on function public\.cycle_for_date\(date, int\) from public, anon;/);
  assert.match(schemaSql, /grant execute on function public\.cycle_for_date\(date, int\) to authenticated;/);
});

/* ============================================================
   4.1 Konfigurasi & CI — Secrets, .gitignore, CRON_SECRET
   ============================================================ */

test('4.1 CI: SUPABASE_URL & SUPABASE_ANON_KEY pindah dari Variables ke Secrets', () => {
  for (const [name, yml] of [['deploy.yml', deployYml], ['android-build.yml', androidYml]]) {
    assert.doesNotMatch(yml, /vars\.SUPABASE_(URL|ANON_KEY)/, `${name} masih memakai vars.*`);
    assert.match(yml, /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/, `${name} belum memakai secrets.SUPABASE_URL`);
    assert.match(yml, /SUPABASE_ANON_KEY: \$\{\{ secrets\.SUPABASE_ANON_KEY \}\}/, `${name} belum memakai secrets.SUPABASE_ANON_KEY`);
  }
  assert.match(androidYml, /GitHub Repository Secrets SUPABASE_URL dan SUPABASE_ANON_KEY di Settings -> Secrets and variables -> Actions -> Secrets/);
  assert.doesNotMatch(androidYml, /Repository Variables SUPABASE_URL/);
  assert.match(readme, /GitHub Repository Secrets/);
  assert.match(readme, /SUPABASE_URL.*SUPABASE_ANON_KEY.*Secrets and variables → Actions → Secrets/);
  assert.match(playstoreGuide, /GitHub Repository Secrets \(`SUPABASE_URL` & `SUPABASE_ANON_KEY` di \*Settings → Secrets and variables → Actions → Secrets\*\)/);
});

test('4.1 .gitignore: kunci privat, konfigurasi layanan & paket build', () => {
  for (const pat of ['*.pem', '*.key', '*.p12', '*.cer', 'google-services.json', 'GoogleService-Info.plist', '*.apk', '*.aab']) {
    assert.ok(gitignore.split('\n').some((l) => l.trim() === pat), `.gitignore kehilangan pola ${pat}`);
  }
  // Yang sudah ada sebelumnya tetap ada (regresi).
  for (const pat of ['dist/', 'node_modules/', '.env', 'web/vendor/', '*.jks', '*.keystore']) {
    assert.ok(gitignore.includes(pat), `.gitignore kehilangan pola lama ${pat}`);
  }
});

test('4.1 CRON_SECRET: tidak ada nilai secret di teks definisi job (sudah Vault sejak Gelombang 2)', () => {
  // Setiap pemakaian x-cron-secret harus berupa SELECT Vault, bukan literal.
  const uses = [...scheduleSql.matchAll(/'x-cron-secret',\s*(\(select decrypted_secret from vault\.decrypted_secrets where name = 'cron_secret'\))/g)];
  assert.equal(uses.length, 5, `harapkan 5 job memakai Vault select, dapat ${uses.length}`);
  assert.doesNotMatch(scheduleSql, /x-cron-secret',\s*'[a-zA-Z0-9]/, 'ada nilai literal di header x-cron-secret');
  assert.match(scheduleSql, /nilai CRON_SECRET TIDAK LAGI tertulis/);
});

/* ============================================================
   4.2 Pesan error aman — web/error-messages.js + showActionError
   ============================================================ */
const vm = require('node:vm');

function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

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
  return { sandbox, swalCalls, consoleErrors, localStorage };
}

test('4.2 toUserErrorMessage: pola Supabase/auth/jaringan dipetakan, bukan mentah', () => {
  const { sandbox } = loadUiModules('id');
  const f = sandbox.toUserErrorMessage;
  assert.equal(f(new Error('Invalid login credentials'), 'id'), 'Email atau kata sandi salah. Periksa kembali lalu coba lagi.');
  assert.equal(f(new Error('Invalid login credentials'), 'en'), 'Incorrect email or password. Check and try again.');
  assert.match(f(new Error('User already registered'), 'id'), /sudah terdaftar/);
  assert.match(f(new Error('Too many requests'), 'id'), /Terlalu banyak percobaan/);
  assert.match(f(new Error('Failed to fetch'), 'id'), /Tidak ada koneksi internet/);
  assert.match(f(new Error('JWT expired'), 'id'), /Sesi Anda berakhir/);
  assert.match(f(new Error('Password should be different from old password'), 'id'), /tidak memenuhi syarat/);
  assert.match(f({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }, 'id'), /sudah ada/);
  // Pesan mentah yang tidak dikenal -> umum (detail tetap di console).
  assert.equal(f(new Error('Database error saving new user'), 'id'), 'Terjadi kesalahan. Coba lagi.');
  assert.equal(f(new Error('relation "public.foo" does not exist'), 'id'), 'Terjadi kesalahan. Coba lagi.');
  assert.equal(f(new Error(''), 'id'), 'Terjadi kesalahan. Coba lagi.');
  assert.equal(f(null, 'id'), 'Terjadi kesalahan. Coba lagi.');
  // Pesan polos tanpa penanda teknis diteruskan (aturan 4: itu suara
  // aplikasi sendiri — tidak membocorkan detail implementasi).
  // Yang berpenanda teknis tetap digeneralisasi (lihat dua baris atas).
  assert.equal(f(new Error('something broke'), 'en'), 'something broke');
});

test('4.2 toUserErrorMessage: pesan untuk pengguna (userMessage / validasi klien) lolos apa adanya', () => {
  const { sandbox } = loadUiModules('id');
  const f = sandbox.toUserErrorMessage;
  const marked = sandbox.userError('Batas impor 500 baris.');
  assert.equal(f(marked, 'id'), 'Batas impor 500 baris.');
  // Pesan validasi klien berbahasa Indonesia (tanpa penanda teknis) lolos.
  assert.equal(f(new Error('Saldo dompet asal tidak mencukupi untuk transfer ini.'), 'id'), 'Saldo dompet asal tidak mencukupi untuk transfer ini.');
  assert.equal(f(new Error('Kata sandi minimal 12 karakter.'), 'id'), 'Kata sandi minimal 12 karakter.');
  // Deteksi bahasa dari localStorage bila argumen lang tidak diisi.
  const { sandbox: sbEn } = loadUiModules('en');
  assert.equal(sbEn.toUserErrorMessage(new Error('Invalid login credentials')), 'Incorrect email or password. Check and try again.');
});

test('4.2 showActionError: menampilkan pesan ramah, mentah hanya di console', () => {
  const { sandbox, swalCalls, consoleErrors } = loadUiModules('id');
  sandbox.showActionError(new Error('Invalid login credentials'));
  assert.equal(swalCalls.length, 1);
  assert.equal(swalCalls[0].text, 'Email atau kata sandi salah. Periksa kembali lalu coba lagi.');
  assert.doesNotMatch(swalCalls[0].text, /Invalid login credentials/);
  assert.equal(consoleErrors.length, 1, 'pesan mentah harus tetap tercatat di console.error');
  assert.match(String(consoleErrors[0][0] && consoleErrors[0][0].message), /Invalid login credentials/);
  sandbox.showActionError(new Error('relation "public.foo" does not exist'));
  assert.equal(swalCalls[1].text, 'Terjadi kesalahan. Coba lagi.');
});

test('4.2 situs auth & laporan tidak lagi menempelkan error.message mentah', () => {
  const authJs = fs.readFileSync('web/supabase-auth.js', 'utf8');
  assert.doesNotMatch(authJs, /Gagal masuk: ' \+ error\.message/);
  assert.doesNotMatch(authJs, /Pendaftaran gagal: ' \+ error\.message/);
  assert.doesNotMatch(authJs, /Gagal kirim reset: ' \+ error\.message/);
  assert.doesNotMatch(authJs, /Login Google gagal: ' \+ error\.message/);
  assert.doesNotMatch(authJs, /alasan gagal pertama: /);
  assert.doesNotMatch(authJs, /first error: /);
  assert.match(authJs, /toUserErrorMessage\(error, en \? 'en' : 'id'\)/);
  const authUiJs = fs.readFileSync('web/supabase-auth-ui.js', 'utf8');
  assert.match(authUiJs, /toUserErrorMessage\(error, en \? 'en' : 'id'\)/);
  const accountJs = fs.readFileSync('web/ui-feat-account.js', 'utf8');
  assert.match(accountJs, /toUserErrorMessage\(err, isEn\(\) \? 'en' : 'id'\)/);
  const reportsJs = fs.readFileSync('web/ui-reports.js', 'utf8');
  assert.match(reportsJs, /toUserErrorMessage\(error\)/);
  // Modul dimuat pertama di build agar tersedia untuk semua konsumen.
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');
  assert.match(buildMjs, /const WEB_MODULES = \[\s*\/\/ Gelombang 4[\s\S]{0,200}?'error-messages\.js',\s*'native-bridge\.js',/);
});

// ============================================================
// 4.3 — Pembatas percobaan biometrik, verifikasi saat mematikan
// biometrik, dan sukses biometrik tidak lagi me-reset lockout PIN.
// ============================================================
function loadNativeUx({ capacitor } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  const document = {
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    body: { contains: () => false }
  };
  const sandbox = {
    document, localStorage,
    navigator: {},
    Swal: { fire: async () => ({}) },
    getSwalClass: () => '',
    console, setTimeout, clearTimeout, Date, JSON, Math, Object, Array,
    Uint8Array, atob, btoa
  };
  sandbox.window = sandbox;
  sandbox.__mkFeat = {};
  if (capacitor) sandbox.Capacitor = capacitor;
  vm.createContext(sandbox);
  const code = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');
  vm.runInContext(code, sandbox);
  return { sandbox, localStorage, store };
}

test('4.3 biometricLock: 5 gagal beruntun mengunci 60 detik, lalu naik 5 -> 15 -> 60 menit', () => {
  const { sandbox, localStorage } = loadNativeUx();
  const bl = sandbox.__mkFeat.biometricLock;
  assert.ok(bl, 'root.__mkFeat.biometricLock harus terekspos');
  const T0 = 1000000;
  for (let i = 0; i < 4; i++) bl.recordBiometricFailure(localStorage, T0);
  assert.equal(bl.getBiometricCooldownSeconds(T0 + 1000), 0, '4 gagal belum mengunci');
  const locked = bl.recordBiometricFailure(localStorage, T0);
  assert.equal(locked.failures, 0, 'counter direset saat kunci');
  assert.equal(locked.lockoutCount, 1);
  assert.equal(locked.lockedUntil, T0 + 60000, 'kunci pertama 60 detik');
  assert.equal(bl.getBiometricCooldownSeconds(T0 + 30000), 30);
  assert.equal(bl.getBiometricCooldownSeconds(T0 + 60000), 0, 'cooldown habis tepat waktu');
  for (let i = 0; i < 5; i++) bl.recordBiometricFailure(localStorage, T0 + 60000);
  const locked2 = bl.readBiometricLockState(localStorage, T0 + 60000);
  assert.equal(locked2.lockoutCount, 2);
  assert.equal(locked2.lockedUntil, T0 + 60000 + 300000, 'kunci kedua 5 menit');
  bl.clearBiometricFailures(localStorage);
  const cleared = bl.readBiometricLockState(localStorage, T0);
  assert.equal(cleared.failures, 0);
  assert.equal(cleared.lockedUntil, 0);
  assert.equal(cleared.lockoutCount, 0);
});

test('4.3 biometricLock: JSON rusak tidak melempar, dibaca sebagai state kosong', () => {
  const { sandbox, localStorage } = loadNativeUx();
  localStorage.setItem('mk_biometric_lock_state_v1', 'bukan-json{');
  const bl = sandbox.__mkFeat.biometricLock;
  const st = bl.readBiometricLockState(localStorage, 0);
  assert.equal(st.failures, 0);
  assert.equal(st.lockedUntil, 0);
  assert.equal(st.lockoutCount, 0);
  assert.equal(bl.getBiometricCooldownSeconds(), 0);
});

test('4.3 tryBiometricUnlock: 5 gagal plugin mengunci, percobaan ke-6 tidak sampai ke authenticator; sukses menghapus counter', async () => {
  const calls = { verify: 0 };
  const failing = {
    isNativePlatform: () => true,
    Plugins: { NativeBiometric: { verifyIdentity: async () => { calls.verify++; throw new Error('auth failed'); } } }
  };
  const { sandbox, localStorage } = loadNativeUx({ capacitor: failing });
  localStorage.setItem('mk_biometric_pin_enabled', '1');
  const tryBio = sandbox.__mkFeat.tryBiometricUnlock;
  for (let i = 0; i < 5; i++) assert.equal(await tryBio(), false, `percobaan ${i + 1} gagal`);
  assert.equal(calls.verify, 5);
  assert.ok(sandbox.__mkFeat.biometricLock.getBiometricCooldownSeconds() > 0, 'cooldown aktif setelah 5 gagal');
  assert.equal(await tryBio(), false, 'percobaan ke-6 ditolak wrapper');
  assert.equal(calls.verify, 5, 'authenticator tidak dipanggil selama cooldown');

  const okCalls = { verify: 0 };
  const succeeding = {
    isNativePlatform: () => true,
    Plugins: { NativeBiometric: { verifyIdentity: async () => { okCalls.verify++; return {}; } } }
  };
  const ok = loadNativeUx({ capacitor: succeeding });
  ok.localStorage.setItem('mk_biometric_pin_enabled', '1');
  ok.localStorage.setItem('mk_biometric_lock_state_v1', JSON.stringify({ failures: 3, lockedUntil: 0, lockoutCount: 0 }));
  assert.equal(await ok.sandbox.__mkFeat.tryBiometricUnlock(), true);
  assert.equal(okCalls.verify, 1);
  const cleared = ok.sandbox.__mkFeat.biometricLock.readBiometricLockState(ok.localStorage, 0);
  assert.equal(cleared.failures, 0, 'sukses menghapus counter');
  assert.equal(cleared.lockedUntil, 0);
  assert.equal(cleared.lockoutCount, 0);
});

test('4.3 mematikan biometrik wajib verifikasi PIN; sukses biometrik tidak mereset lockout PIN', () => {
  const ux = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');
  const acc = fs.readFileSync('web/ui-feat-account.js', 'utf8');
  // toggleBiometricUnlock memanggil promptVerifyCurrentPin SEBELUM
  // menghapus kunci; tanpa verifier, fail closed (tidak dimatikan).
  const fn = ux.slice(ux.indexOf('async function toggleBiometricUnlock'));
  const vIdx = fn.indexOf('promptVerifyCurrentPin');
  const rIdx = fn.indexOf('removeItem(BIOMETRIC_ENABLED_KEY)');
  assert.ok(vIdx > 0 && vIdx < rIdx, 'verifikasi PIN harus mendahului penghapusan kunci');
  assert.match(fn, /typeof verifier !== 'function'/, 'fail closed bila verifier tidak tersedia');
  assert.match(acc, /root\.__mkFeat\.promptVerifyCurrentPin = promptVerifyCurrentPin;/, 'verifier diekspor untuk native-ux');
  // Kedua jalur sukses biometrik memakai markBiometricUnlocked, bukan
  // markPinUnlocked (yang mereset lockout PIN).
  assert.equal((acc.match(/await markBiometricUnlocked\(\);/g) || []).length, 2, 'dua jalur sukses biometrik');
  assert.ok(!acc.includes('if (bioOk && hasPinDataKey()) {\n          await markPinUnlocked();'), 'jalur bioOk tidak lagi mereset PIN lockout');
  const body = acc.slice(acc.indexOf('async function markBiometricUnlocked'), acc.indexOf('async function markBiometricUnlocked') + 400);
  assert.doesNotMatch(body, /writePinLockState/, 'markBiometricUnlocked tidak menyentuh state lockout PIN');
  // Tombol coba-lagi menghormati cooldown.
  assert.match(ux, /bindPinModalBiometricRetry[\s\S]{0,1200}getBiometricCooldownSeconds/, 'tombol coba-lagi mengecek cooldown');
  assert.match(ux, /setBiometricButtonLocked/, 'label tombol berubah saat terkunci');
});

// ============================================================
// 4.4 — Modal recovery menutup sesi; logout menghapus kunci
// update yang ditunda (+ throttle biometrik); hapus akun wajib
// kata sandi.
// ============================================================
function loadAuthUi() {
  const sandbox = {
    document: {},
    localStorage: { getItem: () => null },
    console, setTimeout, clearTimeout, Date, JSON, Math, Object, Array
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/supabase-auth-ui.js', 'utf8'), sandbox);
  return sandbox.__mkAuthUi;
}

test('4.4 endRecoverySession: menutup modal recovery mengakhiri sesi, menutup modal, dan memberi tahu', async () => {
  const ui = loadAuthUi();
  assert.equal(typeof ui.endRecoverySession, 'function', 'endRecoverySession harus diekspor di window.__mkAuthUi');
  const calls = { signOut: 0, removed: false, notices: [] };
  const sb = { auth: { signOut: async () => { calls.signOut++; } } };
  const wrap = { remove: () => { calls.removed = true; } };
  const notice = async (t, m) => { calls.notices.push([t, m]); };
  await ui.endRecoverySession(sb, wrap, notice, false);
  assert.equal(calls.signOut, 1, 'sesi recovery diakhiri lewat signOut');
  assert.equal(calls.removed, true, 'modal ditutup');
  assert.equal(calls.notices.length, 1);
  assert.match(calls.notices[0][0], /Sesi Pemulihan Diakhiri/);
  assert.match(calls.notices[0][1], /tautan reset baru/);
  await ui.endRecoverySession(sb, { remove: () => {} }, notice, true);
  assert.match(calls.notices[1][0], /Recovery Session Ended/);
});

test('4.4 endRecoverySession: signOut gagal (mis. offline) tetap menutup modal dan memberi tahu', async () => {
  const ui = loadAuthUi();
  const sb = { auth: { signOut: async () => { throw new Error('offline'); } } };
  let removed = false;
  let noticed = false;
  await ui.endRecoverySession(sb, { remove: () => { removed = true; } }, async () => { noticed = true; }, false);
  assert.equal(removed, true, 'modal tetap ditutup meski signOut gagal');
  assert.equal(noticed, true, 'pengguna tetap diberi tahu');
});

test('4.4 tombol batal recovery berlabel "Akhiri Sesi & Tutup" dan memanggil endRecoverySession; logout menghapus kunci update yang ditunda', () => {
  const authUi = fs.readFileSync('web/supabase-auth-ui.js', 'utf8');
  assert.match(authUi, /Akhiri Sesi & Tutup/);
  assert.match(authUi, /End Session & Close/);
  assert.match(authUi, /mkRecCancelBtn'\)\.onclick = \(\) => endRecoverySession\(sb, wrap, showAuthNotice, en\)/);
  assert.doesNotMatch(authUi, /mkRecCancelBtn'\)\.onclick = \(\) => wrap\.remove\(\)/, 'tombol batal tidak boleh lagi hanya menghapus modal');
  const auth = fs.readFileSync('web/supabase-auth.js', 'utf8');
  const keys = auth.slice(auth.indexOf('const LOGOUT_STORAGE_KEYS'), auth.indexOf('];', auth.indexOf('const LOGOUT_STORAGE_KEYS')));
  assert.match(keys, /'mk_dismissed_update_version'/, 'logout menghapus penanda update yang ditunda');
  assert.match(keys, /'mk_biometric_lock_state_v1'/, 'logout menghapus throttle biometrik (masuk kembali wajib kata sandi akun)');
  const updates = fs.readFileSync('web/ui-feat-updates.js', 'utf8');
  assert.match(updates, /mk_dismissed_update_version/, 'kunci itu memang dipakai fitur update');
});

test('4.4 delete-account.html: kata sandi selalu dikirim untuk verifikasi ulang; bidang email saja yang disembunyikan saat sesi aktif', () => {
  const page = fs.readFileSync('web/delete-account.html', 'utf8');
  assert.match(page, /invoke\('delete-account', \{ body: \{ confirmation: 'HAPUS', password: password \} \}\)/);
  assert.match(page, /id="delPass"[^>]*required/, 'bidang kata sandi wajib diisi');
  assert.match(page, /id="emailFields"/, 'bidang email punya wadah sendiri');
  assert.match(page, /id="passFields"/, 'bidang kata sandi punya wadah sendiri');
  assert.doesNotMatch(page, /credFields/, 'wadah gabungan credFields tidak ada lagi');
  assert.match(page, /emailFields\.classList\.add\('hide'\)/, 'sesi aktif hanya menyembunyikan email');
  const pwIdx = page.indexOf("var password = document.getElementById('delPass')");
  const invIdx = page.indexOf("invoke('delete-account'");
  assert.ok(pwIdx > 0 && pwIdx < invIdx, 'kata sandi dibaca sebelum pemanggilan fungsi');
  assert.match(page, /belum bisa menghapus akun dari halaman ini/, 'catatan akun Google-only jujur soal batasan kata sandi');
});

// ============================================================
// 4.5 — Bot endpoint tidak membalas 'ok' untuk GET.
// Perilaku hidup diuji di tests/wave3-edge-functions.test.js
// (harness loadEdgeFunction); di sini asersi sumbernya.
// ============================================================
test('4.5 telegram-bot: endpoint tidak membalas ok untuk GET', () => {
  const bot = fs.readFileSync('supabase/functions/telegram-bot/index.ts', 'utf8');
  assert.match(bot, /if \(req\.method !== 'POST'\) return new Response\('Method Not Allowed', \{ status: 405 \}\);/);
  assert.doesNotMatch(bot, /if \(req\.method !== 'POST'\) return new Response\('ok'\)/, 'cabang non-POST tidak lagi menjawab ok');
  // Catatan: 'ok' masih benar untuk POST (Telegram mengharapkan 200 ok
  // setelah update diproses) — yang dihapus hanya jawaban ok untuk
  // metode non-POST.
  const setup = fs.readFileSync('supabase/functions/telegram-setup/index.ts', 'utf8');
  assert.match(setup, /if \(req\.method !== 'POST'\) return jsonResponse\(req, 405/, 'telegram-setup sudah 405 — tidak berubah');
});

// ============================================================
// 4.6 — Frontend: batas cache SW + kunci HTML berisi query,
// validasi skema URL eksternal, formula injection, peringatan
// backup JSON, selektor mati.
// ============================================================
function loadServiceWorker({ quotaUsage = 0, quotaTotal = 0 } = {}) {
  const listeners = {};
  const store = new Map();
  const cache = {
    async match(req) { const k = typeof req === 'string' ? req : req.url; return store.get(k); },
    async put(req, res) { const k = typeof req === 'string' ? req : req.url; store.set(k, res); },
    async delete(req) { const k = typeof req === 'string' ? req : req.url; return store.delete(k); },
    async keys() { return [...store.keys()].map((k) => ({ url: k })); },
    async addAll(urls) { for (const u of urls) store.set(u, new Response('precached')); }
  };
  const selfStub = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    registration: undefined,
    clients: { claim: async () => {} }
  };
  const quota = { usage: quotaUsage, quota: quotaTotal };
  const sandbox = {
    self: selfStub,
    caches: {
      open: async () => cache,
      keys: async () => ['mykeuangan-__BUILD_ID__'],
      match: async (req) => cache.match(req)
    },
    fetch: async () => new Response('network-body', { status: 200 }),
    Response, Request, URL,
    navigator: { storage: { estimate: async () => ({ usage: quota.usage, quota: quota.quota }) } },
    console, setTimeout, clearTimeout, Date, JSON, Math, Object, Array, Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/sw.js', 'utf8').replace(/__BUILD_ID__/g, 'test'), sandbox);
  return { listeners, store, cache, quota, sandbox };
}

function swFetchEvent(url, { mode = '', accept = '' } = {}) {
  const ev = {
    request: { method: 'GET', url, mode, headers: { get: (name) => (name.toLowerCase() === 'accept' ? accept : null) } },
    _waits: [],
    respondWith(p) { this._promise = p; },
    waitUntil(p) { this._waits.push(p); }
  };
  return ev;
}

async function runSwFetch(sw, ev) {
  sw.listeners.fetch(ev);
  await ev._promise;
  await Promise.all(ev._waits);
}

test('4.6 SW: kunci cache HTML membedakan query string; fallback offline tetap memakai precache', async () => {
  const sw = loadServiceWorker();
  // Install: precache './' dan './index.html'.
  const installEv = { waitUntil(p) { this._p = p; } };
  sw.listeners.install(installEv);
  await installEv._p;
  assert.ok(sw.store.has('./'), 'precache ./');
  assert.ok(sw.store.has('./index.html'), 'precache ./index.html');

  await runSwFetch(sw, swFetchEvent('https://app.example/index.html?v=2', { mode: 'navigate', accept: 'text/html' }));
  await runSwFetch(sw, swFetchEvent('https://app.example/index.html?v=3', { mode: 'navigate', accept: 'text/html' }));
  assert.ok(sw.store.has('./index.html?v=2'), 'v=2 punya kunci sendiri');
  assert.ok(sw.store.has('./index.html?v=3'), 'v=3 punya kunci sendiri');

  // Jaringan mati untuk v=9: fallback ke precache './'.
  const swOffline = loadServiceWorker();
  swOffline.sandbox.fetch = async () => { throw new Error('offline'); };
  const installEv2 = { waitUntil(p) { this._p = p; } };
  swOffline.listeners.install(installEv2);
  await installEv2._p;
  const ev = swFetchEvent('https://app.example/index.html?v=9', { mode: 'navigate', accept: 'text/html' });
  await runSwFetch(swOffline, ev);
  const body = await ev._promise.then((r) => r.text());
  assert.equal(body, 'precached', 'fallback offline memakai precache ./');
});

test('4.6 SW: cache runtime dibatasi 200 entri (tertua dihapus) dan tidak diisi saat kuota > 80%', async () => {
  const sw = loadServiceWorker();
  for (let i = 0; i < 205; i++) {
    await runSwFetch(sw, swFetchEvent(`https://app.example/assets/a${i}.js`, { accept: 'application/javascript' }));
  }
  assert.equal(sw.store.size, 200, 'cache dipangkas ke 200 entri');
  assert.ok(!sw.store.has('https://app.example/assets/a0.js'), 'entri tertua dihapus');
  assert.ok(sw.store.has('https://app.example/assets/a204.js'), 'entri terbaru dipertahankan');

  const swFull = loadServiceWorker({ quotaUsage: 95, quotaTotal: 100 });
  await runSwFetch(swFull, swFetchEvent('https://app.example/assets/b0.js', { accept: 'application/javascript' }));
  assert.equal(swFull.store.size, 0, 'kuota > 80% -> tidak ada entri baru');
});

function loadNativeBridge() {
  const opened = [];
  const sandbox = {
    document: {
      addEventListener: () => {},
      documentElement: { classList: { contains: () => false } },
      getElementById: () => null
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    open: (url, target, features) => { opened.push([url, target, features]); },
    console, setTimeout, clearTimeout, Date, JSON, Math, Object, Array, Promise, URL
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/native-bridge.js', 'utf8'), sandbox);
  return { sandbox, opened };
}

test('4.6 isSafeExternalUrl: hanya http/https (dan relatif) yang lolos; openExternalUrl menolak sisanya', async () => {
  const { sandbox, opened } = loadNativeBridge();
  const isSafe = sandbox.isSafeExternalUrl;
  assert.equal(typeof isSafe, 'function', 'isSafeExternalUrl harus diekspor');
  assert.equal(isSafe('https://example.com/x'), true);
  assert.equal(isSafe('http://example.com'), true);
  assert.equal(isSafe('  https://example.com  '), true);
  assert.equal(isSafe('/relatif/jalan'), true);
  assert.equal(isSafe('//cdn.example.com/a.js'), true);
  assert.equal(isSafe('javascript:alert(1)'), false);
  assert.equal(isSafe('JaVaScRiPt:alert(1)'), false);
  assert.equal(isSafe('java\tscript:alert(1)'), false);
  assert.equal(isSafe('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafe('file:///etc/passwd'), false);
  assert.equal(isSafe(''), false);
  assert.equal(isSafe(null), false);

  await sandbox.openExternalUrl('javascript:alert(1)');
  await sandbox.openExternalUrl('data:text/html,x');
  assert.equal(opened.length, 0, 'URL tidak aman tidak dibuka');
  await sandbox.openExternalUrl('https://ok.example/a');
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0], ['https://ok.example/a', '_blank', 'noopener,noreferrer']);
});

function loadExporters() {
  const sandbox = {
    sessionUser: 'tester',
    Swal: { fire: async () => ({}) },
    getSwalClass: () => '',
    walletName: (id) => 'Dompet ' + id,
    getFilteredReportTransactions: () => ({ txs: [], period: '2026-11' }),
    escapeHtmlJS: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    localStorage: { getItem: () => null },
    console, setTimeout, clearTimeout, Date, JSON, Math, Object, Array, Promise
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/ui-export.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync('web/ui-feat-backup.js', 'utf8'), sandbox);
  return sandbox;
}

test('4.6 formula injection: spasi di depan pemicu dan | % disanitasi di CSV dan Excel', () => {
  const sb = loadExporters();
  const csv = sb.csvEscapeCell;
  const xls = sb.safeExcelCell;
  assert.equal(typeof csv, 'function');
  assert.equal(typeof xls, 'function', 'safeExcelCell kini diekspor (dulu bersarang di exportExcel)');
  for (const [input, expected] of [
    [' =2+2', "' =2+2"],
    ['\t@cmd', "'\t@cmd"],
    ['  -5+5', "'  -5+5"],
    ['|calc', "'|calc"],
    ['%x', "'%x"],
    ['=2+2', "'=2+2"],
    ['+5000', "'+5000"],
    ['kopi 25rb', 'kopi 25rb'],
    ['a =2+2', 'a =2+2'],
    ['total 100', 'total 100']
  ]) {
    assert.equal(csv(input), expected, `CSV: ${JSON.stringify(input)}`);
    assert.equal(xls(input), expected, `Excel: ${JSON.stringify(input)}`);
  }
});

test('4.6 backup JSON: peringatan tidak terenkripsi tampil di dialog dan tombolnya bernama jelas; selektor mati diganti data-action', () => {
  const backup = fs.readFileSync('web/ui-feat-backup.js', 'utf8');
  assert.match(backup, /JSON biasa TIDAK terenkripsi/);
  assert.match(backup, /siapa pun yang mendapatkan berkas ini dapat membaca seluruh data keuangan Anda/);
  assert.match(backup, /confirmButtonText: 'JSON Biasa \(Tidak Terenkripsi\)'/);
  const ux = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');
  assert.doesNotMatch(ux, /\[onclick\*=/, 'tidak ada lagi selektor [onclick*=...]');
  assert.match(ux, /\[data-action="addQuickNominalAmount"\]/, 'haptic memakai selektor data-action yang hidup');
  const html = fs.readFileSync('src/form.html', 'utf8');
  assert.match(html, /data-action="addQuickNominalAmount"/, 'tombol memang memakai data-action');
});
