const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Fitur admin — status "Perubahan Terakhir" per user + auto-hapus
// akun dormant (BAGIAN DATABASE, Worker A).
// Gaya tes mengikuti repo: asersi statis atas SQL untuk hal yang
// tidak bisa dieksekusi tanpa Postgres, plus eksekusi nyata atas
// cermin JS dari rumus tanggal SQL (lihat bagian bawah file).
// Semua fixture ada di dalam repo dan ter-commit (pelajaran
// Gelombang 3: tidak ada file di luar repo).
// Tes dijalankan di TZ=Asia/Jakarta DAN TZ=UTC — rumus memakai
// epoch (waktu absolut), bukan potongan tanggal kalender, jadi
// hasilnya harus identik di kedua zona (pelajaran Gelombang 3/5:
// toISOString().slice(0,10) salah sebelum 07:00 WIB).

const MIG = 'supabase/migrations/20261128100000_admin_last_activity_cleanup.sql';
const mig = fs.readFileSync(MIG, 'utf8');
const schemaSql = fs.readFileSync('db/schema.sql', 'utf8');
const webauthnDraft = fs.readFileSync('supabase/migrations/20261128070000_wave3_webauthn.sql', 'utf8');

/* ============================================================
   1. Bentuk migrasi — satu transaksi, idempotent, tidak
      menyentuh WebAuthn / edge function / UI
   ============================================================ */

test('1. migrasi admin-cleanup: satu transaksi, idempotent, tidak menyentuh WebAuthn', () => {
  assert.match(mig, /^\s*begin;/m, 'migrasi harus dibuka begin;');
  assert.match(mig, /commit;\s*$/m, 'migrasi harus ditutup commit;');
  // Seperti tes Wave 4: yang dilarang adalah menyentuh OBJEK
  // WebAuthn (header boleh menyebut nomor migrasinya sebagai
  // penanda bahwa draf itu TIDAK disentuh).
  assert.doesNotMatch(mig, /webauthn_credentials|webauthn_challenges|create or replace function public\.webauthn/i, 'migrasi ini tidak boleh menyentuh objek WebAuthn (draf 070000)');
  // Idempotent: kolom + index dijaga keberadaannya.
  assert.match(mig, /add column if not exists last_activity_at timestamptz/);
  assert.match(mig, /add column if not exists deletion_warning_sent_at timestamptz/);
  assert.match(mig, /create index if not exists idx_profiles_last_activity_at/);
  assert.match(mig, /create or replace function public\.touch_own_activity\(\)/);
  assert.match(mig, /create or replace function public\.get_admin_user_activity\(\)/);
});

/* ============================================================
   2. Kolom baru di public.profiles + index
   ============================================================ */

test('2. §1+§4: kedua kolom baru di profiles + index last_activity_at', () => {
  assert.match(mig, /alter table public\.profiles\s+add column if not exists last_activity_at timestamptz;/);
  assert.match(mig, /alter table public\.profiles\s+add column if not exists deletion_warning_sent_at timestamptz;/);
  // Kolom nullable (tanpa NOT NULL / DEFAULT): user lama belum
  // punya nilai, dan NULL berarti "belum pernah tercatat".
  assert.doesNotMatch(mig, /last_activity_at timestamptz not null/i);
  assert.doesNotMatch(mig, /deletion_warning_sent_at timestamptz not null/i);
  assert.match(mig, /create index if not exists idx_profiles_last_activity_at\s+on public\.profiles \(last_activity_at\)/);
});

/* ============================================================
   3. RPC touch_own_activity()
   ============================================================ */

test('3. §2: touch_own_activity SECURITY DEFINER, search_path dipin, hanya baris sendiri', () => {
  const fn = mig.slice(mig.indexOf('create or replace function public.touch_own_activity()'));
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public/);
  assert.doesNotMatch(fn, /security invoker/);
  // Hanya menyentuh baris pemanggil; UPDATE profiles langsung dari
  // klien ditolak RLS sejak Gelombang 1, jadi RPC ini satu-satunya
  // jalan — dan ia tidak boleh menyentuh baris user lain.
  assert.match(fn, /update public\.profiles\s+set last_activity_at = now\(\)\s+where id = auth\.uid\(\)/);
  assert.match(fn, /if auth\.uid\(\) is null then\s+raise exception 'Not authenticated';/);
  // Hak eksekusi: dicabut dari PUBLIC + anon (revoke dari PUBLIC
  // saja TIDAK menghapus grant eksplisit anon — pelajaran
  // Gelombang 4), diberikan ke authenticated.
  assert.match(mig, /revoke all on function public\.touch_own_activity\(\) from public, anon;/);
  assert.match(mig, /grant execute on function public\.touch_own_activity\(\) to authenticated;/);
});

