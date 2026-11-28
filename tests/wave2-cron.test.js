const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Gelombang 2.3 (T9): batas per-run recurring + log pemanggilan cron +
// CRON_SECRET lewat Vault. jobs.ts adalah Deno/TypeScript (Deno.env,
// import npm:) sehingga tidak bisa dieksekusi node --test; mengikuti
// gaya guard-test repo (tests/wave-v320-upgrades.test.js,
// tests/pro-web-ui.test.js), tes ini mengeksekusi assertion terhadap
// isi file aslinya, bukan terhadap fixture buatan tes sendiri.

const jobsTs = fs.readFileSync('supabase/functions/telegram-bot/jobs.ts', 'utf8');
const scheduleSql = fs.readFileSync('supabase/schedule.sql', 'utf8');
const migrationSql = fs.readFileSync('supabase/migrations/20261128010000_wave2_cron_job_runs.sql', 'utf8');
const readme = fs.readFileSync('supabase/README.md', 'utf8');

test('2.3 cron: runRecurring dibatasi per-run dan sisa baris dihitung sebagai skipped', () => {
  // Konstanta batas bernama, dengan nilai 200.
  assert.match(jobsTs, /const MAX_RECURRING_CREATED_PER_RUN = 200;/);

  // Loop berhenti membuat transaksi saat batas tercapai, dengan
  // kondisi yang merujuk konstanta itu.
  assert.match(jobsTs, /if \(created >= MAX_RECURRING_CREATED_PER_RUN\) \{ skipped\+\+; continue; \}/);

  // Pengecekan batas HARUS terjadi sebelum klaim last_run, supaya
  // baris yang dilewati tidak diklaim dan diambil run berikutnya.
  const capIdx = jobsTs.indexOf('if (created >= MAX_RECURRING_CREATED_PER_RUN)');
  const claimIdx = jobsTs.indexOf("update({ last_run: t })");
  assert.ok(capIdx > 0 && claimIdx > 0, 'cap check dan claim last_run harus ada');
  assert.ok(capIdx < claimIdx, 'cek batas harus mendahului update last_run (klaim)');

  // Hasil run mengembalikan created DAN skipped.
  assert.match(jobsTs, /return \{ created, skipped, notified: byUser\.size \};/);
  assert.match(jobsTs, /let skipped = 0;/);
});

