// Wave 3.4 / S24–S25 — Frontend, CDN, dan build.
//
// EXECUTION-style (bukan string-match): test ini menjalankan build dan
// fetch vendor BENAR-BENAR di salinan repo di direktori temp unik
// (/tmp/wave3-cdn-*), supaya agen paralel tidak pernah bertabrakan dan
// supaya yang diuji adalah perilaku nyata, bukan teks source.
//
// Yang diuji:
//   (a) build tanpa web/vendor/ → gagal, tanpa dist/index.html.
//   (b) build dengan satu byte vendor diubah → gagal (hash tidak cocok).
//   (b2) build tanpa tailwind.min.css → gagal (tidak fallback Play CDN).
//   (c) fetch-vendors dengan cache rusak, tanpa --force → exit 1 dan
//       file rusak dihapus.
//   (d) fetch-vendors --force → file rusak diunduh ulang (bytes benar).
//   (e) dist/index.html: nol URL CDN di tag resource, nol document.write,
//       CSP script/style/font-src tanpa host CDN.
//   (f) setiap tag resource eksternal yang tersisa (bila ada) membawa
//       integrity + crossorigin; dan semua tag CDN di src/styles.html
//       membawa SRI (kecuali Google Fonts — tidak bisa di-SRI, diganti
//       build menjadi Inter self-hosted).
//   (g) password-policy.js dimuat pertama di SUPABASE_MODULES dan definisi
//       policy-nya muncul di dist sebelum consumer checkPasswordPolicy.
//   (h) fetch-vendors cache-hit memverifikasi hash dan exit 0.
//
// Catatan cakupan (sengaja): dist/index.html masih mengandung SATU string
// jsdelivr yang BUKAN tag resource dan di luar cakupan Wave 3.4 —
// `https://cdn.jsdelivr.net` di connect-src CSP (fetch runtime mata
// uang di web/supabase-portfolio.js, file Wave 3.5, memakainya sebagai
// sumber utama; lihat komentar di src/Index.html). URL currency-api yang
// sama sebagai string kini tinggal di dist/app/supabase-portfolio.js
// (Gelombang 7b: modul tidak lagi di-inline ke index.html).
// Test (e) memeriksa TAG resource (src/href), bukan string mentah,
// karena string di atas bukan pemuatan CDN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];
const CDN_HOST_PATTERN = CDN_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|');
// Direktori top-level yang tidak perlu disalin ke repo temp (mempercepat
// salinan dan menghindari bentrok dengan .git / artefak build).
const SKIP_TOP_DIRS = new Set(['.git', 'node_modules', 'dist', 'android', 'supabase']);

function makeTempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave3-cdn-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO_ROOT, src);
      if (!rel) return true;
      return !SKIP_TOP_DIRS.has(rel.split(path.sep)[0]);
    }
  });
  return dir;
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 600000 });
}

function combinedOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

// Tag resource eksternal (<script src="http…"> / <link href="http…">).
function externalResourceTags(html) {
  return [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)\s*=\s*"([^"]*)"[^>]*>/gi)]
    .map((m) => ({ tag: m[0], url: m[1] }))
    .filter((entry) => /^https?:\/\//i.test(entry.url));
}

