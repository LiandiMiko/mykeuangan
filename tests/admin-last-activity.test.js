const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Fitur admin — kolom Perubahan Terakhir + pencatatan aktivitas.
// Gaya tes mengikuti repo: asersi statis atas sumber untuk kontrak
// RPC/wiring yang tidak bisa dieksekusi tanpa Supabase, plus eksekusi
// nyata lewat vm untuk logika JS murni (format relatif, klasifikasi,
// hitung mundur, filter, throttle). Semua fixture ada di dalam repo.
// Tes waktu memakai komponen kalender LOKAL (bukan toISOString/UTC)
// supaya lolos di TZ=Asia/Jakarta DAN TZ=UTC — pelajaran Gelombang 3
// & 5 (bug tanggal WIB).

const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
const uiAdminJs = fs.readFileSync('web/ui-admin.js', 'utf8');
const adminHtml = fs.readFileSync('src/admin.html', 'utf8');
const authJs = fs.readFileSync('web/supabase-auth.js', 'utf8');
const offlineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');

/* ============================================================
   Loader vm — ui-admin.js + i18n asli + escapeHtmlJS asli
   ============================================================ */
function createStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

function loadAdminUi(lang) {
  const localStorage = createStorage(lang ? { lang } : {});
  const sandbox = {
    localStorage,
    document: {
      documentElement: { classList: { contains: () => false } },
      addEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: () => null
    },
    navigator: { onLine: true },
    Swal: { fire: async () => ({}) },
    getSwalClass: () => '',
    callServer: async () => { throw new Error('callServer stub: tidak dipakai tes ini'); },
    console,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/error-messages.js', 'utf8'), sandbox, { filename: 'error-messages.js' });
  vm.runInContext(fs.readFileSync('web/ui-state.js', 'utf8'), sandbox, { filename: 'ui-state.js' });
  // i18n asli (src/i18n.html) supaya t() memakai kamus sungguhan.
  const i18nHtml = fs.readFileSync('src/i18n.html', 'utf8');
  const scriptMatch = i18nHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'expected <script> block in src/i18n.html');
  vm.runInContext(scriptMatch[1], sandbox, { filename: 'i18n.html' });
  vm.runInContext(uiAdminJs, sandbox, { filename: 'ui-admin.js' });
  assert.ok(sandbox.__mkFeat && sandbox.__mkFeat.adminActivity, 'ui-admin.js harus mengekspos __mkFeat.adminActivity');
  return { sandbox, admin: sandbox.__mkFeat.adminActivity, localStorage };
}

