const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Fitur admin — notifikasi in-app auto-hapus akun dormant (pengganti
// email Resend). Gaya tes mengikuti tests/admin-last-activity.test.js:
// asersi statis atas sumber untuk kontrak RPC/wiring yang tidak bisa
// dieksekusi tanpa Supabase, plus eksekusi nyata lewat vm untuk logika
// JS murni (render item notifikasi, hitung belum dibaca, tanggal hapus
// terjadwal). Semua fixture ada di dalam repo. Tes waktu memakai
// komponen kalender LOKAL supaya lolos di TZ=Asia/Jakarta DAN TZ=UTC.

const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
const uiAdminJs = fs.readFileSync('web/ui-admin.js', 'utf8');
const adminHtml = fs.readFileSync('src/admin.html', 'utf8');

const NOTIF_KEYS = [
  'adm.notif_title', 'adm.notif_empty', 'adm.notif_new',
  'adm.notif_mark_read', 'adm.notif_warning', 'adm.notif_deleted',
  'adm.notif_delete_on', 'adm.notif_load_failed', 'adm.notif_loading'
];

/* ============================================================
   Loader vm — ui-admin.js + i18n asli + escapeHtmlJS asli,
   dengan fake DOM minimal untuk renderAdminNotifications
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

function fakeEl(tag) {
  const classes = new Set();
  return {
    tagName: tag || 'DIV',
    innerHTML: '',
    textContent: '',
    dataset: {},
    disabled: false,
    _classes: classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c); else classes.add(c);
        } else if (force) classes.add(c); else classes.delete(c);
      },
      contains: (c) => classes.has(c)
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
}

function loadAdminUi(lang) {
  const localStorage = createStorage(lang ? { lang } : {});
  const elements = {
    'adm-notif-list': fakeEl('DIV'),
    'adm-notif-unread-count': fakeEl('SPAN')
  };
  const sandbox = {
    localStorage,
    document: {
      documentElement: { classList: { contains: () => false } },
      addEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: (id) => elements[id] || null
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
  // renderHtml asli butuh DOMParser (tidak ada di vm): ganti dengan
  // stub yang menulis innerHTML apa adanya — cukup untuk menguji
  // logika render/lencana, bukan sanitasi (sanitasi sudah diuji
  // lewat buildAdminNotificationHtml + escapeHtmlJS).
  sandbox.renderHtml = (el, html) => { if (el) el.innerHTML = html == null ? '' : String(html); };
  const admin = sandbox.__mkFeat.adminActivity;
  for (const fn of ['buildAdminNotificationHtml', 'countUnreadAdminNotifications', 'adminNotificationDeletionDate', 'renderAdminNotifications']) {
    assert.equal(typeof admin[fn], 'function', `__mkFeat.adminActivity harus mengekspos ${fn}`);
  }
  return { sandbox, admin, elements, localStorage };
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

/* ============================================================
   1. Kontrak RPC — supabase-admin.js (fail-soft)
   ============================================================ */
test('notif RPC: api_getAdminNotifications memanggil get_admin_notifications dan mempertahankan 8 field kontrak', () => {
  assert.match(adminJs, /async function api_getAdminNotifications\(\)/);
  assert.match(adminJs, /sb\.rpc\('get_admin_notifications'\)/);
  // Pre-check admin seperti api_getAdminActivity.
  const fn = adminJs.match(/async function api_getAdminNotifications\(\)[\s\S]*?\n  \}/);
  assert.ok(fn, 'api_getAdminNotifications tidak ditemukan');
  assert.match(fn[0], /window\.sessionRole !== 'admin'/);
  // Semua field kontrak RPC dipertahankan apa adanya (jangan ubah nama).
  for (const field of [
    'id', 'type', 'target_user_id', 'target_email',
    'title', 'body', 'created_at', 'read_at'
  ]) {
    assert.ok(fn[0].includes(field), `field kontrak RPC hilang dari api_getAdminNotifications: ${field}`);
  }
  // Handler terekspos untuk callServer.
  assert.match(adminJs, /async api_getAdminNotifications\(\) \{\s*return api_getAdminNotifications\(\);\s*\}/);
});

