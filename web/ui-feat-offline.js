/* global DB, Swal, refreshFromServer, getSwalClass, refreshNotificationBell */
/* ============================================================
   FEATURES — OFFLINE QUEUE & CALLSERVER WRAPPER
   ============================================================ */
(function (root) {
  'use strict';

  const OFFLINE_QUEUE_KEY = 'mk_offline_tx_queue_v1';
  const IDB_NAME = 'mykeuangan_offline_db';
  const IDB_STORE = 'pending_transactions';
  let isFlushingOffline = false;

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
    return new Promise((resolve) => {
      try {
        const req = root.indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'localId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function saveOfflineQueueItem(item) {
    const list = readLocalQueue().filter((x) => x.localId !== item.localId);
    list.push(item);
    writeLocalQueue(list);

    const db = await openOfflineDb();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(item);
    } catch (_) {
      /* ignore */
    }
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
    if (!db) return readLocalQueue();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => {
          const idbItems = Array.isArray(req.result) ? req.result : [];
          if (idbItems.length) writeLocalQueue(idbItems);
          resolve(idbItems.length ? idbItems : readLocalQueue());
        };
        req.onerror = () => resolve(readLocalQueue());
      } catch (_) {
        resolve(readLocalQueue());
      }
    });
  }

  function isNetworkOfflineError(err) {
    if (!navigator.onLine) return true;
    const msg = String((err && err.message) || err || '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed');
  }

  function updateNetworkStatusPill() {
    const pill = document.getElementById('networkStatusPill');
    if (!pill) return;
    const pendingCount = readLocalQueue().length;
    const offline = !navigator.onLine;
    if (!offline && pendingCount === 0) {
      pill.classList.add('hide');
      return;
    }
    pill.classList.remove('hide');
    pill.textContent = '';
    const icon = document.createElement('i');
    icon.className = offline ? 'ph-bold ph-wifi-slash text-sm' : 'ph-bold ph-arrows-clockwise text-sm';
    icon.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('span');
    txt.textContent = offline
      ? (pendingCount > 0 ? `Offline (${pendingCount})` : 'Offline')
      : `Sync (${pendingCount})`;
    pill.className = 'inline-flex items-center gap-1 h-9 sm:h-10 lg:h-11 px-2.5 rounded-xl border text-[11px] font-bold transition-colors shrink-0 ' +
      (offline
        ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
        : 'border-brand/40 bg-brand/10 text-brand dark:text-brand-ink');
    pill.title = offline ? 'Mode offline aktif — transaksi baru tersimpan lokal' : 'Klik untuk menyinkronkan antrean offline';
    pill.append(icon, txt);
  }

  async function flushOfflineQueue(silent) {
    if (isFlushingOffline || !navigator.onLine) return 0;
    const queue = await getOfflineQueueItems();
    if (!queue.length) return 0;

    isFlushingOffline = true;
    let synced = 0;
    const addedTransactions = [];
    let latestPeriod = '';
    try {
      for (const item of queue) {
        try {
          const payload = Object.assign({}, item.payload);
          const res = await root._rawCallServer('api_addTransaction', payload);
          if (res && res.transaction) addedTransactions.push(res.transaction);
          if (res && res.currentPeriod && (!latestPeriod || res.currentPeriod > latestPeriod)) {
            latestPeriod = res.currentPeriod;
          }
          await removeOfflineQueueItem(item.localId);
          if (typeof DB !== 'undefined' && Array.isArray(DB.transactions)) {
            DB.transactions = DB.transactions.filter((tx) => tx.id !== item.localId);
          }
          synced += 1;
        } catch (err) {
          if (isNetworkOfflineError(err)) break;
        }
      }
      if (synced > 0 && typeof refreshFromServer === 'function') {
        await refreshFromServer({
          addedTransactions,
          ...(latestPeriod ? { currentPeriod: latestPeriod } : {})
        });
      }
      if (synced > 0 && !silent && typeof Swal !== 'undefined') {
        Swal.fire({
          icon: 'success',
          title: synced + ' transaksi offline tersinkronisasi',
          timer: 1600,
          showConfirmButton: false,
          customClass: { popup: getSwalClass() }
        });
      }
    } finally {
      isFlushingOffline = false;
      updateNetworkStatusPill();
      if (typeof refreshNotificationBell === 'function') refreshNotificationBell();
    }
    return synced;
  }

  function buildOfflineTransactionResponse(localId, txPayload) {
    return {
      _offlineQueued: true,
      transaction: {
        id: localId,
        tanggal: txPayload.tanggal,
        tipe: txPayload.tipe,
        kategori: txPayload.kategori,
        nominal: Number(txPayload.nominal) || 0,
        keterangan: (txPayload.keterangan ? txPayload.keterangan + ' ' : '') + '[Offline Queue]',
        walletId: txPayload.walletId || ''
      }
    };
  }

  async function queueOfflineTx(rawPayload) {
    const txPayload = Object.assign({}, rawPayload || {});
    const localId = 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    await saveOfflineQueueItem({ localId, payload: txPayload, createdAt: new Date().toISOString() });
    setTimeout(() => {
      updateNetworkStatusPill();
      if (typeof refreshNotificationBell === 'function') refreshNotificationBell();
    }, 50);
    return buildOfflineTransactionResponse(localId, txPayload);
  }

  function hydrateInitialOfflineData(res) {
    if (typeof DB !== 'undefined') DB.debtDueDates = res.debtDueDates || {};
    const pending = readLocalQueue();
    if (!pending.length || !Array.isArray(res.transactions)) return;
    pending.forEach((item) => {
      if (!res.transactions.some((x) => x.id === item.localId)) {
        res.transactions.push(buildOfflineTransactionResponse(item.localId, item.payload).transaction);
      }
    });
  }

  function waitAndWrapCallServer() {
    if (typeof root.callServer !== 'function' || root._rawCallServer) return;
    root._rawCallServer = root.callServer;
    root.callServer = async function (fn, ...args) {
      if (fn === 'api_addTransaction' && !navigator.onLine) return queueOfflineTx(args[0]);
      try {
        const res = await root._rawCallServer(fn, ...args);
        if (fn === 'getInitialData' && res && typeof res === 'object') hydrateInitialOfflineData(res);
        return res;
      } catch (err) {
        if (fn === 'api_addTransaction' && isNetworkOfflineError(err)) return queueOfflineTx(args[0]);
        if (fn === 'api_savePeriod' && isNetworkOfflineError(err)) return args[0];
        throw err;
      }
    };
  }

  root.addEventListener('online', updateNetworkStatusPill);
  root.addEventListener('offline', updateNetworkStatusPill);
  document.addEventListener('DOMContentLoaded', updateNetworkStatusPill);

  root.flushOfflineQueue = flushOfflineQueue;
  root.updateNetworkStatusPill = updateNetworkStatusPill;
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.readLocalQueue = readLocalQueue;
  root.__mkFeat.waitAndWrapCallServer = waitAndWrapCallServer;
})(typeof window !== 'undefined' ? window : globalThis);
