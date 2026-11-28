// Gelombang 5.2 / Q2, Q3, Q12, Q13 + Q4 — Dependensi dan reproduksibilitas build.
//
// EXECUTION-style (bukan string-match): test ini menjalankan build
// BENAR-BENAR di salinan repo di direktori temp unik (/tmp/wave5-build-*),
// seperti pola tes Wave 3.4, supaya agen paralel tidak pernah bertabrakan.
//
// Yang diuji:
//   (a) dua build dengan SOURCE_DATE_EPOCH yang sama dari checkout bersih
//       menghasilkan keluaran identik (hash seluruh isi dist/).
//   (b) versionCode skema baru (major*1000000+minor*1000+patch): naik
//       monoton dari 32008 (3.20.8 skema lama) dan tidak bertabrakan
//       bila minor/patch mencapai 100.
//   (c) dist/ dibersihkan penuh sebelum build (file basi hilang).
//   (d) minifikasi: modul web/*.js yang dimuat sebagai dist/app/*.js
//       diminifikasi esbuild — total ukuran dist/app/*.js (kecuali
//       config.js) lebih kecil dari build tanpa esbuild, semua file
//       dist/app/*.js tetap valid sintaks (node:vm), penanda global
//       penting tetap ada, sedangkan web/config.js dan file vendor
//       TIDAK diminifikasi (bytes sama persis). Gelombang 7b:
//       dist/index.html tidak lagi memuat satu pun blok <script> inline.
//   (e) vendor baru benar-benar berfungsi: supabase-js 2.119.2
//       (createClient), jspdf 4.2.1 + jspdf-autotable 5.0.9
//       (new jsPDF + doc.autoTable persis seperti pemakaian aplikasi di
//       web/ui-export.js) diuji lewat node:vm.
//   (f) lockfile + pin eksak: package-lock.json ada, package.json tanpa
//       caret/tilde, esbuild ter-pin sebagai devDependency.
//   (g) SOURCE_DATE_EPOCH tidak valid → build gagal dengan jelas.
//
// Catatan: repo temp disalin TANPA node_modules (pola Wave 3.4), lalu
// paket esbuild (+ binari platformnya) disalin secara eksplisit agar
// build di repo temp meminifikasi seperti build nyata. Tanpa esbuild,
// build.mjs sengaja lanjut tanpa minifikasi (dengan peringatan) —
// perilaku fallback itu sendiri diuji di (d).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_TOP_DIRS = new Set(['.git', 'node_modules', 'dist', 'android', 'supabase']);
const SOURCE_DATE_EPOCH = '1795000000'; // 2026-11-18T11:06:40.000Z

function makeTempRepo(t, { withEsbuild = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO_ROOT, src);
      if (!rel) return true;
      return !SKIP_TOP_DIRS.has(rel.split(path.sep)[0]);
    }
  });
  if (withEsbuild) {
    // esbuild + binari platformnya saja (bukan seluruh node_modules).
    for (const pkg of ['esbuild', '@esbuild/linux-x64']) {
      const src = path.join(REPO_ROOT, 'node_modules', pkg);
      assert.ok(fs.existsSync(src), `node_modules/${pkg} harus ada di repo (jalankan npm install)`);
      fs.cpSync(src, path.join(dir, 'node_modules', pkg), { recursive: true });
    }
  }
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

function hashTree(dir) {
  const out = {};
  (function walk(d, rel) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(p, r);
      else if (entry.isFile()) out[r] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  })(dir, '');
  return out;
}

function buildOk(t, extraEnv = {}) {
  const dir = makeTempRepo(t);
  const result = runBuild(dir, extraEnv);
  assert.equal(result.status, 0, `build gagal di repo temp ${dir}:\n${combinedOutput(result)}`);
  return dir;
}