/* ============================================================
   4. RPC get_admin_user_activity()
   ============================================================ */

test('4. §3: get_admin_user_activity SECURITY DEFINER, search_path dipin, tolak non-admin', () => {
  const fn = mig.slice(mig.indexOf('create or replace function public.get_admin_user_activity()'));
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public/);
  assert.doesNotMatch(fn, /security invoker/);
  // Pola yang sama dengan get_admin_platform_stats (migrasi
  // 20261118000000): otorisasi ditegakkan di dalam fungsi.
  assert.match(fn, /if not public\.is_admin\(\) then\s+raise exception 'Forbidden';/);
  assert.match(mig, /revoke all on function public\.get_admin_user_activity\(\) from public, anon;/);
  assert.match(mig, /grant execute on function public\.get_admin_user_activity\(\) to authenticated;/);
});

test('4. §3: kontrak kolom dengan worker UI — nama + urutan PERSIS', () => {
  // Satu baris per user; urutan kolom di bawah adalah kontrak
  // dengan worker UI — jangan ubah nama maupun urutan.
  const returnsBlock = mig.slice(
    mig.indexOf('returns table (', mig.indexOf('get_admin_user_activity')),
    mig.indexOf(')', mig.indexOf('returns table (', mig.indexOf('get_admin_user_activity')))
  );
  const cols = [...returnsBlock.matchAll(/^\s*([a-z_]+)\s+(uuid|text|timestamptz|int),?$/gm)]
    .map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(cols, [
    'user_id:uuid',
    'email:text',
    'display_name:text',
    'role:text',
    'status:text',
    'created_at:timestamptz',
    'last_sign_in_at:timestamptz',
    'last_activity_at:timestamptz',
    'last_change_at:timestamptz',
    'days_inactive:int',
    'deletion_due_in_days:int',
    'warning_sent_at:timestamptz',
  ]);
});

