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

  assert.equal(pkg.version, '3.20.10');
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
      // Wave 3.1 / S1: the stored public key must exist for the web
      // WebAuthn path to even attempt verification; an assertion the
      // authenticator cannot prove (here: a bare `{ id: 'ok' }` with no
      // response at all) must NOT unlock — the old `Boolean(assertion)`
      // behaviour was the vulnerability S1 fixes.
      getItem: (k) => (k === 'mk_biometric_pin_enabled' ? '1' : (k === 'mk_biometric_cred_id' ? 'AQID' : (k === 'mk_webauthn_pubkey_v1' ? JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'A'.repeat(43) }) : null))),
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
  // Wave 3.1 / S1: an unverifiable assertion (no clientData, no
  // signature) must NOT unlock, even though navigator.credentials.get()
  // returned a truthy object.
  assert.equal(await webSandbox.tryBiometricUnlock(), false);
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

test('hotfix v3.20.2 upgrades AI to Gemini 4 Hydrogen, Interactions API, enriched context, markdown & Telegram bot', async () => {
  const uiAiJs = fs.readFileSync('web/ui-ai.js', 'utf8');
  const storageMap = new Map([
    ['mk_gemini_api_key', 'AIzaTestKey'],
    ['mk_gemini_model', 'gemini-2.5-flash']
  ]);
  const calls = [];
  const sandbox = {
    DB: { currentPeriod: '2026-11', payrollDay: 1, transactions: [] },
    FinanceAnalysis,
    Swal: { fire: async () => ({ isConfirmed: false }) },
    escapeHtmlJS: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    renderHtml: () => {},
    getSwalClass: () => '',
    currentLang: 'id',
    localToday: () => '2026-11-25',
    t: (k) => k,
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k)
    },
    document: { getElementById: () => null },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, body });
      if (body.model === 'gemini-4-hydrogen' && calls.length === 1) {
        return { ok: false, status: 404, json: async () => ({ error: { message: 'Model not found' } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          steps: [
            { type: 'thought', signature: 'sig' },
            { type: 'model_output', content: [{ type: 'text', text: '{"healthScore":88,"statusLabel":"Sehat","ringkasan":"Bagus","sorotan":["OK"],"bocorAnggaran":[],"rekomendasi":["Nabung"]}' }] }
          ]
        })
      };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    Set,
    Date,
    Math,
    Number,
    String
  };
  sandbox.window = sandbox;
  vm.runInNewContext(uiAiJs, sandbox);

  assert.equal(sandbox.normalizeGeminiModel('gemini-2.5-flash'), 'gemini-4-hydrogen');
  assert.equal(sandbox.normalizeGeminiModel('models/gemini-2.0-flash'), 'gemini-4-hydrogen');
  assert.equal(sandbox.normalizeGeminiModel('gemini-1.5-pro'), 'gemini-4-argon');
  assert.equal(sandbox.normalizeGeminiModel('gemini-2.5-flash-lite'), 'gemini-3.5-flash-lite');
  assert.equal(sandbox.normalizeGeminiModel('gemini-3.8-flash'), 'gemini-4-hydrogen');
  assert.equal(sandbox.normalizeGeminiModel('gemini-4-neon'), 'gemini-4-neon');
  assert.equal(sandbox.normalizeGeminiModel('gemini-custom-exp'), 'gemini-custom-exp');

  assert.equal(sandbox.getGeminiModel(), 'gemini-4-hydrogen');
  assert.equal(storageMap.get('mk_gemini_model'), 'gemini-4-hydrogen');

  const res = await sandbox.callGeminiApi('AIzaTestKey', {
    input: 'Analisis arus kas',
    systemInstruction: 'Kamu penasihat keuangan',
    thinkingLevel: 'medium',
    responseSchema: FinanceAnalysis.CASHFLOW_ANALYSIS_SCHEMA
  });
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1/interactions');
  assert.equal(calls[0].headers['Api-Revision'], undefined);
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.generation_config.thinking_level, 'medium');
  assert.equal(calls[0].body.generation_config.temperature, undefined);
  assert.equal(calls[0].body.generation_config.thinking_budget, undefined);
  assert.equal(calls[0].body.response_format.mime_type, 'application/json');
  assert.equal(res.model, 'gemini-3.5-flash-lite');
  assert.match(res.text, /"healthScore":88/);

  const mdHtml = sandbox.formatAiMarkdownSafe('### Ringkasan\n- Hemat **Rp 500.000** per `siklus`\n<script>alert(1)</script>');
  assert.doesNotMatch(mdHtml, /<script>/);
  assert.match(mdHtml, /<h4[^>]*>Ringkasan<\/h4>/);
  assert.match(mdHtml, /<strong[^>]*>Rp 500\.000<\/strong>/);
  assert.match(mdHtml, /<code[^>]*>siklus<\/code>/);

  const enriched = FinanceAnalysis.buildEnrichedAiSnapshot({
    wallets: [{ id: 'w1', name: 'BCA', openingBalance: 10000000 }],
    transactions: [
      { tanggal: '2026-11-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 8000000, walletId: 'w1' },
      { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 2000000, walletId: 'w1' },
      { tanggal: '2026-11-08', tipe: 'Pemasukan', kategori: 'UtangPerson - Budi', nominal: 1000000, walletId: 'w1' }
    ],
    assets: [{ name: 'Emas', type: 'Emas', value: 5000000 }],
    budgets: [{ bulan: '2026-11', kategori: 'Makan', jumlah: 1800000 }],
    goals: [{ name: 'Darurat', currentAmount: 3000000, targetAmount: 10000000, targetDate: '2027-06-01' }],
    recurring: [{ tipe: 'Pengeluaran', kategori: 'Internet', nominal: 350000, dayOfMonth: 28, active: true }]
  }, '2026-11', 1, '2026-11-25');
  assert.equal(enriched.incomeTotal, 8000000);
  assert.equal(enriched.expenseTotal, 2000000);
  assert.ok(enriched.healthRatios && enriched.healthRatios.debtToAssetPct > 0);
  assert.ok(enriched.runway && enriched.runway.safeDailyBudget > 0);
  assert.ok(enriched.spendingBehavior && enriched.spendingBehavior.fixedExpenseTotal === 350000);
  assert.equal(enriched.activeGoals[0].name, 'Darurat');
  assert.equal(enriched.activeDebts[0].name, 'Budi');

  const longQuestion = 'B '.repeat(350) + 'berapa cicilan aman saya per bulan jika gaji naik 10 persen?';
  const steps = FinanceAnalysis.buildAiChatSteps(
    enriched,
    [{ role: 'user', text: 'A '.repeat(300) }, { role: 'assistant', text: 'Jawaban awal.' }],
    longQuestion,
    'id'
  );
  assert.equal(steps.length, 3);
  assert.equal(steps[0].type, 'user_input');
  assert.equal(steps[1].type, 'model_output');
  assert.equal(steps[2].type, 'user_input');
  assert.match(steps[2].content[0].text, /berapa cicilan aman saya per bulan/);

  const botCoreTs = fs.readFileSync('supabase/functions/telegram-bot/core.ts', 'utf8');
  const botAiTs = fs.readFileSync('supabase/functions/telegram-bot/ai.ts', 'utf8');
  assert.match(botCoreTs, /'gemini-4-hydrogen'/);
  assert.doesNotMatch(botCoreTs, /gemini-2\.5-flash/);
  assert.match(botAiTs, /https:\/\/generativelanguage\.googleapis\.com\/v1\/interactions/);
  assert.match(botAiTs, /'Api-Revision':\s*'2026-05-20'/);
  assert.match(botAiTs, /store:\s*false/);
  assert.match(botAiTs, /thinking_level/);
  assert.doesNotMatch(botAiTs, /thinkingBudget|gemini-2\.0-flash|gemini-2\.5-flash/);
  assert.doesNotMatch(botAiTs, /\btemperature\s*:/);
});