test('notif RPC: api_markAdminNotificationRead memanggil mark_admin_notification_read dengan p_notification_id', () => {
  assert.match(adminJs, /async function api_markAdminNotificationRead\(notificationId\)/);
  assert.match(adminJs, /sb\.rpc\('mark_admin_notification_read', \{ p_notification_id: notificationId \}\)/);
  const fn = adminJs.match(/async function api_markAdminNotificationRead\(notificationId\)[\s\S]*?\n  \}/);
  assert.ok(fn, 'api_markAdminNotificationRead tidak ditemukan');
  assert.match(fn[0], /window\.sessionRole !== 'admin'/);
  assert.match(adminJs, /async api_markAdminNotificationRead\(notificationId\) \{\s*return api_markAdminNotificationRead\(notificationId\);\s*\}/);
});

test('notif RPC: api_getAdminData menyertakan notifikasi secara fail-soft — RPC gagal tidak menggagalkan panel', () => {
  assert.match(adminJs, /api_getAdminNotifications\(\)/);
  const getData = adminJs.match(/async api_getAdminData\(\)[\s\S]*?return \{ users: profiles[\s\S]*?\};/);
  assert.ok(getData, 'api_getAdminData tidak ditemukan');
  // Keempat sumber dalam satu Promise.all.
  assert.match(getData[0], /Promise\.all\(\[[\s\S]*?api_getAdminActivity\(\)[\s\S]*?get_admin_platform_stats[\s\S]*?admin_audit_logs[\s\S]*?api_getAdminNotifications\(\)/);
  // Fail-soft: tangkap error RPC notifikasi, kembalikan [] + penanda gagal.
  assert.match(getData[0], /\.catch\(\(err\) => \{[^}]*return \{ ok: false, rows: \[\] \}/);
  assert.match(getData[0], /notifications, notificationsError: !notificationsRes\.ok/);
  // Aktivitas pengguna tetap gagal lantang bila RPC-nya gagal (bukan fail-soft).
  assert.match(adminJs, /Gagal memuat data aktivitas pengguna \(get_admin_user_activity\)/);
});

/* ============================================================
   2. HTML — bagian Notifikasi di posisi yang benar
   ============================================================ */
test('notif HTML: bagian Notifikasi setelah tabel pengguna, sebelum Log Aktivitas Admin; id + lencana + data-i18n', () => {
  const tableIdx = adminHtml.indexOf('TABLE DAFTAR PENGGUNA');
  const notifIdx = adminHtml.indexOf('NOTIFIKASI ADMIN');
  const logIdx = adminHtml.indexOf('Log Aktivitas Admin');
  assert.ok(tableIdx > -1 && notifIdx > -1 && logIdx > -1, 'penanda posisi tidak ditemukan di admin.html');
  assert.ok(tableIdx < notifIdx, 'bagian Notifikasi harus setelah tabel Daftar Akun Pengguna');
  assert.ok(notifIdx < logIdx, 'bagian Notifikasi harus sebelum Log Aktivitas Admin');
  assert.match(adminHtml, /id="adm-notif-unread-count" class="hidden /);
  assert.match(adminHtml, /id="adm-notif-list"/);
  assert.match(adminHtml, /data-i18n="adm\.notif_title"/);
  assert.match(adminHtml, /data-i18n="adm\.notif_loading"/);
  // Label tombol di bagian baru lewat i18n (bukan hardcode).
  const section = adminHtml.slice(notifIdx, logIdx);
  assert.match(section, /data-i18n="app\.reload_data"/);
  assert.doesNotMatch(section, /Tandai dibaca/, 'label "Tandai dibaca" tidak boleh hardcode di HTML (lewat admT di JS)');
});

/* ============================================================
   3. i18n — 9 kunci baru ada di id dan en
   ============================================================ */
test('i18n: 9 kunci adm.notif_* ada di id dan en, sudah diterjemahkan', () => {
  const i18n = loadI18nDictionary();
  for (const key of NOTIF_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.id, key), `kunci id hilang: ${key}`);
    assert.ok(Object.prototype.hasOwnProperty.call(i18n.en, key), `kunci en hilang: ${key}`);
    assert.notEqual(i18n.id[key], key, `nilai id belum diterjemahkan: ${key}`);
    assert.notEqual(i18n.en[key], key, `nilai en belum diterjemahkan: ${key}`);
  }
  assert.equal(i18n.id['adm.notif_title'], 'Notifikasi');
  assert.equal(i18n.en['adm.notif_title'], 'Notifications');
  assert.equal(i18n.id['adm.notif_mark_read'], 'Tandai dibaca');
  assert.equal(i18n.en['adm.notif_mark_read'], 'Mark as read');
  assert.equal(i18n.id['adm.notif_empty'], 'Belum ada notifikasi.');
  assert.equal(i18n.en['adm.notif_empty'], 'No notifications yet.');
  assert.equal(i18n.id['adm.notif_delete_on'], 'Akan dihapus pada');
  assert.equal(i18n.en['adm.notif_delete_on'], 'Scheduled for deletion on');
});

/* ============================================================
   4. Render item notifikasi (id)
   ============================================================ */
const warningUnread = {
  id: '11111111-1111-1111-1111-111111111111',
  type: 'deletion_warning',
  target_user_id: 'u2',
  target_email: 'sinta@example.com',
  title: 'Akun akan dihapus besok',
  body: 'Akun sinta@example.com tidak aktif selama 6 hari dan akan dihapus otomatis besok.',
  created_at: '2026-11-27T10:00:00',
  read_at: null
};

const doneRead = {
  id: '22222222-2222-2222-2222-222222222222',
  type: 'deletion_done',
  target_user_id: 'u3',
  target_email: 'raka@example.com',
  title: 'Akun telah dihapus',
  body: 'Akun raka@example.com dihapus otomatis karena tidak aktif selama 7 hari.',
  created_at: '2026-11-26T10:00:00',
  read_at: '2026-11-26T12:00:00'
};

test('render item: peringatan belum dibaca menampilkan email + label Baru + tombol tandai-dibaca + tanggal hapus (created_at + 1 hari)', () => {
  const { admin } = loadAdminUi('id');
  const html = admin.buildAdminNotificationHtml(warningUnread);
  assert.match(html, /sinta@example\.com/);
  assert.match(html, /Akun akan dihapus besok/);
  assert.match(html, /tidak aktif selama 6 hari/);
  assert.match(html, /Baru/);
  assert.match(html, /Peringatan penghapusan/);
  assert.match(html, /Tandai dibaca/);
  assert.match(html, /data-admin-notif-read/);
  assert.match(html, /data-notif-id="11111111-1111-1111-1111-111111111111"/);
  // Tanggal dibuat + tanggal hapus terjadwal (27 Nov + 1 hari = 28 Nov).
  assert.match(html, /2026-11-27/);
  assert.match(html, /Akan dihapus pada 2026-11-28/);
  // Penekanan visual item belum dibaca.
  assert.match(html, /border-rose-500/);
});

test('render item: yang sudah dibaca tanpa label Baru dan tanpa tombol; deletion_done tanpa tanggal hapus', () => {
  const { admin } = loadAdminUi('id');
  const html = admin.buildAdminNotificationHtml(doneRead);
  assert.match(html, /raka@example\.com/);
  assert.match(html, /Akun telah dihapus/);
  assert.match(html, /Akun dihapus/);
  assert.doesNotMatch(html, /Baru/);
  assert.doesNotMatch(html, /data-admin-notif-read/);
  assert.doesNotMatch(html, /Tandai dibaca/);
  assert.doesNotMatch(html, /Akan dihapus pada/);
  assert.doesNotMatch(html, /border-rose-500/);
  // Tetap ada tanggal dibuat.
  assert.match(html, /2026-11-26/);
});

test('render item: label Inggris dan tidak ada hardcode Indonesia', () => {
  const { admin } = loadAdminUi('en');
  const html = admin.buildAdminNotificationHtml(warningUnread);
  assert.match(html, /New/);
  assert.match(html, /Deletion warning/);
  assert.match(html, /Mark as read/);
  assert.match(html, /Scheduled for deletion on 2026-11-28/);
  assert.doesNotMatch(html, /Baru/);
  assert.doesNotMatch(html, /Tandai dibaca/);
  assert.doesNotMatch(html, /Peringatan penghapusan/);
  assert.doesNotMatch(html, /Akan dihapus pada/);
  const htmlDone = admin.buildAdminNotificationHtml(doneRead);
  assert.match(htmlDone, /Account deleted/);
  assert.doesNotMatch(htmlDone, /Akun dihapus/);
});

test('render item: title/body/email/id berbahaya ter-escape (XSS)', () => {
  const { admin } = loadAdminUi('id');
  const evil = {
    id: 'n1"><script>alert(4)</script>',
    type: 'deletion_warning',
    target_user_id: 'u9',
    target_email: '"><img src=x onerror=alert(2)>@example.com',
    title: '<script>alert(1)</script>',
    body: '<svg onload=alert(3)>',
    created_at: '2026-11-27T10:00:00',
    read_at: null
  };
  const html = admin.buildAdminNotificationHtml(evil);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<svg onload/);
  assert.doesNotMatch(html, /"><script>alert\(4\)/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;svg onload=alert\(3\)&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.match(html, /data-notif-id="n1&quot;&gt;&lt;script&gt;alert\(4\)&lt;\/script&gt;"/);
});

/* ============================================================
   5. Hitung belum dibaca + tanggal hapus terjadwal
   ============================================================ */
test('hitung belum dibaca: 0 / 1 / N — hanya read_at null yang dihitung', () => {
  const { admin } = loadAdminUi('id');
  assert.equal(admin.countUnreadAdminNotifications([]), 0);
  assert.equal(admin.countUnreadAdminNotifications(null), 0);
  assert.equal(admin.countUnreadAdminNotifications(undefined), 0);
  assert.equal(admin.countUnreadAdminNotifications([warningUnread]), 1);
  assert.equal(admin.countUnreadAdminNotifications([doneRead]), 0);
  assert.equal(admin.countUnreadAdminNotifications([warningUnread, doneRead]), 1);
  const three = [
    { ...warningUnread, id: 'a' },
    { ...warningUnread, id: 'b', read_at: '2026-11-27T11:00:00' },
    { ...warningUnread, id: 'c' },
    { ...doneRead, id: 'd', read_at: null }
  ];
  assert.equal(admin.countUnreadAdminNotifications(three), 3);
});

test('tanggal hapus terjadwal: created_at + 1 hari kalender lokal; tanpa data = kosong (jangan mengarang)', () => {
  const { admin } = loadAdminUi('id');
  assert.equal(admin.adminNotificationDeletionDate(warningUnread), '2026-11-28');
  // Batas tengah malam lokal: 27 Nov 23:30 -> 28 Nov.
  assert.equal(admin.adminNotificationDeletionDate({ created_at: '2026-11-27T23:30:00' }), '2026-11-28');
  // Akhir bulan: 30 Nov -> 1 Des.
  assert.equal(admin.adminNotificationDeletionDate({ created_at: '2026-11-30T10:00:00' }), '2026-12-01');
  // Akhir tahun: 31 Des -> 1 Jan.
  assert.equal(admin.adminNotificationDeletionDate({ created_at: '2026-12-31T10:00:00' }), '2027-01-01');
  assert.equal(admin.adminNotificationDeletionDate({}), '');
  assert.equal(admin.adminNotificationDeletionDate({ created_at: null }), '');
  assert.equal(admin.adminNotificationDeletionDate({ created_at: 'bukan-tanggal' }), '');
  assert.equal(admin.adminNotificationDeletionDate(null), '');
});

/* ============================================================
   6. renderAdminNotifications — lencana + kosong + gagal
   ============================================================ */
test('render daftar: lencana belum dibaca tampil bila > 0, tersembunyi bila 0; kosong menampilkan teks kosong', () => {
  const { admin, elements } = loadAdminUi('id');
  admin.renderAdminNotifications([], false);
  assert.equal(elements['adm-notif-unread-count'].textContent, '0');
  assert.ok(elements['adm-notif-unread-count']._classes.has('hidden'), 'lencana harus tersembunyi bila 0 belum dibaca');
  assert.match(elements['adm-notif-list'].innerHTML, /Belum ada notifikasi\./);

  admin.renderAdminNotifications([warningUnread, doneRead], false);
  assert.equal(elements['adm-notif-unread-count'].textContent, '1');
  assert.ok(!elements['adm-notif-unread-count']._classes.has('hidden'), 'lencana harus tampil bila ada yang belum dibaca');
  assert.match(elements['adm-notif-list'].innerHTML, /sinta@example\.com/);
  assert.match(elements['adm-notif-list'].innerHTML, /raka@example\.com/);
  // Tepat satu label "Baru" (hanya item belum dibaca).
  assert.equal((elements['adm-notif-list'].innerHTML.match(/Baru/g) || []).length, 1);
  // Tepat satu tombol tandai-dibaca, dengan id yang benar.
  assert.equal((elements['adm-notif-list'].innerHTML.match(/data-admin-notif-read/g) || []).length, 1);
  assert.match(elements['adm-notif-list'].innerHTML, /data-notif-id="11111111-1111-1111-1111-111111111111"/);
});

test('render daftar: RPC gagal menampilkan pesan gagal kecil (bukan daftar kosong), lencana 0 tersembunyi', () => {
  const { admin, elements } = loadAdminUi('id');
  admin.renderAdminNotifications([], true);
  assert.match(elements['adm-notif-list'].innerHTML, /Gagal memuat notifikasi\./);
  assert.doesNotMatch(elements['adm-notif-list'].innerHTML, /Belum ada notifikasi\./);
  assert.equal(elements['adm-notif-unread-count'].textContent, '0');
  assert.ok(elements['adm-notif-unread-count']._classes.has('hidden'));
});

/* ============================================================
   7. Wiring — loadAdminData + tombol tandai-dibaca + tanpa hardcode
   ============================================================ */
test('wiring: loadAdminData merender notifikasi (termasuk saat seluruh panel gagal) dan tombol tandai-dibaca memanggil RPC lalu memuat ulang', () => {
  assert.match(uiAdminJs, /renderAdminNotifications\(data\.notifications \|\| \[\], data\.notificationsError\)/);
  assert.match(uiAdminJs, /renderAdminNotifications\(\[\], true\)/);
  const bind = uiAdminJs.match(/function bindAdminNotificationButtons[\s\S]*?\n  \}/);
  assert.ok(bind, 'bindAdminNotificationButtons tidak ditemukan');
  assert.match(bind[0], /callServer\('api_markAdminNotificationRead', id\)/);
  assert.match(bind[0], /await loadAdminData\(\)/);
  assert.match(bind[0], /data-notif-id|dataset\.notifId/);
});

test('tanpa hardcode: semua label baru di blok notifikasi ui-admin.js lewat admT(), bukan string Indonesia', () => {
  const start = uiAdminJs.indexOf('// --- Notifikasi admin');
  const end = uiAdminJs.indexOf('async function adminUnlinkUserTelegram');
  assert.ok(start > -1 && end > start, 'blok notifikasi tidak ditemukan di ui-admin.js');
  const block = uiAdminJs.slice(start, end);
  // Label UI baru tidak boleh muncul sebagai literal string.
  for (const literal of [
    'Tandai dibaca', 'Belum ada notifikasi', 'Gagal memuat notifikasi',
    'Peringatan penghapusan', 'Akun dihapus', 'Akan dihapus pada'
  ]) {
    assert.ok(!block.includes(`'${literal}'`) && !block.includes(`"${literal}"`), `label hardcode di blok notifikasi ui-admin.js: ${literal}`);
  }
  // Semua label lewat admT('adm.notif_*') — kecuali title & loading
  // yang tampil lewat data-i18n di admin.html.
  for (const key of NOTIF_KEYS.filter((k) => k !== 'adm.notif_title' && k !== 'adm.notif_loading')) {
    assert.ok(block.includes(`admT('${key}')`), `blok notifikasi harus memakai admT('${key}')`);
  }
  assert.ok(!block.includes("admT('adm.notif_title')"), 'judul bagian lewat data-i18n di HTML, bukan admT di JS');
  assert.ok(!block.includes("admT('adm.notif_loading')"), 'teks memuat lewat data-i18n di HTML, bukan admT di JS');
  // Semua nilai server lewat escapeHtmlJS.
  assert.ok(block.includes('escapeHtmlJS(n.title'), 'title harus lewat escapeHtmlJS');
  assert.ok(block.includes('escapeHtmlJS(n.body'), 'body harus lewat escapeHtmlJS');
  assert.ok(block.includes('escapeHtmlJS(n.target_email'), 'target_email harus lewat escapeHtmlJS');
  assert.ok(block.includes('escapeHtmlJS(String(n.id'), 'id harus lewat escapeHtmlJS');
});