function loadI18nDictionary() {
  const html = fs.readFileSync('src/i18n.html', 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  const sandbox = {
    localStorage: { getItem: () => 'id', setItem: () => {} },
    document: { addEventListener: () => {}, querySelectorAll: () => [] },
    window: {},
    setTimeout: () => {}
  };
  return vm.runInNewContext(`${scriptMatch[1]}\n({ id: I18N.id, en: I18N.en });`, sandbox);
}

// Loader vm — supabase-auth.js dengan sb palsu (untuk throttle touch).
function loadAuthModule(rpcImpl) {
  const rpcCalls = [];
  const localStorage = createStorage({});
  const core = {
    sb: {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        signInWithPassword: async () => ({ data: {}, error: null }),
        signUp: async () => ({ data: {}, error: null }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => {}
      },
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        return rpcImpl ? rpcImpl(name, args) : { data: null, error: null };
      }
    },
    fail: (error) => { if (error) throw new Error(error.message || String(error)); },
    resolveReady: () => {},
    showCoreNotice: async () => {}
  };
  const sandbox = {
    localStorage,
    document: { addEventListener: () => {}, readyState: 'complete' },
    navigator: { onLine: true },
    console,
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
    location: { reload: () => {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.__mkSb = core;
  vm.createContext(sandbox);
  vm.runInContext(authJs, sandbox, { filename: 'supabase-auth.js' });
  assert.equal(typeof sandbox.__mkFeat.touchOwnActivity, 'function', 'supabase-auth.js harus mengekspos __mkFeat.touchOwnActivity');
  return { sandbox, touch: sandbox.__mkFeat.touchOwnActivity, rpcCalls, localStorage, core };
}

/* ============================================================
   1. Kontrak RPC — supabase-admin.js
   ============================================================ */
test('admin RPC: api_getAdminActivity memanggil get_admin_user_activity dan menormalisasi user_id -> id', () => {
  assert.match(adminJs, /async function api_getAdminActivity\(\)/);
  assert.match(adminJs, /sb\.rpc\('get_admin_user_activity'\)/);
  // Semua field kontrak RPC dipertahankan apa adanya (jangan ubah nama).
  for (const field of [
    'user_id', 'email', 'display_name', 'role', 'status', 'created_at',
    'last_sign_in_at', 'last_activity_at', 'last_change_at',
    'days_inactive', 'deletion_due_in_days', 'warning_sent_at'
  ]) {
    assert.ok(adminJs.includes(field), `field kontrak RPC hilang dari supabase-admin.js: ${field}`);
  }
  assert.match(adminJs, /id: r\.user_id/);
});

test('admin RPC: api_getAdminData memakai RPC aktivitas (bukan fetchAll profiles) dan gagal lantang bila RPC gagal', () => {
  assert.match(adminJs, /async api_getAdminData\(\)[\s\S]*?api_getAdminActivity\(\)/);
  // Daftar user TIDAK boleh lagi diambil dari profiles (tidak ada data aktivitas).
  const getData = adminJs.match(/async api_getAdminData\(\)[\s\S]*?return \{ users: profiles/);
  assert.ok(getData, 'api_getAdminData harus mengembalikan users dari RPC aktivitas');
  assert.doesNotMatch(adminJs, /fetchAll\('profiles', 'id,email,display_name,role,status,created_at'/, 'api_getAdminData tidak boleh lagi fetchAll profiles');
  // Error RPC tidak ditelan: dilempar dengan nama RPC-nya.
  assert.match(adminJs, /Gagal memuat data aktivitas pengguna \(get_admin_user_activity\)/);
  // Stats & audit logs tetap seperti semula.
  assert.match(adminJs, /sb\.rpc\('get_admin_platform_stats'\)/);
  assert.match(adminJs, /from\('admin_audit_logs'\)/);
});

test('admin HTML: kolom Perubahan Terakhir + filter Aktif/Dormant + colspan 6', () => {
  assert.match(adminHtml, /<th[^>]*data-i18n="adm\.last_change"[^>]*>Perubahan Terakhir<\/th>/);
  assert.match(adminHtml, /<option value="active_activity" data-i18n="adm\.filter_active_activity">Aktivitas: Aktif<\/option>/);
  assert.match(adminHtml, /<option value="dormant" data-i18n="adm\.filter_dormant">Aktivitas: Dormant<\/option>/);
  // Filter lama tetap ada.
  for (const v of ['active', 'suspended', 'admin', 'user']) {
    assert.match(adminHtml, new RegExp(`<option value="${v}">`), `opsi filter lama hilang: ${v}`);
  }
  // Semua baris placeholder memakai colspan 6 (5 kolom lama + 1 baru).
  assert.doesNotMatch(adminHtml, /colspan="5"/, 'colspan lama (5) masih ada di admin.html');
  assert.match(adminHtml, /colspan="6"/);
  assert.doesNotMatch(uiAdminJs, /colspan="5"/, 'colspan lama (5) masih ada di ui-admin.js');
});

test('i18n: semua label baru ada di id dan en', () => {
  const i18n = loadI18nDictionary();
  const keys = [
    'adm.last_change', 'adm.filter_active_activity', 'adm.filter_dormant',
    'adm.dormant', 'adm.just_now', 'adm.today', 'adm.yesterday',
    'adm.days_ago', 'adm.no_change', 'adm.delete_today', 'adm.delete_in', 'adm.days'
  ];
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.id, key), `kunci id hilang: ${key}`);
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.en, key), `kunci en hilang: ${key}`);
    assert.notEqual(i18n.id[key], key, `nilai id belum diterjemahkan: ${key}`);
    assert.notEqual(i18n.en[key], key, `nilai en belum diterjemahkan: ${key}`);
  }
  assert.equal(i18n.id['adm.last_change'], 'Perubahan Terakhir');
  assert.equal(i18n.en['adm.last_change'], 'Last Change');
});

