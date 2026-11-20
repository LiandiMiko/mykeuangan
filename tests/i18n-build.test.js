const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('i18n ID and EN dictionaries share exact key parity and cover all template keys', () => {
  const i18n = loadI18nDictionary();
  const idKeys = Object.keys(i18n.id).sort();
  const enKeys = Object.keys(i18n.en).sort();
  assert.deepEqual(idKeys, enKeys, 'I18N.id and I18N.en must contain identical keys');

  const srcFiles = fs.readdirSync('src').filter((name) => name.endsWith('.html'));
  const usedKeys = new Set();
  srcFiles.forEach((name) => {
    const html = fs.readFileSync(`src/${name}`, 'utf8');
    for (const match of html.matchAll(/\bdata-i18n="([^"]+)"/g)) {
      usedKeys.add(match[1]);
    }
  });
  usedKeys.forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.id, key), `Missing ID translation for "${key}"`);
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.en, key), `Missing EN translation for "${key}"`);
  });
});

test('service worker defers SKIP_WAITING to user prompt and logout wipes all user keys', () => {
  const sw = fs.readFileSync('web/sw.js', 'utf8');
  const auth = fs.readFileSync('web/supabase-auth.js', 'utf8');
  assert.match(sw, /addEventListener\('message'/);
  assert.match(sw, /SKIP_WAITING/);
  assert.doesNotMatch(sw, /addEventListener\('install'[\s\S]*?!self\.registration[\s\S]*?else\s+self\.skipWaiting/);

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

test('security headers, modular assets, and static Tailwind CI pipeline are configured', () => {
  const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
  const deployYml = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');
  assert.match(indexHtml, /http-equiv="Content-Security-Policy"/);
  assert.match(indexHtml, /name="referrer"/);
  assert.ok(fs.existsSync('tailwind.config.js'), 'tailwind.config.js must exist');
  assert.ok(fs.existsSync('web/tailwind-input.css'), 'web/tailwind-input.css must exist');
  assert.match(deployYml, /tailwindcss@3\.4\.17/);
  assert.match(buildMjs, /finance-analysis-core\.js/);
  assert.match(buildMjs, /supabase-core\.js/);
  assert.match(buildMjs, /supabase-portfolio\.js/);
});
