const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* ============================================================
   Gelombang 2.4 — XSS/CSP (T11, T12)
   ------------------------------------------------------------
   Node tidak punya DOM, jadi tes sanitizer memakai DOMParser
   stub minimal di bawah (FakeDOMParser). Stub ini hanya
   mengimplementasikan API yang dipakai sanitizer di
   web/ui-state.js (childNodes, tagName, attributes,
   get/set/removeAttribute, remove, insertBefore, innerHTML,
   querySelector tag sederhana) — bila sanitizer memakai API di
   luar itu, tes ini akan gagal, dan itu disengaja.
   ============================================================ */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr',
  'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style']);

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

class FakeAttr {
  constructor(name, value) { this.name = name; this.value = value; }
}

class FakeNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }

  remove() {
    if (!this.parentNode) return;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
    this.parentNode = null;
  }

  insertBefore(node, ref) {
    if (node.parentNode) node.remove();
    node.parentNode = this;
    const idx = ref ? this.childNodes.indexOf(ref) : -1;
    if (idx >= 0) this.childNodes.splice(idx, 0, node);
    else this.childNodes.push(node);
    return node;
  }

  appendChild(node) { return this.insertBefore(node, null); }
}

class FakeText extends FakeNode {
  constructor(text) { super(3); this.textContent = text; }

  get innerHTML() { return escapeText(this.textContent); }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super(1);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = [];
    this._classList = new Set();
  }

  getAttribute(name) {
    const found = this.attributes.find((a) => a.name.toLowerCase() === String(name).toLowerCase());
    return found ? found.value : null;
  }

  setAttribute(name, value) {
    const found = this.attributes.find((a) => a.name.toLowerCase() === String(name).toLowerCase());
    if (found) found.value = String(value);
    else this.attributes.push(new FakeAttr(String(name), String(value)));
  }

  removeAttribute(name) {
    this.attributes = this.attributes.filter((a) => a.name.toLowerCase() !== String(name).toLowerCase());
  }

  hasAttribute(name) { return this.getAttribute(name) !== null; }

  get dataset() {
    const out = {};
    for (const a of this.attributes) {
      if (a.name.startsWith('data-')) {
        const key = a.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        out[key] = a.value;
      }
    }
    return out;
  }

  get classList() {
    const self = this;
    return {
      add(c) { self._classList.add(c); },
      contains(c) { return self._classList.has(c); }
    };
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent || '').join('');
  }

  set textContent(v) {
    this.childNodes = [];
    if (v) this.appendChild(new FakeText(String(v)));
  }

  get innerHTML() {
    return this.childNodes.map((c) => serializeNode(c)).join('');
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    for (const n of nodes) this.appendChild(n);
  }

  querySelector(sel) {
    const tag = String(sel).toLowerCase();
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 1) {
          if (c.tagName.toLowerCase() === tag) return c;
          const found = walk(c);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(this);
  }

  closest(sel) {
    if (sel !== '[data-action]') return null;
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-action') !== null) return node;
      node = node.parentNode;
    }
    return null;
  }
}

