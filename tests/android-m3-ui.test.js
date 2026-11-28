const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('wave v3.19 enforces Android Material Design 3 surfaces, bottom sheets, and 360dp proportions', () => {
  const stylesHtml = fs.readFileSync('src/styles.html', 'utf8');
  const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
  const dashboardHtml = fs.readFileSync('src/dashboard.html', 'utf8');
  const formHtml = fs.readFileSync('src/form.html', 'utf8');
  const budgetingHtml = fs.readFileSync('src/budgeting.html', 'utf8');
  const uiCalendarJs = fs.readFileSync('web/ui-calendar.js', 'utf8');
  const uiDashboardJs = fs.readFileSync('web/ui-dashboard.js', 'utf8');
  const uiWalletsJs = fs.readFileSync('web/ui-wallets.js', 'utf8');
  const uiBudgetJs = fs.readFileSync('web/ui-budget.js', 'utf8');
  const authJs = fs.readFileSync('web/supabase-auth.js', 'utf8');
  const authUiJs = fs.readFileSync('web/supabase-auth-ui.js', 'utf8');

  assert.match(stylesHtml, /--mk-surface-canvas:/);
  assert.match(stylesHtml, /\.mk-card-surface/);
  assert.match(stylesHtml, /border-radius:\s*28px\s*!important/);
  assert.match(stylesHtml, /@keyframes mkSheetUp/);
  assert.match(stylesHtml, /\.swal2-input/);

  assert.match(indexHtml, /rounded-r-\[28px\]/);
  assert.match(indexHtml, /w-14 h-8 rounded-full/);
  assert.match(indexHtml, /6\.75rem/);
  assert.match(indexHtml, /v3\.20/);

  assert.match(dashboardHtml, /rounded-\[28px\]/);
  assert.match(dashboardHtml, /grid-cols-2 sm:grid-cols-3/);
  assert.match(dashboardHtml, /grid-cols-3 w-full sm:w-auto/);
  assert.doesNotMatch(dashboardHtml, /bg-white\/12\b/);

  assert.match(formHtml, /sticky bottom-0/);
  assert.match(formHtml, /appearance-none/);
  assert.match(formHtml, /ph-caret-down/);
  assert.match(budgetingHtml, /grid-cols-2 w-full sm:w-auto/);

  assert.match(uiCalendarJs, /w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-brand/);
  assert.match(uiDashboardJs, /flex-col items-end gap-1\.5 sm:flex-row/);
  assert.match(uiWalletsJs, /w-11 h-11 rounded-full/);
  assert.match(uiBudgetJs, /<div class="min-w-0">/);
  assert.match(authJs, /border-radius:28px/);
  assert.match(authUiJs, /min-height:48px/);

  fs.readdirSync('src').filter((name) => name.endsWith('.html')).forEach((name) => {
    assert.doesNotMatch(fs.readFileSync(`src/${name}`, 'utf8'), /class="[^"]*\btransition-all\b/, `src/${name} must not use transition-all class`);
  });
});

