/* global Swal, getSwalClass */
/* ============================================================
   FEATURES — NATIVE UX (PULL-TO-REFRESH, HAPTICS & BIOMETRIC)
   ============================================================ */
(function (root) {
  'use strict';

  const BIOMETRIC_ENABLED_KEY = 'mk_biometric_pin_enabled';
  const BIOMETRIC_CRED_KEY = 'mk_biometric_cred_id';
  // Gelombang 4 — pembatas percobaan biometrik (R): dulu
  // tryBiometricUnlock() menelan semua kegagalan dan tombol coba-lagi
  // bisa ditekan tanpa batas. Sekarang 5 kegagalan beruntun mengunci
  // biometrik 60 detik, lalu 5 -> 15 -> 60 menit (durasi yang sama
  // dengan lockout PIN supaya mudah diingat). State di localStorage:
  // throttle ini lapisan tambahan — pembatas utama tetap di
  // OS/authenticator (Android/iOS mengunci biometrik setelah ~5
  // gagal). Pengguna yang terkunci selalu bisa memakai PIN.
  const BIOMETRIC_LOCK_STATE_KEY = 'mk_biometric_lock_state_v1';
  const MAX_BIOMETRIC_ATTEMPTS = 5;
  const BIOMETRIC_LOCKOUT_DURATIONS_MS = [60000, 5 * 60000, 15 * 60000, 60 * 60000];

  function readBiometricLockState(store, now) {
    const storage = store || localStorage;
    let parsed = null;
    try { parsed = JSON.parse(storage.getItem(BIOMETRIC_LOCK_STATE_KEY) || 'null'); } catch (_) { parsed = null; }
    const v = parsed && typeof parsed === 'object' ? parsed : {};
    return {
      failures: Number(v.failures) || 0,
      lockedUntil: Number(v.lockedUntil) || 0,
      lockoutCount: Number(v.lockoutCount) || 0
    };
  }

  function writeBiometricLockState(state, store) {
    const storage = store || localStorage;
    const next = {
      failures: Number(state.failures) || 0,
      lockedUntil: Number(state.lockedUntil) || 0,
      lockoutCount: Number(state.lockoutCount) || 0
    };
    try { storage.setItem(BIOMETRIC_LOCK_STATE_KEY, JSON.stringify(next)); } catch (_) { /* abaikan */ }
    return next;
  }

  function biometricLockoutDurationMs(lockoutCount) {
    const idx = Math.max(0, Math.min(lockoutCount - 1, BIOMETRIC_LOCKOUT_DURATIONS_MS.length - 1));
    return BIOMETRIC_LOCKOUT_DURATIONS_MS[idx];
  }

  function getBiometricCooldownSeconds(now) {
    const t = typeof now === 'number' ? now : Date.now();
    const { lockedUntil } = readBiometricLockState();
    return lockedUntil > t ? Math.ceil((lockedUntil - t) / 1000) : 0;
  }

  function recordBiometricFailure(store, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const prev = readBiometricLockState(store, t);
    let next = { failures: prev.failures + 1, lockedUntil: prev.lockedUntil, lockoutCount: prev.lockoutCount };
    if (next.failures >= MAX_BIOMETRIC_ATTEMPTS) {
      const lockoutCount = prev.lockoutCount + 1;
      next = { failures: 0, lockedUntil: t + biometricLockoutDurationMs(lockoutCount), lockoutCount };
    }
    return writeBiometricLockState(next, store);
  }

  function clearBiometricFailures(store) {
    return writeBiometricLockState({ failures: 0, lockedUntil: 0, lockoutCount: 0 }, store);
  }
  const PTR_VIEWS = ['view-dashboard', 'view-histori', 'view-laporan', 'view-aset', 'view-budgeting'];

  const isEn = () => typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'en';
  const msg = (idStr, enStr) => (isEn() ? enStr : idStr);

  function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(b64) {
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isNativePlatform() {
    return Boolean(root.Capacitor && typeof root.Capacitor.isNativePlatform === 'function' && root.Capacitor.isNativePlatform());
  }

  function getNativeBiometricPlugin() {
    const cap = root.Capacitor;
    if (!cap) return null;
    if (cap.Plugins && cap.Plugins.NativeBiometric) return cap.Plugins.NativeBiometric;
    if (isNativePlatform() && typeof cap.registerPlugin === 'function' &&
        (typeof cap.isPluginAvailable !== 'function' || cap.isPluginAvailable('NativeBiometric'))) {
      try {
        const plugin = cap.registerPlugin('NativeBiometric');
        if (plugin) {
          cap.Plugins = cap.Plugins || {};
          cap.Plugins.NativeBiometric = plugin;
          return plugin;
        }
      } catch (_) { /* ignore missing native registration */ }
    }
    return null;
  }

  function resolveWebAuthnRpId() {
    const host = (root.location && root.location.hostname) ? String(root.location.hostname).trim() : '';
    if (!host || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return undefined;
    return host;
  }

  async function checkBiometricAvailability() {
    const isNative = isNativePlatform();
    const nativeBio = getNativeBiometricPlugin();
    if (nativeBio && typeof nativeBio.isAvailable === 'function') {
      try {
        const res = await nativeBio.isAvailable();
        if (res && res.isAvailable) return { supported: true, mode: 'native', reason: 'available' };
        if (isNative) return { supported: false, mode: 'native', reason: (res && res.reason) || 'unavailable' };
      } catch (err) {
        if (isNative) return { supported: false, mode: 'native', reason: (err && (err.code || err.message)) || 'unavailable' };
      }
    }
    if (isNative) return { supported: false, mode: 'native_missing', reason: 'native_plugin_missing' };
    if (root.isSecureContext === false) return { supported: false, mode: 'web', reason: 'insecure_context' };
    if (!root.PublicKeyCredential || typeof root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      return { supported: false, mode: 'web', reason: 'no_webauthn' };
    }
    try {
      const ok = await root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return { supported: Boolean(ok), mode: 'web', reason: ok ? 'available' : 'no_platform_authenticator' };
    } catch (_) {
      return { supported: false, mode: 'web', reason: 'no_platform_authenticator' };
    }
  }

  async function isBiometricUnlockSupported() {
    const res = await checkBiometricAvailability();
    return Boolean(res.supported);
  }

  function isBiometricUnlockEnabled() {
    try {
      return localStorage.getItem(BIOMETRIC_ENABLED_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function formatBiometricFailureReason(reasonOrErr) {
    const code = String((reasonOrErr && (reasonOrErr.code || reasonOrErr.name)) || reasonOrErr || '');
    const rawMsg = String((reasonOrErr && reasonOrErr.message) || reasonOrErr || '');
    const map = {
      none_enrolled: msg('Belum ada sidik jari/biometrik terdaftar di pengaturan perangkat.', 'No fingerprint/biometric is enrolled in device settings.'),
      no_hardware: msg('Perangkat ini tidak memiliki sensor sidik jari atau biometrik.', 'This device has no biometric hardware.'),
      hw_unavailable: msg('Sensor biometrik sedang sibuk atau tidak tersedia sementara.', 'Biometric sensor is temporarily unavailable.'),
      native_plugin_missing: msg('Modul biometrik native belum aktif di build aplikasi ini. Perbarui APK terbaru.', 'Native biometric module is missing in this build. Install the latest APK.'),
      insecure_context: msg('Kunci sidik jari di web memerlukan koneksi HTTPS yang aman.', 'Web biometric unlock requires a secure HTTPS connection.'),
      no_webauthn: msg('Browser atau WebView ini belum mendukung kunci biometrik.', 'This browser or WebView does not support biometric unlock.'),
      no_platform_authenticator: msg('Perangkat atau browser belum mengaktifkan autentikator sidik jari/layar kunci.', 'Platform biometric authenticator is unavailable on this device.'),
      SecurityError: msg('Origin saat ini tidak diizinkan untuk kunci biometrik WebAuthn.', 'Current origin is not permitted for WebAuthn biometrics.')
    };
    if (map[code]) return map[code];
    if (code === 'NotAllowedError' || code === '10' || code === '13' || /cancel|abort|timeout/i.test(rawMsg)) {
      return msg('Verifikasi biometrik dibatalkan atau waktu habis.', 'Biometric verification was cancelled or timed out.');
    }
    return rawMsg || msg('Gagal mengaktifkan kunci biometrik.', 'Failed to activate biometric unlock.');
  }

  async function waitSwalClosed() {
    if (typeof Swal === 'undefined' || typeof document === 'undefined') return;
    if (Swal.isVisible() || document.querySelector('.swal2-popup.swal2-hide')) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  // ============================================================
  // Wave 3.1 / S1 — WebAuthn (web path)
  //
  // HONEST STATUS: this is the INTERIM client-side verification, not
  // real WebAuthn. The old code generated a challenge, discarded it,
  // and accepted ANY navigator.credentials.get() result (even `{}`) —
  // no stored public key, no signature check, no replay protection.
  // The interim below fixes what can be fixed in the browser:
  //   * the challenge is stored (sessionStorage, single-use) BEFORE
  //     create()/get() and must match clientDataJSON.challenge;
  //   * type must be 'webauthn.create' / 'webauthn.get' and origin
  //     must equal location.origin;
  //   * at enrollment the attestationObject is parsed (minimal CBOR)
  //     and the COSE public key is stored; at assertion the signature
  //     is verified with WebCrypto (ECDSA P-256) over
  //     authenticatorData || SHA-256(clientDataJSON), with a counter
  //     check and a last-signature replay check.
  // What it CANNOT do (and why it is not real WebAuthn): the key, the
  // challenge store and this verification all live in the same JS
  // context as a page-level attacker, so a JS-level attacker can
  // bypass it. Real verification must happen on the server.
  //
  // SERVER FLOW (NOT DONE — see report): the server pieces exist as
  // an UNVERIFIED DRAFT — supabase/migrations/
  // 20261128070000_wave3_webauthn.sql (webauthn_credentials +
  // webauthn_challenges tables) and supabase/functions/webauthn/
  // (challenge issuance + signature/counter verification). They have
  // NOT been executed against any Supabase project, NOT deployed, and
  // NOT verified end-to-end in this session (no Deno runtime here, and
  // production deploys are out of scope for this agent). Do NOT deploy
  // them until they are verified under Deno. The client below only
  // calls the edge function when WEBAUTHN_SERVER_ENABLED is true; it
  // is false until that verification happens.
  // ============================================================
  const WEBAUTHN_CHALLENGE_KEY = 'mk_webauthn_challenge_v1';
  const WEBAUTHN_PUBKEY_KEY = 'mk_webauthn_pubkey_v1';
  const WEBAUTHN_COUNTER_KEY = 'mk_webauthn_counter_v1';
  const WEBAUTHN_LAST_SIG_KEY = 'mk_webauthn_last_sig_v1';
  const WEBAUTHN_SERVER_ENABLED = false;

  function webauthnStoreGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }
  function webauthnStoreSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) { /* ignore */ }
  }
  function webauthnStoreRemove(key) {
    try { sessionStorage.removeItem(key); } catch (_) { /* ignore */ }
  }
  function webauthnLocalGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function webauthnLocalSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
  }

  function newWebAuthnChallenge() {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    return bytesToBase64Url(challenge);
  }

  // Single-use challenge store: written BEFORE create()/get(), read
  // (and deleted) exactly once when the response is verified.
  function storeWebAuthnChallenge(challengeB64) {
    webauthnStoreSet(WEBAUTHN_CHALLENGE_KEY, JSON.stringify({ challenge: challengeB64, createdAt: Date.now() }));
  }
  function consumeWebAuthnChallenge() {
    let parsed = null;
    try { parsed = JSON.parse(webauthnStoreGet(WEBAUTHN_CHALLENGE_KEY) || 'null'); } catch (_) { parsed = null; }
    webauthnStoreRemove(WEBAUTHN_CHALLENGE_KEY);
    if (!parsed || typeof parsed.challenge !== 'string') return '';
    if (Date.now() - Number(parsed.createdAt || 0) > 5 * 60 * 1000) return '';
    return parsed.challenge;
  }

  // --- Minimal CBOR decoder (only what attestationObject needs) ---
  function cborDecode(bytes, offset) {
    const pos = offset || 0;
    if (pos >= bytes.length) throw new Error('CBOR tidak lengkap.');
    const initial = bytes[pos];
    const major = initial >> 5;
    const info = initial & 0x1f;
    let cursor = pos + 1;
    const readArg = () => {
      if (info < 24) return info;
      if (info === 24) return bytes[cursor++];
      if (info === 25) { const v = (bytes[cursor] << 8) | bytes[cursor + 1]; cursor += 2; return v; }
      if (info === 26) {
        const v = ((bytes[cursor] << 24) | (bytes[cursor + 1] << 16) | (bytes[cursor + 2] << 8) | bytes[cursor + 3]) >>> 0;
        cursor += 4; return v;
      }
      if (info === 27) {
        let v = 0;
        for (let i = 0; i < 8; i++) v = v * 256 + bytes[cursor++];
        return v;
      }
      throw new Error('CBOR indefinite length tidak didukung.');
    };
    if (major === 0) return { value: readArg(), next: cursor };
    if (major === 1) return { value: -1 - readArg(), next: cursor };
    if (major === 2) {
      const len = readArg();
      const value = bytes.slice(cursor, cursor + len);
      return { value, next: cursor + len };
    }
    if (major === 3) {
      const len = readArg();
      let str = '';
      for (let i = 0; i < len; i++) str += String.fromCharCode(bytes[cursor + i]);
      return { value: decodeURIComponent(escape(str)), next: cursor + len };
    }
    if (major === 4) {
      const len = readArg();
      const arr = [];
      for (let i = 0; i < len; i++) { const item = cborDecode(bytes, cursor); arr.push(item.value); cursor = item.next; }
      return { value: arr, next: cursor };
    }
    if (major === 5) {
      const len = readArg();
      const obj = {};
      for (let i = 0; i < len; i++) {
        const k = cborDecode(bytes, cursor); cursor = k.next;
        const v = cborDecode(bytes, cursor); cursor = v.next;
        obj[String(k.value)] = v.value;
      }
      return { value: obj, next: cursor };
    }
    if (major === 7) {
      if (info === 20) return { value: false, next: cursor };
      if (info === 21) return { value: true, next: cursor };
      if (info === 22) return { value: null, next: cursor };
      if (info === 23) return { value: undefined, next: cursor };
      if (info === 25) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + cursor, 2);
        return { value: view.getFloat16 ? view.getFloat16(0) : 0, next: cursor + 2 };
      }
      if (info === 26) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + cursor, 4);
        return { value: view.getFloat32(0), next: cursor + 4 };
      }
      if (info === 27) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + cursor, 8);
        return { value: view.getFloat64(0), next: cursor + 8 };
      }
      throw new Error('CBOR simple value tidak didukung.');
    }
    throw new Error('CBOR major type tidak didukung.');
  }

  async function sha256Bytes(data) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(buf);
  }
  function bytesToHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Parse an attestationObject into { credIdB64, jwk, counter, fmt }.
  // Only EC2 P-256 keys (COSE kty 2, crv 1, alg -7) are accepted.
  function parseAttestationObject(attestationBytes) {
    const decoded = cborDecode(attestationBytes, 0).value;
    if (!decoded || typeof decoded !== 'object' || !decoded.authData) throw new Error('Attestation tidak valid.');
    const authData = decoded.authData instanceof Uint8Array ? decoded.authData : new Uint8Array(decoded.authData);
    if (authData.length < 37) throw new Error('authData terlalu pendek.');
    const flags = authData[32];
    if (!(flags & 0x40)) throw new Error('Attestation tanpa data kunci.');
    const counter = ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0;
    const credIdLen = (authData[53] << 8) | authData[54];
    const credId = authData.slice(55, 55 + credIdLen);
    if (credId.length !== credIdLen) throw new Error('credentialId tidak lengkap.');
    const cose = cborDecode(authData, 55 + credIdLen).value;
    if (!cose || cose[1] !== 2 || cose[3] !== -7 || cose[-1] !== 1) {
      throw new Error('Kunci kredensial bukan EC P-256.');
    }
    const x = cose[-2];
    const y = cose[-3];
    if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
      throw new Error('Koordinat kunci P-256 tidak valid.');
    }
    return {
      fmt: String(decoded.fmt || ''),
      credIdB64: bytesToBase64Url(credId),
      counter,
      jwk: { kty: 'EC', crv: 'P-256', x: bytesToBase64Url(x), y: bytesToBase64Url(y) }
    };
  }

  // Verify clientDataJSON: type, challenge (must equal the stored
  // single-use challenge) and origin (must equal location.origin).
  function verifyClientData(clientDataBytes, expectedType, expectedChallenge) {
    if (!clientDataBytes || !clientDataBytes.length || !expectedChallenge) return null;
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(clientDataBytes));
    } catch (_) { return null; }
    if (!parsed || parsed.type !== expectedType) return null;
    if (parsed.challenge !== expectedChallenge) return null;
    const expectedOrigin = (root.location && root.location.origin) || '';
    if (!expectedOrigin || parsed.origin !== expectedOrigin) return null;
    return parsed;
  }

  async function verifyRpIdHash(authData, rpId) {
    if (!rpId) return true; // no RP ID configured (IP/localhost): nothing to check
    const expected = await sha256Bytes(new TextEncoder().encode(rpId));
    const actual = authData.slice(0, 32);
    if (actual.length !== 32) return false;
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= expected[i] ^ actual[i];
    return diff === 0;
  }

  // Verify a WebAuthn assertion against the stored public key.
  // Returns true only when EVERY check passes: clientData (type /
  // challenge / origin), rpIdHash, user-presence + user-verification
  // flags, counter freshness, no signature replay, and a genuine
  // ECDSA P-256 signature. Never throws.
  async function verifyWebAuthnAssertion(assertion, opts) {
    try {
      const o = opts || {};
      if (!assertion || !assertion.response) return false;
      const resp = assertion.response;
      if (!resp.clientDataJSON || !resp.authenticatorData || !resp.signature) return false;
      const clientData = new Uint8Array(resp.clientDataJSON);
      const authData = new Uint8Array(resp.authenticatorData);
      const signature = new Uint8Array(resp.signature);
      if (!verifyClientData(clientData, 'webauthn.get', o.expectedChallenge)) return false;
      if (!o.publicKeyJwk) return false;
      if (!(await verifyRpIdHash(authData, o.rpId))) return false;
      const flags = authData[32];
      if (!(flags & 0x01) || !(flags & 0x04)) return false; // UP + UV required
      // Counter: authenticators that count must strictly increase.
      const counter = authData.length >= 37
        ? ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0
        : 0;
      const storedCounter = Number(o.storedCounter || 0);
      if (counter > 0 && storedCounter > 0 && counter <= storedCounter) return false;
      // Replay: the same assertion signature must never verify twice.
      const sigHash = bytesToHex(await sha256Bytes(signature));
      if (o.lastSignatureHash && sigHash === o.lastSignatureHash) return false;
      const key = await crypto.subtle.importKey(
        'jwk', o.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      );
      const signedData = new Uint8Array(authData.length + 32);
      signedData.set(authData, 0);
      signedData.set(await sha256Bytes(clientData), authData.length);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signedData);
      if (!ok) return false;
      if (typeof o.onVerified === 'function') o.onVerified({ counter, signatureHash: sigHash });
      return true;
    } catch (_) {
      return false;
    }
  }

  // --- Server flow (DRAFT, gated off — see the S1 note above) ---
  async function callWebAuthnFunction(action, body) {
    const sb = (root.__mkSb && root.__mkSb.sb) || null;
    if (!sb || !sb.functions || typeof sb.functions.invoke !== 'function') {
      throw new Error('Klien Supabase belum siap untuk WebAuthn server.');
    }
    const { data, error } = await sb.functions.invoke('webauthn', { body: Object.assign({ action }, body || {}) });
    if (error) throw error;
    return data || {};
  }
  async function beginWebAuthnServerChallenge(purpose) {
    return callWebAuthnFunction('begin', { purpose });
  }
  async function finishWebAuthnServerEnrollment(payload) {
    return callWebAuthnFunction('finish-enrollment', payload);
  }
  async function finishWebAuthnServerAssertion(payload) {
    return callWebAuthnFunction('finish-assertion', payload);
  }

  function responseToBase64Url(buf) {
    if (!buf) return '';
    return bytesToBase64Url(new Uint8Array(buf));
  }

  async function enrollWebAuthnCredential() {
    if (!navigator.credentials || typeof navigator.credentials.create !== 'function') return '';
    const rpId = resolveWebAuthnRpId();
    // Server flow (draft, gated): challenge comes from the edge function.
    if (WEBAUTHN_SERVER_ENABLED) {
      const begun = await beginWebAuthnServerChallenge('enrollment');
      if (!begun || !begun.challenge) throw new Error('Challenge server tidak tersedia.');
      const userBytes = new TextEncoder().encode(String(root.sessionUser || 'mykeuguech-user').slice(0, 48));
      const rp = rpId ? { name: 'MyKeuGuech', id: rpId } : { name: 'MyKeuGuech' };
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: base64UrlToBytes(begun.challenge),
          rp,
          user: { id: userBytes, name: String(root.sessionUser || 'user'), displayName: String(root.sessionUser || 'User') },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
          timeout: 45000
        }
      });
      if (!cred || !cred.rawId) return '';
      const done = await finishWebAuthnServerEnrollment({
        credentialId: responseToBase64Url(cred.rawId),
        attestationObject: responseToBase64Url(cred.response && cred.response.attestationObject),
        clientDataJSON: responseToBase64Url(cred.response && cred.response.clientDataJSON),
        transports: (cred.response && cred.response.getTransports && cred.response.getTransports()) || ['internal']
      });
      if (!done || !done.verified) throw new Error('Verifikasi server gagal.');
      return bytesToBase64Url(new Uint8Array(cred.rawId));
    }
    // Interim (client-side): store the challenge BEFORE create(), then
    // verify the attestation response against it and persist the
    // public key — the old code stored nothing at all.
    const challengeB64 = newWebAuthnChallenge();
    storeWebAuthnChallenge(challengeB64);
    const userBytes = new TextEncoder().encode(String(root.sessionUser || 'mykeuguech-user').slice(0, 48));
    const rp = rpId ? { name: 'MyKeuGuech', id: rpId } : { name: 'MyKeuGuech' };
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: base64UrlToBytes(challengeB64),
        rp,
        user: { id: userBytes, name: String(root.sessionUser || 'user'), displayName: String(root.sessionUser || 'User') },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        timeout: 45000
      }
    });
    if (!cred || !cred.rawId || !cred.response || !cred.response.attestationObject || !cred.response.clientDataJSON) {
      consumeWebAuthnChallenge();
      return '';
    }
    const expectedChallenge = consumeWebAuthnChallenge();
    const attestationBytes = new Uint8Array(cred.response.attestationObject);
    const clientDataBytes = new Uint8Array(cred.response.clientDataJSON);
    if (!verifyClientData(clientDataBytes, 'webauthn.create', expectedChallenge)) return '';
    let parsed;
    try {
      parsed = parseAttestationObject(attestationBytes);
    } catch (_) {
      return '';
    }
    // rpIdHash lives inside authData (first 32 bytes of attestation's
    // authData); verify it against the RP ID directly.
    const authData = parsed && cborDecode(attestationBytes, 0).value.authData;
    if (!authData || !(await verifyRpIdHash(new Uint8Array(authData), rpId))) return '';
    webauthnLocalSet(WEBAUTHN_PUBKEY_KEY, JSON.stringify(parsed.jwk));
    webauthnLocalSet(WEBAUTHN_COUNTER_KEY, String(parsed.counter || 0));
    webauthnStoreRemove(WEBAUTHN_LAST_SIG_KEY);
    return parsed.credIdB64;
  }

  // Hasil tri-state: true = terverifikasi, false = authenticator
  // dipanggil dan gagal, null = tidak sempat dicoba (nonaktif, tanpa
  // kredensial, tanpa plugin, atau server gagal) — null TIDAK dihitung
  // sebagai kegagalan oleh wrapper di bawah.
  async function tryBiometricUnlockInner() {
    if (!isBiometricUnlockEnabled()) return null;
    const isNative = isNativePlatform();
    const nativeBio = getNativeBiometricPlugin();
    if (nativeBio && typeof nativeBio.verifyIdentity === 'function') {
      try {
        await nativeBio.verifyIdentity({
          title: 'MyKeuGuech',
          subtitle: msg('Verifikasi sidik jari atau wajah', 'Verify fingerprint or face'),
          reason: msg('Buka kunci MyKeuGuech', 'Unlock MyKeuGuech'),
          negativeButtonText: msg('Gunakan PIN', 'Use PIN')
        });
        return true;
      } catch (_) {
        return false;
      }
    }
    if (isNative) return null;
    const credId = localStorage.getItem(BIOMETRIC_CRED_KEY) || '';
    if (!credId || !navigator.credentials || typeof navigator.credentials.get !== 'function') return null;
    const rpId = resolveWebAuthnRpId();
    // Server flow (draft, gated): the edge function issues the
    // challenge and verifies the assertion server-side.
    if (WEBAUTHN_SERVER_ENABLED) {
      let begun = null;
      try { begun = await beginWebAuthnServerChallenge('assertion'); } catch (_) { begun = null; }
      if (!begun || !begun.challenge) return null;
      const publicKey = {
        challenge: base64UrlToBytes(begun.challenge),
        allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(credId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 45000
      };
      if (rpId) publicKey.rpId = rpId;
      let assertion = null;
      try { assertion = await navigator.credentials.get({ publicKey }); } catch (_) { return false; }
      if (!assertion || !assertion.response) return false;
      let done = null;
      try {
        done = await finishWebAuthnServerAssertion({
          credentialId: responseToBase64Url(assertion.rawId),
          clientDataJSON: responseToBase64Url(assertion.response.clientDataJSON),
          authenticatorData: responseToBase64Url(assertion.response.authenticatorData),
          signature: responseToBase64Url(assertion.response.signature),
          userHandle: responseToBase64Url(assertion.response.userHandle)
        });
      } catch (_) { return null; }
      return Boolean(done && done.verified);
    }
    // Interim (client-side): challenge is stored BEFORE get(), and the
    // assertion is verified against the stored public key. A bare
    // truthy result (the old `Boolean(assertion)`) no longer unlocks.
    let storedJwk = null;
    try { storedJwk = JSON.parse(webauthnLocalGet(WEBAUTHN_PUBKEY_KEY) || 'null'); } catch (_) { storedJwk = null; }
    if (!storedJwk || storedJwk.kty !== 'EC') return null;
    try {
      const challengeB64 = newWebAuthnChallenge();
      storeWebAuthnChallenge(challengeB64);
      const publicKey = {
        challenge: base64UrlToBytes(challengeB64),
        allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(credId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 45000
      };
      if (rpId) publicKey.rpId = rpId;
      const assertion = await navigator.credentials.get({ publicKey });
      const expectedChallenge = consumeWebAuthnChallenge();
      if (!assertion) return false;
      return verifyWebAuthnAssertion(assertion, {
        expectedChallenge,
        rpId,
        publicKeyJwk: storedJwk,
        storedCounter: Number(webauthnLocalGet(WEBAUTHN_COUNTER_KEY) || 0),
        lastSignatureHash: webauthnStoreGet(WEBAUTHN_LAST_SIG_KEY) || '',
        onVerified: ({ counter, signatureHash }) => {
          webauthnLocalSet(WEBAUTHN_COUNTER_KEY, String(counter || 0));
          webauthnStoreSet(WEBAUTHN_LAST_SIG_KEY, signatureHash);
        }
      });
    } catch (_) {
      consumeWebAuthnChallenge();
      return false;
    }
  }

  // Gelombang 4: wrapper pembatas percobaan. Cooldown aktif -> jangan
  // panggil authenticator sama sekali. Sukses menghapus counter
  // biometrik; gagal (false) menambah counter; null tidak dihitung.
  async function tryBiometricUnlock() {
    if (getBiometricCooldownSeconds() > 0) return false;
    let result = null;
    try { result = await tryBiometricUnlockInner(); } catch (_) { result = false; }
    if (result === true) { clearBiometricFailures(); return true; }
    if (result === false) recordBiometricFailure();
    return false;
  }

  async function toggleBiometricUnlock() {
    if (!localStorage.getItem('mk_app_pin_hash')) {
      await waitSwalClosed();
      Swal.fire({ icon: 'info', title: msg('Atur PIN Dulu', 'Set PIN First'), text: msg('Simpan PIN 4–6 digit terlebih dahulu sebelum mengaktifkan biometrik.', 'Save a 4–6 digit PIN before enabling biometrics.'), customClass: { popup: getSwalClass() } });
      return;
    }
    if (isBiometricUnlockEnabled()) {
      // Gelombang 4: mematikan biometrik wajib verifikasi ulang PIN —
      // sebelumnya satu ketukan langsung menghapus kunci tanpa bukti
      // kepemilikan (berbeda dengan "Hapus PIN" yang memang memverifikasi).
      const verifier = (root.__mkFeat && root.__mkFeat.promptVerifyCurrentPin) || null;
      if (typeof verifier !== 'function') {
        await waitSwalClosed();
        Swal.fire({ icon: 'warning', title: msg('Verifikasi Tidak Tersedia', 'Verification Unavailable'), text: msg('Verifikasi PIN tidak tersedia saat ini — biometrik tidak dimatikan.', 'PIN verification is unavailable right now — biometrics were not disabled.'), customClass: { popup: getSwalClass() } });
        return;
      }
      if (!(await verifier(msg('Verifikasi PIN untuk Mematikan Biometrik', 'Verify PIN to Disable Biometrics')))) return;
      localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
      localStorage.removeItem(BIOMETRIC_CRED_KEY);
      clearBiometricFailures();
      await waitSwalClosed();
      Swal.fire({ icon: 'info', title: msg('Biometrik dimatikan', 'Biometrics disabled'), timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      return;
    }
    const avail = await checkBiometricAvailability();
    if (!avail.supported) {
      await waitSwalClosed();
      Swal.fire({ icon: 'warning', title: msg('Tidak Didukung', 'Unsupported'), text: formatBiometricFailureReason(avail.reason), customClass: { popup: getSwalClass() } });
      return;
    }
    try {
      const nativeBio = getNativeBiometricPlugin();
      if (nativeBio && typeof nativeBio.verifyIdentity === 'function') {
        await nativeBio.verifyIdentity({
          title: 'MyKeuGuech',
          subtitle: msg('Aktifkan kunci biometrik', 'Enable biometric lock'),
          reason: msg('Tempelkan sidik jari untuk mengaktifkan buka kunci biometrik', 'Verify biometric to enable fingerprint unlock'),
          negativeButtonText: msg('Batal', 'Cancel')
        });
      } else {
        const credId = await enrollWebAuthnCredential();
        if (!credId) throw new Error(msg('Kredensial biometrik gagal dibuat.', 'Failed to create biometric credential.'));
        localStorage.setItem(BIOMETRIC_CRED_KEY, credId);
      }
      localStorage.setItem(BIOMETRIC_ENABLED_KEY, '1');
      if (typeof root.triggerHaptic === 'function') root.triggerHaptic('success');
      await waitSwalClosed();
      Swal.fire({ icon: 'success', title: msg('Biometrik Aktif!', 'Biometrics Enabled!'), timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (err) {
      await waitSwalClosed();
      Swal.fire({ icon: 'warning', title: msg('Gagal Mengaktifkan', 'Activation Failed'), text: formatBiometricFailureReason(err), customClass: { popup: getSwalClass() } });
    }
  }

  function decoratePinModalBiometricButton(onSuccess) {
    if (!isBiometricUnlockEnabled() || typeof document === 'undefined' || typeof Swal === 'undefined') return;
    const popup = typeof Swal.getPopup === 'function' ? Swal.getPopup() : null;
    if (!popup || popup.querySelector('#mk-pin-bio-btn')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mk-pin-bio-wrap';
    wrap.className = 'mt-3';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mk-pin-bio-btn';
    btn.className = 'w-full min-h-10 py-2 px-3 rounded-xl bg-brand/10 text-brand dark:text-brand-ink text-xs font-bold inline-flex items-center justify-center gap-1.5';
    const icon = document.createElement('i');
    icon.className = 'ph ph-fingerprint text-base';
    icon.setAttribute('aria-hidden', 'true');
    const lbl = document.createElement('span');
    lbl.textContent = msg('Buka dengan Sidik Jari', 'Unlock with Biometrics');
    btn.append(icon, lbl);
    wrap.appendChild(btn);
    if (getBiometricCooldownSeconds() > 0) setBiometricButtonLocked(btn, getBiometricCooldownSeconds());
    const actions = popup.querySelector('.swal2-actions');
    if (actions) popup.insertBefore(wrap, actions);
    else popup.appendChild(wrap);
    bindPinModalBiometricRetry(onSuccess);
  }

  function setBiometricButtonLocked(btn, waitSec) {
    if (!btn) return;
    btn.disabled = true;
    const lbl = btn.querySelector('span');
    if (lbl) lbl.textContent = msg(`Biometrik terkunci — gunakan PIN (${waitSec} dtk)`, `Biometrics locked — use PIN (${waitSec}s)`);
  }

  function bindPinModalBiometricRetry(onSuccess) {
    const btn = typeof document !== 'undefined' ? document.getElementById('mk-pin-bio-btn') : null;
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      // Gelombang 4: hormati cooldown percobaan biometrik.
      const waitSec = getBiometricCooldownSeconds();
      if (waitSec > 0) {
        setBiometricButtonLocked(btn, waitSec);
        await waitSwalClosed();
        Swal.fire({ icon: 'warning', title: msg('Biometrik Terkunci Sementara', 'Biometrics Temporarily Locked'), text: msg(`Terlalu banyak percobaan biometrik yang gagal. Coba lagi dalam ${waitSec} detik atau gunakan PIN.`, `Too many failed biometric attempts. Try again in ${waitSec} seconds or use your PIN.`), customClass: { popup: getSwalClass() } });
        return;
      }
      btn.disabled = true;
      try {
        if (await tryBiometricUnlock()) {
          if (typeof onSuccess === 'function') onSuccess();
        } else if (getBiometricCooldownSeconds() > 0) {
          // Kegagalan ini baru saja memicu kunci: biarkan tombol
          // nonaktif sampai cooldown habis.
          setBiometricButtonLocked(btn, getBiometricCooldownSeconds());
        }
      } finally {
        if (document.body && document.body.contains(btn) && getBiometricCooldownSeconds() === 0) btn.disabled = false;
      }
    });
  }

  function decorateAccountBiometricRow(hasPin) {
    const pinInput = document.getElementById('acc-pin-input');
    if (!pinInput || !pinInput.parentElement) return;
    const container = pinInput.parentElement;
    if (container.querySelector('#acc-bio-row')) return;
    const row = document.createElement('div');
    row.id = 'acc-bio-row';
    row.className = 'mt-2.5 flex flex-wrap gap-2';

    const bioBtn = document.createElement('button');
    bioBtn.type = 'button';
    const bioOn = hasPin && isBiometricUnlockEnabled();
    bioBtn.className = 'flex-1 min-h-10 px-3 py-2 rounded-xl border text-[11px] font-bold inline-flex items-center justify-center gap-1.5 ' +
      (bioOn ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200');
    const bioIcon = document.createElement('i');
    bioIcon.className = 'ph ph-fingerprint text-base';
    bioIcon.setAttribute('aria-hidden', 'true');
    const bioLabel = document.createElement('span');
    bioLabel.textContent = bioOn ? msg('Biometrik: Aktif', 'Biometrics: On') : msg('Aktifkan Sidik Jari', 'Enable Biometrics');
    bioBtn.append(bioIcon, bioLabel);
    bioBtn.addEventListener('click', async () => {
      const typedPin = String(pinInput.value || '').trim();
      const feat = root.__mkFeat || {};
      // S5: a new PIN must pass the shared PIN policy, not just the
      // 4-6 digit format (rejects 111111 / 123456).
      const pol = (feat.passwordPolicy) || root.__mkPasswordPolicy || null;
      const pinOk = pol && typeof pol.validatePin === 'function'
        ? pol.validatePin(typedPin).ok
        : /^\d{4,6}$/.test(typedPin);
      if (!localStorage.getItem('mk_app_pin_hash') && pinOk && typeof feat.saveInitialAppPin === 'function') {
        await feat.saveInitialAppPin(typedPin);
      }
      Swal.close();
      await toggleBiometricUnlock();
    });

    const guideBtn = document.createElement('button');
    guideBtn.type = 'button';
    guideBtn.className = 'min-h-10 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[11px] font-bold inline-flex items-center justify-center gap-1.5';
    guideBtn.textContent = msg('Panduan Awal', 'Setup Wizard');
    guideBtn.addEventListener('click', () => {
      Swal.close();
      if (typeof root.openOnboardingWizard === 'function') root.openOnboardingWizard(true);
    });

    row.append(bioBtn, guideBtn);
    container.appendChild(row);
  }

  function ensurePullRefreshPill() {
    let pill = document.getElementById('mkPullRefreshPill');
    if (!pill && document.body) {
      pill = document.createElement('div');
      pill.id = 'mkPullRefreshPill';
      pill.setAttribute('aria-live', 'polite');
      pill.className = 'hide fixed left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg text-xs font-bold text-brand dark:text-brand-ink flex items-center gap-2 pointer-events-none';
      pill.style.top = 'calc(4.1rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))';
      document.body.appendChild(pill);
    }
    return pill;
  }

  function initPullToRefresh() {
    if (root.__mkPtrBound || typeof document === 'undefined') return;
    root.__mkPtrBound = true;
    let startY = 0;
    let tracking = false;
    let armed = false;
    let refreshing = false;

    const resetPill = () => {
      const pill = document.getElementById('mkPullRefreshPill');
      if (pill) pill.classList.add('hide');
      tracking = false;
      armed = false;
    };

    document.addEventListener('touchstart', (e) => {
      if (refreshing || !root.isDataReady || e.touches.length !== 1 || (root.scrollY || 0) > 2) return;
      if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
      const sb = document.getElementById('sidebar');
      if (sb && root.innerWidth < 1024 && !sb.classList.contains('-translate-x-full')) return;
      const t = e.target;
      if (t && t.closest && t.closest('.overflow-y-auto, .overflow-x-auto, .flatpickr-calendar, input, textarea, select')) return;
      const active = document.querySelector('.view-section:not(.hide)');
      if (!active || !PTR_VIEWS.includes(active.id)) return;
      startY = e.touches[0].clientY;
      tracking = true;
      armed = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      if (dy < 20) {
        if (dy < -12) resetPill();
        return;
      }
      const pill = ensurePullRefreshPill();
      if (!pill) return;
      pill.classList.remove('hide');
      const nowArmed = dy >= 76;
      if (nowArmed && !armed && typeof root.triggerHaptic === 'function') root.triggerHaptic('light');
      armed = nowArmed;
      pill.textContent = armed ? msg('Lepas untuk menyegarkan...', 'Release to refresh...') : msg('Tarik ke bawah untuk refresh...', 'Pull down to refresh...');
    }, { passive: true });

    document.addEventListener('touchend', async () => {
      if (!tracking) return;
      const shouldRefresh = armed && !refreshing;
      if (!shouldRefresh) { resetPill(); return; }
      refreshing = true;
      const pill = ensurePullRefreshPill();
      if (pill) { pill.classList.remove('hide'); pill.textContent = msg('Menyegarkan data...', 'Refreshing data...'); }
      try {
        if (navigator.onLine && typeof root.flushOfflineQueue === 'function') await root.flushOfflineQueue(true);
        if (typeof root.retryInitialAppLoad === 'function') await root.retryInitialAppLoad();
        if (typeof root.triggerHaptic === 'function') root.triggerHaptic('success');
      } finally {
        refreshing = false;
        resetPill();
      }
    }, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', initPullToRefresh);
  document.addEventListener('click', (e) => {
    // Gelombang 4 (R17): selektor onclick lama sudah mati sejak Wave 2.4
    // (tombol kini memakai data-action) — diganti selektor data-action
    // yang hidup supaya haptic tetap berbunyi.
    const btn = e.target && e.target.closest ? e.target.closest('#mobileBottomNav button, [data-action="addQuickNominalAmount"]') : null;
    if (btn && typeof root.triggerHaptic === 'function') root.triggerHaptic('light');
  });

  Object.assign(root, {
    isBiometricUnlockSupported,
    checkBiometricAvailability,
    isBiometricUnlockEnabled,
    toggleBiometricUnlock,
    tryBiometricUnlock,
    resolveWebAuthnRpId,
    formatBiometricFailureReason
  });
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.tryBiometricUnlock = tryBiometricUnlock;
  // Gelombang 4: permukaan tes/diagnostik untuk pembatas percobaan.
  root.__mkFeat.biometricLock = {
    readBiometricLockState,
    writeBiometricLockState,
    recordBiometricFailure,
    clearBiometricFailures,
    getBiometricCooldownSeconds,
    MAX_BIOMETRIC_ATTEMPTS,
    BIOMETRIC_LOCKOUT_DURATIONS_MS
  };
  root.__mkFeat.isBiometricUnlockEnabled = isBiometricUnlockEnabled;
  root.__mkFeat.checkBiometricAvailability = checkBiometricAvailability;
  root.__mkFeat.bindPinModalBiometricRetry = bindPinModalBiometricRetry;
  root.__mkFeat.decoratePinModalBiometricButton = decoratePinModalBiometricButton;
  root.__mkFeat.decorateAccountBiometricRow = decorateAccountBiometricRow;
  // Wave 3.1 / S1 — test/diagnostic surface for the interim WebAuthn
  // verification (client-side only; see the S1 note above).
  root.__mkFeat.webauthn = {
    enrollWebAuthnCredential,
    verifyWebAuthnAssertion,
    verifyClientData,
    parseAttestationObject,
    cborDecode,
    storeWebAuthnChallenge,
    consumeWebAuthnChallenge,
    WEBAUTHN_SERVER_ENABLED,
    WEBAUTHN_PUBKEY_KEY,
    WEBAUTHN_COUNTER_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
