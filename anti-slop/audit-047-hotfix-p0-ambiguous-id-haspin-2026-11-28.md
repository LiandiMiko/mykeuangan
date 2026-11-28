# Audit 047: Hotfix P0 — "column reference id is ambiguous" (42702) + "hasPin is not defined" — 2026-11-28

Status: SELESAI — implementasi + tes selesai 2026-11-28 (branch `fix/hotfix-p0-ambig-id-haspin` dari `origin/main 4871711` / v3.20.17; migrasi baru diterapkan ke produksi SEBELUM merge — lihat "Verifikasi Produksi"; pengujian manual di perangkat fisik belum dilakukan — lihat "Belum Diverifikasi"). **Catatan penomoran:** audit-046 dicadangkan untuk audit performa PWA Gelombang 7d (draf sudah ada di `~/workspace/your_files/audit-performa-pwa-v3-20-15/`, akan masuk repo bersama PR perbaikan 7d); audit hotfix ini memakai 047 supaya tidak tabrakan.

## Cakupan

Laporan Liandi dari aplikasi live v3.20.16 (screenshot 2026-11-28 18:38–18:39 WIB): dua modal "Gagal" pada dua alur inti — (1) `column reference "id" is ambiguous` dan (2) `hasPin is not defined`. Tugas: lacak akar masalah keduanya sampai ke baris yang tepat, perbaiki dengan kualitas yang sama seperti gelombang sebelumnya (bukan tambal asal), tambahkan tes regresi yang mencakup kedua skenario gagal, dan tutup celah sanitizer yang membuat pesan mentah server sampai ke pengguna. Cakupan SQL: semua fungsi `RETURNS TABLE`, trigger, dan RLS policy yang bisa dijalankan kedua alur itu; cakupan klien: `web/ui-feat-account.js` (PIN), `web/error-messages.js` + `web/ui-state.js` (sanitizer), dan jalur transfer (`web/supabase-portfolio.js` → RPC `transfer_between_wallets`).

## Temuan Forensik / Akar Masalah

### BUG 1 — 42702: nama kolom OUT dipakai BARE di badan fungsi PL/pgSQL (4 situs, 3 fungsi)

**Mekanisme (umum, bukan hanya `id`).** Fungsi PL/pgSQL yang mendeklarasikan `RETURNS TABLE (id, kategori, ...)` menciptakan parameter OUT bernama `id`, `kategori`, dst. Bila badan fungsi memakai nama itu BARE di klausa SQL (`where id = ...`, `and kategori = ...`, `returning id`), PL/pgSQL dengan default `#variable_conflict error` tidak bisa memutuskan apakah nama itu variabel PL/pgSQL atau kolom tabel — dan melempar `ERROR: 42702: column reference "id" is ambiguous`. Kelas bugnya adalah **nama kolom OUT apa pun**, bukan hanya `id`.

**Situs-situs (semua TERBUKTI dengan repro rollback terhadap produksi — tiap skrip satu transaksi, temp table + UUID dummy yang tidak cocok dengan baris mana pun, 0 fungsi tes tersisa sesudahnya):**