function buildTempRepo(t) {
  const dir = makeTempRepo(t);
  const result = runNode(['build.mjs'], dir);
  assert.equal(result.status, 0, `build gagal di repo temp ${dir}:\n${combinedOutput(result)}`);
  return { dir, html: fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8') };
}

test('3.4a build gagal tanpa web/vendor/ dan tidak menulis dist/index.html', (t) => {
  const dir = makeTempRepo(t);
  fs.rmSync(path.join(dir, 'web', 'vendor'), { recursive: true, force: true });
  const result = runNode(['build.mjs'], dir);
  assert.notEqual(result.status, 0, 'build harus gagal bila vendor tidak ada');
  assert.match(combinedOutput(result), /vendor/i, 'error harus menyebut vendor');
  assert.equal(fs.existsSync(path.join(dir, 'dist', 'index.html')), false, 'dist/index.html tidak boleh ditulis saat build gagal');
});

test('3.4b build gagal bila satu byte vendor diubah (hash tidak cocok)', (t) => {
  const dir = makeTempRepo(t);
  const file = path.join(dir, 'web', 'vendor', 'supabase.js');
  const buf = fs.readFileSync(file);
  buf[100] = buf[100] === 0x41 ? 0x42 : 0x41;
  fs.writeFileSync(file, buf);
  const result = runNode(['build.mjs'], dir);
  assert.notEqual(result.status, 0, 'build harus gagal bila vendor dirusak');
  assert.match(combinedOutput(result), /hash|tidak terverifikasi|Vendor/i, 'error harus menyebut verifikasi/hash vendor');
  assert.equal(fs.existsSync(path.join(dir, 'dist', 'index.html')), false, 'dist/index.html tidak boleh ditulis saat vendor rusak');
});

test('3.4b2 build gagal bila tailwind.min.css hilang (tidak fallback ke Play CDN)', (t) => {
  const dir = makeTempRepo(t);
  fs.rmSync(path.join(dir, 'web', 'vendor', 'tailwind.min.css'), { force: true });
  const result = runNode(['build.mjs'], dir);
  assert.notEqual(result.status, 0, 'build harus gagal bila tailwind.min.css hilang');
  assert.match(combinedOutput(result), /tailwind\.min\.css/, 'error harus menyebut tailwind.min.css');
  assert.equal(fs.existsSync(path.join(dir, 'dist', 'index.html')), false);
});

test('3.4c fetch-vendors menolak cache rusak tanpa --force (exit 1, file dihapus)', (t) => {
  const dir = makeTempRepo(t);
  const file = path.join(dir, 'web', 'vendor', 'supabase.js');
  fs.writeFileSync(file, 'bytes-palsu-yang-diracuni');
  const result = runNode(['scripts/fetch-vendors.mjs'], dir);
  assert.notEqual(result.status, 0, 'fetch tanpa --force harus gagal bila cache rusak');
  assert.match(combinedOutput(result), /hash|rusak/i, 'error harus menyebut hash/cache rusak');
  assert.equal(fs.existsSync(file), false, 'file cache yang hash-nya tidak cocok harus dihapus');
});

test('3.4d fetch-vendors --force mengunduh ulang cache rusak (bytes benar)', (t) => {
  const dir = makeTempRepo(t);
  const file = path.join(dir, 'web', 'vendor', 'supabase.js');
  const good = fs.readFileSync(path.join(REPO_ROOT, 'web', 'vendor', 'supabase.js'));
  fs.writeFileSync(file, 'bytes-palsu-yang-diracuni');
  const result = runNode(['scripts/fetch-vendors.mjs', '--force'], dir);
  assert.equal(result.status, 0, `fetch --force harus berhasil:\n${combinedOutput(result)}`);
  assert.deepEqual(fs.readFileSync(file), good, 'file rusak harus diganti bytes asli yang terverifikasi hash');
});

test('3.4e dist/index.html tanpa URL CDN di tag resource dan tanpa document.write', (t) => {
  const { dir, html } = buildTempRepo(t);
  const external = externalResourceTags(html);
  assert.deepEqual(external, [], `tag resource eksternal masih ada di dist: ${JSON.stringify(external)}`);
  assert.doesNotMatch(html, /document\.write/, 'dist tidak boleh mengandung document.write (fallback Supabase sudah dihapus)');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, 'dist harus memuat meta CSP');
  for (const directive of ['script-src', 'style-src', 'font-src']) {
    const part = csp[1].split(';').find((s) => s.trim().startsWith(directive));
    assert.ok(part, `CSP harus memuat ${directive}`);
    for (const host of CDN_HOSTS) {
      assert.doesNotMatch(part, new RegExp(host.replace(/\./g, '\\.')), `CSP ${directive} masih memuat ${host}`);
    }
  }
  const scriptSrc = csp[1].split(';').find((s) => s.trim().startsWith('script-src'));
  assert.ok(scriptSrc, 'CSP harus memuat script-src');
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/, 'CSP script-src tidak boleh lagi memuat unsafe-inline (Gelombang 7b: modul eksternal)');
  assert.doesNotMatch(scriptSrc, /'unsafe-eval'/, 'CSP script-src tidak boleh lagi memuat unsafe-eval (Gelombang 7b)');
  assert.match(html, /src="\.\/vendor\/supabase\.js"/, 'Supabase harus dimuat dari vendor lokal');
  assert.match(html, /href="\.\/vendor\/inter\/inter\.css"/, 'Inter harus dimuat dari vendor lokal');
  // Gelombang 7d (P5/P6): Phosphor dimuat sebagai SUBSET
  // (web/phosphor-subset/, dibuat scripts/subset-phosphor.mjs) — file
  // lengkap TIDAK boleh ada di dist/.
  assert.match(html, /href="\.\/vendor\/phosphor-subset\/regular\/style\.css"/, 'Phosphor harus dimuat dari subset vendor lokal');
  assert.ok(!fs.existsSync(path.join(dir, 'dist', 'vendor', 'phosphor')), 'file Phosphor lengkap tidak boleh ada di dist/vendor/phosphor');
  const phosphorCss = fs.readFileSync(path.join(dir, 'dist', 'vendor', 'phosphor-subset', 'regular', 'style.css'), 'utf8');
  assert.match(phosphorCss, /font-display:\s*swap/, 'subset Phosphor harus memakai font-display: swap');
  assert.match(html, /href="\.\/vendor\/tailwind\.min\.css"/, 'Tailwind harus dimuat dari vendor lokal sebagai <link> (Gelombang 7b — bukan lagi <style> inline)');
  assert.doesNotMatch(html, /tailwind\.config\s*=/, 'dist tidak boleh lagi memuat blok inline tailwind.config (konfig sudah dibekukan di tailwind.min.css)');
  const sw = fs.readFileSync(path.join(dir, 'dist', 'sw.js'), 'utf8');
  assert.match(sw, /"\.\/vendor\/supabase\.js"/, 'sw.js harus mem-precache vendor lokal');
  assert.match(sw, /"\.\/vendor\/tailwind\.min\.css"/, 'sw.js harus mem-precache tailwind.min.css (Gelombang 7b: tidak lagi inline di index.html)');
  assert.match(sw, /"\.\/app\/error-messages\.js"/, 'sw.js harus mem-precache modul app (Gelombang 7b)');
});