test('wave v3.19 app update checker compares semver, evaluates force/soft updates, and sanitizes URLs', () => {
  const updatesJs = fs.readFileSync('web/ui-feat-updates.js', 'utf8');
  const sandbox = {
    document: {
      querySelector: (sel) => (sel === 'meta[name="app-version"]' ? { getAttribute: () => '3.19.0' } : null),
      getElementById: () => null
    },
    localStorage: { getItem: () => '', setItem: () => {} }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(updatesJs, sandbox);

  assert.equal(sandbox.getInstalledAppVersion(), '3.19.0');
  assert.equal(sandbox.compareSemver('3.19.0', '3.20.0'), -1);
  assert.equal(sandbox.compareSemver('3.19.0', 'v3.19'), 0);
  assert.equal(sandbox.compareSemver('3.20.0', '3.19.9'), 1);
  assert.equal(sandbox.compareSemver('3.19.0', '3.19.1'), -1);
  assert.equal(sandbox.compareSemver('invalid', '3.20.0'), 0);

  const same = sandbox.evaluateRemoteVersion('3.19.0', { version: '3.19.0', minSupportedVersion: '3.19.0' });
  assert.equal(same.hasUpdate, false);
  assert.equal(same.forceUpdate, false);

  const soft = sandbox.evaluateRemoteVersion('3.19.0', {
    version: '3.20.0',
    minSupportedVersion: '3.19.0',
    releaseTitle: 'Wave v3.20',
    notes: ['Fitur A', 'Perbaikan B'],
    androidUrl: 'https://github.com/LiandiMiko/mykeuangan/releases/latest'
  });
  assert.equal(soft.hasUpdate, true);
  assert.equal(soft.forceUpdate, false);
  assert.equal(soft.latestVersion, '3.20.0');
  assert.equal(soft.notes.length, 2);

  const forced = sandbox.evaluateRemoteVersion('3.19.0', {
    version: '3.21.0',
    minSupportedVersion: '3.20.0',
    androidUrl: 'javascript:alert(1)'
  });
  assert.equal(forced.hasUpdate, true);
  assert.equal(forced.forceUpdate, true);
  assert.equal(forced.androidUrl, 'https://github.com/LiandiMiko/mykeuangan/releases/latest');

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const buildMjs = fs.readFileSync('build.mjs', 'utf8');
  const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
  const swJs = fs.readFileSync('web/sw.js', 'utf8');
  const updatesHtml = fs.readFileSync('src/updates.html', 'utf8');
  const nativeBridgeJs = fs.readFileSync('web/native-bridge.js', 'utf8');
  const featHooksJs = fs.readFileSync('web/ui-feat-hooks.js', 'utf8');
  const androidYml = fs.readFileSync('.github/workflows/android-build.yml', 'utf8');

  assert.match(pkg.appUpdate.androidUrl, /^https:\/\//);
  assert.match(buildMjs, /version\.json/);
  assert.match(buildMjs, /app-version/);
  assert.match(indexHtml, /https:\/\/liandimiko\.github\.io/);
  assert.match(indexHtml, /name="app-version"/);
  assert.match(swJs, /\/version\.json/);
  assert.match(updatesHtml, /btnCheckAppUpdate/);
  assert.match(updatesHtml, /remoteUpdateBanner/);
  assert.match(nativeBridgeJs, /__mkForceUpdateActive/);
  assert.match(featHooksJs, /checkRemoteAppUpdate/);
  assert.match(androidYml, /contents:\s*write/);
  assert.match(androidYml, /branches:\s*\r?\n\s*-\s*main/);
  assert.match(androidYml, /concurrency:/);
  assert.match(androidYml, /refs\/heads\/main/);
  assert.match(androidYml, /publish_release/);
  assert.match(androidYml, /gh release/);
  assert.match(androidYml, /actions\/cache\/restore@v4/);
  assert.match(androidYml, /actions\/cache\/save@v4/);
  assert.match(androidYml, /android-debug-keystore-v1/);
  assert.match(androidYml, /debug\.keystore/);
  assert.match(androidYml, /RELEASE_APKS/);
});

test('wave v3.19.1 scopes SweetAlert2 bottom-sheet animations to show/hide states and adds Back fallback', () => {
  const stylesHtml = fs.readFileSync('src/styles.html', 'utf8');
  const nativeBridgeJs = fs.readFileSync('web/native-bridge.js', 'utf8');
  const indexHtml = fs.readFileSync('src/Index.html', 'utf8');

  assert.match(indexHtml, /meta\s+name="app-version"\s+content="3\.20.15"/);
  const baseSheetRule = stylesHtml.match(/\.swal2-container\.swal2-center\s*>\s*\.swal2-popup:not\(\.swal2-toast\)\s*\{([^}]*)\}/);
  assert.ok(baseSheetRule, 'expected base bottom-sheet rule in src/styles.html');
  assert.doesNotMatch(baseSheetRule[1], /\banimation\s*:/, 'base bottom-sheet rule must not unconditionally lock animation');

  assert.match(stylesHtml, /\.swal2-container\.swal2-center\s*>\s*\.swal2-popup\.swal2-show:not\(\.swal2-toast\)\s*\{[^}]*mkSheetUp/);
  assert.match(stylesHtml, /\.swal2-container\.swal2-center\s*>\s*\.swal2-popup\.swal2-hide:not\(\.swal2-toast\)\s*\{[^}]*mkSheetDown/);
  assert.match(stylesHtml, /@keyframes mkSheetDown/);
  assert.match(stylesHtml, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.swal2-popup\.swal2-show:not\(\.swal2-toast\)[\s\S]*?\.swal2-popup\.swal2-hide:not\(\.swal2-toast\)\s*\{\s*animation:\s*none\s*!important;/);
  assert.match(nativeBridgeJs, /popup\.classList\.contains\('swal2-hide'\)/);
});
