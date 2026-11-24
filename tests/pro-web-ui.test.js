const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
const dashboardHtml = fs.readFileSync('src/dashboard.html', 'utf8');
const laporanHtml = fs.readFileSync('src/laporan.html', 'utf8');
const historiHtml = fs.readFileSync('src/histori.html', 'utf8');
const asetHtml = fs.readFileSync('src/aset.html', 'utf8');
const aiHtml = fs.readFileSync('src/ai.html', 'utf8');
const formHtml = fs.readFileSync('src/form.html', 'utf8');
const budgetingHtml = fs.readFileSync('src/budgeting.html', 'utf8');
const adminHtml = fs.readFileSync('src/admin.html', 'utf8');
const i18nHtml = fs.readFileSync('src/i18n.html', 'utf8');
const manifestJson = fs.readFileSync('web/manifest.webmanifest', 'utf8');
const tailwindConfigJs = fs.readFileSync('tailwind.config.js', 'utf8');
const uiFormJs = fs.readFileSync('web/ui-form.js', 'utf8');
const uiAdminJs = fs.readFileSync('web/ui-admin.js', 'utf8');
const uiExportJs = fs.readFileSync('web/ui-export.js', 'utf8');
const uiProPaletteJs = fs.readFileSync('web/ui-pro-palette.js', 'utf8');
const stylesHtml = fs.readFileSync('src/styles.html', 'utf8');
const buildMjs = fs.readFileSync('build.mjs', 'utf8');

test('index includes features-v35, mobile bottom nav, command palette trigger, and SW toast hook', () => {
  assert.match(indexHtml, /id="mobileBottomNav"/);
  assert.match(indexHtml, /include\('features-v35'\)/);
  assert.match(indexHtml, /openCommandPalette\(\)/);
  assert.match(indexHtml, /showPwaUpdateToast/);
  assert.match(buildMjs, /finance-pro\.js/);
});

test('dashboard provides 1-line quick add form and quick template container', () => {
  assert.match(dashboardHtml, /id="quickAddCard"/);
  assert.match(dashboardHtml, /id="quickAddInput"/);
  assert.match(dashboardHtml, /id="quickAddPreview"/);
  assert.match(dashboardHtml, /id="quickTemplateChips"/);
  assert.match(dashboardHtml, /openQuickTemplatesModal\(\)/);
});

test('laporan, histori, aset, and ai views wire grouped menus, bulk actions, tags, and calculators', () => {
  assert.match(laporanHtml, /id="lapImportMenu"/);
  assert.match(laporanHtml, /id="lapExportMenu"/);
  assert.match(laporanHtml, /id="lapBulkBar"/);
  assert.match(laporanHtml, /id="lapSelectAll"/);
  assert.match(laporanHtml, /id="lapTagBar"/);
  assert.match(laporanHtml, /openAnnualRecapModal\(\)/);
  assert.match(historiHtml, /id="historiTagBar"/);
  assert.match(asetHtml, /openFinancialCalculatorsModal\(\)/);
  assert.match(aiHtml, /openFinancialCalculatorsModal\(\)/);
  assert.match(aiHtml, /clearAiChatHistory\(\)/);
});

