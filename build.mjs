// Menggabungkan src/*.html (pengganti <?!= include('x') ?> Apps Script)
// + web/config.js + modul web/*.js  →  dist/index.html
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
const WEB = 'web';
const OUT = 'dist';
const VENDOR_ROOT = path.join(WEB, 'vendor');
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const SUPABASE_JS_FALLBACK = 'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const VENDOR = path.join(VENDOR_ROOT, 'supabase.js');

const WEB_MODULES = [
  'native-bridge.js',
  'finance-analysis-core.js',
  'finance-analysis-ai.js',
  'finance-analysis-portfolio.js',
  'finance-analysis-backup.js',
  'finance-analysis.js',
  'finance-pro.js',
  'transaction-import.js'
];

const UI_CORE_MODULES = [
  'ui-state.js',
  'ui-shell.js',
  'ui-dashboard.js',
  'ui-calendar.js',
  'ui-assets.js',
  'ui-asset-ops.js',
  'ui-debts.js',
  'ui-wallets.js',
  'ui-form.js',
  'ui-reports.js',
  'ui-export.js',
  'ui-budget.js',
  'ui-recurring.js',
  'ui-admin.js',
  'ui-ai.js'
];

const UI_FEATURES_MODULES = [
  'ui-feat-offline.js',
  'ui-feat-cache.js',
  'ui-feat-ai.js',
  'ui-feat-charts.js',
  'ui-feat-updates.js',
  'ui-feat-modals.js',
  'ui-feat-analytics.js',
  'ui-feat-backup.js',
  'ui-feat-account.js',
  'ui-feat-recurring.js',
  'ui-feat-hooks.js'
];

const UI_PRO_MODULES = [
  'ui-pro-quick.js',
  'ui-pro-palette.js',
  'ui-pro-reports.js',
  'ui-pro-insights.js',
  'ui-pro-hooks.js'
];

const SUPABASE_MODULES = [
  'supabase-core.js',
  'supabase-auth-ui.js',
  'supabase-auth.js',
  'supabase-records.js',
  'supabase-planning.js',
  'supabase-portfolio.js',
  'supabase-admin.js',
  'supabase-api.js'
];

const CDN_TO_LOCAL_VENDOR = [
  ['https://cdn.jsdelivr.net/npm/sweetalert2@11.14.5/dist/sweetalert2.all.min.js', 'sweetalert2.all.min.js'],
  ['https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css', 'flatpickr.min.css'],
  ['https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/plugins/monthSelect/style.css', 'monthSelect-style.css'],
  ['https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js', 'flatpickr.min.js'],
  ['https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/plugins/monthSelect/index.js', 'monthSelect-index.js'],
  ['https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/id.js', 'flatpickr-id.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js', 'jspdf.plugin.autotable.min.js'],
  ['https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', 'chart.umd.min.js']
];

function read(name) {
  const file = path.join(SRC, name + '.html');
  if (!fs.existsSync(file)) {
    throw new Error(`File ${file} tidak ditemukan.`);
  }
  return fs.readFileSync(file, 'utf8');
}

function readInlineScripts(files) {
  return files
    .map((f) => `<script>\n${fs.readFileSync(path.join(WEB, f), 'utf8')}\n</script>`)
    .join('\n');
}

function resolveSupabaseTag() {
  if (fs.existsSync(VENDOR) && fs.statSync(VENDOR).size > 0) {
    return '<script src="./vendor/supabase.js"></script>';
  }
  return `<script src="${SUPABASE_JS}" crossorigin="anonymous"></script>\n` +
    `<script>window.supabase || document.write('<script src="${SUPABASE_JS_FALLBACK}" crossorigin="anonymous"><\\/script>')</script>`;
}

