// supabase/functions/webauthn/index.ts — WebAuthn server verification
// (Wave 3.1 / S1).
//
// *** DRAFT — BELUM DIVERIFIKASI, JANGAN DEPLOY DULU. ***
// Ditulis sebagai bagian dari upaya alur WebAuthn server penuh, tetapi
// BELUM pernah dijalankan di bawah Deno, BELUM di-deploy ke proyek
// Supabase mana pun, dan BELUM diuji end-to-end (tidak ada runtime Deno
// di sesi penulisan ini). Klien memanggil function ini hanya bila
// WEBAUTHN_SERVER_ENABLED = true di web/ui-feat-native-ux.js — saat ini
// false, jadi klien memakai verifikasi interim sisi-klien. Sebelum
// mengaktifkan: jalankan `deno check` + uji end-to-end (enroll lalu
// unlock) terhadap proyek staging, lalu terapkan migrasi
// 20261128070000_wave3_webauthn.sql.
//
// Alur:
//   * POST { action: 'begin', purpose: 'enrollment' | 'assertion' }
//     -> { challenge (base64url), rpId }. Challenge sekali pakai,
//     kedaluwarsa 5 menit, disimpan di webauthn_challenges.
//   * POST { action: 'finish-enrollment', credentialId,
//     attestationObject, clientDataJSON, transports }
//     -> memverifikasi challenge + clientData + rpIdHash + flag +
//     kunci COSE, lalu menyimpan public key (JWK EC P-256) di
//     webauthn_credentials. -> { verified: true, credentialId }
//   * POST { action: 'finish-assertion', credentialId, clientDataJSON,
//     authenticatorData, signature, userHandle }
//     -> memverifikasi challenge + clientData + rpIdHash + flag +
//     counter + tanda tangan ECDSA P-256 terhadap kunci tersimpan,
//     lalu memperbarui counter. -> { verified: true }
//
// Keamanan: semua aksi butuh Bearer token pengguna yang valid
// (verify_jwt tetap true di config); service role hanya dipakai untuk
// membaca/menulis tabel WebAuthn. Kunci privat tidak pernah menyentuh
// server — hanya JWK publik hasil parse attestation yang disimpan.

