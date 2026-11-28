// Gelombang 7d — performa PWA: lazy-load lib berat, defer, subset ikon.
//
// EXECUTION-style: bagian dist menjalankan build BENAR-BENAR di salinan
// repo di direktori temp (pola Wave 3.4/5.2/7b), bagian loader menguji
// web/lazy-vendors.js di vm sandbox dengan document palsu.
//
// Yang diuji:
//   (a) lazy-load: dist/index.html TIDAK memuat tag jspdf/autotable/
//       Chart/flatpickr; web/lazy-vendors.js ada di dist/app; loader
//       menyuntik skrip (dengan SRI yang benar) hanya saat dipanggil,
//       meng-cache promise-nya, dan memakai jalur cepat bila lib sudah
//       ada; Chart.defaults diterapkan setelah load.
//   (b) defer: SEMUA tag app di dist/index.html memakai defer, jumlahnya
//       sama dengan file dist/app/*.js, i18n-dict tetap pertama dan
//       sw-register tetap terakhir (urutan terjaga).
//   (c) preload: 3 link preload aset kritis ada di dist/index.html.
//   (d) subset Phosphor: dist memakai subset (bukan file lengkap);
//       subset CSS mencakup SETIAP ikon yang dirujuk src/ + web/
//       (dihitung ulang lewat collectUsedIcons() dari generator);
//       woff2 subset ada, tidak kosong, dan jauh lebih kecil dari
//       aslinya; font-display: swap.
//   (e) SW precache: dist/sw.js tetap memuat file lazy-vendor dan
//       subset (lazy-load tetap bekerja offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectUsedIcons } from '../scripts/subset-phosphor.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_TOP_DIRS = new Set(['.git', 'node_modules', 'dist', 'android', 'supabase']);

function makeTempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7d-performa-'));
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

function buildTempRepo(t) {
  const dir = makeTempRepo(t);
  const result = spawnSync(process.execPath, ['build.mjs'], {
    cwd: dir, encoding: 'utf8', timeout: 600000, env: { ...process.env }
  });
  assert.equal(result.status, 0, `build gagal di repo temp:\n${result.stdout}\n${result.stderr}`);
  return dir;
}

// ---------- (a) loader lazy-vendors.js di vm sandbox ----------

