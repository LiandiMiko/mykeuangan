begin;

drop policy if exists "users_update_own_profile" on public.profiles;
drop policy if exists "admins_update_profiles" on public.profiles;

create policy "admins_update_profiles" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, update on public.profiles to authenticated;

alter table public.telegram_pairings
  alter column user_id set default auth.uid();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  perform pg_advisory_xact_lock(20261115, 1);
  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    split_part(coalesce(new.email, 'User'), '@', 1),
    case when is_first then 'admin' else 'user' end
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id, name, kind, sort) values
    (new.id, 'BCA (m-banking)', 'bank', 1),
    (new.id, 'Cash', 'cash', 2)
  on conflict (user_id, name) do nothing;

  insert into public.categories (user_id, tipe, name) values
    (new.id, 'pemasukan', 'Gaji'),
    (new.id, 'pemasukan', 'Investasi'),
    (new.id, 'pemasukan', 'Bonus & Hadiah'),
    (new.id, 'pemasukan', 'Lainnya'),
    (new.id, 'pengeluaran', 'Makanan & Minuman'),
    (new.id, 'pengeluaran', 'Transportasi'),
    (new.id, 'pengeluaran', 'Tagihan & Langganan'),
    (new.id, 'pengeluaran', 'Belanja & Kebutuhan'),
    (new.id, 'pengeluaran', 'Hiburan'),
    (new.id, 'pengeluaran', 'Kesehatan'),
    (new.id, 'pengeluaran', 'Lainnya')
  on conflict (user_id, tipe, name) do nothing;

  insert into public.settings (user_id, key, value) values
    (new.id, 'payrollDay', '28'),
    (new.id, 'currentPeriod', to_char(now(), 'YYYY-MM'))
  on conflict (user_id, key) do nothing;

  return new;
end;
$$;

commit;
