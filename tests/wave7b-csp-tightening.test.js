// Gelombang 7b / T12 — CSP diperketat: eksternalisasi JS inline.
//
// EXECUTION-style (bukan string-match): test ini menjalankan build
// BENAR-BENAR di salinan repo di direktori temp unik (/tmp/wave7b-csp-*),
// seperti pola tes Wave 3.4 / 5.2, supaya yang diuji adalah perilaku
// nyata build, bukan teks source.
//
// Yang diuji:
//   (a) meta CSP di src/Index.html: script-src TANPA 'unsafe-inline'
//       dan TANPA 'unsafe-eval'; style-src SENGAJA tetap 'unsafe-inline'
//       (atribut style= di template — lihat komentar CSP di
//       src/Index.html); img-src TANPA 'https:' mentah; form-action
//       'self'; upgrade-insecure-requests; TANPA frame-ancestors
//       (diabaikan di meta CSP).
//   (b) dist/index.html: NOL blok <script> inline; setiap tag
//       <script src="./app/..."> dan "./vendor/..." ada filenya di dist;
//       Tailwind dimuat lewat <link> ke ./vendor/tailwind.min.css
//       (bukan <style> inline, bukan blok tailwind.config inline).
//   (c) urutan load TETAP seperti dulu (paritas perilaku): i18n-dict di
//       <head> sebelum semua modul; error-messages.js pertama di body;
//       config.js di antara UI_CORE dan SUPABASE; password-policy.js
//       sebelum consumer supabase-auth.js; sw-register.js PALING AKHIR.
//   (d) dist/app/*.js: tidak ada eval()/new Function() di kode aplikasi
//       (satu-satunya new Function ada di VENDOR sweetalert2, di luar
//       cakupan ini — aplikasi tidak memakai template deklaratifnya);
//       dist/app/i18n-dict.js memuat kamus I18N + helper t().
//   (e) SW precache: dist/sw.js memuat SEMUA file dist/app/*.js dan
//       ./vendor/tailwind.min.css (keduanya wajib offline).
//   (f) build gagal bila satu file app hilang (gerbang modul lengkap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_TOP_DIRS = new Set(['.git', 'node_modules', 'dist', 'android', 'supabase']);

function makeTempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7b-csp-'));
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

function runBuild(dir, extraEnv = {}) {
  return spawnSync(process.execPath, ['build.mjs'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 600000,
    env: { ...process.env, ...extraEnv }
  });
}

function combinedOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function buildTempRepo(t) {
  const dir = makeTempRepo(t);
  const result = runBuild(dir);
  assert.equal(result.status, 0, `build gagal di repo temp ${dir}:\n${combinedOutput(result)}`);
  return { dir, html: fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8') };
}

function cspMeta(html) {
  const m = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, 'dist harus memuat meta CSP');
  return m[1];
}

function directive(csp, name) {
  const part = csp.split(';').find((s) => s.trim().startsWith(name));
  assert.ok(part, `CSP harus memuat ${name}`);
  return part;
}

test('7b-a meta CSP: script-src tanpa unsafe-inline/unsafe-eval; pelonggaran sisa terdokumentasi', () => {
  const csp = cspMeta(fs.readFileSync(path.join(REPO_ROOT, 'src', 'Index.html'), 'utf8'));
  const scriptSrc = directive(csp, 'script-src');
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/, 'script-src tidak boleh memuat unsafe-inline');
  assert.doesNotMatch(scriptSrc, /'unsafe-eval'/, 'script-src tidak boleh memuat unsafe-eval');
  assert.match(scriptSrc, /'self'/, 'script-src harus memuat self');
  // style-src SENGAJA tetap 'unsafe-inline' (atribut style= di template).
  assert.match(directive(csp, 'style-src'), /'unsafe-inline'/, 'style-src sengaja tetap unsafe-inline (lihat komentar CSP di src/Index.html)');
  assert.doesNotMatch(directive(csp, 'img-src'), /https:/, 'img-src tidak boleh memuat https: mentah (tidak ada gambar remote)');
  assert.match(directive(csp, 'img-src'), /data:/, 'img-src harus tetap memuat data: (gambar data: URL)');
  assert.match(directive(csp, 'img-src'), /blob:/, 'img-src harus tetap memuat blob: (URL.createObjectURL di 5 modul)');
  assert.match(csp, /form-action 'self'/, 'CSP harus memuat form-action self');
  assert.match(csp, /upgrade-insecure-requests/, 'CSP harus memuat upgrade-insecure-requests');
  assert.doesNotMatch(csp, /frame-ancestors/, 'frame-ancestors tidak boleh ada di meta CSP (diabaikan di meta — butuh header HTTP)');
  assert.doesNotMatch(csp, /'unsafe-inline'.*'unsafe-inline'/, 'hanya style-src yang boleh memuat unsafe-inline');
});

