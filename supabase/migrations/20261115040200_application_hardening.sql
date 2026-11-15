begin;

create or replace function public.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

revoke all on function public.is_active_user() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_active_user() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'settings', 'categories', 'entities', 'transactions', 'assets',
    'budgets', 'portfolio_snapshots', 'recurring', 'telegram_chats',
    'wallets', 'transfers'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop policy if exists "own rows" on public.%I', table_name);
      execute format(
        'create policy "own rows" on public.%I for all to authenticated
           using (user_id = auth.uid() and public.is_active_user())
           with check (user_id = auth.uid() and public.is_active_user())',
        table_name
      );
    end if;
  end loop;
end $$;

drop policy if exists "users_manage_own_pairings" on public.telegram_pairings;
create policy "users_manage_own_pairings" on public.telegram_pairings
  for all to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());

create table public.telegram_pairing_attempts (
  chat_id bigint primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

alter table public.telegram_pairing_attempts enable row level security;
revoke all on public.telegram_pairing_attempts from public, anon, authenticated;

create or replace function public.consume_telegram_pairing_attempt(p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_count integer;
begin
  if p_chat_id is null then
    raise exception 'chat_id is required';
  end if;

  insert into public.telegram_pairing_attempts as current_attempts
    (chat_id, window_started_at, attempts)
  values (p_chat_id, now(), 1)
  on conflict (chat_id) do update
    set window_started_at = case
          when current_attempts.window_started_at <= now() - interval '10 minutes'
            then now()
          else current_attempts.window_started_at
        end,
        attempts = case
          when current_attempts.window_started_at <= now() - interval '10 minutes'
            then 1
          else current_attempts.attempts + 1
        end
  returning attempts into attempt_count;

  return attempt_count <= 5;
end;
$$;

revoke all on function public.consume_telegram_pairing_attempt(bigint) from public, anon, authenticated;
grant execute on function public.consume_telegram_pairing_attempt(bigint) to service_role;

create or replace function public.replace_telegram_pairing(p_otp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  perform 1
    from public.profiles
   where id = auth.uid() and status = 'active'
   for update;
  if not found then
    raise exception 'Active account required';
  end if;
  if p_otp is null or p_otp !~ '^[0-9]{8}$' then
    raise exception 'Invalid pairing code';
  end if;

  delete from public.telegram_pairings
   where user_id = auth.uid();

  insert into public.telegram_pairings (otp, user_id, expires_at)
  values (p_otp, auth.uid(), now() + interval '10 minutes');
end;
$$;

revoke all on function public.replace_telegram_pairing(text) from public, anon;
grant execute on function public.replace_telegram_pairing(text) to authenticated;

create or replace function public.rename_entity_with_transactions(
  p_group text,
  p_old_name text,
  p_new_name text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_group not in ('UtangApp', 'UtangPerson', 'Piutang')
      or nullif(btrim(p_new_name), '') is null then
    raise exception 'Invalid entity name';
  end if;

  update public.entities
     set name = btrim(p_new_name)
   where user_id = auth.uid()
     and grp = p_group
     and name = p_old_name;

  if not found then
    raise exception 'Entity not found';
  end if;

  update public.transactions
     set kategori = p_group || ' - ' || btrim(p_new_name)
   where user_id = auth.uid()
     and kategori = p_group || ' - ' || p_old_name;
end;
$$;

create or replace function public.top_up_asset(
  p_asset_id uuid,
  p_amount numeric,
  p_price numeric default null,
  p_quantity numeric default null,
  p_wallet_id uuid default null,
  p_date date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  asset_row public.assets%rowtype;
  unit_price numeric;
  added_quantity numeric;
  new_quantity numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_amount is null or p_amount <= 0
      or (p_price is not null and p_price < 0)
      or (p_quantity is not null and p_quantity < 0) then
    raise exception 'Invalid top-up amount, price, or quantity';
  end if;

  select *
    into asset_row
    from public.assets
   where id = p_asset_id and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Asset not found';
  end if;

  if lower(asset_row.type) = 'crypto' then
    unit_price := coalesce(
      nullif(p_price, 0),
      case
        when asset_row.quantity > 0 and asset_row.value > 0
          then asset_row.value / asset_row.quantity
        else 0
      end
    );
    added_quantity := coalesce(
      nullif(p_quantity, 0),
      case when unit_price > 0 then p_amount / unit_price else 0 end
    );
    if added_quantity <= 0 then
      raise exception 'Crypto price or quantity is required';
    end if;

    new_quantity := asset_row.quantity + added_quantity;
    update public.assets
       set quantity = new_quantity,
           value = round(asset_row.value + p_amount),
           buy_price = case
             when asset_row.quantity = 0 then round(p_amount / added_quantity)
             when asset_row.buy_price > 0
               then round((asset_row.quantity * asset_row.buy_price + p_amount) / new_quantity)
             else 0
           end
     where id = p_asset_id and user_id = auth.uid();
  else
    update public.assets
       set value = round(asset_row.value + p_amount)
     where id = p_asset_id and user_id = auth.uid();
  end if;

  if p_wallet_id is not null then
    perform 1
      from public.wallets
     where id = p_wallet_id and user_id = auth.uid()
     for key share;
    if not found then
      raise exception 'Wallet not found';
    end if;

    insert into public.transfers
      (user_id, tanggal, kind, from_wallet, to_wallet, nominal, keterangan)
    values
      (auth.uid(), coalesce(p_date, current_date), 'investasi', p_wallet_id, null, p_amount,
       'Top-up ' || asset_row.name);
  end if;
end;
$$;

revoke all on function public.rename_entity_with_transactions(text, text, text) from public, anon;
revoke all on function public.top_up_asset(uuid, numeric, numeric, numeric, uuid, date) from public, anon;
grant execute on function public.rename_entity_with_transactions(text, text, text) to authenticated;
grant execute on function public.top_up_asset(uuid, numeric, numeric, numeric, uuid, date) to authenticated;

alter table public.transactions
  add constraint transactions_nominal_positive check (nominal > 0) not valid;

commit;
