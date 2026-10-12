-- Tahap 3b: izinkan kind 'lock' (anti-spam /insight, 30 detik)
alter table public.telegram_pending drop constraint if exists telegram_pending_kind_check;
alter table public.telegram_pending
  add constraint telegram_pending_kind_check check (kind in ('pending', 'undo', 'lock'));
