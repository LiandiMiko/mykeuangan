/* supabase-api.js — exposes window.callServer over modular Supabase handlers and boots auth */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;

  window.callServer = async function (fn, ...args) {
    await core.ready;
    const h = core.handlers[fn];
    if (!h) throw new Error('Fungsi server belum tersedia: ' + fn);
    return h.apply(core.handlers, args);
  };

  if (typeof core.bootAuth === 'function') {
    core.bootAuth();
  }
})();
