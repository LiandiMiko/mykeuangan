-- ============================================================
-- Optimistic locking (Gelombang 7c Item 2) — dua perangkat
-- mengedit data yang sama tidak boleh lagi saling menimpa diam-diam.
-- Migrasi: supabase/migrations/20261128110000_optimistic_locking.sql
--
-- Isi:
--   §1  Kolom `version` (integer, NOT NULL, DEFAULT 1) di enam tabel
--       yang punya jalur edit: transactions, financial_goals,
--       budgets, recurring, wallets, assets.
--   §2  Trigger `bump_version`: SETIAP update atas baris mana pun
--       menaikkan version +1 — otomatis, tidak peduli jalur tulisnya
--       (PostgREST, RPC contribute/top_up/liquidate/rename_*,
--       refresh harga). Klien TIDAK PERNAH menulis kolom version
--       sendiri; klien hanya mengirim "versi yang saya lihat saat
--       mulai mengedit" sebagai syarat WHERE.
--   §3  RPC `save_budget_checked(...)`: upsert anggaran tidak bisa
--       bersyarat lewat PostgREST (upsert selalu menang), jadi
--       penegakannya di RPC — kunci baris FOR UPDATE (supaya dua
--       RPC bersamaan diserialisasi), bandingkan versi, lalu
--       insert-atau-update; mengembalikan conflict=true + baris kini
--       bila versi tidak cocok.
--   §4  RPC `delete_wallet_checked(...)`: hapus dompet dengan cek
--       versi — kunci baris FOR UPDATE, cocokkan versi, lalu
--       mendelegasikan ke `delete_wallet(p_wallet_id)` yang lama
--       (fungsi lama TIDAK diubah; nama baru supaya resolusi
--       PostgREST tidak ambigu).
--   §5  Grants: REVOKE dari public, anon + GRANT EXECUTE ke
--       authenticated (pola Gelombang 4 — revoke dari PUBLIC saja
--       tidak menghapus grant eksplisit anon).
--
-- Penegakan ada di sisi SERVER: update/delete langsung memakai
-- `WHERE version = <versi-yang-diharapkan>` (PostgREST) atau RPC
-- di atas. Cek di klien hanya optimasi UX (dialog bisa menampilkan
-- "apa yang berubah") — server yang memutuskan.
--
-- URUTAN DEPLOY PENTING: migrasi ini WAJIB diterapkan SEBELUM
-- klien Gelombang 7c ter-deploy — klien baru memuat kolom `version`
-- di semua select, dan PostgREST menolak select kolom yang belum
-- ada (PGRST204). Sama seperti pola Gelombang 2/admin (RPC dulu,
-- klien kemudian).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP TRIGGER IF EXISTS +
-- CREATE TRIGGER, CREATE OR REPLACE FUNCTION, REVOKE/GRANT aman
-- diulang. Satu transaksi (begin/commit). TIDAK menyentuh migrasi
-- lama, TIDAK memakai hmac/digest (pgcrypto Supabase ada di schema
-- extensions, bukan public — bila kelak dipakai, kualifikasi
-- extensions.hmac/extensions.digest). TIDAK memakai to_regproc
-- dengan daftar argumen (selalu NULL); migrasi ini tidak
-- memerlukannya.
-- ============================================================

begin;

-- §1 — Kolom version di enam tabel yang punya jalur edit.
-- Baris lama mendapat version = 1 (DEFAULT), jadi edit pertama
-- setelah migrasi memakai expectedVersion 1 dan langsung terlindungi.
alter table public.transactions
  add column if not exists version integer not null default 1;
alter table public.financial_goals
  add column if not exists version integer not null default 1;
alter table public.budgets
  add column if not exists version integer not null default 1;
alter table public.recurring
  add column if not exists version integer not null default 1;
alter table public.wallets
  add column if not exists version integer not null default 1;
alter table public.assets
  add column if not exists version integer not null default 1;

-- §2 — Trigger penambah versi: setiap UPDATE menaikkan version +1.
-- SECURITY INVOKER (default) + search_path dipin supaya definisi
-- tidak bergantung pada search_path pemanggil (pola Gelombang 4).
create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'transactions', 'financial_goals', 'budgets',
    'recurring', 'wallets', 'assets'
  ] loop
    execute format('drop trigger if exists bump_version_trigger on public.%I', t);
    execute format(
      'create trigger bump_version_trigger before update on public.%I ' ||
      'for each row execute function public.bump_version()', t);
  end loop;
end $$;