| # | Fungsi (migrasi asal) | Baris buggy | Dampak live |
|---|---|---|---|
| 1 | `transfer_between_wallets` (20261128050000) | 3× `select * into v_from/v_first_row/v_second_row from public.wallets where id = ... for update` | **Setiap transfer antar dompet gagal** |
| 2 | `save_budget_checked` (20261128130000) | `select * into v_row from public.budgets where user_id = auth.uid() and kategori = btrim(p_kategori) and bulan = p_bulan for update` | **SEMUA simpan anggaran gagal** — SELECT ini statement PERTAMA fungsi, jadi anggaran BARU pun tidak bisa disimpan, bukan hanya yang sudah ada (koreksi atas dugaan awal) |
| 3 | `save_budget_checked` (20261128130000) | `update public.budgets set jumlah = p_jumlah where id = v_row.id` | Simpan anggaran yang sudah ada gagal (tidak pernah tercapai karena situs #2 gagal duluan) |
| 4 | `create_asset_with_expense` (20261128040000) | `returning id into v_asset_id` | **Setiap pembelian aset gagal** |

**Bukti repro (via `sb_mgmt.py db-query`, ref `usauytablxbiktnepwsi`):**
- Repro 1 (`/tmp/repro-ambig-id.sql`): dummy `RETURNS TABLE (id uuid, tanggal date)` + `select * into v_row from public.wallets where id = p_from for update` → persis `ERROR: 42702: column reference "id" is ambiguous / DETAIL: It could refer to either a PL/pgSQL variable or a table column.`
- Repro 2 (`/tmp/repro-ambig-2.sql`): `INSERT ... RETURNING id` di dalam `RETURNS TABLE (id ...)` → 42702.
- Repro 3 (`/tmp/repro-ambig-3.sql`): `UPDATE ... WHERE id = v_row.id` di dalam `RETURNS TABLE (id ...)` → 42702.
- Repro 4a (`/tmp/repro-ambig-4a.sql`): pola SELECT `save_budget_checked` persis (`where user_id = p_uid and kategori = p_k and bulan = p_b for update`) → `ERROR: 42702: column reference "kategori" is ambiguous` (QUERY tercetak lengkap, `PL/pgSQL function _test_c(uuid,text,text) line 4 at SQL statement`).
- Repro 4b (`/tmp/repro-ambig-4b.sql`): pola yang sama dengan kualifikasi alias (`from _t4 as b where b.user_id = ... and b.kategori = ... and b.bulan = ...`) → **lolos**, baris dikembalikan (`TEST_C2_QUALIFIED`, kategori `Makan`, bulan `2026-11`, jumlah `100000`, version `1`).

**Yang diperiksa dan BERSIH (audit `/tmp/audit-ambig.py` atas semua migrasi + pemeriksaan ulang):** `delete_wallet_checked` (returns jsonb, tidak ada variabel `id` — `where id = p_wallet_id` aman); `get_admin_user_activity` (kolom RETURNS TABLE tidak memuat `id`; semua referensi terkualifikasi `p.`/`u.`/`c.`); `update_own_display_name` (returns text; `where id = auth.uid()` aman); `touch_own_activity` (returns void; `where id = auth.uid()` aman); `is_active_user()`/`is_admin()` (EXISTS satu tabel); `fetchWalletsAndTransfers`/`fetchAll` (select satu tabel); trigger `bump_version()` (`new.version := old.version + 1`, tidak ada `id`). Daftar kolom INSERT `(user_id, tanggal, ...)`, target SET (`set jumlah = ...`), daftar INTO (`into id, tanggal, ...`), dan alias (`... as <kolom>`) BUKAN ambiguitas — itu false positive yang wajar dari pemindaian naif.

**Koreksi atas triase audit pertama (pelajaran — baca dengan saksama).** Skrip audit `/tmp/audit-ambig.py` SEBENARNYA sudah menandai situs #2 (`supabase/migrations/20261128130000_optimistic_locking.sql:128-129`, `OUT=kategori :: and kategori = btrim(p_kategori)` dan `OUT=bulan :: and bulan = p_bulan`). Namun hasil itu digolongkan false positive saat triase, karena dalam daftar yang sama ada 5 false positive tulen (daftar kolom INSERT baris 133, komentar baris 149/163, target SET baris 151) dan satu temuan benar lainnya (baris 152, `where id = v_row.id`). Dua baris benar ikut terbuang bersama yang palsu. Tes guard baru (§1 di bawah) memakai pola terfokus (`where`/`and`/`or <kolom> =`, `returning <kolom>`, `order by`/`group by <kolom>`, `select <kolom>,/from`) yang TIDAK menangkap daftar INSERT, komentar, atau target SET — sehingga triase seperti ini tidak terulang.

**Jalur klien yang terdampak (ditelusuri dari kode):** transfer — `openTransferModal` → `api_addTransfer` (`web/supabase-portfolio.js:369`) → `sb.rpc('transfer_between_wallets', ...)`; anggaran — `api_saveBudget` (`web/supabase-planning.js:123-160`) adalah SATU-SATUNYA jalur tulis anggaran (baru: `expectedVersion = null` → insert di dalam RPC; sudah ada: update bersyarat) → semua simpan anggaran melewati SELECT buggy itu; aset — `create_asset_with_expense` dipanggil jalur beli aset. Tidak ada jalur "tarik tunai" terpisah — itu transfer antar dompet.

**Catatan jujur soal urutan laporan Liandi.** Pesan Liandi menyebut error pertama saat set PIN dan kedua saat transfer — tetapi bukti kode menunjukkan sebaliknya: `hasPin is not defined` HANYA bisa muncul dari alur set/ubah PIN (satu-satunya pemanggil `applyAccountSettingsUpdate` adalah modal pengaturan akun), dan `column reference "id" is ambiguous` HANYA bisa muncul dari jalur RPC transfer (atau beli aset / simpan anggaran). Urutan di pesan kemungkinan tertukar; kedua errornya nyata apa pun urutannya.

### BUG 2 — ReferenceError: `hasPin` di luar scope (set/ubah PIN selalu gagal)

`web/ui-feat-account.js`: `const hasPin = Boolean(localStorage.getItem('mk_app_pin_hash'))` hanya ada di `openAccountSettingsModal()` (~baris 602), tetapi `applyAccountSettingsUpdate(val)` memakai `if (hasPin)` di baris ~643 — `hasPin` DI LUAR SCOPE di fungsi itu. Setiap set/ubah PIN (`val.pin` truthy) melempar `ReferenceError: hasPin is not defined`. Satu-satunya pemanggil `applyAccountSettingsUpdate` adalah `openAccountSettingsModal` (baris 627); modal dibuka dari tombol pengaturan (`src/Index.html:173`, `data-action="openAccountSettingsModal"`) dan dari onboarding (`web/ui-feat-onboarding.js:99`). Jadi error ini HANYA berasal dari alur set/ubah PIN — cocok dengan laporan Liandi.

### Celah sanitizer U9 — pesan mentah server sampai ke pengguna

`web/error-messages.js` `toUserErrorMessage` jatuh ke aturan 4 ("teruskan apa adanya") untuk kedua pesan mentah: TECHNICAL_RE memuat `column "` tetapi pesannya `column reference "id"` (setelah `column ` ada kata `reference`, bukan tanda kutip); memuat `is not a function` / `undefined is not` tetapi bukan `is not defined`. `showActionError` (`web/ui-state.js:470`) memang memanggil `toUserErrorMessage` (dengan fallback generik bila helper tidak ada) — celahnya murni pola yang hilang, bukan jalur yang tidak dipakai. Ekspektasi tes lama (Wave 4) tetap berlaku: `'Database error saving new user'` → GENERIK (cocok oleh kata `database`).

## Perubahan yang Diterapkan

### 1. Migrasi BARU `supabase/migrations/20261128140000_hotfix_ambiguous_id.sql` (baru, satu transaksi `begin`/`commit`, idempotent `CREATE OR REPLACE` + `REVOKE`/`GRANT`)

Tiga fungsi diambil UTUH dari definisi terakhirnya di `main`; hanya 10 baris yang berubah (kualifikasi kolom saja — TIDAK ada perubahan logika, signature, atau grants). Migrasi lama yang sudah diterapkan (040000, 050000, 130000) TIDAK diedit.
- §1 `transfer_between_wallets`: 3× `where id = ...` → `where w.id = p_from / v_first_id / v_second_id` (alias `w` sudah ada di `from public.wallets as w`).
- §2 `save_budget_checked`: `from public.budgets` → `from public.budgets as b`; `where user_id = auth.uid() and kategori = ... and bulan = ...` → `where b.user_id = auth.uid() and b.kategori = btrim(p_kategori) and b.bulan = p_bulan`; `update public.budgets set jumlah = p_jumlah where id = v_row.id` → `update public.budgets as b set jumlah = p_jumlah where b.id = v_row.id`.
- §3 `create_asset_with_expense`: `returning id into v_asset_id` → `returning assets.id into v_asset_id`.
- Header migrasi mendokumentasikan akar masalah, keempat situs, koreksi triase, dan bukti repro.

### 2. `web/ui-feat-account.js` — `hasPin` dihitung di dalam `applyAccountSettingsUpdate`

`const hasPin = Boolean(localStorage.getItem('mk_app_pin_hash'));` ditambahkan sebagai baris pertama di dalam `try` (dengan komentar Hotfix P0). Tidak ada perubahan perilaku lain: ubah PIN dengan PIN lama benar tetap `rewrapPinDataKey` (DEK YANG SAMA dibungkus ulang — data tidak perlu dienkripsi ulang); bila PIN lama salah/tidak terverifikasi, fallback `createPinDataKey` + `migrateLocalDataToEncrypted()` agar aplikasi tetap jalan. `root.__mkFeat.applyAccountSettingsUpdate = applyAccountSettingsUpdate;` diekspos untuk tes (mengikuti pola permukaan diagnostik `__mkFeat` yang sudah ada).

### 3. `web/error-messages.js` — TECHNICAL_RE diperluas (celah U9)

Ditambahkan pola `column reference|is ambiguous|is not defined|syntax error|42702|42P0|PGRST` (dengan komentar Hotfix P0 yang menjelaskan mengapa dua pesan live lolos). Efeknya: pesan teknis Postgres/JS kini menjadi GENERIK (`Terjadi kesalahan. Coba lagi.` / `Something went wrong. Please try again.`); detail mentah tetap tercatat di console lewat `showActionError`. Pesan ramah aplikasi sendiri (mis. `Saldo dompet asal tidak mencukupi untuk transfer ini.`, `Dompet asal tidak ditemukan atau bukan milik Anda.`) tetap lolos apa adanya — diuji eksplisit supaya tidak over-generalisasi.

### 4. `tests/hotfix-p0-ambiguous-id.test.js` (baru, 9 tes)

- **§1 guard SQL (2 tes):** memindai DEFINISI EFEKTIF setiap fungsi `RETURNS TABLE` di `supabase/migrations/*.sql` — migrasi diterapkan berurutan berdasarkan nama file, `CREATE OR REPLACE` terakhir per nama fungsi adalah yang berjalan di produksi; definisi lama yang sudah digantikan (040000/050000/130000 masih memuat baris buggy) TIDAK dihitung. Pola terfokus (lihat "Koreksi atas triase" di atas) + asersi bahwa ketiga fungsi efektif dari `20261128140000_hotfix_ambiguous_id.sql` dan memuat bentuk terkualifikasi (`w.id`, `b.kategori`/`b.bulan`, `assets.id`).
- **§2 regresi hasPin (4 tes, sandbox `vm` mengikuti pola `tests/pin-encryption-gating.test.js` — muat `web/ui-feat-offline.js` + `web/ui-feat-account.js`, `webcrypto`, fake localStorage, Swal stub dengan antrean PIN):** set PIN baru (hash `pbkdf2$600000$<hex>` tersimpan + Swal sukses + wrap DEK tersimpan); ubah PIN dengan PIN lama benar (verifikasi lewat `promptVerifyCurrentPin` → `lastVerifiedPin` terisi → DEK objek YANG SAMA sesudah rewrap + hash baru + PIN baru lolos verifikasi, PIN lama tidak); PIN lama salah (verifikasi menolak, lockout tercatat `attempts >= 1`, lalu ubah PIN tetap berhasil lewat fallback DEK baru); ubah nama tampilan saja (memanggil server `api_updateOwnProfile`, `sessionUser` diperbarui, tanpa PIN tidak ada hash yang dibuat). Catatan: fungsi ini menelan error (`catch` → `showActionError` bila ada), jadi tes menegaskan HASIL (hash tersimpan + Swal sukses), bukan "tidak throw" — bila ReferenceError masih ada, kedua hasil itu tidak terjadi.
- **§3 sanitizer (3 tes, pola sandbox Wave 4 §4.2):** kedua pesan mentah P0 digeneralisasi (id dan en) + varian sekeluarga (`column "foo" is ambiguous`, `syntax error ...`, `PGRST204`); `showActionError` menampilkan pesan ramah sementara mentah tetap di console; pesan ramah aplikasi tetap lolos.
- Satu temuan saat menulis tes yang ternyata BUKAN bug (dicatat supaya tidak dilaporkan ulang): `rewrapPinDataKey(pinLamaSalah, pinBaru)` mengembalikan `true` bila DEK sudah ada di memori — itu benar secara desain, karena PIN lama hanya diverifikasi bila DEK belum di memori (jalur unwrap); `lastVerifiedPin` hanya diisi setelah verifikasi berhasil. Tes menguji kontrak yang sebenarnya (kosongkan memori dulu lewat `clearPinDataKey()`: PIN salah → `false`, PIN benar → `true`).

### 5. Bump versi ke 3.20.18 (`versionCode 3020018`)

`package.json` (hanya string versi; versionCode dihitung di `build.mjs`), `src/Index.html` (`<meta name="app-version">` + `#navUpdatesVersion`), `src/updates.html` (`data-latest-release`/`data-latest-version`/`Versi saat ini`, kartu `<article>` baru 3.20.18 sebagai kartu pertama, kartu 3.20.17 diubah menjadi `<details>`, label `Menampilkan 39 rilis` — 39 kartu `data-release-card`), `README.md` (header, badge, nama APK, entri changelog 3.20.18 baru di atas entri 3.20.17 — entri lama dikembalikan isinya setelah sed global sempat ikut mengubahnya), pin versi di tes (`tests/android-m3-ui.test.js:133`, `tests/pro-web-ui.test.js:167,229,354`, `tests/wave-v320-upgrades.test.js:135`).

## Catatan Migrasi Pengguna

- **Tidak ada migrasi data.** Perilaku yang kembali normal: transfer antar dompet, simpan anggaran (baru + ubah), beli aset, set/ubah PIN. Tidak ada yang perlu dilakukan pengguna selain update ke v3.20.18.
- **PIN:** tidak ada perubahan format hash (tetap PBKDF2 600.000, format `pbkdf2$600000$<hex>` dari Gelombang 7b). Pengguna yang PIN-nya gagal diset di v3.20.16/17 tidak punya PIN tersimpan — mereka cukup mengatur PIN seperti biasa setelah update.
- **Anggaran:** anggaran yang gagal disimpan di v3.20.16/17 tidak tersimpan di server (RPC gagal sebelum tulis apa pun) — pengguna perlu menyimpannya ulang setelah update. Tidak ada data yang setengah-tersimpan: RPC berjalan dalam satu transaksi.
- **Transfer/aset:** sama — transfer/aset yang gagal tidak pernah tertulis (RPC gagal sebelum INSERT; percobaan ulang dengan kunci idempotensi yang sama tetap aman).

## Verifikasi

- **PASS (`TZ=Asia/Jakarta node --test`)**: **575/575** (566 baseline v3.20.17 + 9 baru), `node v24.22.1`.
- **PASS (`TZ=UTC node --test`)**: **575/575**.
- **PASS (`node scripts/check-syntax.mjs`)**: 103 JS/MJS, 14 TypeScript, 3 skrip inline HTML.
- **PASS (`git diff --check`)**: bersih.
- **PASS (build nyata, `node build.mjs`)**: `dist/index.html` **332.638 byte** (325 KB), `dist/version.json` v3.20.18 / versionCode 3020018 / releaseId `2026-11-28-v3.20.18` / judul `Update v3.20.18: Transfer, Anggaran, dan PIN Kembali Berfungsi — Perbaikan Darurat`.
- **PASS (`konoha:website_ai_detector` pada `src/`, branch ini)**: skor **0** (`Human-Built`, PASS), 13 file (375.257 byte), `2026-11-28T12:03:17.502Z`.
- **`aislop:aislop_scan` tidak dijalankan**: MCP aislop tidak tersedia di lingkungan ini — tidak ada skor yang dicatat.
- **PASS (repro produksi — lihat tabel Bukti repro di atas)**: 42702 direproduksi untuk keempat pola (repro 1, 2, 3, 4a); pola terkualifikasi lolos (repro 4b). Semua skrip dalam satu transaksi + rollback; verifikasi `pg_proc` sesudahnya: 0 fungsi tes tersisa (`_test_b`, `_test_c`, `_test_c2` = 0).

### Verifikasi Produksi (migrasi diterapkan SEBELUM merge)

- **PASS (terapkan `20261128140000_hotfix_ambiguous_id.sql` via `sb_mgmt.py db-query`, ref `usauytablxbiktnepwsi`)**: diterapkan 2026-11-28 ~19:05 WIB (hasil `[]`, tanpa error). **Kejujuran proses:** percobaan pertama GAGAL dengan `ERROR: 42601: syntax error at or near "grant"` (baris 436) — skrip generator migrasi menghilangkan baris lanjutan `from public, anon;` / `to authenticated;` pada `revoke`/`grant` `create_asset_with_expense` (di berkas asli 040000 kedua statement itu terbagi dua baris). Karena seluruh skrip berjalan dalam satu transaksi, kegagalan itu rollback total — TIDAK ADA yang diterapkan. Baris lanjutan dipulihkan, lalu seluruh isi migrasi diverifikasi ketat terhadap definisi asli (`/tmp/verify-hotfix-migration-diff2.py`): badan ketiga fungsi hanya berbeda pada 10 baris kualifikasi (transfer 3, save_budget 6, create_asset 1) dan grants sama persis — baru kemudian diterapkan ulang dan berhasil.
- **PASS (probe negatif `transfer_between_wallets` pasca-perbaikan)**: panggil dengan UUID dummy + `set_config('request.jwt.claims', '{"sub": "<uuid>"}', true)` (`/tmp/probe-transfer-neg.sql`, rollback) → `ERROR: P0001: Dompet asal tidak ditemukan atau bukan milik Anda.` (PL/pgSQL line 59 at RAISE) — pesan bisnis yang diharapkan, BUKAN 42702. SELECT dompet (`where w.id = p_from for update`) berjalan normal; tidak ada tulis yang terjadi sebelum pengecekan.
- **PASS (`pg_get_functiondef` ketiga fungsi, live)**: `transfer_between_wallets` memuat `where w.id = p_from`, `where w.id = v_first_id`, `where w.id = v_second_id`; `save_budget_checked` memuat `and b.kategori = btrim(p_kategori)`, `and b.bulan = p_bulan`, `where b.id = v_row.id`; `create_asset_with_expense` memuat `returning assets.id into v_asset_id` (semua dicek sebagai boolean `true` per fungsi; `false` untuk pola fungsi lain — sesuai).
- **PASS (ACL ketiga fungsi, live)**: `proacl = {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}` — TIDAK ada entri PUBLIC/`anon` → hanya `authenticated` (dan service_role seperti sebelumnya) yang bisa mengeksekusi, sesuai pola Gelombang 4.

## Belum Diverifikasi

- **Pengujian ulang manual di perangkat Liandi** (di luar cakupan agen — langkahnya ada di change log): transfer antar dompet (berhasil + saldo berkurang benar), simpan anggaran BARU dan ubah anggaran yang sudah ada, beli aset, set PIN baru, ubah PIN (PIN lama benar dan salah), serta cek pesan ramah saat server sengaja diganggu.
- **End-to-end live dengan JWT pengguna asli** untuk ketiga RPC (probe negatif memakai JWT dummy; penulisan nyata tidak diuji dari agen — hanya dari perangkat Liandi).
- **Repro 2 Test B** (pola INSERT ... RETURNING terkualifikasi) tidak dijalankan terpisah — bentuk perbaikannya (`returning assets.id`) sama dengan yang dibuktikan repro 4b untuk SELECT dan diverifikasi lewat `pg_get_functiondef` + tes guard §1.