function makeLoaderSandbox() {
  const created = [];
  const sandbox = {
    console,
    window: {},
    document: {
      head: { appendChild(el) { created.push(el); } },
      createElement(tag) {
        return {
          tag, rel: '', href: '', src: '', integrity: '', crossOrigin: '',
          async: false, onload: null, onerror: null
        };
      }
    }
  };
  sandbox.window.window = sandbox.window;
  const code = fs.readFileSync(path.join(REPO_ROOT, 'web', 'lazy-vendors.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'lazy-vendors.js' });
  return { sandbox, created, api: sandbox.window };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('7d-a lazy-vendors: ensureJsPdf menyuntik jspdf + autotable dengan SRI, sekali saja', async () => {
  const { created, api } = makeLoaderSandbox();
  const src = fs.readFileSync(path.join(REPO_ROOT, 'web', 'lazy-vendors.js'), 'utf8');
  const jspdfSri = src.match(/'jspdf\.umd\.min\.js': '([^']+)'/)[1];
  const autotableSri = src.match(/'jspdf\.plugin\.autotable\.min\.js': '([^']+)'/)[1];

  const p1 = api.ensureJsPdf();
  const p2 = api.ensureJsPdf();
  // Cache ada per FILE di loadScript (bukan per ensure*): dua panggilan
  // bersamaan tetap hanya menyuntik 1 skrip; keduanya selesai bersama.
  assert.equal(created.length, 1, 'dua panggilan bersamaan tetap 1 skrip (cache per file)');
  assert.equal(created[0].tag, 'script');
  assert.equal(created[0].src, './vendor/jspdf.umd.min.js');
  assert.equal(created[0].integrity, jspdfSri);
  assert.equal(created[0].crossOrigin, 'anonymous');
  created[0].onload();
  await tick();
  assert.equal(created.length, 2, 'autotable disuntik setelah jspdf selesai');
  assert.equal(created[1].src, './vendor/jspdf.plugin.autotable.min.js');
  assert.equal(created[1].integrity, autotableSri);
  created[1].onload();
  await p1;
  assert.equal(created.length, 2, 'tidak ada skrip tambahan setelah selesai');

  // Jalur cepat: lib sudah ada -> tidak ada injeksi sama sekali.
  const { created: created2, api: api2 } = makeLoaderSandbox();
  api2.jspdf = { jsPDF: function () {} };
  await api2.ensureJsPdf();
  assert.equal(created2.length, 0, 'jspdf sudah ada: tidak boleh menyuntik');
});

test('7d-a lazy-vendors: ensureChart menyuntik Chart lalu menerapkan default', async () => {
  const { created, api } = makeLoaderSandbox();
  const src = fs.readFileSync(path.join(REPO_ROOT, 'web', 'lazy-vendors.js'), 'utf8');
  const chartSri = src.match(/'chart\.umd\.min\.js': '([^']+)'/)[1];
  const p = api.ensureChart();
  assert.equal(created.length, 1);
  assert.equal(created[0].src, './vendor/chart.umd.min.js');
  assert.equal(created[0].integrity, chartSri);
  api.Chart = { defaults: { font: {} } };
  created[0].onload();
  await p;
  assert.equal(api.Chart.defaults.font.family, "'Inter', sans-serif", 'Chart.defaults harus diterapkan setelah load');

  const { created: created2, api: api2 } = makeLoaderSandbox();
  api2.Chart = { defaults: { font: {} } };
  await api2.ensureChart();
  assert.equal(created2.length, 0, 'Chart sudah ada: tidak boleh menyuntik');
  assert.equal(api2.Chart.defaults.font.family, "'Inter', sans-serif", 'jalur cepat juga menerapkan default');
});

test('7d-a lazy-vendors: ensureFlatpickr menyuntik 2 CSS + 3 skrip berurutan', async () => {
  const { created, api } = makeLoaderSandbox();
  const src = fs.readFileSync(path.join(REPO_ROOT, 'web', 'lazy-vendors.js'), 'utf8');
  const cssSri = src.match(/'flatpickr\.min\.css': '([^']+)'/)[1];
  const p = api.ensureFlatpickr();
  assert.equal(created.length, 2, 'kedua CSS flatpickr disuntik dulu (Promise.all)');
  assert.equal(created[0].tag, 'link');
  assert.equal(created[0].rel, 'stylesheet');
  assert.equal(created[0].href, './vendor/flatpickr.min.css');
  assert.equal(created[0].integrity, cssSri);
  assert.equal(created[1].href, './vendor/monthSelect-style.css');
  created[0].onload();
  created[1].onload();
  await tick();
  assert.equal(created.length, 3);
  assert.equal(created[2].src, './vendor/flatpickr.min.js');
  created[2].onload();
  await tick();
  assert.equal(created.length, 4);
  assert.equal(created[3].src, './vendor/monthSelect-index.js');
  created[3].onload();
  await tick();
  assert.equal(created.length, 5);
  assert.equal(created[4].src, './vendor/flatpickr-id.js');
  created[4].onload();
  await p;
  assert.equal(created.length, 5);

  const { created: created2, api: api2 } = makeLoaderSandbox();
  api2.flatpickr = function () {};
  api2.monthSelectPlugin = function () {};
  await api2.ensureFlatpickr();
  assert.equal(created2.length, 0, 'flatpickr + monthSelect sudah ada: tidak boleh menyuntik');
});

