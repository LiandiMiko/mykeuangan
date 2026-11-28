/* global FinanceAnalysis, Swal, t, getMonthShort, renderAll, updateDashboardTitle */
/* ============================================================
   STATE & CORE HELPERS
   ============================================================ */
(function (root) {
  'use strict';

  root.DB = {
    transactions: [],
    categories: { pemasukan: [], pengeluaran: [] },
    entities: { UtangApp: [], UtangPerson: [], Piutang: [] },
    assets: [],
    budgets: [],
    snapshots: [],
    wallets: [],
    transfers: [],
    goals: [],
    recurring: [],
    currentPeriod: new Date().toISOString().slice(0, 7),
    payrollDay: 28,
    primaryBankWalletId: ''
  };

  root.sessionUser = 'User';
  root.sessionRole = 'User';
  root.fpTanggal = null;
  root.fpMonth = null;
  root.isDataReady = false;
  root.hideNominal = localStorage.getItem('hideNominal') === '1';

  const laporanState = {
    page: 0,
    pageSize: 20,
    total: 0,
    period: '',
    requestId: 0,
    dirty: true,
    rows: []
  };
  root.laporanState = laporanState;

  /* Helper sanitasi HTML & JS string di dalam atribut HTML (dipakai
     template yang dulu menulis handler inline dengan nilai dinamis). */
  function escapeHtmlJS(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function escapeAttrJS(s) {
    if (s == null) return '';
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ============================================================
     SANITIZER ALLOWLIST — Gelombang 2.4 (T11)
     ------------------------------------------------------------
     renderHtml() dulu hanya membuang <script>. Itu tidak cukup:
     event handler (onclick/onerror/...), <iframe srcdoc>, URL
     javascript:, dan vektor SVG (mis. <animate onbegin>) semuanya
     lolos. Sanitizer ini bekerja dengan allowlist, bukan blocklist:

     - TAG YANG DIIZINKAN (ALLOWED_TAGS): hanya tag presentasi/
       struktur yang tidak bisa mengeksekusi kode. Semua tag lain
       yang tidak dikenal di-unwrap: tagnya dibuang, anak teks/
       elemennya dipertahankan (jadi teks pengguna tetap tampil).
     - TAG YANG DIHAPUS BESERTA ISINYA (REMOVE_TAGS): script,
       iframe (termasuk srcdoc), object, embed, form, style, link,
       meta, base, title, noscript, template, svg beserta seluruh
       turunannya (animate, script di dalam svg, ...), dan kawan-
       kawan yang bisa memuat konten aktif/eksternal (frame,
       frameset, applet, audio, video, canvas, map, ...).
       Keputusan soal <svg>: TIDAK ADA satu pun call-site
       renderHtml yang memakai svg (satu-satunya svg di aplikasi,
       logo Google di web/supabase-auth-ui.js, dipasang lewat
       innerHTML langsung, bukan lewat renderHtml). Karena itu svg
       dihapus seluruhnya; bila suatu hari ada kebutuhan svg
       legit, tambahkan ke ALLOWED_TAGS beserta penghapusan
       on* dan <animate>/<script> di dalamnya.
     - ATRIBUT: semua atribut on* dibuang (pertahanan lapis kedua
       setelah allowlist). Hanya atribut dalam ALLOWED_ATTRS yang
       dipertahankan, plus atribut data-* dan aria-* (nilainya
       string polos, tidak dieksekusi). Atribut style="" BOLEH:
       aplikasi memakainya di mana-mana dan CSS inline tidak bisa
       mengeksekusi JS di browser modern; nilai style yang
       mengandung expression( atau javascript: tetap dibuang.
     - URL (href/src/cite/dll): hanya http:, https:, mailto:,
       tel:, URL relatif, URL diawali //, dan #fragment. Skema
       javascript:, vbscript:, file:, dan data: (kecuali
       data:image/* dan hanya untuk <img src>) membuat atributnya
       dibuang. URL dinormalisasi dulu (trim + buang karakter
       kontrol) agar "java\tscript:" atau " javascript:" tidak lolos.
     - Sanitizer ini sengaja hanya memakai API DOM minimal
       (childNodes, tagName, attributes, get/set/removeAttribute,
       remove, insertBefore) supaya bisa diuji di node --test
       dengan DOMParser stub — lihat tests/wave2-xss-csp.test.js.
     ============================================================ */
  const SANITIZER_ALLOWED_TAGS = new Set([
    'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'button',
    'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div',
    'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'input', 'ins', 'kbd',
    'label', 'li', 'main', 'mark', 'nav', 'ol', 'option', 'optgroup', 'p',
    'pre', 'q', 's', 'section', 'select', 'small', 'span', 'strong', 'sub',
    'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
    'tr', 'u', 'ul'
  ]);
  // Dihapus beserta seluruh subtree-nya (bukan di-unwrap).
  const SANITIZER_REMOVE_TAGS = new Set([
    'script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta',
    'base', 'title', 'noscript', 'template', 'svg', 'frameset', 'frame',
    'applet', 'audio', 'video', 'source', 'track', 'canvas', 'map', 'area',
    'math', 'xmp', 'listing', 'plaintext', 'slot', 'dialog'
  ]);
  // Atribut yang boleh dipertahankan (di luar data-* dan aria-*).
  const SANITIZER_GLOBAL_ATTRS = new Set([
    'class', 'id', 'style', 'title', 'role', 'tabindex', 'colspan',
    'rowspan', 'scope'
  ]);
  const SANITIZER_TAG_ATTRS = {
    a: new Set(['href', 'target', 'rel']),
    blockquote: new Set(['cite']),
    q: new Set(['cite']),
    img: new Set(['src', 'alt', 'width', 'height', 'loading']),
    input: new Set(['type', 'value', 'placeholder', 'disabled', 'checked',
      'readonly', 'name', 'min', 'max', 'step', 'maxlength']),
    select: new Set(['name', 'disabled', 'multiple', 'size']),
    option: new Set(['value', 'selected', 'disabled']),
    optgroup: new Set(['label', 'disabled']),
    button: new Set(['type', 'disabled', 'name', 'value']),
    td: new Set(['colspan', 'rowspan']),
    th: new Set(['colspan', 'rowspan', 'scope']),
    col: new Set(['span']),
    label: new Set(['for']),
    ol: new Set(['start', 'reversed']),
    li: new Set(['value']),
    time: new Set(['datetime']),
    details: new Set(['open'])
  };
  const SANITIZER_URL_ATTRS = new Set(['href', 'src', 'cite', 'action',
    'formaction', 'xlink:href', 'poster']);

  function sanitizeUrlValue(raw, allowDataImage) {
    const value = String(raw == null ? '' : raw).trim()
      .replace(/[\u0000-\u0020]+/g, '');
    if (!value) return '';
    const lower = value.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') ||
      lower.startsWith('file:')) return '';
    if (lower.startsWith('data:')) {
      return (allowDataImage && /^data:image\//i.test(value)) ? value : '';
    }
    if (/^(https?:|mailto:|tel:|\/\/|#|\/|\?|\.)/.test(lower)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ''; // skema lain: tolak
    return value; // relatif tanpa skema
  }

  function sanitizeElementAttrs(el, tag) {
    const allowed = SANITIZER_TAG_ATTRS[tag] || null;
    const attrs = Array.from(el.attributes || []);
    for (const attr of attrs) {
      const name = String(attr.name || '').toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name.startsWith('data-') || name.startsWith('aria-')) continue;
      if (!SANITIZER_GLOBAL_ATTRS.has(name) &&
        !(allowed && allowed.has(name))) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (SANITIZER_URL_ATTRS.has(name)) {
        const safe = sanitizeUrlValue(value, tag === 'img' && name === 'src');
        if (!safe) el.removeAttribute(attr.name);
        else if (safe !== value) el.setAttribute(attr.name, safe);
        continue;
      }
      if (name === 'style' &&
        /expression\s*\(|javascript\s*:/i.test(String(value || ''))) {
        el.removeAttribute(attr.name);
      }
    }
    // target="_blank" tanpa rel noopener = tab-nabbing; perbaiki diam-diam.
    if (tag === 'a' && el.getAttribute &&
      String(el.getAttribute('target') || '').toLowerCase() === '_blank') {
      const rel = String(el.getAttribute('rel') || '');
      if (!/\bnoopener\b/i.test(rel)) {
        el.setAttribute('rel', (rel ? rel + ' ' : '') + 'noopener');
      }
    }
  }

  function sanitizeNode(node) {
    if (!node || node.nodeType !== 1) return;
    const tag = String(node.tagName || '').toLowerCase();
    if (SANITIZER_REMOVE_TAGS.has(tag)) { node.remove(); return; }
    if (!SANITIZER_ALLOWED_TAGS.has(tag)) {
      // Tag tak dikenal: unwrap — pindahkan anak ke parent, buang tag.
      const parent = node.parentNode;
      if (!parent) { node.remove(); return; }
      const moved = Array.from(node.childNodes || []);
      for (const child of moved) parent.insertBefore(child, node);
      node.remove();
      for (const child of moved) sanitizeNode(child);
      return;
    }
    sanitizeElementAttrs(node, tag);
    const children = Array.from(node.childNodes || []);
    for (const child of children) {
      if (child.nodeType === 3) continue; // teks: aman apa adanya
      if (child.nodeType !== 1) { child.remove(); continue; } // komentar dll
      sanitizeNode(child);
    }
  }

  // Sanitasi in-place pada dokumen hasil DOMParser (dipakai renderHtml).
  function sanitizeDocument(doc) {
    if (!doc || !doc.body) return;
    const children = Array.from(doc.body.childNodes || []);
    for (const child of children) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) { child.remove(); continue; }
      sanitizeNode(child);
    }
  }

  // Mengembalikan markup yang sudah disanitasi (string). Parameter
  // parserOverride hanya untuk pengujian node --test (DOMParser stub);
  // di browser, DOMParser global yang dipakai.
  function sanitizeHtml(markup, parserOverride) {
    const Parser = parserOverride ||
      (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!Parser) return '';
    const doc = new Parser().parseFromString(
      String(markup == null ? '' : markup), 'text/html');
    sanitizeDocument(doc);
    return doc.body ? doc.body.innerHTML : '';
  }

  /* Merender markup ter-sanitasi tanpa assignment innerHTML langsung */
  function renderHtml(el, html) {
    if (!el) return;
    const markup = html == null ? '' : String(html);
    if (!markup) {
      el.textContent = '';
      return;
    }
    const tag = String(el.tagName || '').toUpperCase();
    const isTableSection = tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT';
    const wrapped = isTableSection
      ? `<table><tbody>${markup}</tbody></table>`
      : tag === 'TABLE'
        ? `<table>${markup}</table>`
        : markup;
    const doc = new DOMParser().parseFromString(wrapped, 'text/html');
    sanitizeDocument(doc);
    const container = isTableSection
      ? doc.body.querySelector('tbody')
      : tag === 'TABLE'
        ? doc.body.querySelector('table')
        : doc.body;
    if (container) el.replaceChildren(...Array.from(container.childNodes));
  }

  /* Atribut data-action/data-args untuk delegated listener
     (web/ui-delegated-actions.js). Dipakai template JS yang dulu
     menulis handler inline dengan nilai dinamis: nilai mentah
     (bukan escapeAttrJS) yang dimasukkan — JSON.stringify +
     escapeHtmlJS yang menjaga keamanannya — supaya id
     ber-apostrof tidak rusak oleh escaping ganda. */
  function mkActionAttrs(action, args, on) {
    let out = 'data-action="' + escapeHtmlJS(action) + '"';
    if (args !== undefined) {
      out += ' data-args="' + escapeHtmlJS(JSON.stringify(args)) + '"';
    }
    if (on && on !== 'click') out += ' data-action-on="' + escapeHtmlJS(on) + '"';
    return out;
  }

  function renderSelectOptions(selectEl, items, defaultLabel, selectedValue) {
    if (!selectEl) return;
    const nodes = [];
    if (defaultLabel != null) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = String(defaultLabel);
      nodes.push(opt);
    }
    (items || []).forEach((item) => {
      const val = typeof item === 'object' && item !== null ? String(item.value ?? '') : String(item);
      const lbl = typeof item === 'object' && item !== null ? String(item.label ?? val) : String(item);
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      if (selectedValue !== undefined && val === String(selectedValue)) opt.selected = true;
      nodes.push(opt);
    });
    selectEl.replaceChildren(...nodes);
  }

  function formatNominalInputValue(raw) {
    if (raw == null || raw === '') return '';
    let intVal;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || raw < 0) return '';
      intVal = Math.round(raw);
    } else {
      const digits = String(raw).replace(/[^\d]/g, '');
      if (!digits) return '';
      intVal = Number(digits);
    }
    if (!Number.isFinite(intVal)) return '';
    return String(intVal).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  const CALC_OP_PATTERN = /[+\-*×÷/]|(?<=\d)\s*[xX]\s*(?=\d)/;

  function evaluateNominalExpression(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : NaN;
    let src = String(raw || '').trim().replace(/rp/gi, '').replace(/\s+/g, '');
    if (!src) return NaN;
    src = src.replace(/[×xX]/g, '*').replace(/÷/g, '/');
    src = src.replace(/\d{1,3}(?:\.\d{3})+(?![\d.,])/g, (m) => m.replace(/\./g, '')).replace(/,/g, '.');
    if (!/^\d+(?:\.\d+)?(?:[+\-*/]\d+(?:\.\d+)?)*$/.test(src)) return NaN;
    const nums = src.split(/[+\-*/]/).map(Number);
    const ops = src.match(/[+\-*/]/g) || [];
    if (nums.some((n) => !Number.isFinite(n))) return NaN;
    const vals = [nums[0]];
    const addOps = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const next = nums[i + 1];
      if (op === '*') vals[vals.length - 1] *= next;
      else if (op === '/') {
        if (next === 0) return NaN;
        vals[vals.length - 1] /= next;
      } else { addOps.push(op); vals.push(next); }
    }
    let total = vals[0];
    for (let i = 0; i < addOps.length; i++) total += addOps[i] === '+' ? vals[i + 1] : -vals[i + 1];
    return Number.isFinite(total) && total >= 0 ? Math.round(total) : NaN;
  }

  function parseFormattedNominal(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
    const str = String(raw || '').trim();
    if (!str) return NaN;
    if (CALC_OP_PATTERN.test(str)) return evaluateNominalExpression(str);
    const cleaned = str.replace(/rp/gi, '').replace(/[\s.]/g, '').replace(',', '.');
    const n = cleaned ? Number(cleaned) : NaN;
    return Number.isFinite(n) ? n : NaN;
  }

  function updateCalcPreviewForInput(el) {
    if (typeof document === 'undefined' || !el || !el.id) return;
    const prev = document.getElementById(el.id + '_calc_preview');
    if (!prev) return;
    const hasOp = CALC_OP_PATTERN.test(String(el.value || ''));
    const val = hasOp ? evaluateNominalExpression(el.value) : NaN;
    prev.textContent = hasOp && Number.isFinite(val) ? '= ' + _origFormatRupiah(val) : '';
    prev.classList.toggle('hide', !(hasOp && Number.isFinite(val)));
  }

  function resolveCalcInput(el) {
    if (!el || !CALC_OP_PATTERN.test(String(el.value || ''))) return false;
    const res = evaluateNominalExpression(el.value);
    if (!Number.isFinite(res) || res < 0) return false;
    el.value = res > 0 ? formatNominalInputValue(res) : '';
    updateCalcPreviewForInput(el);
    return true;
  }

  function insertNominalCalcOp(op) {
    const el = document.getElementById('tr_nominal');
    if (!el) return;
    const cur = String(el.value || '').trim();
    if (!cur) { el.focus(); return; }
    el.value = /[+\-*×÷/xX]$/.test(cur) ? cur.slice(0, -1) + op : cur + op;
    updateCalcPreviewForInput(el);
    el.focus();
  }

  function applyNominalCalc() {
    const el = document.getElementById('tr_nominal');
    if (el) { resolveCalcInput(el); el.focus(); }
  }

  function bindNominalInputs(idsOrEls) {
    (idsOrEls || []).forEach((item) => {
      const el = typeof item === 'string' ? document.getElementById(item) : item;
      if (!el || el.dataset.fmtBound === '1') return;
      el.dataset.fmtBound = '1';
      el.addEventListener('input', () => {
        if (!CALC_OP_PATTERN.test(String(el.value || ''))) el.value = formatNominalInputValue(el.value);
        updateCalcPreviewForInput(el);
      });
      el.addEventListener('blur', () => resolveCalcInput(el));
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && CALC_OP_PATTERN.test(String(el.value || '')) && resolveCalcInput(el)) ev.preventDefault();
      });
    });
  }

  const _origFormatRupiah = (a) => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', minimumFractionDigits: 0
  }).format(a || 0);

  const formatRupiah = (a) => {
    if (root.hideNominal) return 'Rp ••••••';
    return _origFormatRupiah(a);
  };

  function updateEyeIcon() {
    const title = root.hideNominal ? t('header.show_nominal') : t('header.hide_nominal');
    const iconCls = root.hideNominal ? 'ph ph-eye-slash' : 'ph ph-eye';
    [['toggleHideBtn', 'eyeIcon'], ['heroHideNominalBtn', 'heroEyeIcon']].forEach(([btnId, iconId]) => {
      const icon = document.getElementById(iconId);
      if (icon) icon.className = iconCls;
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.setAttribute('aria-pressed', String(Boolean(root.hideNominal)));
      }
    });
  }

  function toggleHideNominal() {
    root.hideNominal = !root.hideNominal;
    localStorage.setItem('hideNominal', root.hideNominal ? '1' : '0');
    updateEyeIcon();
    const targets = document.querySelectorAll('.mk-privacy-target');
    targets.forEach((el) => {
      el.style.transition = 'opacity 120ms ease';
      el.classList.add('mk-privacy-fade');
    });
    if (typeof renderAll === 'function' && root.isDataReady) renderAll();
    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(() => targets.forEach((el) => el.classList.remove('mk-privacy-fade')));
    } else {
      targets.forEach((el) => el.classList.remove('mk-privacy-fade'));
    }
  }

  const getSwalClass = () => document.documentElement.classList.contains('dark') ? 'dark-swal' : '';

  function showActionError(error) {
    console.error(error);
    // Gelombang 4: jangan tampilkan pesan mentah Supabase / internal
    // ke pengguna — toUserErrorMessage memetakan ke pesan ramah atau
    // pesan umum. Fallback generik bila helper belum termuat (mis. tes
    // yang hanya memuat file ini): jangan pernah crash di jalur error.
    const safeText = (typeof toUserErrorMessage === 'function')
      ? toUserErrorMessage(error)
      : ((typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'en')
        ? 'Something went wrong. Please try again.'
        : 'Terjadi kesalahan. Coba lagi.');
    Swal.fire({
      icon: 'error',
      title: t('alert.failed'),
      text: safeText,
      customClass: { popup: getSwalClass() }
    });
  }

  function updateDashboardTitleFn() {
    const dEl = document.getElementById('dashTitle');
    if (!dEl) return;
    const hasName = typeof root.sessionUser === 'string' && root.sessionUser.trim() && root.sessionUser !== 'User';
    if (hasName) {
      const base = typeof t === 'function' ? t('dash.subtitle') : 'Dashboard Keuangan';
      dEl.textContent = `${base} ${root.sessionUser}`;
    } else {
      dEl.textContent = typeof t === 'function' ? t('dash.title') : 'Ringkasan Finansial';
    }
  }

  function getPeriodRange(periodStr, payrollDay) {
    return FinanceAnalysis.getPeriodRange(periodStr, payrollDay);
  }

  function isInPeriod(tanggal, periodStr) {
    return FinanceAnalysis.isInPeriod(tanggal, periodStr, root.DB.payrollDay);
  }

  async function saveCurrentPeriod(period) {
    const previousPeriod = root.DB.currentPeriod;
    const prevCalYear = typeof root.kalenderYear !== 'undefined' ? root.kalenderYear : null;
    const prevCalMonth = typeof root.kalenderMonth !== 'undefined' ? root.kalenderMonth : null;
    root.DB.currentPeriod = period;
    const periodMatch = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
    if (periodMatch) {
      root.kalenderYear = Number(periodMatch[1]);
      root.kalenderMonth = Number(periodMatch[2]);
    }
    renderAll();
    try {
      await root.callServer('api_savePeriod', period);
    } catch (error) {
      root.DB.currentPeriod = previousPeriod;
      if (prevCalYear !== null) root.kalenderYear = prevCalYear;
      if (prevCalMonth !== null) root.kalenderMonth = prevCalMonth;
      if (root.fpMonth) root.fpMonth.setDate(previousPeriod, false);
      renderAll();
      showActionError(error);
    }
  }

  function shiftCurrentPeriod(offset) {
    const period = FinanceAnalysis.shiftPeriod(root.DB.currentPeriod, offset);
    if (root.fpMonth) root.fpMonth.setDate(period, false);
    saveCurrentPeriod(period);
  }

  function getPeriodLabel(periodStr, payrollDay) {
    const range = getPeriodRange(periodStr, payrollDay);
    const s = new Date(range.start + 'T00:00:00');
    const e = new Date(range.end + 'T00:00:00');
    return s.getDate() + ' ' + getMonthShort(s.getMonth()) + ' - ' +
      e.getDate() + ' ' + getMonthShort(e.getMonth()) + ' ' + e.getFullYear();
  }

  function defaultCallServer() {
    return Promise.reject(new Error(
      'Koneksi ke Supabase belum siap (supabase-api.js / supabase-js gagal dimuat). ' +
      'Muat ulang halaman (Ctrl+F5), cek koneksi/ad-blocker, lalu lihat F12 → Console.'
    ));
  }

  function mergeUpdatedTransactions(payload) {
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    const bulkDeletes = Array.isArray(payload.deletedTransactionIds) ? payload.deletedTransactionIds : [];
    if (has('transactions') || payload.transaction || payload.addedTransactions ||
      payload.deletedTransactionId || bulkDeletes.length || payload.renamedTransactionCategory) {
      laporanState.dirty = true;
    }
    if (has('transactions')) root.DB.transactions = payload.transactions || [];
    if (payload.transaction) {
      const index = root.DB.transactions.findIndex((item) => item.id === payload.transaction.id);
      if (index === -1) root.DB.transactions.push(payload.transaction);
      else root.DB.transactions[index] = payload.transaction;
    }
    if (payload.addedTransactions) {
      payload.addedTransactions.forEach((transaction) => {
        const index = root.DB.transactions.findIndex((item) => item.id === transaction.id);
        if (index === -1) root.DB.transactions.push(transaction);
        else root.DB.transactions[index] = transaction;
      });
    }
    if (payload.deletedTransactionId || bulkDeletes.length) {
      const removedIds = new Set(bulkDeletes.map(String));
      if (payload.deletedTransactionId) removedIds.add(String(payload.deletedTransactionId));
      root.DB.transactions = root.DB.transactions.filter((item) => !removedIds.has(String(item.id)));
    }
    if (payload.renamedTransactionCategory) {
      const fromKey = String(payload.renamedTransactionCategory.from || '').trim().toLocaleLowerCase();
      root.DB.transactions.forEach((item) => {
        if (String(item.kategori || '').trim().toLocaleLowerCase() === fromKey &&
          (!payload.renamedTransactionCategory.tipe || item.tipe === payload.renamedTransactionCategory.tipe)) {
          item.kategori = payload.renamedTransactionCategory.to;
        }
      });
    }
  }

  async function refreshFromServer(payload) {
    if (payload) {
      const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
      mergeUpdatedTransactions(payload);
      if (has('categories')) root.DB.categories = payload.categories || { pemasukan: [], pengeluaran: [] };
      if (has('entities')) root.DB.entities = payload.entities || { UtangApp: [], UtangPerson: [], Piutang: [] };
      if (has('assets')) root.DB.assets = payload.assets || [];
      if (has('budgets')) root.DB.budgets = payload.budgets || [];
      if (has('snapshots')) root.DB.snapshots = payload.snapshots || [];
      if (payload.currentPeriod) root.DB.currentPeriod = payload.currentPeriod;
      if (payload.payrollDay) root.DB.payrollDay = payload.payrollDay;
      if (has('wallets')) root.DB.wallets = payload.wallets || [];
      if (has('transfers')) root.DB.transfers = payload.transfers || [];
      if (has('goals')) root.DB.goals = payload.goals || [];
      if (payload.goal) {
        const index = root.DB.goals.findIndex((item) => item.id === payload.goal.id);
        if (index === -1) root.DB.goals.push(payload.goal);
        else root.DB.goals[index] = payload.goal;
      }
      if (payload.deletedGoalId) root.DB.goals = root.DB.goals.filter((goal) => goal.id !== payload.deletedGoalId);
      if (has('recurring')) root.DB.recurring = payload.recurring || [];
    }
    if (typeof updateDashboardTitle === 'function') updateDashboardTitle();
    renderAll();
    if (typeof root.saveOfflineSnapshot === 'function' && root.isDataReady) root.saveOfflineSnapshot(root.DB);
  }

  Object.assign(root, {
    escapeHtmlJS,
    escapeAttrJS,
    renderHtml,
    sanitizeHtml,
    sanitizeDocument,
    mkActionAttrs,
    renderSelectOptions,
    formatNominalInputValue,
    parseFormattedNominal,
    evaluateNominalExpression,
    insertNominalCalcOp,
    applyNominalCalc,
    bindNominalInputs,
    _origFormatRupiah,
    formatRupiah,
    toggleHideNominal,
    updateEyeIcon,
    getSwalClass,
    showActionError,
    updateDashboardTitle: updateDashboardTitleFn,
    getPeriodRange,
    isInPeriod,
    saveCurrentPeriod,
    shiftCurrentPeriod,
    getPeriodLabel,
    callServer: defaultCallServer,
    refreshFromServer
  });
})(typeof window !== 'undefined' ? window : globalThis);
