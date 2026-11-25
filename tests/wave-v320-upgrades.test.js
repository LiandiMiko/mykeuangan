const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const FinanceAnalysis = require('../web/finance-analysis.js');

test('wave v3.20 preserves native Android classes across setTheme() and fixes native notification modal toggle', () => {
  const uiShellJs = fs.readFileSync('web/ui-shell.js', 'utf8');
  const classSet = new Set(['mk-native-app', 'mk-platform-android', 'theme-pink']);
  const classListMock = {
    add: (...cls) => cls.forEach((c) => classSet.add(c)),
    remove: (...cls) => cls.forEach((c) => classSet.delete(c)),
    toggle: (cls, force) => (force ? classSet.add(cls) : classSet.delete(cls)),
    contains: (cls) => classSet.has(cls)
  };
  const sandbox = {
    document: {
      documentElement: { classList: classListMock },
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {}
    },
    localStorage: { getItem: () => 'dark', setItem: () => {} },
    isDataReady: false,
    updateDashboardTitle: () => {},
    console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(uiShellJs, sandbox);

  sandbox.setTheme('theme-emerald');
  assert.equal(classSet.has('mk-native-app'), true);
  assert.equal(classSet.has('mk-platform-android'), true);
  assert.equal(classSet.has('dark'), true);
  assert.equal(classSet.has('theme-emerald'), true);
  assert.equal(classSet.has('theme-pink'), false);

  const proHooksJs = fs.readFileSync('web/ui-pro-hooks.js', 'utf8');
  assert.match(proHooksJs, /toggleNativeNotifications/);
  assert.match(proHooksJs, /scheduleNativeDailyReminder/);
});

test('wave v3.20 evaluates nominal arithmetic expressions safely and preserves IDR formatting', () => {
  const uiStateJs = fs.readFileSync('web/ui-state.js', 'utf8');
  const sandbox = {
    renderAll: () => {},
    updateDashboardTitle: () => {},
    localStorage: { getItem: () => '0', setItem: () => {} },
    document: { documentElement: { classList: { contains: () => false } } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(uiStateJs, sandbox);

  assert.equal(sandbox.evaluateNominalExpression('25000+15000'), 40000);
  assert.equal(sandbox.evaluateNominalExpression('180.000/3'), 60000);
  assert.equal(sandbox.evaluateNominalExpression('50000*2-10000'), 90000);
  assert.equal(sandbox.evaluateNominalExpression('25.000×4÷2'), 50000);
  assert.ok(Number.isNaN(sandbox.evaluateNominalExpression('100/0')));
  assert.ok(Number.isNaN(sandbox.evaluateNominalExpression('10-50')));
  assert.ok(Number.isNaN(sandbox.evaluateNominalExpression('alert(1)')));
  assert.equal(sandbox.parseFormattedNominal('25000+15000'), 40000);
  assert.equal(sandbox.parseFormattedNominal('1.500.000'), 1500000);
  assert.equal(sandbox.parseFormattedNominal('Rp 1.250.000'), 1250000);
});

test('wave v3.20 computes accurate cashflow runway projections across safe, caution, and deficit states', () => {
  const baseDb = {
    wallets: [{ id: 'w1', name: 'BCA', openingBalance: 2000000 }],
    transactions: [{ id: 't1', tanggal: '2026-11-10', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 200000, walletId: 'w1' }],
    transfers: [],
    recurring: [
      { id: 'r1', tipe: 'Pengeluaran', kategori: 'Internet', nominal: 300000, dayOfMonth: 25, active: true, lastRun: '' },
      { id: 'r2', tipe: 'Pemasukan', kategori: 'Freelance', nominal: 500000, dayOfMonth: 27, active: true, lastRun: '' }
    ]
  };
  const safeRw = FinanceAnalysis.computeCashflowRunway(baseDb, '2026-11', 1, '2026-11-21');
  assert.equal(safeRw.liquidCash, 1800000);
  assert.equal(safeRw.daysLeftInCycle, 10);
  assert.equal(safeRw.upcomingCount, 2);
  assert.equal(safeRw.projectedEndCash, 2000000);
  assert.equal(safeRw.safeDailyBudget, 200000);
  assert.equal(safeRw.status, 'safe');

  const deficitDb = {
    ...baseDb,
    wallets: [{ id: 'w1', name: 'BCA', openingBalance: 100000 }],
    transactions: [],
    recurring: [{ id: 'r1', tipe: 'Pengeluaran', kategori: 'Sewa', nominal: 500000, dayOfMonth: 28, active: true }]
  };
  const deficitRw = FinanceAnalysis.computeCashflowRunway(deficitDb, '2026-11', 1, '2026-11-21');
  assert.equal(deficitRw.status, 'deficit');
  assert.equal(deficitRw.safeDailyBudget, 0);
});

test('wave v3.20 encrypts and decrypts backup snapshots with AES-GCM PBKDF2', async () => {
  const backupJs = fs.readFileSync('web/ui-feat-backup.js', 'utf8');
  const sandbox = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    DB: {},
    Swal: {}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(backupJs, sandbox);

  const sample = { version: '3.14', user: 'Miko', transactions: [{ id: 't1', nominal: 125000 }] };
  const envelope = await sandbox.encryptBackupPayload(sample, 'rahasia-kuat');
  assert.equal(envelope.format, 'mykeuguech-encrypted-backup-v1');
  assert.ok(envelope.ciphertext && envelope.iv && envelope.salt);

  const decrypted = await sandbox.decryptBackupPayload(envelope, 'rahasia-kuat');
  assert.deepEqual(JSON.parse(JSON.stringify(decrypted)), sample);
  await assert.rejects(() => sandbox.decryptBackupPayload(envelope, 'sandi-salah'));
});

test('wave v3.20 wires native plugins, expanded offline mutations, onboarding, admin v2, and migration', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const nativeBridge = fs.readFileSync('web/native-bridge.js', 'utf8');
  const offlineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
  const onboardingJs = fs.readFileSync('web/ui-feat-onboarding.js', 'utf8');
  const nativeUxJs = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');
  const adminFn = fs.readFileSync('supabase/functions/admin-user-ops/index.ts', 'utf8');
  const adminMigration = fs.readFileSync('supabase/migrations/20261125120000_admin_audit_and_telegram_unlink.sql', 'utf8');
  const adminJs = fs.readFileSync('web/ui-admin.js', 'utf8');
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');

  assert.equal(pkg.version, '3.20.0');
  assert.ok(pkg.dependencies['@capacitor/camera'] && pkg.dependencies['@capacitor/haptics'] && pkg.dependencies['@capacitor/local-notifications']);
  assert.ok(pkg.scripts['cap:keystore'] && fs.existsSync('scripts/setup-android-keystore.mjs'));

  assert.match(nativeBridge, /triggerHaptic/);
  assert.match(nativeBridge, /captureReceiptNative/);
  assert.match(nativeBridge, /scheduleNativeDailyReminder/);
  assert.match(offlineJs, /api_updateTransaction/);
  assert.match(offlineJs, /api_deleteTransaction/);
  assert.match(offlineJs, /api_addTransfer/);
  assert.match(onboardingJs, /openOnboardingWizard/);
  assert.match(nativeUxJs, /initPullToRefresh/);
  assert.match(nativeUxJs, /toggleBiometricUnlock/);
  assert.match(adminFn, /delete_user/);
  assert.match(adminFn, /unlink_telegram/);
  assert.match(adminMigration, /admin_audit_logs/);
  assert.match(adminMigration, /admin_unlink_user_telegram/);
  assert.match(adminJs, /Putus Telegram/);
  assert.match(adminJs, /Hapus Akun/);
  assert.match(buildMjs, /ui-feat-native-ux\.js/);
  assert.match(buildMjs, /ui-feat-onboarding\.js/);
});
