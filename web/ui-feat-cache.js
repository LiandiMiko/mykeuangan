/* global DB */
/* ============================================================
   FEATURES — OFFLINE READ SNAPSHOT CACHE (INDEXEDDB)
   ============================================================ */
(function (root) {
  'use strict';

  const SNAPSHOT_KEY = 'latest';
  const SNAPSHOT_FIELDS = [
    'transactions', 'categories', 'entities', 'assets', 'budgets',
    'currentPeriod', 'payrollDay', 'snapshots', 'wallets', 'transfers',
    'goals', 'recurring', 'debtDueDates'
  ];
  let saveTimer = null;

  function cloneSnapshotPayload(source) {
    const raw = source && typeof source === 'object' ? source : (typeof DB !== 'undefined' ? DB : {});
    const out = {};
    SNAPSHOT_FIELDS.forEach((field) => {
      if (raw[field] !== undefined) out[field] = raw[field];
    });
    return JSON.parse(JSON.stringify(out));
  }

  async function writeSnapshotNow(payload) {
    const feat = root.__mkFeat || {};
    if (typeof feat.openOfflineDb !== 'function') return false;
    const db = await feat.openOfflineDb();
    const storeName = feat.IDB_SNAPSHOT_STORE || 'offline_snapshot';
    if (!db || !db.objectStoreNames.contains(storeName)) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put({
          key: SNAPSHOT_KEY,
          savedAt: new Date().toISOString(),
          user: root.sessionUser || '',
          data: payload
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  function saveOfflineSnapshot(sourceData) {
    let payload;
    try {
      payload = cloneSnapshotPayload(sourceData);
    } catch (_) {
      return;
    }
    if (saveTimer) root.clearTimeout(saveTimer);
    saveTimer = root.setTimeout(() => {
      saveTimer = null;
      writeSnapshotNow(payload);
    }, 350);
  }

  async function loadOfflineSnapshot() {
    const feat = root.__mkFeat || {};
    if (typeof feat.openOfflineDb !== 'function') return null;
    const db = await feat.openOfflineDb();
    const storeName = feat.IDB_SNAPSHOT_STORE || 'offline_snapshot';
    if (!db || !db.objectStoreNames.contains(storeName)) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(SNAPSHOT_KEY);
        req.onsuccess = () => resolve(req.result && req.result.data ? req.result : null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  function mergeQueuedOfflineTx(data) {
    const feat = root.__mkFeat || {};
    const queue = typeof feat.readLocalQueue === 'function' ? feat.readLocalQueue() : [];
    const base = data && typeof data === 'object' ? Object.assign({}, data) : {};
    const list = Array.isArray(base.transactions) ? base.transactions.slice() : [];
    queue.forEach((item) => {
      if (!item || item.failed || list.some((tx) => tx.id === item.localId)) return;
      if (typeof feat.buildOfflineTransactionResponse === 'function') {
        list.push(feat.buildOfflineTransactionResponse(item.localId, item.payload).transaction);
      } else if (item.payload) {
        const p = item.payload;
        list.push({
          id: item.localId,
          tanggal: p.tanggal,
          tipe: p.tipe,
          kategori: p.kategori,
          nominal: Number(p.nominal) || 0,
          keterangan: (p.keterangan ? p.keterangan + ' ' : '') + '[Offline Queue]',
          walletId: p.walletId || ''
        });
      }
    });
    base.transactions = list;
    return base;
  }

  root.saveOfflineSnapshot = saveOfflineSnapshot;
  root.loadOfflineSnapshot = loadOfflineSnapshot;
  root.mergeQueuedOfflineTx = mergeQueuedOfflineTx;
})(typeof window !== 'undefined' ? window : globalThis);
