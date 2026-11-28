-- ============================================================
-- Fitur admin — Notifikasi in-app untuk admin (pengganti
-- email Resend pada auto-hapus akun dormant).
-- Migrasi: supabase/migrations/20261128110000_admin_notifications.sql
--
-- Latar: peringatan H-1 dan konfirmasi hapus akun dormant semula
-- dikirim via email Resend (migrasi 20261128100000 + edge
-- function account-cleanup). Liandi membatalkan jalur email
-- 2026-11-28 ("gausah by email, terlalu ribet") — peringatan
-- dan konfirmasi kini ditulis sebagai NOTIFIKASI IN-APP yang
-- HANYA terlihat oleh admin, dibaca lewat RPC di bawah dan
-- ditampilkan di panel admin (worker UI).
--
-- Isi:
--   §1  Tabel public.admin_notifications — satu baris per
--         kejadian: 'deletion_warning' (akun akan dihapus
--         besok) atau 'deletion_done' (akun sudah dihapus).
--         target_user_id TANPA foreign key — SENGAJA: baris
--         'deletion_done' harus BERTAHAN setelah akunnya
--         dihapus; FK ke profiles/auth.users akan ikut
--         ter-cascade dan menghapus buktinya. target_email
--         menyimpan alamat yang dicatat SEBELUM penghapusan.
--   §2  RPC get_admin_notifications() — 50 notifikasi terbaru
--         untuk panel admin (kontrak kolom PERSIS dengan worker
--         UI, jangan ubah nama kolom). Hanya admin.
--   §3  RPC mark_admin_notification_read(p_notification_id) —
--         tandai satu notifikasi sudah dibaca (read_at = now(),
--         hanya bila masih NULL). Hanya admin.
--
-- Pola keamanan mengikuti migrasi 20261128100000 (RPC SECURITY
-- DEFINER + public.is_admin() + REVOKE ALL FROM public, anon)
-- dan 20261125120000 (RLS tabel: policy using
-- (public.is_admin())).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION, REVOKE/GRANT aman diulang.
-- Satu transaksi (begin/commit). TIDAK menyentuh migrasi
-- 20261128070000 (WebAuthn draf), edge function, UI, atau
-- web/config.js. TIDAK memakai hmac/digest — bila kelak dipakai,
-- kualifikasi extensions.hmac/extensions.digest (pgcrypto
-- Supabase ada di schema extensions, bukan public).
-- JANGAN memakai to_regproc dengan daftar argumen (selalu NULL);
-- yang benar to_regprocedure — migrasi ini tidak memerlukannya.
-- ============================================================

begin;

-- §1 — Tabel notifikasi in-app khusus admin.
create table if not exists public.admin_notifications (
  id             uuid primary key default gen_random_uuid(),
  type           text not null check (type in ('deletion_warning', 'deletion_done')),
  target_user_id uuid,
  target_email   text,
  title          text not null,
  body           text not null,
  created_at     timestamptz not null default now(),
  read_at        timestamptz
);

create index if not exists idx_admin_notifications_created_at
  on public.admin_notifications (created_at desc);

alter table public.admin_notifications enable row level security;

-- RLS: tidak ada akses langsung dari klien — baca/tulis hanya
-- lewat RPC §2/§3 (admin) dan service_role (edge function).
-- REVOKE ALL dari authenticated dan anon supaya tidak ada jalur
-- lain; service_role bypass RLS sehingga edge function tetap
-- bisa insert.
revoke all on table public.admin_notifications from authenticated, anon;

drop policy if exists "admins_read_notifications" on public.admin_notifications;
create policy "admins_read_notifications" on public.admin_notifications
  for select to authenticated
  using (public.is_admin());

-- §2 — RPC: 50 notifikasi terbaru untuk panel admin.
create or replace function public.get_admin_notifications()
returns table (
  id             uuid,
  type           text,
  target_user_id uuid,
  target_email   text,
  title          text,
  body           text,
  created_at     timestamptz,
  read_at        timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;

  return query
    select
      n.id,
      n.type,
      n.target_user_id,
      n.target_email,
      n.title,
      n.body,
      n.created_at,
      n.read_at
    from public.admin_notifications n
    order by n.created_at desc
    limit 50;
end;
$$;

revoke all on function public.get_admin_notifications() from public, anon;
grant execute on function public.get_admin_notifications() to authenticated;

-- §3 — RPC: tandai satu notifikasi sudah dibaca.
create or replace function public.mark_admin_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;

  update public.admin_notifications
     set read_at = now()
   where id = p_notification_id
     and read_at is null;
end;
$$;

revoke all on function public.mark_admin_notification_read(uuid) from public, anon;
grant execute on function public.mark_admin_notification_read(uuid) to authenticated;

commit;
