// @depends-on: error-messages.js
/* global DB, Swal, refreshFromServer, getSwalClass, refreshNotificationBell */
/* ============================================================
   FEATURES — OFFLINE QUEUE & CALLSERVER WRAPPER
   ============================================================ */
(function (root) {
  'use strict';

  // Gelombang 5.3 (Q10): localToday() kanonis tinggal di
  // web/error-messages.js (dimuat pertama). Bila modul ini dimuat
  // sendiri tanpa itu (tes vm lama), sediakan implementasi lokal
  // yang sama agar modul tetap jalan — komponen lokal, JANGAN
  // toISOString() (UTC, geser hari di WIB). Di aplikasi ini
  // no-op karena error-messages.js sudah dimuat pertama.
  if (typeof root.localToday !== 'function') {
    root.localToday = function () {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
  }

  const OFFLINE_QUEUE_KEY = 'mk_offline_tx_queue_v1';
  const IDB_NAME = 'mykeuangan_offline_db';
  const IDB_VERSION = 3;
  const IDB_STORE = 'pending_transactions';
  const IDB_SNAPSHOT_STORE = 'offline_snapshot';
  // Store baru (v3) untuk state cooldown/lockout PIN (T2). Sebelumnya state ini hanya
  // di localStorage (`mk_pin_lock_state_v1`) sehingga bisa dihapus dari DevTools dan
  // percobaan PIN menjadi tanpa batas. localStorage kini hanya fallback bila
  // IndexedDB tidak tersedia — lihat read/writePinLockState di ui-feat-account.js.
  const IDB_PIN_LOCK_STORE = 'pin_lock_state';
  const MAX_OFFLINE_RETRIES = 3;
  // Wave 3.5 §7: nomor urut monoton antrean (disimpan di localStorage
  // agar monoton lintas reload). Flush mengurutkan berdasarkan ini,
  // bukan berdasarkan getAll() IndexedDB (urut string localId) atau
  // mirror localStorage yang tidak berurutan.
  const OFFLINE_SEQ_KEY = 'mk_offline_seq_v1';
  function nextOfflineSeq() {
    try {
      const cur = Number(localStorage.getItem(OFFLINE_SEQ_KEY) || '0') || 0;
      const next = cur + 1;
      localStorage.setItem(OFFLINE_SEQ_KEY, String(next));
      return next;
    } catch (_) {
      return Date.now();
    }
  }
  function ensureOfflineSeq(item) {
    if (item && (item.seq === undefined || item.seq === null)) item.seq = nextOfflineSeq();
    return item;
  }
  function sortOfflineQueue(items) {
    return (items || []).slice().sort((a, b) => {
      const sa = (a && typeof a.seq === 'number') ? a.seq : Infinity;
      const sb = (b && typeof b.seq === 'number') ? b.seq : Infinity;
      if (sa !== sb) return sa - sb;
      const ca = Date.parse((a && a.createdAt) || '') || 0;
      const cb = Date.parse((b && b.createdAt) || '') || 0;
      if (ca !== cb) return ca - cb;
      return String((a && a.localId) || '') < String((b && b.localId) || '') ? -1 : 1;
    });
  }
  // Kunci ordering per target: update/delete atas transaksi yang sama,
  // transfer yang sama, dsb. Item gagal memblokir item lain dengan
  // kunci yang sama di flush yang sama (bukan seluruh antrean).
  function offlineTargetKey(item) {
    if (!item) return '';
    return String(item.targetId || item.localId || '');
  }
  let isFlushingOffline = false;
  let offlineDbPromise = null;

  function readLocalQueue() {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocalQueue(items) {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items || []));
    } catch (_) {
      /* ignore */
    }
  }

  function openOfflineDb() {
    if (!root.indexedDB) return Promise.resolve(null);
    if (offlineDbPromise) return offlineDbPromise;
    offlineDbPromise = new Promise((resolve) => {
      try {
        const req = root.indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'localId' });
          }
          if (!db.objectStoreNames.contains(IDB_SNAPSHOT_STORE)) {
            db.createObjectStore(IDB_SNAPSHOT_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(IDB_PIN_LOCK_STORE)) {
            db.createObjectStore(IDB_PIN_LOCK_STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            try { db.close(); } catch (_) { /* ignore */ }
            offlineDbPromise = null;
          };
          db.onclose = () => { offlineDbPromise = null; };
          resolve(db);
        };
        req.onerror = () => {
          offlineDbPromise = null;
          resolve(null);
        };
      } catch (_) {
        offlineDbPromise = null;
        resolve(null);
      }
    });
    return offlineDbPromise;
  }

  /* ============================================================
     KRIPTO PIN / DEK (K2) — satu-satunya implementasi kanonis.
     Dipakai ui-feat-account.js (pembuatan/unwrap DEK) dan
     ui-feat-cache.js (snapshot) lewat `__mkFeat.pinCrypto`.
     Desain envelope (ikuti persis, jangan diubah sepihak):
     - DEK: kunci AES-GCM 256-bit acak, dibuat saat PIN pertama diset.
     - KEK: PBKDF2(PIN ber-domain `mk-data-key:`, salt acak 16 byte,
       100.000 iterasi, SHA-256) -> AES-GCM 256. Domain berbeda dari
       hash verifikasi PIN (`derivePinHash`), jadi KEK != hash PIN.
     - DEK dibungkus (wrap) dengan KEK via AES-GCM (IV acak 12 byte);
       hasil wrap + salt + IV disimpan di localStorage
       `mk_pin_data_key_wrap` (lihat ui-feat-account.js). DEK hasil
       unwrap HANYA di memori, tidak pernah di localStorage/IndexedDB.
     - Data (snapshot/antrean) dienkripsi dengan DEK, AES-GCM,
       IV acak per simpan/per item; envelope `{iv, ct}` base64.
     ============================================================ */
  function pinCryptoBytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function pinCryptoB64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function pinCryptoSubtle() {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle) throw new Error('Web Crypto tidak tersedia pada perangkat ini.');
    return subtle;
  }

  function pinCryptoRandomBytes(n) {
    const bytes = new Uint8Array(n);
    root.crypto.getRandomValues(bytes);
    return bytes;
  }

  async function derivePinKek(pin, saltBytes) {
    const subtle = pinCryptoSubtle();
    const keyMat = await subtle.importKey('raw', new TextEncoder().encode('mk-data-key:' + String(pin || '')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
      keyMat,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function wrapPinDataKey(dek, pin) {
    const salt = pinCryptoRandomBytes(16);
    const iv = pinCryptoRandomBytes(12);
    const kek = await derivePinKek(pin, salt);
    const rawDek = await pinCryptoSubtle().exportKey('raw', dek);
    const wrapped = await pinCryptoSubtle().encrypt({ name: 'AES-GCM', iv }, kek, rawDek);
    return {
      format: 'mk-pin-dek-wrap-v1',
      kdf: 'PBKDF2-SHA256',
      iterations: 100000,
      salt: pinCryptoBytesToB64(salt),
      iv: pinCryptoBytesToB64(iv),
      wrappedKey: pinCryptoBytesToB64(new Uint8Array(wrapped))
    };
  }

  async function unwrapPinDataKey(wrap, pin) {
    const w = wrap && typeof wrap === 'object' ? wrap : {};
    if (w.format !== 'mk-pin-dek-wrap-v1') throw new Error('Format wrap kunci PIN tidak dikenali.');
    const salt = pinCryptoB64ToBytes(w.salt);
    const iv = pinCryptoB64ToBytes(w.iv);
    const wrapped = pinCryptoB64ToBytes(w.wrappedKey);
    const kek = await derivePinKek(pin, salt);
    const rawDek = await pinCryptoSubtle().decrypt({ name: 'AES-GCM', iv }, kek, wrapped);
    return pinCryptoSubtle().importKey('raw', rawDek, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  async function encryptWithPinDek(dek, plaintext) {
    const iv = pinCryptoRandomBytes(12);
    const ct = await pinCryptoSubtle().encrypt({ name: 'AES-GCM', iv }, dek, new TextEncoder().encode(String(plaintext)));
    return { iv: pinCryptoBytesToB64(iv), ct: pinCryptoBytesToB64(new Uint8Array(ct)) };
  }

  async function decryptWithPinDek(dek, envelope) {
    const env = envelope && typeof envelope === 'object' ? envelope : {};
    const plainBuf = await pinCryptoSubtle().decrypt(
      { name: 'AES-GCM', iv: pinCryptoB64ToBytes(env.iv) },
      dek,
      pinCryptoB64ToBytes(env.ct)
    );
    return new TextDecoder().decode(plainBuf);
  }

  const pinCrypto = {
    bytesToB64: pinCryptoBytesToB64,
    b64ToBytes: pinCryptoB64ToBytes,
    derivePinKek,
    wrapPinDataKey,
    unwrapPinDataKey,
    encryptWithDek: encryptWithPinDek,
    decryptWithDek: decryptWithPinDek
  };

  // DEK tinggal di memori di ui-feat-account.js; file ini hanya mengaksesnya
  // lewat getter agar tidak ada salinan kunci di tempat lain.
  function getPinDataKey() {
    const feat = root.__mkFeat || {};
    return typeof feat.getPinDataKey === 'function' ? feat.getPinDataKey() : null;
  }

  function isPinSet() {
    try { return Boolean(localStorage.getItem('mk_app_pin_hash')); } catch (_) { return false; }
  }

  // State cooldown PIN (T2) di IndexedDB, store `pin_lock_state`, record key 'state'.
  async function readPinLockStateIdb() {
    const db = await openOfflineDb();
    if (!db || !db.objectStoreNames.contains(IDB_PIN_LOCK_STORE)) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_PIN_LOCK_STORE, 'readonly');
        const req = tx.objectStore(IDB_PIN_LOCK_STORE).get('state');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function writePinLockStateIdb(state) {
    const db = await openOfflineDb();
    if (!db || !db.objectStoreNames.contains(IDB_PIN_LOCK_STORE)) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_PIN_LOCK_STORE, 'readwrite');
        tx.objectStore(IDB_PIN_LOCK_STORE).put(Object.assign({ key: 'state' }, state || {}));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  // --- Enkripsi payload antrean (K2) -------------------------------------
  // Hanya field `payload` tiap item yang dienkripsi (AES-GCM + DEK, IV acak
  // per item, disimpan sebagai `{__enc: 1, iv, ct}` base64). Field envelope
  // (`localId`, `op`, `targetId`, `failed`, `retryCount`, `createdAt`,
  // `lastError`) tetap plaintext agar penghitung antrean, pill status, dan
  // logika flush tetap bekerja tanpa dekripsi.
  function isEncryptedPayload(p) {
    return Boolean(p && typeof p === 'object' && p.__enc === 1 && typeof p.iv === 'string' && typeof p.ct === 'string');
  }

  async function encryptQueuePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (isEncryptedPayload(payload)) return payload;
    const dek = getPinDataKey();
    if (!dek) return payload; // Belum ada PIN / masih terkunci: tetap plaintext,
    // dimigrasikan ke terenkripsi saat unlock (migrateQueueToEncrypted).
    try {
      const env = await encryptWithPinDek(dek, JSON.stringify(payload));
      return { __enc: 1, iv: env.iv, ct: env.ct };
    } catch (_) {
      return payload;
    }
  }

  // Mengembalikan objek payload terdekripsi, atau `null` bila payload
  // terenkripsi tapi DEK tidak tersedia / dekripsi gagal. Payload plaintext
  // lama dikembalikan apa adanya.
  async function decryptQueuePayload(item) {
    const p = item && item.payload;
    if (!p) return null;
    if (!isEncryptedPayload(p)) return p;
    const dek = getPinDataKey();
    if (!dek) return null;
    try {
      return JSON.parse(await decryptWithPinDek(dek, p));
    } catch (_) {
      return null;
    }
  }

  async function saveOfflineQueueItemRaw(item) {
    writeLocalQueue(readLocalQueue().filter((x) => x.localId !== item.localId).concat([item]));
    const db = await openOfflineDb();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(item);
    } catch (_) {
      /* ignore */
    }
  }

  async function saveOfflineQueueItem(item) {
    const stored = ensureOfflineSeq(Object.assign({}, item));
    if (stored.payload) stored.payload = await encryptQueuePayload(stored.payload);
    await saveOfflineQueueItemRaw(stored);
  }

  async function removeOfflineQueueItem(localId) {
    writeLocalQueue(readLocalQueue().filter((x) => x.localId !== localId));
    const db = await openOfflineDb();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(localId);
    } catch (_) {
      /* ignore */
    }
  }

  async function getOfflineQueueItems() {
    const db = await openOfflineDb();
    if (!db) return sortOfflineQueue(readLocalQueue());
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => {
          const idbItems = Array.isArray(req.result) ? req.result : [];
          if (idbItems.length) writeLocalQueue(idbItems);
          resolve(sortOfflineQueue(idbItems.length ? idbItems : readLocalQueue()));
        };
        req.onerror = () => resolve(sortOfflineQueue(readLocalQueue()));
      } catch (_) {
        resolve(sortOfflineQueue(readLocalQueue()));
      }
    });
  }

  function isNetworkOfflineError(err) {
    if (!navigator.onLine) return true;
    const msg = String((err && err.message) || err || '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed');
  }

  // Gelombang 6 (U14): pil "Offline" di header tidak menjelaskan apa-apa
  // (penjelasan hanya di atribut title yang tak muncul saat disentuh di
  // HP). Saat pertama kali masuk mode offline, tampilkan toast sekali per
  // sesi offline — pola .mk-toast yang sama seperti toast pembaruan PWA
  // (ui-pro-quick.js): tombol tutup + hilang otomatis. Sekali per sesi
  // supaya tidak spam tiap perubahan status; flag direset saat online.
  let offlineToastShown = false;
  function showOfflineToastOnce() {
    if (offlineToastShown || typeof document === 'undefined') return;
    offlineToastShown = true;
    if (document.getElementById('mkOfflineToast')) return;
    const toast = document.createElement('div');
    toast.id = 'mkOfflineToast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('data-open', 'false');
    toast.className = 'mk-toast fixed left-4 right-4 sm:left-auto sm:right-4 z-50 sm:max-w-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl shadow-2xl p-3.5 flex items-center gap-3 border border-slate-700 dark:border-slate-200';
    const icon = document.createElement('i');
    icon.className = 'ph ph-wifi-slash text-xl text-amber-400 dark:text-amber-600 shrink-0';
    icon.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = 'min-w-0 flex-1 text-xs';
    const title = document.createElement('p');
    title.className = 'font-bold';
    title.textContent = 'Anda offline';
    const sub = document.createElement('p');
    sub.className = 'opacity-80 text-[11px]';
    sub.textContent = 'Transaksi tersimpan di perangkat dan akan terkirim otomatis saat online.';
    body.append(title, sub);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Tutup');
    closeBtn.className = 'w-8 h-8 rounded-lg opacity-75 hover:opacity-100 flex items-center justify-center shrink-0';
    const closeIcon = document.createElement('i');
    closeIcon.className = 'ph ph-x';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeBtn.appendChild(closeIcon);
    toast.append(icon, body, closeBtn);
    document.body.appendChild(toast);
    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(() => toast.setAttribute('data-open', 'true'));
    } else {
      toast.setAttribute('data-open', 'true');
    }
    const dismiss = () => {
      toast.setAttribute('data-open', 'false');
      root.setTimeout(() => toast.remove(), 190);
    };
    closeBtn.addEventListener('click', dismiss);
    root.setTimeout(dismiss, 6000);
  }

  function handleOfflineEvent() {
    updateNetworkStatusPill();
    showOfflineToastOnce();
  }

  function handleOnlineEvent() {
    offlineToastShown = false;
    updateNetworkStatusPill();
  }

  function updateNetworkStatusPill() {
    const pill = document.getElementById('networkStatusPill');
    if (!pill) return;
    const queue = readLocalQueue();
    const pendingCount = queue.filter((x) => !x.failed).length;
    const failedCount = queue.filter((x) => x.failed).length;
    const offline = !navigator.onLine;
    if (!offline && pendingCount === 0 && failedCount === 0) {
      pill.classList.add('hide');
      return;
    }
    pill.classList.remove('hide');
    pill.textContent = '';
    const icon = document.createElement('i');
    icon.className = offline
      ? 'ph-bold ph-wifi-slash text-sm'
      : (failedCount > 0 ? 'ph-bold ph-warning-circle text-sm' : 'ph-bold ph-arrows-clockwise text-sm');
    icon.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('span');
    if (offline) {
      const total = pendingCount + failedCount;
      txt.textContent = total > 0 ? `Offline (${total})` : 'Offline';
    } else if (failedCount > 0) {
      txt.textContent = pendingCount > 0 ? `Gagal (${failedCount}) · ${pendingCount}` : `Gagal (${failedCount})`;
    } else {
      txt.textContent = `Sync (${pendingCount})`;
    }
    const toneClass = offline
      ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
      : (failedCount > 0
        ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
        : 'border-brand/40 bg-brand/10 text-brand dark:text-brand-ink');
    pill.className = 'inline-flex items-center gap-1 h-10 lg:h-11 px-2.5 rounded-xl border text-[11px] font-bold transition-colors shrink-0 ' + toneClass;
    pill.title = offline
      ? 'Mode offline aktif — transaksi baru tersimpan lokal'
      : (failedCount > 0 ? 'Ada transaksi offline gagal sinkronisasi — klik untuk kelola' : 'Klik untuk menyinkronkan antrean offline');
    pill.append(icon, txt);
  }

  async function recordOfflineFailure(item, err) {
    const nextRetry = (Number(item.retryCount) || 0) + 1;
    const isFailed = nextRetry >= MAX_OFFLINE_RETRIES;
    const errMsg = String((err && err.message) || err || 'Ditolak server').slice(0, 180);
    await saveOfflineQueueItem(Object.assign({}, item, {
      retryCount: nextRetry,
      failed: isFailed,
      lastError: errMsg,
      lastTriedAt: new Date().toISOString()
    }));
    return { isFailed, errMsg };
  }

  async function promptFailedOfflineQueue(failedCount, sampleError) {
    if (typeof Swal === 'undefined' || failedCount <= 0) return;
    const res = await Swal.fire({
      icon: 'warning',
      title: `${failedCount} transaksi offline gagal`,
      text: sampleError
        ? `Server menolak sinkronisasi: ${sampleError}. Coba ulang sekarang atau buang item bermasalah?`
        : 'Sebagian antrean offline ditolak server berulang kali. Coba ulang sekarang atau buang item bermasalah?',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Coba Ulang',
      denyButtonText: 'Buang Gagal',
      cancelButtonText: 'Tutup',
      customClass: { popup: getSwalClass() }
    });
    if (res.isConfirmed) await retryFailedOfflineItems();
    else if (res.isDenied) await discardFailedOfflineItems();
  }

  async function retryFailedOfflineItems() {
    const queue = await getOfflineQueueItems();
    const failed = queue.filter((x) => x.failed);
    for (const item of failed) {
      await saveOfflineQueueItem(Object.assign({}, item, { retryCount: 0, failed: false, lastError: '' }));
    }
    updateNetworkStatusPill();
    return flushOfflineQueue(false);
  }

  async function discardFailedOfflineItems() {
    const queue = await getOfflineQueueItems();
    const failed = queue.filter((x) => x.failed);
    for (const item of failed) {
      await removeOfflineQueueItem(item.localId);
      if (typeof DB !== 'undefined' && Array.isArray(DB.transactions)) {
        DB.transactions = DB.transactions.filter((tx) => tx.id !== item.localId);
      }
    }
    updateNetworkStatusPill();
    if (typeof refreshNotificationBell === 'function') refreshNotificationBell();
    if (typeof root.renderAll === 'function' && root.isDataReady) root.renderAll();
    return failed.length;
  }

  async function flushOfflineQueue(silent) {
    if (isFlushingOffline || !navigator.onLine) return 0;
    const queue = await getOfflineQueueItems();
    if (!queue.length) return 0;
    const pendingItems = queue.filter((x) => !x.failed);
    const prevFailed = queue.filter((x) => x.failed);

    if (!pendingItems.length) {
      if (!silent && prevFailed.length) {
        await promptFailedOfflineQueue(prevFailed.length, prevFailed[0].lastError);
      }
      return 0;
    }

    isFlushingOffline = true;
    let synced = 0;
    let newlyFailed = 0;
    let lastErrMsg = '';
    const addedTransactions = [];
    const deletedTransactionIds = [];
    let latestTransfers = null;
    let latestWallets = null;
    let latestPeriod = '';
    const extraRefresh = {};
    // §7b: item yang gagal (server menolak / dekripsi gagal setelah
    // retry habis) memblokir item lain untuk TARGET YANG SAMA di flush
    // ini — update/delete tidak boleh menyalip add yang gagal untuk
    // transaksi yang sama. Target lain tetap jalan.
    const blockedTargets = new Set();
    try {
      for (const item of pendingItems) {
        const op = item.op || 'api_addTransaction';
        if (blockedTargets.has(offlineTargetKey(item))) continue;
        // Dekripsi payload sebelum dikirim (K2). Bila dekripsi gagal,
        // JANGAN langsung failed: catat lewat penghitung retry yang
        // sama seperti penolakan server (§7c) — hanya gagal permanen
        // setelah MAX_OFFLINE_RETRIES percobaan.
        let payload = null;
        if (op !== 'api_deleteTransaction' && item.payload) {
          payload = await decryptQueuePayload(item);
          if (payload === null) {
            const recorded = await recordOfflineFailure(item, new Error('Gagal mendekripsi antrean offline (kunci PIN tidak tersedia atau data rusak). Item dipertahankan.'));
            // Sekali ditolak di flush ini, item lain untuk target yang
            // sama tidak boleh menyalip — walau retry item ini belum habis.
            blockedTargets.add(offlineTargetKey(item));
            if (recorded.isFailed) {
              newlyFailed += 1;
              lastErrMsg = recorded.errMsg;
            }
            continue;
          }
        }
        try {
          let res = null;
          if (op === 'api_updateTransaction') res = await root._rawCallServer('api_updateTransaction', item.targetId, Object.assign({}, payload));
          else if (op === 'api_deleteTransaction') res = await root._rawCallServer('api_deleteTransaction', item.targetId);
          else if (op === 'api_addTransfer') res = await root._rawCallServer('api_addTransfer', Object.assign({}, payload));
          else if (op === 'api_addTransaction') res = await root._rawCallServer('api_addTransaction', Object.assign({}, payload));
          else if (payload && Array.isArray(payload.args)) res = await root._rawCallServer(op, ...payload.args);
          else res = await root._rawCallServer(op, Object.assign({}, payload));

          if (res && res.transaction) addedTransactions.push(res.transaction);
          if (res && res.deletedTransactionId) deletedTransactionIds.push(res.deletedTransactionId);
          if (res && res.transfers) latestTransfers = res.transfers;
          if (res && res.wallets) latestWallets = res.wallets;
          if (res && res.currentPeriod && (!latestPeriod || res.currentPeriod > latestPeriod)) latestPeriod = res.currentPeriod;
          if (res) {
            ['budgets', 'goals', 'recurring', 'categories', 'assets', 'debtDueDates'].forEach((k) => {
              if (res[k] !== undefined) extraRefresh[k] = res[k];
            });
          }
          await removeOfflineQueueItem(item.localId);
          if (typeof DB !== 'undefined' && Array.isArray(DB.transactions) && op === 'api_addTransaction') {
            DB.transactions = DB.transactions.filter((tx) => tx.id !== item.localId);
          }
          synced += 1;
        } catch (err) {
          if (isNetworkOfflineError(err)) break;
          const recorded = await recordOfflineFailure(item, err);
          // Sekali ditolak di flush ini, item lain untuk target yang
          // sama tidak boleh menyalip — walau retry item ini belum habis.
          blockedTargets.add(offlineTargetKey(item));
          if (recorded.isFailed) {
            newlyFailed += 1;
            lastErrMsg = recorded.errMsg;
          }
        }
      }
      if (synced > 0 && typeof refreshFromServer === 'function') {
        await refreshFromServer({
          addedTransactions,
          deletedTransactionIds,
          ...(latestTransfers ? { transfers: latestTransfers } : {}),
          ...(latestWallets ? { wallets: latestWallets } : {}),
          ...(latestPeriod ? { currentPeriod: latestPeriod } : {}),
          ...extraRefresh
        });
      }
      // Admin — antrean offline berhasil tersinkronisasi: catat
      // aktivitas sendiri (best-effort, throttled 1x/jam di helper;
      // jangan pernah gagalkan flush bila RPC gagal).
      if (synced > 0) {
        try {
          const feat = root.__mkFeat || {};
          if (typeof feat.touchOwnActivity === 'function') feat.touchOwnActivity();
        } catch (_) { /* abaikan */ }
      }
      if (synced > 0 && !silent && typeof Swal !== 'undefined') {
        Swal.fire({
          icon: 'success',
          title: synced + ' perubahan offline tersinkronisasi',
          timer: 1600,
          showConfirmButton: false,
          customClass: { popup: getSwalClass() }
        });
      } else if (newlyFailed > 0 && !silent) {
        await promptFailedOfflineQueue(newlyFailed + prevFailed.length, lastErrMsg);
      }
    } finally {
      isFlushingOffline = false;
      updateNetworkStatusPill();
      if (typeof refreshNotificationBell === 'function') refreshNotificationBell();
    }
    return synced;
  }

  // Wave 3.5 §7d: dulu hanya 4 op yang diantrekan; sisanya hilang
  // begitu saja saat offline (kecuali api_savePeriod yang lebih parah:
  // berpura-pura sukses). Operasi generik diantrekan dengan argumen
  // lengkapnya dan di-flush lewat _rawCallServer(op, ...args).
  const OFFLINE_MUTATIONS = new Set([
    'api_addTransaction', 'api_updateTransaction', 'api_deleteTransaction', 'api_addTransfer',
    'api_addWallet', 'api_addCategory', 'api_saveBudget', 'api_saveGoal',
    'api_saveRecurring', 'api_addAssetV2', 'api_deleteTransfer',
    'api_saveDebtDueDates', 'api_savePayrollDay', 'api_savePrimaryBankWallet',
    'api_savePeriod'
  ]);

  // Kunci ordering untuk op generik (dipakai pemblokiran per-target
  // saat flush): perubahan atas objek yang sama berbagi kunci.
  function deriveGenericTargetId(op, args) {
    const a = args || [];
    if (op === 'api_deleteTransfer') return String(a[0] || '');
    if (op === 'api_saveBudget') return 'budget:' + String(a[0] || '') + ':' + String(a[1] || '');
    if (op === 'api_saveGoal') return 'goal:' + String((a[0] && (a[0].id || a[0].name)) || '');
    if (op === 'api_saveRecurring') return 'recurring:' + String((a[0] && (a[0].id || a[0].kategori)) || '');
    if (op === 'api_addCategory') return 'category:' + String(a[0] || '') + ':' + String(a[1] || '');
    if (op === 'api_saveDebtDueDates') return 'debtDueDates';
    if (op === 'api_savePayrollDay') return 'payrollDay';
    if (op === 'api_savePrimaryBankWallet') return 'primaryBankWallet';
    if (op === 'api_savePeriod') return 'period';
    return '';
  }

  function buildOfflineTransactionResponse(localId, txPayload) {
    return {
      _offlineQueued: true,
      transaction: {
        id: localId, tanggal: txPayload.tanggal, tipe: txPayload.tipe, kategori: txPayload.kategori,
        nominal: Number(txPayload.nominal) || 0,
        keterangan: (txPayload.keterangan ? txPayload.keterangan + ' ' : '') + '[Offline Queue]',
        walletId: txPayload.walletId || ''
      }
    };
  }

  function bumpOfflineBadgeRefresh() {
    setTimeout(() => {
      updateNetworkStatusPill();
      if (typeof refreshNotificationBell === 'function') refreshNotificationBell();
    }, 40);
  }

  /* ============================================================
     IDEMPOTENCY KEY ANTREAN OFFLINE (T13, Gelombang 2.5)
     - Kunci dibuat SEKALI saat item masuk antrean (enqueue),
       TIDAK PERNAH dibuat ulang saat flush/retry — kalau dibuat
       ulang, retry tetap akan menduplikat di server.
     - Kunci disimpan di DUA tempat: di dalam `payload` (ikut
       terenkripsi K2, ikut terkirim saat flush, dan menjadi
       `idempotency_key` di server) dan sebagai field top-level
       item (debugging + cadangan bila payload diganti, mis.
       update yang menimpa antrean add yang masih tertunda).
     - Item lama (sebelum 2.5) tanpa kunci tetap jalan: kunci
       opsional di server, insert tanpa kunci berperilaku lama.
     ============================================================ */
  function generateIdempotencyKey() {
    const cryptoObj = root.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
    // Fallback untuk browser tanpa randomUUID — pola yang sama seperti
    // generator OTP di web/supabase-admin.js: getRandomValues + format
    // UUID v4 manual (16 byte acak, bit versi & varian disetel).
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    throw new Error('Browser ini tidak mendukung pembuatan kunci idempotensi yang aman.');
  }

  // Menempelkan kunci idempotensi pada item antrean BARU. Bila item
  // sudah membawa kunci (mis. update menimpa antrean add yang masih
  // tertunda), kunci lama DIPERTAHANKAN — jangan pernah diganti.
  function attachIdempotencyKey(item) {
    const existing = (item.payload && item.payload.idempotencyKey) || item.idempotencyKey || '';
    const key = existing || generateIdempotencyKey();
    const payload = item.payload ? Object.assign({}, item.payload, { idempotencyKey: key }) : item.payload;
    return Object.assign({}, item, { idempotencyKey: key, payload });
  }

  async function queueOfflineMutation(op, args) {
    const stamp = () => 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    if (op === 'api_addTransaction') {
      const payload = Object.assign({}, args[0] || {});
      const localId = stamp();
      await saveOfflineQueueItem(attachIdempotencyKey({ localId, op, payload, createdAt: new Date().toISOString() }));
      bumpOfflineBadgeRefresh();
      return buildOfflineTransactionResponse(localId, payload);
    }
    if (op === 'api_updateTransaction') {
      const id = String(args[0] || '');
      const payload = Object.assign({}, args[1] || {});
      const queued = id.startsWith('offline-') ? readLocalQueue().find((x) => x.localId === id && (x.op || 'api_addTransaction') === 'api_addTransaction') : null;
      const itemId = queued ? id : ('offline-upd-' + id);
      const nextItem = queued
        ? attachIdempotencyKey(Object.assign({}, queued, { payload }))
        : attachIdempotencyKey({ localId: itemId, op, targetId: id, payload, createdAt: new Date().toISOString() });
      await saveOfflineQueueItem(nextItem);
      bumpOfflineBadgeRefresh();
      return {
        _offlineQueued: true,
        transaction: {
          id, tanggal: payload.tanggal, tipe: payload.tipe, kategori: payload.kategori,
          nominal: Number(payload.nominal) || 0, keterangan: payload.keterangan || '', walletId: payload.walletId || ''
        }
      };
    }
    if (op === 'api_deleteTransaction') {
      const id = String(args[0] || '');
      if (id.startsWith('offline-')) {
        await removeOfflineQueueItem(id);
        bumpOfflineBadgeRefresh();
        return { _offlineQueued: true, deletedTransactionId: id };
      }
      await removeOfflineQueueItem('offline-upd-' + id);
      await saveOfflineQueueItem({ localId: 'offline-del-' + id, op, targetId: id, createdAt: new Date().toISOString() });
      bumpOfflineBadgeRefresh();
      return { _offlineQueued: true, deletedTransactionId: id };
    }
    if (op === 'api_addTransfer') {
      const trPayload = Object.assign({}, args[0] || {});
      const localId = stamp();
      await saveOfflineQueueItem(attachIdempotencyKey({ localId, op: 'api_addTransfer', payload: trPayload, createdAt: new Date().toISOString() }));
      const optimistic = {
        // Gelombang 5.3 (Q10): tanggal antrean memakai localToday()
        // bersama (lokal), bukan toISOString() (UTC, geser hari di WIB).
        id: localId, tanggal: trPayload.tanggal || localToday(),
        kind: trPayload.kind || 'transfer', fromWallet: trPayload.fromWallet || '', toWallet: trPayload.toWallet || '',
        nominal: Number(trPayload.nominal) || 0, fee: Math.max(0, Number(trPayload.fee) || 0), keterangan: (trPayload.keterangan ? trPayload.keterangan + ' ' : '') + '[Offline Queue]'
      };
      bumpOfflineBadgeRefresh();
      return { _offlineQueued: true, transfers: [...((typeof DB !== 'undefined' && Array.isArray(DB.transfers)) ? DB.transfers : []), optimistic] };
    }
    // Op generik (§7d): antrekan argumen lengkap; flush memanggil
    // _rawCallServer(op, ...args). Kunci idempotensi ditempel bila
    // op memakai insert (addWallet/addCategory/addAssetV2).
    const genericIdempotent = ['api_addWallet', 'api_addCategory', 'api_addAssetV2'].includes(op);
    const genericItem = {
      localId: stamp(), op,
      targetId: deriveGenericTargetId(op, args) || undefined,
      payload: { args: Array.isArray(args) ? args : [] },
      createdAt: new Date().toISOString()
    };
    await saveOfflineQueueItem(genericIdempotent ? attachIdempotencyKey(genericItem) : genericItem);
    bumpOfflineBadgeRefresh();
    return { _offlineQueued: true, queuedOp: op };
  }

  async function hydrateInitialOfflineData(res) {
    if (typeof DB !== 'undefined') DB.debtDueDates = res.debtDueDates || {};
    const pending = readLocalQueue();
    if (!pending.length) return;
    for (const item of pending) {
      // Payload antrean mungkin terenkripsi (K2): dekripsi dulu; bila belum
      // bisa didekripsi (masih terkunci), lewati item itu — jangan bocorkan
      // atau merusak data dengan payload terenkripsi mentah.
      const payload = item.payload ? await decryptQueuePayload(item) : null;
      if (item.payload && payload === null) continue;
      const op = item.op || 'api_addTransaction';
      if (op === 'api_addTransaction' && Array.isArray(res.transactions) && !res.transactions.some((x) => x.id === item.localId)) {
        res.transactions.push(buildOfflineTransactionResponse(item.localId, payload).transaction);
      } else if (op === 'api_updateTransaction' && Array.isArray(res.transactions)) {
        const idx = res.transactions.findIndex((x) => String(x.id) === String(item.targetId));
        if (idx !== -1 && payload) Object.assign(res.transactions[idx], payload);
      } else if (op === 'api_deleteTransaction' && Array.isArray(res.transactions)) {
        res.transactions = res.transactions.filter((x) => String(x.id) !== String(item.targetId));
      } else if (op === 'api_addTransfer' && Array.isArray(res.transfers) && !res.transfers.some((x) => x.id === item.localId)) {
        res.transfers.push({ id: item.localId, ...payload, keterangan: ((payload && payload.keterangan) || '') + ' [Offline Queue]' });
      }
    }
  }

  function waitAndWrapCallServer() {
    if (typeof root.callServer !== 'function' || root._rawCallServer) return;
    root._rawCallServer = root.callServer;
    root.callServer = async function (fn, ...args) {
      if (OFFLINE_MUTATIONS.has(fn) && !navigator.onLine) return queueOfflineMutation(fn, args);
      try {
        const res = await root._rawCallServer(fn, ...args);
        if (fn === 'getInitialData' && res && typeof res === 'object') await hydrateInitialOfflineData(res);
        return res;
      } catch (err) {
        if (OFFLINE_MUTATIONS.has(fn) && isNetworkOfflineError(err)) return queueOfflineMutation(fn, args);
        // Wave 3.5 §7e: api_savePeriod TIDAK BOLEH lagi berpura-pura
        // sukses saat offline — dulu `return args[0]` membuat UI
        // percaya periode tersimpan padahal hilang. Sekarang periode
        // masuk antrean (OFFLINE_MUTATIONS) seperti perubahan lain;
        // error non-jaringan tetap dilempar apa adanya.
        throw err;
      }
    };
  }

  /* ============================================================
     HELPER UNTUK AGEN K3 (diekspor di `window.__mkFeat`, lihat bawah).
     - getOfflineQueueSummary(): ringkasan `{pending, failed, total}`
       dari field envelope plaintext SAJA — sengaja bekerja walau
       aplikasi terkunci / DEK belum ada di memori.
     - exportOfflineQueuePlaintext(): array item antrean dengan payload
       terdekripsi (untuk penghapusan akun / ekspor). Mengembalikan
       `null` bila PIN diset tapi DEK tidak tersedia (terkunci) atau ada
       item yang gagal didekripsi — pemanggil JANGAN menganggap antrean
       kosong dalam kasus ini.
     - migrateQueueToEncrypted() / migrateQueueToPlaintext(): dipakai
       ui-feat-account.js saat PIN dibuat/diubah/dihapus.
     ============================================================ */
  function getOfflineQueueSummary() {
    const queue = readLocalQueue();
    return {
      pending: queue.filter((x) => !x.failed).length,
      failed: queue.filter((x) => Boolean(x.failed)).length,
      total: queue.length
    };
  }

  async function exportOfflineQueuePlaintext() {
    const items = await getOfflineQueueItems();
    if (isPinSet() && !getPinDataKey()) return null;
    const out = [];
    for (const item of items) {
      if (!item.payload) { out.push(Object.assign({}, item)); continue; }
      const payload = await decryptQueuePayload(item);
      if (payload === null) return null;
      out.push(Object.assign({}, item, { payload }));
    }
    return out;
  }

  async function migrateQueueToEncrypted() {
    const dek = getPinDataKey();
    if (!dek) return 0;
    const items = await getOfflineQueueItems();
    let migrated = 0;
    for (const item of items) {
      if (item.payload && !isEncryptedPayload(item.payload)) {
        await saveOfflineQueueItem(item);
        migrated += 1;
      }
    }
    return migrated;
  }

  async function migrateQueueToPlaintext() {
    const items = await getOfflineQueueItems();
    let migrated = 0;
    for (const item of items) {
      if (item.payload && isEncryptedPayload(item.payload)) {
        const payload = await decryptQueuePayload(item);
        if (payload === null) continue; // Tidak bisa didekripsi: biarkan terenkripsi.
        await saveOfflineQueueItemRaw(Object.assign({}, item, { payload }));
        migrated += 1;
      }
    }
    return migrated;
  }

  root.addEventListener('online', handleOnlineEvent);
  root.addEventListener('offline', handleOfflineEvent);
  document.addEventListener('DOMContentLoaded', () => {
    updateNetworkStatusPill();
    // Buka aplikasi dalam keadaan sudah offline: beri tahu sekali.
    if (!navigator.onLine) showOfflineToastOnce();
  });

  root.flushOfflineQueue = flushOfflineQueue;
  root.retryFailedOfflineItems = retryFailedOfflineItems;
  root.discardFailedOfflineItems = discardFailedOfflineItems;
  root.updateNetworkStatusPill = updateNetworkStatusPill;
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.showOfflineToastOnce = showOfflineToastOnce;
  root.__mkFeat.readLocalQueue = readLocalQueue;
  root.__mkFeat.openOfflineDb = openOfflineDb;
  root.__mkFeat.IDB_SNAPSHOT_STORE = IDB_SNAPSHOT_STORE;
  root.__mkFeat.IDB_VERSION = IDB_VERSION;
  root.__mkFeat.IDB_PIN_LOCK_STORE = IDB_PIN_LOCK_STORE;
  root.__mkFeat.readPinLockStateIdb = readPinLockStateIdb;
  root.__mkFeat.writePinLockStateIdb = writePinLockStateIdb;
  root.__mkFeat.pinCrypto = pinCrypto;
  root.__mkFeat.isEncryptedPayload = isEncryptedPayload;
  root.__mkFeat.encryptQueuePayload = encryptQueuePayload;
  root.__mkFeat.decryptQueuePayload = decryptQueuePayload;
  root.__mkFeat.saveOfflineQueueItem = saveOfflineQueueItem;
  root.__mkFeat.sortOfflineQueue = sortOfflineQueue;
  root.__mkFeat.offlineTargetKey = offlineTargetKey;
  root.__mkFeat.deriveGenericTargetId = deriveGenericTargetId;
  root.__mkFeat.OFFLINE_MUTATIONS = OFFLINE_MUTATIONS;
  root.__mkFeat.MAX_OFFLINE_RETRIES = MAX_OFFLINE_RETRIES;
  root.__mkFeat.generateIdempotencyKey = generateIdempotencyKey;
  root.__mkFeat.getOfflineQueueSummary = getOfflineQueueSummary;
  root.__mkFeat.exportOfflineQueuePlaintext = exportOfflineQueuePlaintext;
  root.__mkFeat.migrateQueueToEncrypted = migrateQueueToEncrypted;
  root.__mkFeat.migrateQueueToPlaintext = migrateQueueToPlaintext;
  root.__mkFeat.buildOfflineTransactionResponse = buildOfflineTransactionResponse;
  root.__mkFeat.waitAndWrapCallServer = waitAndWrapCallServer;
})(typeof window !== 'undefined' ? window : globalThis);
