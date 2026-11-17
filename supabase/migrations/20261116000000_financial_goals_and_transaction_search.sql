begin;

create table if not exists public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  current_amount numeric(14, 2) not null default 0 check (current_amount >= 0),
  target_date date,
  created_at timestamptz not null default now()
);

alter table public.financial_goals enable row level security;
drop policy if exists "own rows" on public.financial_goals;
create policy "own rows" on public.financial_goals
  for all to authenticated
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());
grant select, insert, update, delete on public.financial_goals to authenticated;

create index if not exists financial_goals_user_created_idx
  on public.financial_goals (user_id, created_at desc);

create or replace function public.search_user_transactions(
  p_start date,
  p_end date,
  p_type text default null,
  p_category text default null,
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 20
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

revoke all on function public.search_user_transactions(date, date, text, text, text, integer, integer)
  from public, anon;
grant execute on function public.search_user_transactions(date, date, text, text, text, integer, integer)
  to authenticated;

commit;