function rewriteLocalVendorTags(html) {
  let out = html;
  const interCss = path.join(VENDOR_ROOT, 'inter', 'inter.css');
  if (fs.existsSync(interCss)) {
    out = out.replace(
      /<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter:[^"]*"[^>]*>/i,
      '<link rel="stylesheet" href="./vendor/inter/inter.css">'
    );
  }
  const phWeights = ['regular', 'bold', 'fill'];
  if (phWeights.every((w) => fs.existsSync(path.join(VENDOR_ROOT, 'phosphor', w, 'style.css')))) {
    const links = phWeights.map((w) => `<link rel="stylesheet" href="./vendor/phosphor/${w}/style.css">`).join('\n');
    out = out.replace(/<script[^>]*src="https:\/\/unpkg\.com\/@phosphor-icons\/web@2\.1\.1"[^>]*><\/script>/i, links);
  }
  for (const [cdnUrl, relFile] of CDN_TO_LOCAL_VENDOR) {
    const full = path.join(VENDOR_ROOT, relFile);
    if (fs.existsSync(full) && fs.statSync(full).size > 0) {
      out = out.replaceAll(`${cdnUrl}" crossorigin="anonymous"`, `./vendor/${relFile}"`);
      out = out.replaceAll(cdnUrl, `./vendor/${relFile}`);
    }
  }
  return out;
}

function copyVendorDir(srcDir, dstDir, relBase) {
  if (!fs.existsSync(srcDir)) return [];
  const collected = [];
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'tailwind.min.css') continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    const relPath = `${relBase}/${entry.name}`;
    if (entry.isDirectory()) {
      collected.push(...copyVendorDir(srcPath, dstPath, relPath));
    } else if (entry.isFile()) {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      collected.push(relPath);
    }
  }
  return collected;
}

const HTML_ENTITY_MAP = {
  '&amp;': '&',
  '&times;': '×',
  '&rarr;': '→',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
};

function stripHtmlEntities(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|times|rarr|lt|gt|quot|nbsp|#39);/g, (entity) => HTML_ENTITY_MAP[entity] || entity)
    .replace(/\s+/g, ' ')
    .trim();
}

function parseVersionCode(ver) {
  const m = String(ver || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!m) return 0;
  return Number(m[1] || 0) * 10000 + Number(m[2] || 0) * 100 + Number(m[3] || 0);
}

function extractLatestReleaseMeta(updatesHtml) {
  const releaseMatch = updatesHtml.match(/data-latest-release="([^"]+)"/);
  const articleMatch = updatesHtml.match(/<article\b[^>]*data-release-card[^>]*>([\s\S]*?)<\/article>/i);
  const articleHtml = articleMatch ? articleMatch[1] : '';
  const titleMatch = articleHtml.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i);
  const notes = [];
  for (const rowMatch of articleHtml.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const label = stripHtmlEntities(rowMatch[1]);
    const detail = stripHtmlEntities(rowMatch[2]).split(/(?<=[.!?])\s+/)[0] || '';
    const trimmed = detail.length > 140 ? `${detail.slice(0, 137).trimEnd()}...` : detail;
    if (label && trimmed) notes.push(`${label}: ${trimmed}`);
    else if (label || trimmed) notes.push(label || trimmed);
    if (notes.length >= 4) break;
  }
  return {
    releaseId: releaseMatch ? releaseMatch[1] : '',
    releaseTitle: titleMatch ? stripHtmlEntities(titleMatch[1]) : '',
    notes
  };
}

function buildVersionManifest(pkg, updatesHtml) {
  const appUpdate = (pkg && pkg.appUpdate) || {};
  const meta = extractLatestReleaseMeta(updatesHtml);
  const version = String((pkg && pkg.version) || '1.0.0').trim();
  const minSupportedVersion = String(appUpdate.minSupportedVersion || version).trim();
  return {
    version,
    versionCode: parseVersionCode(version),
    minSupportedVersion,
    releaseId: meta.releaseId,
    releaseTitle: meta.releaseTitle || `MyKeuGuech v${version}`,
    notes: meta.notes,
    androidUrl: String(appUpdate.androidUrl || 'https://github.com/LiandiMiko/mykeuangan/releases/latest').trim(),
    webUrl: String(appUpdate.webUrl || 'https://liandimiko.github.io/mykeuangan/').trim(),
    builtAt: new Date().toISOString()
  };
}

