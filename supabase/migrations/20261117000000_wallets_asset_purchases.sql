begin;

alter table public.wallets
  drop constraint if exists wallets_kind_check;

alter table public.wallets
  add constraint wallets_kind_check check (kind in ('bank', 'cash', 'ewallet'));

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
  purchase_amount numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if asset_name is null then
    raise exception 'Asset name is required';
  end if;
  if p_type is null or p_type not in ('Crypto', 'Cash', 'Other') then
    raise exception 'Invalid asset type';
  end if;

  perform 1
    from public.wallets
   where id = p_wallet_id and user_id = auth.uid()
   for key share;
  if not found then
    raise exception 'Wallet not found';
  end if;

  if p_type = 'Crypto' then
    if asset_symbol = '' or p_quantity is null or p_quantity <= 0
        or p_buy_price is null or p_buy_price <= 0 then
      raise exception 'Crypto symbol, quantity, and purchase price are required';
    end if;
    purchase_amount := round(p_quantity * p_buy_price, 2);
  else
    if p_amount is null or p_amount <= 0 then
      raise exception 'Purchase amount must be greater than zero';
    end if;
    purchase_amount := round(p_amount, 2);
  end if;

  if purchase_amount <= 0 then
    raise exception 'Purchase amount must be greater than zero';
  end if;

  insert into public.assets
    (user_id, name, type, symbol, quantity, buy_price, value)
  values
    (auth.uid(), asset_name, p_type, asset_symbol,
     case when p_type = 'Crypto' then p_quantity else 0 end,
     case when p_type = 'Crypto' then p_buy_price else 0 end,
     purchase_amount);

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

commit;
