-- ============================================================
-- Dompet (BCA m-banking & Cash), transfer/tarik tunai, dompet per transaksi
-- Jalankan sekali di Supabase → SQL Editor (setelah schema.sql).
-- ============================================================

-- ---------- Dompet ----------
create table public.wallets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  kind            text not null default 'bank' check (kind in ('bank', 'cash')),
  opening_balance numeric(20, 2) not null default 0,   -- saldo awal (diubah saat Anda mengedit saldo)
  sort            int not null default 0,
  unique (user_id, name)
);

-- ---------- Transfer antar dompet / tarik tunai / top-up investasi ----------
-- investasi: uang keluar dari dompet menjadi aset (to_wallet kosong)
create table public.transfers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tanggal     date not null,
  kind        text not null default 'transfer' check (kind in ('tarik_tunai', 'transfer', 'investasi')),
  from_wallet uuid references public.wallets(id) on delete set null,
  to_wallet   uuid references public.wallets(id) on delete set null,
  nominal     numeric(20, 2) not null check (nominal > 0),
  fee         numeric(20, 2) not null default 0 check (fee >= 0),   -- biaya admin, dipotong dari dompet asal
  keterangan  text not null default '',
  created_at  timestamptz not null default now()
);
create index transfers_user_tanggal_idx on public.transfers (user_id, tanggal desc);

-- ---------- Dompet pada transaksi ----------
alter table public.transactions
  add column wallet_id uuid references public.wallets(id) on delete set null;

-- Transaksi tanpa dompet (mis. dari bot Telegram) otomatis masuk dompet pertama (BCA)
create or replace function public.set_default_wallet()
returns trigger
language plpgsql
as $$
begin
  if new.wallet_id is null then
    select w.id into new.wallet_id
      from public.wallets w
     where w.user_id = new.user_id
     order by w.sort, w.name
     limit 1;
  end if;
  return new;
end
$$;

create trigger transactions_default_wallet
  before insert on public.transactions
  for each row execute function public.set_default_wallet();

-- ---------- Data awal: BCA + Cash untuk akun yang sudah ada ----------
insert into public.wallets (user_id, name, kind, sort)
select id, 'BCA (m-banking)', 'bank', 1 from auth.users
on conflict (user_id, name) do nothing;

insert into public.wallets (user_id, name, kind, sort)
select id, 'Cash', 'cash', 2 from auth.users
on conflict (user_id, name) do nothing;

-- Semua transaksi lama dianggap lewat BCA (ubah saldo awal dompet di aplikasi agar cocok dengan kenyataan)
update public.transactions t
   set wallet_id = (select w.id from public.wallets w where w.user_id = t.user_id order by w.sort limit 1)
 where t.wallet_id is null;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['wallets', 'transfers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