test('5.2a dua build dengan SOURCE_DATE_EPOCH sama menghasilkan dist/ identik', (t) => {
  const dir = buildOk(t, { SOURCE_DATE_EPOCH });
  const first = hashTree(path.join(dir, 'dist'));
  const manifest1 = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'version.json'), 'utf8'));
  assert.equal(manifest1.builtAt, '2026-11-18T11:06:40.000Z', 'builtAt harus berasal dari SOURCE_DATE_EPOCH');

  // Build kedua di checkout yang sama (dist tidak dibersihkan manual —
  // build.mjs sendiri yang membersihkannya).
  const result2 = runBuild(dir, { SOURCE_DATE_EPOCH });
  assert.equal(result2.status, 0, `build kedua gagal:\n${combinedOutput(result2)}`);
  const second = hashTree(path.join(dir, 'dist'));
  assert.deepEqual(second, first, 'dist/ hasil dua build dengan SOURCE_DATE_EPOCH sama harus identik byte-per-byte');
  assert.equal(
    second['index.html'], first['index.html'],
    'dist/index.html harus identik'
  );
  assert.equal(
    second['version.json'], first['version.json'],
    'dist/version.json harus identik'
  );
});

test('5.2a2 tanpa SOURCE_DATE_EPOCH, builtAt memakai waktu sekarang', (t) => {
  const dir = buildOk(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'version.json'), 'utf8'));
  assert.match(manifest.builtAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'builtAt harus ISO-8601 UTC');
  assert.ok(Date.parse(manifest.builtAt) <= Date.now() + 60000, 'builtAt tidak boleh di masa depan');
});

test('5.2g SOURCE_DATE_EPOCH tidak valid membuat build gagal', (t) => {
  const dir = makeTempRepo(t);
  const result = runBuild(dir, { SOURCE_DATE_EPOCH: 'bukan-angka' });
  assert.notEqual(result.status, 0, 'build harus gagal bila SOURCE_DATE_EPOCH tidak valid');
  assert.match(combinedOutput(result), /SOURCE_DATE_EPOCH/, 'error harus menyebut SOURCE_DATE_EPOCH');
});

