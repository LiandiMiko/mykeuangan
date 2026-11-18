begin;

-- 1. Admin self-lockout & last-admin protection
create or replace function public.prevent_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_other_admin boolean;
begin
  if tg_op = 'UPDATE' then
    if old.id = auth.uid() and (new.role <> 'admin' or new.status <> 'active') then
      raise exception 'Admin tidak dapat menonaktifkan atau menurunkan role akunnya sendiri.';
    end if;

    if old.role = 'admin' and old.status = 'active'
       and (new.role <> 'admin' or new.status <> 'active') then
      perform pg_advisory_xact_lock(20261118, 1);
      select exists (
        select 1
        from public.profiles
        where id <> old.id and role = 'admin' and status = 'active'
      ) into has_other_admin;
      if not has_other_admin then
        raise exception 'Harus ada minimal satu administrator aktif di sistem.';
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if auth.uid() is not null and old.role = 'admin' and old.status = 'active' then
      perform pg_advisory_xact_lock(20261118, 1);
      select exists (
        select 1
        from public.profiles
        where id <> old.id and role = 'admin' and status = 'active'
      ) into has_other_admin;
      if not has_other_admin then
        raise exception 'Harus ada minimal satu administrator aktif di sistem.';
      end if;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_prevent_admin_lockout on public.profiles;
create trigger trg_prevent_admin_lockout
  before update or delete on public.profiles
  for each row execute function public.prevent_admin_lockout();