/* ============================================================
   2. Format waktu relatif (id + en)
   ============================================================ */
test('format relatif: baru saja / hari ini / kemarin / N hari lalu / belum ada perubahan (id)', () => {
  const { admin } = loadAdminUi('id');
  const now = new Date(2026, 10, 28, 12, 0, 0); // 28 Nov 2026 12:00 lokal
  assert.equal(admin.formatLastChangeRelative('2026-11-28T11:30:00', now).rel, 'baru saja');
  assert.equal(admin.formatLastChangeRelative('2026-11-28T11:00:00', now).rel, 'hari ini'); // tepat 60 mnt: sudah lewat ambang "baru saja"
  assert.equal(admin.formatLastChangeRelative('2026-11-28T10:59:00', now).rel, 'hari ini');
  assert.equal(admin.formatLastChangeRelative('2026-11-28T08:00:00', now).rel, 'hari ini');
  assert.equal(admin.formatLastChangeRelative('2026-11-27T23:30:00', now).rel, 'kemarin');
  assert.equal(admin.formatLastChangeRelative('2026-11-25T12:00:00', now).rel, '3 hari lalu');
  assert.equal(admin.formatLastChangeRelative('2026-11-18T12:00:00', now).rel, '10 hari lalu');
  const none = admin.formatLastChangeRelative(null, now);
  assert.equal(none.date, '');
  assert.equal(none.rel, 'Belum ada perubahan');
  const noTs = admin.formatLastChangeRelative('', now);
  assert.equal(noTs.rel, 'Belum ada perubahan');
  // Tanggal tampil YYYY-MM-DD lokal.
  assert.equal(admin.formatLastChangeRelative('2026-11-25T12:00:00', now).date, '2026-11-25');
  assert.equal(admin.formatLastChangeDate('2026-11-25T12:00:00'), '2026-11-25');
});

test('format relatif: label Inggris', () => {
  const { admin } = loadAdminUi('en');
  const now = new Date(2026, 10, 28, 12, 0, 0);
  assert.equal(admin.formatLastChangeRelative('2026-11-28T11:30:00', now).rel, 'just now');
  assert.equal(admin.formatLastChangeRelative('2026-11-28T08:00:00', now).rel, 'today');
  assert.equal(admin.formatLastChangeRelative('2026-11-27T23:30:00', now).rel, 'yesterday');
  assert.equal(admin.formatLastChangeRelative('2026-11-25T12:00:00', now).rel, '3 days ago');
  assert.equal(admin.formatLastChangeRelative(null, now).rel, 'No changes yet');
});