test('5.2b versionCode skema baru: monoton naik dan tanpa tabrakan minor/patch 100', async (t) => {
  // (i) computeAndroidVersion di patch-android-project.mjs.
  const mod = await import(pathToFileURL(path.resolve(REPO_ROOT, 'scripts', 'patch-android-project.mjs')).href);
  const cases = [
    ['3.20.8', 3020008],
    ['3.20.9', 3020009],
    ['3.100.0', 3100000],
    ['3.0.100', 3000100],
    ['3.99.999', 3099999],
    ['4.0.0', 4000000]
  ];
  for (const [version, expected] of cases) {
    assert.equal(mod.computeAndroidVersion(version).versionCode, expected, `versionCode ${version}`);
  }
  // Skema lama menabrakan 3.100.0 dan 3.0.100 (keduanya 40000);
  // skema baru harus membedakan keduanya.
  assert.notEqual(
    mod.computeAndroidVersion('3.100.0').versionCode,
    mod.computeAndroidVersion('3.0.100').versionCode,
    '3.100.0 dan 3.0.100 tidak boleh bertabrakan'
  );
  // Monoton dari nilai lama yang sudah ter-install (3.20.8 = 32008).
  assert.ok(mod.computeAndroidVersion('3.20.9').versionCode > 32008, '3.20.9 baru harus > 32008 (3.20.8 skema lama)');

  // (ii) parseVersionCode di build.mjs — diuji lewat version.json hasil
  // build (build.mjs tidak mengekspor fungsinya).
  const dir = makeTempRepo(t);
  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = '3.20.9';
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const result = runBuild(dir, { SOURCE_DATE_EPOCH });
  assert.equal(result.status, 0, `build gagal:\n${combinedOutput(result)}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'version.json'), 'utf8'));
  assert.equal(manifest.version, '3.20.9');
  assert.equal(manifest.versionCode, 3020009, 'version.json 3.20.9 harus 3020009 (skema baru)');
  assert.ok(manifest.versionCode > 32008, 'versionCode 3.20.9 harus > 32008');
});

test('5.2c build membersihkan dist/ penuh — file basi hilang', (t) => {
  const dir = buildOk(t, { SOURCE_DATE_EPOCH });
  // Simulasikan file basi dari build lama: halaman yang sudah tidak
  // dihasilkan lagi + file vendor basi + index.html lama.
  fs.writeFileSync(path.join(dir, 'dist', 'halaman-lama.html'), '<h1>basi</h1>');
  fs.mkdirSync(path.join(dir, 'dist', 'vendor-lama'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'vendor', 'basi.js'), '// basi');
  const result = runBuild(dir, { SOURCE_DATE_EPOCH });
  assert.equal(result.status, 0, `build kedua gagal:\n${combinedOutput(result)}`);
  assert.equal(fs.existsSync(path.join(dir, 'dist', 'halaman-lama.html')), false, 'file basi halaman-lama.html harus hilang setelah build');
  assert.equal(fs.existsSync(path.join(dir, 'dist', 'vendor-lama')), false, 'direktori basi harus hilang setelah build');
  assert.equal(fs.existsSync(path.join(dir, 'dist', 'vendor', 'basi.js')), false, 'file vendor basi harus hilang setelah build');
  assert.ok(fs.existsSync(path.join(dir, 'dist', 'index.html')), 'index.html hasil build harus ada');
  assert.ok(fs.existsSync(path.join(dir, 'dist', 'vendor', 'supabase.js')), 'vendor supabase.js hasil build harus ada');
});

test('5.2d minifikasi: dist/app/*.js lebih kecil, sintaks valid, global utuh, config & vendor tidak diminifikasi', (t) => {
  const dir = makeTempRepo(t, { withEsbuild: false });
  // Build TANPA esbuild (fallback tanpa minifikasi) sebagai pembanding.
  const plain = runBuild(dir, { SOURCE_DATE_EPOCH });
  assert.equal(plain.status, 0, `build tanpa esbuild gagal:\n${combinedOutput(plain)}`);
  assert.match(combinedOutput(plain), /TANPA minifikasi/, 'build tanpa esbuild harus memperingatkan fallback tanpa minifikasi');
  // Gelombang 7b: modul tidak lagi di-inline — yang dibandingkan adalah
  // total ukuran file dist/app/*.js (kecuali config.js yang verbatim).
  const appSize = (base) => fs.readdirSync(path.join(base, 'dist', 'app'))
    .filter((f) => f.endsWith('.js') && f !== 'config.js')
    .reduce((sum, f) => sum + fs.statSync(path.join(base, 'dist', 'app', f)).size, 0);
  const plainSize = appSize(dir);
  const plainHtml = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');

  // Build DENGAN esbuild (minifikasi).
  for (const pkg of ['esbuild', '@esbuild/linux-x64']) {
    fs.cpSync(path.join(REPO_ROOT, 'node_modules', pkg), path.join(dir, 'node_modules', pkg), { recursive: true });
  }
  const mini = runBuild(dir, { SOURCE_DATE_EPOCH });
  assert.equal(mini.status, 0, `build dengan esbuild gagal:\n${combinedOutput(mini)}`);
  assert.doesNotMatch(combinedOutput(mini), /TANPA minifikasi/, 'build dengan esbuild tidak boleh fallback tanpa minifikasi');
  const miniHtml = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
  const miniSize = appSize(dir);
  assert.ok(
    miniSize < plainSize * 0.85,
    `dist/app/*.js minified (${miniSize} B) harus < 85% dari tanpa minifikasi (${plainSize} B)`
  );

  // Gelombang 7b: dist/index.html TIDAK boleh lagi memuat blok <script>
  // inline — semua modul dimuat lewat <script src="./app/...">.
  const inlineBlocks = [...miniHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inlineBlocks.length, 0, `dist/index.html tidak boleh memuat blok <script> inline, ketemu ${inlineBlocks.length}`);
  const appTags = [...miniHtml.matchAll(/<script src="\.\/app\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(appTags.length > 40, `harus ada >40 tag <script src="./app/...">, ketemu ${appTags.length}`);
  for (const f of appTags) {
    assert.ok(fs.existsSync(path.join(dir, 'dist', 'app', f)), `dist/app/${f} yang dirujuk dist/index.html harus ada`);
  }

  // Semua file dist/app/*.js hasil minifikasi harus valid sintaks.
  for (const f of appTags) {
    const code = fs.readFileSync(path.join(dir, 'dist', 'app', f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(code), `dist/app/${f} harus valid sintaks setelah minifikasi`);
  }

  // Penanda global penting harus tetap ada (modul berkomunikasi lewat
  // global; esbuild tidak boleh mengganti namanya).
  const concatenated = appTags.map((f) => fs.readFileSync(path.join(dir, 'dist', 'app', f), 'utf8')).join('\n');
  for (const marker of ['__mkPasswordPolicy', 'showActionError', 'exportPDF', 'createClient', 'autoTable']) {
    assert.ok(concatenated.includes(marker), `dist/app minified harus tetap memuat penanda global ${marker}`);
  }

  // web/config.js TIDAK diminifikasi: dist/app/config.js harus sama
  // persis (bytes) dengan web/config.js.
  assert.deepEqual(
    fs.readFileSync(path.join(dir, 'dist', 'app', 'config.js')),
    fs.readFileSync(path.join(REPO_ROOT, 'web', 'config.js')),
    'dist/app/config.js harus sama persis dengan web/config.js (verbatim, tidak diminifikasi)'
  );

  // File vendor TIDAK diminifikasi: bytes dist/vendor sama persis.
  for (const f of ['supabase.js', 'jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js']) {
    assert.deepEqual(
      fs.readFileSync(path.join(dir, 'dist', 'vendor', f)),
      fs.readFileSync(path.join(REPO_ROOT, 'web', 'vendor', f)),
      `dist/vendor/${f} harus sama persis dengan web/vendor/${f} (tidak diminifikasi)`
    );
  }
  // Build tanpa esbuild juga harus sudah eksternal (bukan inline).
  assert.equal(
    [...plainHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].length, 0,
    'build tanpa esbuild pun tidak boleh meng-inline modul'
  );
});

test('5.2e vendor baru berfungsi: supabase-js 2.119.2 + jspdf 4.2.1 + autotable 5.0.9', async (t) => {
  // Sandbox browser minimal untuk UMD vendor (sama seperti pemakaian
  // aplikasi: script tag biasa, window global).
  const sandbox = {
    console,
    navigator: { userAgent: 'node' },
    atob: (x) => Buffer.from(x, 'base64').toString('binary'),
    btoa: (x) => Buffer.from(x, 'binary').toString('base64'),
    TextEncoder,
    TextDecoder,
    URL,
    Blob,
    Headers,
    Request,
    Response,
    fetch,
    WebSocket,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    crypto: globalThis.crypto,
    document: {
      createElement: () => ({
        getContext: () => ({
          measureText: () => ({ width: 10 }), fillRect() {}, clearRect() {},
          save() {}, restore() {}, scale() {}, translate() {}, font: ''
        }),
        style: {}, width: 0, height: 0, toDataURL: () => ''
      })
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const load = (file) => {
    vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'web', 'vendor', file), 'utf8'), sandbox, { filename: file });
  };

  // supabase-js: global + createClient seperti dipakai web/config.js +
  // web/supabase-core.js (tanpa network: konstruksi saja).
  load('supabase.js');
  assert.equal(typeof sandbox.window.supabase, 'object', 'window.supabase harus ada (UMD supabase-js 2.119.2)');
  assert.equal(typeof sandbox.window.supabase.createClient, 'function', 'supabase.createClient harus ada');
  const client = sandbox.window.supabase.createClient(
    'https://usauytablxbiktnepwsi.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYXV5dGFibHhiaWt0bmVwd3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMjQ1NzMsImV4cCI6MjA3OTYwMDU3M30.test'
  );
  assert.equal(typeof client.from, 'function', 'client.from harus ada');
  assert.equal(typeof client.auth.signInWithPassword, 'function', 'client.auth.signInWithPassword harus ada');

  // jspdf + autotable: persis pemakaian aplikasi di web/ui-export.js
  // (new jsPDF('p','mm','a4') lalu doc.autoTable({head, body, theme,
  // didParseCell})).
  load('jspdf.umd.min.js');
  assert.equal(typeof sandbox.window.jspdf?.jsPDF, 'function', 'window.jspdf.jsPDF harus ada (UMD jspdf 4.2.1)');
  load('jspdf.plugin.autotable.min.js');
  const { jsPDF } = sandbox.window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  assert.equal(typeof doc.autoTable, 'function', 'doc.autoTable harus ada (autotable 5.0.9 terpasang ke jsPDF)');
  doc.text('Laporan', 10, 10);
  doc.autoTable({
    startY: 76,
    head: [['Tanggal', 'Tipe', 'Kategori', 'Dompet', 'Catatan', 'Nominal']],
    body: [
      ['2026-11-28', 'Pemasukan', 'Gaji', 'BCA', '-', '10000000'],
      ['2026-11-28', 'Pengeluaran', 'Makan', 'BCA', '-', '50000']
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', halign: 'center' },
    styles: { fontSize: 8.5, cellPadding: 4.5, font: 'helvetica' },
    columnStyles: { 5: { halign: 'right', fontStyle: 'bold', cellWidth: 32 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        data.cell.styles.textColor = [5, 150, 105];
      }
    }
  });
  const pdf = doc.output('arraybuffer');
  assert.ok(pdf.byteLength > 1000, `PDF hasil autoTable harus berisi data (ketemu ${pdf.byteLength} byte)`);
  assert.ok(doc.lastAutoTable.finalY > 76, 'tabel harus tergambar (lastAutoTable.finalY > startY)');
  assert.equal(doc.internal.getNumberOfPages(), 1, 'laporan 2 baris harus muat 1 halaman');

  // Matikan heartbeat RealtimeClient supaya tidak ada aktivitas async
  // (setInterval) yang tersisa setelah tes selesai.
  try { await client.removeAllChannels(); } catch { /* abaikan */ }
  try { client.realtime?.disconnect?.(); } catch { /* abaikan */ }
});

test('5.2f lockfile ada dan versi npm ter-pin eksak (tanpa caret/tilde)', () => {
  const lockPath = path.join(REPO_ROOT, 'package-lock.json');
  assert.ok(fs.existsSync(lockPath), 'package-lock.json harus ada (dibuat dari npm install)');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.ok(lock.packages && Object.keys(lock.packages).length > 100, 'lockfile harus memuat seluruh pohon dependensi');
  assert.equal(lock.packages['node_modules/esbuild']?.version, '0.28.2', 'lockfile harus mem-pin esbuild 0.28.2');

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(pkg[section] || {})) {
      assert.match(String(version), /^\d+\.\d+\.\d+$/, `${section}.${name} harus ter-pin eksak (tanpa ^/~), ketemu ${version}`);
      assert.equal(
        lock.packages[`node_modules/${name}`]?.version, version,
        `lockfile harus memuat ${name}@${version} yang sama dengan package.json`
      );
    }
  }
  assert.equal(pkg.devDependencies.esbuild, '0.28.2', 'esbuild harus ter-pin sebagai devDependency');
});
