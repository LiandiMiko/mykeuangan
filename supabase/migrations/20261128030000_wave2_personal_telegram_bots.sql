-- ============================================================
-- Gelombang 2.2 — Bot Telegram personal (bring your own bot)
--   * Tiap pengguna memakai botnya sendiri (dibuat via BotFather),
--     bukan satu bot bersama. Token bot tersimpan terenkripsi
--     (AES-GCM) di telegram_bots; webhook per pengguna memakai
--     link_secret (di URL) + webhook_secret (header Telegram).
--   * OTP pairing disimpan sebagai hash SHA-256, bukan plaintext (T7).
--   * Tulis langsung telegram_chats / telegram_pairings dari klien
--     dicabut (T6): pairing hanya lewat RPC, chat hanya lewat webhook.
--   * Dedup update_id webhook kini per bot (update_id hanya unik
--     di dalam satu bot).
--   * admin_unlink_user_telegram ikut menghapus baris bot personal.
--
-- URUTAN DEPLOY (penting): terapkan migrasi ini DULU, baru deploy
-- ulang Edge Function telegram-bot, telegram-setup, admin-user-ops,
-- dan delete-account. Di antara keduanya, pairing OTP lama (max
-- 10 menit) tidak berlaku — pengguna cukup membuat kode baru.
-- Secret baru yang wajib diisi sebelum fitur dipakai:
--   TELEGRAM_TOKEN_ENCRYPTION_KEY (Edge Function secret, string
--   acak >= 32 karakter) — kunci enkripsi token bot. Tanpa ini,
--   connect_bot menolak dengan 500 dan bot lama tetap jalan lewat
--   token env bersama (fallback transisi).
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ---------- 1. Tabel bot personal per pengguna ----------
create table if not exists public.telegram_bots (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  bot_username    text not null,
  bot_user_id     bigint not null,
  token_encrypted text not null,
  token_iv        text not null,
  webhook_secret  text not null,
  link_secret     text not null unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.telegram_bots enable row level security;
revoke all on public.telegram_bots from public, anon, authenticated;
-- Sengaja tanpa policy untuk authenticated: klien tidak pernah membaca
-- atau menulis tabel ini langsung. Semua akses lewat Edge Function
-- telegram-setup (JWT pengguna) dan telegram-bot (service_role).
-- Token bot tidak pernah dikirim kembali ke klien setelah disimpan.

-- ---------- 2. OTP pairing: hash, bukan plaintext (T7) ----------
-- Baris pairing berumur max 10 menit; hapus semuanya supaya tidak ada
-- OTP plaintext yang tertinggal, lalu jadikan otp_hash primary key.
delete from public.telegram_pairings;
alter table public.telegram_pairings add column if not exists otp_hash text;
alter table public.telegram_pairings drop constraint if exists telegram_pairings_pkey;
alter table public.telegram_pairings drop column if exists otp;
alter table public.telegram_pairings alter column otp_hash set not null;
alter table public.telegram_pairings add primary key (otp_hash);

-- replace_telegram_pairing: hash OTP (SHA-256 hex, pgcrypto) sebelum simpan.
-- Klien tetap mengirim OTP plaintext ke RPC ini lewat koneksi TLS; yang
-- tersimpan di database kini hanya hash-nya.
create or replace function public.replace_telegram_pairing(p_otp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  perform 1
    from public.profiles
   where id = auth.uid() and status = 'active'
   for update;
  if not found then
    raise exception 'Active account required';
  end if;
  if p_otp is null or p_otp !~ '^[0-9]{8}$' then
    raise exception 'Invalid pairing code';
  end if;

  delete from public.telegram_pairings
   where user_id = auth.uid();

  insert into public.telegram_pairings (otp_hash, user_id, expires_at)
  values (encode(digest(p_otp, 'sha256'), 'hex'), auth.uid(), now() + interval '10 minutes');
end;
$$;

revoke all on function public.replace_telegram_pairing(text) from public, anon;
grant execute on function public.replace_telegram_pairing(text) to authenticated;

-- ---------- 3. telegram_chats: cabut tulis langsung dari klien (T6) ----------
-- Sebelumnya policy "own rows" FOR ALL mengizinkan pengguna menyisipkan
-- baris chat_id apa pun untuk dirinya sendiri (klaim chat orang lain).
-- Sekarang: klien hanya boleh MEMBACA barisnya sendiri; penulisan hanya
-- lewat service_role (webhook Edge Function).
drop policy if exists "own rows" on public.telegram_chats;
create policy "users_read_own_chats" on public.telegram_chats
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());
revoke insert, update, delete on public.telegram_chats from authenticated;

-- ---------- 4. telegram_pairings: cabut seluruh akses klien langsung (T6) ----------
-- Penulisan hanya lewat RPC replace_telegram_pairing (security definer);
-- pembacaan/penghapusan hanya lewat service_role (webhook).
drop policy if exists "users_manage_own_pairings" on public.telegram_pairings;
revoke all on public.telegram_pairings from authenticated;

-- ---------- 5. admin_unlink_user_telegram: ikut hapus baris bot ----------
create or replace function public.admin_unlink_user_telegram(p_target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_pairs integer := 0;
  v_bots integer := 0;
  v_email text := '';
begin
  if not public.is_admin() then
    raise exception 'Hanya admin aktif yang dapat memutus tautan Telegram.';
  end if;
  select coalesce(email, '') into v_email from public.profiles where id = p_target_user_id;
  delete from public.telegram_chats where user_id = p_target_user_id;
  get diagnostics v_deleted = row_count;
  delete from public.telegram_pairings where user_id = p_target_user_id;
  get diagnostics v_pairs = row_count;
  delete from public.telegram_bots where user_id = p_target_user_id;
  get diagnostics v_bots = row_count;
  perform public.admin_log_action(
    'unlink_telegram', p_target_user_id, v_email,
    jsonb_build_object('chats_removed', v_deleted, 'pairings_removed', v_pairs, 'bots_removed', v_bots)
  );
  return v_deleted;
end;
$$;

grant execute on function public.admin_unlink_user_telegram(uuid) to authenticated;

-- ---------- 6. telegram_updates: dedup per bot ----------
-- update_id hanya unik di dalam satu bot; dua bot personal bisa menerima
-- update_id yang sama. Tanpa ini, update bot kedua dibuang sebagai duplikat.
-- Baris lama (bot bersama) mendapat bot_user_id = 0.
alter table public.telegram_updates add column if not exists bot_user_id bigint not null default 0;
alter table public.telegram_updates drop constraint if exists telegram_updates_pkey;
alter table public.telegram_updates add primary key (bot_user_id, update_id);

commit;