function serializeNode(node) {
  if (node.nodeType === 3) return escapeText(node.textContent);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  const attrs = node.attributes.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('');
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.childNodes.map((c) => serializeNode(c)).join('')}</${tag}>`;
}

function parseAttrs(str) {
  const attrs = [];
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    attrs.push(new FakeAttr(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')));
  }
  return attrs;
}

function parseHtmlInto(parent, html) {
  const stack = [parent];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const text = decodeEntities(html.slice(i));
      if (text) top().appendChild(new FakeText(text));
      break;
    }
    if (lt > i) {
      const text = decodeEntities(html.slice(i, lt));
      if (text) top().appendChild(new FakeText(text));
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      const comment = new FakeNode(8);
      top().appendChild(comment);
      continue;
    }
    // Cari '>' penutup tag dengan menghormati nilai atribut ber-kutip
    // (mis. href="data:text/html,<script>..." mengandung '<' dan '>').
    let gt = -1;
    let quote = null;
    for (let j = lt + 1; j < html.length; j++) {
      const ch = html[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') { gt = j; break; }
    }
    if (gt === -1) break;
    const raw = html.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('!') || raw.startsWith('?')) continue;
    if (raw.startsWith('/')) {
      const tag = raw.slice(1).trim().split(/\s+/)[0].toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName.toLowerCase() === tag) { stack.length = s; break; }
      }
      continue;
    }
    const selfClosing = raw.trimEnd().endsWith('/');
    const clean = selfClosing ? raw.trimEnd().slice(0, -1) : raw;
    const space = clean.search(/\s/);
    const tag = (space === -1 ? clean : clean.slice(0, space)).toLowerCase();
    if (!tag) continue;
    const el = new FakeElement(tag);
    el.attributes = parseAttrs(space === -1 ? '' : clean.slice(space + 1));
    top().appendChild(el);
    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      const content = m ? rest.slice(0, m.index) : rest;
      if (content) el.appendChild(new FakeText(content));
      i = m ? i + m.index + m[0].length : html.length;
      continue;
    }
    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(el);
  }
}

class FakeDocument {
  constructor() { this.body = new FakeElement('body'); }
}

class FakeDOMParser {
  parseFromString(html) {
    const doc = new FakeDocument();
    parseHtmlInto(doc.body, String(html));
    return doc;
  }
}

function loadUiState() {
  const sandbox = {
    console,
    DOMParser: FakeDOMParser,
    localStorage: { getItem: () => null, setItem: () => {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/ui-state.js', 'utf8'), sandbox);
  return sandbox;
}

function loadDelegatedActions() {
  const listeners = {};
  const elementsById = {};
  const documentStub = {
    listeners,
    elementsById,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    getElementById(id) { return elementsById[id] || null; }
  };
  const sandbox = { console, document: documentStub };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/ui-delegated-actions.js', 'utf8'), sandbox);
  return { sandbox, documentStub, listeners, elementsById };
}

function fakeEl(tag, attrs, { checked = false, value = '' } = {}) {
  const el = new FakeElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  el.checked = checked;
  el.value = value;
  return el;
}

function fakeEvent(type, target, extra = {}) {
  return {
    type,
    target,
    preventDefaultCalled: false,
    preventDefault() { this.preventDefaultCalled = true; },
    ...extra
  };
}

/* ---------------- Sanitizer ---------------- */

test('2.4 sanitizer: event handler dihapus (onclick, onerror, onbegin di svg)', () => {
  const { sanitizeHtml } = loadUiState();
  const out = sanitizeHtml(
    '<div onclick="alert(1)"><img src="https://a.example/x.png" onerror="alert(2)">' +
    '<svg onload="alert(3)"><animate onbegin="alert(4)"/></svg><p>teks</p></div>'
  );
  assert.doesNotMatch(out, /on(click|error|load|begin)=/i);
  assert.doesNotMatch(out, /<svg|<animate/i);
  assert.doesNotMatch(out, /alert\(/);
  assert.match(out, /<img src="https:\/\/a\.example\/x\.png">/);
  assert.match(out, /<p>teks<\/p>/);
});

test('2.4 sanitizer: iframe srcdoc, script, object, embed, form, style, link, meta, base dihapus', () => {
  const { sanitizeHtml } = loadUiState();
  const out = sanitizeHtml(
    '<p>aman</p><script>alert(1)</script>' +
    '<iframe srcdoc="<script>alert(2)</script>"></iframe>' +
    '<object data="x"></object><embed src="x"><form action="/x"><input></form>' +
    '<style>p{color:red}</style><link rel="stylesheet" href="https://evil.example/x.css">' +
    '<meta charset="utf-8"><base href="https://evil.example/">'
  );
  assert.match(out, /<p>aman<\/p>/);
  for (const tag of ['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base']) {
    assert.doesNotMatch(out, new RegExp(`<${tag}[\\s>]`, 'i'), `tag ${tag} harus hilang`);
  }
  assert.doesNotMatch(out, /alert\(/);
});

test('2.4 sanitizer: href javascript: dan data:text/html dinetralkan, https/relatif/fragment dipertahankan', () => {
  const { sanitizeHtml } = loadUiState();
  const out = sanitizeHtml(
    '<a href="javascript:alert(1)">a</a>' +
    '<a href="JaVaScRiPt:alert(2)">b</a>' +
    '<a href="data:text/html,<script>alert(3)</script>">c</a>' +
    '<a href="vbscript:msgbox(1)">d</a>' +
    '<a href="https://liandimiko.github.io/mykeuangan/">e</a>' +
    '<a href="/laporan">f</a><a href="#mainContent">g</a>'
  );
  assert.doesNotMatch(out, /javascript:|vbscript:|data:text\/html/i);
  assert.doesNotMatch(out, /alert\(/);
  assert.match(out, /<a href="https:\/\/liandimiko\.github\.io\/mykeuangan\/">e<\/a>/);
  assert.match(out, /<a href="\/laporan">f<\/a>/);
  assert.match(out, /<a href="#mainContent">g<\/a>/);
});

test('2.4 sanitizer: markup legit dipertahankan (tabel, tombol data-action, img https + data:image, link https)', () => {
  const { sanitizeHtml } = loadUiState();
  const out = sanitizeHtml(
    '<table><tbody><tr><td class="px-2">Kopi</td><td>Rp 25.000</td></tr></tbody></table>' +
    '<button type="button" data-action="editTransaction" data-args=\'["abc"]\'>Edit</button>' +
    '<img src="https://cdn.example/x.png" alt="nota">' +
    '<img src="data:image/png;base64,iVBORw0KGgo=" alt="nota2">' +
    '<a href="https://example.com">tautan</a>' +
    '<div style="color:red"><span>teks</span></div>'
  );
  assert.match(out, /<td class="px-2">Kopi<\/td>/);
  assert.match(out, /<td>Rp 25\.000<\/td>/);
  assert.match(out, /data-action="editTransaction"/);
  assert.match(out, /<img src="https:\/\/cdn\.example\/x\.png" alt="nota">/);
  assert.match(out, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="nota2">/);
  assert.match(out, /<a href="https:\/\/example\.com">tautan<\/a>/);
  assert.match(out, /<div style="color:red"><span>teks<\/span><\/div>/);
});

test('2.4 sanitizer: img src data:text/html dibuang, tag tak dikenal di-unwrap, style expression() dibuang', () => {
  const { sanitizeHtml } = loadUiState();
  const out = sanitizeHtml(
    '<img src="data:text/html,<script>alert(1)</script>">' +
    '<custom-tag>halo</custom-tag>' +
    '<p style="width: expression(alert(1))">x</p>'
  );
  assert.doesNotMatch(out, /data:text\/html|expression\(|alert\(/i);
  assert.doesNotMatch(out, /<custom-tag/i);
  assert.match(out, /halo/);
  assert.match(out, /<p>x<\/p>/);
});

test('2.4 sanitizer: renderHtml menyisipkan baris tabel yang sudah disanitasi ke TBODY', () => {
  const { renderHtml } = loadUiState();
  const tbody = new FakeElement('tbody');
  renderHtml(
    tbody,
    '<tr onclick="alert(1)"><td>Kopi</td></tr><tr><td><a href="javascript:alert(2)">x</a></td></tr>'
  );
  const html = tbody.innerHTML;
  assert.match(html, /<tr><td>Kopi<\/td><\/tr>/);
  assert.match(html, /<tr><td><a>x<\/a><\/td><\/tr>/);
  assert.doesNotMatch(html, /onclick|javascript:|alert\(/);
});

test('2.4 sanitizer: mkActionAttrs mengembalikan atribut aman untuk id ber-apostrof', () => {
  const { mkActionAttrs } = loadUiState();
  const attrs = mkActionAttrs('editTransaction', ["id'dengan-kutip"]);
  assert.match(attrs, /data-action="editTransaction"/);
  const m = attrs.match(/data-args="([^"]*)"/);
  assert.ok(m, 'data-args harus ada');
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.deepEqual(JSON.parse(decoded), ["id'dengan-kutip"]);
});

/* ---------------- Delegated actions ---------------- */

test('2.4 delegasi: klik memanggil fungsi global dengan argumen JSON (angka tetap angka)', () => {
  const { sandbox, listeners } = loadDelegatedActions();
  const calls = [];
  sandbox.shiftCurrentPeriod = (n) => { calls.push(n); };
  sandbox.switchView = (v) => { calls.push(v); };
  const btn = fakeEl('button', { 'data-action': 'shiftCurrentPeriod', 'data-args': '[-1]' });
  listeners.click[0](fakeEvent('click', btn));
  const nav = fakeEl('button', { 'data-action': 'switchView', 'data-args': '["dashboard"]' });
  listeners.click[0](fakeEvent('click', nav));
  assert.deepEqual(calls, [-1, 'dashboard']);
  assert.strictEqual(typeof calls[0], 'number');
});

test('2.4 delegasi: token $checked, $value, dan $event diteruskan apa adanya', () => {
  const { sandbox, listeners } = loadDelegatedActions();
  const seen = {};
  sandbox.toggleSelectAllReport = (checked) => { seen.checked = checked; };
  sandbox.renderAnnualRecapBody = (year) => { seen.year = year; };
  sandbox.submitTransaction = (e) => { seen.event = e; };
  sandbox.handleReceiptOcrFile = (e) => { seen.fileEvent = e; };

  const cb = fakeEl('input', { 'data-action': 'toggleSelectAllReport', 'data-args': '["$checked"]', 'data-action-on': 'change' }, { checked: true });
  const evChange = fakeEvent('change', cb);
  listeners.change[0](evChange);
  assert.strictEqual(seen.checked, true);

  const sel = fakeEl('select', { 'data-action': 'renderAnnualRecapBody', 'data-args': '["$value"]', 'data-action-on': 'change' }, { value: '2026' });
  listeners.change[0](fakeEvent('change', sel));
  assert.strictEqual(seen.year, '2026');

  const form = fakeEl('form', { 'data-action': 'submitTransaction', 'data-args': '["$event"]', 'data-action-on': 'submit' });
  const evSubmit = fakeEvent('submit', form);
  listeners.submit[0](evSubmit);
  assert.strictEqual(seen.event, evSubmit);
  assert.strictEqual(evSubmit.preventDefaultCalled, true);

  const file = fakeEl('input', { 'data-action': 'handleReceiptOcrFile', 'data-args': '["$event"]', 'data-action-on': 'change' });
  const evFile = fakeEvent('change', file);
  listeners.change[0](evFile);
  assert.strictEqual(seen.fileEvent, evFile);
});

test('2.4 delegasi: rantai swalClose|editTransaction dan fallback bila fungsi utama tidak ada', () => {
  const { sandbox, listeners } = loadDelegatedActions();
  let swalClosed = false;
  sandbox.Swal = { close() { swalClosed = true; } };
  let edited = null;
  sandbox.editTransaction = (id) => { edited = id; };
  const btn = fakeEl('button', { 'data-action': 'swalClose|editTransaction', 'data-args': '["tx-1"]' });
  listeners.click[0](fakeEvent('click', btn));
  assert.strictEqual(swalClosed, true);
  assert.strictEqual(edited, 'tx-1');

  // Pola lama: typeof fn === 'function' ? fn(...) : updateReportBulkBar()
  let bulkCalled = false;
  sandbox.updateReportBulkBar = () => { bulkCalled = true; };
  const cb = fakeEl('input', {
    'data-action': 'syncReportRowCheck',
    'data-args': '["$value","$checked"]',
    'data-action-on': 'change',
    'data-fallback-action': 'updateReportBulkBar'
  }, { checked: false, value: 'row-9' });
  listeners.change[0](fakeEvent('change', cb));
  assert.strictEqual(bulkCalled, true);
});

test('2.4 delegasi: event yang jenisnya salah diabaikan; aksi bawaan hideAiAnalysisResult bekerja', () => {
  const { sandbox, listeners, elementsById } = loadDelegatedActions();
  let called = 0;
  sandbox.toggleSelectAllReport = () => { called++; };
  const cb = fakeEl('input', { 'data-action': 'toggleSelectAllReport', 'data-args': '["$checked"]', 'data-action-on': 'change' }, { checked: true });
  listeners.click[0](fakeEvent('click', cb));
  assert.strictEqual(called, 0, 'klik pada aksi change tidak boleh jalan');
  listeners.change[0](fakeEvent('change', cb));
  assert.strictEqual(called, 1);

  const panel = new FakeElement('div');
  elementsById.aiAnalysisResult = panel;
  const closeBtn = fakeEl('button', { 'data-action': 'hideAiAnalysisResult' });
  listeners.click[0](fakeEvent('click', closeBtn));
  assert.strictEqual(panel.classList.contains('hide'), true);
});

test('2.4 delegasi: setup idempotent — listener tiap jenis event hanya terpasang sekali', () => {
  const { sandbox, listeners } = loadDelegatedActions();
  for (const type of ['click', 'change', 'input', 'submit']) {
    assert.strictEqual(listeners[type].length, 1, `${type} terpasang sekali saat load`);
  }
  sandbox.setupDelegatedActions();
  sandbox.setupDelegatedActions();
  for (const type of ['click', 'change', 'input', 'submit']) {
    assert.strictEqual(listeners[type].length, 1, `${type} tetap sekali setelah setup ulang`);
  }
});

/* ---------------- Guard: tidak ada lagi inline handler ---------------- */

const HANDLER_ATTR_RE = /on(click|change|input|submit|keydown|keyup|focus|blur|dblclick|mouseover)=/;

test('2.4 guard: src/*.html tidak mengandung atribut on* event-handler', () => {
  for (const name of fs.readdirSync('src').filter((f) => f.endsWith('.html')).sort()) {
    const src = fs.readFileSync(path.join('src', name), 'utf8');
    assert.doesNotMatch(src, HANDLER_ATTR_RE, `${name} masih punya inline handler`);
  }
});

test('2.4 guard: template web/*.js tidak mengandung atribut on* event-handler', () => {
  for (const name of fs.readdirSync('web').filter((f) => f.endsWith('.js')).sort()) {
    const src = fs.readFileSync(path.join('web', name), 'utf8');
    assert.doesNotMatch(src, HANDLER_ATTR_RE, `${name} masih punya inline handler`);
  }
});

test('2.4 guard: build.mjs memuat ui-delegated-actions.js tepat setelah ui-state.js', () => {
  const build = fs.readFileSync('build.mjs', 'utf8');
  const core = build.slice(build.indexOf('UI_CORE_MODULES'), build.indexOf('];', build.indexOf('UI_CORE_MODULES')));
  assert.match(core, /'ui-state\.js',\s*'ui-delegated-actions\.js',\s*'ui-shell\.js',/s);
});

test('2.4 guard: setiap data-action di src/*.html menunjuk fungsi global atau aksi bawaan', () => {
  const webSrc = fs.readdirSync('web').filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join('web', f), 'utf8')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const globals = new Set(['swalClose', 'hideAiAnalysisResult']);
  for (const m of webSrc.matchAll(/root\.([A-Za-z_$][\w$]*)\s*=/g)) globals.add(m[1]);
  for (const m of webSrc.matchAll(/Object\.assign\(root,\s*\{([\s\S]*?)\}\);/g)) {
    // Entri terakhir blok tidak diikuti ',' — ujung capture juga dihitung.
    for (const id of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*(?:[,}:]|$)/g)) globals.add(id[1]);
  }
  // Fungsi top-level di blok <script> inline src/*.html (mis. setLang
  // di src/i18n.html) juga global karena script klasik.
  for (const name of fs.readdirSync('src').filter((f) => f.endsWith('.html'))) {
    const src = fs.readFileSync(path.join('src', name), 'utf8');
    for (const m of src.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)) globals.add(m[1]);
  }
  const missing = [];
  for (const name of fs.readdirSync('src').filter((f) => f.endsWith('.html')).sort()) {
    const src = fs.readFileSync(path.join('src', name), 'utf8');
    for (const m of src.matchAll(/data-action="([^"]+)"/g)) {
      for (const action of m[1].split('|')) {
        const fn = action.trim();
        if (fn && !globals.has(fn)) missing.push(`${name}: ${fn}`);
      }
    }
  }
  assert.deepEqual(missing, [], `data-action tanpa fungsi global: ${missing.join(', ')}`);
});

/* ---------------- CSP: DIPERKETAT (Gelombang 7b / T12) ----------------
   Dulu TIDAK ada guard test yang menuntut CSP tanpa 'unsafe-inline' /
   'unsafe-eval' karena arsitektur build meng-inline semua modul. Sejak
   Gelombang 7b, build.mjs meng-eksternalisasi SEMUA modul web/*.js ke
   dist/app/*.js (emitAppScripts, tag <script src> sinkron, urutan sama),
   kamus I18N ke dist/app/i18n-dict.js, dan registrasi SW ke
   dist/app/sw-register.js — jadi script-src TANPA 'unsafe-inline' dan
   TANPA 'unsafe-eval' kini DIKUNCI tes di bawah. Yang masih dilonggarkan
   dengan sengaja (dan dikunci juga alasannya):
   - style-src TETAP 'unsafe-inline': atribut style="..." dipakai di 6
     tempat src/*.html dan banyak template web/*.js; menyapunya churn
     besar dengan nilai keamanan rendah (lihat komentar CSP di
     src/Index.html).
   - TIDAK ada frame-ancestors di meta: directive itu diabaikan di meta
     CSP dan butuh header HTTP yang tidak bisa diset di GitHub Pages. */

test('2.4 CSP: script-src tanpa unsafe-inline/unsafe-eval — eksternalisasi Gelombang 7b', () => {
  const build = fs.readFileSync('build.mjs', 'utf8');
  assert.doesNotMatch(build, /readInlineScripts/, 'build tidak boleh lagi meng-inline modul (readInlineScripts harus hilang)');
  assert.match(build, /emitAppScripts\(WEB_MODULES\)/);
  assert.match(build, /emitAppScripts\(UI_CORE_MODULES\)/);
  assert.match(build, /emitAppScripts\(SUPABASE_MODULES\)/);
  assert.match(build, /emitAppScripts\(UI_FEATURES_MODULES\)/);
  assert.match(build, /emitAppScripts\(UI_PRO_MODULES\)/);
  assert.match(build, /emitAppScripts\(APP_TAIL_MODULES\)/);
  assert.match(build, /emitI18nDict/);
  assert.match(build, /i18n-dict\.js/);
  assert.match(build, /appFiles\.set\(`app\/\$\{file\}`/, 'build harus menulis tiap modul ke dist/app/<nama>.js');
  // Sumber kamus tetap src/i18n.html (tes i18n membaca blok <script>-nya
  // dari sana); build yang mengekstraknya ke dist/app/i18n-dict.js.
  assert.match(fs.readFileSync('src/i18n.html', 'utf8'), /^<script>/);
  assert.ok(fs.existsSync('web/sw-register.js'), 'web/sw-register.js harus ada (dulu blok inline di src/Index.html)');
  assert.doesNotMatch(fs.readFileSync('src/Index.html', 'utf8'), /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/, 'registrasi SW tidak boleh lagi inline di src/Index.html');
  const csp = fs.readFileSync('src/Index.html', 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const scriptSrc = csp.split(';').find((s) => s.trim().startsWith('script-src'));
  assert.ok(scriptSrc, 'CSP harus memuat script-src');
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/, 'script-src tidak boleh memuat unsafe-inline (Gelombang 7b)');
  assert.doesNotMatch(scriptSrc, /'unsafe-eval'/, 'script-src tidak boleh memuat unsafe-eval (Gelombang 7b)');
  assert.match(scriptSrc, /'self'/, 'script-src harus memuat self');
  const styleSrc = csp.split(';').find((s) => s.trim().startsWith('style-src'));
  assert.match(styleSrc, /'unsafe-inline'/, 'style-src SENGAJA tetap memuat unsafe-inline (atribut style= di template — lihat komentar CSP di src/Index.html)');
  const imgSrc = csp.split(';').find((s) => s.trim().startsWith('img-src'));
  assert.doesNotMatch(imgSrc, /https:/, 'img-src tidak boleh memuat https: mentah (tidak ada gambar remote)');
  assert.match(csp, /form-action 'self'/, 'CSP harus memuat form-action self');
  assert.match(csp, /upgrade-insecure-requests/, 'CSP harus memuat upgrade-insecure-requests');
  assert.doesNotMatch(csp, /frame-ancestors/, 'frame-ancestors tidak boleh ada di meta CSP (diabaikan di meta — butuh header HTTP)');
  // Wave 3.4: host CDN tidak lagi diizinkan untuk script/style/font.
  for (const directive of ['script-src', 'style-src', 'font-src']) {
    const part = csp.split(';').find((s) => s.trim().startsWith(directive));
    assert.ok(part, `CSP harus memuat ${directive}`);
    for (const host of ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
      assert.doesNotMatch(part, new RegExp(host.replace(/\./g, '\\.')), `CSP ${directive} tidak boleh lagi memuat ${host} (Wave 3.4: vendor self-hosted)`);
    }
  }
});