test('7d-a lazy-vendors: load gagal bisa dicoba ulang', async () => {
  const { created, api } = makeLoaderSandbox();
  const p = api.ensureChart();
  created[0].onerror(new Error('jaringan putus'));
  await assert.rejects(p, /Gagal memuat chart\.umd\.min\.js/, 'load gagal harus reject (pesan ini internal; pemanggil menampilkan pesan ramah sendiri)');
  assert.equal(created.length, 1);
  const p2 = api.ensureChart();
  assert.equal(created.length, 2, 'percobaan ulang harus menyuntik skrip baru');
  created[1].onload();
  await p2;
});

// ---------- (b-e) dist hasil build ----------

test('7d-b dist: lib berat TIDAK ada di tag dist/index.html, lazy-vendors ada', (t) => {
  const dir = buildTempRepo(t);
  const html = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
  for (const lib of ['jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js', 'chart.umd.min.js', 'flatpickr.min.js', 'monthSelect-index.js', 'flatpickr-id.js']) {
    assert.doesNotMatch(html, new RegExp(`<script[^>]*${lib.replace(/\./g, '\\.')}`), `dist/index.html tidak boleh memuat tag ${lib}`);
  }
  assert.ok(fs.existsSync(path.join(dir, 'dist', 'app', 'lazy-vendors.js')), 'lazy-vendors.js harus ada di dist/app');
  const lazy = fs.readFileSync(path.join(dir, 'dist', 'app', 'lazy-vendors.js'), 'utf8');
  assert.match(lazy, /ensureJsPdf/, 'lazy-vendors.js harus memuat ensureJsPdf');
  assert.match(lazy, /ensureChart/, 'lazy-vendors.js harus memuat ensureChart');
  assert.match(lazy, /ensureFlatpickr/, 'lazy-vendors.js harus memuat ensureFlatpickr');
});

