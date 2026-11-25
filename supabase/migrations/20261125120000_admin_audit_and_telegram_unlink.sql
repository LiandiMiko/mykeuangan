-- ============================================================
-- Wave v3.20: Admin Audit Logs & Unlink Telegram RPC (Idempotent)
-- Jalankan di Supabase -> SQL Editor
-- ============================================================
begin;

create table if not exists public.admin_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references auth.users(id) on delete set null,
  actor_email    text not null default '',
  action         text not null,
  target_user_id uuid,
  target_email   text not null default '',
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_created_at
  on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;

drop policy if exists "admins_read_audit_logs" on public.admin_audit_logs;
create policy "admins_read_audit_logs" on public.admin_audit_logs
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins_insert_audit_logs" on public.admin_audit_logs;
create policy "admins_insert_audit_logs" on public.admin_audit_logs
  for insert to authenticated
  with check (public.is_admin() and actor_user_id = auth.uid());

create or replace function public.admin_log_action(
  p_action text,
  p_target_user_id uuid default null,
  p_target_email text default '',
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text := '';
begin
  if not public.is_admin() then
    raise exception 'Hanya admin aktif yang dapat mencatat audit log.';
  end if;
  select coalesce(email, '') into v_actor_email from public.profiles where id = v_actor_id;
  insert into public.admin_audit_logs (
    actor_user_id, actor_email, action, target_user_id, target_email, details
  ) values (
    v_actor_id, coalesce(v_actor_email, ''), left(btrim(coalesce(p_action, 'unknown')), 60),
    p_target_user_id, left(coalesce(p_target_email, ''), 160), coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.admin_unlink_user_telegram(p_target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_pairs integer := 0;
  v_email text := '';
begin
  if not public.is_admin() then
    raise exception 'Hanya admin aktif yang dapat memutus tautan Telegram.';
  end if;
  select coalesce(email, '') into v_email from public.profiles where id = p_target_user_id;
  delete from public.telegram_chats where user_id = p_target_user_id;
  get diagnostics v_deleted = row_count;
  delete from public.telegram_pairings where user_id = p_target_user_id;
  get diagnostics v_pairs = row_count;
  perform public.admin_log_action(
    'unlink_telegram', p_target_user_id, v_email,
    jsonb_build_object('chats_removed', v_deleted, 'pairings_removed', v_pairs)
  );
  return v_deleted;
end;
$$;

grant select, insert on public.admin_audit_logs to authenticated;
grant execute on function public.admin_log_action(text, uuid, text, jsonb) to authenticated;
grant execute on function public.admin_unlink_user_telegram(uuid) to authenticated;

commit;