function resolveAllowedOrigin(req: Request): string {
  const raw = Deno.env.get('ALLOWED_ORIGIN') || '*';
  const list = raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!list.length || list.includes('*')) return '*';
  const reqOrigin = (req.headers.get('origin') || '').trim().replace(/\/+$/, '');
  if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
  return list[0];
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin !== '*') headers['Vary'] = 'Origin';
  return headers;
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ---------- base64url ---------- */

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(b64: string): Uint8Array {
  const normalized = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const bin = atob(normalized + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/* ---------- minimal CBOR decoder (untuk attestationObject) ---------- */

export function cborDecode(bytes: Uint8Array, offset: number): { value: unknown; next: number } {
  const pos = offset || 0;
  if (pos >= bytes.length) throw new Error('CBOR tidak lengkap.');
  const initial = bytes[pos];
  const major = initial >> 5;
  const info = initial & 0x1f;
  let cursor = pos + 1;
  const readArg = (): number => {
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
    return { value: bytes.slice(cursor, cursor + len), next: cursor + len };
  }
  if (major === 3) {
    const len = readArg();
    let str = '';
    for (let i = 0; i < len; i++) str += String.fromCharCode(bytes[cursor + i]);
    return { value: decodeURIComponent(escape(str)), next: cursor + len };
  }
  if (major === 4) {
    const len = readArg();
    const arr: unknown[] = [];
    for (let i = 0; i < len; i++) { const item = cborDecode(bytes, cursor); arr.push(item.value); cursor = item.next; }
    return { value: arr, next: cursor };
  }
  if (major === 5) {
    const len = readArg();
    const obj: Record<string, unknown> = {};
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
    if (info === 26) return { value: new DataView(bytes.buffer, bytes.byteOffset + cursor, 4).getFloat32(0), next: cursor + 4 };
    if (info === 27) return { value: new DataView(bytes.buffer, bytes.byteOffset + cursor, 8).getFloat64(0), next: cursor + 8 };
    throw new Error('CBOR simple value tidak didukung.');
  }
  throw new Error('CBOR major type tidak didukung.');
}

/* ---------- WebAuthn verification (pure — bisa diuji tanpa Deno) ---------- */

export interface ParsedAttestation {
  fmt: string;
  credIdB64: string;
  counter: number;
  authData: Uint8Array;
  jwk: Record<string, string>;
}

export function parseAttestationObject(attestationBytes: Uint8Array): ParsedAttestation {
  const decoded = cborDecode(attestationBytes, 0).value;
  if (!isRecord(decoded) || !decoded.authData) throw new Error('Attestation tidak valid.');
  const authData = decoded.authData instanceof Uint8Array
    ? decoded.authData
    : new Uint8Array(decoded.authData as ArrayBuffer);
  if (authData.length < 37) throw new Error('authData terlalu pendek.');
  const flags = authData[32];
  if (!(flags & 0x40)) throw new Error('Attestation tanpa data kunci.');
  const counter = ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0;
  const credIdLen = (authData[53] << 8) | authData[54];
  const credId = authData.slice(55, 55 + credIdLen);
  if (credId.length !== credIdLen) throw new Error('credentialId tidak lengkap.');
  const cose = cborDecode(authData, 55 + credIdLen).value;
  if (!isRecord(cose) || cose[1] !== 2 || cose[3] !== -7 || cose[-1] !== 1) {
    throw new Error('Kunci kredensial bukan EC P-256.');
  }
  const x = cose[-2];
  const y = cose[-3];
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error('Koordinat kunci P-256 tidak valid.');
  }
  return {
    fmt: String(decoded.fmt || ''),
    credIdB64: base64UrlEncode(credId),
    counter,
    authData,
    jwk: { kty: 'EC', crv: 'P-256', x: base64UrlEncode(x), y: base64UrlEncode(y) },
  };
}

export function parseClientData(clientDataBytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(clientDataBytes)) as Record<string, unknown>;
}

export function verifyClientDataFields(
  clientData: Record<string, unknown>,
  expectedType: string,
  expectedChallenge: string,
  expectedOrigin: string,
): boolean {
  if (!clientData || clientData.type !== expectedType) return false;
  if (clientData.challenge !== expectedChallenge) return false;
  if (!expectedOrigin || clientData.origin !== expectedOrigin) return false;
  return true;
}

export async function verifyRpIdHash(authData: Uint8Array, rpId: string): Promise<boolean> {
  if (!rpId) return true;
  const expected = await sha256Bytes(new TextEncoder().encode(rpId));
  const actual = authData.slice(0, 32);
  if (actual.length !== 32) return false;
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}

// Verifikasi tanda tangan assertion terhadap JWK publik tersimpan.
export async function verifyAssertionSignature(
  publicKeyJwk: Record<string, unknown>,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const clientHash = await sha256Bytes(clientDataJSON);
  const signed = new Uint8Array(authenticatorData.length + clientHash.length);
  signed.set(authenticatorData, 0);
  signed.set(clientHash, authenticatorData.length);
  return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed);
}

