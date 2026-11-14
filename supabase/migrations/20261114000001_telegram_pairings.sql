-- ============================================================
-- MyKeuangan — Self-Service Telegram Bot Pairing
-- Jalankan di Supabase → SQL Editor
-- ============================================================

create table if not exists public.telegram_pairings (
  otp        text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

alter table public.telegram_pairings enable row level security;

create policy "users_manage_own_pairings" on public.telegram_pairings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