test('3.4f setiap tag resource eksternal yang tersisa membawa integrity + crossorigin', (t) => {
  const { html } = buildTempRepo(t);
  const external = externalResourceTags(html);
  for (const { tag } of external) {
    assert.match(tag, /integrity="sha384-[^"]+"/, `tag eksternal tanpa SRI: ${tag}`);
    assert.match(tag, /crossorigin="anonymous"/, `tag eksternal tanpa crossorigin: ${tag}`);
  }
  // Jangkar source: semua tag CDN di src/styles.html (kecuali Google Fonts
  // yang tidak bisa di-SRI — diganti build menjadi Inter self-hosted)
  // harus membawa SRI + crossorigin.
  // Gelombang 7d (P2): dulu 11 — 8 tag di antaranya (jsPDF + autotable,
  // Chart.js, flatpickr + monthSelect + locale id) DIHAPUS dari
  // styles.html karena ketiganya kini lazy-load (web/lazy-vendors.js).
  // Sisa 3: sweetalert2, Phosphor, Tailwind Play CDN. SRI kedelapan
  // file yang dihapus TIDAK hilang — pindah ke web/lazy-vendors.js
  // (dicek di bawah: hash yang sama harus ada di sana).
  const styles = fs.readFileSync(path.join(REPO_ROOT, 'src', 'styles.html'), 'utf8');
  const srcTags = [...styles.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)\s*=\s*"https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|cdn\.tailwindcss\.com)[^"]*"[^>]*>/gi)];
  assert.equal(srcTags.length, 3, `tag CDN SRI-eligible di src/styles.html harus 3 (Gelombang 7d: 8 tag lazy-load dihapus), ketemu ${srcTags.length}`);
  for (const [tag] of srcTags) {
    assert.match(tag, /integrity="sha384-[^"]+"/, `tag CDN source tanpa SRI: ${tag}`);
    assert.match(tag, /crossorigin="anonymous"/, `tag CDN source tanpa crossorigin: ${tag}`);
  }
  // Gelombang 7d: SRI file lazy-load harus tetap ada di lazy-vendors.js.
  const lazyVendors = fs.readFileSync(path.join(REPO_ROOT, 'web', 'lazy-vendors.js'), 'utf8');
  for (const file of ['jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js', 'chart.umd.min.js', 'flatpickr.min.js', 'monthSelect-index.js', 'flatpickr-id.js', 'flatpickr.min.css', 'monthSelect-style.css']) {
    assert.ok(lazyVendors.includes(`'${file}'`), `lazy-vendors.js harus memuat ${file}`);
    const hashMatch = lazyVendors.match(new RegExp(`'${file.replace(/\./g, '\\.')}'\\s*:\\s*'(sha384-[^']+)'`));
    assert.ok(hashMatch, `lazy-vendors.js harus membawa SRI untuk ${file}`);
  }
  assert.doesNotMatch(styles, /rel="preconnect" href="https:\/\/(?:fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr)/, 'tidak boleh ada preconnect CDN di styles.html');
});

