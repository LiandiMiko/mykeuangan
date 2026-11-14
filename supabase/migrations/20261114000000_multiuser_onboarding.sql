-- ============================================================
-- MyKeuangan — Migrasi Multi-User, Auto-Onboarding & RBAC
-- Jalankan di Supabase → SQL Editor
-- ============================================================

-- 1. Tabel Profil Pengguna & Role
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  role         text not null default 'user' check (role in ('user', 'admin')),
  status       text not null default 'active' check (status in ('active', 'suspended')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper check admin
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- RLS profiles
create policy "users_read_own_profile" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "users_update_own_profile" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- 2. Trigger Auto-Onboarding untuk Pengguna Baru
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  is_first boolean;
begin
  -- Cek apakah ini user pertama di sistem (otomatis jadikan admin)
  select not exists (select 1 from public.profiles) into is_first;

  -- A. Profil
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    split_part(coalesce(new.email, 'User'), '@', 1),
    case when is_first then 'admin' else 'user' end
  )
  on conflict (id) do nothing;

  -- B. Dompet Bawaan
  insert into public.wallets (user_id, name, kind, sort) values
    (new.id, 'BCA (m-banking)', 'bank', 1),
    (new.id, 'Cash', 'cash', 2)
  on conflict (user_id, name) do nothing;

  -- C. Kategori Standar
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

  -- D. Settings Awal
  insert into public.settings (user_id, key, value) values
    (new.id, 'payrollDay', '28'),
    (new.id, 'currentPeriod', to_char(now(), 'YYYY-MM'))
  on conflict (user_id, key) do nothing;

  return new;
end;
$$;

-- Pasang trigger di auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill untuk akun yang sudah terdaftar sebelumnya
insert into public.profiles (id, email, display_name, role)
select id, coalesce(email, ''), split_part(coalesce(email, 'User'), '@', 1), 'admin'
from auth.users
on conflict (id) do nothing;
