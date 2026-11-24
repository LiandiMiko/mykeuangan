// Menggabungkan src/*.html (pengganti <?!= include('x') ?> Apps Script)
// + web/config.js + modul web/*.js  →  dist/index.html
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
const WEB = 'web';
const OUT = 'dist';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const SUPABASE_JS_FALLBACK = 'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const VENDOR = path.join('web', 'vendor', 'supabase.js');

const WEB_MODULES = [
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
  if (!fs.existsSync(VENDOR)) {
    return `<script src="${SUPABASE_JS}" crossorigin="anonymous"></script>\n` +
      `<script>window.supabase || document.write('<script src="${SUPABASE_JS_FALLBACK}" crossorigin="anonymous"><\\/script>')</script>`;
  }
  const code = fs.readFileSync(VENDOR, 'utf8');
  if (/<\/script/i.test(code)) throw new Error('web/vendor/supabase.js berisi </script>, tidak bisa di-inline.');
  return `<script>\n${code}\n</script>`;
}

const cfgFile = path.join(WEB, 'config.js');
if (!fs.existsSync(cfgFile)) {
  throw new Error('web/config.js tidak ada. Salin web/config.example.js menjadi web/config.js lalu isi URL dan anon key Supabase.');
}
const config = fs.readFileSync(cfgFile, 'utf8');
if (/GANTI-/.test(config)) throw new Error('web/config.js masih berisi placeholder GANTI-… — isi URL dan anon key Supabase dulu.');

let html = read('Index');
html = html.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, name) => {
  if (name === 'scripts') {
    return `${resolveSupabaseTag()}\n${readInlineScripts(WEB_MODULES)}\n${readInlineScripts(UI_CORE_MODULES)}\n` +
      `<script>\n${config}\n</script>\n${readInlineScripts(SUPABASE_MODULES)}`;
  }
  if (name === 'features-v21') {
    return readInlineScripts(UI_FEATURES_MODULES);
  }
  if (name === 'features-v35') {
    return readInlineScripts(UI_PRO_MODULES);
  }
  return read(name);
});

const tailwindVendorPath = path.join(WEB, 'vendor', 'tailwind.min.css');
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
if (/<\?/.test(html)) throw new Error('Masih ada scriptlet Apps Script (<? ... ?>) yang belum diganti.');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
const buildId = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);

if (fs.existsSync(path.join(WEB, 'manifest.webmanifest'))) {
  fs.copyFileSync(path.join(WEB, 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));
}
if (fs.existsSync(path.join(WEB, 'sw.js'))) {
  const swSource = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8').replaceAll('__BUILD_ID__', buildId);
  fs.writeFileSync(path.join(OUT, 'sw.js'), swSource);
  process.stdout.write(`✅ ${OUT}/sw.js (cache: mykeuangan-${buildId})\n`);
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
process.stdout.write(`✅ PWA assets synced to ${OUT}/\n`);
