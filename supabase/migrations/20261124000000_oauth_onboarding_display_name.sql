begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
  resolved_name text;
begin
  perform pg_advisory_xact_lock(20261115, 1);
  select not exists (select 1 from public.profiles) into is_first;

  resolved_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    60
  );

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    resolved_name,
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