-- §3 — RPC: simpan anggaran dengan cek versi.
-- p_expected_version NULL = tidak ada baris yang diharapkan
-- (insert baru, atau pemanggil lama yang tidak membawa versi —
-- klien baru selalu membawa versi hasil baca-sebelum-tulis).
-- Mengembalikan SATU baris: kolom baris + conflict (boolean) +
-- current_jumlah/current_version (terisi hanya bila conflict).
create or replace function public.save_budget_checked(
  p_kategori text,
  p_bulan text,
  p_jumlah numeric,
  p_expected_version integer default null
)
returns table (
  id uuid,
  kategori text,
  bulan text,
  jumlah numeric,
  version integer,
  conflict boolean,
  current_jumlah numeric,
  current_version integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.budgets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_kategori is null or btrim(p_kategori) = '' then
    raise exception 'Kategori anggaran wajib diisi.';
  end if;
  if p_bulan is null or p_bulan !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periode anggaran tidak valid.';
  end if;
  if p_jumlah is null or p_jumlah < 0 then
    raise exception 'Nominal anggaran tidak valid.';
  end if;

  -- Kunci baris (bila ada) supaya dua RPC bersamaan atas anggaran
  -- yang sama diserialisasi: yang kedua membaca versi SETELAH yang
  -- pertama commit, sehingga cek di bawah menolaknya dengan benar.
  -- Tanpa FOR UPDATE, cek-lalu-tulis di dalam RPC pun balapan.
  select * into v_row
    from public.budgets
   where user_id = auth.uid()
     and kategori = btrim(p_kategori)
     and bulan = p_bulan
     for update;

  if not found then
    insert into public.budgets (user_id, kategori, bulan, jumlah)
    values (auth.uid(), btrim(p_kategori), p_bulan, p_jumlah)
    returning * into v_row;
    return query select
      v_row.id, v_row.kategori, v_row.bulan, v_row.jumlah, v_row.version,
      false, null::numeric, null::integer;
    return;
  end if;

  if p_expected_version is not null and v_row.version <> p_expected_version then
    return query select
      v_row.id, v_row.kategori, v_row.bulan, v_row.jumlah, v_row.version,
      true, v_row.jumlah, v_row.version;
    return;
  end if;

  -- Trigger bump_version menaikkan version +1 secara otomatis.
  update public.budgets
     set jumlah = p_jumlah
   where id = v_row.id
  returning * into v_row;
  return query select
    v_row.id, v_row.kategori, v_row.bulan, v_row.jumlah, v_row.version,
    false, null::numeric, null::integer;
end;
$$;

-- §4 — RPC: hapus dompet dengan cek versi.
-- p_expected_version NULL = pemanggil lama tanpa versi (klien baru
-- selalu membawa versi hasil baca-sebelum-tulis). Mengembalikan
-- jsonb: {"deleted": true} atau {"conflict": true, ...baris kini}.
-- Logika hapus tetap milik delete_wallet() yang lama — RPC ini
-- hanya gerbang versi di depannya.
create or replace function public.delete_wallet_checked(
  p_wallet_id uuid,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.wallets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_wallet_id is null then
    raise exception 'Dompet tidak ditemukan.';
  end if;

  select * into v_row
    from public.wallets
   where id = p_wallet_id and user_id = auth.uid()
     for update;
  if not found then
    raise exception 'Dompet tidak ditemukan.';
  end if;

  if p_expected_version is not null and v_row.version <> p_expected_version then
    return jsonb_build_object(
      'conflict', true,
      'id', v_row.id,
      'name', v_row.name,
      'kind', v_row.kind,
      'opening_balance', v_row.opening_balance,
      'version', v_row.version
    );
  end if;

  perform public.delete_wallet(p_wallet_id);
  return jsonb_build_object('deleted', true, 'id', p_wallet_id);
end;
$$;

-- §5 — Grants (pola Gelombang 4: revoke dari public DAN anon).
-- CATATAN: bump_version() TIDAK di-revoke — fungsi trigger dijalankan
-- sistem saat UPDATE terjadi (bukan dipanggil role), dan mencabut
-- EXECUTE darinya bisa memblokir semua UPDATE di enam tabel.
-- Yang dibatasi hanya dua RPC yang dipanggil klien langsung.
revoke all on function public.save_budget_checked(text, text, numeric, integer) from public, anon;
grant execute on function public.save_budget_checked(text, text, numeric, integer) to authenticated;
revoke all on function public.delete_wallet_checked(uuid, integer) from public, anon;
grant execute on function public.delete_wallet_checked(uuid, integer) to authenticated;

commit;
