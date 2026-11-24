-- ============================================================
-- Wave v3.17: Case-insensitive category & default-wallet search,
-- case-insensitive category rename RPC, and safe category normalization
-- ============================================================
begin;

-- 1. Update search_user_transactions:
--    - p_category matches case-insensitively and ignores leading/trailing spaces
--    - p_wallet_id falls back to user's primary wallet for legacy NULL wallet_id rows
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
  with default_wallet as (
    select w.id
    from public.wallets w
    where w.user_id = auth.uid()
    order by w.sort asc, w.name asc
    limit 1
  ),
  filtered as (
    select t.id, t.tanggal, t.tipe, t.kategori, t.nominal, t.keterangan, t.wallet_id
    from public.transactions t
    left join default_wallet dw on true
    where t.user_id = auth.uid()
      and t.tanggal >= p_start
      and t.tanggal <= p_end
      and (coalesce(p_type, '') = '' or t.tipe = p_type)
      and (coalesce(btrim(p_category), '') = '' or lower(btrim(t.kategori)) = lower(btrim(p_category)))
      and (p_wallet_id is null or t.wallet_id = p_wallet_id or (t.wallet_id is null and p_wallet_id = dw.id))
      and (
        coalesce(btrim(p_search), '') = ''
        or strpos(
          lower(coalesce(t.kategori, '') || ' ' || coalesce(t.keterangan, '')),
          lower(btrim(p_search))
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

-- 2. Harden rename_category_with_transactions to match case/whitespace variants
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

  v_tx_tipe := case when p_tipe = 'pemasukan' then 'Pemasukan' else 'Pengeluaran' end;

  insert into public.categories (user_id, tipe, name)
  values (auth.uid(), p_tipe, v_new)
  on conflict (user_id, tipe, name) do nothing;

  delete from public.categories
  where user_id = auth.uid()
    and tipe = p_tipe
    and lower(btrim(name)) = lower(v_old)
    and name <> v_new;

  update public.transactions
     set kategori = v_new
   where user_id = auth.uid()
     and tipe = v_tx_tipe
     and lower(btrim(kategori)) = lower(v_old)
     and kategori <> v_new;

  if p_tipe = 'pengeluaran' then
    insert into public.budgets (user_id, kategori, bulan, jumlah)
    select b.user_id, v_new, b.bulan, sum(b.jumlah)
    from public.budgets b
    where b.user_id = auth.uid()
      and lower(btrim(b.kategori)) = lower(v_old)
      and b.kategori <> v_new
    group by b.user_id, b.bulan
    on conflict (user_id, kategori, bulan)
    do update set jumlah = public.budgets.jumlah + excluded.jumlah;

    delete from public.budgets
    where user_id = auth.uid()
      and lower(btrim(kategori)) = lower(v_old)
      and kategori <> v_new;
  end if;

  update public.recurring
     set kategori = v_new
   where user_id = auth.uid()
     and tipe = v_tx_tipe
     and lower(btrim(kategori)) = lower(v_old)
     and kategori <> v_new;
end;
$$;

revoke all on function public.rename_category_with_transactions(text, text, text) from public, anon;
grant execute on function public.rename_category_with_transactions(text, text, text) to authenticated;

-- 3. Safe one-time cleanup of untrimmed & case-mismatched historical rows
update public.transactions
   set kategori = btrim(kategori)
 where btrim(kategori) <> ''
   and kategori <> btrim(kategori);

update public.recurring
   set kategori = btrim(kategori)
 where btrim(kategori) <> ''
   and kategori <> btrim(kategori);

with canonical as (
  select distinct on (user_id, tipe, lower(btrim(name)))
    user_id,
    tipe,
    lower(btrim(name)) as norm_key,
    btrim(name) as canonical_name
  from public.categories
  where btrim(name) <> ''
  order by
    user_id,
    tipe,
    lower(btrim(name)),
    (name = btrim(name)) desc,
    (name <> lower(name)) desc,
    name asc
)
update public.transactions t
   set kategori = c.canonical_name
  from canonical c
 where t.user_id = c.user_id
   and (
     (t.tipe = 'Pemasukan' and c.tipe = 'pemasukan')
     or (t.tipe = 'Pengeluaran' and c.tipe = 'pengeluaran')
   )
   and lower(btrim(t.kategori)) = c.norm_key
   and t.kategori <> c.canonical_name;

with canonical as (
  select distinct on (user_id, tipe, lower(btrim(name)))
    user_id,
    tipe,
    lower(btrim(name)) as norm_key,
    btrim(name) as canonical_name
  from public.categories
  where btrim(name) <> ''
  order by
    user_id,
    tipe,
    lower(btrim(name)),
    (name = btrim(name)) desc,
    (name <> lower(name)) desc,
    name asc
)
update public.recurring r
   set kategori = c.canonical_name
  from canonical c
 where r.user_id = c.user_id
   and (
     (r.tipe = 'Pemasukan' and c.tipe = 'pemasukan')
     or (r.tipe = 'Pengeluaran' and c.tipe = 'pengeluaran')
   )
   and lower(btrim(r.kategori)) = c.norm_key
   and r.kategori <> c.canonical_name;

with canonical as (
  select distinct on (user_id, tipe, lower(btrim(name)))
    user_id,
    lower(btrim(name)) as norm_key,
    btrim(name) as canonical_name
  from public.categories
  where tipe = 'pengeluaran' and btrim(name) <> ''
  order by
    user_id,
    tipe,
    lower(btrim(name)),
    (name = btrim(name)) desc,
    (name <> lower(name)) desc,
    name asc
)
insert into public.budgets (user_id, kategori, bulan, jumlah)
select b.user_id, c.canonical_name, b.bulan, sum(b.jumlah)
from public.budgets b
join canonical c
  on b.user_id = c.user_id
 and lower(btrim(b.kategori)) = c.norm_key
 and b.kategori <> c.canonical_name
group by b.user_id, c.canonical_name, b.bulan
on conflict (user_id, kategori, bulan)
do update set jumlah = public.budgets.jumlah + excluded.jumlah;

with canonical as (
  select distinct on (user_id, tipe, lower(btrim(name)))
    user_id,
    lower(btrim(name)) as norm_key,
    btrim(name) as canonical_name
  from public.categories
  where tipe = 'pengeluaran' and btrim(name) <> ''
  order by
    user_id,
    tipe,
    lower(btrim(name)),
    (name = btrim(name)) desc,
    (name <> lower(name)) desc,
    name asc
)
delete from public.budgets b
using canonical c
where b.user_id = c.user_id
  and lower(btrim(b.kategori)) = c.norm_key
  and b.kategori <> c.canonical_name;

commit;
