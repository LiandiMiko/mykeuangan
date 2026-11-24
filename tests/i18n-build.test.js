const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadI18nDictionary() {
  const html = fs.readFileSync('src/i18n.html', 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'expected <script> block in src/i18n.html');
  const sandbox = {
    localStorage: { getItem: () => 'id', setItem: () => {} },
    document: { addEventListener: () => {}, querySelectorAll: () => [] },
    window: {}
  };
  return vm.runInNewContext(`${scriptMatch[1]}\n({ id: I18N.id, en: I18N.en });`, sandbox);
}

test('i18n ID and EN dictionaries share exact key parity and cover all template attributes', () => {
  const i18n = loadI18nDictionary();
  const idKeys = Object.keys(i18n.id).sort();
  const enKeys = Object.keys(i18n.en).sort();
  assert.deepEqual(idKeys, enKeys, 'I18N.id and I18N.en must contain identical keys');

  const srcFiles = fs.readdirSync('src').filter((name) => name.endsWith('.html'));
  const usedKeys = new Set();
  const attrPattern = /\bdata-i18n(?:-(?:placeholder|title|aria-label))?="([^"]+)"/g;
  srcFiles.forEach((name) => {
    const html = fs.readFileSync(`src/${name}`, 'utf8');
    for (const match of html.matchAll(attrPattern)) {
      usedKeys.add(match[1]);
    }
  });
  usedKeys.forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.id, key), `Missing ID translation for "${key}"`);
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.en, key), `Missing EN translation for "${key}"`);
  });
});