test('format relatif: batas tengah malam WIB — 00:30 WIB masih "hari ini", 23:00 WIB kemarin tetap "kemarin"', () => {
  const { admin } = loadAdminUi('id');
  // Dibangun dari komponen lokal: 28 Nov 00:30 vs 27 Nov 23:00 —
  // selisih 1 hari kalender lokal di zona waktu mana pun (termasuk
  // WIB dan UTC), jadi tes ini lolos di kedua TZ.
  const now = new Date(2026, 10, 28, 0, 30, 0);
  assert.equal(admin.formatLastChangeRelative(new Date(2026, 10, 28, 0, 5, 0).toISOString(), now).rel, 'baru saja');
  assert.equal(admin.formatLastChangeRelative(new Date(2026, 10, 27, 23, 0, 0).toISOString(), now).rel, 'kemarin');
  assert.equal(admin.formatLastChangeRelative(new Date(2026, 10, 27, 23, 0, 0).toISOString(), now).date, '2026-11-27');
  // Kasus nyata lintas zona: 2026-11-27T16:00:00Z = 23:00 WIB 27 Nov,
  // sedangkan "sekarang" 2026-11-28T00:30:00+07:00. Di WIB itu
  // kemarin; di UTC itu hari yang sama (27 Nov 16:00 vs 17:30).
  // Tes menegaskan fungsi memakai kalender LOKAL runtime, bukan UTC.
  const nowWib = new Date('2026-11-28T00:30:00+07:00');
  const ts = '2026-11-27T16:00:00Z';
  const rel = admin.formatLastChangeRelative(ts, nowWib).rel;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz === 'Asia/Jakarta') {
    assert.equal(rel, 'kemarin', 'di WIB, 23:00 WIB kemarin harus "kemarin"');
  } else if (tz === 'UTC') {
    assert.equal(rel, 'hari ini', 'di UTC, 16:00 UTC di hari yang sama harus "hari ini"');
  } else {
    // Zona lain: cukup pastikan hasilnya konsisten dengan kalender lokal runtime.
    const dayStart = (x) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
    const diff = Math.round((dayStart(nowWib) - dayStart(new Date(ts))) / 86400000);
    assert.equal(rel, diff === 1 ? 'kemarin' : 'hari ini');
  }
});

/* ============================================================
   3. Klasifikasi Aktif/Dormant + hitung mundur penghapusan
   ============================================================ */
test('klasifikasi: Aktif = days_inactive < 4, Dormant = >= 4 (batas 3/4)', () => {
  const { admin } = loadAdminUi('id');
  assert.equal(admin.classifyAdminActivity({ days_inactive: 0 }), 'active');
  assert.equal(admin.classifyAdminActivity({ days_inactive: 3 }), 'active');
  assert.equal(admin.classifyAdminActivity({ days_inactive: 4 }), 'dormant');
  assert.equal(admin.classifyAdminActivity({ days_inactive: 7 }), 'dormant');
  assert.equal(admin.classifyAdminActivity({ days_inactive: 30 }), 'dormant');
  assert.equal(admin.ADMIN_DORMANT_AFTER_DAYS, 4);
  assert.equal(admin.ADMIN_DELETION_AFTER_DAYS, 7);
});

test('klasifikasi: fallback dari last_change_at bila days_inactive tidak ada; tanpa data = aktif', () => {
  const { admin } = loadAdminUi('id');
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
  assert.equal(admin.classifyAdminActivity({ last_change_at: tenDaysAgo }), 'dormant');
  assert.equal(admin.adminDaysInactive({ last_change_at: tenDaysAgo }), 10);
  const today = new Date().toISOString();
  assert.equal(admin.classifyAdminActivity({ last_change_at: today }), 'active');
  // Tanpa data aktivitas apa pun: jangan tuduh dormant tanpa bukti.
  assert.equal(admin.classifyAdminActivity({}), 'active');
  assert.equal(admin.classifyAdminActivity({ days_inactive: null, last_change_at: null }), 'active');
});

test('hitung mundur: dormant pakai deletion_due_in_days; 0 = dihapus hari ini; aktif = kosong', () => {
  const { admin } = loadAdminUi('id');
  assert.equal(admin.deletionCountdownText({ days_inactive: 5, deletion_due_in_days: 2 }), 'dihapus dalam 2 hari');
  assert.equal(admin.deletionCountdownText({ days_inactive: 6, deletion_due_in_days: 1 }), 'dihapus dalam 1 hari');
  assert.equal(admin.deletionCountdownText({ days_inactive: 7, deletion_due_in_days: 0 }), 'dihapus hari ini');
  assert.equal(admin.deletionCountdownText({ days_inactive: 2, deletion_due_in_days: 5 }), '');
  assert.equal(admin.deletionCountdownText({ days_inactive: 0, deletion_due_in_days: 7 }), '');
  // Fallback bila deletion_due_in_days tidak ada: 7 - days_inactive.
  assert.equal(admin.deletionCountdownText({ days_inactive: 5 }), 'dihapus dalam 2 hari');
  assert.equal(admin.deletionCountdownText({ days_inactive: 7 }), 'dihapus hari ini');
  const { admin: adminEn } = loadAdminUi('en');
  assert.equal(adminEn.deletionCountdownText({ days_inactive: 5, deletion_due_in_days: 2 }), 'deleted in 2 days');
  assert.equal(adminEn.deletionCountdownText({ days_inactive: 7, deletion_due_in_days: 0 }), 'deleted today');
});

