const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Gelombang 4 — Hardening rendah (R1–R22).
// Gaya tes mengikuti repo: asersi statis atas SQL/workflow/dokumen untuk
// hal yang tidak bisa dieksekusi tanpa Postgres/Deno, plus eksekusi nyata
// lewat vm untuk logika JS (lihat bagian bawah file). Semua fixture ada
// di dalam repo dan ter-commit (pelajaran Gelombang 3: tidak ada file
// di luar repo, tidak ada ketergantungan pada web/vendor/ di mesin dev).

const MIG4 = 'supabase/migrations/20261128080000_wave4_low_hardening.sql';
const mig4 = fs.readFileSync(MIG4, 'utf8');
const schemaSql = fs.readFileSync('db/schema.sql', 'utf8');
const gitignore = fs.readFileSync('.gitignore', 'utf8');
const deployYml = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const androidYml = fs.readFileSync('.github/workflows/android-build.yml', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const playstoreGuide = fs.readFileSync('docs/ANDROID_PLAYSTORE_GUIDE.md', 'utf8');
const scheduleSql = fs.readFileSync('supabase/schedule.sql', 'utf8');
const webauthnDraft = fs.readFileSync('supabase/migrations/20261128070000_wave3_webauthn.sql', 'utf8');

/* ============================================================
   4.1 Database & skrip — migrasi Wave 4
   ============================================================ */

test('4.1 migrasi Wave 4: satu transaksi, idempotent, tidak menyentuh WebAuthn', () => {
  assert.match(mig4, /^\s*begin;/m, 'migrasi harus dibuka begin;');
  assert.match(mig4, /commit;\s*$/m, 'migrasi harus ditutup commit;');
  assert.doesNotMatch(mig4, /webauthn_credentials|webauthn_challenges|create or replace function public\.webauthn/i, 'migrasi Wave 4 tidak boleh mengubah objek WebAuthn (header boleh menyebut nomornya sebagai penanda urutan)');
  // Semua ADD CONSTRAINT dijaga keberadaannya (idempotent).
  for (const name of [
    'recurring_nominal_nonnegative', 'budgets_jumlah_nonnegative',
    'wallets_opening_balance_nonnegative', 'asset_value_history_nonnegative',
    'financial_goal_history_nonnegative', 'settings_payrollday_valid'
  ]) {
    assert.match(mig4, new RegExp(`conname = '${name}'`), `penjaga idempotency untuk ${name} hilang`);
  }
});

test('4.1 migrasi Wave 4: CHECK nominal negatif + payrollDay (NOT VALID)', () => {
  assert.match(mig4, /recurring_nominal_nonnegative check \(nominal >= 0\) not valid/);
  assert.match(mig4, /budgets_jumlah_nonnegative check \(jumlah >= 0\) not valid/);
  assert.match(mig4, /wallets_opening_balance_nonnegative check \(opening_balance >= 0\) not valid/);
  assert.match(mig4, /asset_value_history_nonnegative check \(/);
  assert.match(mig4, /financial_goal_history_nonnegative check \(/);
  // payrollDay: hanya bila key = 'payrollDay'; '' (default) diizinkan; 1..31.
  assert.match(mig4, /settings_payrollday_valid check \(\s*key <> 'payrollDay' or value = '' or value ~ '\^\(\[1-9\]\|\[12\]\[0-9\]\|3\[01\]\)\$'/);
  // Baris lama dilaporkan, bukan digagalkan (NOT VALID + RAISE NOTICE).
  assert.match(mig4, /raise notice 'Wave 4 §2/);
  // Yang sudah punya CHECK di Gelombang 3 tidak disentuh lagi.
  assert.doesNotMatch(mig4, /transactions_nominal_capped|transfers_nominal_capped|assets_nonnegative/);
});

test('4.1 migrasi Wave 4: cycle_for_date dicabut dari PUBLIC + search_path dipin', () => {
  assert.match(mig4, /revoke all on function public\.cycle_for_date\(date, int\) from public;/);
  assert.match(mig4, /grant execute on function public\.cycle_for_date\(date, int\) to authenticated;/);
  assert.match(mig4, /alter function public\.cycle_for_date\(date, int\) set search_path = public;/);
  // Bertahan bila fungsi belum ada (database dari migrasi saja).
  assert.match(mig4, /to_regproc\('public\.cycle_for_date\(date, int\)'\) is not null/);
});

test('4.1 migrasi WebAuthn 070000 tetap DRAF dan tidak diubah Gelombang 4', () => {
  assert.match(webauthnDraft, /DRAFT — BELUM DIVERIFIKASI, JANGAN DEPLOY DULU/);
  assert.match(webauthnDraft, /BELUM pernah dijalankan/);
});

/* ============================================================
   4.1 Database & skrip — db/schema.sql tidak menimpa hardening
   ============================================================ */

test('4.1 schema.sql: penjaga tolak jalankan ulang di database bermigrasi', () => {
  assert.match(schemaSql, /JANGAN dijalankan ulang di database yang sudah dimigrasi/);
  assert.match(schemaSql, /to_regproc\('public\.is_admin\(\)'\) is not null/);
  assert.match(schemaSql, /to_regclass\('public\.admin_audit_logs'\) is not null/);
  assert.match(schemaSql, /raise exception 'schema\.sql adalah bootstrap v1/);
});

test('4.1 schema.sql: idempotent — IF NOT EXISTS + DROP POLICY IF EXISTS', () => {
  const creates = [...schemaSql.matchAll(/^create table if not exists public\./gm)];
  assert.ok(creates.length >= 9, `harapkan >= 9 CREATE TABLE, dapat ${creates.length}`);
  assert.doesNotMatch(schemaSql, /^create table public\./m, 'masih ada CREATE TABLE tanpa IF NOT EXISTS');
  assert.doesNotMatch(schemaSql, /^create index \S+ +on/m, 'masih ada CREATE INDEX tanpa IF NOT EXISTS');
  assert.match(schemaSql, /drop policy if exists "own rows" on public\.%I/);
});

test('4.1 schema.sql: cycle_for_date dipin search_path + revoke PUBLIC', () => {
  assert.match(schemaSql, /create or replace function public\.cycle_for_date\(d date, payroll_day int\)\s*returns text\s*language sql\s*stable\s*set search_path = public/);
  assert.match(schemaSql, /revoke all on function public\.cycle_for_date\(date, int\) from public;/);
  assert.match(schemaSql, /grant execute on function public\.cycle_for_date\(date, int\) to authenticated;/);
});

/* ============================================================
   4.1 Konfigurasi & CI — Secrets, .gitignore, CRON_SECRET
   ============================================================ */

test('4.1 CI: SUPABASE_URL & SUPABASE_ANON_KEY pindah dari Variables ke Secrets', () => {
  for (const [name, yml] of [['deploy.yml', deployYml], ['android-build.yml', androidYml]]) {
    assert.doesNotMatch(yml, /vars\.SUPABASE_(URL|ANON_KEY)/, `${name} masih memakai vars.*`);
    assert.match(yml, /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/, `${name} belum memakai secrets.SUPABASE_URL`);
    assert.match(yml, /SUPABASE_ANON_KEY: \$\{\{ secrets\.SUPABASE_ANON_KEY \}\}/, `${name} belum memakai secrets.SUPABASE_ANON_KEY`);
  }
  assert.match(androidYml, /GitHub Repository Secrets SUPABASE_URL dan SUPABASE_ANON_KEY di Settings -> Secrets and variables -> Actions -> Secrets/);
  assert.doesNotMatch(androidYml, /Repository Variables SUPABASE_URL/);
  assert.match(readme, /GitHub Repository Secrets/);
  assert.match(readme, /SUPABASE_URL.*SUPABASE_ANON_KEY.*Secrets and variables → Actions → Secrets/);
  assert.match(playstoreGuide, /GitHub Repository Secrets \(`SUPABASE_URL` & `SUPABASE_ANON_KEY` di \*Settings → Secrets and variables → Actions → Secrets\*\)/);
});

test('4.1 .gitignore: kunci privat, konfigurasi layanan & paket build', () => {
  for (const pat of ['*.pem', '*.key', '*.p12', '*.cer', 'google-services.json', 'GoogleService-Info.plist', '*.apk', '*.aab']) {
    assert.ok(gitignore.split('\n').some((l) => l.trim() === pat), `.gitignore kehilangan pola ${pat}`);
  }
  // Yang sudah ada sebelumnya tetap ada (regresi).
  for (const pat of ['dist/', 'node_modules/', '.env', 'web/vendor/', '*.jks', '*.keystore']) {
    assert.ok(gitignore.includes(pat), `.gitignore kehilangan pola lama ${pat}`);
  }
});

test('4.1 CRON_SECRET: tidak ada nilai secret di teks definisi job (sudah Vault sejak Gelombang 2)', () => {
  // Setiap pemakaian x-cron-secret harus berupa SELECT Vault, bukan literal.
  const uses = [...scheduleSql.matchAll(/'x-cron-secret',\s*(\(select decrypted_secret from vault\.decrypted_secrets where name = 'cron_secret'\))/g)];
  assert.equal(uses.length, 4, `harapkan 4 job memakai Vault select, dapat ${uses.length}`);
  assert.doesNotMatch(scheduleSql, /x-cron-secret',\s*'[a-zA-Z0-9]/, 'ada nilai literal di header x-cron-secret');
  assert.match(scheduleSql, /nilai CRON_SECRET TIDAK LAGI tertulis/);
});