test('service worker targets AI endpoint specifically, caches icons, and returns 503 on offline miss', () => {
  const sw = fs.readFileSync('web/sw.js', 'utf8');
  const auth = fs.readFileSync('web/supabase-auth.js', 'utf8');
  assert.match(sw, /addEventListener\('message'/);
  assert.match(sw, /SKIP_WAITING/);
  assert.doesNotMatch(sw, /addEventListener\('install'[\s\S]*?!self\.registration[\s\S]*?else\s+self\.skipWaiting/);
  assert.match(sw, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(sw, /url\.hostname\.includes\('googleapis\.com'\)/);
  assert.match(sw, /\.\/icons\/icon-192\.png/);
  assert.match(sw, /new Response\('',\s*\{\s*status:\s*503/);

  [
    'mk_gemini_api_key',
    'mk_app_pin_hash',
    'mk_offline_tx_queue_v1',
    'mk_quick_templates_v1',
    'mk_autocat_rules_v1',
    'mk_rebalance_targets_v1',
    'mk_browser_notif_enabled',
    'mk_last_seen_release'
  ].forEach((storageKey) => {
    assert.match(auth, new RegExp(storageKey), `Expected logout() cleanup for ${storageKey}`);
  });
});

test('security headers, modular UI build wiring, package.json, and static Tailwind guards are configured', () => {
  const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
  const deployYml = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.match(indexHtml, /http-equiv="Content-Security-Policy"/);
  assert.match(indexHtml, /name="referrer"/);
  assert.ok(fs.existsSync('tailwind.config.js'), 'tailwind.config.js must exist');
  assert.ok(fs.existsSync('web/tailwind-input.css'), 'web/tailwind-input.css must exist');
  assert.match(deployYml, /tailwindcss@3\.4\.17/);
  assert.match(buildMjs, /UI_CORE_MODULES/);
  assert.match(buildMjs, /UI_FEATURES_MODULES/);
  assert.match(buildMjs, /UI_PRO_MODULES/);
  assert.match(buildMjs, /unsafe-eval/);

  const modArrays = [...buildMjs.matchAll(/const (?:WEB|UI_CORE|UI_FEATURES|UI_PRO|SUPABASE)_MODULES = \[([\s\S]*?)\];/g)];
  assert.equal(modArrays.length, 5, 'build.mjs must define all 5 module arrays');
  modArrays.forEach((m) => {
    for (const fileMatch of m[1].matchAll(/'([^']+\.js)'/g)) {
      assert.ok(fs.existsSync(path.join('web', fileMatch[1])), `Missing module web/${fileMatch[1]}`);
    }
  });

  assert.ok(pkg.scripts && pkg.scripts.test, 'package.json must define test script');
  assert.ok(pkg.scripts.check, 'package.json must define check script');
  assert.ok(pkg.scripts['build:css'], 'package.json must define build:css script');
  assert.ok(pkg.scripts.build, 'package.json must define build script');
  assert.ok(fs.existsSync('scripts/check-syntax.mjs'), 'scripts/check-syntax.mjs must exist');
  assert.match(fs.readFileSync('src/styles.html', 'utf8'), /prefers-reduced-motion/);
});

test('no dynamic Tailwind utility interpolation exists and escapeAttrJS neutralizes HTML entities and newlines', async () => {
  const dynTailwind = /\b(?:bg|text|border|ring|from|to)-\$\{/;
  fs.readdirSync('src').filter((n) => n.endsWith('.html')).forEach((name) => {
    assert.doesNotMatch(fs.readFileSync(`src/${name}`, 'utf8'), dynTailwind, `Dynamic Tailwind class in src/${name}`);
  });
  fs.readdirSync('web').filter((n) => n.endsWith('.js') && n !== 'config.js').forEach((name) => {
    assert.doesNotMatch(fs.readFileSync(`web/${name}`, 'utf8'), dynTailwind, `Dynamic Tailwind class in web/${name}`);
  });

  const uiState = fs.readFileSync('web/ui-state.js', 'utf8');
  const windowObj = {};
  const sandbox = {
    window: windowObj,
    renderAll: () => {},
    updateDashboardTitle: () => {},
    localStorage: { getItem: () => '0', setItem: () => {} },
    document: { documentElement: { classList: { contains: () => false } } }
  };
  vm.runInNewContext(uiState, sandbox);

  const entityPayload = "Test&#39;);alert(1)//";
  const escapedEntity = windowObj.escapeAttrJS(entityPayload);
  assert.ok(!escapedEntity.includes('&#39;'), 'HTML entities must be re-escaped so browsers do not decode into quotes');
  assert.ok(escapedEntity.includes('&amp;#39;'));

  const tagPayload = `<img onerror="x">\n\r'\\`;
  const escapedTag = windowObj.escapeAttrJS(tagPayload);
  assert.ok(!escapedTag.includes('<') && !escapedTag.includes('>') && !escapedTag.includes('\n') && !escapedTag.includes('\r'));
  assert.ok(escapedTag.includes("\\'"));

  assert.equal(windowObj.formatNominalInputValue(1500000), '1.500.000');
  assert.equal(windowObj.formatNominalInputValue('250000'), '250.000');
  assert.equal(windowObj.parseFormattedNominal('1.500.000'), 1500000);
  assert.equal(windowObj.parseFormattedNominal('Rp 1.250.000'), 1250000);
  assert.ok(Number.isNaN(windowObj.parseFormattedNominal('')));

  windowObj.DB.transactions = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  await windowObj.refreshFromServer({ deletedTransactionIds: ['t1', 't3'] });
  assert.deepEqual(windowObj.DB.transactions.map((x) => x.id), ['t2']);
});

test('telegram bot supports insight fallback, smart wallet matching, accurate copy count, and days 1..31', () => {
  const botAi = fs.readFileSync('supabase/functions/telegram-bot/ai.ts', 'utf8');
  const botPlanning = fs.readFileSync('supabase/functions/telegram-bot/planning.ts', 'utf8');
  const botWallets = fs.readFileSync('supabase/functions/telegram-bot/wallets.ts', 'utf8');

  const insightSection = botAi.slice(botAi.indexOf('async function askInsight'));
  assert.match(insightSection, /GEMINI_FALLBACK_MODELS/);
  assert.match(insightSection, /\.catch\(\(\)\s*=>\s*\(\{\}\)\)/);
  assert.match(botPlanning, /day\s*>\s*31/);
  assert.match(botPlanning, /rows\.length.*kategori di-copy/);
  assert.match(botWallets, /export function matchWalletFromText/);
});

test('edge functions support multi-origin CORS, bulk sync removes all IDs, and auth avoids native alert', () => {
  const adminEdge = fs.readFileSync('supabase/functions/admin-password/index.ts', 'utf8');
  const botJobs = fs.readFileSync('supabase/functions/telegram-bot/jobs.ts', 'utf8');
  const proReports = fs.readFileSync('web/ui-pro-reports.js', 'utf8');
  const supabaseAuth = fs.readFileSync('web/supabase-auth.js', 'utf8');
  const supabaseCore = fs.readFileSync('web/supabase-core.js', 'utf8');

  assert.match(adminEdge, /function buildCorsHeaders/);
  assert.match(adminEdge, /'Vary'/);
  assert.match(botJobs, /export function buildCorsHeaders/);
  assert.match(botJobs, /'Vary'/);
  assert.match(proReports, /addedTransactions/);
  assert.match(proReports, /deletedTransactionIds/);
  assert.doesNotMatch(supabaseAuth, /\balert\(/);
  assert.doesNotMatch(supabaseCore, /\balert\(/);
  assert.doesNotMatch(fs.readFileSync('web/supabase-auth-ui.js', 'utf8'), /\balert\(/);
});

test('wave v3.15 configures Play Store compliance, Google OAuth, account deletion, and offline snapshot cache', () => {
  const deleteFn = fs.readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
  const oauthMigration = fs.readFileSync('supabase/migrations/20261124000000_oauth_onboarding_display_name.sql', 'utf8');
  const supabaseAuthUi = fs.readFileSync('web/supabase-auth-ui.js', 'utf8');
  const supabaseAuth = fs.readFileSync('web/supabase-auth.js', 'utf8');
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('web/manifest.webmanifest', 'utf8'));

  assert.match(deleteFn, /deleteUser/);
  assert.match(deleteFn, /buildCorsHeaders/);
  assert.match(oauthMigration, /full_name/);
  assert.match(supabaseAuthUi, /mkGoogleBtn/);
  assert.match(supabaseAuthUi, /privacy\.html/);
  assert.match(supabaseAuthUi, /showPasswordRecoveryModal/);
  assert.match(supabaseAuth, /signInWithOAuth/);
  assert.match(supabaseAuth, /PASSWORD_RECOVERY/);
  assert.match(supabaseAuth, /redirectTo/);
  assert.match(supabaseAuth, /mk_cached_profile_v1/);

  assert.ok(fs.existsSync('web/privacy.html'), 'web/privacy.html must exist');
  assert.ok(fs.existsSync('web/terms.html'), 'web/terms.html must exist');
  assert.ok(fs.existsSync('web/delete-account.html'), 'web/delete-account.html must exist');
  assert.match(buildMjs, /delete-account\.html/);
  assert.match(buildMjs, /privacy\.html/);
  assert.equal(manifest.id, './index.html');
});
