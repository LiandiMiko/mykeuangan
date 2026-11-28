// @depends-on: ui-state.js, password-policy.js
/* global Swal, callServer, getSwalClass, escapeHtmlJS, showActionError, updateDashboardTitle, openForm, openTransferModal, triggerReceiptOcr, switchView, t */
/* ============================================================
   FEATURES — ACCOUNT SETTINGS, PIN LOCK, QUICK MENU & PWA INSTALL
   ============================================================ */
(function (root) {
  'use strict';

  const PIN_LOCK_STATE_KEY = 'mk_pin_lock_state_v1';
  const MAX_PIN_ATTEMPTS = 5;
  // Durasi lockout bertingkat (T2) berdasarkan jumlah lockout yang sudah terjadi.
  // Lockout ke-1 = 60 detik, ke-2 = 5 menit, ke-3 = 15 menit, ke-4+ = 60 menit.
  // Setelah 3 lockout (atau 15 kegagalan kumulatif), PIN terkunci sampai pengguna
  // verifikasi ulang password akun (lihat promptAccountPasswordReverify).
  const PIN_LOCKOUT_DURATIONS_MS = [60000, 5 * 60000, 15 * 60000, 60 * 60000];
  const PIN_LOCKOUT_PASSWORD_RESET_AFTER = 3;
  const PIN_FAILURES_PASSWORD_RESET_AFTER = 15;
  const AUTO_LOCK_IDLE_MS = 120000;
  // Wave 3.1 / S4 — visible-tab idle auto-lock. The old code only locked
  // when the tab was hidden for >= AUTO_LOCK_IDLE_MS; a visible idle tab
  // never locked. lastActivityAt is updated (throttled to 1/s) on user
  // input, and an interval checks for idleness.
  const AUTO_LOCK_CHECK_MS = 20000;
  let lastActivityAt = Date.now();
  let lastActivityRecordAt = 0;
  let autoLockBound = false;

  function noteActivity(now) {
    const t = typeof now === 'number' ? now : Date.now();
    if (t - lastActivityRecordAt < 1000) return;
    lastActivityRecordAt = t;
    lastActivityAt = t;
  }

  function getPasswordPolicy() {
    return (root.__mkFeat && root.__mkFeat.passwordPolicy) || root.__mkPasswordPolicy || null;
  }

  // First PIN-policy error message, or '' when the PIN is acceptable.
  // Falls back to the old format-only check when the policy file has
  // not been loaded (yet).
  function checkPinPolicy(pin) {
    const pol = getPasswordPolicy();
    if (pol && typeof pol.validatePin === 'function') {
      const res = pol.validatePin(pin);
      return res.ok ? '' : (res.errors[0] && res.errors[0].message) || '';
    }
    return /^\d{4,6}$/.test(String(pin || '')) ? '' : txMsg('PIN harus 4 sampai 6 angka.', 'PIN must be 4 to 6 digits.');
  }

  function isPinFormatValid(pin) {
    return checkPinPolicy(pin) === '';
  }
  let pinPromptShown = false;
  let pinLastHiddenAt = 0;
  // Mirror state cooldown di memori agar pembacaan cepat (getPinCooldownSeconds
  // tetap sinkron); sumber kebenaran adalah IndexedDB (store `pin_lock_state`).
  let pinLockStateCache = { attempts: 0, lockedUntil: 0, lockoutCount: 0, failuresTotal: 0, passwordResetRequired: false };
  let pinLockStateLoaded = false;
  // PIN terakhir yang berhasil diverifikasi (di memori saja) — dipakai sekali
  // untuk rewrap DEK saat PIN diubah, lalu dibersihkan. Tidak pernah disimpan.
  let lastVerifiedPin = '';

  const isEn = () => localStorage.getItem('lang') === 'en';
  const txMsg = (idStr, enStr) => (isEn() ? enStr : idStr);

  function normalizePinLockState(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      attempts: Number(s.attempts) || 0,
      lockedUntil: Number(s.lockedUntil) || 0,
      lockoutCount: Number(s.lockoutCount) || 0,
      failuresTotal: Number(s.failuresTotal) || 0,
      passwordResetRequired: Boolean(s.passwordResetRequired)
    };
  }

  function pinLockoutDurationMs(lockoutCount) {
    const idx = Math.max(0, Math.min(lockoutCount - 1, PIN_LOCKOUT_DURATIONS_MS.length - 1));
    return PIN_LOCKOUT_DURATIONS_MS[idx];
  }

  function formatLockoutDuration(ms) {
    const sec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
    if (sec < 60) return txMsg(`${sec} detik`, `${sec} seconds`);
    return txMsg(`${Math.round(sec / 60)} menit`, `${Math.round(sec / 60)} minutes`);
  }

  async function ensurePinLockStateLoaded() {
    if (pinLockStateLoaded) return pinLockStateCache;
    const feat = root.__mkFeat || {};
    let stored = null;
    try {
      if (typeof feat.readPinLockStateIdb === 'function') stored = await feat.readPinLockStateIdb();
    } catch (_) { /* ignore: fallback ke localStorage di bawah */ }
    if (!stored) {
      // Fallback: localStorage `mk_pin_lock_state_v1` HANYA dipakai bila
      // IndexedDB tidak tersedia (mis. mode privat / IDB diblokir). State
      // di localStorage mudah dihapus pengguna, jadi bukan sumber utama.
      try { stored = JSON.parse(localStorage.getItem(PIN_LOCK_STATE_KEY) || 'null'); } catch (_) { stored = null; }
    }
    pinLockStateCache = normalizePinLockState(stored);
    pinLockStateLoaded = true;
    return pinLockStateCache;
  }

  // Async: sumber kebenaran di IndexedDB (`pin_lock_state`, key 'state').
  async function readPinLockState() {
    return normalizePinLockState(await ensurePinLockStateLoaded());
  }

  // Sinkron: baca dari mirror memori (dimuat saat verifikasi PIN pertama).
  function getPinLockStateSync() {
    return normalizePinLockState(pinLockStateCache);
  }

  async function writePinLockState(state) {
    const next = normalizePinLockState(state);
    pinLockStateCache = next;
    pinLockStateLoaded = true;
    const feat = root.__mkFeat || {};
    let saved = false;
    try {
      if (typeof feat.writePinLockStateIdb === 'function') saved = await feat.writePinLockStateIdb(next);
    } catch (_) { /* ignore: fallback ke localStorage di bawah */ }
    if (!saved) {
      try { localStorage.setItem(PIN_LOCK_STATE_KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
    }
    return next;
  }

  async function markPinUnlocked() {
    await writePinLockState({ attempts: 0, lockedUntil: 0, lockoutCount: 0, failuresTotal: 0, passwordResetRequired: false });
    try { sessionStorage.setItem('mk_pin_unlocked', '1'); } catch (_) { /* ignore */ }
  }

  // Gelombang 4: sukses biometrik HANYA menandai sesi unlocked — TIDAK
  // mereset state lockout PIN. Sebelumnya kedua jalur sukses biometrik
  // di bawah memanggil markPinUnlocked(), sehingga PIN yang sedang
  // terkunci (cooldown / wajib verifikasi password akun) bisa dilewati
  // lewat biometrik dan lockout-nya hilang.
  async function markBiometricUnlocked() {
    try { sessionStorage.setItem('mk_pin_unlocked', '1'); } catch (_) { /* ignore */ }
  }

  async function recordFailedPinAttempt() {
    const prev = await readPinLockState();
    const failuresTotal = prev.failuresTotal + 1;
    const attempts = prev.attempts + 1;
    let next = { attempts, lockedUntil: prev.lockedUntil, lockoutCount: prev.lockoutCount, failuresTotal, passwordResetRequired: prev.passwordResetRequired };
    if (attempts >= MAX_PIN_ATTEMPTS) {
      const lockoutCount = prev.lockoutCount + 1;
      next = {
        attempts: 0,
        lockedUntil: Date.now() + pinLockoutDurationMs(lockoutCount),
        lockoutCount,
        failuresTotal,
        passwordResetRequired: lockoutCount >= PIN_LOCKOUT_PASSWORD_RESET_AFTER || failuresTotal >= PIN_FAILURES_PASSWORD_RESET_AFTER
      };
    } else if (failuresTotal >= PIN_FAILURES_PASSWORD_RESET_AFTER) {
      next.passwordResetRequired = true;
    }
    await writePinLockState(next);
    return next;
  }

  function getPinCooldownSeconds() {
    const { lockedUntil } = getPinLockStateSync();
    return lockedUntil > Date.now() ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0;
  }

  function isPinPasswordResetRequired() {
    return getPinLockStateSync().passwordResetRequired;
  }

  // Setelah 3 lockout / 15 kegagalan kumulatif, PIN terkunci sampai pengguna
  // membuktikan kepemilikan akun dengan password akun (Supabase Auth).
  // Bila berhasil, semua counter direset; bila batal/gagal, tetap terkunci.
  async function promptAccountPasswordReverify() {
    const sb = (root.__mkSb && root.__mkSb.sb) || root.sb || null;
    if (!sb || !sb.auth || typeof sb.auth.signInWithPassword !== 'function' || typeof sb.auth.getUser !== 'function') {
      await Swal.fire({
        icon: 'warning',
        title: txMsg('Verifikasi Password Tidak Tersedia', 'Password Verification Unavailable'),
        text: txMsg('PIN terkunci setelah terlalu banyak lockout. Verifikasi password akun membutuhkan koneksi ke server — coba lagi saat online.', 'PIN is locked after too many lockouts. Account password verification needs a server connection — try again when online.'),
        customClass: { popup: getSwalClass() }
      });
      return false;
    }
    let email = '';
    try {
      const { data } = await sb.auth.getUser();
      email = (data && data.user && data.user.email) || '';
    } catch (_) { /* ignore */ }
    if (!email) {
      await Swal.fire({ icon: 'warning', title: txMsg('Sesi Tidak Ditemukan', 'Session Not Found'), text: txMsg('Tidak bisa memverifikasi password karena sesi akun tidak ditemukan. Silakan masuk ulang.', 'Cannot verify password because the account session was not found. Please sign in again.'), customClass: { popup: getSwalClass() } });
      return false;
    }
    const res = await Swal.fire({
      title: txMsg('Verifikasi Password Akun', 'Verify Account Password'),
      html: `<p class="text-xs text-left">${txMsg('PIN terkunci setelah terlalu banyak percobaan salah. Untuk membuka kunci, masukkan <strong>password akun</strong> Anda (bukan PIN).', 'PIN is locked after too many wrong attempts. To unlock, enter your <strong>account password</strong> (not the PIN).')}</p>`,
      input: 'password',
      inputAttributes: { autocomplete: 'current-password' },
      inputPlaceholder: txMsg('Password akun', 'Account password'),
      showCancelButton: true,
      confirmButtonText: txMsg('Verifikasi', 'Verify'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!res.isConfirmed || !res.value) return false;
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: String(res.value) });
      if (error) {
        await Swal.fire({ icon: 'error', title: txMsg('Password Salah', 'Incorrect Password'), text: toUserErrorMessage(error, isEn() ? 'en' : 'id'), customClass: { popup: getSwalClass() } });
        return false;
      }
    } catch (err) {
      await Swal.fire({ icon: 'error', title: txMsg('Verifikasi Gagal', 'Verification Failed'), text: toUserErrorMessage(err, isEn() ? 'en' : 'id'), customClass: { popup: getSwalClass() } });
      return false;
    }
    await writePinLockState({ attempts: 0, lockedUntil: 0, lockoutCount: 0, failuresTotal: 0, passwordResetRequired: false });
    return true;
  }

  // Wave 3.1 / S6 — legacy unsalted PIN hashes stop being accepted once
  // the app reaches v3.20.7. The version comes from the
  // <meta name="app-version"> tag (or a root.__mkAppVersion override);
  // when it cannot be read, legacy hashes keep migrating (fail-open
  // towards usability for old cached builds, never towards acceptance
  // after the cut-off is known).
  const LEGACY_PIN_CUTOFF_VERSION = '3.20.7';
  function getAppVersion() {
    if (typeof root.__mkAppVersion === 'string' && root.__mkAppVersion) return root.__mkAppVersion;
    try {
      const meta = typeof document !== 'undefined' && document.querySelector
        ? document.querySelector('meta[name="app-version"]') : null;
      if (meta && typeof meta.getAttribute === 'function') return meta.getAttribute('content') || '';
    } catch (_) { /* ignore */ }
    return '';
  }
  function compareSemver(a, b) {
    const pa = String(a || '').split('.').map((x) => Number(x) || 0);
    const pb = String(b || '').split('.').map((x) => Number(x) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  function isLegacyPinCutoffPassed() {
    const v = getAppVersion();
    return Boolean(v) && compareSemver(v, LEGACY_PIN_CUTOFF_VERSION) >= 0;
  }
  function isLegacyPinHash(savedHash) {
    return Boolean(savedHash) && !String(savedHash).startsWith('pbkdf2$');
  }

  async function promptVerifyCurrentPin(title) {
    const savedHash = localStorage.getItem('mk_app_pin_hash');
    if (!savedHash) return true;
    // S6: after the cut-off, a legacy hash can no longer be "verified"
    // with the PIN — the user must re-verify the account password
    // instead, then set a fresh PIN.
    if (isLegacyPinHash(savedHash) && isLegacyPinCutoffPassed()) {
      return promptAccountPasswordReverify();
    }
    await ensurePinLockStateLoaded();
    if (isPinPasswordResetRequired()) {
      return promptAccountPasswordReverify();
    }
    const waitSec = getPinCooldownSeconds();
    if (waitSec > 0) {
      await Swal.fire({
        icon: 'warning',
        title: txMsg('PIN Terkunci Sementara', 'PIN Temporarily Locked'),
        text: txMsg(`Coba lagi dalam ${waitSec} detik. Percobaan salah berulang memperpanjang kunci (60 detik → 5 → 15 → 60 menit).`, `Try again in ${waitSec} seconds. Repeated wrong attempts extend the lockout (60 seconds → 5 → 15 → 60 minutes).`),
        customClass: { popup: getSwalClass() }
      });
      return false;
    }
    const res = await Swal.fire({
      title,
      input: 'password',
      inputAttributes: { inputmode: 'numeric', maxlength: '6', autocomplete: 'off' },
      inputPlaceholder: txMsg('Masukkan PIN saat ini', 'Enter current PIN'),
      showCancelButton: true,
      confirmButtonText: txMsg('Verifikasi', 'Verify'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!res.isConfirmed) return false;
    const pin = String(res.value || '').trim();
    if (await verifyPinMatches(pin, savedHash)) {
      lastVerifiedPin = pin;
      await writePinLockState({ attempts: 0, lockedUntil: 0, lockoutCount: 0, failuresTotal: 0, passwordResetRequired: false });
      return true;
    }
    const next = await recordFailedPinAttempt();
    const left = Math.max(0, MAX_PIN_ATTEMPTS - next.attempts);
    const hint = next.passwordResetRequired
      ? txMsg('Terlalu banyak lockout. PIN terkunci sampai Anda verifikasi password akun.', 'Too many lockouts. PIN stays locked until you verify your account password.')
      : next.lockedUntil
        ? txMsg(`Terlalu banyak percobaan salah. Terkunci ${formatLockoutDuration(next.lockedUntil - Date.now())}.`, `Too many wrong attempts. Locked for ${formatLockoutDuration(next.lockedUntil - Date.now())}.`)
        : txMsg(`PIN saat ini salah (sisa ${left} percobaan).`, `Incorrect current PIN (${left} attempts left).`);
    await Swal.fire({ icon: 'error', title: txMsg('Verifikasi Gagal', 'Verification Failed'), text: hint, customClass: { popup: getSwalClass() } });
    return false;
  }

  function createPinSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function derivePinHash(pin, saltHex) {
    const enc = new TextEncoder();
    if (root.crypto && root.crypto.subtle && typeof root.crypto.subtle.deriveBits === 'function') {
      const keyMat = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(String(saltHex || '')), iterations: 100000, hash: 'SHA-256' },
        keyMat,
        256
      );
      return 'pbkdf2$' + Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // S6 (latent bug): the old fallback returned a bare hex SHA-256
    // hash with NO pbkdf2$ prefix, so a freshly created hash was
    // misclassified as legacy on the next read. PBKDF2 is required now:
    // when it is unavailable we throw instead of minting a hash that
    // looks legacy.
    throw new Error('PBKDF2 tidak tersedia pada perangkat ini, PIN tidak dapat dibuat dengan aman.');
  }

  async function hashPin(pin) {
    const salt = createPinSalt();
    localStorage.setItem('mk_app_pin_salt', salt);
    return derivePinHash(pin, salt);
  }

  async function verifyPinMatches(pin, savedHash) {
    if (String(savedHash).startsWith('pbkdf2$')) {
      const salt = localStorage.getItem('mk_app_pin_salt') || '';
      return (await derivePinHash(pin, salt)) === savedHash;
    }
    // S6: legacy unsalted SHA-256('mkpin:'+pin). Before the v3.20.7
    // cut-off, a correct PIN still migrates the hash to PBKDF2 (as
    // before). AFTER the cut-off, legacy hashes are rejected outright —
    // the caller routes the user to a PIN reset via account-password
    // re-verification (promptAccountPasswordReverify), never a silent
    // accept. A wrong PIN never migrates anything.
    if (isLegacyPinCutoffPassed()) return false;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mkpin:' + String(pin)));
    const legacyHex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (legacyHex === savedHash) {
      localStorage.setItem('mk_app_pin_hash', await hashPin(pin));
      return true;
    }
    return false;
  }

  /* ============================================================
     KUNCI ENKRIPSI DATA LOKAL / DEK (K2)
     - DEK: kunci AES-GCM 256-bit acak, dibuat saat PIN pertama diset.
     - KEK: PBKDF2(PIN ber-domain `mk-data-key:`, salt acak 16 byte,
       100.000 iterasi, SHA-256) — lihat `pinCrypto` di ui-feat-offline.js
       (implementasi kanonis; domain berbeda dari hash verifikasi PIN).
     - DEK dibungkus KEK (AES-GCM, IV acak 12 byte); hasil wrap + salt +
       IV disimpan di localStorage `mk_pin_data_key_wrap`. DEK hasil
       unwrap HANYA di memori (`pinDataKey`), tidak pernah di
       localStorage/IndexedDB; dibersihkan saat lock/logout lewat
       `clearPinDataKey()` (diekspor di `window.__mkFeat`).
     - PIN diubah: DEK sama, bungkus ulang dengan PIN baru (data tidak
       perlu dienkripsi ulang). PIN dihapus: data didekripsi kembali ke
       plaintext, lalu wrap dihapus.
     ============================================================ */
  const PIN_DATA_KEY_WRAP_KEY = 'mk_pin_data_key_wrap';
  let pinDataKey = null;

  function getPinDataKey() { return pinDataKey; }
  function hasPinDataKey() { return Boolean(pinDataKey); }
  function clearPinDataKey() { pinDataKey = null; lastVerifiedPin = ''; }

  function getPinCrypto() {
    const feat = root.__mkFeat || {};
    return feat.pinCrypto || null;
  }

  async function createPinDataKey(pin) {
    const pc = getPinCrypto();
    if (!pc) throw new Error('Modul kripto PIN belum tersedia.');
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle) throw new Error('Web Crypto tidak tersedia pada perangkat ini.');
    const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const wrap = await pc.wrapPinDataKey(dek, pin);
    try { localStorage.setItem(PIN_DATA_KEY_WRAP_KEY, JSON.stringify(wrap)); } catch (_) { /* ignore */ }
    pinDataKey = dek;
    return dek;
  }

  async function unwrapPinDataKey(pin) {
    const pc = getPinCrypto();
    if (!pc) return false;
    let wrap = null;
    try { wrap = JSON.parse(localStorage.getItem(PIN_DATA_KEY_WRAP_KEY) || 'null'); } catch (_) { wrap = null; }
    if (!wrap) return false;
    try {
      pinDataKey = await pc.unwrapPinDataKey(wrap, pin);
      return true;
    } catch (_) {
      pinDataKey = null;
      return false;
    }
  }

  async function rewrapPinDataKey(oldPin, newPin) {
    const pc = getPinCrypto();
    if (!pc) return false;
    if (!pinDataKey && !(await unwrapPinDataKey(oldPin))) return false;
    try {
      const wrap = await pc.wrapPinDataKey(pinDataKey, newPin);
      localStorage.setItem(PIN_DATA_KEY_WRAP_KEY, JSON.stringify(wrap));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function migrateLocalDataToEncrypted() {
    const feat = root.__mkFeat || {};
    let migrated = 0;
    try { if (typeof feat.migrateSnapshotToEncrypted === 'function') migrated += await feat.migrateSnapshotToEncrypted(); } catch (_) { /* ignore */ }
    try { if (typeof feat.migrateQueueToEncrypted === 'function') migrated += await feat.migrateQueueToEncrypted(); } catch (_) { /* ignore */ }
    return migrated;
  }

  async function migrateLocalDataToPlaintext() {
    const feat = root.__mkFeat || {};
    let migrated = 0;
    try { if (typeof feat.migrateSnapshotToPlaintext === 'function') migrated += await feat.migrateSnapshotToPlaintext(); } catch (_) { /* ignore */ }
    try { if (typeof feat.migrateQueueToPlaintext === 'function') migrated += await feat.migrateQueueToPlaintext(); } catch (_) { /* ignore */ }
    return migrated;
  }

  // Dipanggil setelah PIN terverifikasi benar. Bila wrap sudah ada, unwrap
  // DEK; bila belum ada (PIN dibuat sebelum enkripsi ini), buat DEK baru
  // lalu enkripsi ulang data lokal lama (migrasi). Bila wrap rusak (unwrap
  // gagal padahal PIN benar), buat DEK baru agar aplikasi tetap bisa jalan —
  // data lokal lama yang terenkripsi dengan kunci lama menjadi tidak bisa
  // dibaca dan akan dilewati/ditandai gagal, bukan di-crash.
  async function ensurePinDataKeyAfterUnlock(pin) {
    let wrapExists = false;
    try { wrapExists = Boolean(localStorage.getItem(PIN_DATA_KEY_WRAP_KEY)); } catch (_) { wrapExists = false; }
    if (wrapExists) {
      if (await unwrapPinDataKey(pin)) return true;
      try { console.warn('[PIN] Wrap kunci data rusak — membuat kunci baru; data lokal lama tidak dapat didekripsi.'); } catch (_) { /* ignore */ }
      await createPinDataKey(pin);
      return true;
    }
    await createPinDataKey(pin);
    await migrateLocalDataToEncrypted();
    return true;
  }

  function buildAccountSettingsHtml(hasPin) {
    const pinStatus = hasPin ? txMsg('Aktif', 'Active') : txMsg('Belum diatur', 'Not set');
    const pinPlaceholder = hasPin
      ? txMsg('Kosongkan jika tetap / ketik PIN baru', 'Leave blank to keep / enter new PIN')
      : txMsg('Contoh: 1234', 'Example: 1234');
    return `
      <div class="text-left space-y-3 text-xs">
        <div>
          <label for="acc-display-name" class="block font-bold text-slate-500 mb-1">${txMsg('Nama Tampilan', 'Display Name')}</label>
          <input id="acc-display-name" class="swal2-input" style="margin:0;width:100%" maxlength="60" value="${escapeHtmlJS(root.sessionUser || '')}">
        </div>
        <div class="pt-2 border-t border-slate-200 dark:border-slate-700">
          <label for="acc-pin-input" class="block font-bold text-slate-500 mb-1">${txMsg('PIN Aplikasi — Enkripsi Data Lokal (4–6 digit,', 'App PIN — Local Data Encryption (4–6 digits,')} ${pinStatus})</label>
          <input id="acc-pin-input" type="password" inputmode="numeric" maxlength="6" class="swal2-input" style="margin:0;width:100%" placeholder="${pinPlaceholder}">
          <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">${txMsg('PIN mengenkripsi snapshot & antrean offline di perangkat ini (AES-GCM 256-bit). Tanpa PIN yang benar, data lokal tidak bisa dibaca. Percobaan salah berulang mengunci PIN makin lama (60 detik → 5 → 15 → 60 menit); setelah 3 kali terkunci, buka kunci membutuhkan verifikasi password akun.', 'Your PIN encrypts the offline snapshot & queue on this device (AES-GCM 256-bit). Without the correct PIN, local data cannot be read. Repeated wrong attempts lock the PIN for longer (60 seconds → 5 → 15 → 60 minutes); after 3 lockouts, unlocking requires verifying your account password.')}</p>
        </div>
        <div class="flex flex-wrap gap-2 pt-2">
          <button type="button" data-action="swalClose|changeOwnPassword" class="flex-1 min-h-11 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5"><i class="ph ph-key" aria-hidden="true"></i> <span>${txMsg('Ganti Password', 'Change Password')}</span></button>
          ${hasPin ? `<button type="button" id="acc-clear-pin-btn" class="min-h-11 py-2.5 px-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold inline-flex items-center justify-center gap-1.5"><i class="ph ph-lock-open" aria-hidden="true"></i> <span>${txMsg('Hapus PIN', 'Remove PIN')}</span></button>` : ''}
        </div>
        <div class="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            ${txMsg('Dokumen legal:', 'Legal documents:')}
            <a href="privacy.html" target="_blank" rel="noopener noreferrer" class="text-brand dark:text-brand-ink font-semibold underline">${txMsg('Kebijakan Privasi', 'Privacy Policy')}</a> ·
            <a href="terms.html" target="_blank" rel="noopener noreferrer" class="text-brand dark:text-brand-ink font-semibold underline">${txMsg('Syarat &amp; Ketentuan', 'Terms &amp; Conditions')}</a>
          </p>
          <button type="button" id="acc-delete-account-btn" class="w-full min-h-11 py-2 px-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 font-bold inline-flex items-center justify-center gap-1.5 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors">
            <i class="ph ph-trash" aria-hidden="true"></i> <span>${txMsg('Hapus Akun &amp; Data Permanen', 'Delete Account &amp; Data Permanently')}</span>
          </button>
        </div>
      </div>`;
  }

  function bindAccountModalEvents() {
    const clr = document.getElementById('acc-clear-pin-btn');
    if (clr) {
      clr.addEventListener('click', async () => {
        Swal.close();
        if (!(await promptVerifyCurrentPin(txMsg('Verifikasi PIN untuk Menghapus', 'Verify PIN to Remove')))) return;
        // PIN dihapus: kembalikan data lokal ke plaintext selagi DEK masih
        // di memori, baru hapus kunci wrap + hash + salt.
        await migrateLocalDataToPlaintext();
        localStorage.removeItem('mk_app_pin_hash');
        localStorage.removeItem('mk_app_pin_salt');
        localStorage.removeItem(PIN_DATA_KEY_WRAP_KEY);
        localStorage.removeItem('mk_biometric_pin_enabled');
        localStorage.removeItem('mk_biometric_cred_id');
        clearPinDataKey();
        await writePinLockState({ attempts: 0, lockedUntil: 0, lockoutCount: 0, failuresTotal: 0, passwordResetRequired: false });
        sessionStorage.removeItem('mk_pin_unlocked');
        Swal.fire({ icon: 'info', title: txMsg('PIN aplikasi dihapus', 'App PIN removed'), timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      });
    }
    const delBtn = document.getElementById('acc-delete-account-btn');
    if (delBtn) delBtn.addEventListener('click', () => { Swal.close(); deleteOwnAccountFlow(); });
    if (root.__mkFeat && typeof root.__mkFeat.decorateAccountBiometricRow === 'function') {
      root.__mkFeat.decorateAccountBiometricRow(Boolean(localStorage.getItem('mk_app_pin_hash')));
    }
  }

  async function openAccountSettingsModal() {
    const hasPin = Boolean(localStorage.getItem('mk_app_pin_hash'));
    const res = await Swal.fire({
      title: txMsg('Pengaturan Akun & Keamanan', 'Account & Security Settings'),
      html: buildAccountSettingsHtml(hasPin),
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      didOpen: bindAccountModalEvents,
      preConfirm: () => {
        const displayName = (document.getElementById('acc-display-name').value || '').trim();
        const pin = (document.getElementById('acc-pin-input').value || '').trim();
        if (displayName.length < 2) {
          Swal.showValidationMessage(txMsg('Nama tampilan minimal 2 karakter.', 'Display name must be at least 2 characters.'));
          return false;
        }
        if (pin && checkPinPolicy(pin) !== '') {
          Swal.showValidationMessage(checkPinPolicy(pin));
          return false;
        }
        return { displayName, pin };
      }
    });
    if (!res.isConfirmed || !res.value) return;
    if (res.value.pin && hasPin && !(await promptVerifyCurrentPin(txMsg('Verifikasi PIN Saat Ini', 'Verify Current PIN')))) return;
    await applyAccountSettingsUpdate(res.value);
  }

  async function applyAccountSettingsUpdate(val) {
    try {
      if (val.displayName !== root.sessionUser) {
        const out = await callServer('api_updateOwnProfile', val.displayName);
        if (out && out.displayName) {
          root.sessionUser = out.displayName;
          const uEl = document.getElementById('ui-username');
          if (uEl) uEl.innerText = root.sessionUser;
          if (typeof updateDashboardTitle === 'function') updateDashboardTitle();
        }
      }
      if (val.pin) {
        const oldPin = lastVerifiedPin;
        if (hasPin) {
          // PIN diubah: DEK sama, bungkus ulang dengan PIN baru — data lokal
          // tidak perlu dienkripsi ulang.
          let rewrapped = false;
          if (oldPin) rewrapped = await rewrapPinDataKey(oldPin, val.pin);
          if (!rewrapped) {
            await createPinDataKey(val.pin);
            await migrateLocalDataToEncrypted();
          }
        } else {
          // PIN baru dibuat saat data lama masih plaintext: buat DEK +
          // bungkus, lalu enkripsi data lama.
          await createPinDataKey(val.pin);
          await migrateLocalDataToEncrypted();
        }
        localStorage.setItem('mk_app_pin_hash', await hashPin(val.pin));
        lastVerifiedPin = '';
        await markPinUnlocked();
      }
      Swal.fire({ icon: 'success', title: txMsg('Pengaturan akun tersimpan', 'Account settings saved'), timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
    }
  }

  async function deleteOwnAccountFlow() {
    const keyword = txMsg('HAPUS', 'DELETE');
    const confirmRes = await Swal.fire({
      icon: 'warning',
      title: txMsg('Hapus Akun Permanen?', 'Delete Account Permanently?'),
      html: `
        <div class="text-left text-xs space-y-2 text-slate-600 dark:text-slate-300">
          <p>${txMsg('Seluruh transaksi, dompet, aset, anggaran, jadwal rutin, dan profil Anda akan <strong>dihapus permanen</strong> dan tidak bisa dipulihkan.', 'All your transactions, wallets, assets, budgets, recurring items, and profile will be <strong>permanently deleted</strong> and cannot be recovered.')}</p>
          <label for="del-acc-confirm" class="block font-bold pt-1">${txMsg('Ketik', 'Type')} <span class="text-rose-600">${keyword}</span> ${txMsg('untuk konfirmasi', 'to confirm')}</label>
          <input id="del-acc-confirm" type="text" autocomplete="off" class="swal2-input" style="margin:0;width:100%" placeholder="${keyword}">
          <label for="del-acc-password" class="block font-bold pt-1">${txMsg('Password akun saat ini', 'Current account password')}</label>
          <input id="del-acc-password" type="password" autocomplete="current-password" class="swal2-input" style="margin:0;width:100%" placeholder="${txMsg('Password akun', 'Account password')}">
          <p class="text-[11px] text-slate-500 dark:text-slate-400">${txMsg('Password diminta ulang untuk memastikan yang menghapus akun benar-benar pemiliknya.', 'Your password is asked again to make sure the account is deleted by its owner.')}</p>
        </div>`,
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: txMsg('Hapus Akun Permanen', 'Delete Permanently'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const v = String((document.getElementById('del-acc-confirm') || {}).value || '').trim().toUpperCase();
        if (v !== 'HAPUS' && v !== 'DELETE') {
          Swal.showValidationMessage(txMsg('Ketik HAPUS terlebih dahulu.', 'Type DELETE first to confirm.'));
          return false;
        }
        const password = String((document.getElementById('del-acc-password') || {}).value || '');
        if (!password) {
          Swal.showValidationMessage(txMsg('Masukkan password akun Anda saat ini.', 'Enter your current account password.'));
          return false;
        }
        return { confirmation: v, password };
      }
    });
    if (!confirmRes.isConfirmed || !confirmRes.value) return;
    Swal.fire({ title: txMsg('Menghapus akun...', 'Deleting account...'), text: txMsg('Mohon tunggu sebentar.', 'Please wait a moment.'), allowOutsideClick: false, didOpen: () => Swal.showLoading(), customClass: { popup: getSwalClass() } });
    try {
      await callServer('api_deleteOwnAccount', confirmRes.value.confirmation, confirmRes.value.password);
      await Swal.fire({ icon: 'success', title: txMsg('Akun Dihapus', 'Account Deleted'), text: txMsg('Seluruh data Anda telah dihapus permanen.', 'All of your data has been permanently deleted.'), timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      // Akun sudah terhapus di server: antrean offline tidak mungkin lagi
      // tersinkronisasi, jadi lewati penjaga antrean logout (K3) di sini.
      if (typeof root.logout === 'function') await root.logout({ force: true });
    } catch (err) {
      if (typeof showActionError === 'function') showActionError(err);
      else Swal.fire({ icon: 'error', title: txMsg('Gagal Menghapus Akun', 'Failed to Delete Account'), text: toUserErrorMessage(err, isEn() ? 'en' : 'id'), customClass: { popup: getSwalClass() } });
    }
  }

  const basePinLockAlertOpts = () => ({
    allowOutsideClick: false,
    allowEscapeKey: false,
    showDenyButton: true,
    denyButtonText: txMsg('Keluar', 'Sign Out'),
    denyButtonColor: '#64748b',
    customClass: { popup: getSwalClass() }
  });

  function showPinCooldownAlert(waitSec) {
    return Swal.fire({
      ...basePinLockAlertOpts(),
      icon: 'warning',
      title: txMsg('PIN Terkunci Sementara', 'PIN Temporarily Locked'),
      text: txMsg(`Terlalu banyak percobaan salah. Coba lagi dalam ${waitSec} detik. Kunci berikutnya lebih lama (5 → 15 → 60 menit); setelah 3 kali terkunci, verifikasi password akun diperlukan.`, `Too many wrong attempts. Try again in ${waitSec} seconds. The next lockout is longer (5 → 15 → 60 minutes); after 3 lockouts, account password verification is required.`),
      confirmButtonText: txMsg('Coba Lagi', 'Try Again')
    });
  }

  function promptAppPinInput(onBiometricSuccess) {
    const feat = root.__mkFeat || {};
    return Swal.fire({
      ...basePinLockAlertOpts(),
      title: txMsg('Masukkan PIN Aplikasi', 'Enter App PIN'),
      input: 'password',
      inputAttributes: { inputmode: 'numeric', maxlength: '6', autocomplete: 'off' },
      inputPlaceholder: txMsg('PIN 4–6 digit', '4–6 digit PIN'),
      confirmButtonText: txMsg('Buka Kunci', 'Unlock'),
      didOpen: () => {
        if (typeof feat.decoratePinModalBiometricButton === 'function') feat.decoratePinModalBiometricButton(onBiometricSuccess);
      }
    });
  }

  // Mengembalikan `true` bila sesi unlocked / PIN tidak diset, `false` bila
  // pengguna memilih keluar (logout) atau verifikasi dibatalkan saat terkunci.
  // Pemanggil (mis. loadInitialAppData) JANGAN merender data bila hasilnya false.
  async function verifyAppPinIfEnabled() {
    const savedHash = localStorage.getItem('mk_app_pin_hash');
    if (!savedHash || sessionStorage.getItem('mk_pin_unlocked') === '1' || pinPromptShown) return true;
    await ensurePinLockStateLoaded();
    // S6: after the v3.20.7 cut-off, a legacy PIN hash is dead. The user
    // proves ownership with the account password, the legacy hash/salt/
    // wrap are wiped, and they set a fresh PIN afterwards. A failed or
    // cancelled re-verification keeps the app locked (returns false).
    if (isLegacyPinHash(savedHash) && isLegacyPinCutoffPassed()) {
      const pwOk = await promptAccountPasswordReverify();
      if (!pwOk) return false;
      localStorage.removeItem('mk_app_pin_hash');
      localStorage.removeItem('mk_app_pin_salt');
      localStorage.removeItem(PIN_DATA_KEY_WRAP_KEY);
      clearPinDataKey();
      try { sessionStorage.setItem('mk_pin_unlocked', '1'); } catch (_) { /* ignore */ }
      await Swal.fire({
        icon: 'info',
        title: txMsg('PIN Lama Direset', 'Old PIN Reset'),
        text: txMsg('PIN lama Anda sudah tidak berlaku lagi demi keamanan. Silakan buat PIN baru di Pengaturan Akun.', 'Your old PIN no longer applies for security reasons. Please create a new PIN in Account Settings.'),
        customClass: { popup: getSwalClass() }
      });
      return true;
    }
    pinPromptShown = true;
    const mainEl = document.getElementById('mainContent');
    if (mainEl) mainEl.classList.add('blur-md', 'pointer-events-none');
    try {
      // Biometrik TIDAK bisa menurunkan DEK dari PIN: bila DEK belum ada di
      // memori (buka aplikasi baru / setelah re-lock), unlock biometrik saja
      // tidak cukup — alur jatuh kembali ke memasukkan PIN sekali untuk
      // unwrap DEK, baru setelah itu sesi dianggap unlocked.
      if (root.__mkFeat && typeof root.__mkFeat.tryBiometricUnlock === 'function') {
        let bioOk = false;
        try { bioOk = await root.__mkFeat.tryBiometricUnlock(); } catch (_) { bioOk = false; }
        if (bioOk && hasPinDataKey()) {
          await markBiometricUnlocked();
          return true;
        }
        // bioOk tapi DEK belum tersedia -> lanjut ke prompt PIN di bawah.
      }
      while (true) {
        const state = await readPinLockState();
        if (state.passwordResetRequired) {
          const pwOk = await promptAccountPasswordReverify();
          if (!pwOk) {
            const res = await Swal.fire({
              ...basePinLockAlertOpts(),
              icon: 'warning',
              title: txMsg('PIN Masih Terkunci', 'PIN Still Locked'),
              text: txMsg('PIN terkunci sampai password akun terverifikasi. Anda bisa mencoba lagi atau keluar.', 'PIN stays locked until your account password is verified. You can try again or sign out.'),
              confirmButtonText: txMsg('Coba Lagi', 'Try Again')
            });
            if (res.isDenied) { if (typeof root.logout === 'function') root.logout(); return false; }
            continue;
          }
        }
        const waitSec = getPinCooldownSeconds();
        if (waitSec > 0) {
          const waitRes = await showPinCooldownAlert(waitSec);
          if (waitRes.isDenied) { if (typeof root.logout === 'function') root.logout(); return false; }
          continue;
        }
        let unlockedByBio = false;
        const res = await promptAppPinInput(() => { unlockedByBio = true; Swal.close(); });
        if (unlockedByBio) {
          if (hasPinDataKey()) { await markBiometricUnlocked(); break; }
          await Swal.fire({
            icon: 'info',
            title: txMsg('PIN Diperlukan Sekali', 'PIN Required Once'),
            text: txMsg('Sidik jari terverifikasi, tetapi data lokal terenkripsi membutuhkan PIN sekali untuk membuka kunci enkripsi.', 'Biometrics verified, but your encrypted local data needs the PIN once to unlock the encryption key.'),
            customClass: { popup: getSwalClass() }
          });
          continue;
        }
        if (res.isDenied) { if (typeof root.logout === 'function') root.logout(); return false; }
        const pin = String(res.value || '').trim();
        if (await verifyPinMatches(pin, savedHash)) {
          await ensurePinDataKeyAfterUnlock(pin);
          await markPinUnlocked();
          break;
        }
        const st = await recordFailedPinAttempt();
        const left = Math.max(0, MAX_PIN_ATTEMPTS - st.attempts);
        const msg = st.passwordResetRequired
          ? txMsg('Terlalu banyak lockout. PIN terkunci sampai Anda verifikasi password akun.', 'Too many lockouts. PIN stays locked until you verify your account password.')
          : st.lockedUntil
            ? txMsg(`Batas percobaan tercapai. Terkunci ${formatLockoutDuration(st.lockedUntil - Date.now())}.`, `Attempt limit reached. Locked for ${formatLockoutDuration(st.lockedUntil - Date.now())}.`)
            : txMsg(`Sisa ${left} percobaan.`, `${left} attempts left.`);
        await Swal.fire({ icon: 'error', title: txMsg('PIN salah', 'Incorrect PIN'), text: msg, timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      }
      return true;
    } finally {
      pinPromptShown = false;
      if (mainEl) mainEl.classList.remove('blur-md', 'pointer-events-none');
    }
  }

  function buildQuickMenuCard(id, cardCls, iconCls, iconName, title, sub) {
    return `<button type="button" id="${id}" class="p-4 rounded-2xl border flex flex-col items-center justify-center gap-1.5 hover:shadow-sm transition-colors ${cardCls}">` +
      `<span class="w-10 h-10 rounded-xl flex items-center justify-center ${iconCls}"><i class="ph-bold ph-${iconName} text-xl" aria-hidden="true"></i></span>` +
      `<span>${title}</span><span class="text-[11px] font-medium opacity-80">${sub}</span></button>`;
  }

  async function openQuickAddMenu() {
    const cards = [
      buildQuickMenuCard('fab-out', 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/40', 'bg-rose-100 dark:bg-rose-500/20', 'minus-circle', txMsg('Pengeluaran', 'Expense'), txMsg('Catat biaya harian', 'Record daily spending')),
      buildQuickMenuCard('fab-in', 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/40', 'bg-emerald-100 dark:bg-emerald-500/20', 'plus-circle', txMsg('Pemasukan', 'Income'), txMsg('Gaji atau pendapatan', 'Salary or earnings')),
      buildQuickMenuCard('fab-ocr', 'bg-brand/10 text-brand dark:text-brand-ink border-brand/25', 'bg-brand/15', 'camera', txMsg('Scan Struk AI', 'AI Receipt Scan'), txMsg('Foto nota belanja', 'Snap shopping receipt')),
      buildQuickMenuCard('fab-tf', 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700', 'bg-slate-200/80 dark:bg-slate-700', 'arrows-left-right', txMsg('Transfer Dompet', 'Wallet Transfer'), txMsg('Pindah antar saldo', 'Move funds between wallets'))
    ].join('');
    return Swal.fire({
      title: txMsg('Catat Cepat', 'Quick Entry'),
      html: `<div class="grid grid-cols-2 gap-3 text-xs font-bold">${cards}</div>`,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: t('btn.tutup'),
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        document.getElementById('fab-out')?.addEventListener('click', () => { Swal.close(); openForm('Pengeluaran'); });
        document.getElementById('fab-in')?.addEventListener('click', () => { Swal.close(); openForm('Pemasukan'); });
        document.getElementById('fab-ocr')?.addEventListener('click', () => { Swal.close(); openForm('Pengeluaran'); setTimeout(() => triggerReceiptOcr(), 120); });
        document.getElementById('fab-tf')?.addEventListener('click', () => { Swal.close(); openTransferModal('transfer'); });
      }
    });
  }

  async function installPwaApp() {
    const promptEvt = root._deferredPwaPrompt;
    if (promptEvt && typeof promptEvt.prompt === 'function') {
      promptEvt.prompt();
      try {
        const choice = await promptEvt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          root._deferredPwaPrompt = null;
          document.getElementById('pwaInstallWrap')?.classList.add('hidden');
        }
      } catch (_) { /* ignore */ }
      return;
    }
    Swal.fire({
      icon: 'info',
      title: txMsg('Pasang di Layar Utama', 'Install to Home Screen'),
      html: `<p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${txMsg('Di <strong>iOS Safari</strong>, ketuk ikon <strong>Bagikan (Share)</strong> di bawah lalu pilih <strong>Add to Home Screen</strong>. Di <strong>Chrome/Edge</strong>, buka menu browser lalu pilih <strong>Install App</strong>.', 'On <strong>iOS Safari</strong>, tap the <strong>Share</strong> icon below then select <strong>Add to Home Screen</strong>. On <strong>Chrome/Edge</strong>, open the browser menu and select <strong>Install App</strong>.')}</p>`,
      confirmButtonText: txMsg('Mengerti', 'Got it'),
      customClass: { popup: getSwalClass() }
    });
  }

  function handlePwaShortcutAction() {
    if (root._pwaShortcutHandled || !root.isDataReady) return;
    const action = (new URLSearchParams(root.location.search || '').get('action') || '').toLowerCase();
    if (!action) return;
    root._pwaShortcutHandled = true;
    try {
      root.history.replaceState({}, document.title, root.location.pathname + root.location.hash);
    } catch (_) { /* ignore */ }
    setTimeout(() => {
      if (action === 'pengeluaran' && typeof openForm === 'function') openForm('Pengeluaran');
      else if (action === 'pemasukan' && typeof openForm === 'function') openForm('Pemasukan');
      else if (action === 'scan' && typeof openForm === 'function') {
        openForm('Pengeluaran');
        setTimeout(() => { if (typeof triggerReceiptOcr === 'function') triggerReceiptOcr(); }, 180);
      } else if (action === 'budgeting' && typeof switchView === 'function') switchView('budgeting');
    }, 120);
  }

  // S4: the exact re-lock sequence, shared by the hidden-tab rule and
  // the visible-tab idle timer. Re-locking drops the DEK from memory,
  // so the next unlock needs the PIN once to unwrap it (biometrics
  // alone are not enough). Limitation (pre-existing): data already
  // rendered in this session stays in the DOM; verifyAppPinIfEnabled
  // only blurs it as a mitigation.
  function lockForIdle() {
    try { sessionStorage.removeItem('mk_pin_unlocked'); } catch (_) { /* ignore */ }
    clearPinDataKey();
    verifyAppPinIfEnabled();
  }

  // S4: returns true when an idle lock was triggered. `now` is
  // injectable for tests; defaults to Date.now().
  function checkIdleLock(now) {
    let pinSet = false;
    try { pinSet = Boolean(localStorage.getItem('mk_app_pin_hash')); } catch (_) { pinSet = false; }
    if (!pinSet || pinPromptShown) return false;
    if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return false;
    const t = typeof now === 'number' ? now : Date.now();
    if (t - lastActivityAt < AUTO_LOCK_IDLE_MS) return false;
    lockForIdle();
    return true;
  }

  function bindAutoLockListeners() {
    if (autoLockBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    autoLockBound = true;
    ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach((evt) => {
      document.addEventListener(evt, () => noteActivity(), { passive: true });
    });
    if (typeof setInterval === 'function') {
      setInterval(() => { checkIdleLock(); }, AUTO_LOCK_CHECK_MS);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pinLastHiddenAt = Date.now();
    } else if (document.visibilityState === 'visible' && pinLastHiddenAt > 0) {
      const elapsed = Date.now() - pinLastHiddenAt;
      pinLastHiddenAt = 0;
      if (elapsed >= AUTO_LOCK_IDLE_MS && localStorage.getItem('mk_app_pin_hash') && !pinPromptShown) {
        lockForIdle();
      }
    }
  });
  bindAutoLockListeners();

  async function saveInitialAppPin(pin) {
    if (localStorage.getItem('mk_app_pin_hash') || checkPinPolicy(pin) !== '') return false;
    localStorage.setItem('mk_app_pin_hash', await hashPin(String(pin)));
    try { await createPinDataKey(String(pin)); } catch (_) { /* tanpa DEK, data lokal tidak akan tersimpan terenkripsi */ }
    await markPinUnlocked();
    return true;
  }

  Object.assign(root, { openAccountSettingsModal, deleteOwnAccountFlow, openQuickAddMenu, installPwaApp });
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.saveInitialAppPin = saveInitialAppPin;
  // Gelombang 4: dipakai toggleBiometricUnlock() saat mematikan biometrik.
  root.__mkFeat.promptVerifyCurrentPin = promptVerifyCurrentPin;
  root.__mkFeat.verifyAppPinIfEnabled = verifyAppPinIfEnabled;
  root.__mkFeat.handlePwaShortcutAction = handlePwaShortcutAction;
  // K2: DEK hanya di memori — dibersihkan saat lock/logout. `getPinDataKey`
  // dipakai ui-feat-cache.js / ui-feat-offline.js untuk enkripsi lokal.
  root.__mkFeat.getPinDataKey = getPinDataKey;
  root.__mkFeat.hasPinDataKey = hasPinDataKey;
  root.__mkFeat.clearPinDataKey = clearPinDataKey;
  // T2: state cooldown (IndexedDB) untuk tes / diagnostik.
  root.__mkFeat.pinLock = {
    readPinLockState,
    writePinLockState,
    recordFailedPinAttempt,
    getPinLockStateSync,
    getPinCooldownSeconds,
    isPinPasswordResetRequired,
    lockoutDurationMs: pinLockoutDurationMs
  };
  // Wave 3.1 — test/diagnostic surface: PIN verification (S6), idle
  // auto-lock (S4) and PIN policy (S5).
  root.__mkFeat.wave3Auth = {
    verifyPinMatches,
    derivePinHash,
    hashPin,
    isLegacyPinHash,
    isLegacyPinCutoffPassed,
    LEGACY_PIN_CUTOFF_VERSION,
    checkPinPolicy,
    AUTO_LOCK_IDLE_MS,
    autoLock: {
      noteActivity,
      checkIdleLock,
      lockForIdle,
      getLastActivityAt: () => lastActivityAt,
      setLastActivityAt: (ms) => { lastActivityAt = Number(ms) || 0; lastActivityRecordAt = 0; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
