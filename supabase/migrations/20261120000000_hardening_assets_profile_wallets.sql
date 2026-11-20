begin;

-- 1. Self-service display name update RPC (non-admin cannot UPDATE profiles directly due to RLS)
create or replace function public.update_own_display_name(p_display_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_active_user() then
    raise exception 'Akun tidak aktif.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Nama tampilan harus berisi 2 sampai 60 karakter.';
  end if;

  update public.profiles
     set display_name = v_name,
         updated_at = now()
   where id = auth.uid();

  if not found then
    raise exception 'Profil pengguna tidak ditemukan.';
  end if;

  return v_name;
end;
$$;

revoke all on function public.update_own_display_name(text) from public, anon;
grant execute on function public.update_own_display_name(text) to authenticated;

-- 2. Expand atomic asset purchase RPC to support Crypto, Emas, USD, Saham, Cash, Other
create or replace function public.create_asset_with_expense(
  p_name text,
  p_type text,
  p_symbol text,
  p_quantity numeric,
  p_buy_price numeric,
  p_amount numeric,
  p_wallet_id uuid,
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
  asset_name text := nullif(btrim(p_name), '');
  asset_symbol text := upper(btrim(coalesce(p_symbol, '')));
  type_lower text := lower(coalesce(p_type, ''));
  purchase_amount numeric;
  asset_qty numeric := 0;
  asset_buy_price numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if asset_name is null then
    raise exception 'Asset name is required';
  end if;
  if p_type is null or p_type not in ('Crypto', 'Emas', 'USD', 'Saham', 'Cash', 'Other') then
    raise exception 'Invalid asset type';
  end if;

  perform 1
    from public.wallets
   where public.wallets.id = p_wallet_id and user_id = auth.uid()
   for key share;
  if not found then
    raise exception 'Wallet not found';
  end if;

  if type_lower = 'crypto' then
    if asset_symbol = '' or p_quantity is null or p_quantity <= 0
        or p_buy_price is null or p_buy_price <= 0 then
      raise exception 'Crypto symbol, quantity, and purchase price are required';
    end if;
    purchase_amount := round(p_quantity * p_buy_price, 2);
    asset_qty := p_quantity;
    asset_buy_price := p_buy_price;
  elsif type_lower in ('emas', 'usd') then
    if p_amount is null or p_amount <= 0 or p_quantity is null or p_quantity <= 0 then
      raise exception 'Unit quantity and purchase amount are required';
    end if;
    purchase_amount := round(p_amount, 2);
    if asset_symbol = '' then
      asset_symbol := case when type_lower = 'emas' then 'XAU' else 'USD' end;
    end if;
    asset_qty := p_quantity;
    asset_buy_price := case
      when p_buy_price is not null and p_buy_price > 0 then p_buy_price
      else round(purchase_amount / p_quantity, 4)
    end;
  else
    if p_amount is null or p_amount <= 0 then
      raise exception 'Purchase amount must be greater than zero';
    end if;
    purchase_amount := round(p_amount, 2);
    asset_qty := coalesce(nullif(p_quantity, 0), 0);
    asset_buy_price := coalesce(nullif(p_buy_price, 0), 0);
  end if;

  if purchase_amount <= 0 then
    raise exception 'Purchase amount must be greater than zero';
  end if;

  insert into public.assets
    (user_id, name, type, symbol, quantity, buy_price, value)
  values
    (auth.uid(), asset_name, p_type, asset_symbol, asset_qty, asset_buy_price, purchase_amount);

  insert into public.categories (user_id, tipe, name)
  values (auth.uid(), 'pengeluaran', 'Investasi')
  on conflict (user_id, tipe, name) do nothing;

  return query
    insert into public.transactions as inserted_transaction
      (user_id, tanggal, tipe, kategori, nominal, keterangan, source, wallet_id)
    values
      (auth.uid(), coalesce(p_date, current_date), 'Pengeluaran', 'Investasi',
       purchase_amount, 'Pembelian aset: ' || asset_name, 'web', p_wallet_id)
    returning inserted_transaction.id, inserted_transaction.tanggal,
      inserted_transaction.tipe, inserted_transaction.kategori,
      inserted_transaction.nominal, inserted_transaction.keterangan,
      inserted_transaction.wallet_id;
end;
$$;

revoke all on function public.create_asset_with_expense(text, text, text, numeric, numeric, numeric, uuid, date)
  from public, anon;
grant execute on function public.create_asset_with_expense(text, text, text, numeric, numeric, numeric, uuid, date)
  to authenticated;

-- 3. Atomic unit & average buy-price tracking on top_up_asset for Crypto, Emas, and USD
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
  type_lower text;
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

  type_lower := lower(coalesce(asset_row.type, ''));

  if type_lower in ('crypto', 'emas', 'usd') then
    unit_price := coalesce(
      nullif(p_price, 0),
      case
        when asset_row.quantity > 0 and asset_row.value > 0
          then asset_row.value / asset_row.quantity
        when asset_row.buy_price > 0
          then asset_row.buy_price
        else 0
      end
    );
    added_quantity := coalesce(
      nullif(p_quantity, 0),
      case when unit_price > 0 then p_amount / unit_price else 0 end
    );
    if type_lower = 'crypto' and added_quantity <= 0 then
      raise exception 'Crypto price or quantity is required';
    end if;

    if added_quantity > 0 then
      new_quantity := round(asset_row.quantity + added_quantity, 8);
      update public.assets
         set quantity = new_quantity,
             value = round(asset_row.value + p_amount),
             buy_price = case
               when asset_row.quantity = 0 then round(p_amount / added_quantity, 4)
               when asset_row.buy_price > 0
                 then round((asset_row.quantity * asset_row.buy_price + p_amount) / new_quantity, 4)
               else round((asset_row.value + p_amount) / new_quantity, 4)
             end
       where id = p_asset_id and user_id = auth.uid();
    else
      update public.assets
         set value = round(asset_row.value + p_amount)
       where id = p_asset_id and user_id = auth.uid();
    end if;
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

revoke all on function public.top_up_asset(uuid, numeric, numeric, numeric, uuid, date) from public, anon;
grant execute on function public.top_up_asset(uuid, numeric, numeric, numeric, uuid, date) to authenticated;

-- 4. Atomic unit deduction & full-sell cleanup in liquidate_asset for Crypto, Emas, and USD
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

  if lower(coalesce(asset_row.type, '')) in ('crypto', 'emas', 'usd') and asset_row.quantity > 0 then
    if p_quantity is not null and p_quantity > 0 then
      sold_qty := least(asset_row.quantity, p_quantity);
    elsif asset_row.value > 0 then
      sold_qty := least(asset_row.quantity, asset_row.quantity * (sell_amount / asset_row.value));
    end if;
    remaining_qty := greatest(0, round(asset_row.quantity - sold_qty, 8));

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

-- 5. Preserve opening balance & non-internal transfer history when deleting a wallet
create or replace function public.delete_wallet(p_wallet_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  replacement_id uuid;
  deleted_opening numeric := 0;
  internal_fees numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select w.opening_balance
    into deleted_opening
    from public.wallets w
   where w.id = p_wallet_id and w.user_id = auth.uid()
   for update;
  if not found then
    raise exception 'Dompet tidak ditemukan.';
  end if;

  select w.id
    into replacement_id
    from public.wallets w
   where w.user_id = auth.uid() and w.id <> p_wallet_id
   order by w.sort asc, w.name asc
   limit 1
   for update;

  if replacement_id is null then
    raise exception 'Minimal harus ada satu dompet aktif.';
  end if;

  select coalesce(sum(t.fee), 0)
    into internal_fees
    from public.transfers t
   where t.user_id = auth.uid()
     and (
       (t.from_wallet = p_wallet_id and t.to_wallet = replacement_id)
       or (t.from_wallet = replacement_id and t.to_wallet = p_wallet_id)
       or (t.from_wallet = p_wallet_id and t.to_wallet = p_wallet_id)
     );

  update public.transactions
     set wallet_id = replacement_id
   where user_id = auth.uid()
     and wallet_id = p_wallet_id;

  delete from public.transfers
   where user_id = auth.uid()
     and (
       (from_wallet = p_wallet_id and to_wallet = replacement_id)
       or (from_wallet = replacement_id and to_wallet = p_wallet_id)
       or (from_wallet = p_wallet_id and to_wallet = p_wallet_id)
     );

  update public.transfers
     set from_wallet = replacement_id
   where user_id = auth.uid()
     and from_wallet = p_wallet_id;

  update public.transfers
     set to_wallet = replacement_id
   where user_id = auth.uid()
     and to_wallet = p_wallet_id;

  update public.wallets
     set opening_balance = opening_balance + coalesce(deleted_opening, 0) - coalesce(internal_fees, 0)
   where id = replacement_id and user_id = auth.uid();

  delete from public.wallets
   where id = p_wallet_id and user_id = auth.uid();
end;
$$;

revoke all on function public.delete_wallet(uuid) from public, anon;
grant execute on function public.delete_wallet(uuid) to authenticated;

commit;