function buildHtmlBundle(config, appVersion) {
  let html = read('Index');
  if (appVersion) {
    html = html.replace(/(<meta\s+name="app-version"\s+content=")[^"]*(")/i, `$1${appVersion}$2`);
  }
  html = html.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, name) => {
    if (name === 'scripts') {
      return `${resolveSupabaseTag()}\n${readInlineScripts(WEB_MODULES)}\n${readInlineScripts(UI_CORE_MODULES)}\n` +
        `<script>\n${config}\n</script>\n${readInlineScripts(SUPABASE_MODULES)}`;
    }
    if (name === 'features-v21') return readInlineScripts(UI_FEATURES_MODULES);
    if (name === 'features-v35') return readInlineScripts(UI_PRO_MODULES);
    return read(name);
  });

  const tailwindVendorPath = path.join(VENDOR_ROOT, 'tailwind.min.css');
  if (fs.existsSync(tailwindVendorPath)) {
    const compiledTailwind = fs.readFileSync(tailwindVendorPath, 'utf8');
    const playCdnRegex = /<script[^>]*src="https:\/\/cdn\.tailwindcss\.com"[^>]*><\/script>\s*<script>\s*tailwind\.config\s*=\s*[\s\S]*?<\/script>/i;
    if (!playCdnRegex.test(html)) {
      throw new Error('Play CDN Tailwind block tidak ditemukan di src/styles.html untuk diganti CSS statis.');
    }
    html = html.replace(playCdnRegex, `<style>\n${compiledTailwind}\n</style>`);
    html = html.replace(
      /(<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*?)(\s*'unsafe-eval')([^"]*?)(\s+https:\/\/cdn\.tailwindcss\.com)([^"]*")/i,
      '$1$3$5'
    );
  }
  html = rewriteLocalVendorTags(html);
  if (/<\?/.test(html)) throw new Error('Masih ada scriptlet Apps Script (<? ... ?>) yang belum diganti.');
  return html;
}

const cfgFile = path.join(WEB, 'config.js');
if (!fs.existsSync(cfgFile)) {
  throw new Error('web/config.js tidak ada. Salin web/config.example.js menjadi web/config.js lalu isi URL dan anon key Supabase.');
}
const config = fs.readFileSync(cfgFile, 'utf8');
if (/GANTI-/.test(config)) throw new Error('web/config.js masih berisi placeholder GANTI-… — isi URL dan anon key Supabase dulu.');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const updatesHtml = read('updates');
const versionManifest = buildVersionManifest(pkg, updatesHtml);

const html = buildHtmlBundle(config, pkg.version);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, 'version.json'), `${JSON.stringify(versionManifest, null, 2)}\n`);
const buildId = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);

fs.rmSync(path.join(OUT, 'vendor'), { recursive: true, force: true });
const vendorAssets = copyVendorDir(VENDOR_ROOT, path.join(OUT, 'vendor'), './vendor');

if (fs.existsSync(path.join(WEB, 'manifest.webmanifest'))) {
  fs.copyFileSync(path.join(WEB, 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));
}
if (fs.existsSync(path.join(WEB, 'sw.js'))) {
  const vendorReplacement = vendorAssets.length ? ',\n  ' + vendorAssets.map((p) => JSON.stringify(p)).join(',\n  ') : '';
  const swSource = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8')
    .replaceAll('__BUILD_ID__', buildId)
    .replace('/* __VENDOR_ASSETS__ */', vendorReplacement);
  fs.writeFileSync(path.join(OUT, 'sw.js'), swSource);
  process.stdout.write(`✅ ${OUT}/sw.js (cache: mykeuangan-${buildId}, ${vendorAssets.length} vendor assets)\n`);
}
const iconsSrc = path.join(WEB, 'icons');
const iconsDst = path.join(OUT, 'icons');
if (fs.existsSync(iconsSrc)) {
  fs.mkdirSync(iconsDst, { recursive: true });
  for (const f of fs.readdirSync(iconsSrc)) {
    fs.copyFileSync(path.join(iconsSrc, f), path.join(iconsDst, f));
  }
}

for (const staticPage of ['privacy.html', 'terms.html']) {
  const srcPage = path.join(WEB, staticPage);
  if (fs.existsSync(srcPage)) fs.copyFileSync(srcPage, path.join(OUT, staticPage));
}
const deletePageSrc = path.join(WEB, 'delete-account.html');
if (fs.existsSync(deletePageSrc)) {
  const deleteHtml = fs.readFileSync(deletePageSrc, 'utf8')
    .replace('<!-- __SUPABASE_SCRIPT__ -->', resolveSupabaseTag())
    .replace('<!-- __MYKEU_CONFIG__ -->', `<script>\n${config}\n</script>`);
  fs.writeFileSync(path.join(OUT, 'delete-account.html'), deleteHtml);
}

process.stdout.write(`✅ ${OUT}/index.html (${Math.round(html.length / 1024)} KB)\n`);
process.stdout.write(`✅ ${OUT}/version.json (v${versionManifest.version}, min v${versionManifest.minSupportedVersion})\n`);
process.stdout.write(`✅ PWA assets synced to ${OUT}/\n`);