test('7d-b dist: SEMUA tag app defer, jumlah = file dist/app, urutan terjaga', (t) => {
  const dir = buildTempRepo(t);
  const html = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const appFiles = fs.readdirSync(path.join(dir, 'dist', 'app')).filter((f) => f.endsWith('.js'));
  const deferTags = [...noComments.matchAll(/<script defer src="\.\/app\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.equal(deferTags.length, appFiles.length, `tag app defer (${deferTags.length}) harus sama dengan file dist/app (${appFiles.length})`);
  assert.deepEqual([...deferTags].sort(), [...appFiles].sort(), 'setiap file dist/app harus punya tepat satu tag defer');
  assert.doesNotMatch(noComments, /<script src="\.\/app\//, 'tidak boleh ada tag app sinkron (tanpa defer)');
  assert.equal(deferTags[0], 'i18n-dict.js', 'i18n-dict.js harus tetap pertama');
  assert.equal(deferTags[deferTags.length - 1], 'sw-register.js', 'sw-register.js harus tetap terakhir');
  assert.ok(deferTags.indexOf('config.js') > deferTags.indexOf('error-messages.js'), 'config.js tetap setelah error-messages.js');
});

test('7d-c dist: 3 link preload aset kritis ada', (t) => {
  const dir = buildTempRepo(t);
  const html = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
  assert.match(html, /<link rel="preload" href="\.\/vendor\/supabase\.js" as="script">/, 'preload supabase.js harus ada');
  assert.match(html, /<link rel="preload" href="\.\/vendor\/tailwind\.min\.css" as="style">/, 'preload tailwind.min.css harus ada');
  assert.match(html, /<link rel="preload" href="\.\/vendor\/inter\/inter-latin-wght-normal\.woff2" as="font" type="font\/woff2" crossorigin="anonymous">/, 'preload font Inter harus ada');
});

test('7d-d subset: dist memakai subset, file lengkap tidak ada, woff2 kecil', (t) => {
  const dir = buildTempRepo(t);
  const html = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
  for (const w of ['regular', 'bold', 'fill']) {
    assert.match(html, new RegExp(`href="\\.\\/vendor\\/phosphor-subset\\/${w}\\/style\\.css"`), `dist harus memakai subset phosphor ${w}`);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'dist', 'vendor', 'phosphor')), 'file Phosphor lengkap tidak boleh ada di dist/vendor/phosphor');
  for (const [w, fontFile, origSize] of [
    ['regular', 'Phosphor.woff2', 147380],
    ['bold', 'Phosphor-Bold.woff2', 150052],
    ['fill', 'Phosphor-Fill.woff2', 131744]
  ]) {
    const subsetFont = path.join(dir, 'dist', 'vendor', 'phosphor-subset', w, fontFile);
    assert.ok(fs.existsSync(subsetFont), `subset ${w} harus ada di dist`);
    const size = fs.statSync(subsetFont).size;
    assert.ok(size > 0, `subset ${w} tidak boleh kosong`);
    assert.ok(size < origSize / 4, `subset ${w} (${size} byte) harus < 25% dari aslinya (${origSize} byte)`);
    const css = fs.readFileSync(path.join(dir, 'dist', 'vendor', 'phosphor-subset', w, 'style.css'), 'utf8');
    assert.match(css, /font-display:\s*swap/, `subset CSS ${w} harus font-display: swap`);
  }
});

test('7d-d subset: SETIAP ikon yang dirujuk kode ada di subset CSS', () => {
  const used = collectUsedIcons();
  const baseClass = { regular: 'ph', bold: 'ph-bold', fill: 'ph-fill' };
  for (const [weight, names] of Object.entries(used)) {
    const css = fs.readFileSync(path.join(REPO_ROOT, 'web', 'phosphor-subset', weight, 'style.css'), 'utf8');
    for (const name of names) {
      assert.ok(
        css.includes(`.${baseClass[weight]}.ph-${name}:before`),
        `ikon ${name} (bobot ${weight}) dipakai kode tapi TIDAK ada di subset — jalankan node scripts/subset-phosphor.mjs`
      );
    }
  }
  // Jaring pengaman kedua: token ph-<nama> mentah di src/ + web/ harus
  // tercakup di salah satu subset (menangkap ikon yang pemindai lewatkan).
  const allCss = ['regular', 'bold', 'fill']
    .map((w) => fs.readFileSync(path.join(REPO_ROOT, 'web', 'phosphor-subset', w, 'style.css'), 'utf8'))
    .join('\n');
  const files = [
    ...fs.readdirSync(path.join(REPO_ROOT, 'src')).filter((f) => f.endsWith('.html')).map((f) => path.join(REPO_ROOT, 'src', f)),
    ...fs.readdirSync(path.join(REPO_ROOT, 'web')).filter((f) => f.endsWith('.js')).map((f) => path.join(REPO_ROOT, 'web', f))
  ];
  const weightWords = new Set(['bold', 'fill', 'light', 'regular', 'duotone', 'thin']);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bph-([a-z0-9-]+)\b/g)) {
      if (text[m.index + m[0].length] === '-') continue; // awalan pola dinamis ph-<awalan>-${...}
      const name = m[1];
      if (weightWords.has(name)) continue;
      assert.ok(
        allCss.includes(`.ph-${name}:before`),
        `ikon ${name} dirujuk di ${path.basename(file)} tapi TIDAK ada di subset manapun`
      );
    }
  }
});

test('7d-e SW: precache tetap memuat file lazy-vendor + subset (offline)', (t) => {
  const dir = buildTempRepo(t);
  const sw = fs.readFileSync(path.join(dir, 'dist', 'sw.js'), 'utf8');
  for (const f of [
    './vendor/jspdf.umd.min.js', './vendor/jspdf.plugin.autotable.min.js',
    './vendor/chart.umd.min.js', './vendor/flatpickr.min.js',
    './vendor/phosphor-subset/regular/style.css', './vendor/phosphor-subset/regular/Phosphor.woff2',
    './vendor/phosphor-subset/bold/style.css', './vendor/phosphor-subset/fill/style.css',
    './app/lazy-vendors.js'
  ]) {
    assert.ok(sw.includes(f), `SW precache harus memuat ${f}`);
  }
  assert.doesNotMatch(sw, /vendor\/phosphor\/(regular|bold|fill)\//, 'SW tidak boleh mem-precache file Phosphor lengkap');
});