/* ============================================================
   4. Filter + pencarian (digabung)
   ============================================================ */
const sampleUsers = [
  { id: 'u1', display_name: 'Budi Santoso', email: 'budi@example.com', role: 'user', status: 'active', days_inactive: 1, last_change_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'u2', display_name: 'Sinta Dewi', email: 'sinta@example.com', role: 'admin', status: 'active', days_inactive: 6, deletion_due_in_days: 1, last_change_at: new Date(Date.now() - 6 * 86400000).toISOString() },
  { id: 'u3', display_name: 'Raka Pratama', email: 'raka@example.com', role: 'user', status: 'suspended', days_inactive: 10, deletion_due_in_days: 0, last_change_at: new Date(Date.now() - 10 * 86400000).toISOString() },
  { id: 'u4', display_name: 'Budi Kecil', email: 'budi.kecil@example.com', role: 'user', status: 'active', days_inactive: 0, last_change_at: new Date().toISOString() }
];

test('filter: Aktif/Dormant bekerja dan bergabung dengan pencarian teks; filter lama tidak rusak', () => {
  const { admin } = loadAdminUi('id');
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, '', 'dormant').map((u) => u.id), ['u2', 'u3']);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, '', 'active_activity').map((u) => u.id), ['u1', 'u4']);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, 'budi', 'dormant').map((u) => u.id), []);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, 'budi', 'active_activity').map((u) => u.id), ['u1', 'u4']);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, 'sinta', 'dormant').map((u) => u.id), ['u2']);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, '', '').map((u) => u.id), ['u1', 'u2', 'u3', 'u4']);
  // Filter lama tetap bekerja berdampingan.
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, '', 'suspended').map((u) => u.id), ['u3']);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, '', 'admin').map((u) => u.id), ['u2']);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, '', 'active').map((u) => u.id), ['u1', 'u2', 'u4']);
  assert.deepEqual(admin.filterAdminUsers(sampleUsers, 'raka', '').map((u) => u.id), ['u3']);
});

/* ============================================================
   5. Render baris desktop & kartu mobile (termasuk XSS)
   ============================================================ */