test('mobile bottom nav, responsive dropdowns, and Phosphor v2 icons use valid cohesive syntax', () => {
  const invalidIconPattern = /\bph-[a-z0-9-]+-(bold|fill|duotone|light|thin)\b/;
  const srcFiles = fs.readdirSync('src').filter((name) => name.endsWith('.html'));
  srcFiles.forEach((name) => {
    const html = fs.readFileSync(`src/${name}`, 'utf8');
    assert.doesNotMatch(html, invalidIconPattern, `${name} contains invalid Phosphor icon weight suffix`);
  });

  const navMatch = indexHtml.match(/<nav id="mobileBottomNav"[\s\S]*?<\/nav>/);
  assert.ok(navMatch, 'expected #mobileBottomNav markup');
  assert.match(navMatch[0], /grid-cols-5/);
  assert.match(navMatch[0], /id="mobileFabBtn"[\s\S]*?ph-bold ph-plus/);
  assert.match(laporanHtml, /left-0 sm:left-auto sm:right-0/);
  assert.match(formHtml, /id="tr_kategori"[^>]*min-w-0/);
  assert.match(dashboardHtml, /xl:grid-cols-12/);
  assert.match(dashboardHtml, /no-scrollbar/);
  assert.match(dashboardHtml, /id="dash-saldo-aktif"/);
  assert.match(dashboardHtml, /id="dash-cash-in"/);
  assert.match(dashboardHtml, /id="dash-cash-out"/);
  assert.match(laporanHtml, /id="list-laporan-mobile"/);
  assert.match(laporanHtml, /id="lapSelectAllMobile"/);
  assert.match(indexHtml, /id="networkStatusPill"/);
  assert.match(indexHtml, /a11y\.skip_main/);
  assert.match(formHtml, /addQuickNominalAmount\(/);
  assert.match(budgetingHtml, /id="budgetForecastCard"/);
  assert.match(uiProPaletteJs, /ArrowDown/);
  assert.match(uiProPaletteJs, /Enter/);
  assert.match(stylesHtml, /crossorigin="anonymous"/);
});

test('wave v3.13 enforces MyKeuGuech branding, mobile-native polish, motion tokens, and WCAG controls', () => {
  assert.match(manifestJson, /"short_name":\s*"MyKeuGuech"/);
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(indexHtml, /interactive-widget=resizes-content/);
  assert.match(indexHtml, /MyKeuGuech/);
  assert.match(uiExportJs, /MyKeuGuech/);

  assert.match(tailwindConfigJs, /hoverOnlyWhenSupported:\s*true/);
  assert.match(stylesHtml, /hoverOnlyWhenSupported:\s*true/);
  assert.match(stylesHtml, /--ease-out:/);
  assert.match(stylesHtml, /\.mk-toast\[data-open="true"\]/);
  assert.match(stylesHtml, /prefers-reduced-transparency:\s*reduce/);
  assert.match(stylesHtml, /prefers-reduced-motion:\s*reduce/);

  assert.match(dashboardHtml, /id="heroHideNominalBtn"/);
  assert.match(dashboardHtml, /showNetWorthInfo\(\)/);
  assert.match(formHtml, /novalidate/);
  assert.match(formHtml, /for="tr_nominal"/);
  assert.match(uiFormJs, /setFormFieldError/);
  assert.match(uiFormJs, /Hapus Transaksi\?/);

  assert.match(historiHtml, /id="historiResetFilterBtn"/);
  assert.match(laporanHtml, /id="lapResetFilterBtn"/);
  assert.match(adminHtml, /id="adm-user-mobile-list"/);
  assert.match(uiAdminJs, /buildAdminUserMobileCardHtml/);
  assert.doesNotMatch(i18nHtml, /\/\/\s*Placeholder\b/);
  assert.match(uiProPaletteJs, /previousFocusEl/);
});

test('wave v3.14 hardens frontend exports, SW precache, backup restore, bot timeouts, and CI workflow', () => {
  const uiDashboardJs = fs.readFileSync('web/ui-dashboard.js', 'utf8');
  const uiFeatHooksJs = fs.readFileSync('web/ui-feat-hooks.js', 'utf8');
  const uiProHooksJs = fs.readFileSync('web/ui-pro-hooks.js', 'utf8');
  const uiShellJs = fs.readFileSync('web/ui-shell.js', 'utf8');
  const supabaseAuthJs = fs.readFileSync('web/supabase-auth.js', 'utf8');
  const uiAssetsJs = fs.readFileSync('web/ui-assets.js', 'utf8');
  const uiFeatChartsJs = fs.readFileSync('web/ui-feat-charts.js', 'utf8');
  const uiFeatAiJs = fs.readFileSync('web/ui-feat-ai.js', 'utf8');
  const uiAssetOpsJs = fs.readFileSync('web/ui-asset-ops.js', 'utf8');
  const uiProQuickJs = fs.readFileSync('web/ui-pro-quick.js', 'utf8');
  const uiFeatOfflineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
  const uiFeatUpdatesJs = fs.readFileSync('web/ui-feat-updates.js', 'utf8');
  const uiFeatBackupJs = fs.readFileSync('web/ui-feat-backup.js', 'utf8');
  const swJs = fs.readFileSync('web/sw.js', 'utf8');
  const updatesHtml = fs.readFileSync('src/updates.html', 'utf8');
  const botCoreTs = fs.readFileSync('supabase/functions/telegram-bot/core.ts', 'utf8');
  const botIndexTs = fs.readFileSync('supabase/functions/telegram-bot/index.ts', 'utf8');
  const botAiTs = fs.readFileSync('supabase/functions/telegram-bot/ai.ts', 'utf8');
  const botJobsTs = fs.readFileSync('supabase/functions/telegram-bot/jobs.ts', 'utf8');
  const deployYml = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');

  assert.match(uiDashboardJs, /buildEmptyTxPlaceholder\s*[\n,}]/);
  assert.match(uiFeatHooksJs, /mkCommandPalette/);
  assert.match(uiProHooksJs, /mkCommandPalette/);
  assert.match(uiProHooksJs, /offline_failed/);
  assert.match(uiShellJs, /prefers-reduced-motion:\s*reduce/);
  assert.match(uiShellJs, /\.toUpperCase\(\)/);
  assert.match(supabaseAuthJs, /mk_last_market_refresh_ts/);
  assert.match(uiAssetsJs, /placeholder\.style\.display\s*=\s*'flex'/);
  assert.match(uiAssetsJs, /prefers-reduced-motion:\s*reduce/);
  assert.match(uiFeatChartsJs, /window\.innerWidth\s*<\s*640/);
  assert.doesNotMatch(uiFeatAiJs, /runAiFinancialChat/);

  assert.match(uiAssetOpsJs, /bindNominalInputs/);
  assert.match(uiAssetOpsJs, /parseFormattedNominal/);
  assert.match(uiProQuickJs, /id="tpl-wallet"/);
  assert.match(uiProQuickJs, /syncTemplateCategorySelect/);
  assert.match(uiFeatOfflineJs, /MAX_OFFLINE_RETRIES/);
  assert.match(uiFeatOfflineJs, /retryFailedOfflineItems/);
  assert.match(uiFeatOfflineJs, /discardFailedOfflineItems/);
  assert.match(uiFeatUpdatesJs, /offline:failed/);

  assert.match(swJs, /icon-512\.png/);
  assert.match(swJs, /icon-maskable\.png/);
  assert.match(swJs, /\.then\(\(\)\s*=>\s*self\.clients\.claim\(\)\)/);
  assert.match(swJs, /const htmlCacheKey\s*=\s*'\.\/index\.html'/);

  assert.match(uiFeatBackupJs, /version:\s*'3\.14'/);
  assert.match(uiFeatBackupJs, /api_saveDebtDueDates/);
  assert.doesNotMatch(uiFeatBackupJs, /🖨️/);
  assert.match(indexHtml, /id="navUpdatesVersion"[^>]*>v3\.16</);
  assert.match(updatesHtml, /datetime="2026-11-23"/);

  assert.match(botCoreTs, /AbortSignal\.timeout/);
  assert.match(botCoreTs, /gteFilter/);
  assert.match(botIndexTs, /MyKeuGuech Bot/);
  assert.doesNotMatch(botIndexTs, /MyKeuanganGuech/);
  assert.match(botAiTs, /web MyKeuGuech/);
  assert.match(botAiTs, /AbortSignal\.timeout/);
  assert.match(botJobsTs, /POL:\s*'polygon-ecosystem-token'/);
  assert.match(botJobsTs, /SUI:\s*'sui'/);
  assert.match(botJobsTs, /cutoff366/);

  assert.match(deployYml, /\bverify:/);
  assert.match(deployYml, /\bdeploy:/);
  assert.match(deployYml, /needs:\s*verify/);
  assert.match(deployYml, /node-version:\s*22/);
  assert.match(deployYml, /actions\/configure-pages@v5/);
  assert.match(deployYml, /actions\/upload-pages-artifact@v4/);
  assert.ok(
    deployYml.indexOf('actions/upload-pages-artifact@v4') > 0 &&
      deployYml.indexOf('actions/upload-pages-artifact@v4') < deployYml.indexOf('\n  deploy:'),
    'upload-pages-artifact@v4 must run in verify before deploy job'
  );
  assert.match(deployYml, /artifact_name:\s*\$\{\{\s*needs\.verify\.outputs\.pages_artifact\s*\}\}/);
  assert.match(deployYml, /pages:\s*write/);
  assert.match(deployYml, /id-token:\s*write/);
});