test('7b-b dist/index.html: nol <script> inline; semua <script src> ada filenya; Tailwind via <link>', (t) => {
  const { dir, html } = buildTempRepo(t);
  assert.equal(
    [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].length, 0,
    'dist/index.html tidak boleh memuat blok <script> inline'
  );
  // Komentar HTML di dist (mis. komentar CSP) memuat teks literal
  // `<script src="./app/...">` — strip komentar dulu supaya scan tag
  // hanya mengenai tag sungguhan.
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const srcTags = [...noComments.matchAll(/<script[^>]*\bsrc="(\.[^"]*)"[^>]*>/g)].map((m) => m[1]);
  assert.ok(srcTags.length > 50, `dist harus memuat >50 tag <script src>, ketemu ${srcTags.length}`);
  for (const src of srcTags) {
    assert.ok(!src.startsWith('http'), `tag script tidak boleh eksternal: ${src}`);
    assert.ok(fs.existsSync(path.join(dir, 'dist', src)), `file yang dirujuk tag script harus ada di dist: ${src}`);
  }
  assert.match(html, /<link rel="stylesheet" href="\.\/vendor\/tailwind\.min\.css">/, 'Tailwind harus dimuat lewat <link> ke ./vendor/tailwind.min.css');
  assert.ok(fs.existsSync(path.join(dir, 'dist', 'vendor', 'tailwind.min.css')), 'dist/vendor/tailwind.min.css harus ada');
  assert.doesNotMatch(html, /tailwind\.config\s*=/, 'dist tidak boleh memuat blok inline tailwind.config');
  assert.doesNotMatch(cspMeta(html), /cdn\.tailwindcss\.com/, 'CSP tidak boleh menyebut Play CDN');
});

test('7b-c urutan load tetap: i18n di head, error-messages pertama, config di tengah, sw-register terakhir', (t) => {
  const { html } = buildTempRepo(t);
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const appTags = [...noComments.matchAll(/<script src="\.\/app\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  const idx = (f) => appTags.indexOf(f);
  assert.ok(idx('i18n-dict.js') !== -1, 'i18n-dict.js harus dimuat');
  assert.ok(idx('i18n-dict.js') < idx('error-messages.js'), 'i18n-dict.js (di <head>) harus sebelum semua modul body');
  assert.equal(idx('error-messages.js'), 1, 'error-messages.js harus modul body PERTAMA (setelah i18n-dict.js)');
  assert.ok(idx('config.js') > idx('ui-ai.js'), 'config.js harus setelah UI_CORE_MODULES');
  assert.ok(idx('config.js') < idx('password-policy.js'), 'config.js harus sebelum SUPABASE_MODULES');
  assert.ok(idx('password-policy.js') < idx('supabase-auth.js'), 'password-policy.js harus sebelum consumer supabase-auth.js');
  assert.equal(idx('sw-register.js'), appTags.length - 1, 'sw-register.js harus PALING AKHIR (memakai showPwaUpdateToast)');
  // Tidak ada defer/async pada tag app — eksekusi sinkron berurutan
  // seperti saat masih inline.
  for (const m of noComments.matchAll(/<script([^>]*)src="\.\/app\/[^"]*"[^>]*>/g)) {
    assert.doesNotMatch(m[1], /\b(defer|async)\b/, `tag app tidak boleh defer/async: ${m[0]}`);
  }
});

test('7b-d dist/app/*.js: tanpa eval/new Function; i18n-dict.js memuat kamus + helper', (t) => {
  const { dir } = buildTempRepo(t);
  const appDir = path.join(dir, 'dist', 'app');
  const files = fs.readdirSync(appDir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 40, `dist/app harus memuat >40 file JS, ketemu ${files.length}`);
  for (const f of files) {
    const code = fs.readFileSync(path.join(appDir, f), 'utf8');
    assert.doesNotMatch(code, /\beval\s*\(/, `dist/app/${f} tidak boleh memuat eval()`);
    assert.doesNotMatch(code, /\bnew Function\s*\(/, `dist/app/${f} tidak boleh memuat new Function()`);
  }
  const dict = fs.readFileSync(path.join(appDir, 'i18n-dict.js'), 'utf8');
  assert.match(dict, /const I18N = \{/, 'i18n-dict.js harus memuat const I18N');
  assert.match(dict, /function t\(/, 'i18n-dict.js harus memuat helper t()');
  assert.match(dict, /function applyTranslations\(/, 'i18n-dict.js harus memuat applyTranslations()');
  assert.match(dict, /function getMonthName\(/, 'i18n-dict.js harus memuat getMonthName()');
});

test('7b-e SW precache memuat semua file app + tailwind.min.css', (t) => {
  const { dir } = buildTempRepo(t);
  const sw = fs.readFileSync(path.join(dir, 'dist', 'sw.js'), 'utf8');
  const appFiles = fs.readdirSync(path.join(dir, 'dist', 'app')).filter((f) => f.endsWith('.js'));
  assert.ok(appFiles.length > 40, 'dist/app harus memuat >40 file JS');
  for (const f of appFiles) {
    assert.ok(sw.includes(`"./app/${f}"`), `sw.js harus mem-precache ./app/${f}`);
  }
  assert.ok(sw.includes('"./vendor/tailwind.min.css"'), 'sw.js harus mem-precache ./vendor/tailwind.min.css');
  assert.doesNotMatch(sw, /__APP_ASSETS__/, 'placeholder __APP_ASSETS__ harus sudah diganti build');
  assert.doesNotMatch(sw, /__VENDOR_ASSETS__/, 'placeholder __VENDOR_ASSETS__ harus sudah diganti build');
});

test('7b-f build gagal bila satu modul app hilang', (t) => {
  const dir = makeTempRepo(t);
  fs.rmSync(path.join(dir, 'web', 'ui-dashboard.js'), { force: true });
  const result = runBuild(dir);
  assert.notEqual(result.status, 0, 'build harus gagal bila modul app hilang');
  assert.match(combinedOutput(result), /ui-dashboard\.js/, 'error harus menyebut modul yang hilang');
  assert.equal(fs.existsSync(path.join(dir, 'dist', 'index.html')), false, 'dist/index.html tidak boleh ditulis saat build gagal');
});
