// Gelombang 5.3 (Q7 + Q10): urutan modul eksplisit + helper bersama.
//
// Q7 — Urutan dan dependensi modul eksplisit, bukan lagi implisit lewat
// array di build.mjs. Setiap modul web/*.js yang memakai global dari
// modul lain mendeklarasikannya di baris pertama sebagai
//   // @depends-on: error-messages.js, ui-state.js
// Tes ini membaca urutan pemuatan dari build.mjs + urutan include() di
// src/Index.html, membaca semua header @depends-on, lalu mengassert
// urutan topologisnya benar (dependensi dimuat sebelum yang bergantung).
// Aturan header yang dipakai di repo ini:
//   - error-messages.js — helper bersama (escapeHtml, localToday,
//     localDateKey, isValidIsoDate); dimuat PERTAMA di WEB_MODULES.
//   - ui-state.js — sanitizer + render core (escapeHtmlJS,
//     escapeAttrJS, renderHtml, mkActionAttrs); pertama di UI_CORE.
//   - password-policy.js — validator kata sandi/PIN; pertama di
//     grup SUPABASE_MODULES (didokumentasikan di komentar build.mjs).
//   - finance-analysis-core.js — dipakai keluarga finance-analysis-*
//     (dan finance-analysis.js yang menggabungkannya).
// Modul yang TIDAK dideklarasikan di sini: config.js / sw.js (tidak
// di-inline build.mjs), serta dependensi lunak dengan fallback
// (mis. pembaca password-policy di UI_CORE yang dimuat sebelum
// grup Supabase — mendeklarasikannya akan membuat tes ini gagal
// dengan benar, karena memang bukan jaminan urutan).
//
// Q10 — Helper bersama di web/error-messages.js (dimuat pertama).
// Tes ini juga mengeksekusi helper itu di vm dan membuktikan:
//   - localToday()/localDateKey() memakai komponen LOKAL, bukan
//     toISOString() (UTC) — di WIB sebelum 07:00, tanggal UTC
//     masih kemarin (kelas bug Gelombang 3).
//   - rantai delegasi escapeHtml -> escapeHtmlJS -> escapeAuthAttr
//     bekerja dalam urutan build yang sebenarnya.
//   - pola fallback UTC lama sudah hilang dari web/*.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const buildMjs = fs.readFileSync('build.mjs', 'utf8');
const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
const webFiles = fs.readdirSync('web').filter((f) => f.endsWith('.js'));

// ------------------------------------------------------------------
// Pembaca urutan modul dari build.mjs + src/Index.html
// ------------------------------------------------------------------

function parseModuleArray(src, name) {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(src);
  assert.ok(m, `build.mjs harus mendefinisikan ${name}`);
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/'([^']+\.js)'/g)].map((x) => x[1]);
}

const GROUPS = {
  WEB_MODULES: parseModuleArray(buildMjs, 'WEB_MODULES'),
  UI_CORE_MODULES: parseModuleArray(buildMjs, 'UI_CORE_MODULES'),
  SUPABASE_MODULES: parseModuleArray(buildMjs, 'SUPABASE_MODULES'),
  UI_FEATURES_MODULES: parseModuleArray(buildMjs, 'UI_FEATURES_MODULES'),
  UI_PRO_MODULES: parseModuleArray(buildMjs, 'UI_PRO_MODULES')
};

