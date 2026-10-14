-- ============================================================
-- Jadwal otomatis (pengganti trigger Apps Script)
-- Prasyarat:
--   1) Dashboard → Database → Extensions: aktifkan pg_cron dan pg_net
--   2) Secret CRON_SECRET sudah diisi di Edge Functions (string acak panjang)
-- Ganti usauytablxbiktnepwsi dan 27 di bawah (4 tempat tiap-tiapnya).
-- Semua jam dalam UTC. WIB = UTC+7:
--   daily     21:00 WIB = 14:00 UTC     weekly   Minggu 20:00 WIB = 13:00 UTC
--   recurring 01:00 WIB = 18:00 UTC     snapshot 23:00 WIB = 16:00 UTC
-- ============================================================

select cron.schedule('mk-daily-reminder', '0 14 * * *', $$
  select net.http_post(
    url := 'https://usauytablxbiktnepwsi.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '27'),
    body := jsonb_build_object('job', 'daily'),
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('mk-weekly-report', '0 13 * * 0', $$
  select net.http_post(
    url := 'https://usauytablxbiktnepwsi.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '27'),
    body := jsonb_build_object('job', 'weekly'),
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('mk-recurring', '0 18 * * *', $$
  select net.http_post(
    url := 'https://usauytablxbiktnepwsi.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '27'),
    body := jsonb_build_object('job', 'recurring'),
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('mk-snapshot', '0 16 * * *', $$
  select net.http_post(
    url := 'https://usauytablxbiktnepwsi.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '27'),
    body := jsonb_build_object('job', 'snapshot'),
    timeout_milliseconds := 30000
  );
$$);

-- Cek jadwal:      select jobid, jobname, schedule from cron.job;
-- Cek hasil run:   select * from cron.job_run_details order by start_time desc limit 10;
-- Cek respons HTTP: select id, status_code, content from net._http_response order by created desc limit 10;
-- Hapus jadwal:    select cron.unschedule('mk-daily-reminder');