test('3.4g password-policy.js dimuat pertama dan sebelum consumer-nya', (t) => {
  const build = fs.readFileSync(path.join(REPO_ROOT, 'build.mjs'), 'utf8');
  const modules = build.match(/const SUPABASE_MODULES = \[([\s\S]*?)\];/);
  assert.ok(modules, 'SUPABASE_MODULES harus ada di build.mjs');
  const first = modules[1].match(/'([^']+)'/);
  assert.ok(first, 'SUPABASE_MODULES harus berisi entri');
  assert.equal(first[1], 'password-policy.js', 'password-policy.js harus entri PERTAMA SUPABASE_MODULES (sebelum supabase-auth-ui.js)');
  const { dir, html } = buildTempRepo(t);
  // Gelombang 7b: modul tidak lagi di-inline — urutan load dibaca dari
  // tag <script defer src="./app/..."> di dist/index.html (Gelombang 7d:
  // defer, urutan tetap terjaga), lalu isi tiap file dist/app/*.js
  // digabung mengikuti urutan itu.
  const appOrder = [...html.matchAll(/<script defer src="\.\/app\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(appOrder.indexOf('password-policy.js') !== -1, 'dist harus memuat tag password-policy.js');
  assert.ok(appOrder.indexOf('password-policy.js') < appOrder.indexOf('supabase-auth.js'), 'password-policy.js harus dimuat SEBELUM consumer-nya (supabase-auth.js)');
  const concatenated = appOrder.map((f) => fs.readFileSync(path.join(dir, 'dist', 'app', f), 'utf8')).join('\n');
  const defIdx = concatenated.indexOf('__mkPasswordPolicy = policy');
  const useIdx = concatenated.indexOf('function checkPasswordPolicy');
  assert.ok(defIdx !== -1, 'dist/app harus memuat definisi __mkPasswordPolicy');
  assert.ok(useIdx !== -1, 'dist/app harus memuat consumer checkPasswordPolicy');
  assert.ok(defIdx < useIdx, 'definisi password-policy harus muncul SEBELUM consumer-nya di urutan load dist/app/*.js');
});

test('3.4h fetch-vendors cache-hit memverifikasi hash dan exit 0', (t) => {
  const dir = makeTempRepo(t);
  const result = runNode(['scripts/fetch-vendors.mjs'], dir);
  assert.equal(result.status, 0, `fetch cache-hit harus berhasil:\n${combinedOutput(result)}`);
  assert.match(result.stdout, /0 downloaded, 17 cached/, 'semua 17 vendor harus lolos verifikasi hash dari cache');
});