test('v3.20.2: Popup, Modal, & Bottom Sheet Overhaul maintains brand specificity, dark mode, a11y labels, and motion invariants', () => {
  const stylesHtml = fs.readFileSync('src/styles.html', 'utf8');
  const assetOpsJs = fs.readFileSync('web/ui-asset-ops.js', 'utf8');
  const walletsJs = fs.readFileSync('web/ui-wallets.js', 'utf8');
  const featModalsJs = fs.readFileSync('web/ui-feat-modals.js', 'utf8');
  const recurringJs = fs.readFileSync('web/ui-recurring.js', 'utf8');

  assert.match(stylesHtml, /\.swal2-popup\s+\.swal2-actions\s+\.swal2-styled\.swal2-confirm\s*\{\s*background-color:\s*var\(--color-brand\);/);
  assert.doesNotMatch(stylesHtml, /\.swal2-confirm\s*\{[^}]*background-color:[^;]*!important/);
  assert.match(stylesHtml, /\.swal2-popup\s+\.swal2-actions\s+\.swal2-styled\.swal2-cancel/);
  assert.match(stylesHtml, /\.swal2-validation-message/);
  assert.match(stylesHtml, /\.swal2-close/);
  assert.match(stylesHtml, /select\.swal2-input,\s*select\.swal2-select/);
  assert.match(stylesHtml, /\.swal2-container\.swal2-backdrop-show/);
  assert.match(stylesHtml, /@keyframes\s+mkModalIn/);
  assert.match(stylesHtml, /@keyframes\s+mkModalOut/);

  assert.doesNotMatch(assetOpsJs, /color:#64748b/);
  assert.doesNotMatch(walletsJs, /color:#64748b/);
  assert.doesNotMatch(recurringJs, /color:#64748b|color:#94a3b8/);

  for (const id of ['asset-symbol-wrap', 'asset-quantity-wrap', 'asset-buyprice-wrap', 'asset-value-wrap']) {
    assert.ok(featModalsJs.includes(id), `Expected ${id} in web/ui-feat-modals.js`);
  }
});

test('v3.20.3: Popup polish fixes dark-mode icon masks, colored deny contrast, loading divider, drag handle grid, and modal templates', () => {
  const stylesHtml = fs.readFileSync('src/styles.html', 'utf8');
  const insightsJs = fs.readFileSync('web/ui-pro-insights.js', 'utf8');
  const paletteJs = fs.readFileSync('web/ui-pro-palette.js', 'utf8');
  const quickJs = fs.readFileSync('web/ui-pro-quick.js', 'utf8');
  const budgetJs = fs.readFileSync('web/ui-budget.js', 'utf8');
  const debtsJs = fs.readFileSync('web/ui-debts.js', 'utf8');
  const assetsJs = fs.readFileSync('web/ui-assets.js', 'utf8');
  const walletsJs = fs.readFileSync('web/ui-wallets.js', 'utf8');
  const onboardingJs = fs.readFileSync('web/ui-feat-onboarding.js', 'utf8');

  assert.match(stylesHtml, /\.swal2-icon\.swal2-success\s+\[class\^='swal2-success-circular-line'\]/);
  assert.match(stylesHtml, /background-color:\s*var\(--mk-surface-elevated\)\s*!important;/);
  assert.match(stylesHtml, /\.swal2-deny\[style\*="background-color"\]/);
  assert.match(stylesHtml, /\.swal2-actions\.swal2-loading\s*\{[^}]*border-top:\s*0\s*!important/);
  assert.match(stylesHtml, /grid-column:\s*1\s*\/\s*-1;\s*justify-self:\s*center;/);
  assert.match(stylesHtml, /color-scheme:\s*dark;/);
  assert.match(stylesHtml, /#mkCommandPalette[\s\S]*--safe-area-inset-top/);
  assert.match(stylesHtml, /#mkCmdList\s*\{[^}]*max-height:\s*min\(22rem,\s*55dvh\)/);

  assert.match(insightsJs, /<label for="cmp-init"/);
  assert.match(insightsJs, /<label for="ins-cash"/);
  assert.match(insightsJs, /id="rebTotalBadge"/);
  assert.match(paletteJs, /id="mkCmdCloseBtn"/);
  assert.match(quickJs, /left-4 right-4 sm:left-auto sm:right-4 z-50 sm:max-w-sm/);
  assert.doesNotMatch(budgetJs, /color:#64748b/);
  // Gelombang 6C U8: label tombol modal sudah lewat i18n (dulu hardcode
  // 'Simpan'/'Batal' di sini); kunci t('btn.simpan')/t('btn.batal').
  assert.match(debtsJs, /confirmButtonText:\s*t\('btn\.simpan'\)/);
  assert.match(assetsJs, /confirmButtonText:\s*'Ya, Hapus'/);
  assert.match(walletsJs, /cancelButtonText:\s*t\('btn\.batal'\)/);
  assert.match(onboardingJs, /renderStepIndicator/);
  assert.match(stylesHtml, /#swal-payroll\.swal2-input/);
  assert.match(stylesHtml, /\.swal2-close\s*\{[^}]*position:\s*absolute\s*!important;/);
  assert.match(stylesHtml, /@media\s*\(max-width:\s*639px\)\s*\{\s*\.swal2-container\.swal2-center\s*\{[^}]*display:\s*flex\s*!important;[^}]*justify-content:\s*flex-end\s*!important;/);
  assert.match(stylesHtml, /place-self:\s*end stretch\s*!important;/);
  assert.match(stylesHtml, /margin:\s*auto 0 0 0\s*!important;/);
  assert.match(stylesHtml, /align-items:\s*stretch\s*!important;/);
  assert.match(stylesHtml, /position:\s*sticky;\s*bottom:\s*0;/);
  assert.match(stylesHtml, /border-radius:\s*28px\s*!important;/);
  assert.match(stylesHtml, /@media\s*\(max-width:\s*639px\)\s*\{\s*\.swal2-container\.swal2-center\s*\{[\s\S]*--safe-area-inset-bottom[\s\S]*overflow:\s*hidden\s*!important;/);
  assert.match(stylesHtml, /\.mk-native-app\s+\.swal2-container\.swal2-center\s*\{[\s\S]*padding-bottom:[\s\S]*--safe-area-inset-bottom/);
  assert.match(stylesHtml, /max-height:\s*min\(86dvh,\s*100%\)\s*!important;/);
  assert.match(stylesHtml, /\.swal2-actions\s*\{[\s\S]*border-radius:\s*0 0 28px 28px;/);
  assert.match(paletteJs, /class="hidden sm:flex px-3\.5 py-2/);
});

test('v3.20.3: openCommandPalette binds #mkCmdCloseBtn after appendChild and restores focus without null crash', () => {
  const paletteJs = fs.readFileSync('web/ui-pro-palette.js', 'utf8');
  const appendedNodes = [];
  const makeNode = (tag) => {
    const attrs = new Map();
    const listeners = new Map();
    return {
      tagName: tag,
      id: '',
      className: '',
      value: '',
      isConnected: true,
      children: [],
      focused: false,
      classList: { toggle: () => {} },
      setAttribute: (k, v) => attrs.set(k, v),
      getAttribute: (k) => attrs.get(k) || '',
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      querySelectorAll: () => [],
      focus() { this.focused = true; },
      remove() {
        const idx = appendedNodes.indexOf(this);
        if (idx >= 0) appendedNodes.splice(idx, 1);
        this.isConnected = false;
      }
    };
  };
  const closeBtn = makeNode('BUTTON');
  closeBtn.id = 'mkCmdCloseBtn';
  const cmdInput = makeNode('INPUT');
  cmdInput.id = 'mkCmdInput';
  const cmdList = makeNode('DIV');
  cmdList.id = 'mkCmdList';
  const triggerBtn = makeNode('BUTTON');
  triggerBtn.id = 'paletteTrigger';

  const findInMounted = (id) => {
    for (const rootNode of appendedNodes) {
      if (rootNode.id === id) return rootNode;
      if (rootNode._byId && rootNode._byId[id]) return rootNode._byId[id];
    }
    return null;
  };
  const sandbox = {
    DB: { currentPeriod: '2026-11', transactions: [] },
    FinancePro: { getAutoCategoryRules: () => [] },
    FinanceAnalysis: {},
    Swal: {},
    escapeHtmlJS: (s) => String(s ?? ''),
    escapeAttrJS: (s) => String(s ?? ''),
    renderHtml: (target, html) => {
      if (target.id === 'mkCommandPalette' && /id="mkCmdCloseBtn"/.test(html)) {
        target._byId = { mkCmdCloseBtn: closeBtn, mkCmdInput: cmdInput, mkCmdList: cmdList };
      }
    },
    currentLang: 'id',
    document: {
      activeElement: triggerBtn,
      body: { appendChild: (el) => appendedNodes.push(el) },
      createElement: (tag) => makeNode(tag),
      getElementById: (id) => findInMounted(id)
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(paletteJs, sandbox);

  assert.doesNotThrow(() => sandbox.openCommandPalette());
  assert.ok(findInMounted('mkCommandPalette'), '#mkCommandPalette should be appended to body');
  assert.equal(typeof closeBtn.onclick, 'function', '#mkCmdCloseBtn.onclick must be wired after appendChild');
  assert.equal(cmdInput.focused, true);

  closeBtn.onclick();
  assert.equal(findInMounted('mkCommandPalette'), null, 'clicking close button should remove palette');
  assert.equal(triggerBtn.focused, true, 'closing palette should restore focus to previous activeElement');
});

test('v3.20.3: buildEnrichedAiSnapshot populates portfolio fields in browser IIFE regardless of script load order', () => {
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');
  assert.ok(
    buildMjs.indexOf("'finance-analysis-portfolio.js'") < buildMjs.indexOf("'finance-analysis-ai.js'"),
    'build.mjs should bundle finance-analysis-portfolio.js before finance-analysis-ai.js'
  );

  const coreSrc = fs.readFileSync('web/finance-analysis-core.js', 'utf8');
  const portfolioSrc = fs.readFileSync('web/finance-analysis-portfolio.js', 'utf8');
  const aiSrc = fs.readFileSync('web/finance-analysis-ai.js', 'utf8');
  const backupSrc = fs.readFileSync('web/finance-analysis-backup.js', 'utf8');
  const facadeSrc = fs.readFileSync('web/finance-analysis.js', 'utf8');

  const sampleData = {
    wallets: [{ id: 'w1', name: 'Bank', kind: 'bank', openingBalance: 6000000 }],
    transactions: [
      { tanggal: '2026-11-01', tipe: 'Pemasukan', kategori: 'Gaji', nominal: 8000000, walletId: 'w1' },
      { tanggal: '2026-11-05', tipe: 'Pengeluaran', kategori: 'Makan', nominal: 1500000, walletId: 'w1' }
    ],
    assets: [{ name: 'Emas', type: 'Emas', value: 4000000 }],
    budgets: [{ bulan: '2026-11', kategori: 'Makan', jumlah: 2000000 }],
    goals: [{ name: 'Darurat', currentAmount: 2000000, targetAmount: 10000000 }],
    recurring: [{ tipe: 'Pengeluaran', kategori: 'Internet', nominal: 300000, dayOfMonth: 28, active: true }]
  };

  for (const order of ['ai-first', 'portfolio-first']) {
    const browserCtx = {};
    browserCtx.window = browserCtx;
    vm.runInNewContext(coreSrc, browserCtx);
    if (order === 'ai-first') {
      vm.runInNewContext(aiSrc, browserCtx);
      vm.runInNewContext(portfolioSrc, browserCtx);
    } else {
      vm.runInNewContext(portfolioSrc, browserCtx);
      vm.runInNewContext(aiSrc, browserCtx);
    }
    vm.runInNewContext(backupSrc, browserCtx);
    vm.runInNewContext(facadeSrc, browserCtx);

    const enriched = browserCtx.FinanceAnalysis.buildEnrichedAiSnapshot(sampleData, '2026-11', 1, '2026-11-26');
    assert.ok(enriched.healthRatios && enriched.healthRatios.liquidCash > 0, `expected healthRatios in ${order} mode`);
    assert.ok(enriched.runway && enriched.runway.safeDailyBudget > 0, `expected runway in ${order} mode`);
    assert.ok(enriched.spendingBehavior && enriched.spendingBehavior.fixedExpenseTotal === 300000, `expected spendingBehavior in ${order} mode`);
    assert.ok(enriched.portfolioAllocation && enriched.portfolioAllocation.total > 0, `expected portfolioAllocation in ${order} mode`);
  }
});

test('v3.20.5: Android APK signing uses explicit debug-keystore.properties, apksigner verification gate, and 5-day keepalive', async () => {
  const mod = await import(pathToFileURL(path.resolve('scripts/patch-android-project.mjs')).href);
  const templates = [
    {
      name: 'default-capacitor-buildTypes',
      gradle: 'android {\n    defaultConfig {\n        versionCode 1\n        versionName "1.0"\n    }\n    buildTypes {\n        release {\n        }\n    }\n}\ndependencies {\n    implementation "androidx.appcompat:appcompat:1.7.0"\n}\n'
    },
    {
      name: 'explicit-debug-and-release-buildTypes',
      gradle: 'android {\n    defaultConfig {\n        versionCode 1\n        versionName "1.0"\n    }\n    buildTypes {\n        debug {\n        }\n        release {\n        }\n    }\n}\ndependencies {\n    implementation "androidx.appcompat:appcompat:1.7.0"\n}\n'
    }
  ];

  for (const tpl of templates) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykeu-signing-'));
    try {
      const manifestPath = path.join(tmpDir, 'app', 'src', 'main', 'AndroidManifest.xml');
      const gradlePath = path.join(tmpDir, 'app', 'build.gradle');
      const varsPath = path.join(tmpDir, 'variables.gradle');
      const mainActPath = path.join(tmpDir, 'app', 'src', 'main', 'java', 'com', 'mykeuguech', 'app', 'MainActivity.java');
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.mkdirSync(path.dirname(mainActPath), { recursive: true });

      fs.writeFileSync(varsPath, 'minSdkVersion = 22\ncompileSdkVersion = 34\ntargetSdkVersion = 34\n');
      fs.writeFileSync(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n        <activity android:name=".MainActivity">\n        </activity>\n    </application>\n</manifest>\n');
      fs.writeFileSync(gradlePath, tpl.gradle);
      fs.writeFileSync(mainActPath, 'package com.mykeuguech.app;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n');

      const vInfo1 = mod.patchAndroidProject(tmpDir, '3.20.5');
      const vInfo2 = mod.patchAndroidProject(tmpDir, '3.20.5');
      assert.equal(vInfo1.versionCode, 3020005, tpl.name);
      assert.equal(vInfo2.versionName, '3.20.5', tpl.name);

      const patchedGradle = fs.readFileSync(gradlePath, 'utf8');
      assert.match(patchedGradle, /versionCode 3020005/, tpl.name);
      assert.match(patchedGradle, /versionName "3\.20\.5"/, tpl.name);
      assert.match(patchedGradle, /debug-keystore\.properties/, tpl.name);
      assert.match(patchedGradle, /signingConfigs\s*\{[\s\S]*debug\s*\{[\s\S]*release\s*\{/, tpl.name);
      assert.equal((patchedGradle.match(/signingConfig signingConfigs\.debug/g) || []).length, 1, tpl.name);
      assert.equal((patchedGradle.match(/signingConfig signingConfigs\.release/g) || []).length, 1, tpl.name);
      assert.equal((patchedGradle.match(/\bdebug\s*\{/g) || []).length, 2, tpl.name);
      assert.equal((patchedGradle.match(/\brelease\s*\{/g) || []).length, 2, tpl.name);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const workflow = fs.readFileSync('.github/workflows/android-build.yml', 'utf8');
  assert.match(workflow, /ANDROID_USER_HOME/);
  assert.match(workflow, /debug-keystore\.properties/);
  assert.match(workflow, /ci-debug\.keystore/);
  assert.match(workflow, /apksigner/);
  assert.match(workflow, /verify --print-certs/);
  assert.match(workflow, /keepalive-keystore-cache/);
  assert.match(workflow, /cron:/);
  assert.match(workflow, /ANDROID_DEBUG_KEYSTORE_BASE64/);
  assert.match(workflow, /rm -f [^\n]*android\/ci-debug\.keystore[^\n]*android\/debug-keystore\.properties/);

  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(gitignore, /^android\/debug-keystore\.properties$/m);
});