test('wave v3.15 hardens offline read cache, PIN lockout/auto-lock, delete account UI, and audit fixes', () => {
  const uiFeatOfflineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
  const uiFeatCacheJs = fs.readFileSync('web/ui-feat-cache.js', 'utf8');
  const uiShellJs = fs.readFileSync('web/ui-shell.js', 'utf8');
  const uiStateJs = fs.readFileSync('web/ui-state.js', 'utf8');
  const uiFeatAccountJs = fs.readFileSync('web/ui-feat-account.js', 'utf8');
  const supabaseAdminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
  const supabaseRecordsJs = fs.readFileSync('web/supabase-records.js', 'utf8');
  const uiExportJs = fs.readFileSync('web/ui-export.js', 'utf8');
  const uiReportsJs = fs.readFileSync('web/ui-reports.js', 'utf8');
  const swJs = fs.readFileSync('web/sw.js', 'utf8');
  const updatesHtml = fs.readFileSync('src/updates.html', 'utf8');

  assert.match(uiFeatOfflineJs, /offline_snapshot/);
  assert.match(uiFeatOfflineJs, /IDB_VERSION\s*=\s*2/);
  assert.match(uiFeatCacheJs, /saveOfflineSnapshot/);
  assert.match(uiFeatCacheJs, /loadOfflineSnapshot/);
  assert.match(uiFeatCacheJs, /mergeQueuedOfflineTx/);
  assert.match(uiShellJs, /loadOfflineSnapshot/);
  assert.match(uiShellJs, /showOfflineCacheBanner/);
  assert.match(uiStateJs, /saveOfflineSnapshot/);

  assert.match(uiFeatAccountJs, /MAX_PIN_ATTEMPTS/);
  assert.match(uiFeatAccountJs, /promptVerifyCurrentPin/);
  assert.match(uiFeatAccountJs, /AUTO_LOCK_IDLE_MS/);
  assert.match(uiFeatAccountJs, /deleteOwnAccountFlow/);
  assert.match(supabaseAdminJs, /api_deleteOwnAccount/);

  assert.match(supabaseRecordsJs, /tx\.keterangan\s*\|\|\s*''\)\.trim\(\)\.toLocaleLowerCase\(\)/);
  assert.match(uiExportJs, /cat\.startsWith\('Utang'\)/);
  assert.match(uiReportsJs, /template-transaksi-mykeuguech\.csv/);
  assert.doesNotMatch(uiReportsJs, /template-transaksi-mykeuangan\.csv/);
  assert.match(swJs, /targetCacheKey/);
  assert.match(updatesHtml, /data-latest-release="2026-11-25-v3\.16"/);
  assert.match(updatesHtml, /Menampilkan 17 rilis/);
});

