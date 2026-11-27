/* ============================================================
   DELEGATED ACTIONS — Gelombang 2.4 (T11/T12)
   ------------------------------------------------------------
   Pengganti 133 inline handler di src/*.html (dan 50 handler
   inline di template web/*.js yang dirender lewat renderHtml /
   Swal). Alasan: inline handler memaksa CSP memakai
   'unsafe-inline', dan markup yang dirender renderHtml kini
   melewati sanitizer allowlist yang membuang semua atribut on* —
   jadi handler HARUS hidup di luar markup.

   Cara pakai (di HTML statis maupun template JS):
     data-action="switchView" data-args='["dashboard"]'
     data-action="toggleSelectAllReport" data-args='["$checked"]'
       data-action-on="change"
     data-action="submitTransaction" data-args='["$event"]'
       data-action-on="submit"
     data-action="editTransaction" data-arg="&lt;id&gt;"
       (satu argumen string; lihat mkActionAttrs di ui-state.js
       untuk template JS — nilai mentah di-JSON-kan di sana)

   - data-action: nama fungsi global (window[nama]) yang dipanggil.
     Beberapa aksi boleh dirangkai dengan "|", mis.
     "swalClose|editTransaction": dijalankan berurutan.
   - data-args: array JSON argumen. Token khusus di dalam array:
       "$event"   -> objek event
       "$checked" -> el.checked (checkbox)
       "$value"   -> el.value (select/input)
       "$target" / "$this" -> elemen itu sendiri
     Tanpa data-args, fungsi dipanggil tanpa argumen. data-arg
     (tunggal) adalah jalan pintas untuk satu argumen string.
   - data-action-on: jenis event yang ditangani ("click" bila
     tidak diisi, "change", "input", "submit"). Ini mencegah
     salah tembak: klik pada checkbox yang aksinya "change" tidak
     ikut jalan, dan klik tombol di dalam <form> yang aksinya
     "submit" tidak ikut jalan.
   - data-fallback-action: dipanggil dengan argumen yang sama bila
     data-action tidak ditemukan sebagai fungsi global (dipakai
     untuk pola lama `typeof fn === 'function' ? fn(...) : lain()`).
   - Fungsi yang tidak ditemukan sebagai global dilewati diam-diam
     (peringatan di console) — perilaku ini menggantikan guard
     `typeof fn === 'function' && fn(...)` di template lama.
   - Aksi bawaan (bukan fungsi global, untuk pernyataan inline
     yang dulu bukan pemanggilan fungsi): "swalClose" (Swal.close)
     dan "hideAiAnalysisResult" (menutup panel hasil AI).
   - Event "submit" selalu di-preventDefault oleh dispatcher,
     karena semua form di aplikasi ditangani JS (dulu tiap handler
     submit melakukan preventDefault sendiri / inline).

   SATU listener per jenis event di document menangani semua
   elemen, termasuk yang baru dirender belakangan (renderHtml,
   Swal). Pemasangan dilakukan saat file ini dimuat (script
   di-inline di akhir body, sebelum event pengguna apa pun) dan
   idempotent lewat flag __mkDelegatedActionsInstalled.
   ============================================================ */
(function (root) {
  'use strict';

  function getDocument() {
    if (typeof document !== 'undefined') return document;
    return root.document || null;
  }

  var BUILTIN_ACTIONS = {
    swalClose: function () {
      if (root.Swal && typeof root.Swal.close === 'function') root.Swal.close();
    },
    hideAiAnalysisResult: function () {
      var doc = getDocument();
      if (!doc || typeof doc.getElementById !== 'function') return;
      var el = doc.getElementById('aiAnalysisResult');
      if (el && el.classList && typeof el.classList.add === 'function') {
        el.classList.add('hide');
      }
    }
  };

  function readAttr(el, name) {
    if (el.getAttribute) {
      var v = el.getAttribute(name);
      if (v !== null && v !== undefined) return v;
    }
    if (el.dataset) {
      var key = name.replace(/^data-/, '').replace(/-([a-z])/g, function (_, c) {
        return c.toUpperCase();
      });
      if (el.dataset[key] !== undefined) return el.dataset[key];
    }
    return null;
  }

  function parseActionArgs(el) {
    var raw = readAttr(el, 'data-args');
    if (raw !== null && raw !== '') {
      try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[delegated-actions] data-args bukan JSON valid:', raw);
        }
        return [];
      }
    }
    var single = readAttr(el, 'data-arg');
    if (single !== null && single !== '') return [single];
    return [];
  }

  function resolveDelegatedArgs(el, event, rawArgs) {
    return (rawArgs || []).map(function (arg) {
      if (arg === '$event') return event;
      if (arg === '$checked') return Boolean(el.checked);
      if (arg === '$value') return el.value;
      if (arg === '$target' || arg === '$this') return el;
      return arg;
    });
  }

  function callAction(name, args) {
    if (Object.prototype.hasOwnProperty.call(BUILTIN_ACTIONS, name)) {
      return BUILTIN_ACTIONS[name]();
    }
    var fn = root[name];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(null, args);
  }

  function dispatchDelegatedAction(el, event) {
    if (!el) return undefined;
    var spec = readAttr(el, 'data-action') || '';
    var names = spec.split('|').map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (!names.length) return undefined;
    var args = resolveDelegatedArgs(el, event, parseActionArgs(el));
    var result;
    var called = false;
    for (var i = 0; i < names.length; i++) {
      try {
        var fn = root[names[i]];
        var isBuiltin = Object.prototype.hasOwnProperty.call(BUILTIN_ACTIONS, names[i]);
        if (!isBuiltin && typeof fn !== 'function') continue;
        result = callAction(names[i], args);
        called = true;
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[delegated-actions] gagal menjalankan ' + names[i] + ':', err);
        }
      }
    }
    if (!called) {
      var fallback = readAttr(el, 'data-fallback-action');
      if (fallback) {
        try {
          result = callAction(String(fallback).trim(), args);
        } catch (err) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[delegated-actions] gagal menjalankan fallback ' + fallback + ':', err);
          }
        }
      } else if (typeof console !== 'undefined' && console.warn) {
        console.warn('[delegated-actions] aksi tidak ditemukan sebagai fungsi global:', spec);
      }
    }
    return result;
  }

  function handleDelegatedEvent(event) {
    if (!event || !event.target || typeof event.target.closest !== 'function') return;
    var el = event.target.closest('[data-action]');
    if (!el) return;
    var on = readAttr(el, 'data-action-on') || 'click';
    if (on !== event.type) return;
    if (event.type === 'submit' && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    dispatchDelegatedAction(el, event);
  }

  function setupDelegatedActions() {
    var doc = getDocument();
    if (!doc || typeof doc.addEventListener !== 'function') return false;
    if (root.__mkDelegatedActionsInstalled) return true;
    root.__mkDelegatedActionsInstalled = true;
    var types = ['click', 'change', 'input', 'submit'];
    for (var i = 0; i < types.length; i++) {
      doc.addEventListener(types[i], handleDelegatedEvent);
    }
    return true;
  }

  // Pasang segera saat file dimuat; aman dipanggil ulang (idempotent).
  setupDelegatedActions();

  Object.assign(root, {
    setupDelegatedActions: setupDelegatedActions,
    dispatchDelegatedAction: dispatchDelegatedAction,
    resolveDelegatedArgs: resolveDelegatedArgs
  });
  root.__mkDelegatedActions = {
    dispatch: dispatchDelegatedAction,
    resolveArgs: resolveDelegatedArgs,
    handleEvent: handleDelegatedEvent,
    builtin: BUILTIN_ACTIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
