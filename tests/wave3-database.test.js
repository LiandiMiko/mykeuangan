const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto, createHmac, createHash } = require('node:crypto');

const MIG = 'supabase/migrations/20261128040000_wave3_database.sql';
const migrationSql = fs.readFileSync(MIG, 'utf8');
const indexTs = fs.readFileSync('supabase/functions/telegram-bot/index.ts', 'utf8');
const wave1Mig = fs.readFileSync('supabase/migrations/20261128000000_wave1_admin_hardening.sql', 'utf8');

// Pola repo: tidak ada Postgres live di lingkungan ini, jadi perilaku DB
// diuji dengan menegaskan migrasi SQL memuat guard/policy/trigger/fungsi
// yang disyaratkan; logika JS (HMAC) diuji secara nyata di bawah.
function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  assert.ok(open !== -1 && close !== -1, `body delimiters for ${name} not found`);
  // Sertakan header (tanda tangan, security definer, returns) + body.
  return sql.slice(start, close + 3);
}

function migrationFilesAfter(fileName) {
  return fs.readdirSync('supabase/migrations')
    .filter((f) => f > fileName && f.endsWith('.sql'))
    .sort();
}

/* ============================================================
   §1 is_admin() — definisi final sudah benar, tanpa perubahan kode
   ============================================================ */

test('3.2 §1: is_admin() final memuat status = active (20261115040200)', () => {
  const hardening = fs.readFileSync('supabase/migrations/20261115040200_application_hardening.sql', 'utf8');
  const body = fnBody(hardening, 'is_admin');
  assert.match(body, /role = 'admin' and status = 'active'/);
  assert.match(body, /security definer/);
  assert.match(hardening, /grant execute on function public\.is_admin\(\) to authenticated, service_role/);
});

