// scripts/check-syntax.mjs — Gelombang 5.1 (Q1/Q6/Q8)
// Memeriksa sintaks SEMUA kode yang dikirim, bukan hanya build.mjs +
// scripts/*.mjs + web/*.js:
//   1. JS/MJS klasik lewat `node --check` (termasuk tests/*.js — baru).
//   2. TypeScript supabase/functions/**/*.ts lewat stripTypeScriptTypes
//      (node:module, butuh Node >= 22.13) + kompilasi via node:vm.
//      Ini pemeriksaan SINTAKS, bukan type-check penuh: tsc --noEmit
//      tidak bisa dipakai di repo ini karena fungsi memakai import
//      `npm:` dan global Deno yang tidak bisa di-resolve tsc —
//      type-check penuh tetap Belum Diverifikasi (lihat laporan 5.1).
//      Bila stripTypeScriptTypes tidak tersedia, check GAGAL lantang
//      (jangan lolos diam-diam).
//   3. Skrip inline <script> di src/*.html (dan web/delete-account.html
//      yang ikut di-deploy ke dist/): isi script diekstrak lalu
//      dikompilasi via node:vm tanpa menulis file. Tag dengan src=
//      dilewati (bytes-nya diverifikasi fetch-vendors/build), begitu
//      pula type non-JS (mis. application/json).
// Semua kegagalan dikumpulkan lalu dilaporkan sekaligus; exit 1 bila
// ada satu pun yang gagal.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const failures = [];
const counts = { js: 0, ts: 0, inline: 0 };

function fail(file, detail) {
  failures.push(`${file}: ${detail}`);
  process.stderr.write(`❌ ${file}: ${detail}\n`);
}

function listDir(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort()
    .filter((name) => name.endsWith(ext))
    .map((name) => path.join(dir, name));
}

function listRecursive(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRecursive(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/* --- 1. JS/MJS klasik: node --check ------------------------------------ */
const jsTargets = ['build.mjs'];
jsTargets.push(...listDir('scripts', '.mjs'));
if (fs.existsSync('web')) {
  for (const name of fs.readdirSync('web').sort()) {
    if (name.endsWith('.js') && name !== 'config.js') jsTargets.push(path.join('web', name));
  }
}
jsTargets.push(...listDir('tests', '.js'));

for (const file of jsTargets) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    counts.js += 1;
  } catch (e) {
    fail(file, (e.stderr || e.stdout || e.message || 'node --check gagal').toString().trim().split('\n').slice(-3).join('\n'));
  }
}

/* --- 2. TypeScript: strip tipe + kompilasi via vm ----------------------- */
if (typeof stripTypeScriptTypes !== 'function') {
  fail('supabase/functions/**/*.ts', 'stripTypeScriptTypes tidak tersedia — butuh Node >= 22.13. Pemeriksaan TS BELUM DIVERIFIKASI.');
} else {
  const tsFiles = listRecursive('supabase/functions', '.ts');
  for (const file of tsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    let js;
    try {
      js = stripTypeScriptTypes(src, { mode: 'strip' });
    } catch (e) {
      fail(file, `galat sintaks TypeScript: ${e.message}`);
      continue;
    }
    // vm.Script tidak menerima import/export modul: hapus baris import
    // (pola yang sama dipakai loader TS di tests/wave3-edge-functions)
    // dan awalan `export ` — yang diperiksa adalah sintaks badan kode.
    if (/export\s+default\b/.test(js)) {
      fail(file, '`export default` belum didukung pemeriksaan ini — perlu penanganan manual.');
      continue;
    }
    js = js
      .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
      .replace(/import\s+[^;]+?\sfrom\s*['"][^'"]+['"];?/g, '')
      .replace(/export\s+(const|let|var|async function|function)\s/g, '$1 ');
    try {
      new vm.Script(js, { filename: file });
      counts.ts += 1;
    } catch (e) {
      fail(file, `galat sintaks setelah strip tipe: ${e.message}`);
    }
  }
}

/* --- 3. Skrip inline <script> di HTML ----------------------------------- */
const htmlFiles = [
  ...listDir('src', '.html'),
  // web/delete-account.html ikut di-deploy ke dist/ (lihat build.mjs),
  // jadi skrip inline-nya diperiksa juga.
  ...(fs.existsSync('web/delete-account.html') ? ['web/delete-account.html'] : []),
];
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  let idx = 0;
  while ((m = re.exec(html)) !== null) {
    idx += 1;
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // eksternal — diverifikasi fetch-vendors/build
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const type = (typeMatch ? typeMatch[1].trim().toLowerCase() : '');
    if (!JS_TYPES.has(type)) continue; // mis. application/json — bukan JS
    const code = m[2];
    if (!code.trim()) continue;
    const label = `${file} <script #${idx}>`;
    try {
      if (type === 'module') {
        // Modul ES butuh vm.SourceTextModule (butuh --experimental-vm-modules
        // di Node 22/24) — bila tidak tersedia, gagal lantang.
        if (typeof vm.SourceTextModule === 'function') {
          new vm.SourceTextModule(code, { identifier: label });
        } else {
          fail(label, 'skrip type="module" tidak bisa diperiksa tanpa --experimental-vm-modules — BELUM DIVERIFIKASI.');
          continue;
        }
      } else {
        new vm.Script(code, { filename: label });
      }
      counts.inline += 1;
    } catch (e) {
      fail(label, `galat sintaks: ${e.message}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n❌ check-syntax GAGAL: ${failures.length} berkas bermasalah.\n`);
  process.exit(1);
}
process.stdout.write(
  `✅ Syntax verified: ${counts.js} JS/MJS (node --check, termasuk tests/*.js), ` +
  `${counts.ts} TypeScript (strip + vm compile), ${counts.inline} skrip inline HTML (vm compile).\n`,
);
