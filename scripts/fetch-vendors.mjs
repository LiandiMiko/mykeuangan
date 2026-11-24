import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR_DIR = path.join('web', 'vendor');
const FETCH_TIMEOUT_MS = 30000;

export const VENDOR_MANIFEST = [
  { file: 'supabase.js', url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js' },
  { file: 'sweetalert2.all.min.js', url: 'https://cdn.jsdelivr.net/npm/sweetalert2@11.14.5/dist/sweetalert2.all.min.js' },
  { file: 'flatpickr.min.css', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css' },
  { file: 'monthSelect-style.css', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/plugins/monthSelect/style.css' },
  { file: 'flatpickr.min.js', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js' },
  { file: 'monthSelect-index.js', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/plugins/monthSelect/index.js' },
  { file: 'flatpickr-id.js', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/id.js' },
  { file: 'jspdf.umd.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' },
  { file: 'jspdf.plugin.autotable.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js' },
  { file: 'chart.umd.min.js', url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js' },
  { file: 'inter/inter-latin-wght-normal.woff2', url: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.1.0/files/inter-latin-wght-normal.woff2' },
  { file: 'phosphor/regular/Phosphor.woff2', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/Phosphor.woff2' },
  { file: 'phosphor/regular/style.css', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css', fontFile: 'Phosphor.woff2' },
  { file: 'phosphor/bold/Phosphor-Bold.woff2', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/bold/Phosphor-Bold.woff2' },
  { file: 'phosphor/bold/style.css', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/bold/style.css', fontFile: 'Phosphor-Bold.woff2' },
  { file: 'phosphor/fill/Phosphor-Fill.woff2', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/fill/Phosphor-Fill.woff2' },
  { file: 'phosphor/fill/style.css', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/fill/style.css', fontFile: 'Phosphor-Fill.woff2' }
];

function rewritePhosphorCss(cssText, woff2File) {
  return cssText.replace(/@font-face\s*\{[\s\S]*?\}/g, (block) => {
    let replaced = false;
    return block.replace(/^\s*src\s*:[^;]*;\s*\r?\n?/gm, () => {
      if (replaced) return '';
      replaced = true;
      return `  src: url("./${woff2File}") format("woff2");\n`;
    });
  });
}

async function fetchBufferWithRetry(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function writeInterStylesheet() {
  const interDir = path.join(VENDOR_DIR, 'inter');
  if (!fs.existsSync(path.join(interDir, 'inter-latin-wght-normal.woff2'))) return;
  const css = [
    '@font-face {',
    "  font-family: 'Inter';",
    '  font-style: normal;',
    '  font-display: swap;',
    '  font-weight: 300 900;',
    "  src: url('./inter-latin-wght-normal.woff2') format('woff2');",
    '}',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(interDir, 'inter.css'), css);
}

async function downloadVendorEntry(entry, force) {
  const dest = path.join(VENDOR_DIR, entry.file);
  const existsNonEmpty = fs.existsSync(dest) && fs.statSync(dest).size > 0;
  if (existsNonEmpty && !force) {
    if (entry.fontFile) {
      const current = fs.readFileSync(dest, 'utf8');
      const normalized = rewritePhosphorCss(current, entry.fontFile);
      if (normalized !== current) fs.writeFileSync(dest, normalized);
    }
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = await fetchBufferWithRetry(entry.url);
  if (entry.fontFile) {
    fs.writeFileSync(dest, rewritePhosphorCss(raw.toString('utf8'), entry.fontFile));
  } else {
    fs.writeFileSync(dest, raw);
  }
  return true;
}

async function main() {
  const force = process.argv.includes('--force');
  let downloaded = 0;
  let skipped = 0;
  for (const entry of VENDOR_MANIFEST) {
    const didDownload = await downloadVendorEntry(entry, force);
    if (didDownload) downloaded += 1;
    else skipped += 1;
  }
  writeInterStylesheet();
  process.stdout.write(`✅ Vendor assets ready (${downloaded} downloaded, ${skipped} cached) in ${VENDOR_DIR}/\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`❌ Failed to fetch vendor assets: ${err.message || String(err)}\n`);
    process.exitCode = 1;
  });
}