test('wave v3.16 bundles self-hosted offline vendors, native Capacitor 8 Android bridge, and config fixes', () => {
  const nativeBridgeJs = fs.readFileSync('web/native-bridge.js', 'utf8');
  const webSandbox = { console, document: null };
  webSandbox.window = webSandbox;
  vm.runInNewContext(nativeBridgeJs, webSandbox);
  assert.equal(webSandbox.isNativeApp(), false);
  assert.equal(webSandbox.getNativePlatform(), 'web');
  assert.equal(webSandbox.NATIVE_AUTH_REDIRECT_URL, 'com.mykeuguech.app://auth-callback');
  assert.deepEqual({ ...webSandbox.parseOAuthCallbackParams('com.mykeuguech.app://auth-callback?code=pkce_123') }, {
    code: 'pkce_123',
    accessToken: '',
    refreshToken: '',
    error: ''
  });
  assert.deepEqual({ ...webSandbox.parseOAuthCallbackParams('com.mykeuguech.app://auth-callback#access_token=at_1&refresh_token=rt_2') }, {
    code: '',
    accessToken: 'at_1',
    refreshToken: 'rt_2',
    error: ''
  });
  assert.deepEqual({ ...webSandbox.parseOAuthCallbackParams('com.mykeuguech.app://auth-callback?error=access_denied&error_description=User%20cancelled') }, {
    code: '',
    accessToken: '',
    refreshToken: '',
    error: 'User cancelled'
  });

  const nativeClassAdded = [];
  const nativeListeners = [];
  const nativeSandbox = {
    console,
    document: {
      documentElement: {
        classList: {
          add: (...cls) => nativeClassAdded.push(...cls),
          contains: () => false
        }
      },
      addEventListener: () => {}
    },
    localStorage: { getItem: () => 'light' },
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { App: { addListener: (ev) => nativeListeners.push(ev) } }
    }
  };
  nativeSandbox.window = nativeSandbox;
  vm.runInNewContext(nativeBridgeJs, nativeSandbox);
  assert.equal(nativeSandbox.isNativeApp(), true);
  assert.equal(nativeSandbox.getNativePlatform(), 'android');
  assert.ok(nativeClassAdded.includes('mk-native-app'));
  assert.ok(nativeClassAdded.includes('mk-platform-android'));
  assert.deepEqual(nativeListeners, ['backButton', 'appUrlOpen']);

  [
    'scripts/fetch-vendors.mjs',
    'scripts/prepare-native-assets.mjs',
    'scripts/patch-android-project.mjs',
    'capacitor.config.json',
    'docs/ANDROID_PLAYSTORE_GUIDE.md'
  ].forEach((file) => assert.ok(fs.existsSync(file), `${file} must exist`));

  const capCfg = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
  assert.equal(capCfg.appId, 'com.mykeuguech.app');
  assert.equal(capCfg.webDir, 'dist');
  assert.equal(capCfg.server.androidScheme, 'https');
  assert.equal(capCfg.plugins.SystemBars.insetsHandling, 'css');

  const patchScript = fs.readFileSync('scripts/patch-android-project.mjs', 'utf8');
  assert.match(patchScript, /targetSdkVersion = 36/);
  assert.match(patchScript, /compileSdkVersion = 36/);
  assert.match(patchScript, /android:allowBackup="false"/);

  const deleteHtml = fs.readFileSync('web/delete-account.html', 'utf8');
  assert.match(deleteHtml, /window\.APP_CONFIG/);
  assert.match(deleteHtml, /SUPABASE_URL/);

  const deployYml = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.match(deployYml, /window\.APP_CONFIG/);
  assert.match(deployYml, /scripts\/fetch-vendors\.mjs/);

  assert.match(buildMjs, /native-bridge\.js/);
  assert.match(buildMjs, /rewriteLocalVendorTags/);
  assert.match(fs.readFileSync('web/sw.js', 'utf8'), /__VENDOR_ASSETS__/);
  assert.match(indexHtml, /isCapNative/);
  assert.match(stylesHtml, /--safe-area-inset-top/);
  assert.match(stylesHtml, /--safe-area-inset-bottom/);
  assert.match(stylesHtml, /\.mk-native-app #pwaInstallWrap/);
  assert.match(fs.readFileSync('web/ui-export.js', 'utf8'), /saveOrShareFile/);
  assert.match(fs.readFileSync('web/ui-feat-backup.js', 'utf8'), /saveOrShareFile/);
  assert.match(fs.readFileSync('web/ui-reports.js', 'utf8'), /saveOrShareFile/);
  assert.match(fs.readFileSync('web/supabase-auth.js', 'utf8'), /startNativeOAuth/);
  assert.match(fs.readFileSync('web/supabase-auth.js', 'utf8'), /__mkHandleNativeAuthSession/);
  assert.match(fs.readFileSync('web/ui-feat-account.js', 'utf8'), /localStorage\.getItem\('lang'\) === 'en'/);

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.version, '3.16.0');
  assert.ok(pkg.dependencies && pkg.dependencies['@capacitor/core']);
  assert.ok(pkg.scripts && pkg.scripts['cap:sync'] && pkg.scripts['vendors:fetch']);
});