// Urutan include() di src/Index.html menentukan urutan grup di halaman:
// include('scripts') -> WEB + UI_CORE + config + SUPABASE (sesuai
// urutan readInlineScripts() di cabang 'scripts' build.mjs),
// lalu include('features-v21') dan include('features-v35').
function pageLoadOrder() {
  const includes = [...indexHtml.matchAll(/include\('([^']+)'\)/g)].map((m) => m[1]);
  const scriptsIdx = includes.indexOf('scripts');
  const feat21Idx = includes.indexOf('features-v21');
  const feat35Idx = includes.indexOf('features-v35');
  assert.ok(scriptsIdx !== -1 && feat21Idx !== -1 && feat35Idx !== -1,
    'Index.html harus include scripts, features-v21, dan features-v35');
  assert.ok(scriptsIdx < feat21Idx && feat21Idx < feat35Idx,
    'urutan include() harus: scripts, features-v21, features-v35');

  const scriptsBlock = /if \(name === 'scripts'\) \{([\s\S]*?)\n    \}/.exec(buildMjs);
  assert.ok(scriptsBlock, "build.mjs harus punya cabang include('scripts')");
  const scriptsGroups = [...scriptsBlock[1].matchAll(/readInlineScripts\(([A-Z_]+)\)/g)]
    .map((m) => m[1]);
  assert.deepEqual(scriptsGroups, ['WEB_MODULES', 'UI_CORE_MODULES', 'SUPABASE_MODULES'],
    "cabang 'scripts' harus meng-inline WEB, lalu UI_CORE, lalu SUPABASE");

  const feat21Group = /if \(name === 'features-v21'\) return readInlineScripts\(([A-Z_]+)\)/
    .exec(buildMjs)[1];
  const feat35Group = /if \(name === 'features-v35'\) return readInlineScripts\(([A-Z_]+)\)/
    .exec(buildMjs)[1];
  assert.equal(feat21Group, 'UI_FEATURES_MODULES');
  assert.equal(feat35Group, 'UI_PRO_MODULES');

  return [
    ...GROUPS.WEB_MODULES,
    ...GROUPS.UI_CORE_MODULES,
    ...GROUPS.SUPABASE_MODULES,
    ...GROUPS.UI_FEATURES_MODULES,
    ...GROUPS.UI_PRO_MODULES
  ];
}

const LOAD_ORDER = pageLoadOrder();

// ------------------------------------------------------------------
// Pembaca header @depends-on
// ------------------------------------------------------------------

function parseDependsOn(src) {
  const deps = [];
  for (const m of src.matchAll(/\/\/ @depends-on: ([^\n]+)/g)) {
    // Catatan dalam kurung setelah daftar (mis. "(lunak: ...)") bukan
    // nama modul — buang sebelum memecah koma.
    const list = m[1].split('(')[0];
    deps.push(...list.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return [...new Set(deps)];
}

function readAllDependsOn() {
  const out = {};
  for (const file of webFiles) {
    const deps = parseDependsOn(fs.readFileSync(`web/${file}`, 'utf8'));
    if (deps.length) out[file] = deps;
  }
  return out;
}

// Checker murni: mengembalikan daftar pelanggaran urutan topologis.
// Dipakai untuk urutan asli (harus kosong) DAN untuk urutan yang
// sengaja dibalik (harus TIDAK kosong — bukti tes ini peka).
function checkOrder(order, depsByModule) {
  const pos = new Map(order.map((m, i) => [m, i]));
  const violations = [];
  for (const [mod, deps] of Object.entries(depsByModule)) {
    if (!pos.has(mod)) {
      violations.push(`${mod} mendeklarasikan dependensi tapi tidak ada di urutan build`);
      continue;
    }
    for (const dep of deps) {
      if (!pos.has(dep)) {
        violations.push(`${mod} bergantung pada ${dep} yang tidak ada di urutan build`);
      } else if (pos.get(dep) >= pos.get(mod)) {
        violations.push(`${dep} harus dimuat sebelum ${mod} (posisi ${pos.get(dep)} >= ${pos.get(mod)})`);
      }
    }
  }
  return violations;
}

// ------------------------------------------------------------------
// Q7: urutan topologis
// ------------------------------------------------------------------

test('5.3/Q7 urutan modul build.mjs lengkap: ada di disk, tanpa duplikat', () => {
  const seen = new Set();
  for (const mod of LOAD_ORDER) {
    assert.ok(fs.existsSync(`web/${mod}`), `modul di build.mjs harus ada: web/${mod}`);
    assert.ok(!seen.has(mod), `modul duplikat di urutan build: ${mod}`);
    seen.add(mod);
  }
  for (const group of Object.values(GROUPS)) assert.ok(group.length > 0);
});

test('5.3/Q7 semua @depends-on dimuat sebelum modul yang bergantung', () => {
  const deps = readAllDependsOn();
  assert.ok(Object.keys(deps).length >= 30,
    `diharapkan >= 30 modul mendeklarasikan @depends-on, dapat ${Object.keys(deps).length}`);
  assert.deepEqual(checkOrder(LOAD_ORDER, deps), []);
});

test('5.3/Q7 batas yang didokumentasikan di build.mjs: error-messages pertama, password-policy pertama di grup Supabase', () => {
  assert.equal(LOAD_ORDER[0], 'error-messages.js',
    'error-messages.js HARUS dimuat pertama (semua modul memakai helper bersamanya)');
  assert.equal(GROUPS.SUPABASE_MODULES[0], 'password-policy.js',
    'password-policy.js HARUS entri PERTAMA SUPABASE_MODULES (sebelum consumer password/PIN)');
});

test('5.3/Q7 ui-state.js dimuat tepat sebelum ui-delegated-actions.js (adjacency Gelombang 2.4)', () => {
  const i = LOAD_ORDER.indexOf('ui-state.js');
  assert.ok(i !== -1);
  assert.equal(LOAD_ORDER[i + 1], 'ui-delegated-actions.js');
});

test('5.3/Q7 header @depends-on mencakup dependensi helper bersama yang dibuat di Gelombang 5.3', () => {
  const deps = readAllDependsOn();
  assert.deepEqual(deps['ui-ai.js'], ['error-messages.js', 'ui-state.js']);
  assert.deepEqual(deps['supabase-auth-ui.js'],
    ['error-messages.js', 'ui-state.js', 'password-policy.js']);
  assert.deepEqual(deps['finance-analysis.js'], [
    'finance-analysis-core.js', 'finance-analysis-portfolio.js',
    'finance-analysis-ai.js', 'finance-analysis-backup.js'
  ]);
  assert.ok(deps['ui-feat-recurring.js'].includes('error-messages.js'));
  assert.ok(deps['ui-wallets.js'].includes('error-messages.js'),
    'ui-wallets.js kini memakai localToday() kanonis dari error-messages.js');
});

test('5.3/Q7 NEGATIF: checker mendeteksi urutan build yang dibalik / digeser', () => {
  const deps = readAllDependsOn();
  const reversed = checkOrder([...LOAD_ORDER].reverse(), deps);
  assert.ok(reversed.length > 0, 'urutan terbalik harus dilaporkan sebagai pelanggaran');
  assert.ok(reversed.some((v) => v.includes('error-messages.js')),
    'urutan terbalik harus menyebut error-messages.js yang jadi dimuat terakhir');

  // Satu geseran kecil saja sudah harus ketahuan: password-policy.js
  // dipindah ke akhir grup Supabase.
  const moved = [...LOAD_ORDER];
  const from = moved.indexOf('password-policy.js');
  moved.splice(from, 1);
  moved.splice(moved.indexOf('supabase-api.js') + 1, 0, 'password-policy.js');
  const shifted = checkOrder(moved, deps);
  assert.ok(shifted.length > 0, 'menggeser password-policy.js ke akhir grup harus ketahuan');
  assert.ok(shifted.some((v) => v.includes('password-policy.js')));
});

// ------------------------------------------------------------------
// Q10: helper bersama — eksekusi di vm (bukan string-match)
// ------------------------------------------------------------------

function loadErrorMessagesSandbox() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/error-messages.js', 'utf8'), sandbox);
  return sandbox;
}

test('5.3/Q10 localToday()/localDateKey() memakai komponen LOKAL, bukan UTC (regresi WIB)', () => {
  const sb = loadErrorMessagesSandbox();
  // 28 Nov 2026 00:30 waktu LOKAL. Di WIB itu 27 Nov 17:30 UTC —
  // toISOString() lama akan mengembalikan '2026-11-27' (kemarin).
  const earlyMorning = new Date(2026, 10, 28, 0, 30, 0);
  assert.equal(sb.localDateKey(earlyMorning), '2026-11-28');
  assert.equal(sb.localToday(), sb.localDateKey(new Date()));
  if (new Date().getTimezoneOffset() === -420) {
    assert.equal(earlyMorning.toISOString().slice(0, 10), '2026-11-27',
      'bukti kelas bug lama: irisan UTC pada 00:30 WIB memberi tanggal kemarin');
  }
  assert.equal(sb.localDateKey(new Date('bukan-tanggal')), '');
});

test('5.3/Q10 isValidIsoDate() menolak tanggal kalender tak nyata tanpa round-trip UTC', () => {
  const sb = loadErrorMessagesSandbox();
  assert.equal(sb.isValidIsoDate('2026-02-28'), true);
  assert.equal(sb.isValidIsoDate('2026-02-30'), false);
  assert.equal(sb.isValidIsoDate('2026-13-01'), false);
  assert.equal(sb.isValidIsoDate('2026-1-1'), false);
  assert.equal(sb.isValidIsoDate(''), false);
  assert.equal(sb.isValidIsoDate('2026-11-28'), true);
});

test('5.3/Q10 escapeHtml() kanonis meng-escape lima karakter', () => {
  const sb = loadErrorMessagesSandbox();
  assert.equal(sb.escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(sb.escapeHtml(null), '');
  assert.equal(sb.escapeHtml(42), '42');
});

test('5.3/Q10 rantai delegasi escape bekerja dalam urutan build (error-messages -> ui-state -> auth-ui)', () => {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { classList: { contains: () => false } } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Muat sesuai urutan build: error-messages.js (WEB pertama),
  // ui-state.js (UI_CORE pertama), supabase-auth-ui.js (SUPABASE).
  vm.runInContext(fs.readFileSync('web/error-messages.js', 'utf8'), sandbox);
  // ui-state.js butuh DOMParser minimal untuk sanitizer-nya.
  sandbox.DOMParser = class {
    parseFromString() { return { body: { childNodes: [] } }; }
  };
  vm.runInContext(fs.readFileSync('web/ui-state.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync('web/supabase-auth-ui.js', 'utf8'), sandbox);

  assert.equal(sandbox.escapeHtmlJS('<b>&'), '&lt;b&gt;&amp;',
    'escapeHtmlJS harus mendelegasikan ke escapeHtml() kanonis');
  const theme = {
    textMain: '#000', textMuted: '#666', field: '', fieldLabel: '',
    passInputGroup: () => '', primaryBtn: '', linkStyle: ''
  };
  const html = sandbox.__mkAuthUi.buildAuthModeFields('login', theme, 'a<b@c.com', false);
  assert.match(html, /value="a&lt;b@c\.com"/,
    'escapeAuthAttr harus sampai ke escapeHtml() kanonis lewat escapeHtmlJS');
});

test('5.3/Q10 ui-state.js mandiri: fallback escapeHtmlJS tetap jalan tanpa error-messages.js', () => {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  sandbox.DOMParser = class {
    parseFromString() { return { body: { childNodes: [] } }; }
  };
  vm.runInContext(fs.readFileSync('web/ui-state.js', 'utf8'), sandbox);
  assert.equal(sandbox.escapeHtmlJS('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
});

test('5.3/Q10 formatDate() (finance-analysis-core) mendelegasikan ke localDateKey()', () => {
  // Modul Node: guarded require('./error-messages.js') di dalamnya
  // menyediakan localDateKey() sebagai global.
  const core = require('../web/finance-analysis-core.js');
  assert.equal(core.formatDate(new Date(2026, 10, 28, 0, 30)), '2026-11-28');
  assert.deepEqual(core.getPeriodRange('2026-01', 28), {
    start: '2025-12-28', end: '2026-01-27'
  });
});

test('5.3/Q10 normalizeDateString() (transaction-import) memakai isValidIsoDate()', () => {
  const ti = require('../web/transaction-import.js');
  assert.equal(ti.normalizeDateString('2026-02-28'), '2026-02-28');
  assert.equal(ti.normalizeDateString('2026-02-30'), '');
  assert.equal(ti.normalizeDateString('30/02/2026'), '');
  assert.equal(ti.normalizeDateString('28/02/2026'), '2026-02-28');
});

// ------------------------------------------------------------------
// Q10: pola lama sudah hilang (string-match sebagai jaring pengaman)
// ------------------------------------------------------------------

test('5.3/Q10 pola fallback UTC "hari ini" sudah hilang dari semua web/*.js', () => {
  const forbidden = /typeof (root\.)?localToday === 'function' \? (root\.)?localToday\(\) : new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/;
  for (const file of webFiles) {
    const src = fs.readFileSync(`web/${file}`, 'utf8');
    assert.doesNotMatch(src, forbidden,
      `${file} masih memakai fallback UTC untuk tanggal hari ini`);
  }
});

test('5.3/Q10 rantai escape duplikat sudah hilang (hanya kanonis + fallback ui-state.js yang tersisa)', () => {
  for (const file of ['ui-ai.js', 'ui-feat-updates.js', 'supabase-auth-ui.js']) {
    const src = fs.readFileSync(`web/${file}`, 'utf8');
    assert.doesNotMatch(src, /\.replace\(\/&\/g, '&amp;'\)/,
      `${file} masih menyimpan salinan rantai escape HTML`);
  }
  // Yang boleh tersisa: implementasi kanonis di error-messages.js
  // (bentuk map) dan fallback mandiri di ui-state.js + escapeAttrJS
  // (helper JS-string yang berbeda, bukan duplikat escape HTML).
  const canonical = fs.readFileSync('web/error-messages.js', 'utf8');
  assert.match(canonical, /function escapeHtml\(value\)/);
});
