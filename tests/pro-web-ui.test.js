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
  assert.match(indexHtml, /data-action="openCommandPalette"/);
  assert.match(indexHtml, /showPwaUpdateToast/);
  assert.match(buildMjs, /finance-pro\.js/);
});

test('dashboard provides 1-line quick add form and quick template container', () => {
  assert.match(dashboardHtml, /id="quickAddCard"/);
  assert.match(dashboardHtml, /id="quickAddInput"/);
  assert.match(dashboardHtml, /id="quickAddPreview"/);
  assert.match(dashboardHtml, /id="quickTemplateChips"/);
  assert.match(dashboardHtml, /data-action="openQuickTemplatesModal"/);
});

test('laporan, histori, aset, and ai views wire grouped menus, bulk actions, tags, and calculators', () => {
  assert.match(laporanHtml, /id="lapImportMenu"/);
  assert.match(laporanHtml, /id="lapExportMenu"/);
  assert.match(laporanHtml, /id="lapBulkBar"/);
  assert.match(laporanHtml, /id="lapSelectAll"/);
  assert.match(laporanHtml, /id="lapTagBar"/);
  assert.match(laporanHtml, /data-action="openAnnualRecapModal"/);
  assert.match(historiHtml, /id="historiTagBar"/);
  assert.match(asetHtml, /data-action="openFinancialCalculatorsModal"/);
  assert.match(aiHtml, /data-action="openFinancialCalculatorsModal"/);
  assert.match(aiHtml, /data-action="clearAiChatHistory"/);
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
  assert.match(formHtml, /data-action=\"addQuickNominalAmount\" data-args='\[25000\]'/);
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
  assert.match(dashboardHtml, /data-action="showNetWorthInfo"/);
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
  assert.match(indexHtml, /id="navUpdatesVersion"[^>]*>v3.20.10</);
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
  assert.match(uiFeatOfflineJs, /IDB_VERSION\s*=\s*3/);
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
  assert.match(updatesHtml, /data-latest-release="2026-11-28-v3.20.10"/);
  // Jumlah rilis dihitung dari kartu yang ada (bukan hardcode) — tiap rilis
  // baru menambah kartu, dan label statis harus cocok dengan hitungan runtime.
  const releaseCardCount = (updatesHtml.match(/data-release-card/g) || []).length;
  assert.match(updatesHtml, new RegExp(`Menampilkan ${releaseCardCount} rilis`));
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
    state: '',
    error: ''
  });
  assert.deepEqual({ ...webSandbox.parseOAuthCallbackParams('com.mykeuguech.app://auth-callback#access_token=at_1&refresh_token=rt_2') }, {
    code: '',
    accessToken: 'at_1',
    refreshToken: 'rt_2',
    state: '',
    error: ''
  });
  assert.deepEqual({ ...webSandbox.parseOAuthCallbackParams('com.mykeuguech.app://auth-callback?error=access_denied&error_description=User%20cancelled') }, {
    code: '',
    accessToken: '',
    refreshToken: '',
    state: '',
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
  // Wave 3.4 / S25: fetch vendor berjalan JUGA di PR — langkah fetch tidak
  // boleh digate ke non-PR, dan harus jalan SEBELUM build PR, supaya PR
  // memverifikasi artefak yang sama dengan yang di-deploy.
  const fetchStep = deployYml.match(/- name: Fetch self-hosted vendor assets[\s\S]*?(?=\n      - name:|\n  deploy:|\n$)/);
  assert.ok(fetchStep, 'langkah fetch vendor harus ada di deploy.yml');
  assert.doesNotMatch(fetchStep[0], /^\s*if:/m, 'langkah fetch vendor tidak boleh digate (harus jalan di PR juga)');
  assert.ok(deployYml.indexOf('Fetch self-hosted vendor assets') < deployYml.indexOf('Build dist (PR check)'), 'fetch vendor harus jalan SEBELUM build PR');

  assert.match(buildMjs, /native-bridge\.js/);
  assert.match(buildMjs, /rewriteLocalVendorTags/);
  // Wave 3.4 / S24–S25: tidak ada lagi fallback CDN diam-diam.
  assert.doesNotMatch(buildMjs, /document\.write/, 'build tidak boleh lagi memakai document.write (fallback Supabase dihapus)');
  assert.doesNotMatch(buildMjs, /SUPABASE_JS_FALLBACK/, 'konstanta fallback CDN Supabase sudah dihapus');
  assert.match(buildMjs, /verifyRequiredVendorFiles/, 'build harus memverifikasi vendor di awal (gerbang vendor)');
  assert.match(buildMjs, /verifyAllVendors/, 'build harus memakai verifikasi hash dari fetch-vendors.mjs');
  const fetchVendorsMjs = fs.readFileSync('scripts/fetch-vendors.mjs', 'utf8');
  assert.match(fetchVendorsMjs, /sha256/, 'manifest vendor harus membawa hash sha256 (verifikasi)');
  assert.match(fetchVendorsMjs, /sha384/, 'manifest vendor harus membawa hash sha384 (SRI)');
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
  assert.equal(pkg.version, '3.20.10');
  assert.ok(pkg.dependencies && pkg.dependencies['@capacitor/core']);
  assert.ok(pkg.scripts && pkg.scripts['cap:sync'] && pkg.scripts['vendors:fetch']);
});

test('wave v3.17 normalizes category matching across budgeting, forms, reports, telegram bot, and SQL migration', () => {
  const uiBudgetJs = fs.readFileSync('web/ui-budget.js', 'utf8');
  const uiReportsJs = fs.readFileSync('web/ui-reports.js', 'utf8');
  const uiStateJs = fs.readFileSync('web/ui-state.js', 'utf8');
  const uiRecurringJs = fs.readFileSync('web/ui-recurring.js', 'utf8');
  const supabaseRecordsJs = fs.readFileSync('web/supabase-records.js', 'utf8');
  const supabasePlanningJs = fs.readFileSync('web/supabase-planning.js', 'utf8');
  const botCoreTs = fs.readFileSync('supabase/functions/telegram-bot/core.ts', 'utf8');
  const botAiTs = fs.readFileSync('supabase/functions/telegram-bot/ai.ts', 'utf8');
  const botCommandsTs = fs.readFileSync('supabase/functions/telegram-bot/commands.ts', 'utf8');
  const botPlanningTs = fs.readFileSync('supabase/functions/telegram-bot/planning.ts', 'utf8');
  const botJobsTs = fs.readFileSync('supabase/functions/telegram-bot/jobs.ts', 'utf8');
  const migrationSql = fs.readFileSync('supabase/migrations/20261125000000_normalize_categories_and_search.sql', 'utf8');

  assert.match(uiBudgetJs, /normalizeBudgetCatKey/);
  assert.match(uiBudgetJs, /buildUnbudgetedSectionHtml/);
  assert.match(uiBudgetJs, /__unbudgeted__/);
  assert.match(uiFormJs, /selectCategorySafely/);
  assert.match(uiFormJs, /cleanName/);
  assert.match(uiReportsJs, /defaultWalletId/);
  assert.match(uiReportsJs, /normCat/);
  assert.match(uiStateJs, /fromKey/);
  assert.match(uiRecurringJs, /curKey/);
  assert.match(supabaseRecordsJs, /cleanTipe\s*=\s*String\(tipe\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(supabasePlanningJs, /normCat\(/);

  assert.match(botCoreTs, /export const normalizeCatKey/);
  assert.match(botCoreTs, /export async function resolveUserCategory/);
  assert.match(botAiTs, /normalizeCatKey/);
  assert.match(botCommandsTs, /resolveUserCategory/);
  assert.match(botPlanningTs, /normalizeCatKey/);
  assert.match(botJobsTs, /normalizeCatKey/);

  assert.match(migrationSql, /lower\(btrim\(t\.kategori\)\)\s*=\s*lower\(btrim\(p_category\)\)/);
  assert.match(migrationSql, /default_wallet/);
  assert.match(migrationSql, /rename_category_with_transactions/);
  assert.match(migrationSql, /on conflict \(user_id, kategori, bulan\)/);
});

test('wave v3.18 configures cloud Android CI, Play Store release kit, gradle patch fixes, and budgeting/bot upgrades', () => {
  const androidBuildYml = fs.readFileSync('.github/workflows/android-build.yml', 'utf8');
  const patchScript = fs.readFileSync('scripts/patch-android-project.mjs', 'utf8');
  const playAssetsScript = fs.readFileSync('scripts/generate-playstore-assets.mjs', 'utf8');
  const listingKit = fs.readFileSync('docs/PLAYSTORE_LISTING_KIT.md', 'utf8');
  const playGuide = fs.readFileSync('docs/ANDROID_PLAYSTORE_GUIDE.md', 'utf8');
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  const uiBudgetJs = fs.readFileSync('web/ui-budget.js', 'utf8');
  const botPlanningTs = fs.readFileSync('supabase/functions/telegram-bot/planning.ts', 'utf8');
  const botCommandsTs = fs.readFileSync('supabase/functions/telegram-bot/commands.ts', 'utf8');
  const botIndexTs = fs.readFileSync('supabase/functions/telegram-bot/index.ts', 'utf8');

  assert.match(androidBuildYml, /platforms;android-36/);
  assert.match(androidBuildYml, /java-version:\s*21/);
  assert.match(androidBuildYml, /assembleDebug/);
  assert.match(androidBuildYml, /bundleRelease/);
  assert.match(androidBuildYml, /playstore:assets/);
  assert.match(androidBuildYml, /ANDROID_KEYSTORE_BASE64/);
  assert.match(androidBuildYml, /rm -f android\/mykeuguech-upload\.jks/);
  assert.doesNotMatch(androidBuildYml, /cache:\s*['"]?npm['"]?/);
  assert.doesNotMatch(androidBuildYml, /android-actions\/setup-android@v[1-3]/);
  assert.match(androidBuildYml, /assembleRelease/);
  assert.match(androidBuildYml, /setup-gradle@v4/);
  assert.match(androidBuildYml, /GITHUB_STEP_SUMMARY/);
  assert.match(androidBuildYml, /MyKeuGuech-v/);

  const buildAndroidMjs = fs.readFileSync('scripts/build-android.mjs', 'utf8');
  const pkgScripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts || {};
  const nativeBridgeJs = fs.readFileSync('web/native-bridge.js', 'utf8');
  assert.match(buildAndroidMjs, /assembleDebug/);
  assert.match(buildAndroidMjs, /assembleRelease/);
  assert.match(buildAndroidMjs, /bundleRelease/);
  assert.ok(pkgScripts['cap:apk'] && pkgScripts['cap:apk:release'] && pkgScripts['cap:aab']);
  assert.match(pkgScripts['cap:assets'], /capacitor-assets/);
  assert.match(gitignore, /release\//);
  assert.match(nativeBridgeJs, /getLaunchUrl/);
  assert.match(nativeBridgeJs, /lastHandledOAuthUrl/);

  assert.match(patchScript, /withInputStream/);
  assert.match(patchScript, /rootProject\.file\(keystoreProps\.getProperty\("storeFile"\)\)/);
  assert.doesNotMatch(patchScript, /new FileInputStream/);

  assert.match(playAssetsScript, /icon-512\.png/);
  assert.match(playAssetsScript, /feature-graphic-1024x500\.png/);
  assert.match(gitignore, /playstore-assets\//);

  assert.match(listingKit, /https:\/\/liandimiko\.github\.io\/mykeuangan\/privacy\.html/);
  assert.match(listingKit, /https:\/\/liandimiko\.github\.io\/mykeuangan\/delete-account\.html/);
  assert.match(listingKit, /Data Safety/);
  assert.match(listingKit, /Financial Features Declaration/);
  assert.match(playGuide, /android-build\.yml/);
  assert.match(playGuide, /PLAYSTORE_LISTING_KIT\.md/);

  assert.match(uiBudgetJs, /data-unbudgeted-create-cat/);
  assert.match(uiBudgetJs, /data-unbudgeted-suggested/);
  assert.match(botPlanningTs, /function budgetBar/);
  assert.match(botPlanningTs, /Di luar budget:/);
  assert.match(botCommandsTs, /export async function handleCari/);
  assert.match(botIndexTs, /cari\|search/);
});
