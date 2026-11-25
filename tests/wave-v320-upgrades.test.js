const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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

  assert.equal(pkg.version, '3.20.1');
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

test('hotfix v3.20.1 patches Android NativeBiometricPlugin idempotently before super.onCreate()', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykeu-android-patch-'));
  try {
    const manifestPath = path.join(tmpDir, 'app', 'src', 'main', 'AndroidManifest.xml');
    const gradlePath = path.join(tmpDir, 'app', 'build.gradle');
    const varsPath = path.join(tmpDir, 'variables.gradle');
    const mainActPath = path.join(tmpDir, 'app', 'src', 'main', 'java', 'com', 'mykeuguech', 'app', 'MainActivity.java');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(mainActPath), { recursive: true });

    fs.writeFileSync(varsPath, 'minSdkVersion = 22\ncompileSdkVersion = 34\ntargetSdkVersion = 34\n');
    fs.writeFileSync(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n        <activity android:name=".MainActivity">\n        </activity>\n    </application>\n</manifest>\n');
    fs.writeFileSync(gradlePath, 'android {\n    defaultConfig {\n        versionCode 1\n        versionName "1.0"\n    }\n    buildTypes {\n        release {\n        }\n    }\n}\ndependencies {\n    implementation "androidx.appcompat:appcompat:1.7.0"\n}\n');
    fs.writeFileSync(mainActPath, 'package com.mykeuguech.app;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n');

    const mod = await import(pathToFileURL(path.resolve('scripts/patch-android-project.mjs')).href);
    mod.patchAndroidProject(tmpDir, '3.20.1');
    mod.patchAndroidProject(tmpDir, '3.20.1');

    const manifest = fs.readFileSync(manifestPath, 'utf8');
    const gradle = fs.readFileSync(gradlePath, 'utf8');
    const mainAct = fs.readFileSync(mainActPath, 'utf8');
    const pluginPath = path.join(path.dirname(mainActPath), 'NativeBiometricPlugin.java');

    assert.match(manifest, /android\.permission\.USE_BIOMETRIC/);
    assert.match(manifest, /android\.permission\.USE_FINGERPRINT/);
    assert.equal(manifest.match(/android\.permission\.USE_BIOMETRIC/g).length, 1);
    assert.match(gradle, /androidx\.biometric:biometric:1\.1\.0/);
    assert.equal(gradle.match(/androidx\.biometric:biometric/g).length, 1);
    assert.ok(fs.existsSync(pluginPath), 'NativeBiometricPlugin.java must be created');
    assert.match(fs.readFileSync(pluginPath, 'utf8'), /@CapacitorPlugin\(name = "NativeBiometric"\)/);

    const regIdx = mainAct.indexOf('registerPlugin(NativeBiometricPlugin.class);');
    const superIdx = mainAct.indexOf('super.onCreate(savedInstanceState);');
    assert.ok(regIdx > 0 && superIdx > regIdx, 'registerPlugin must run before super.onCreate()');
    assert.equal(mainAct.match(/registerPlugin\(NativeBiometricPlugin\.class\)/g).length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hotfix v3.20.1 handles native Capacitor biometric verification and WebAuthn rpId safety', async () => {
  const nativeUxJs = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');
  const storage = new Map([['mk_biometric_pin_enabled', '1']]);
  let verifyCalls = 0;

  const nativePlugin = {
    isAvailable: async () => ({ isAvailable: false, reason: 'none_enrolled' }),
    verifyIdentity: async (opts) => {
      verifyCalls += 1;
      assert.equal(opts.title, 'MyKeuGuech');
      return { verified: true };
    }
  };
  const nativeSandbox = {
    Capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: (n) => n === 'NativeBiometric',
      Plugins: {},
      registerPlugin: (n) => (n === 'NativeBiometric' ? nativePlugin : null)
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    document: { addEventListener: () => {} },
    Swal: { isVisible: () => false, fire: async () => ({}) }
  };
  nativeSandbox.window = nativeSandbox;
  vm.runInNewContext(nativeUxJs, nativeSandbox);

  const avail = await nativeSandbox.checkBiometricAvailability();
  assert.equal(avail.supported, false);
  assert.equal(avail.reason, 'none_enrolled');
  assert.match(nativeSandbox.formatBiometricFailureReason(avail.reason), /Belum ada sidik jari/);

  assert.equal(await nativeSandbox.tryBiometricUnlock(), true);
  assert.equal(verifyCalls, 1);

  let capturedGetOpts = null;
  const webSandbox = {
    crypto: webcrypto,
    isSecureContext: true,
    location: { hostname: '127.0.0.1' },
    PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
    navigator: {
      credentials: {
        get: async (opts) => {
          capturedGetOpts = opts;
          return { id: 'ok' };
        }
      }
    },
    localStorage: {
      getItem: (k) => (k === 'mk_biometric_pin_enabled' ? '1' : (k === 'mk_biometric_cred_id' ? 'AQID' : null)),
      setItem: () => {},
      removeItem: () => {}
    },
    document: { addEventListener: () => {} },
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    btoa: (bin) => Buffer.from(bin, 'binary').toString('base64')
  };
  webSandbox.window = webSandbox;
  vm.runInNewContext(nativeUxJs, webSandbox);

  assert.equal(webSandbox.resolveWebAuthnRpId(), undefined);
  assert.equal(await webSandbox.tryBiometricUnlock(), true);
  assert.equal(capturedGetOpts.publicKey.rpId, undefined);
  assert.deepEqual([...capturedGetOpts.publicKey.allowCredentials[0].transports], ['internal']);
});

test('hotfix v3.20.1 falls back to client currency-api on Edge Function failure and computes manual crypto value', async () => {
  const portfolioJs = fs.readFileSync('web/supabase-portfolio.js', 'utf8');
  const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
  const swJs = fs.readFileSync('web/sw.js', 'utf8');
  const jobsTs = fs.readFileSync('supabase/functions/telegram-bot/jobs.ts', 'utf8');

  assert.match(indexHtml, /https:\/\/api\.coingecko\.com/);
  assert.match(indexHtml, /https:\/\/latest\.currency-api\.pages\.dev/);
  assert.match(swJs, /api\.coingecko\.com/);
  assert.match(swJs, /currency-api/);
  assert.match(jobsTs, /currency-api/);
  assert.match(jobsTs, /api\.binance\.com/);
  assert.match(jobsTs, /https:\/\/localhost/);

  const assetRows = [
    { id: 'a1', name: 'Bitcoin', type: 'Crypto', symbol: 'BTC', quantity: 0.5, buy_price: 900000000, value: 450000000 },
    { id: 'a2', name: 'Antam', type: 'Emas', symbol: 'XAU', quantity: 10, buy_price: 1300000, value: 13000000 },
    { id: 'a3', name: 'Tabungan USD', type: 'USD', symbol: 'USD', quantity: 100, buy_price: 15500, value: 1550000 }
  ];
  const insertedManual = [];
  const upsertedSnapshots = [];

  const createTableQuery = (table) => ({
    select: () => ({
      range: () => ({ order: () => ({ order: async () => ({ data: assetRows, error: null }) }) }),
      gte: () => ({ order: async () => ({ data: upsertedSnapshots, error: null }) })
    }),
    insert: async (payload) => {
      if (table === 'assets') insertedManual.push(payload);
      return { error: null };
    },
    update: (patch) => ({
      eq: async (_, id) => {
        const row = assetRows.find((r) => r.id === id);
        if (row && table === 'assets') Object.assign(row, patch);
        return { error: null };
      }
    }),
    upsert: async (row) => {
      if (table === 'portfolio_snapshots') upsertedSnapshots.push(row);
      return { error: null };
    }
  });

  const coreSandbox = {
    sb: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u-1' } } } }) },
      from: (table) => createTableQuery(table),
      functions: {
        invoke: async () => ({ data: null, error: { message: 'FunctionsFetchError: CORS failed' } })
      }
    },
    fail: (e) => { if (e) throw new Error(e.message || String(e)); },
    num: (v) => Number(v) || 0,
    ymd: () => '2026-11-25',
    syncPeriod: async () => '2026-11',
    trxFromRow: (r) => r,
    fetchAll: async () => assetRows,
    fetchCategoriesOnly: async () => ({ categories: { pemasukan: [], pengeluaran: [] } }),
    fetchWalletsOnly: async () => ({ wallets: [] }),
    fetchWalletsAndTransfers: async () => ({ wallets: [], transfers: [] }),
    fetchAssetsOnly: async () => ({
      assets: assetRows.map((a) => ({
        id: a.id, name: a.name, type: a.type, symbol: a.symbol,
        quantity: a.quantity, buyPrice: a.buy_price, value: a.value
      }))
    }),
    handlers: {}
  };

  const sandbox = {
    window: { __mkSb: coreSandbox },
    navigator: { onLine: true },
    fetch: async (url) => {
      if (String(url).includes('coingecko')) return { ok: false, status: 429 };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          idr: { usd: 1 / 16000, btc: 1 / 1500000000, xau: 1 / 46655215.2 }
        })
      };
    },
    Promise,
    Set,
    Number,
    Math,
    Date
  };
  vm.runInNewContext(portfolioJs, sandbox);

  const refreshed = await coreSandbox.handlers.api_refreshPrices();
  assert.equal(refreshed.refreshMeta.source, 'direct');
  assert.equal(refreshed.refreshMeta.updated, 3);
  assert.equal(assetRows[0].value, 750000000);
  assert.equal(assetRows[1].value, 15000000);
  assert.equal(assetRows[2].value, 1600000);
  assert.equal(upsertedSnapshots.length, 1);

  await coreSandbox.handlers.api_addAssetV2({ name: 'Solana', type: 'Crypto', symbol: 'SOL', quantity: 2, buyPrice: 3000000, value: 0 });
  assert.equal(insertedManual[0].value, 6000000);

  const backupRows = [...assetRows];
  assetRows.length = 0;
  const emptyRes = await coreSandbox.handlers.api_refreshPrices();
  assert.equal(emptyRes.refreshMeta.noMarketAssets, true);
  assetRows.push(...backupRows);
});