test('baris desktop: tanggal + relatif + badge Dormant + hitung mundur; tanpa HTML mentah dari data user', () => {
  const { admin } = loadAdminUi('id');
  const dormant = {
    id: 'u2', display_name: 'Sinta Dewi', email: 'sinta@example.com', role: 'admin', status: 'active',
    created_at: '2026-11-20T10:00:00Z',
    last_change_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    days_inactive: 6, deletion_due_in_days: 1
  };
  const html = admin.buildAdminUserRowHtml(dormant);
  assert.match(html, /Dormant/);
  assert.match(html, /dihapus dalam 1 hari/);
  assert.match(html, /\d{4}-\d{2}-\d{2}/); // tanggal YYYY-MM-DD
  assert.match(html, /6 hari lalu/);
  // Pengguna aktif: tanpa badge Dormant dan tanpa hitung mundur.
  const active = { ...dormant, id: 'u1', display_name: 'Budi', days_inactive: 1, deletion_due_in_days: 6, last_change_at: new Date(Date.now() - 86400000).toISOString() };
  const htmlActive = admin.buildAdminUserRowHtml(active);
  assert.doesNotMatch(htmlActive, /Dormant/);
  assert.doesNotMatch(htmlActive, /dihapus dalam/);
  // XSS: nama/email berbahaya harus ter-escape, tidak pernah mentah.
  const evil = {
    id: 'u9', display_name: '<script>alert(1)</script>', email: '"><img src=x onerror=alert(2)>@example.com',
    role: 'user', status: 'active', created_at: '2026-11-20T10:00:00Z',
    last_change_at: null, days_inactive: 0, deletion_due_in_days: 7
  };
  const htmlEvil = admin.buildAdminUserRowHtml(evil);
  assert.doesNotMatch(htmlEvil, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(htmlEvil, /<img src=x/);
  assert.match(htmlEvil, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(htmlEvil, /Belum ada perubahan/);
});

test('kartu mobile: info perubahan terakhir yang sama (tanggal + badge + hitung mundur)', () => {
  const { admin } = loadAdminUi('id');
  const dormant = {
    id: 'u3', display_name: 'Raka Pratama', email: 'raka@example.com', role: 'user', status: 'suspended',
    created_at: '2026-11-15T10:00:00Z',
    last_change_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    days_inactive: 10, deletion_due_in_days: 0
  };
  const html = admin.buildAdminUserMobileCardHtml(dormant);
  assert.match(html, /Perubahan Terakhir/);
  assert.match(html, /Dormant/);
  assert.match(html, /dihapus hari ini/);
  assert.match(html, /10 hari lalu/);
  assert.match(html, /Terdaftar: 2026-11-15/);
});

/* ============================================================
   6. Pencatatan aktivitas — throttle 1x/jam + best-effort
   ============================================================ */
test('touch_own_activity: throttle 1x per jam per perangkat; RPC error tidak melempar', async () => {
  const { touch, rpcCalls, localStorage } = loadAuthModule();
  const key = 'mk_last_activity_touch_v1';
  assert.equal(await touch(), true, 'panggilan pertama harus jalan');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'touch_own_activity');
  assert.equal(await touch(), false, 'panggilan kedua dalam 1 jam harus di-throttle');
  assert.equal(rpcCalls.length, 1);
  // Majukan stempel 61 menit: boleh jalan lagi.
  localStorage.setItem(key, String(Date.now() - 61 * 60 * 1000));
  assert.equal(await touch(), true);
  assert.equal(rpcCalls.length, 2);
  // RPC gagal: best-effort — kembalikan false, jangan lempar.
  localStorage.setItem(key, String(Date.now() - 61 * 60 * 1000));
  const failing = loadAuthModule(() => ({ data: null, error: new Error('jaringan putus') }));
  assert.equal(await failing.touch(), false);
  assert.equal(failing.rpcCalls.length, 1);
  const throwing = loadAuthModule(() => { throw new Error('boom'); });
  throwing.localStorage.setItem(key, String(Date.now() - 61 * 60 * 1000));
  assert.equal(await throwing.touch(), false);
});

test('touch_own_activity: dipanggil setelah login berhasil dan setelah flush offline; kunci dihapus saat logout', () => {
  // finishLogin: setelah resolveReady (jalur sukses), sebelum return.
  const finish = authJs.match(/async function finishLogin[\s\S]*?resolveReady\(\);[\s\S]*?\n  \}/);
  assert.ok(finish, 'finishLogin tidak ditemukan');
  assert.match(finish[0], /touchOwnActivity\(\)/, 'finishLogin harus memanggil touchOwnActivity setelah login berhasil');
  // Flush antrean offline: hanya bila ada yang tersinkronisasi.
  assert.match(offlineJs, /if \(synced > 0\) \{\s*try \{\s*const feat = root\.__mkFeat \|\| \{\};\s*if \(typeof feat\.touchOwnActivity === 'function'\) feat\.touchOwnActivity\(\);/,
    'flushOfflineQueue harus memanggil touchOwnActivity saat synced > 0 (best-effort)');
  // Kunci throttle ikut dibersihkan saat logout.
  assert.match(authJs, /\/\/ Admin: throttle pencatatan aktivitas ikut terhapus saat logout[\s\S]*?'mk_last_activity_touch_v1'/);
  assert.match(authJs, /LOGOUT_STORAGE_KEYS/);
});