test('2.3 cron: handleJob mencatat setiap pemanggilan ke cron_job_runs tanpa bisa merusak job', () => {
  // Insert saat mulai (status 'running') dan update saat selesai.
  assert.match(jobsTs, /sb\.from\('cron_job_runs'\)\.insert\(/);
  assert.match(jobsTs, /job, invoked_by: invokedBy, started_at: .*?, status: 'running'/);
  assert.match(jobsTs, /sb\.from\('cron_job_runs'\)\.update\(/);
  assert.match(jobsTs, /finished_at: .*?, status,/);
  assert.match(jobsTs, /created_count: counts\.created/);
  assert.match(jobsTs, /notified_count: counts\.notified/);
  assert.match(jobsTs, /skipped_count: counts\.skipped/);

  // handleJob memakai helper log di awal dan di akhir (sukses, job
  // tidak dikenal, maupun exception).
  assert.match(jobsTs, /const runId = await logJobRunStart\(job, invokedBy\);/);
  assert.match(jobsTs, /await logJobRunFinish\(runId, 'ok', counts\);/);
  assert.match(jobsTs, /await logJobRunFinish\(runId, 'error', \{\}, `unknown job: \$\{job\}`\);/);
  assert.match(jobsTs, /await logJobRunFinish\(runId, 'error', \{\}, msg\);/);

  // Logging tidak pernah melempar ke job: helper dibungkus try/catch
  // dan gagalnya hanya masuk console.error.
  const startFn = jobsTs.slice(jobsTs.indexOf('async function logJobRunStart'));
  assert.match(startFn, /try \{[\s\S]*?catch \(e\) \{[\s\S]*?console\.error\('cron_job_runs insert'/);
  const finishFn = jobsTs.slice(jobsTs.indexOf('async function logJobRunFinish'));
  assert.match(finishFn, /try \{[\s\S]*?catch \(e\) \{[\s\S]*?console\.error\('cron_job_runs update'/);

  // Respons JSON membawa hitungan + run_id, dengan field lama tetap ada.
  assert.match(jobsTs, /return json\(req, \{ \.\.\.result, \.\.\.counts, run_id: runId \}\);/);

  // Yang TIDAK boleh berubah: autentikasi CRON_SECRET tetap
  // perbandingan constant-time, dan jalur refresh_prices pengguna tetap ada.
  assert.match(jobsTs, /await safeEqual\(req\.headers\.get\('x-cron-secret'\) \?\? '', CRON_SECRET\)/);
  assert.match(jobsTs, /if \(!uid \|\| job !== 'refresh_prices' \|\| !await isActiveUser\(uid\)\) return json\(req, \{ error: 'forbidden' \}, 403\);/);
  assert.match(jobsTs, /if \(job === 'refresh_prices' && uid\)/);
});

test('2.3 cron: schedule.sql tidak lagi menyimpan secret teks-biasa; header dibaca dari Vault', () => {
  // Tidak ada placeholder secret lama, dalam bentuk apa pun.
  assert.doesNotMatch(scheduleSql, /<CRON_SECRET_MIN_32_CHARS>/);
  assert.doesNotMatch(scheduleSql, /CRON_SECRET_ANDA/);
  // Header x-cron-secret TIDAK BOLEH berisi literal string — nilainya
  // harus subquery Vault. (Satu-satunya kemunculan 'x-cron-secret'
  // yang diizinkan adalah yang diikuti subquery decrypted_secret.)
  const headerUses = [...scheduleSql.matchAll(/'x-cron-secret', \(select decrypted_secret from vault\.decrypted_secrets where name = 'cron_secret'\)/g)];
  assert.equal(headerUses.length, 5, 'kelima job (4 lama + mk-account-cleanup) harus mengirim header x-cron-secret dari Vault');
  assert.match(scheduleSql, /vault\.decrypted_secrets/);
  assert.match(scheduleSql, /name = 'cron_secret'/);

  // Jadwal (ekspresi cron) tidak berubah.
  assert.match(scheduleSql, /cron\.schedule\('mk-daily-reminder', '0 14 \* \* \*'/);
  assert.match(scheduleSql, /cron\.schedule\('mk-weekly-report', '0 13 \* \* 0'/);
  assert.match(scheduleSql, /cron\.schedule\('mk-recurring', '0 18 \* \* \*'/);
  assert.match(scheduleSql, /cron\.schedule\('mk-snapshot', '0 16 \* \* \*'/);

  // Jadwal lama di-unschedule dulu sebelum dibuat ulang.
  for (const name of ['mk-daily-reminder', 'mk-weekly-report', 'mk-recurring', 'mk-snapshot']) {
    assert.ok(scheduleSql.includes(`cron.unschedule('${name}')`), `schedule.sql harus meng-unschedule ${name}`);
  }
});

test('2.3 cron: migrasi membuat tabel cron_job_runs dengan kolom dan penguncian yang benar', () => {
  assert.match(migrationSql, /create table if not exists public\.cron_job_runs \(/);
  assert.match(migrationSql, /id\s+uuid primary key default gen_random_uuid\(\)/);
  assert.match(migrationSql, /job\s+text not null/);
  assert.match(migrationSql, /invoked_by\s+text not null default 'cron'/);
  assert.match(migrationSql, /started_at\s+timestamptz not null default now\(\)/);
  assert.match(migrationSql, /finished_at\s+timestamptz/);
  assert.match(migrationSql, /status\s+text not null default 'running'/);
  assert.match(migrationSql, /created_count\s+integer not null default 0/);
  assert.match(migrationSql, /notified_count\s+integer not null default 0/);
  assert.match(migrationSql, /skipped_count\s+integer not null default 0/);
  assert.match(migrationSql, /error\s+text/);

  // Nilai status dan invoked_by dibatasi.
  assert.match(migrationSql, /check \(status in \('running', 'ok', 'error'\)\)/);
  assert.match(migrationSql, /check \(invoked_by in \('cron', 'user'\)\)/);

  // RLS aktif; anon/authenticated dicabut; hanya service_role.
  assert.match(migrationSql, /alter table public\.cron_job_runs enable row level security;/);
  assert.match(migrationSql, /revoke all on public\.cron_job_runs from anon, authenticated;/);
  assert.match(migrationSql, /grant all on public\.cron_job_runs to service_role;/);

  // Migrasi idempotent: semua pernyataan memakai IF NOT EXISTS / DO block.
  assert.match(migrationSql, /create index if not exists cron_job_runs_started_at_idx/);
  assert.doesNotMatch(migrationSql, /create table public\.cron_job_runs \(/);
});

test('2.3 cron: README memuat prosedur rotasi CRON_SECRET yang lengkap', () => {
  // (a) secret baru >= 32 karakter.
  assert.match(readme, /openssl rand -hex 32/);
  assert.match(readme, />= 32 karakter/);
  // (b) simpan di Vault: create pertama kali, update sesudahnya.
  assert.match(readme, /vault\.create_secret\('<NILAI_CRON_SECRET_BARU>', 'cron_secret'\)/);
  assert.match(readme, /vault\.update_secret\(\(select id from vault\.secrets where name = 'cron_secret'\), '<NILAI_CRON_SECRET_BARU>'\)/);
  // (c) nilai yang sama sebagai secret edge function.
  assert.match(readme, /supabase secrets set CRON_SECRET=<NILAI_CRON_SECRET_BARU>/);
  assert.match(readme, /handleJob/);
  // (d) unschedule keempat job lama.
  for (const name of ['mk-daily-reminder', 'mk-weekly-report', 'mk-recurring', 'mk-snapshot']) {
    assert.ok(readme.includes(`cron.unschedule('${name}')`), `README harus menyebut unschedule ${name}`);
  }
  // (e) kueri verifikasi log run.
  assert.match(readme, /select \* from cron_job_runs order by started_at desc limit 5;/);
  // Tidak ada nilai secret asli di README — hanya placeholder.
  assert.doesNotMatch(readme, /CRON_SECRET_MIN_32_CHARS/);
  assert.doesNotMatch(readme, /CRON_SECRET_ANDA/);
});
