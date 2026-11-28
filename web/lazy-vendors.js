/* global document */
// Gelombang 7d (P2): pemuat malas (lazy-load) untuk vendor berat yang
// hanya dipakai di layar/fitur tertentu — jsPDF + autotable (ekspor PDF),
// Chart.js (grafik), flatpickr + monthSelect + locale id (pemilih tanggal).
// Dulu ketiganya dimuat lewat tag <script>/<link> di src/styles.html dan
// ikut di jalur muat pertama (~710 KB, ~30% byte awal); kini dimuat hanya
// saat fitur yang memakainya dibuka, dari file lokal ./vendor/ yang sama
// (tetap ter-precache SW, jadi tersedia offline dan instan dari cache
// pada kunjungan ulang). CSP script-src 'self' mengizinkan injeksi skrip
// same-origin; SRI tetap dipasang — hash-nya sama dengan yang dulu
// menempel di tag statis (bytes lokal identik dengan bytes CDN yang
// di-hash di Wave 3.4; lihat tests/wave3-frontend-cdn-build.test.js 3.4f).
(function (root) {
  'use strict';

  var VENDOR_SRI = {
    'jspdf.umd.min.js': 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3',
    'jspdf.plugin.autotable.min.js': 'sha384-A77YsHWitrPuAj8E0AuB033EXzymUxIajnWKPzrrzqFoYYSCEpFennDUjMG2R1L3',
    'chart.umd.min.js': 'sha384-NrKB+u6Ts6AtkIhwPixiKTzgSKNblyhlk0Sohlgar9UHUBzai/sgnNNWWd291xqt',
    'flatpickr.min.js': 'sha384-5JqMv4L/Xa0hfvtF06qboNdhvuYXUku9ZrhZh3bSk8VXF0A/RuSLHpLsSV9Zqhl6',
    'monthSelect-index.js': 'sha384-6p33UqcS/7ZxiJzlAi3gfOsrVSlBlFNr/6gfN12AC0ETbTmPgMGSfHuN+H0QcWoO',
    'flatpickr-id.js': 'sha384-KMhDAY3QD073iimt/X068iLaMgNPBD+J57j7adrjgvlWbfAv2ONSvLFyOtU9TzDN'
  };
  var CSS_SRI = {
    'flatpickr.min.css': 'sha384-RkASv+6KfBMW9eknReJIJ6b3UnjKOKC5bOUaNgIY778NFbQ8MtWq9Lr/khUgqtTt',
    'monthSelect-style.css': 'sha384-iENKmnGeeAGTWfH/ajxq1dMSwLjASdk1v+taA112fikKow0tdV9cbUJcAiBEfHhG'
  };

  // Satu janji per file: panggilan ke-2 (atau yang bersamaan) memakai
  // janji pemuatan yang sama; bila gagal, entri dihapus supaya percobaan
  // berikutnya bisa mencoba lagi.
  var pending = {};

  function loadScript(file) {
    var src = './vendor/' + file;
    if (pending[src]) return pending[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      if (VENDOR_SRI[file]) { s.integrity = VENDOR_SRI[file]; s.crossOrigin = 'anonymous'; }
      s.onload = function () { resolve(); };
      s.onerror = function () { delete pending[src]; reject(new Error('Gagal memuat ' + file)); };
      document.head.appendChild(s);
    });
    pending[src] = p;
    return p;
  }

  function loadCss(file) {
    var href = './vendor/' + file;
    if (pending[href]) return pending[href];
    var p = new Promise(function (resolve, reject) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      if (CSS_SRI[file]) { l.integrity = CSS_SRI[file]; l.crossOrigin = 'anonymous'; }
      l.onload = function () { resolve(); };
      l.onerror = function () { delete pending[href]; reject(new Error('Gagal memuat ' + file)); };
      document.head.appendChild(l);
    });
    pending[href] = p;
    return p;
  }

  var chartDefaultsApplied = false;
  function applyChartDefaults() {
    // Dulu di initPickersAndControls (ui-shell.js) — pindah ke sini
    // karena Chart kini baru ada SETELAH lazy-load, bukan saat boot.
    if (chartDefaultsApplied || typeof root.Chart === 'undefined') return;
    chartDefaultsApplied = true;
    try {
      root.Chart.defaults.font.family = "'Inter', sans-serif";
      if (typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        root.Chart.defaults.animation = false;
      }
    } catch (_) { /* abaikan — grafik tetap jalan dengan default Chart.js */ }
  }

  function ensureChart() {
    if (typeof root.Chart !== 'undefined') { applyChartDefaults(); return Promise.resolve(); }
    return loadScript('chart.umd.min.js').then(applyChartDefaults);
  }

  function ensureJsPdf() {
    if (root.jspdf && root.jspdf.jsPDF) return Promise.resolve();
    return loadScript('jspdf.umd.min.js')
      .then(function () { return loadScript('jspdf.plugin.autotable.min.js'); });
  }

  function ensureFlatpickr() {
    if (typeof root.flatpickr !== 'undefined' && typeof root.monthSelectPlugin !== 'undefined') return Promise.resolve();
    return Promise.all([loadCss('flatpickr.min.css'), loadCss('monthSelect-style.css')])
      .then(function () { return loadScript('flatpickr.min.js'); })
      .then(function () { return loadScript('monthSelect-index.js'); })
      .then(function () { return loadScript('flatpickr-id.js'); });
  }

  Object.assign(root, {
    ensureChart: ensureChart,
    ensureJsPdf: ensureJsPdf,
    ensureFlatpickr: ensureFlatpickr
  });
})(window);
