-- ============================================================
-- Jadwal otomatis (pengganti trigger Apps Script)
-- Prasyarat:
--   1) Dashboard → Database → Extensions: aktifkan pg_cron, pg_net,
--      dan Vault (supabase_vault)
--   2) Secret CRON_SECRET sudah diisi di Edge Functions (string acak
--      >= 32 karakter) DAN disimpan di Vault dengan nama 'cron_secret':
--        select vault.create_secret('<NILAI_CRON_SECRET_BARU>', 'cron_secret');
--      (ganti placeholder dengan nilai sebenarnya — nilai itu HANYA
--      diketik di SQL Editor, TIDAK PERNAH ditulis di file ini atau
--      di-commit ke repo. Bila secret 'cron_secret' sudah ada, pakai
--      vault.update_secret, bukan create_secret — lihat
--      supabase/README.md bagian "Rotasi CRON_SECRET".)
--   3) Ganti <PROJECT_REF> di bawah sebelum menjalankan di SQL Editor.
--
-- KEAMANAN (Gelombang 2.3, T9): nilai CRON_SECRET TIDAK LAGI tertulis
-- di definisi job. Setiap job membaca secret dari Supabase Vault pada
-- saat dipicu, memakai pola resmi Supabase ("Scheduling Edge Functions",
-- supabase.com/docs/guides/functions/schedule-functions):
--   (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
-- sehingga `cron.job` tidak lagi menyimpan secret dalam teks biasa.
--
-- BATASAN YANG MASIH ADA (jujur, sesuai dokumentasi Supabase yang
-- sama): pg_net menulis request — termasuk header yang sudah
-- didekripsi — ke antrean `net.http_request_queue` sampai request
-- terkirim, jadi role database yang bisa membaca antrean itu masih
-- bisa melihat secret selama request menunggu. Vault menutup
-- kebocoran lewat `cron.job` (yang bisa dibaca siapa pun yang punya
-- akses baca tabel itu dan tersimpan permanen), tetapi bukan
-- pengganti pembatasan akses database itu sendiri: hanya operator
-- tepercaya yang boleh punya akses SQL langsung ke project ini.
-- Karena itu CRON_SECRET tetap harus dirotasi bila ada yang
-- mencurigakan — prosedurnya ada di supabase/README.md.
--
-- Semua jam dalam UTC. WIB = UTC+7:
--   daily     21:00 WIB = 14:00 UTC     weekly   Minggu 20:00 WIB = 13:00 UTC
--   recurring 01:00 WIB = 18:00 UTC     snapshot 23:00 WIB = 16:00 UTC
--   cleanup   02:00 WIB = 19:00 UTC
-- Jadwal (ekspresi cron) TIDAK berubah dari sebelumnya.
-- ============================================================

-- Hapus jadwal lama dulu (bila ada) supaya jadwal baru yang memakai
-- Vault menggantikannya dengan bersih. Menghapus jadwal yang belum
-- ada tidak error (mengembalikan false).
select cron.unschedule('mk-daily-reminder');
select cron.unschedule('mk-weekly-report');
select cron.unschedule('mk-recurring');
select cron.unschedule('mk-snapshot');
select cron.unschedule('mk-account-cleanup');

select cron.schedule('mk-daily-reminder', '0 14 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('job', 'daily'),
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('mk-weekly-report', '0 13 * * 0', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('job', 'weekly'),
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('mk-recurring', '0 18 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('job', 'recurring'),
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('mk-snapshot', '0 16 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('job', 'snapshot'),
    timeout_milliseconds := 30000
  );
$$);

-- Hapus otomatis akun dormant (fitur admin "last change"): harian
-- 02:00 WIB = 19:00 UTC. Memanggil edge function account-cleanup
-- (verify_jwt=false, autentikasi lewat x-cron-secret dari Vault —
-- pola yang sama dengan 4 job di atas). Timeout 60 detik karena satu
-- run bisa membuat banyak notifikasi admin dan menghapus banyak akun.
select cron.schedule('mk-account-cleanup', '0 19 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/account-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('job', 'account-cleanup'),
    timeout_milliseconds := 60000
  );
$$);

-- Cek jadwal:      select jobid, jobname, schedule from cron.job;
-- Cek hasil run:   select * from cron.job_run_details order by start_time desc limit 10;
-- Cek log job:     select * from cron_job_runs order by started_at desc limit 5;
-- Cek respons HTTP: select id, status_code, content from net._http_response order by created desc limit 10;
-- Hapus jadwal:    select cron.unschedule('mk-daily-reminder');
