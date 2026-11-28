-- ============================================================
-- Gelombang 3.2 — Database (S8-S13)
--   S8  is_admin(): TIDAK ADA perubahan kode (definisi final sudah
--       benar di 20261115040200: role='admin' AND status='active').
--       Lihat catatan §1 di bawah + tes wave3-database.
--   S9  OTP pairing: SHA-256 polos -> HMAC-SHA256 dengan pepper
--       dari Supabase Vault; throttle pembuatan OTP per pengguna;
--       fungsi purge baris kedaluwarsa.
--   S10 Audit log: cabut INSERT langsung, allowlist aksi di
--       admin_log_action(), trigger append-only, hash-chain.
--   S11 prevent_admin_lockout(): cabang DELETE kini berlaku untuk
--       SEMUA actor termasuk service_role.
--   S12 Riwayat perubahan aset & target (asset_value_history,
--       financial_goal_history + trigger).
--   S13 Guard negatif create_asset_with_expense / liquidate_asset,
--       CHECK non-negatif di assets, cap nominal transactions &
--       transfers (defense in depth).
--
-- URUTAN DEPLOY (penting) — baca sebelum menerapkan di SQL Editor:
--   0. SEBELUM migrasi ini: aktifkan Supabase Vault dan buat secret
--      bernama 'telegram_otp_hmac_secret' (string acak >= 32 karakter).
--      Set Edge Function secret TELEGRAM_OTP_HMAC_SECRET dengan nilai
--      YANG SAMA persis. Tanpa ini, replace_telegram_pairing() dan
--      pairing Telegram GAGAL dengan pesan yang jelas (fail-closed).
--   1. Terapkan migrasi ini di SQL Editor (tidak ada live Postgres
--      di lingkungan dev — eksekusi SQL di produksi BELUM terverifikasi,
--      lihat laporan Wave 3.2).
--   2. Deploy ulang Edge Function telegram-bot (lookup OTP kini HMAC).
--      Pairing lama (hash SHA-256 polos, max 10 menit) dihapus oleh
--      migrasi ini dan tidak berlaku lagi — pengguna cukup buat kode baru.
--   3. Pekerjaan agen LAIN (bukan migrasi ini):
--      a. Cron: panggil public.purge_expired_telegram_pairings()
--         secara berkala (mis. tiap jam) dengan service_role.
--      b. admin-user-ops & admin-password: ganti direct insert
--         service_role ke admin_audit_logs menjadi RPC
--         admin_log_action (bentuk panggilan ada di komentar §3).
--      c. telegram-bot/jobs.ts (price refresh): boleh set
--         app.asset_history_source='price_refresh' sebelum UPDATE
--         assets agar riwayat mencatat sumber itu (saat ini tercatat
--         sebagai 'manual').
--
-- RISIKO RESIDUAL (didokumentasikan, bukan disembunyikan):
--   R1. Webhook bot BERSAMA (tanpa ?bot=<link_secret>): knownUid null,
--       sehingga lookup pairing OTP bersifat GLOBAL (hanya otp_hash).
--       Mitigasi yang sudah ada: OTP single-use (DELETE saat dipakai),
--       kedaluwarsa 10 menit, throttle percobaan per chat_id, dan kini
--       HMAC dengan pepper server-side. Risiko hilang sepenuhnya hanya
--       bila webhook bot bersama dimatikan dan semua pengguna memakai
--       bot personal (Gelombang 2.2).
--   R2. admin_log_action() via service_role: actor HARUS diteruskan
--       eksplisit (p_actor_user_id) karena JWT service_role tidak
--       membawa auth.uid(). Edge function yang lupa meneruskannya
--       akan DITOLAK (fail-closed).
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- §1 is_admin() — TIDAK ADA PERUBAHAN KODE (S8)
-- Definisi final yang benar sudah ada di
-- 20261115040200_application_hardening.sql:17-29
-- (role = 'admin' AND status = 'active', security definer, stable,
--  set search_path = public; grant di :32-34). Versi lama (role saja)
-- ada di 20261114000000:20-29 dan sudah digantikan; tidak ada migrasi
-- sesudah 20261115040200 yang mendefinisikan ulang fungsi ini.
-- Verifikasi produksi (owner, SQL Editor):
--   SELECT pg_get_functiondef('public.is_admin()'::regprocedure);
-- Hasil harus memuat "status = 'active'". Tes otomatis:
-- tests/wave3-database.test.js (§1).
-- ============================================================

-- ============================================================
-- §2 OTP pairing — HMAC-SHA256 + throttle + purge (S9)
-- ============================================================

-- Pairing lama (hash SHA-256 polos) tidak bisa dipakai lagi di bawah
-- HMAC dan berumur max 10 menit — hapus semuanya supaya tidak ada
-- hash lama yang tertinggal.
delete from public.telegram_pairings;

