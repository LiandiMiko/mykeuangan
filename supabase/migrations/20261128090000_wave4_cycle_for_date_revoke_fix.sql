-- ============================================================
-- Gelombang 4 — Tindak lanjut §1 migrasi 20261128080000:
-- pencabutan EXECUTE cycle_for_date() yang benar-benar jalan.
-- Migrasi: supabase/migrations/20261128090000_wave4_cycle_for_date_revoke_fix.sql
--
-- Dua cacat pada 080000 §1 (ditemukan saat verifikasi produksi
-- 28 Nov 2026, SETELAH 080000 diterapkan):
--   (a) Penjaga memakai to_regproc('public.cycle_for_date(date, int)').
--       to_regproc TIDAK menerima daftar argumen — ia hanya
--       menerima nama fungsi polos (mis. 'public.is_admin()').
--       Dengan daftar argumen ia SELALU mengembalikan NULL,
--       sehingga blok DO selalu mengambil cabang ELSE (NOTICE
--       'belum ada — lewati §1') dan revoke/grant/alter TIDAK
--       PERNAH berjalan. Yang benar: to_regprocedure(...).
--   (b) revoke dari PUBLIC saja tidak menghapus grant eksplisit
--       ke peran anon (di produksi: anon=X tetap ada setelah
--       080000). Tujuan "hanya authenticated" menuntut revoke
--       dari anon juga. cycle_for_date() tidak dipakai klien
--       sama sekali (hanya di dalam view v_transactions yang
--       memang hanya bisa dibaca authenticated), jadi pencabutan
--       ini aman.
-- Perbaikan produksi sudah diterapkan manual oleh Paijo pada
-- 28 Nov 2026 (revoke public+anon, grant authenticated, pin
-- search_path; anon RPC kini 401 permission denied). Migrasi ini
-- membuat perbaikan itu permanen di repo: database baru yang
-- dibangun dari migrasi mendapat §1 yang benar. Idempotent:
-- revoke/grant/alter aman dijalankan ulang; bila fungsi belum
-- ada, blok DO hanya NOTICE.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.cycle_for_date(date, int)') is not null then
    revoke all on function public.cycle_for_date(date, int) from public, anon;
    grant execute on function public.cycle_for_date(date, int) to authenticated;
    alter function public.cycle_for_date(date, int) set search_path = public;
    raise notice 'cycle_for_date(): EXECUTE dicabut dari PUBLIC dan anon; hanya authenticated; search_path dipin ke public.';
  else
    raise notice 'cycle_for_date() belum ada di database ini — lewati perbaikan §1.';
  end if;
end $$;

commit;
