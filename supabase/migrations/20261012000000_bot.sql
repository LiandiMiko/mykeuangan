-- Status sementara bot Telegram (pengganti CacheService Apps Script):
--   kind = 'pending' → transaksi menunggu konfirmasi (kadaluarsa 5 menit)
--   kind = 'undo'    → transaksi yang baru dihapus lewat /hapus (bisa /undo 5 menit)
-- Hanya diakses Edge Function (service role); RLS aktif tanpa policy.
create table if not exists public.telegram_pending (
  chat_id    bigint      not null,
  kind       text        not null check (kind in ('pending', 'undo')),
  payload    jsonb       not null,
  expires_at timestamptz not null,
  primary key (chat_id, kind)
);
alter table public.telegram_pending enable row level security;