test('3.2 §1: tidak ada migrasi sesudah 20261115040200 yang mendefinisikan ulang is_admin()', () => {
  const later = migrationFilesAfter('20261115040200_application_hardening.sql');
  assert.ok(later.length > 0, 'harus ada migrasi sesudah 20261115040200 untuk diperiksa');
  assert.ok(later.includes('20261128040000_wave3_database.sql'), 'migrasi Wave 3.2 harus ikut diperiksa');
  for (const f of later) {
    const sql = fs.readFileSync(path.join('supabase/migrations', f), 'utf8');
    assert.doesNotMatch(
      sql,
      /create\s+or\s+replace\s+function\s+public\.is_admin\s*\(/,
      `${f} tidak boleh mendefinisikan ulang is_admin()`,
    );
  }
  // Versi lama (role saja) hanya ada di 20261114000000 dan sudah digantikan.
  const old = fs.readFileSync('supabase/migrations/20261114000000_multiuser_onboarding.sql', 'utf8');
  assert.match(fnBody(old, 'is_admin'), /role = 'admin'/);
  assert.doesNotMatch(fnBody(old, 'is_admin'), /status = 'active'/);
});

test('3.2 §1: migrasi Wave 3.2 tidak menyentuh is_admin() sama sekali', () => {
  assert.doesNotMatch(migrationSql, /create\s+or\s+replace\s+function\s+public\.is_admin\s*\(/);
  assert.match(migrationSql, /§1 is_admin\(\) — TIDAK ADA PERUBAHAN KODE/);
  assert.match(migrationSql, /pg_get_functiondef\('public\.is_admin\(\)'::regprocedure\)/);
});

/* ============================================================
   §2a OTP — HMAC-SHA256 dengan pepper Vault, bukan SHA-256 polos
   ============================================================ */

test('3.2 §2a: replace_telegram_pairing memakai HMAC, bukan digest SHA-256 polos', () => {
  const body = fnBody(migrationSql, 'replace_telegram_pairing');
  assert.match(body, /public\.telegram_otp_hash\(p_otp\)/);
  assert.doesNotMatch(migrationSql, /digest\(p_otp, 'sha256'\)/,
    'migrasi Wave 3.2 tidak boleh lagi memakai SHA-256 polos untuk OTP');
  const hashBody = fnBody(migrationSql, 'telegram_otp_hash');
  assert.match(hashBody, /extensions\.hmac\(p_otp, public\.telegram_otp_pepper\(\), 'sha256'\)/);
  assert.match(hashBody, /encode\(.*'hex'\)/);
});

test('3.2 §2a: panggilan pgcrypto di migrasi harus berkualifikasi skema extensions', () => {
  // Supabase memasang pgcrypto di skema `extensions`, bukan `public`,
  // sementara semua fungsi Wave 3 memakai `set search_path = public`.
  // Panggilan tak berkualifikasi gagal: saat CREATE untuk fungsi
  // `language sql` (telegram_otp_hash) dan saat runtime untuk plpgsql
  // (rantai hash audit). Regresi ini menggagalkan penerapan migrasi
  // 20261128040000 di produksi (ERROR 42883, rollback total).
  const unqualified = [...migrationSql.matchAll(/(?<![\w.])((hmac|digest|gen_salt|crypt)\s*\()/g)];
  assert.deepEqual(unqualified.map((m) => m[0]), [],
    'panggilan pgcrypto tanpa skema di migrasi: ' + unqualified.map((m) => m[0]).join(', '));
  assert.match(migrationSql, /extensions\.hmac\(p_otp, public\.telegram_otp_pepper\(\), 'sha256'\)/);
  assert.match(migrationSql, /extensions\.digest\(/);
});

test('3.2 §2a: pepper dibaca dari Vault (nama secret saja, tanpa nilai)', () => {
  const body = fnBody(migrationSql, 'telegram_otp_pepper');
  assert.match(body, /from vault\.decrypted_secrets/);
  assert.match(body, /where name = 'telegram_otp_hmac_secret'/);
  assert.match(body, /belum diset di Supabase Vault/);
  // Fail-closed: tanpa secret, pairing ditolak dengan pesan jelas.
  assert.match(body, /raise exception/);
  assert.match(migrationSql, /revoke all on function public\.telegram_otp_pepper\(\) from public, anon, authenticated/,
    'pepper tidak boleh bisa dibaca langsung oleh authenticated');
  assert.match(migrationSql, /delete from public\.telegram_pairings;/,
    'hash SHA-256 polos lama harus dihapus (tidak berlaku di bawah HMAC)');
});

test('3.2 §2a: HMAC-SHA256 (WebCrypto, seperti telegram-bot/index.ts) identik dengan hmac() Postgres', async () => {
  // Postgres hmac(data text, key text, 'sha256') = HMAC-SHA256 atas
  // byte UTF-8 — konstruksi yang sama dengan Node createHmac dan
  // WebCrypto subtle (yang dipakai Deno di edge function).
  const otp = '12345678';
  const pepper = 'pepper-uji-32-karakter-abcdef';
  const expected = createHmac('sha256', pepper).update(otp).digest('hex');

  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(otp));
  const webCryptoHex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(webCryptoHex, expected, 'WebCrypto HMAC harus sama dengan hmac() Postgres');
  // Dan nilainya HARUS berbeda dari SHA-256 polos (kalau sama, pepper tidak bekerja).
  assert.notEqual(webCryptoHex, createHash('sha256').update(otp).digest('hex'));
  assert.equal(webCryptoHex.length, 64, 'HMAC-SHA256 hex harus 64 karakter');
});

test('3.2 §2a: webhook telegram-bot menghitung HMAC dengan secret env, bukan sha256Hex', () => {
  assert.match(indexTs, /TELEGRAM_OTP_HMAC_SECRET/);
  assert.match(indexTs, /crypto\.subtle\.importKey\(\s*'raw',/);
  assert.match(indexTs, /\{ name: 'HMAC', hash: 'SHA-256' \}/);
  assert.match(indexTs, /crypto\.subtle\.sign\('HMAC', key,/);
  assert.match(indexTs, /otpHash = await hmacOtpHex\(otp\);/);
  assert.match(indexTs, /Pairing Telegram belum dikonfigurasi di server/,
    'secret hilang harus dijawab ke pengguna, bukan gagal diam-diam');
  assert.match(indexTs, /\.eq\('otp_hash', otpHash\)/, 'lookup tetap berdasarkan otp_hash');
  assert.doesNotMatch(indexTs, /sha256Hex\(otp\)/);
  assert.doesNotMatch(indexTs, /sha256Hex/, 'sha256Hex tidak boleh lagi dipakai di webhook pairing');
  assert.match(indexTs, /TELEGRAM_OTP_HMAC_SECRET belum dikonfigurasi/,
    'secret hilang harus gagal dengan pesan jelas, bukan hash yang salah');
});

/* ============================================================
   §2b Throttle pembuatan OTP per pengguna
   ============================================================ */

test('3.2 §2b: pembuatan OTP dibatasi max 5 per 10 menit per pengguna', () => {
  assert.match(migrationSql, /create table if not exists public\.telegram_otp_creation_attempts/);
  assert.match(migrationSql, /user_id\s+uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(migrationSql, /revoke all on public\.telegram_otp_creation_attempts from public, anon, authenticated/);
  const body = fnBody(migrationSql, 'replace_telegram_pairing');
  assert.match(body, /insert into public\.telegram_otp_creation_attempts as current_attempts/);
  assert.match(body, /on conflict \(user_id\) do update/);
  assert.match(body, /now\(\) - interval '10 minutes'/);
  assert.match(body, /if v_attempts > 5 then/);
  assert.match(body, /Terlalu banyak pembuatan kode pairing/);
});

/* ============================================================
   §2c Lookup bot bersama — risiko residual terdokumentasi
   ============================================================ */

test('3.2 §2c: lookup bot personal tetap terikat user; risiko bot bersama terdokumentasi', () => {
  assert.match(indexTs, /if \(knownUid\) q = q\.eq\('user_id', knownUid\)/);
  assert.match(indexTs, /if \(knownUid && pair\.user_id !== knownUid\)/);
  assert.match(indexTs, /RISIKO RESIDUAL/);
  assert.match(indexTs, /bot\s+BERSAMA/);
  assert.match(indexTs, /lookup bersifat GLOBAL/);
  assert.match(migrationSql, /R1\. Webhook bot BERSAMA/);
  assert.match(migrationSql, /lookup pairing OTP bersifat GLOBAL/);
});

/* ============================================================
   §2d Pembersih pairing kedaluwarsa
   ============================================================ */

test('3.2 §2d: purge_expired_telegram_pairings() menghapus baris kedaluwarsa (cron memanggilnya)', () => {
  const body = fnBody(migrationSql, 'purge_expired_telegram_pairings');
  assert.match(body, /delete from public\.telegram_pairings/);
  assert.match(body, /where expires_at <= now\(\)/);
  assert.match(body, /get diagnostics v_deleted = row_count/);
  assert.match(body, /return v_deleted/);
  assert.match(migrationSql, /grant execute on function public\.purge_expired_telegram_pairings\(\) to service_role/);
  assert.match(migrationSql, /revoke all on function public\.purge_expired_telegram_pairings\(\) from public, anon, authenticated/);
  assert.match(migrationSql, /panggil public\.purge_expired_telegram_pairings\(\)/);
});

/* ============================================================
   §3 Audit log — cabut INSERT langsung, allowlist, append-only, hash-chain
   ============================================================ */

test('3.2 §3: INSERT langsung ke admin_audit_logs dicabut (policy + grant)', () => {
  assert.match(migrationSql, /drop policy if exists "admins_insert_audit_logs" on public\.admin_audit_logs/);
  assert.match(migrationSql, /revoke insert on public\.admin_audit_logs from authenticated/);
  assert.doesNotMatch(migrationSql, /create policy "admins_insert_audit_logs"/);
  // SELECT admin tetap ada (policy lama tidak dihapus, grant select dipertahankan).
  assert.match(migrationSql, /admins_read_audit_logs/);
});

test('3.2 §3: admin_log_action() hanya mengizinkan aksi yang benar-benar dipakai', () => {
  const body = fnBody(migrationSql, 'admin_log_action');
  for (const action of ['unlink_telegram', 'delete_user', 'reset_password']) {
    assert.ok(body.includes(action), `allowlist harus memuat ${action}`);
  }
  assert.match(body, /role_\(user\|admin\)/);
  assert.match(body, /status_\(active\|suspended\)/);
  assert.match(body, /Aksi audit tidak dikenal/);
  // Panggilan lama (4 argumen) di-drop dulu supaya overload tanpa allowlist tidak tersisa.
  assert.match(migrationSql, /drop function if exists public\.admin_log_action\(text, uuid, text, jsonb\);/);
  // Aksi-aksi itu memang yang dipakai edge function / klien (bukti enumerasi).
  const adminOps = fs.readFileSync('supabase/functions/admin-user-ops/index.ts', 'utf8');
  assert.match(adminOps, /role_\$\{newValue\}|`role_\$\{newValue\}`/);
  assert.match(adminOps, /unlink_telegram/);
  assert.match(adminOps, /delete_user/);
  const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
  assert.match(adminJs, /logAdminActionSafe\('reset_password'/);
});

test('3.2 §3: admin_log_action() tetap bisa dipanggil service_role (dengan actor eksplisit)', () => {
  const body = fnBody(migrationSql, 'admin_log_action');
  assert.match(body, /if auth\.role\(\) = 'service_role' then/);
  assert.match(body, /p_actor_user_id is null/);
  assert.match(body, /wajib menyertakan p_actor_user_id/);
  assert.match(body, /v_actor_id := p_actor_user_id/);
  assert.match(body, /if not public\.is_admin\(\) then/);
  assert.match(migrationSql,
    /grant execute on function public\.admin_log_action\(text, uuid, text, jsonb, uuid, text\) to authenticated, service_role/);
  assert.match(migrationSql, /BENTUK PANGGILAN/);
  assert.match(migrationSql, /p_actor_user_id: authData\.user\.id/);
});

test('3.2 §3: admin_audit_logs append-only — trigger BEFORE UPDATE OR DELETE selalu menolak', () => {
  const body = fnBody(migrationSql, 'prevent_admin_audit_logs_mutation');
  assert.match(body, /raise exception 'admin_audit_logs bersifat append-only/);
  assert.match(migrationSql,
    /create trigger trg_admin_audit_logs_append_only\s+before update or delete on public\.admin_audit_logs/);
  assert.match(migrationSql,
    /for each row execute function public\.prevent_admin_audit_logs_mutation\(\)/);
});

test('3.2 §3: hash-chain audit log (kolom + trigger + verifikasi)', () => {
  assert.match(migrationSql, /alter table public\.admin_audit_logs add column if not exists prev_hash text/);
  assert.match(migrationSql, /alter table public\.admin_audit_logs add column if not exists entry_hash text/);
  const chainBody = fnBody(migrationSql, 'chain_admin_audit_log_entry');
  assert.match(chainBody, /new\.prev_hash := v_prev/);
  assert.match(chainBody, /new\.entry_hash := encode\(/);
  assert.match(chainBody, /digest\(/);
  assert.match(chainBody, /'sha256'/);
  assert.match(migrationSql,
    /create trigger trg_admin_audit_logs_hash_chain\s+before insert on public\.admin_audit_logs/);
  const verifyBody = fnBody(migrationSql, 'verify_admin_audit_log_chain');
  assert.match(verifyBody, /returns uuid/);
  assert.match(verifyBody, /return r\.id/);
  assert.match(verifyBody, /return null;/);
  assert.match(migrationSql, /SELECT public\.verify_admin_audit_log_chain\(\)/);
});

/* ============================================================
   §4 prevent_admin_lockout() — DELETE berlaku untuk semua actor
   ============================================================ */

test('3.2 §4: cabang DELETE tanpa pembungkus auth.uid(), advisory lock tetap ada', () => {
  const body = fnBody(migrationSql, 'prevent_admin_lockout');
  // Komentar boleh menyebut pola lama; yang diuji adalah kodenya.
  const deleteBranch = body
    .slice(body.indexOf("tg_op = 'DELETE'"), body.indexOf('return old;'))
    .replace(/--[^\n]*/g, '');
  assert.doesNotMatch(deleteBranch, /auth\.uid\(\) is not null/,
    'cabang DELETE tidak boleh lagi melewati service_role (auth.uid() null)');
  assert.match(deleteBranch, /old\.role = 'admin' and old\.status = 'active'/);
  assert.match(deleteBranch, /pg_advisory_xact_lock\(20261118, 1\)/,
    'lock harus ada supaya dua delete admin terakhir bersamaan tepat satu yang lolos');
  assert.match(deleteBranch, /Harus ada minimal satu administrator aktif di sistem\./);
  assert.match(migrationSql, /TIDAK ADA lagi pembungkus `auth\.uid\(\) is not null` di sini/);
});

test('3.2 §4: cabang UPDATE tidak berubah (self-demotion + demosi admin terakhir tetap ditolak)', () => {
  const body = fnBody(migrationSql, 'prevent_admin_lockout');
  const updateBranch = body.slice(body.indexOf("tg_op = 'UPDATE'"), body.indexOf("tg_op = 'DELETE'"));
  assert.match(updateBranch, /old\.id = auth\.uid\(\) and \(new\.role <> 'admin' or new\.status <> 'active'\)/);
  assert.match(updateBranch, /Admin tidak dapat menonaktifkan atau menurunkan role akunnya sendiri\./);
  assert.match(updateBranch, /pg_advisory_xact_lock\(20261118, 1\)/);
  assert.match(migrationSql,
    /create trigger trg_prevent_admin_lockout\s+before update or delete on public\.profiles/);
});

/* ============================================================
   §5 Riwayat aset & target
   ============================================================ */

test('3.2 §5: tabel riwayat aset & target dibuat dengan kolom dan sumber yang benar', () => {
  assert.match(migrationSql, /create table if not exists public\.asset_value_history/);
  for (const col of ['user_id', 'asset_id', 'asset_name', 'source',
    'old_quantity', 'new_quantity', 'old_buy_price', 'new_buy_price',
    'old_value', 'new_value', 'wallet_id', 'created_at']) {
    assert.ok(migrationSql.includes(col), `asset_value_history harus punya kolom ${col}`);
  }
  assert.match(migrationSql, /check \(source in \('purchase', 'top_up', 'liquidate', 'price_refresh', 'manual', 'goal'\)\)/);
  assert.match(migrationSql, /create table if not exists public\.financial_goal_history/);
  for (const col of ['goal_id', 'goal_name', 'old_target_amount', 'new_target_amount',
    'old_current_amount', 'new_current_amount', 'source', 'actor']) {
    assert.ok(migrationSql.includes(col), `financial_goal_history harus punya kolom ${col}`);
  }
  assert.match(migrationSql, /check \(source in \('goal', 'manual'\)\)/);
  // asset_id / goal_id tanpa FK: riwayat bertahan saat sumber dihapus.
  assert.match(migrationSql, /asset_id\s+uuid,/);
  assert.match(migrationSql, /goal_id\s+uuid,/);
  assert.doesNotMatch(migrationSql, /asset_id\s+uuid references/);
  assert.doesNotMatch(migrationSql, /goal_id\s+uuid references/);
});

test('3.2 §5: trigger riwayat di assets (INSERT/UPDATE/DELETE) dan financial_goals (UPDATE/DELETE)', () => {
  assert.match(migrationSql,
    /create trigger trg_asset_value_history\s+after insert or update or delete on public\.assets/);
  assert.match(migrationSql,
    /create trigger trg_financial_goal_history\s+after update or delete on public\.financial_goals/);
  const assetTrigger = fnBody(migrationSql, 'record_asset_value_change');
  assert.match(assetTrigger, /security definer/);
  assert.match(assetTrigger, /insert into public\.asset_value_history/);
  assert.match(assetTrigger, /app\.asset_history_skip/);
  assert.match(assetTrigger, /is not distinct from new\.quantity/);
  const goalTrigger = fnBody(migrationSql, 'record_financial_goal_change');
  assert.match(goalTrigger, /security definer/);
  assert.match(goalTrigger, /insert into public\.financial_goal_history/);
  assert.match(goalTrigger, /app\.goal_history_skip/);
  // Riwayat append-only untuk klien: ada SELECT+INSERT, tanpa UPDATE/DELETE policy.
  assert.match(migrationSql, /create policy "users_read_own_asset_history" on public\.asset_value_history\s+for select to authenticated/);
  assert.match(migrationSql, /create policy "users_insert_own_asset_history" on public\.asset_value_history\s+for insert to authenticated/);
  assert.match(migrationSql, /create policy "users_read_own_goal_history" on public\.financial_goal_history\s+for select to authenticated/);
  assert.match(migrationSql, /create policy "users_insert_own_goal_history" on public\.financial_goal_history\s+for insert to authenticated/);
  const historyPolicies = migrationSql.match(/create policy "users_[a-z_]*" on public\.(asset_value_history|financial_goal_history)[\s\S]*?;/g) || [];
  for (const p of historyPolicies) {
    assert.doesNotMatch(p, /for update|for delete/, 'riwayat tidak boleh punya policy UPDATE/DELETE');
  }
});

test('3.2 §5: top_up / liquidate / contribute SELALU mencatat jejak (bukan hanya bila wallet ada)', () => {
  for (const [fn, table, source] of [
    ['top_up_asset', 'asset_value_history', 'top_up'],
    ['liquidate_asset', 'asset_value_history', 'liquidate'],
    ['contribute_to_goal', 'financial_goal_history', 'goal'],
  ]) {
    const body = fnBody(migrationSql, fn);
    const insertIdx = body.indexOf(`insert into public.${table}`);
    assert.notEqual(insertIdx, -1, `${fn} harus menyisipkan baris ${table}`);
    assert.ok(body.includes(`'${source}'`), `${fn} harus mencatat source '${source}'`);
    // Jejak dicatat SEBELUM blok wallet — jadi tidak tergantung wallet.
    const walletGuardIdx = body.indexOf('if p_wallet_id is not null then');
    assert.ok(walletGuardIdx !== -1, `${fn} tetap punya blok wallet untuk transfers/transactions`);
    assert.ok(insertIdx < walletGuardIdx,
      `${fn}: jejak (${table}) harus dicatat sebelum blok wallet, bukan di dalamnya`);
    // Trigger di-skip supaya tidak ganda.
    assert.match(body, /set_config\('app\.(asset|goal)_history_skip', '1', true\)/);
  }
  // create_asset mencatat jejak 'purchase'.
  const createBody = fnBody(migrationSql, 'create_asset_with_expense');
  assert.match(createBody, /insert into public\.asset_value_history/);
  assert.match(createBody, /'purchase'/);
});

test('3.2 §5: baris transfers/transactions tetap butuh wallet (hanya jejak yang tanpa syarat)', () => {
  const topUp = fnBody(migrationSql, 'top_up_asset');
  assert.match(topUp, /if p_wallet_id is not null then[\s\S]*insert into public\.transfers/);
  const liquidate = fnBody(migrationSql, 'liquidate_asset');
  assert.match(liquidate, /if p_wallet_id is not null then[\s\S]*insert into public\.transactions as inserted_tx/);
  const contribute = fnBody(migrationSql, 'contribute_to_goal');
  assert.match(contribute, /if p_wallet_id is not null then[\s\S]*insert into public\.transactions/);
});

/* ============================================================
   §6 Guard negatif + CHECK aset + cap nominal
   ============================================================ */

test('3.2 §6: create_asset_with_expense menolak quantity/buy_price negatif di depan (semua tipe)', () => {
  const body = fnBody(migrationSql, 'create_asset_with_expense');
  const guardIdx = body.indexOf('p_quantity is not null and p_quantity < 0');
  assert.notEqual(guardIdx, -1, 'guard negatif harus ada');
  assert.ok(body.includes('p_buy_price is not null and p_buy_price < 0'), 'guard harus mencakup buy_price');
  assert.ok(body.includes('Quantity dan harga beli aset tidak boleh negatif.'), 'pesan guard harus jelas');
  // Guard harus SEBELUM cabang per tipe.
  const cryptoIdx = body.indexOf("if type_lower = 'crypto' then");
  assert.ok(guardIdx < cryptoIdx, 'guard harus di depan cabang per tipe');
  // Syarat <= 0 per cabang tetap dipertahankan.
  assert.match(body, /Crypto symbol, quantity, and purchase price are required/);
  assert.match(body, /Unit quantity and purchase amount are required/);
});

test('3.2 §6: liquidate_asset menolak p_quantity negatif', () => {
  const body = fnBody(migrationSql, 'liquidate_asset');
  assert.match(body, /if p_quantity is not null and p_quantity < 0 then/);
  assert.match(body, /Quantity pencairan tidak boleh negatif\./);
});

test('3.2 §6: CHECK non-negatif di assets dengan pra-cek yang gagal keras', () => {
  assert.match(migrationSql, /where quantity < 0 or buy_price < 0 or value < 0/);
  assert.match(migrationSql, /Wave 3\.2 dibatalkan: % baris di public\.assets punya quantity\/buy_price\/value negatif/);
  assert.match(migrationSql, /add constraint assets_nonnegative check \(quantity >= 0 and buy_price >= 0 and value >= 0\)/);
});

test('3.2 §6: cap nominal 999999999999.99 di transactions & transfers (defense in depth)', () => {
  for (const table of ['transactions', 'transfers']) {
    assert.ok(migrationSql.includes(`add constraint ${table}_nominal_capped`),
      `constraint cap harus ada di ${table}`);
  }
  assert.match(migrationSql, /check \(nominal > 0 and nominal <= 999999999999\.99\)/);
  assert.match(migrationSql, /from public\.transactions\s+where nominal <= 0 or nominal > 999999999999\.99/);
  assert.match(migrationSql, /from public\.transfers\s+where nominal <= 0 or nominal > 999999999999\.99/);
  assert.match(migrationSql, /Wave 3\.2 dibatalkan: % baris di public\.transactions/);
  assert.match(migrationSql, /Wave 3\.2 dibatalkan: % baris di public\.transfers/);
});

/* ============================================================
   Penjaga regresi Wave 1 + integritas migrasi
   ============================================================ */

test('3.2: migrasi Wave 1 tidak diubah (hardening admin tetap berlaku)', () => {
  assert.match(wave1Mig, /handle_new_user/);
  assert.match(wave1Mig, /revoke update on public\.profiles from authenticated/i);
});

test('3.2: migrasi baru satu transaksi, tanpa sentuhan file lain', () => {
  assert.match(migrationSql, /^begin;/m);
  assert.match(migrationSql, /^commit;/m);
  assert.doesNotMatch(migrationSql, /config\.js/);
});