-- 2. Global admin platform statistics RPC
create or replace function public.get_admin_platform_stats()
returns table (
  total_users bigint,
  active_users bigint,
  suspended_users bigint,
  total_telegram_chats bigint,
  total_transactions bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;

  return query
    select
      (select count(*) from public.profiles)::bigint as total_users,
      (select count(*) from public.profiles where status = 'active')::bigint as active_users,
      (select count(*) from public.profiles where status = 'suspended')::bigint as suspended_users,
      (select count(*) from public.telegram_chats)::bigint as total_telegram_chats,
      (select count(*) from public.transactions)::bigint as total_transactions;
end;
$$;

revoke all on function public.get_admin_platform_stats() from public, anon;
grant execute on function public.get_admin_platform_stats() to authenticated;

-- 3. Category management RPCs
create or replace function public.rename_category_with_transactions(
  p_tipe text,
  p_old_name text,
  p_new_name text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text := btrim(coalesce(p_old_name, ''));
  v_new text := btrim(coalesce(p_new_name, ''));
  v_tx_tipe text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_tipe not in ('pemasukan', 'pengeluaran') then
    raise exception 'Tipe kategori tidak valid.';
  end if;
  if v_old = '' or v_new = '' then
    raise exception 'Nama kategori wajib diisi.';
  end if;
  if char_length(v_new) > 80 then
    raise exception 'Nama kategori maksimal 80 karakter.';
  end if;
  if v_old = v_new then
    return;
  end if;

  v_tx_tipe := case when p_tipe = 'pemasukan' then 'Pemasukan' else 'Pengeluaran' end;

  insert into public.categories (user_id, tipe, name)
  values (auth.uid(), p_tipe, v_new)
  on conflict (user_id, tipe, name) do nothing;

  delete from public.categories
  where user_id = auth.uid() and tipe = p_tipe and name = v_old;

  update public.transactions
     set kategori = v_new
   where user_id = auth.uid()
     and tipe = v_tx_tipe
     and kategori = v_old;

  if p_tipe = 'pengeluaran' then
    insert into public.budgets (user_id, kategori, bulan, jumlah)
    select b.user_id, v_new, b.bulan, b.jumlah
    from public.budgets b
    where b.user_id = auth.uid() and b.kategori = v_old
    on conflict (user_id, kategori, bulan)
    do update set jumlah = public.budgets.jumlah + excluded.jumlah;

    delete from public.budgets
    where user_id = auth.uid() and kategori = v_old;
  end if;

  update public.recurring
     set kategori = v_new
   where user_id = auth.uid()
     and tipe = v_tx_tipe
     and kategori = v_old;
end;
$$;

create or replace function public.delete_category(
  p_tipe text,
  p_name text
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
  if p_tipe not in ('pemasukan', 'pengeluaran') then
    raise exception 'Tipe kategori tidak valid.';
  end if;

  delete from public.categories
  where user_id = auth.uid()
    and tipe = p_tipe
    and name = p_name;
end;
$$;

revoke all on function public.rename_category_with_transactions(text, text, text) from public, anon;
revoke all on function public.delete_category(text, text) from public, anon;
grant execute on function public.rename_category_with_transactions(text, text, text) to authenticated;
grant execute on function public.delete_category(text, text) to authenticated;

-- 4. Wallet deletion RPC (reassigns transactions safely)
create or replace function public.delete_wallet(p_wallet_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  replacement_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform 1
    from public.wallets
   where id = p_wallet_id and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'Dompet tidak ditemukan.';
  end if;

  select w.id
    into replacement_id
    from public.wallets w
   where w.user_id = auth.uid() and w.id <> p_wallet_id
   order by w.sort asc, w.name asc
   limit 1;

  if replacement_id is null then
    raise exception 'Minimal harus ada satu dompet aktif.';
  end if;

  update public.transactions
     set wallet_id = replacement_id
   where user_id = auth.uid()
     and wallet_id = p_wallet_id;

  delete from public.transfers
   where user_id = auth.uid()
     and (from_wallet = p_wallet_id or to_wallet = p_wallet_id);

  delete from public.wallets
   where id = p_wallet_id and user_id = auth.uid();
end;
$$;

revoke all on function public.delete_wallet(uuid) from public, anon;
grant execute on function public.delete_wallet(uuid) to authenticated;

-- 5. Asset liquidation / sell RPC
create or replace function public.liquidate_asset(
  p_asset_id uuid,
  p_amount numeric,
  p_quantity numeric default null,
  p_wallet_id uuid default null,
  p_date date default null
)
returns table (
  id uuid,
  tanggal date,
  tipe text,
  kategori text,
  nominal numeric,
  keterangan text,
  wallet_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  asset_row public.assets%rowtype;
  sell_amount numeric;
  sold_qty numeric := 0;
  remaining_val numeric;
  remaining_qty numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  sell_amount := round(coalesce(p_amount, 0), 2);
  if sell_amount <= 0 then
    raise exception 'Nominal pencairan harus lebih dari nol.';
  end if;

  select *
    into asset_row
    from public.assets
   where public.assets.id = p_asset_id and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Aset tidak ditemukan.';
  end if;

  if sell_amount > round(asset_row.value, 2) + 0.01 then
    raise exception 'Nominal pencairan melebihi nilai aset saat ini.';
  end if;

  remaining_val := greatest(0, round(asset_row.value - sell_amount, 2));

  if lower(asset_row.type) = 'crypto' and asset_row.quantity > 0 then
    if p_quantity is not null and p_quantity > 0 then
      sold_qty := least(asset_row.quantity, p_quantity);
    elsif asset_row.value > 0 then
      sold_qty := least(asset_row.quantity, asset_row.quantity * (sell_amount / asset_row.value));
    end if;
    remaining_qty := greatest(0, asset_row.quantity - sold_qty);

    if remaining_val <= 0 or remaining_qty <= 0.000000001 then
      delete from public.assets where public.assets.id = p_asset_id and user_id = auth.uid();
    else
      update public.assets
         set quantity = remaining_qty,
             value = remaining_val
       where public.assets.id = p_asset_id and user_id = auth.uid();
    end if;
  else
    if remaining_val <= 0 then
      delete from public.assets where public.assets.id = p_asset_id and user_id = auth.uid();
    else
      update public.assets
         set value = remaining_val
       where public.assets.id = p_asset_id and user_id = auth.uid();
    end if;
  end if;

  if p_wallet_id is not null then
    perform 1
      from public.wallets
     where public.wallets.id = p_wallet_id and user_id = auth.uid()
     for key share;
    if not found then
      raise exception 'Dompet tujuan tidak ditemukan.';
    end if;

    insert into public.categories (user_id, tipe, name)
    values (auth.uid(), 'pemasukan', 'Investasi')
    on conflict (user_id, tipe, name) do nothing;

    return query
      insert into public.transactions as inserted_tx
        (user_id, tanggal, tipe, kategori, nominal, keterangan, source, wallet_id)
      values
        (auth.uid(), coalesce(p_date, current_date), 'Pemasukan', 'Investasi',
         sell_amount, 'Pencairan aset: ' || asset_row.name, 'web', p_wallet_id)
      returning inserted_tx.id, inserted_tx.tanggal, inserted_tx.tipe,
        inserted_tx.kategori, inserted_tx.nominal, inserted_tx.keterangan,
        inserted_tx.wallet_id;
  end if;
end;
$$;

revoke all on function public.liquidate_asset(uuid, numeric, numeric, uuid, date) from public, anon;
grant execute on function public.liquidate_asset(uuid, numeric, numeric, uuid, date) to authenticated;

-- 6. Financial goal contribution from wallet RPC
create or replace function public.contribute_to_goal(
  p_goal_id uuid,
  p_amount numeric,
  p_wallet_id uuid default null,
  p_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  goal_row public.financial_goals%rowtype;
  tx_row public.transactions%rowtype;
  contrib_amount numeric := round(coalesce(p_amount, 0), 2);
  has_tx boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if contrib_amount <= 0 then
    raise exception 'Nominal alokasi target harus lebih dari nol.';
  end if;

  select *
    into goal_row
    from public.financial_goals
   where id = p_goal_id and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Target keuangan tidak ditemukan.';
  end if;

  update public.financial_goals
     set current_amount = current_amount + contrib_amount
   where id = p_goal_id and user_id = auth.uid()
   returning * into goal_row;

  if p_wallet_id is not null then
    perform 1
      from public.wallets
     where id = p_wallet_id and user_id = auth.uid()
     for key share;
    if not found then
      raise exception 'Dompet sumber tidak ditemukan.';
    end if;

    insert into public.categories (user_id, tipe, name)
    values (auth.uid(), 'pengeluaran', 'Tabungan & Target')
    on conflict (user_id, tipe, name) do nothing;

    insert into public.transactions
      (user_id, tanggal, tipe, kategori, nominal, keterangan, source, wallet_id)
    values
      (auth.uid(), coalesce(p_date, current_date), 'Pengeluaran', 'Tabungan & Target',
       contrib_amount, 'Alokasi target: ' || goal_row.name, 'web', p_wallet_id)
    returning * into tx_row;
    has_tx := true;
  end if;

  return jsonb_build_object(
    'goal', jsonb_build_object(
      'id', goal_row.id,
      'name', goal_row.name,
      'targetAmount', goal_row.target_amount,
      'currentAmount', goal_row.current_amount,
      'targetDate', coalesce(to_char(goal_row.target_date, 'YYYY-MM-DD'), '')
    ),
    'transaction', case
      when has_tx then jsonb_build_object(
        'id', tx_row.id,
        'tanggal', to_char(tx_row.tanggal, 'YYYY-MM-DD'),
        'tipe', tx_row.tipe,
        'kategori', tx_row.kategori,
        'nominal', tx_row.nominal,
        'keterangan', tx_row.keterangan,
        'walletId', coalesce(tx_row.wallet_id::text, '')
      )
      else null
    end
  );
end;
$$;

revoke all on function public.contribute_to_goal(uuid, numeric, uuid, date) from public, anon;
grant execute on function public.contribute_to_goal(uuid, numeric, uuid, date) to authenticated;

-- 7. Update search_user_transactions to support optional p_wallet_id filter
drop function if exists public.search_user_transactions(date, date, text, text, text, integer, integer);
create or replace function public.search_user_transactions(
  p_start date,
  p_end date,
  p_type text default null,
  p_category text default null,
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 20,
  p_wallet_id uuid default null
)
returns table (
  id uuid,
  tanggal date,
  tipe text,
  kategori text,
  nominal numeric,
  keterangan text,
  wallet_id uuid,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select t.id, t.tanggal, t.tipe, t.kategori, t.nominal, t.keterangan, t.wallet_id
    from public.transactions t
    where t.user_id = auth.uid()
      and t.tanggal >= p_start
      and t.tanggal <= p_end
      and (coalesce(p_type, '') = '' or t.tipe = p_type)
      and (coalesce(p_category, '') = '' or t.kategori = p_category)
      and (p_wallet_id is null or t.wallet_id = p_wallet_id)
      and (
        coalesce(p_search, '') = ''
        or strpos(
          lower(coalesce(t.kategori, '') || ' ' || coalesce(t.keterangan, '')),
          lower(p_search)
        ) > 0
      )
  )
  select
    f.id, f.tanggal, f.tipe, f.kategori, f.nominal, f.keterangan, f.wallet_id,
    count(*) over () as total_count
  from filtered f
  order by f.tanggal desc, f.id desc
  offset greatest(0, least(coalesce(p_offset, 0), 1000000))
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.search_user_transactions(date, date, text, text, text, integer, integer, uuid)
  from public, anon;
grant execute on function public.search_user_transactions(date, date, text, text, text, integer, integer, uuid)
  to authenticated;

commit;
