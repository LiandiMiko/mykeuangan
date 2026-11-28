// @depends-on: error-messages.js
/* global Swal */
/* ============================================================
   SYNC CONFLICT — dialog & logika murni optimistic locking
   (Gelombang 7c Item 2)
   ------------------------------------------------------------
   Modul ini TIDAK tahu cara menulis ke server — ia hanya:
     (a) mengenali error konflik (code 'MK_CONFLICT', dibuat
         `createConflictError` di web/supabase-core.js),
     (b) menghitung field mana yang berubah di pihak mana
         (diff) dan menggabungkan bila aman (merge),
     (c) menampilkan dialog Bahasa Indonesia yang ramah untuk
         awam (tidak pernah error mentah), dan
     (d) memarkir konflik dari flush antrean offline supaya bisa
         diputuskan setelah sync selesai (bukan di tengah flush).
   Penegakan konflik ada di SERVER (WHERE version = ... /
   RPC save_budget_checked / delete_wallet_checked) — modul ini
   hanya menyajikan pilihan dan membangun ulang argumen tulis
   (`buildForceArgs`) untuk pilihan pengguna.
   Diekspos di `window.__mkFeat.syncConflict`.
   ============================================================ */
(function (root) {
  'use strict';

  const PARK_KEY = 'mk_sync_conflicts_v1';

  // String baku Bahasa Indonesia bila t() belum tersedia (mis. tes vm
  // yang memuat modul ini sendiri). Di aplikasi, t() dari src/i18n.html
  // selalu ada dan dipakai — kunci 'sync.*' ada di I18N.id dan I18N.en.
  const DEFAULT_STRINGS = {
    'sync.conflict_title': 'Ada perubahan yang bentrok',
    'sync.conflict_intro': 'Data ini diubah di perangkat lain setelah Anda mulai mengeditnya. Pilih versi mana yang mau disimpan.',
    'sync.conflict_summary_title': 'Beberapa perubahan bentrok',
    'sync.summary_intro': 'Perubahan berikut bentrok dengan versi terbaru di server. Putuskan satu per satu.',
    'sync.deleted_title': 'Data sudah dihapus di perangkat lain',
    'sync.deleted_intro': 'Data ini sudah dihapus di perangkat lain. Anda bisa memulihkannya sebagai data baru, atau membiarkannya terhapus.',
    'sync.delete_conflict_title': 'Data ini sudah diubah di perangkat lain',
    'sync.delete_conflict_intro': 'Anda ingin menghapus data ini, tetapi data ini sudah diubah di perangkat lain setelah Anda membukanya.',
    'sync.opt_mine': 'Pakai versi saya',
    'sync.opt_theirs': 'Pakai versi terbaru',
    'sync.opt_merge': 'Gabungkan keduanya',
    'sync.opt_restore': 'Pulihkan sebagai data baru',
    'sync.opt_keep_deleted': 'Biarkan terhapus',
    'sync.opt_force_delete': 'Tetap hapus',
    'sync.opt_keep_latest': 'Batal — simpan versi terbaru',
    'sync.btn_save_choice': 'Simpan Pilihan',
    'sync.choose_one': 'Pilih salah satu.',
    'sync.btn_review': 'Lihat & Putuskan',
    'sync.btn_later': 'Nanti Saja',
    'sync.col_field': 'Kolom',
    'sync.col_mine': 'Versi saya',
    'sync.col_server': 'Versi terbaru',
    'sync.merge_unavailable': 'Ada kolom yang diubah di kedua perangkat, jadi penggabungan otomatis tidak bisa dilakukan. Pilih salah satu versi.',
    'sync.kind_transaction': 'Transaksi',
    'sync.kind_goal': 'Target tabungan',
    'sync.kind_budget': 'Anggaran',
    'sync.kind_recurring': 'Transaksi berulang',
    'sync.kind_wallet': 'Dompet',
    'sync.field_tanggal': 'Tanggal',
    'sync.field_tipe': 'Tipe',
    'sync.field_kategori': 'Kategori',
    'sync.field_nominal': 'Nominal',
    'sync.field_keterangan': 'Keterangan',
    'sync.field_dompet': 'Dompet',
    'sync.field_jumlah': 'Jumlah',
    'sync.field_nama': 'Nama',
    'sync.field_target': 'Target',
    'sync.field_progres': 'Progres',
    'sync.field_tanggal_target': 'Tanggal target',
    'sync.field_hari': 'Tanggal tiap bulan',
    'sync.field_aktif': 'Aktif',
    'sync.field_saldo_awal': 'Saldo awal',
    'sync.field_jenis': 'Jenis',
    'sync.field_bulan': 'Bulan',
    'sync.per_month': ' / bulan'
  };

  function tr(key) {
    if (typeof root.t === 'function') {
      const v = root.t(key);
      if (v && v !== key) return v;
    }
    return DEFAULT_STRINGS[key] || key;
  }

  function esc(value) {
    if (typeof root.escapeHtml === 'function') return root.escapeHtml(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Kolom yang dibandingkan per jenis record (bentuk klien — sama
  // seperti yang dipakai handler: trxFromRow/goalFromRow/dst.).
  // `label` = kunci i18n, `money` = format Rp, `wallet` = tampilkan
  // nama dompet bila pemeta nama tersedia.
  const KIND_FIELDS = {
    transaction: [
      { field: 'tanggal', label: 'sync.field_tanggal' },
      { field: 'tipe', label: 'sync.field_tipe' },
      { field: 'kategori', label: 'sync.field_kategori' },
      { field: 'nominal', label: 'sync.field_nominal', money: true },
      { field: 'keterangan', label: 'sync.field_keterangan' },
      { field: 'walletId', label: 'sync.field_dompet', wallet: true }
    ],
    goal: [
      { field: 'name', label: 'sync.field_nama' },
      { field: 'targetAmount', label: 'sync.field_target', money: true },
      { field: 'currentAmount', label: 'sync.field_progres', money: true },
      { field: 'targetDate', label: 'sync.field_tanggal_target' }
    ],
    budget: [
      { field: 'kategori', label: 'sync.field_kategori' },
      { field: 'bulan', label: 'sync.field_bulan' },
      { field: 'jumlah', label: 'sync.field_jumlah', money: true }
    ],
    recurring: [
      { field: 'tipe', label: 'sync.field_tipe' },
      { field: 'kategori', label: 'sync.field_kategori' },
      { field: 'nominal', label: 'sync.field_nominal', money: true },
      { field: 'keterangan', label: 'sync.field_keterangan' },
      { field: 'dayOfMonth', label: 'sync.field_hari' },
      { field: 'active', label: 'sync.field_aktif', boolean: true }
    ],
    wallet: [
      { field: 'name', label: 'sync.field_nama' },
      { field: 'kind', label: 'sync.field_jenis' },
      { field: 'openingBalance', label: 'sync.field_saldo_awal', money: true }
    ]
  };

  const MONEY_FIELDS = new Set(['nominal', 'jumlah', 'targetAmount', 'currentAmount', 'openingBalance']);

  // Normalisasi nilai sebelum dibandingkan: angka vs string angka
  // ('50000' vs 50000) bukan konflik; `active` bisa boolean atau
  // string 'true'/'false' (fetchRecurringOnly memetakannya ke string).
  function normValue(field, value) {
    if (value === undefined || value === null) return '';
    if (field === 'active') return String(value) === 'true' ? 'true' : 'false';
    if (MONEY_FIELDS.has(field)) {
      const n = Number(value);
      return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(value);
    }
    if (field === 'dayOfMonth') return String(Math.trunc(Number(value) || 0));
    return String(value);
  }

  function formatMoney(value) {
    const n = Math.round(Number(value) || 0);
    const sign = n < 0 ? '-' : '';
    const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'Rp ' + sign + digits;
  }

  function formatConflictValue(field, value, opts) {
    const o = opts || {};
    if (value === undefined || value === null || value === '') return '—';
    if (field === 'active') return String(value) === 'true' || value === true ? tr('btn.ya') : tr('btn.tidak');
    if (MONEY_FIELDS.has(field)) return formatMoney(value);
    if (field === 'walletId' && o.walletNames && o.walletNames[String(value)]) return o.walletNames[String(value)];
    return String(value);
  }

  function kindLabel(kind) {
    return tr('sync.kind_' + String(kind || 'transaction'));
  }

  function recordLabel(conflict, opts) {
    const c = conflict || {};
    const cur = c.current || c.mine || {};
    const base = c.base || {};
    const pick = (obj, keys) => {
      for (const k of keys) {
        if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
      }
      return '';
    };
    if (c.kind === 'transaction') {
      const kat = pick(cur, ['kategori']) || pick(base, ['kategori']) || kindLabel('transaction');
      const nom = pick(cur, ['nominal']);
      const tgl = pick(cur, ['tanggal']) || pick(base, ['tanggal']);
      return kat + (nom !== '' ? ' — ' + formatMoney(nom) : '') + (tgl ? ', ' + tgl : '');
    }
    if (c.kind === 'goal') return pick(cur, ['name']) || pick(base, ['name']) || kindLabel('goal');
    if (c.kind === 'budget') {
      const kat = pick(cur, ['kategori']) || pick(base, ['kategori']);
      const bln = pick(cur, ['bulan']) || pick(base, ['bulan']);
      return kindLabel('budget') + ' ' + kat + (bln ? ' (' + bln + ')' : '');
    }
    if (c.kind === 'recurring') {
      const kat = pick(cur, ['kategori']) || pick(base, ['kategori']);
      const nom = pick(cur, ['nominal']);
      return (kat || kindLabel('recurring')) + (nom !== '' ? ' — ' + formatMoney(nom) + tr('sync.per_month') : '');
    }
    if (c.kind === 'wallet') return pick(cur, ['name']) || pick(base, ['name']) || kindLabel('wallet');
    return kindLabel(c.kind);
  }

  // Perbandingan per field: siapa yang mengubah apa (relatif ke base).
  // Tanpa base, semua field yang berbeda ditandai bothChanged=true
  // (tidak bisa diatribusikan) — merge tidak ditawarkan.
  function diffConflictFields(base, mine, current, kind) {
    const spec = KIND_FIELDS[kind] || KIND_FIELDS.transaction;
    const m = mine || {};
    const c = current || {};
    const b = base || null;
    const out = [];
    for (const s of spec) {
      const f = s.field;
      // Field yang tidak ada di `mine` (mis. patch parsial dompet yang
      // hanya mengubah nama) bukan perubahan saya — lewati supaya
      // dialog tidak menuduh field itu berubah.
      if (m[f] === undefined) continue;
      const myV = normValue(f, m[f]);
      const svV = normValue(f, c[f]);
      if (myV === svV) continue;
      const baseV = b ? normValue(f, b[f]) : null;
      const changedByMe = b ? myV !== baseV : null;
      const changedByServer = b ? svV !== baseV : null;
      out.push({
        field: f,
        label: tr(s.label),
        baseValue: b ? b[f] : undefined,
        myValue: m[f],
        serverValue: c[f],
        changedByMe,
        changedByServer,
        // Tanpa base, tidak bisa membuktikan "hanya satu pihak yang
        // mengubah" — anggap bentrok supaya merge tidak ditawarkan.
        bothChanged: b ? (changedByMe && changedByServer) : true
      });
    }
    return out;
  }

  // Gabungkan: field yang hanya saya ubah → versi saya; hanya server
  // yang ubah → versi server; tidak ada yang ubah → sama saja.
  // Mengembalikan { merged, unmergeableFields }: merged null bila
  // tidak bisa digabung (ada field bothChanged, atau tanpa base).
  function mergeConflictValues(base, mine, current, kind) {
    const diffs = diffConflictFields(base, mine, current, kind);
    const unmergeable = diffs.filter((d) => d.bothChanged).map((d) => d.field);
    if (!base || unmergeable.length) return { merged: null, unmergeableFields: unmergeable, diffs };
    const merged = Object.assign({}, current);
    for (const d of diffs) {
      if (d.changedByMe && !d.changedByServer) merged[d.field] = d.myValue;
    }
    return { merged, unmergeableFields: [], diffs };
  }

  function isSyncConflictError(err) {
    const core = root.__mkSb || {};
    if (typeof core.isConflictError === 'function') return core.isConflictError(err);
    if (!err || typeof err !== 'object') return false;
    if (err.code === 'MK_CONFLICT') return true;
    return Boolean(err.conflict && typeof err.conflict === 'object' && err.conflict.kind);
  }

  function createSyncConflictError(kind, details) {
    const core = root.__mkSb || {};
    if (typeof core.createConflictError === 'function') return core.createConflictError(kind, details);
    const err = new Error('CONFLICT:' + String(kind || 'record'));
    err.code = 'MK_CONFLICT';
    err.conflict = Object.assign({ kind: String(kind || 'record') }, details || {});
    return err;
  }

  // --- Parkir konflik (localStorage, bentuk JSON polos) -------------
  function readParked() {
    try {
      const raw = root.localStorage.getItem(PARK_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeParked(items) {
    try {
      root.localStorage.setItem(PARK_KEY, JSON.stringify(items || []));
    } catch (_) { /* ignore */ }
  }

  function conflictKey(conflict) {
    const c = conflict || {};
    return String(c.kind || 'record') + ':' + String(c.id || '') + ':' + String(c.operation || 'update');
  }

  function parkSyncConflict(conflict) {
    const c = Object.assign({}, conflict || {});
    if (!c.key) c.key = conflictKey(c);
    c.parkedAt = new Date().toISOString();
    const items = readParked().filter((x) => x.key !== c.key);
    items.push(c);
    writeParked(items);
    return c.key;
  }

  function getParkedSyncConflicts() {
    return readParked();
  }

  function clearParkedSyncConflict(key) {
    writeParked(readParked().filter((x) => x.key !== String(key)));
  }

  function clearAllParkedSyncConflicts() {
    writeParked([]);
  }

  // --- Dialog ------------------------------------------------------
  function getSwalClass() {
    return typeof root.getSwalClass === 'function' ? root.getSwalClass() : '';
  }

  function diffTableHtml(conflict, opts) {
    const c = conflict || {};
    const diffs = diffConflictFields(c.base, c.mine, c.current, c.kind);
    if (!diffs.length) return '';
    const rows = diffs.map((d) => (
      '<tr>' +
      '<td style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;font-weight:700">' + esc(d.label) + '</td>' +
      '<td style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">' + esc(formatConflictValue(d.field, d.myValue, opts)) + '</td>' +
      '<td style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">' + esc(formatConflictValue(d.field, d.serverValue, opts)) + '</td>' +
      '</tr>'
    )).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px">' +
      '<thead><tr>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #cbd5e1">' + esc(tr('sync.col_field')) + '</th>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #cbd5e1">' + esc(tr('sync.col_mine')) + '</th>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #cbd5e1">' + esc(tr('sync.col_server')) + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function dialogCopy(conflict) {
    const c = conflict || {};
    if (c.deletedByOther) {
      return {
        title: tr('sync.deleted_title'),
        intro: tr('sync.deleted_intro'),
        options: { restore: tr('sync.opt_restore'), theirs: tr('sync.opt_keep_deleted') }
      };
    }
    if (c.operation === 'delete') {
      return {
        title: tr('sync.delete_conflict_title'),
        intro: tr('sync.delete_conflict_intro'),
        options: { mine: tr('sync.opt_force_delete'), theirs: tr('sync.opt_keep_latest') }
      };
    }
    const merged = mergeConflictValues(c.base, c.mine, c.current, c.kind);
    const options = { mine: tr('sync.opt_mine'), theirs: tr('sync.opt_theirs') };
    if (merged.merged) options.merge = tr('sync.opt_merge');
    return {
      title: tr('sync.conflict_title'),
      intro: tr('sync.conflict_intro'),
      options,
      mergeUnavailable: !merged.merged
    };
  }

  // Menampilkan SATU dialog konflik. Mengembalikan pilihan pengguna:
  // 'mine' | 'theirs' | 'merge' | 'restore' | 'cancel'.
  // 'cancel' = tutup tanpa memutuskan (konflik tetap terparkir bila
  // pemanggil memarkirnya; edit online dibiarkan apa adanya).
  async function showSyncConflictDialog(conflict, opts) {
    const c = conflict || {};
    const copy = dialogCopy(c);
    const walletNames = (opts && opts.walletNames) || null;
    const html =
      '<p style="text-align:left;font-size:13px;line-height:1.55;margin:0 0 4px">' + esc(copy.intro) + '</p>' +
      '<p style="text-align:left;font-size:13px;font-weight:800;margin:8px 0 0">' + esc(kindLabel(c.kind)) + ': ' + esc(recordLabel(c, { walletNames })) + '</p>' +
      (c.operation === 'delete' || c.deletedByOther ? '' : diffTableHtml(c, { walletNames })) +
      (copy.mergeUnavailable
        ? '<p style="text-align:left;font-size:12px;line-height:1.5;color:#b45309;margin:10px 0 0">' + esc(tr('sync.merge_unavailable')) + '</p>'
        : '');

    if (typeof root.Swal === 'undefined') {
      // Fallback tanpa SweetAlert: konfirmasi native (hanya dua arah).
      try {
        const ok = root.confirm(copy.title + '\n' + recordLabel(c, { walletNames }) + '\n\n' + copy.intro);
        return ok ? 'mine' : 'cancel';
      } catch (_) {
        return 'cancel';
      }
    }

    const optionKeys = Object.keys(copy.options);
    const res = await root.Swal.fire({
      icon: 'warning',
      title: copy.title,
      html,
      input: 'radio',
      inputOptions: copy.options,
      inputValidator: (value) => (!value ? tr('sync.choose_one') : undefined),
      showCancelButton: true,
      confirmButtonText: tr('sync.btn_save_choice'),
      cancelButtonText: tr('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (res.isConfirmed && res.value && optionKeys.indexOf(String(res.value)) !== -1) return String(res.value);
    return 'cancel';
  }

  async function showConflictSummaryDialog(conflicts) {
    const list = (conflicts || []).map((c) => (
      '<li style="text-align:left;font-size:13px;padding:4px 0">• ' + esc(kindLabel(c.kind)) + ': ' + esc(recordLabel(c)) + '</li>'
    )).join('');
    if (typeof root.Swal === 'undefined') return false;
    const res = await root.Swal.fire({
      icon: 'warning',
      title: tr('sync.conflict_summary_title'),
      html: '<p style="text-align:left;font-size:13px;line-height:1.55;margin:0">' + esc(tr('sync.summary_intro')) + '</p>' +
        '<ul style="margin:10px 0 0;padding-left:6px;list-style:none">' + list + '</ul>',
      showCancelButton: true,
      confirmButtonText: tr('sync.btn_review'),
      cancelButtonText: tr('sync.btn_later'),
      customClass: { popup: getSwalClass() }
    });
    return !!res.isConfirmed;
  }

  // Menawarkan konflik yang terparkir satu per satu. `resolver`
  // (didaftarkan flush antrean offline) menerapkan pilihan pengguna
  // dan mengembalikan payload refresh (atau null). Mengembalikan
  // jumlah konflik yang diputuskan.
  async function promptParkedSyncConflicts(resolver) {
    const parked = getParkedSyncConflicts();
    if (!parked.length) return 0;
    const wantReview = await showConflictSummaryDialog(parked);
    if (!wantReview) return 0;
    let resolved = 0;
    let refreshPayload = null;
    const mergeRefresh = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      refreshPayload = refreshPayload || {};
      Object.keys(payload).forEach((k) => { refreshPayload[k] = payload[k]; });
    };
    for (const conflict of getParkedSyncConflicts()) {
      const choice = await showSyncConflictDialog(conflict);
      if (choice === 'cancel') continue;
      try {
        if (typeof resolver === 'function') mergeRefresh(await resolver(conflict, choice));
      } catch (err) {
        // Pilihan gagal diterapkan (mis. record berubah lagi) — biarkan
        // tetap terparkir supaya bisa diputuskan lagi nanti; jangan
        // pernah menampilkan error mentah di sini.
        if (typeof root.console !== 'undefined' && root.console.warn) {
          root.console.warn('Gagal menerapkan pilihan konflik:', err);
        }
        continue;
      }
      clearParkedSyncConflict(conflict.key);
      resolved += 1;
    }
    if (refreshPayload && typeof root.refreshFromServer === 'function') {
      try { await root.refreshFromServer(refreshPayload); } catch (_) { /* ignore */ }
    }
    return resolved;
  }

  // --- Membangun ulang argumen tulis dari pilihan pengguna ---------
  // Dipakai flush offline (resolver) DAN call-site online — satu
  // tempat, supaya 'Pakai versi saya' / 'Gabungkan' / 'Pulihkan'
  // selalu memanggil handler dengan cara yang sama.
  // Mengembalikan { callOp, callArgs } atau null untuk 'theirs'
  // (buang edit saya — state lokal sudah = server setelah refresh).
  function cleanPayloadForInsert(payload) {
    const out = Object.assign({}, payload || {});
    delete out.id;
    delete out.version;
    delete out.__base;
    delete out.idempotencyKey;
    return out;
  }

  function rebuildArgsForMerged(conflict, merged) {
    const c = conflict || {};
    const args = Array.isArray(c.args) ? c.args.slice() : [];
    // `merged` menyalin `current` apa adanya (termasuk id + version).
    // id/version TIDAK BOLEH ikut ke payload tulis: trxRow() memakai
    // d.id sebagai legacy_id bila ada — update transaksi akan
    // menimpa legacy_id dengan id record itu sendiri. saveGoal /
    // saveRecurring justru BUTUH id (penanda update vs insert).
    if (c.op === 'api_updateTransaction') {
      const payload = Object.assign({}, merged, { __base: c.current });
      delete payload.id;
      delete payload.version;
      return [args[0], payload, 'force'];
    }
    if (c.op === 'api_saveGoal' || c.op === 'api_saveRecurring') {
      const payload = Object.assign({}, merged, { __base: c.current });
      delete payload.version;
      return [payload, 'force'];
    }
    if (c.op === 'api_updateWallet') {
      const payload = Object.assign({}, merged, { __base: c.current });
      delete payload.id;
      delete payload.version;
      return [args[0], payload, 'force'];
    }
    if (c.op === 'api_saveBudget') return [merged.kategori, merged.bulan, merged.jumlah, 'force', c.current];
    return null;
  }

  function buildForceArgs(conflict, choice) {
    const c = conflict || {};
    const args = Array.isArray(c.args) ? c.args.slice() : [];
    if (choice === 'theirs' || choice === 'cancel') return null;
    if (choice === 'restore') {
      // Update atas record yang sudah dihapus → pulihkan sebagai
      // transaksi BARU (id baru dari server). Hanya masuk akal untuk
      // transaksi; jenis lain tidak punya jalur restore.
      if (c.kind !== 'transaction') return null;
      return { callOp: 'api_addTransaction', callArgs: [cleanPayloadForInsert(c.mine)] };
    }
    if (choice === 'merge') {
      const res = mergeConflictValues(c.base, c.mine, c.current, c.kind);
      if (!res.merged) return null;
      const rebuilt = rebuildArgsForMerged(c, res.merged);
      if (!rebuilt) return null;
      return { callOp: c.op, callArgs: rebuilt };
    }
    if (choice === 'mine') {
      // 'force' = timpa yang DISETUJUI pengguna: handler mengambil
      // versi kini lalu update bersyarat terhadap versi itu.
      return { callOp: c.op, callArgs: args.concat(['force']) };
    }
    return null;
  }

  // Menangani SATU error konflik dari call-site online: tampilkan
  // dialog, terapkan pilihan, kembalikan { handled, result }.
  // `call` = (op, ...args) => Promise (biasanya root.callServer),
  // `refresh` = refreshFromServer. 'theirs'/'cancel' me-refresh state
  // ke server dan mengembalikan result null. Bukan konflik →
  // { handled: false } (pemanggil menampilkan error biasa).
  async function handleOnlineConflict(err, call, refresh) {
    if (!isSyncConflictError(err) || !err.conflict) return { handled: false };
    const choice = await showSyncConflictDialog(err.conflict);
    if (choice === 'theirs' || choice === 'cancel') {
      if (typeof refresh === 'function' && typeof call === 'function') {
        try { await refresh(await call('getInitialData')); } catch (_) { /* ignore */ }
      }
      return { handled: true, result: null };
    }
    const built = buildForceArgs(err.conflict, choice);
    if (!built) return { handled: true, result: null };
    const result = await call(built.callOp, ...built.callArgs);
    return { handled: true, result };
  }

  let registeredResolver = null;
  function registerSyncConflictResolver(fn) {
    registeredResolver = typeof fn === 'function' ? fn : null;
  }

  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.syncConflict = {
    PARK_KEY,
    KIND_FIELDS,
    tr,
    formatMoney,
    formatConflictValue,
    kindLabel,
    recordLabel,
    diffConflictFields,
    mergeConflictValues,
    isSyncConflictError,
    createSyncConflictError,
    parkSyncConflict,
    getParkedSyncConflicts,
    clearParkedSyncConflict,
    clearAllParkedSyncConflicts,
    showSyncConflictDialog,
    showConflictSummaryDialog,
    promptParkedSyncConflicts,
    handleOnlineConflict,
    buildForceArgs,
    registerSyncConflictResolver,
    getResolver: () => registeredResolver
  };
})(typeof window !== 'undefined' ? window : globalThis);
