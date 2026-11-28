/* global DB */
/* ============================================================
   FEATURES — OFFLINE READ SNAPSHOT CACHE (INDEXEDDB)
   ============================================================ */
(function (root) {
  'use strict';

  const SNAPSHOT_KEY = 'latest';
  // Wave 3.5 §5: snapshot kedaluwarsa setelah 7 hari — snapshot
  // berbulan-bulan tidak boleh dirender sebagai data terkini.
  const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const SNAPSHOT_FIELDS = [
    'transactions', 'categories', 'entities', 'assets', 'budgets',
    'currentPeriod', 'payrollDay', 'primaryBankWalletId', 'snapshots', 'wallets', 'transfers',
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

  function getPinDataKey() {
    const feat = root.__mkFeat || {};
    return typeof feat.getPinDataKey === 'function' ? feat.getPinDataKey() : null;
  }

  function isPinSet() {
    try { return Boolean(localStorage.getItem('mk_app_pin_hash')); } catch (_) { return false; }
  }

  function isEncryptedSnapshotData(data) {
    return Boolean(data && typeof data === 'object' && data.__enc === 1 && typeof data.iv === 'string' && typeof data.ct === 'string');
  }

  // Enkripsi objek `data` snapshot dengan DEK (AES-GCM, IV acak per simpan).
  // Record tetap menyimpan field `user` plaintext (pengecekan pemilik) dan
  // `savedAt`. Bila PIN diset tapi DEK belum ada di memori (terkunci),
  // JANGAN simpan snapshot plaintext — lewati penyimpanan.
  async function encryptSnapshotData(payload) {
    const feat = root.__mkFeat || {};
    const dek = getPinDataKey();
    if (!dek) return null;
    if (!feat.pinCrypto || typeof feat.pinCrypto.encryptWithDek !== 'function') return null;
    try {
      const env = await feat.pinCrypto.encryptWithDek(dek, JSON.stringify(payload));
      return { __enc: 1, iv: env.iv, ct: env.ct };
    } catch (_) {
      return null;
    }
  }

  // Mengembalikan objek data terdekripsi, atau `null` bila dekripsi gagal
  // (kunci salah/rusak) — pemanggil harus menganggap snapshot tidak ada,
  // jangan render, jangan crash. Data plaintext lama dikembalikan apa adanya.
  async function decryptSnapshotData(storedData) {
    if (!storedData) return null;
    if (!isEncryptedSnapshotData(storedData)) return storedData;
    const feat = root.__mkFeat || {};
    const dek = getPinDataKey();
    if (!dek || !feat.pinCrypto || typeof feat.pinCrypto.decryptWithDek !== 'function') return null;
    try {
      return JSON.parse(await feat.pinCrypto.decryptWithDek(dek, storedData));
    } catch (_) {
      return null;
    }
  }

  // UID auth pemilik snapshot. Dulu yang disimpan hanya DISPLAY NAME
  // (root.sessionUser) — dua pengguna dengan nama tampilan sama bisa
  // saling membaca snapshot, dan ganti akun tanpa logout meninggalkan
  // snapshot basi. UID diambil dari sesi Supabase bila tersedia;
  // '' berarti "tidak diketahui" (konteks tes / sesi belum ada) dan
  // pengecekan pemilik dilewati dalam kasus itu saja.
  async function getCurrentAuthUid() {
    try {
      const feat = root.__mkFeat || {};
      if (typeof feat.getCurrentUserId === 'function') {
        const id = await feat.getCurrentUserId();
        if (id) return String(id);
      }
      if (typeof root.__mkAuthUserId === 'string' && root.__mkAuthUserId) return root.__mkAuthUserId;
      const sb = root.__mkSb && root.__mkSb.sb;
      if (sb && sb.auth && typeof sb.auth.getUser === 'function') {
        const res = await sb.auth.getUser();
        const id = res && res.data && res.data.user && res.data.user.id;
        if (id) return String(id);
      }
    } catch (_) { /* abaikan — pemilik tidak terverifikasi */ }
    return '';
  }

  function isSnapshotStale(savedAt, nowMs) {
    if (!savedAt) return false;
    const savedMs = new Date(savedAt).getTime();
    if (!Number.isFinite(savedMs)) return false;
    return (nowMs || Date.now()) - savedMs > SNAPSHOT_TTL_MS;
  }

  async function clearOfflineSnapshot() {
    const feat = root.__mkFeat || {};
    if (typeof feat.openOfflineDb !== 'function') return false;
    const db = await feat.openOfflineDb();
    const storeName = feat.IDB_SNAPSHOT_STORE || 'offline_snapshot';
    if (!db || !db.objectStoreNames.contains(storeName)) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(SNAPSHOT_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function writeSnapshotNow(payload) {
    const feat = root.__mkFeat || {};
    if (typeof feat.openOfflineDb !== 'function') return false;
    // PIN diset tapi DEK belum di memori = masih terkunci: jangan tulis plaintext.
    let storedData = payload;
    if (isPinSet()) {
      storedData = await encryptSnapshotData(payload);
      if (!storedData) return false;
    }
    const userId = await getCurrentAuthUid();
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
          userId,
          data: storedData
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  // Tulis ulang snapshot yang tersimpan tanpa enkripsi (dipakai migrasi saat
  // PIN dibuat/diubah). Mengembalikan jumlah record yang dimigrasi (0/1).
  async function migrateSnapshotToEncrypted() {
    const feat = root.__mkFeat || {};
    if (typeof feat.openOfflineDb !== 'function' || !getPinDataKey()) return 0;
    const db = await feat.openOfflineDb();
    const storeName = feat.IDB_SNAPSHOT_STORE || 'offline_snapshot';
    if (!db || !db.objectStoreNames.contains(storeName)) return 0;
    const record = await new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(SNAPSHOT_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    if (!record || !record.data || isEncryptedSnapshotData(record.data)) return 0;
    return (await writeSnapshotNow(record.data)) ? 1 : 0;
  }

  // Kembalikan snapshot ke plaintext (dipakai saat PIN dihapus). Bila dekripsi
  // gagal, biarkan record terenkripsi apa adanya.
  async function migrateSnapshotToPlaintext() {
    const feat = root.__mkFeat || {};
    if (typeof feat.openOfflineDb !== 'function') return 0;
    const db = await feat.openOfflineDb();
    const storeName = feat.IDB_SNAPSHOT_STORE || 'offline_snapshot';
    if (!db || !db.objectStoreNames.contains(storeName)) return 0;
    const record = await new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(SNAPSHOT_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    if (!record || !record.data || !isEncryptedSnapshotData(record.data)) return 0;
    const plain = await decryptSnapshotData(record.data);
    if (!plain) return 0;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put({ key: SNAPSHOT_KEY, savedAt: record.savedAt, user: record.user || '', userId: record.userId || '', data: plain });
        tx.oncomplete = () => resolve(1);
        tx.onerror = () => resolve(0);
      } catch (_) { resolve(0); }
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

  async function loadOfflineSnapshot(expectedUserId) {
    const feat = root.__mkFeat || {};
    if (typeof feat.openOfflineDb !== 'function') return null;
    const db = await feat.openOfflineDb();
    const storeName = feat.IDB_SNAPSHOT_STORE || 'offline_snapshot';
    if (!db || !db.objectStoreNames.contains(storeName)) return null;
    const record = await new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(SNAPSHOT_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    if (!record || !record.data) return null;
    // §5a: pemilik diverifikasi dengan UID auth, bukan display name.
    // Ketidakcocokan -> null (snapshot orang lain tidak pernah
    // dirender). Record lama tanpa userId tidak bisa diverifikasi —
    // diizinkan apa adanya dan akan tertimpa UID saat simpan berikut.
    const currentUid = expectedUserId || await getCurrentAuthUid();
    if (record.userId && currentUid && String(record.userId) !== String(currentUid)) return null;
    // §5b: TTL 7 hari — hanya untuk record format baru (membawa
    // userId). Record lama tanpa userId tidak bisa dibedakan dari
    // fixture/darurat, dan memblokirnya akan mematikan snapshot
    // offline yang sudah ada di perangkat begitu update ini mendarat;
    // record lama mendapat TTL begitu tersimpan ulang (selalu dengan
    // userId + savedAt baru saat online berikutnya). Kedaluwarsa ->
    // penanda `stale` dengan data null (pemanggil TIDAK boleh
    // menerapkannya; ui-shell perlu menampilkan "snapshot
    // kedaluwarsa" — lihat laporan tindak lanjut).
    if (record.userId && isSnapshotStale(record.savedAt)) {
      return { key: record.key, savedAt: record.savedAt, user: record.user || '', userId: record.userId || '', stale: true, data: null };
    }
    const wasPlaintext = !isEncryptedSnapshotData(record.data);
    const data = await decryptSnapshotData(record.data);
    if (!data) return null; // Dekripsi gagal (kunci salah/rusak): anggap tidak ada.
    // Migrasi oportunistik: snapshot plaintext lama dienkripsi ulang begitu
    // DEK tersedia (unlock pertama setelah perbaikan ini).
    if (wasPlaintext && isPinSet() && getPinDataKey()) {
      try { await writeSnapshotNow(data); } catch (_) { /* ignore */ }
    }
    return { key: record.key, savedAt: record.savedAt, user: record.user || '', userId: record.userId || '', data };
  }

  async function mergeQueuedOfflineTx(data) {
    const feat = root.__mkFeat || {};
    const queue = typeof feat.readLocalQueue === 'function' ? feat.readLocalQueue() : [];
    const base = data && typeof data === 'object' ? Object.assign({}, data) : {};
    const list = Array.isArray(base.transactions) ? base.transactions.slice() : [];
    for (const item of queue) {
      if (!item || item.failed || list.some((tx) => tx.id === item.localId)) continue;
      // Payload antrean mungkin terenkripsi (K2): dekripsi dulu; bila belum
      // bisa didekripsi, lewati item itu.
      let payload = null;
      if (item.payload) {
        if (typeof feat.decryptQueuePayload === 'function') payload = await feat.decryptQueuePayload(item);
        else payload = item.payload;
        if (payload === null) continue;
      }
      if (typeof feat.buildOfflineTransactionResponse === 'function') {
        list.push(feat.buildOfflineTransactionResponse(item.localId, payload).transaction);
      } else if (payload) {
        const p = payload;
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
    }
    base.transactions = list;
    return base;
  }

  root.saveOfflineSnapshot = saveOfflineSnapshot;
  root.loadOfflineSnapshot = loadOfflineSnapshot;
  root.clearOfflineSnapshot = clearOfflineSnapshot;
  root.mergeQueuedOfflineTx = mergeQueuedOfflineTx;
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.clearOfflineSnapshot = clearOfflineSnapshot;
  root.__mkFeat.SNAPSHOT_TTL_MS = SNAPSHOT_TTL_MS;
  root.__mkFeat.isSnapshotStale = isSnapshotStale;
  root.__mkFeat.getCurrentAuthUid = getCurrentAuthUid;
  root.__mkFeat.migrateSnapshotToEncrypted = migrateSnapshotToEncrypted;
  root.__mkFeat.migrateSnapshotToPlaintext = migrateSnapshotToPlaintext;
  root.__mkFeat.isEncryptedSnapshotData = isEncryptedSnapshotData;
})(typeof window !== 'undefined' ? window : globalThis);