test('4. §3: last_change_at/days_inactive/deletion_due_in_days — rumus SQL', () => {
  // last_sign_in_at dari auth.users (bukan profiles).
  assert.match(mig, /left join auth\.users u on u\.id = p\.id/);
  assert.match(mig, /u\.last_sign_in_at\s+as sign_in_at/);
  // last_change_at = GREATEST(COALESCE(last_activity_at,
  // created_at), last_sign_in_at). Pengaman NULL: bila
  // last_sign_in_at NULL, GREATEST murni akan NULL — karena itu
  // NULL diganti dulu dengan nilai dasar; hasilnya identik bila
  // last_sign_in_at terisi.
  assert.match(mig, /coalesce\(p\.last_activity_at, p\.created_at\) as base_at/);
  assert.match(mig, /greatest\(base\.base_at, coalesce\(base\.sign_in_at, base\.base_at\)\)/);
  // days_inactive = floor(epoch(now - last_change_at) / 86400),
  // dipotong di 0 bila negatif.
  assert.match(mig, /greatest\(0,\s+floor\(extract\(epoch from\s+\(v_now - greatest\(/);
  assert.match(mig, /\) \/ 86400\)\)::int as days_inactive/);
  // deletion_due_in_days = GREATEST(0, 7 - days_inactive).
  assert.match(mig, /greatest\(0, 7 - c\.days_inactive\) as deletion_due_in_days/);
  // warning_sent_at berasal dari kolom deletion_warning_sent_at.
  assert.match(mig, /p\.deletion_warning_sent_at\s+as warning_sent_at/);
  // Paling lama dorman dulu (yang paling mendesak di atas).
  assert.match(mig, /order by c\.days_inactive desc, c\.created_at asc/);
});

/* ============================================================
   5. Guard pola berbahaya (pelajaran Gelombang 3/4)
   ============================================================ */

test('5. guard: tidak ada hmac/digest tanpa kualifikasi extensions, tidak ada to_regproc berargumen', () => {
  const code = mig.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Migrasi ini tidak memakai hmac/digest sama sekali; bila kelak
  // dipakai, pgcrypto Supabase ada di schema extensions.
  assert.doesNotMatch(code, /(?<!extensions\.)\bhmac\s*\(/);
  assert.doesNotMatch(code, /(?<!extensions\.)\bdigest\s*\(/);
  // to_regproc('nama(tipe, ...)') SELALU NULL — pakai
  // to_regprocedure untuk signature lengkap (Gelombang 4).
  for (const m of code.matchAll(/to_regproc\('([^']*)'\)/g)) {
    assert.ok(!m[1].includes(','), `to_regproc berargumen (${m[1]}) — selalu NULL; pakai to_regprocedure`);
  }
});

test('5. guard: migrasi WebAuthn 070000 tetap DRAF dan tidak diubah', () => {
  assert.match(webauthnDraft, /DRAFT — BELUM DIVERIFIKASI, JANGAN DEPLOY DULU/);
  assert.match(webauthnDraft, /BELUM pernah dijalankan/);
});

/* ============================================================
   6. db/schema.sql — tidak mendefinisikan profiles
   ============================================================ */

test('6. schema.sql tidak mendefinisikan tabel profiles — tidak ada yang diselaraskan', () => {
  // db/schema.sql adalah bootstrap v1 dan TIDAK memuat CREATE
  // TABLE profiles (profiles dibuat migrasi
  // 20261114000000_multiuser_onboarding.sql). Karena itu tidak
  // ada definisi yang perlu diselaraskan dengan kolom baru —
  // seperti Gelombang 4 menyelaraskan cycle_for_date yang ADA di
  // schema.sql. Tes ini mengunci keputusan itu: bila suatu hari
  // schema.sql mendapat definisi profiles, tes ini gagal dan
  // kolom baru harus ditambahkan di sana juga.
  assert.doesNotMatch(schemaSql, /create table[^;]*public\.profiles/i);
});

/* ============================================================
   7. Logika tanggal — cermin JS dari rumus SQL, dieksekusi
      nyata (termasuk batas hari di WIB)
   ============================================================ */

// Cermin PERSIS rumus SQL di migrasi (epoch = waktu absolut).
function lastChangeAt({ lastActivityAt, createdAt, lastSignInAt }) {
  const base = new Date(lastActivityAt ?? createdAt).getTime();
  const signIn = lastSignInAt == null ? base : new Date(lastSignInAt).getTime();
  return new Date(Math.max(base, signIn));
}
function daysInactive(lastChange, now) {
  return Math.max(0, Math.floor((now.getTime() - lastChange.getTime()) / 86400000));
}
function deletionDueInDays(days) {
  return Math.max(0, 7 - days);
}
function compute(input, now) {
  const lc = lastChangeAt(input);
  const d = daysInactive(lc, now);
  return { lastChangeAt: lc, daysInactive: d, deletionDueInDays: deletionDueInDays(d) };
}

test('7. last_change_at: ambil yang terbaru dari aktivitas / sign-in / created_at', () => {
  const now = new Date('2026-11-28T12:00:00+07:00');
  // Aktivitas lebih baru dari sign-in -> aktivitas menang.
  assert.equal(
    compute({ lastActivityAt: '2026-11-27T10:00:00+07:00', createdAt: '2026-11-01T10:00:00+07:00', lastSignInAt: '2026-11-25T10:00:00+07:00' }, now).lastChangeAt.toISOString(),
    '2026-11-27T03:00:00.000Z'
  );
  // Sign-in lebih baru dari aktivitas -> sign-in menang.
  assert.equal(
    compute({ lastActivityAt: '2026-11-20T10:00:00+07:00', createdAt: '2026-11-01T10:00:00+07:00', lastSignInAt: '2026-11-26T10:00:00+07:00' }, now).lastChangeAt.toISOString(),
    '2026-11-26T03:00:00.000Z'
  );
  // Belum pernah ada aktivitas -> jatuh ke created_at.
  assert.equal(
    compute({ lastActivityAt: null, createdAt: '2026-11-10T10:00:00+07:00', lastSignInAt: null }, now).lastChangeAt.toISOString(),
    '2026-11-10T03:00:00.000Z'
  );
  // last_sign_in_at NULL tidak membuat hasil NULL (pengaman SQL).
  assert.equal(
    compute({ lastActivityAt: '2026-11-22T10:00:00+07:00', createdAt: '2026-11-01T10:00:00+07:00', lastSignInAt: null }, now).lastChangeAt.toISOString(),
    '2026-11-22T03:00:00.000Z'
  );
});

test('7. days_inactive / deletion_due_in_days: floor hari + ambang 7 hari', () => {
  const now = new Date('2026-11-28T12:00:00+07:00');
  const at = (iso) => compute({ lastActivityAt: iso, createdAt: iso, lastSignInAt: iso }, now);
  // Tepat 7 hari -> 7, jatuh tempo (due 0).
  assert.deepEqual(
    { d: at('2026-11-21T12:00:00+07:00').daysInactive, due: at('2026-11-21T12:00:00+07:00').deletionDueInDays },
    { d: 7, due: 0 }
  );
  // 6 hari 23 jam -> masih 6 (floor), due 1.
  assert.deepEqual(
    { d: at('2026-11-21T13:00:00+07:00').daysInactive, due: at('2026-11-21T13:00:00+07:00').deletionDueInDays },
    { d: 6, due: 1 }
  );
  // Lebih dari 7 hari -> due tetap 0, tidak negatif.
  assert.deepEqual(
    { d: at('2026-11-10T12:00:00+07:00').daysInactive, due: at('2026-11-10T12:00:00+07:00').deletionDueInDays },
    { d: 18, due: 0 }
  );
  // Baru saja aktif -> 0, due 7.
  assert.deepEqual(
    { d: at('2026-11-28T11:00:00+07:00').daysInactive, due: at('2026-11-28T11:00:00+07:00').deletionDueInDays },
    { d: 0, due: 7 }
  );
  // last_change_at di masa depan (jam miring) -> 0, bukan negatif.
  assert.deepEqual(
    { d: at('2026-11-29T12:00:00+07:00').daysInactive, due: at('2026-11-29T12:00:00+07:00').deletionDueInDays },
    { d: 0, due: 7 }
  );
});

test('7. batas hari di WIB: 00:30 WIB bukan hari baru untuk hitung dorman', () => {
  // Kasus yang dulu salah bila memakai potongan tanggal kalender:
  // sekarang Sabtu 2026-11-28 00:30 WIB (= Jumat 2026-11-27
  // 17:30 UTC), perubahan terakhir Sabtu 2026-11-21 01:00 WIB.
  // Potongan tanggal UTC memberi 27-20 = 7 hari (salah, sudah
  // jatuh tempo), potongan tanggal WIB memberi 28-21 = 7 hari
  // (salah juga). Waktu absolut: 6 hari 23,5 jam -> 6 hari,
  // due 1 — benar di WIB maupun UTC.
  const now = new Date('2026-11-28T00:30:00+07:00');
  const r = compute(
    { lastActivityAt: '2026-11-21T01:00:00+07:00', createdAt: '2026-11-01T01:00:00+07:00', lastSignInAt: '2026-11-21T01:00:00+07:00' },
    now
  );
  assert.equal(r.daysInactive, 6);
  assert.equal(r.deletionDueInDays, 1);
  // Hasil yang sama bila kedua waktu dibaca sebagai UTC murni —
  // rumus epoch tidak tergantung zona waktu proses.
  const nowUtc = new Date('2026-11-27T17:30:00Z');
  const rUtc = compute(
    { lastActivityAt: '2026-11-20T18:00:00Z', createdAt: '2026-10-31T18:00:00Z', lastSignInAt: '2026-11-20T18:00:00Z' },
    nowUtc
  );
  assert.deepEqual(
    { d: rUtc.daysInactive, due: rUtc.deletionDueInDays },
    { d: 6, due: 1 }
  );
});

/* ============================================================
   8. Migrasi 20261128110000 — notifikasi in-app khusus admin
      (pengganti email Resend; lihat header migrasi).
   ============================================================ */

const MIG_NOTIF = 'supabase/migrations/20261128110000_admin_notifications.sql';
const migNotif = fs.readFileSync(MIG_NOTIF, 'utf8');

test('8. migrasi admin-notifications: satu transaksi, idempotent', () => {
  assert.match(migNotif, /^\s*begin;/m, 'migrasi harus dibuka begin;');
  assert.match(migNotif, /commit;\s*$/m, 'migrasi harus ditutup commit;');
  assert.match(migNotif, /create table if not exists public\.admin_notifications \(/);
  assert.match(migNotif, /create index if not exists idx_admin_notifications_created_at/);
  assert.match(migNotif, /create or replace function public\.get_admin_notifications\(\)/);
  assert.match(migNotif, /create or replace function public\.mark_admin_notification_read\(p_notification_id uuid\)/);
});

test('8. §1: tabel admin_notifications — kolom + CHECK type + tanpa FK', () => {
  assert.match(migNotif, /id\s+uuid primary key default gen_random_uuid\(\),/);
  assert.match(migNotif, /type\s+text not null check \(type in \('deletion_warning', 'deletion_done'\)\),/);
  // target_user_id TANPA foreign key — SENGAJA: baris
  // 'deletion_done' harus bertahan setelah akunnya dihapus; FK
  // ke profiles/auth.users akan ikut ter-cascade.
  assert.match(migNotif, /target_user_id\s+uuid,/);
  assert.doesNotMatch(migNotif, /target_user_id\s+uuid\s+references/);
  assert.doesNotMatch(migNotif, /references auth\.users/);
  assert.doesNotMatch(migNotif, /references public\.profiles/);
  assert.match(migNotif, /target_email\s+text,/);
  assert.match(migNotif, /title\s+text not null,/);
  assert.match(migNotif, /body\s+text not null,/);
  assert.match(migNotif, /created_at\s+timestamptz not null default now\(\),/);
  // read_at nullable (NULL = belum dibaca).
  assert.match(migNotif, /read_at\s+timestamptz\s*$/m);
  assert.doesNotMatch(migNotif, /read_at\s+timestamptz not null/i);
  assert.match(migNotif, /create index if not exists idx_admin_notifications_created_at\s+on public\.admin_notifications \(created_at desc\)/);
});

test('8. §1: RLS ON + REVOKE ALL dari authenticated dan anon', () => {
  assert.match(migNotif, /alter table public\.admin_notifications enable row level security;/);
  assert.match(migNotif, /revoke all on table public\.admin_notifications from authenticated, anon;/);
  // Policy baca hanya untuk admin (service_role bypass RLS
  // sehingga edge function tetap bisa insert).
  assert.match(migNotif, /create policy "admins_read_notifications" on public\.admin_notifications\s+for select to authenticated\s+using \(public\.is_admin\(\)\);/);
});

test('8. §2: get_admin_notifications SECURITY DEFINER, tolak non-admin, kontrak kolom PERSIS', () => {
  const fn = migNotif.slice(migNotif.indexOf('create or replace function public.get_admin_notifications()'));
  assert.match(fn, /security definer/);
  assert.match(fn, /stable/);
  assert.match(fn, /set search_path = public/);
  assert.doesNotMatch(fn, /security invoker/);
  assert.match(fn, /if not public\.is_admin\(\) then\s+raise exception 'Forbidden';/);
  // Kontrak kolom dengan worker UI — nama + urutan PERSIS.
  const returnsBlock = migNotif.slice(
    migNotif.indexOf('returns table (', migNotif.indexOf('get_admin_notifications')),
    migNotif.indexOf(')', migNotif.indexOf('returns table (', migNotif.indexOf('get_admin_notifications')))
  );
  const cols = [...returnsBlock.matchAll(/^\s*([a-z_]+)\s+(uuid|text|timestamptz),?$/gm)]
    .map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(cols, [
    'id:uuid',
    'type:text',
    'target_user_id:uuid',
    'target_email:text',
    'title:text',
    'body:text',
    'created_at:timestamptz',
    'read_at:timestamptz',
  ]);
  // 50 terbaru dulu, yang terbaru di atas.
  assert.match(fn, /order by n\.created_at desc\s+limit 50;/);
  assert.match(migNotif, /revoke all on function public\.get_admin_notifications\(\) from public, anon;/);
  assert.match(migNotif, /grant execute on function public\.get_admin_notifications\(\) to authenticated;/);
});

test('8. §3: mark_admin_notification_read SECURITY DEFINER, tolak non-admin, hanya bila belum dibaca', () => {
  const fn = migNotif.slice(migNotif.indexOf('create or replace function public.mark_admin_notification_read('));
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public/);
  assert.doesNotMatch(fn, /security invoker/);
  assert.match(fn, /if not public\.is_admin\(\) then\s+raise exception 'Forbidden';/);
  assert.match(fn, /update public\.admin_notifications\s+set read_at = now\(\)\s+where id = p_notification_id\s+and read_at is null;/);
  assert.match(migNotif, /revoke all on function public\.mark_admin_notification_read\(uuid\) from public, anon;/);
  assert.match(migNotif, /grant execute on function public\.mark_admin_notification_read\(uuid\) to authenticated;/);
});

test('8. guard: tidak ada hmac/digest tanpa kualifikasi extensions, tidak ada to_regproc berargumen', () => {
  const code = migNotif.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /(?<!extensions\.)\bhmac\s*\(/);
  assert.doesNotMatch(code, /(?<!extensions\.)\bdigest\s*\(/);
  for (const m of code.matchAll(/to_regproc\('([^']*)'\)/g)) {
    assert.ok(!m[1].includes(','), `to_regproc berargumen (${m[1]}) — selalu NULL; pakai to_regprocedure`);
  }
});