-- Pepper HMAC: dibaca dari Supabase Vault (secret
-- 'telegram_otp_hmac_secret'). NAMA secret di sini hanya placeholder
-- penunjuk — NILAINYA harus diset di produksi (Dashboard -> Vault),
-- tidak pernah ditulis di repo ini. Fungsi ini sengaja TIDAK diberi
-- grant ke authenticated: hanya security-definer pemanggil (RPC di
-- bawah) yang boleh memakainya; panggilan langsung ditolak.
create or replace function public.telegram_otp_pepper()
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'telegram_otp_hmac_secret';
  exception when undefined_table then
    raise exception 'Vault belum aktif: secret telegram_otp_hmac_secret tidak dapat dibaca. Aktifkan Supabase Vault dan buat secret tersebut.';
  end;
  if v_secret is null or btrim(v_secret) = '' then
    raise exception 'Secret telegram_otp_hmac_secret belum diset di Supabase Vault. Buat secret tersebut sebelum pairing Telegram dipakai.';
  end if;
  return v_secret;
end;
$$;

revoke all on function public.telegram_otp_pepper() from public, anon, authenticated;

-- HMAC-SHA256 hex dari OTP dengan pepper Vault. Nilai ini yang disimpan
-- sebagai otp_hash dan yang dihitung webhook saat lookup — HARUS identik
-- dengan crypto.subtle HMAC di telegram-bot/index.ts (kunci = pepper
-- UTF-8, pesan = OTP UTF-8). SHA-256 polos (10^8 kandidat untuk OTP
-- 8 digit) tidak lagi dipakai di mana pun.
create or replace function public.telegram_otp_hash(p_otp text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select encode(extensions.hmac(p_otp, public.telegram_otp_pepper(), 'sha256'), 'hex');
$$;

revoke all on function public.telegram_otp_hash(text) from public, anon, authenticated;

-- Throttle pembuatan OTP per pengguna: max 5 per 10 menit (pola yang
-- sama dengan telegram_pairing_attempts di 20261115040200:72-106,
-- yang memakai chat_id; tabel ini memakai user_id karena pembuatan
-- OTP terjadi dari klien yang sudah login).
create table if not exists public.telegram_otp_creation_attempts (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts         integer not null default 0 check (attempts >= 0)
);

alter table public.telegram_otp_creation_attempts enable row level security;
revoke all on public.telegram_otp_creation_attempts from public, anon, authenticated;
-- Sengaja tanpa policy: hanya RPC security-definer di bawah yang menulis.

-- replace_telegram_pairing: HMAC (bukan SHA-256 polos) + throttle.
-- Perilaku lain tidak berubah: OTP 8 digit, hash sebagai PK, hapus
-- pairing lama pengguna, kedaluwarsa 10 menit, single-use (webhook
-- DELETE saat dipakai).
create or replace function public.replace_telegram_pairing(p_otp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
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

  insert into public.telegram_otp_creation_attempts as current_attempts
    (user_id, window_started_at, attempts)
  values (auth.uid(), now(), 1)
  on conflict (user_id) do update
    set window_started_at = case
          when current_attempts.window_started_at <= now() - interval '10 minutes'
            then now()
          else current_attempts.window_started_at
        end,
        attempts = case
          when current_attempts.window_started_at <= now() - interval '10 minutes'
            then 1
          else current_attempts.attempts + 1
        end
  returning attempts into v_attempts;

  if v_attempts > 5 then
    raise exception 'Terlalu banyak pembuatan kode pairing. Tunggu 10 menit sebelum mencoba lagi.';
  end if;

  delete from public.telegram_pairings
   where user_id = auth.uid();

  insert into public.telegram_pairings (otp_hash, user_id, expires_at)
  values (public.telegram_otp_hash(p_otp), auth.uid(), now() + interval '10 minutes');
end;
$$;

revoke all on function public.replace_telegram_pairing(text) from public, anon;
grant execute on function public.replace_telegram_pairing(text) to authenticated;

-- Pembersih baris pairing kedaluwarsa. Mengembalikan jumlah baris yang
-- dihapus. Dijalankan oleh CRON (agen lain) dengan service_role, mis.:
--   select public.purge_expired_telegram_pairings();
create or replace function public.purge_expired_telegram_pairings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.telegram_pairings
   where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_telegram_pairings() from public, anon, authenticated;
grant execute on function public.purge_expired_telegram_pairings() to service_role;

-- ============================================================
-- §3 Audit log — cabut INSERT langsung, allowlist, append-only,
--     hash-chain (S10)
-- ============================================================

-- (1) Cabut tulis langsung: semua penulisan audit HARUS lewat
-- admin_log_action() di bawah. SELECT untuk admin tetap diizinkan
-- (policy admins_read_audit_logs + grant select dipertahankan).
drop policy if exists "admins_insert_audit_logs" on public.admin_audit_logs;
revoke insert on public.admin_audit_logs from authenticated;

-- (2) admin_log_action() dengan allowlist aksi + dukungan service_role.
-- Aksi yang diizinkan = aksi yang BENAR-BENAR dipakai hari ini:
--   - admin-user-ops/index.ts: role_user, role_admin,
--     status_active, status_suspended, unlink_telegram, delete_user
--     (role_/status_ dibangun sebagai `role_${newValue}` /
--     `status_${newValue}` di sana)
--   - admin_unlink_user_telegram (SQL): unlink_telegram
--   - web/supabase-admin.js logAdminActionSafe('reset_password', ...)
--     setelah reset password admin: reset_password
--   - admin-password/index.ts saat ini BELUM menulis audit; saat agen
--     lain menyambungkannya, ia memakai 'reset_password' (sudah diizinkan).
-- Aksi lain ditolak — admin tidak bisa lagi menyisipkan baris audit
-- dengan action bebas.
-- BENTUK PANGGILAN (untuk agen yang memindahkan edge function dari
-- direct insert ke RPC — direct insert service_role tetap jalan
-- sampai pemindahan itu, karena service_role bypass RLS):
--   Dari klien admin (JWT pengguna, actor diambil dari auth.uid()):
--     sb.rpc('admin_log_action', { p_action: 'role_admin',
--       p_target_user_id: userId, p_target_email: email, p_details: {...} })
--   Dari edge function (service_role, actor WAJIB eksplisit karena
--   JWT service_role tidak membawa auth.uid()):
--     adminClient.rpc('admin_log_action', { p_action: 'delete_user',
--       p_target_user_id: userId, p_target_email: email, p_details: {...},
--       p_actor_user_id: authData.user.id,
--       p_actor_email: requester.email || '' })
-- Tanda tangan berubah (2 parameter tambahan dengan default), jadi
-- fungsi lama (4 argumen) di-DROP dulu — kalau tidak, overload lama
-- tanpa allowlist akan tetap ada dan bisa dipanggil.
drop function if exists public.admin_log_action(text, uuid, text, jsonb);
create or replace function public.admin_log_action(
  p_action text,
  p_target_user_id uuid default null,
  p_target_email text default '',
  p_details jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_email text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_email text := '';
  v_action text := btrim(coalesce(p_action, ''));
begin
  if v_action !~ '^(role_(user|admin)|status_(active|suspended)|unlink_telegram|delete_user|reset_password)$' then
    raise exception 'Aksi audit tidak dikenal: %', left(v_action, 60);
  end if;

  if auth.role() = 'service_role' then
    -- Panggilan server-side (edge function): actor wajib diteruskan
    -- eksplisit, karena JWT service_role tidak membawa auth.uid().
    if p_actor_user_id is null then
      raise exception 'admin_log_action via service_role wajib menyertakan p_actor_user_id.';
    end if;
    v_actor_id := p_actor_user_id;
    v_actor_email := left(coalesce(p_actor_email, ''), 160);
  else
    if not public.is_admin() then
      raise exception 'Hanya admin aktif yang dapat mencatat audit log.';
    end if;
    v_actor_id := auth.uid();
    select coalesce(email, '') into v_actor_email from public.profiles where id = v_actor_id;
  end if;

  insert into public.admin_audit_logs (
    actor_user_id, actor_email, action, target_user_id, target_email, details
  ) values (
    v_actor_id, coalesce(v_actor_email, ''), v_action,
    p_target_user_id, left(coalesce(p_target_email, ''), 160), coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_log_action(text, uuid, text, jsonb, uuid, text) from public, anon;
grant execute on function public.admin_log_action(text, uuid, text, jsonb, uuid, text) to authenticated, service_role;

-- (3) Append-only: trigger BEFORE UPDATE OR DELETE yang selalu menolak.
-- Trigger jalan untuk SEMUA role, termasuk service_role (service_role
-- bypass RLS, tapi TIDAK bypass trigger) dan pemilik DB. Satu-satunya
-- cara menghapus baris audit adalah menonaktifkan trigger ini secara
-- eksplisit (butuh akses owner) — tindakan itu sendiri tidak tercatat,
-- jadi ini perlindungan terhadap penghapusan tak sengaja / lewat
-- aplikasi, bukan terhadap pemilik DB yang berniat jahat.
create or replace function public.prevent_admin_audit_logs_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'admin_audit_logs bersifat append-only: % tidak diizinkan (termasuk untuk service_role).', tg_op;
  return null;
end;
$$;

drop trigger if exists trg_admin_audit_logs_append_only on public.admin_audit_logs;
create trigger trg_admin_audit_logs_append_only
  before update or delete on public.admin_audit_logs
  for each row execute function public.prevent_admin_audit_logs_mutation();

revoke all on function public.prevent_admin_audit_logs_mutation() from public, anon;
grant execute on function public.prevent_admin_audit_logs_mutation() to authenticated, service_role;

-- (4) Hash-chain (opsional, berhasil dibuat bersih): tiap baris audit
-- baru dirantai ke entry_hash baris sebelumnya. Baris lama (sebelum
-- migrasi ini) punya prev_hash/entry_hash NULL dan dilewati verifikasi.
-- Verifikasi rantai (owner/admin, SQL Editor):
--   SELECT public.verify_admin_audit_log_chain();
-- Hasil NULL = rantai utuh; hasil UUID = id baris pertama yang rusak
-- (prev_hash tidak cocok atau entry_hash tidak cocok).
alter table public.admin_audit_logs add column if not exists prev_hash text;
alter table public.admin_audit_logs add column if not exists entry_hash text;

create or replace function public.chain_admin_audit_log_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
begin
  select entry_hash into v_prev
    from public.admin_audit_logs
   where entry_hash is not null
   order by created_at desc, id desc
   limit 1;
  new.prev_hash := v_prev;
  -- created_at dipaksa ke UTC agar hash deterministik apa pun TimeZone sesi.
  new.entry_hash := encode(
    extensions.digest(
      coalesce(v_prev, '') || '|' ||
      coalesce(new.actor_user_id::text, '') || '|' ||
      coalesce(new.actor_email, '') || '|' ||
      coalesce(new.action, '') || '|' ||
      coalesce(new.target_user_id::text, '') || '|' ||
      coalesce(new.target_email, '') || '|' ||
      coalesce(new.details::text, '') || '|' ||
      to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'sha256'),
    'hex');
  return new;
end;
$$;

drop trigger if exists trg_admin_audit_logs_hash_chain on public.admin_audit_logs;
create trigger trg_admin_audit_logs_hash_chain
  before insert on public.admin_audit_logs
  for each row execute function public.chain_admin_audit_log_entry();

revoke all on function public.chain_admin_audit_log_entry() from public, anon;
grant execute on function public.chain_admin_audit_log_entry() to authenticated, service_role;

create or replace function public.verify_admin_audit_log_chain()
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  r record;
  v_expected_prev text := null;
  v_expected_hash text;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'Hanya admin aktif yang dapat memverifikasi rantai audit log.';
  end if;
  for r in select * from public.admin_audit_logs order by created_at asc, id asc loop
    if r.entry_hash is null then
      -- Baris legacy (sebelum hash-chain): lewati; rantai dimulai dari
      -- baris ber-hash pertama.
      continue;
    end if;
    if r.prev_hash is distinct from v_expected_prev then
      return r.id;
    end if;
    v_expected_hash := encode(
      extensions.digest(
        coalesce(v_expected_prev, '') || '|' ||
        coalesce(r.actor_user_id::text, '') || '|' ||
        coalesce(r.actor_email, '') || '|' ||
        coalesce(r.action, '') || '|' ||
        coalesce(r.target_user_id::text, '') || '|' ||
        coalesce(r.target_email, '') || '|' ||
        coalesce(r.details::text, '') || '|' ||
        to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        'sha256'),
      'hex');
    if r.entry_hash <> v_expected_hash then
      return r.id;
    end if;
    v_expected_prev := r.entry_hash;
  end loop;
  return null;
end;
$$;

revoke all on function public.verify_admin_audit_log_chain() from public, anon;
grant execute on function public.verify_admin_audit_log_chain() to authenticated, service_role;

-- ============================================================
-- §4 prevent_admin_lockout() — cabang DELETE untuk semua actor (S11)
-- Versi 20261118000000:4-52 membungkus cabang DELETE dengan
-- `if auth.uid() is not null`, sehingga penghapusan sebagai
-- service_role (auth.uid() null — mis. auth.admin.deleteUser() dari
-- admin-user-ops, yang cascade ke profiles) MELEWATI cek admin
-- terakhir. Perbaikan: hapus pembungkus itu; cek admin terakhir kini
-- jalan untuk SETIAP actor termasuk service_role dan pemilik DB.
-- Cabang UPDATE tidak diubah. Advisory lock dipertahankan supaya dua
-- penghapusan admin terakhir yang bersamaan tidak bisa dua-duanya
-- lolos (tepat satu yang berhasil).
-- ============================================================

create or replace function public.prevent_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_other_admin boolean;
begin
  if tg_op = 'UPDATE' then
    if old.id = auth.uid() and (new.role <> 'admin' or new.status <> 'active') then
      raise exception 'Admin tidak dapat menonaktifkan atau menurunkan role akunnya sendiri.';
    end if;

    if old.role = 'admin' and old.status = 'active'
       and (new.role <> 'admin' or new.status <> 'active') then
      perform pg_advisory_xact_lock(20261118, 1);
      select exists (
        select 1
        from public.profiles
        where id <> old.id and role = 'admin' and status = 'active'
      ) into has_other_admin;
      if not has_other_admin then
        raise exception 'Harus ada minimal satu administrator aktif di sistem.';
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    -- S11: TIDAK ADA lagi pembungkus `auth.uid() is not null` di sini.
    -- Cek admin terakhir berlaku untuk semua actor, termasuk
    -- service_role (auth.uid() null) dan pemilik DB / SQL Editor.
    if old.role = 'admin' and old.status = 'active' then
      perform pg_advisory_xact_lock(20261118, 1);
      select exists (
        select 1
        from public.profiles
        where id <> old.id and role = 'admin' and status = 'active'
      ) into has_other_admin;
      if not has_other_admin then
        raise exception 'Harus ada minimal satu administrator aktif di sistem.';
      end if;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_prevent_admin_lockout on public.profiles;
create trigger trg_prevent_admin_lockout
  before update or delete on public.profiles
  for each row execute function public.prevent_admin_lockout();

revoke all on function public.prevent_admin_lockout() from public, anon;
grant execute on function public.prevent_admin_lockout() to authenticated, service_role;

-- ============================================================
-- §5 Riwayat perubahan aset & target keuangan (S12)
-- Sebelumnya TIDAK ADA jejak perubahan: top_up / liquidate /
-- contribute hanya mencatat baris transaksi/transfer bila wallet
-- tidak null, refresh harga dan tulis langsung klien tidak tercatat
-- sama sekali. Sekarang setiap perubahan quantity/buy_price/value
-- aset dan target_amount/current_amount target tercatat.
--
-- CARA KERJA (dua penulis, tanpa duplikasi):
--   * RPC (top_up_asset, liquidate_asset, create_asset_with_expense,
--     contribute_to_goal) SELALU menyisipkan satu baris riwayat
--     langsung — termasuk saat p_wallet_id NULL (wallet_id tercatat
--     NULL di riwayat) — lalu menandai transaksi ini dengan
--     app.asset_history_skip / app.goal_history_skip = '1' agar
--     trigger di bawah tidak mencatat baris kedua.
--   * Trigger AFTER INSERT OR UPDATE OR DELETE mencatat SEMUA
--     perubahan lain: tulis langsung dari klien, refresh harga
--     (telegram-bot/jobs.ts, web/supabase-portfolio.js), dan edge
--     function lain. Sumbernya 'manual' kecuali pemanggil sempat
--     menandai app.asset_history_source / app.goal_history_source
--     (mis. 'price_refresh') sebelum mutasi.
--   * asset_id / goal_id SENGAJA tanpa foreign key: riwayat harus
--     bertahan saat aset/target dihapus (mis. liquidate habis yang
--     men-DELETE baris aset). Nama aset/target didenormalisasi ke
--     kolom asset_name / goal_name supaya baris riwayat tetap bermakna.
-- ============================================================

create table if not exists public.asset_value_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  asset_id      uuid,
  asset_name    text not null default '',
  source        text not null check (source in ('purchase', 'top_up', 'liquidate', 'price_refresh', 'manual', 'goal')),
  old_quantity  numeric,
  new_quantity  numeric,
  old_buy_price numeric,
  new_buy_price numeric,
  old_value     numeric,
  new_value     numeric,
  wallet_id     uuid references public.wallets(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.financial_goal_history (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  goal_id            uuid,
  goal_name          text not null default '',
  source             text not null check (source in ('goal', 'manual')),
  old_target_amount  numeric,
  new_target_amount  numeric,
  old_current_amount numeric,
  new_current_amount numeric,
  actor              uuid,
  created_at         timestamptz not null default now()
);

create index if not exists asset_value_history_user_asset_idx
  on public.asset_value_history (user_id, asset_id, created_at desc);
create index if not exists financial_goal_history_user_goal_idx
  on public.financial_goal_history (user_id, goal_id, created_at desc);

alter table public.asset_value_history enable row level security;
alter table public.financial_goal_history enable row level security;

drop policy if exists "users_read_own_asset_history" on public.asset_value_history;
create policy "users_read_own_asset_history" on public.asset_value_history
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "users_insert_own_asset_history" on public.asset_value_history;
create policy "users_insert_own_asset_history" on public.asset_value_history
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users_read_own_goal_history" on public.financial_goal_history;
create policy "users_read_own_goal_history" on public.financial_goal_history
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "users_insert_own_goal_history" on public.financial_goal_history;
create policy "users_insert_own_goal_history" on public.financial_goal_history
  for insert to authenticated
  with check (user_id = auth.uid());

-- Tanpa policy UPDATE/DELETE: riwayat bersifat append-only untuk klien.
-- RPC security-invoker menyisipkan lewat policy INSERT di atas;
-- trigger security-definer di bawah bypass RLS sebagai owner.
revoke all on public.asset_value_history from public, anon;
revoke all on public.financial_goal_history from public, anon;
grant select, insert on public.asset_value_history to authenticated;
grant select, insert on public.financial_goal_history to authenticated;

-- Trigger aset: INSERT (pembelian / buat langsung), UPDATE (hanya bila
-- quantity/buy_price/value berubah — ganti nama saja tidak dicatat),
-- DELETE (aset terjual habis / dihapus).
create or replace function public.record_asset_value_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := coalesce(nullif(current_setting('app.asset_history_source', true), ''), 'manual');
  v_wallet uuid := nullif(current_setting('app.asset_history_wallet_id', true), '')::uuid;
begin
  -- RPC sudah mencatat barisnya sendiri (lihat §5 di bawah): jangan ganda.
  if current_setting('app.asset_history_skip', true) = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE'
     and old.quantity is not distinct from new.quantity
     and old.buy_price is not distinct from new.buy_price
     and old.value is not distinct from new.value then
    return new;
  end if;
  if v_source not in ('purchase', 'top_up', 'liquidate', 'price_refresh', 'manual', 'goal') then
    v_source := 'manual';
  end if;

  insert into public.asset_value_history (
    user_id, asset_id, asset_name, source,
    old_quantity, new_quantity, old_buy_price, new_buy_price,
    old_value, new_value, wallet_id
  ) values (
    coalesce(new.user_id, old.user_id),
    coalesce(new.id, old.id),
    coalesce(new.name, old.name, ''),
    v_source,
    case when tg_op = 'INSERT' then null else old.quantity end,
    case when tg_op = 'DELETE' then null else new.quantity end,
    case when tg_op = 'INSERT' then null else old.buy_price end,
    case when tg_op = 'DELETE' then null else new.buy_price end,
    case when tg_op = 'INSERT' then null else old.value end,
    case when tg_op = 'DELETE' then null else new.value end,
    v_wallet
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists trg_asset_value_history on public.assets;
create trigger trg_asset_value_history
  after insert or update or delete on public.assets
  for each row execute function public.record_asset_value_change();

revoke all on function public.record_asset_value_change() from public, anon;
grant execute on function public.record_asset_value_change() to authenticated, service_role;

-- Trigger target keuangan: UPDATE (hanya bila target/current berubah),
-- DELETE. INSERT tidak dicatat sebagai riwayat perubahan (target baru
-- belum punya "perubahan"; pembuatan target tetap terlihat dari baris
-- financial_goals itu sendiri).
create or replace function public.record_financial_goal_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := coalesce(nullif(current_setting('app.goal_history_source', true), ''), 'manual');
begin
  if current_setting('app.goal_history_skip', true) = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE'
     and old.target_amount is not distinct from new.target_amount
     and old.current_amount is not distinct from new.current_amount then
    return new;
  end if;
  if v_source not in ('goal', 'manual') then
    v_source := 'manual';
  end if;

  insert into public.financial_goal_history (
    user_id, goal_id, goal_name, source,
    old_target_amount, new_target_amount,
    old_current_amount, new_current_amount, actor
  ) values (
    coalesce(new.user_id, old.user_id),
    coalesce(new.id, old.id),
    coalesce(new.name, old.name, ''),
    v_source,
    case when tg_op = 'INSERT' then null else old.target_amount end,
    case when tg_op = 'DELETE' then null else new.target_amount end,
    case when tg_op = 'INSERT' then null else old.current_amount end,
    case when tg_op = 'DELETE' then null else new.current_amount end,
    auth.uid()
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists trg_financial_goal_history on public.financial_goals;
create trigger trg_financial_goal_history
  after update or delete on public.financial_goals
  for each row execute function public.record_financial_goal_change();

revoke all on function public.record_financial_goal_change() from public, anon;
grant execute on function public.record_financial_goal_change() to authenticated, service_role;

-- ============================================================
-- §5 (lanjutan) + §6 — RPC aset/target ditulis ulang
-- Salinan definisi terakhir masing-masing fungsi (lihat sumber di
-- komentar tiap fungsi) dengan perubahan Wave 3.2 saja; logika
-- bisnis lain tidak diubah.
-- ============================================================

-- ---------- create_asset_with_expense (S13 + S12) ----------
-- Sumber terakhir: 20261120000000 §2.
-- Perubahan: (a) guard negatif di depan — p_quantity < 0 atau
-- p_buy_price < 0 (bila tidak null) ditolak SEBELUM cabang per tipe,
-- sehingga keenam tipe tercakup (cabang Crypto/Emas/USD tetap
-- mempertahankan syarat <= 0-nya masing-masing); (b) baris riwayat
-- 'purchase' selalu dicatat (trigger di-skip untuk mutasi ini).
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
  v_asset_id uuid;
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

  -- S13: guard negatif di depan — berlaku untuk SEMUA tipe. Sebelumnya
  -- Emas/USD diam-diam membuang buy_price negatif (dihitung ulang) dan
  -- cabang Saham/Cash/Other meloloskan quantity/buy_price negatif
  -- (nullif hanya menyaring nol).
  if (p_quantity is not null and p_quantity < 0)
      or (p_buy_price is not null and p_buy_price < 0) then
    raise exception 'Quantity dan harga beli aset tidak boleh negatif.';
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

  -- S12: trigger riwayat di-skip untuk INSERT ini; baris riwayat
  -- 'purchase' dicatat langsung di bawah (selalu, tidak tergantung wallet).
  perform set_config('app.asset_history_skip', '1', true);
  perform set_config('app.asset_history_source', 'purchase', true);

  insert into public.assets
    (user_id, name, type, symbol, quantity, buy_price, value)
  values
    (auth.uid(), asset_name, p_type, asset_symbol, asset_qty, asset_buy_price, purchase_amount)
  returning id into v_asset_id;

  insert into public.asset_value_history
    (user_id, asset_id, asset_name, source,
     old_quantity, new_quantity, old_buy_price, new_buy_price,
     old_value, new_value, wallet_id)
  values
    (auth.uid(), v_asset_id, asset_name, 'purchase',
     null, asset_qty, null, asset_buy_price,
     null, purchase_amount, p_wallet_id);

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

-- ---------- top_up_asset (S12) ----------
-- Sumber terakhir: 20261120000000 §3. Guard negatif p_price /
-- p_quantity sudah ada di sana dan dipertahankan. Perubahan: baris
-- riwayat 'top_up' SELALU dicatat (termasuk saat p_wallet_id NULL —
-- wallet_id tercatat NULL), bukan hanya bila wallet ada. Baris
-- transfers tetap hanya bila wallet tidak null (transfer memang
-- butuh dompet asal); yang tidak boleh hilang adalah JEJAK asetnya.
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
  v_old_quantity numeric;
  v_old_buy_price numeric;
  v_old_value numeric;
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

  v_old_quantity := asset_row.quantity;
  v_old_buy_price := asset_row.buy_price;
  v_old_value := asset_row.value;

  -- S12: tandai agar trigger riwayat tidak mencatat ganda; baris
  -- riwayat dicatat langsung di bawah — SELALU, tanpa syarat wallet.
  perform set_config('app.asset_history_skip', '1', true);
  perform set_config('app.asset_history_source', 'top_up', true);
  perform set_config('app.asset_history_wallet_id', coalesce(p_wallet_id::text, ''), true);

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

  -- Nilai baru dibaca ulang (satu-satunya sumber benar setelah UPDATE).
  select *
    into asset_row
    from public.assets
   where id = p_asset_id and user_id = auth.uid();

  -- S12: JEJAK SELALU DICATAT — tidak dibungkus `if p_wallet_id is not null`.
  insert into public.asset_value_history
    (user_id, asset_id, asset_name, source,
     old_quantity, new_quantity, old_buy_price, new_buy_price,
     old_value, new_value, wallet_id)
  values
    (auth.uid(), p_asset_id, asset_row.name, 'top_up',
     v_old_quantity, asset_row.quantity, v_old_buy_price, asset_row.buy_price,
     v_old_value, asset_row.value, p_wallet_id);

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

-- ---------- liquidate_asset (S12 + S13) ----------
-- Sumber terakhir: 20261120000000 §4.
-- Perubahan: (a) guard p_quantity < 0 (S13 — sebelumnya quantity
-- negatif diam-diam diabaikan karena hanya `p_quantity > 0` yang
-- dipakai); (b) baris riwayat 'liquidate' SELALU dicatat, termasuk
-- saat p_wallet_id NULL dan saat aset terhapus seluruhnya
-- (new_* tercatat 0). Baris transactions tetap hanya bila wallet
-- tidak null (pemasukan butuh dompet tujuan).
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
  asset_after public.assets%rowtype;
  v_found_after boolean := false;
  sell_amount numeric;
  sold_qty numeric := 0;
  remaining_val numeric;
  remaining_qty numeric := 0;
  v_old_quantity numeric;
  v_old_buy_price numeric;
  v_old_value numeric;
  v_new_quantity numeric;
  v_new_value numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  sell_amount := round(coalesce(p_amount, 0), 2);
  if sell_amount <= 0 then
    raise exception 'Nominal pencairan harus lebih dari nol.';
  end if;

  -- S13: quantity negatif ditolak tegas (bukan diam-diam diabaikan).
  if p_quantity is not null and p_quantity < 0 then
    raise exception 'Quantity pencairan tidak boleh negatif.';
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

  v_old_quantity := asset_row.quantity;
  v_old_buy_price := asset_row.buy_price;
  v_old_value := asset_row.value;

  -- S12: tandai agar trigger riwayat tidak mencatat ganda.
  perform set_config('app.asset_history_skip', '1', true);
  perform set_config('app.asset_history_source', 'liquidate', true);
  perform set_config('app.asset_history_wallet_id', coalesce(p_wallet_id::text, ''), true);

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

  -- Nilai baru: baca ulang; bila aset terhapus seluruhnya, new_* = 0.
  select *
    into asset_after
    from public.assets
   where public.assets.id = p_asset_id and user_id = auth.uid();
  v_found_after := found;
  if v_found_after then
    v_new_quantity := asset_after.quantity;
    v_new_value := asset_after.value;
  else
    v_new_quantity := 0;
    v_new_value := 0;
  end if;

  -- S12: JEJAK SELALU DICATAT — tidak dibungkus `if p_wallet_id is not null`.
  insert into public.asset_value_history
    (user_id, asset_id, asset_name, source,
     old_quantity, new_quantity, old_buy_price, new_buy_price,
     old_value, new_value, wallet_id)
  values
    (auth.uid(), p_asset_id, asset_row.name, 'liquidate',
     v_old_quantity, v_new_quantity, v_old_buy_price,
     case when v_found_after then asset_after.buy_price else 0 end,
     v_old_value, v_new_value, p_wallet_id);

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

-- ---------- contribute_to_goal (S12) ----------
-- Sumber terakhir: 20261118000000 §6.
-- Perubahan: baris riwayat 'goal' SELALU dicatat di
-- financial_goal_history (termasuk saat p_wallet_id NULL — alokasi
-- tanpa dompet tetap mengubah current_amount dan harus punya jejak).
-- Baris transactions tetap hanya bila wallet tidak null.
create or replace function public.contribute_to_goal(
  p_goal_id uuid,
  p_amount numeric,
  p_wallet_id uuid default null,
  p_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  goal_row public.financial_goals%rowtype;
  tx_row public.transactions%rowtype;
  contrib_amount numeric := round(coalesce(p_amount, 0), 2);
  has_tx boolean := false;
  v_old_target numeric;
  v_old_current numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if contrib_amount <= 0 then
    raise exception 'Nominal alokasi target harus lebih dari nol.';
  end if;

  select *
    into goal_row
    from public.financial_goals
   where id = p_goal_id and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Target keuangan tidak ditemukan.';
  end if;

  v_old_target := goal_row.target_amount;
  v_old_current := goal_row.current_amount;

  -- S12: tandai agar trigger riwayat tidak mencatat ganda.
  perform set_config('app.goal_history_skip', '1', true);
  perform set_config('app.goal_history_source', 'goal', true);

  update public.financial_goals
     set current_amount = current_amount + contrib_amount
   where id = p_goal_id and user_id = auth.uid()
   returning * into goal_row;

  -- S12: JEJAK SELALU DICATAT — tidak dibungkus `if p_wallet_id is not null`.
  insert into public.financial_goal_history
    (user_id, goal_id, goal_name, source,
     old_target_amount, new_target_amount,
     old_current_amount, new_current_amount, actor)
  values
    (auth.uid(), p_goal_id, goal_row.name, 'goal',
     v_old_target, goal_row.target_amount,
     v_old_current, goal_row.current_amount, auth.uid());

  if p_wallet_id is not null then
    perform 1
      from public.wallets
     where id = p_wallet_id and user_id = auth.uid()
     for key share;
    if not found then
      raise exception 'Dompet sumber tidak ditemukan.';
    end if;

    insert into public.categories (user_id, tipe, name)
    values (auth.uid(), 'pengeluaran', 'Tabungan & Target')
    on conflict (user_id, tipe, name) do nothing;

    insert into public.transactions
      (user_id, tanggal, tipe, kategori, nominal, keterangan, source, wallet_id)
    values
      (auth.uid(), coalesce(p_date, current_date), 'Pengeluaran', 'Tabungan & Target',
       contrib_amount, 'Alokasi target: ' || goal_row.name, 'web', p_wallet_id)
    returning * into tx_row;
    has_tx := true;
  end if;

  return jsonb_build_object(
    'goal', jsonb_build_object(
      'id', goal_row.id,
      'name', goal_row.name,
      'targetAmount', goal_row.target_amount,
      'currentAmount', goal_row.current_amount,
      'targetDate', coalesce(to_char(goal_row.target_date, 'YYYY-MM-DD'), '')
    ),
    'transaction', case
      when has_tx then jsonb_build_object(
        'id', tx_row.id,
        'tanggal', to_char(tx_row.tanggal, 'YYYY-MM-DD'),
        'tipe', tx_row.tipe,
        'kategori', tx_row.kategori,
        'nominal', tx_row.nominal,
        'keterangan', tx_row.keterangan,
        'walletId', coalesce(tx_row.wallet_id::text, '')
      )
      else null
    end
  );
end;
$$;

revoke all on function public.contribute_to_goal(uuid, numeric, uuid, date) from public, anon;
grant execute on function public.contribute_to_goal(uuid, numeric, uuid, date) to authenticated;

-- ============================================================
-- §6 Guard negatif & CHECK aset (S13) + cap nominal (defense in depth)
-- ============================================================

-- CHECK non-negatif di assets. Pra-cek: bila ada baris yang melanggar
-- di produksi, migrasi GAGAL dengan pesan jelas (bukan diam-diam) —
-- pemilik harus memperbaiki data dulu, baru menerapkan ulang.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from public.assets
   where quantity < 0 or buy_price < 0 or value < 0;
  if v_bad > 0 then
    raise exception 'Wave 3.2 dibatalkan: % baris di public.assets punya quantity/buy_price/value negatif. Perbaiki data dulu sebelum menerapkan migrasi ini.', v_bad;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'assets_nonnegative'
       and conrelid = 'public.assets'::regclass
  ) then
    alter table public.assets
      add constraint assets_nonnegative check (quantity >= 0 and buy_price >= 0 and value >= 0);
  end if;
end $$;

-- Cap nominal (defense in depth untuk grup lain): nominal transaksi /
-- transfer harus > 0 dan <= 999999999999.99. Pra-cek yang sama:
-- gagal keras bila ada baris lama yang melanggar.
do $$
declare
  v_bad_tx integer;
  v_bad_tf integer;
begin
  select count(*) into v_bad_tx
    from public.transactions
   where nominal <= 0 or nominal > 999999999999.99;
  if v_bad_tx > 0 then
    raise exception 'Wave 3.2 dibatalkan: % baris di public.transactions punya nominal <= 0 atau > 999999999999.99. Perbaiki data dulu sebelum menerapkan migrasi ini.', v_bad_tx;
  end if;

  select count(*) into v_bad_tf
    from public.transfers
   where nominal <= 0 or nominal > 999999999999.99;
  if v_bad_tf > 0 then
    raise exception 'Wave 3.2 dibatalkan: % baris di public.transfers punya nominal <= 0 atau > 999999999999.99. Perbaiki data dulu sebelum menerapkan migrasi ini.', v_bad_tf;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'transactions_nominal_capped'
       and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_nominal_capped check (nominal > 0 and nominal <= 999999999999.99);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'transfers_nominal_capped'
       and conrelid = 'public.transfers'::regclass
  ) then
    alter table public.transfers
      add constraint transfers_nominal_capped check (nominal > 0 and nominal <= 999999999999.99);
  end if;
end $$;

commit;

-- ============================================================
-- PASCA-DEPLOY (checklist owner, SQL Editor):
--   1. Vault: secret 'telegram_otp_hmac_secret' sudah dibuat?
--      SELECT count(*) FROM vault.decrypted_secrets
--       WHERE name = 'telegram_otp_hmac_secret';  -- harus 1
--   2. is_admin() final: SELECT pg_get_functiondef(
--      'public.is_admin()'::regprocedure);  -- harus memuat status = 'active'
--   3. Rantai audit utuh: SELECT public.verify_admin_audit_log_chain();
--      -- NULL = utuh
--   4. Uji pairing OTP baru end-to-end (buat kode di web -> /link di bot).
--   5. Uji tolak: DELETE satu-satunya admin aktif sebagai service_role
--      harus gagal; INSERT langsung ke admin_audit_logs sebagai
--      authenticated harus gagal; create_asset_with_expense dengan
--      quantity negatif harus gagal.
-- CATATAN: eksekusi SQL live di produksi BELUM terverifikasi di
-- lingkungan dev (tidak ada Postgres live) — lihat laporan Wave 3.2.
-- ============================================================
