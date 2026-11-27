-- ============================================================
-- Gelombang 2.5 (T13): Idempotency key antrean offline
--
-- Masalah: bila insert server berhasil tapi responsnya hilang
-- (jaringan putus), retry dari antrean offline meng-insert ulang
-- dan membuat baris DUPLIKAT. Mulai migrasi ini, setiap insert
-- antrean offline membawa `idempotency_key` yang dibuat sekali
-- di klien saat enqueue; insert kedua dengan kunci yang sama
-- (untuk pengguna yang sama) ditolak oleh unique index, dan
-- klien lalu mengambil baris yang sudah ada, bukan membuat baru.
--
-- Catatan Postgres: unique index menganggap NULL berbeda dengan
-- NULL lain, jadi baris LAMA (idempotency_key NULL — transaksi
-- online lama, impor, recurring, bot Telegram) tetap boleh
-- ada berdampingan tanpa saling bertabrakan. Hanya baris yang
-- membawa kunci non-NULL yang didedup.
--
-- Semua pernyataan memakai IF NOT EXISTS sehingga migrasi aman
-- dijalankan ulang (idempotent).
-- ============================================================
begin;

-- 1. Kolom kunci pada tabel transaksi.
alter table public.transactions
  add column if not exists idempotency_key text;

-- 2. Satu kunci hanya boleh dipakai sekali per pengguna.
--    Nama index mengikuti konvensi yang sudah ada
--    (transactions_user_tanggal_idx, dst.).
create unique index if not exists transactions_user_idempotency_key_uidx
  on public.transactions (user_id, idempotency_key);

-- 3. Kolom kunci pada tabel transfer.
alter table public.transfers
  add column if not exists idempotency_key text;

-- 4. Satu kunci hanya boleh dipakai sekali per pengguna.
create unique index if not exists transfers_user_idempotency_key_uidx
  on public.transfers (user_id, idempotency_key);

commit;
