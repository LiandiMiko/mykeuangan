/* global DB, Swal, refreshFromServer, getSwalClass, refreshNotificationBell */
/* ============================================================
   FEATURES — OFFLINE QUEUE & CALLSERVER WRAPPER
   ============================================================ */
(function (root) {
  'use strict';

  const OFFLINE_QUEUE_KEY = 'mk_offline_tx_queue_v1';
  const IDB_NAME = 'mykeuangan_offline_db';
  const IDB_VERSION = 2;
  const IDB_STORE = 'pending_transactions';
  const IDB_SNAPSHOT_STORE = 'offline_snapshot';
  const MAX_OFFLINE_RETRIES = 3;
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
    let latestPeriod = '';
    try {
      for (const item of pendingItems) {
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
          const recorded = await recordOfflineFailure(item, err);
          if (recorded.isFailed) {
            newlyFailed += 1;
            lastErrMsg = recorded.errMsg;
          }
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
  root.retryFailedOfflineItems = retryFailedOfflineItems;
  root.discardFailedOfflineItems = discardFailedOfflineItems;
  root.updateNetworkStatusPill = updateNetworkStatusPill;
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.readLocalQueue = readLocalQueue;
  root.__mkFeat.openOfflineDb = openOfflineDb;
  root.__mkFeat.IDB_SNAPSHOT_STORE = IDB_SNAPSHOT_STORE;
  root.__mkFeat.buildOfflineTransactionResponse = buildOfflineTransactionResponse;
  root.__mkFeat.waitAndWrapCallServer = waitAndWrapCallServer;
})(typeof window !== 'undefined' ? window : globalThis);