/* ---------- HTTP handler (Deno only) ---------- */

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('webauthn: Supabase belum dikonfigurasi.');
    return jsonResponse(req, { error: 'Fungsi WebAuthn belum dikonfigurasi.' }, 500);
  }

  const authorization = req.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400);
  }
  if (!isRecord(body)) return jsonResponse(req, { error: 'Permintaan tidak valid.' }, 400);

  const { createClient } = await import('npm:@supabase/supabase-js@2.45.4');
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return jsonResponse(req, { error: 'Sesi login tidak valid.' }, 401);
  const userId = authData.user.id as string;

  const origin = (req.headers.get('origin') || '').trim().replace(/\/+$/, '');
  const rpId = Deno.env.get('WEBAUTHN_RP_ID')
    || (origin ? new URL(origin).hostname : '')
    || '';
  if (!rpId) return jsonResponse(req, { error: 'Origin tidak valid.' }, 400);

  const action = body.action;

  // --- begin: terbitkan challenge sekali pakai (5 menit) ---
  if (action === 'begin') {
    const purpose = body.purpose === 'enrollment' ? 'enrollment' : 'assertion';
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = base64UrlEncode(challengeBytes);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error } = await adminClient.from('webauthn_challenges').insert({
      user_id: userId, challenge, purpose, expires_at: expiresAt,
    });
    if (error) {
      console.error('webauthn: gagal menyimpan challenge', error.message);
      return jsonResponse(req, { error: 'Tidak dapat memulai WebAuthn.' }, 500);
    }
    return jsonResponse(req, { challenge, rpId });
  }

  // Konsumsi challenge secara atomik (sekali pakai): hanya baris yang
  // belum dipakai dan belum kedaluwarsa yang bisa ditandai.
  async function consumeChallenge(challenge: string, purpose: string): Promise<boolean> {
    const { data, error } = await adminClient
      .from('webauthn_challenges')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('challenge', challenge)
      .eq('purpose', purpose)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id');
    if (error) {
      console.error('webauthn: gagal memakai challenge', error.message);
      return false;
    }
    return Array.isArray(data) && data.length === 1;
  }

  // --- finish-enrollment: verifikasi attestation, simpan public key ---
  if (action === 'finish-enrollment') {
    const credentialId = body.credentialId;
    const attestationObject = body.attestationObject;
    const clientDataJSON = body.clientDataJSON;
    const transports = Array.isArray(body.transports)
      ? (body.transports as unknown[]).map((t) => String(t)).slice(0, 8)
      : ['internal'];
    if (typeof credentialId !== 'string' || !credentialId
      || typeof attestationObject !== 'string' || !attestationObject
      || typeof clientDataJSON !== 'string' || !clientDataJSON) {
      return jsonResponse(req, { error: 'Data pendaftaran tidak lengkap.' }, 400);
    }
    let parsed: ParsedAttestation;
    let clientData: Record<string, unknown>;
    try {
      const attBytes = base64UrlDecode(attestationObject);
      const clientBytes = base64UrlDecode(clientDataJSON);
      parsed = parseAttestationObject(attBytes);
      clientData = parseClientData(clientBytes);
    } catch (e) {
      return jsonResponse(req, { error: 'Attestation tidak dapat dibaca: ' + (e as Error).message }, 400);
    }
    if (parsed.credIdB64 !== credentialId) {
      return jsonResponse(req, { error: 'credentialId tidak cocok dengan attestation.' }, 400);
    }
    // Challenge harus yang diterbitkan server untuk enrollment ini.
    const challenge = String(clientData.challenge || '');
    if (!challenge || !(await consumeChallenge(challenge, 'enrollment'))) {
      return jsonResponse(req, { error: 'Challenge tidak valid atau sudah dipakai.' }, 400);
    }
    if (!verifyClientDataFields(clientData, 'webauthn.create', challenge, origin)) {
      return jsonResponse(req, { error: 'clientData tidak valid.' }, 400);
    }
    if (!(await verifyRpIdHash(parsed.authData, rpId))) {
      return jsonResponse(req, { error: 'RP ID tidak cocok.' }, 400);
    }
    const flags = parsed.authData[32];
    if (!(flags & 0x01) || !(flags & 0x04)) {
      return jsonResponse(req, { error: 'Verifikasi pengguna (UV) wajib untuk pendaftaran.' }, 400);
    }
    const { error: insertError } = await adminClient.from('webauthn_credentials').insert({
      user_id: userId,
      credential_id: parsed.credIdB64,
      public_key: parsed.jwk,
      counter: parsed.counter,
      transports,
    });
    if (insertError) {
      console.error('webauthn: gagal menyimpan kredensial', insertError.message);
      return jsonResponse(req, { error: 'Kredensial gagal disimpan.' }, 500);
    }
    return jsonResponse(req, { verified: true, credentialId: parsed.credIdB64 });
  }

  // --- finish-assertion: verifikasi tanda tangan + counter ---
  if (action === 'finish-assertion') {
    const credentialId = body.credentialId;
    const clientDataJSON = body.clientDataJSON;
    const authenticatorData = body.authenticatorData;
    const signature = body.signature;
    if (typeof credentialId !== 'string' || !credentialId
      || typeof clientDataJSON !== 'string' || !clientDataJSON
      || typeof authenticatorData !== 'string' || !authenticatorData
      || typeof signature !== 'string' || !signature) {
      return jsonResponse(req, { error: 'Data assertion tidak lengkap.' }, 400);
    }
    const { data: cred, error: credError } = await adminClient
      .from('webauthn_credentials')
      .select('credential_id, public_key, counter')
      .eq('user_id', userId)
      .eq('credential_id', credentialId)
      .maybeSingle();
    if (credError) {
      console.error('webauthn: gagal memuat kredensial', credError.message);
      return jsonResponse(req, { error: 'Tidak dapat memverifikasi.' }, 500);
    }
    if (!cred) return jsonResponse(req, { error: 'Kredensial tidak dikenal.' }, 404);
    let clientData: Record<string, unknown>;
    let authDataBytes: Uint8Array;
    let clientBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      clientBytes = base64UrlDecode(clientDataJSON);
      authDataBytes = base64UrlDecode(authenticatorData);
      sigBytes = base64UrlDecode(signature);
      clientData = parseClientData(clientBytes);
    } catch (e) {
      return jsonResponse(req, { error: 'Assertion tidak dapat dibaca: ' + (e as Error).message }, 400);
    }
    const challenge = String(clientData.challenge || '');
    if (!challenge || !(await consumeChallenge(challenge, 'assertion'))) {
      return jsonResponse(req, { error: 'Challenge tidak valid atau sudah dipakai.' }, 400);
    }
    if (!verifyClientDataFields(clientData, 'webauthn.get', challenge, origin)) {
      return jsonResponse(req, { error: 'clientData tidak valid.' }, 400);
    }
    if (!(await verifyRpIdHash(authDataBytes, rpId))) {
      return jsonResponse(req, { error: 'RP ID tidak cocok.' }, 400);
    }
    const flags = authDataBytes[32];
    if (!(flags & 0x01) || !(flags & 0x04)) {
      return jsonResponse(req, { error: 'Verifikasi pengguna (UV) wajib.' }, 400);
    }
    if (authDataBytes.length < 37) return jsonResponse(req, { error: 'authenticatorData tidak valid.' }, 400);
    const counter = ((authDataBytes[33] << 24) | (authDataBytes[34] << 16) | (authDataBytes[35] << 8) | authDataBytes[36]) >>> 0;
    const storedCounter = Number((cred as Record<string, unknown>).counter || 0);
    if (counter > 0 && storedCounter > 0 && counter <= storedCounter) {
      return jsonResponse(req, { error: 'Counter tidak naik — kemungkinan kredensial terkloning.' }, 400);
    }
    let signatureOk = false;
    try {
      signatureOk = await verifyAssertionSignature(
        (cred as Record<string, unknown>).public_key as Record<string, unknown>,
        authDataBytes, clientBytes, sigBytes,
      );
    } catch (e) {
      console.error('webauthn: verifikasi tanda tangan gagal', (e as Error).message);
      return jsonResponse(req, { error: 'Tanda tangan tidak valid.' }, 400);
    }
    if (!signatureOk) return jsonResponse(req, { error: 'Tanda tangan tidak valid.' }, 400);
    const { error: updateError } = await adminClient
      .from('webauthn_credentials')
      .update({ counter, last_used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('credential_id', credentialId);
    if (updateError) {
      console.error('webauthn: gagal memperbarui counter', updateError.message);
      return jsonResponse(req, { error: 'Tidak dapat menyelesaikan verifikasi.' }, 500);
    }
    return jsonResponse(req, { verified: true });
  }

  return jsonResponse(req, { error: 'Aksi tidak dikenal.' }, 400);
}

if (typeof Deno !== 'undefined') {
  Deno.serve(handleRequest);
}
