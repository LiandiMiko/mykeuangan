const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseTransactionCsv } = require('../web/transaction-import.js');

// Gelombang 6 Worker C — pesan error, i18n/copy, konsistensi visual
// (temuan U7–U9, U21–U26, U28, U29, U31, U36–U41).
// Gaya tes mengikuti repo: asersi statis atas sumber untuk hal yang tidak
// bisa dieksekusi tanpa DOM/Swal, plus eksekusi nyata lewat vm/require
// untuk logika (sanitasi error, parser template CSV, paritas kamus).

const read = (p) => fs.readFileSync(p, 'utf8');
const srcFiles = fs.readdirSync('src').filter((n) => n.endsWith('.html'));
const webFiles = fs.readdirSync('web').filter((n) => n.endsWith('.js'));

function loadI18nDictionary() {
  const html = read('src/i18n.html');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'expected <script> block in src/i18n.html');
  const sandbox = {
    localStorage: { getItem: () => 'id', setItem: () => {} },
    document: { addEventListener: () => {}, querySelectorAll: () => [] },
    window: {}
  };
  return vm.runInNewContext(`${scriptMatch[1]}\n({ id: I18N.id, en: I18N.en });`, sandbox);
}

function loadErrorMessages() {
  const code = read('web/error-messages.js');
  const windowObj = {};
  const sandbox = {
    window: windowObj,
    localStorage: { getItem: () => 'id', setItem: () => {} }
  };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.runInNewContext(code, sandbox);
  return windowObj;
}

/* ============================================================
   U9 — tidak ada lagi pesan error mentah di Swal / tampilan
   ============================================================ */

test('6C/U9 tidak ada pesan error mentah (String(e.message…)) di Swal error web/*.js', () => {
  const rawInSwal = /Swal\.fire\([^)]*text:\s*String\(/;
  const rawTextPattern = /text:\s*String\((e|err|saveErr)\.message/;
  const rawConcat = /text:\s*(e|err)\.message \|\| String\((e|err)\)/;
  for (const name of webFiles) {
    const code = read(`web/${name}`);
    assert.doesNotMatch(code, rawInSwal, `raw String(...) di Swal error web/${name}`);
    assert.doesNotMatch(code, rawTextPattern, `text: String(e.message…) di web/${name}`);
    assert.doesNotMatch(code, rawConcat, `text: e.message || String(e) di web/${name}`);
  }
  // Pengecualian yang disengaja: finance-analysis-ai.js tidak menampilkan
  // error sama sekali (tanpa Swal) — satu-satunya `text: String(...)` di
  // sana adalah pemetaan payload teks percakapan ke API AI
  // (buildAiChatSteps: `content: [{ type: 'text', text: String(m.text…)}]`),
  // bukan tampilan error; audit memerintahkan untuk tidak mengubahnya.
  const faai = read('web/finance-analysis-ai.js');
  assert.doesNotMatch(faai, /Swal\.fire/);
  assert.match(faai, /content: \[\{ type: 'text', text: String\(m\.text/);
  // Pola pencocokan regex internal (bukan tampilan) di ui-feat-backup.js
  // dan ui-feat-offline.js tetap dibolehkan.
});

test('6C/U9 sanitasi dipakai: toUserErrorMessage / showActionError di situs lama', () => {
  const wallets = read('web/ui-wallets.js');
  assert.equal((wallets.match(/showActionError\(e\);/g) || []).length, 6,
    'ui-wallets.js: 4 situs Swal mentah diganti showActionError + 2 yang sudah ada');
  assert.match(read('web/ui-budget.js'), /showActionError\(e\);/);
  assert.match(read('web/ui-recurring.js'), /showActionError\(e\);/);
  assert.match(read('web/ui-feat-modals.js'), /showActionError\(e\);/);
  assert.match(read('web/ui-asset-ops.js'), /showActionError\(e\);/);
  assert.match(read('web/ui-assets.js'), /text: toUserErrorMessage\(e\)/);
  assert.match(read('web/ui-feat-ai.js'), /text: toUserErrorMessage\(err\)/);
  assert.match(read('web/ui-form.js'), /text: toUserErrorMessage\(err\)/);
  assert.match(read('web/ui-pro-insights.js'), /text: toUserErrorMessage\(err\)/);
  assert.match(read('web/ui-ai.js'), /text: toUserErrorMessage\(saveErr\)/);
  // Cabang fallback (bila helper belum termuat) tetap tersanitasi.
  assert.match(read('web/ui-feat-backup.js'), /typeof toUserErrorMessage === 'function' \? toUserErrorMessage\(err\)/);
  assert.match(read('web/ui-feat-recurring.js'), /typeof toUserErrorMessage === 'function' \? toUserErrorMessage\(err\)/);
  // supabase-auth.js: notice profil gagal muat ikut disanitasi, dengan
  // penjaga typeof — file ini juga dimuat mandiri oleh tes Wave 3 di vm
  // tanpa toUserErrorMessage (regresi 2026-11-28: ReferenceError).
  assert.match(read('web/supabase-auth.js'), /typeof toUserErrorMessage === 'function' \? toUserErrorMessage\(e\)/);
  assert.match(read('web/supabase-records.js'), /message: \(typeof toUserErrorMessage === 'function' \? toUserErrorMessage\(e\)/);
});

test('6C/U9 toUserErrorMessage benar-benar menyembunyikan pesan teknis', () => {
  const win = loadErrorMessages();
  const toUserErrorMessage = win.toUserErrorMessage;
  assert.equal(typeof toUserErrorMessage, 'function');
  assert.equal(
    toUserErrorMessage(new Error('row level security policy violation on wallets')),
    'Anda tidak punya akses untuk tindakan ini.'
  );
  assert.equal(
    toUserErrorMessage(new Error('duplicate key value violates unique constraint "wallets_pkey"')),
    'Data sudah ada — tidak disimpan dua kali.'
  );
  assert.equal(
    toUserErrorMessage(new Error('Failed to fetch')),
    'Tidak ada koneksi internet. Periksa koneksi lalu coba lagi.'
  );
  // Pesan aplikasi sendiri (userMessage / validasi klien) diteruskan utuh.
  const own = new Error('x');
  own.userMessage = 'Batas impor 500 baris.';
  assert.equal(toUserErrorMessage(own), 'Batas impor 500 baris.');
  assert.equal(toUserErrorMessage(new Error('Isi nominal lebih dari 0.')), 'Isi nominal lebih dari 0.');
});

test('6C/U9 banner gagal muat generik, terjemahan, tanpa kata Supabase', () => {
  const shell = read('web/ui-shell.js');
  assert.doesNotMatch(shell, /Gagal memuat data keuangan dari Supabase/);
  assert.doesNotMatch(shell, /String\(\(err && err\.message\) \|\| err\)/);
  assert.match(shell, /t\('alert\.load_failed'\)/);
  assert.match(shell, /toUserErrorMessage\(err\)/);
  assert.match(shell, /t\('app\.reload_data'\)/);
  // Tombol "Muat Ulang Data" dipertahankan (aksi retry yang sama).
  assert.match(shell, /data-action="retryInitialAppLoad"/);
});

/* ============================================================
   U8 + kamus — tidak ada lagi label modal hardcode, paritas 347=347
   ============================================================ */

test('6C/U8 tidak ada confirmButtonText Simpan / cancelButtonText Batal hardcode', () => {
  for (const name of webFiles) {
    const code = read(`web/${name}`);
    assert.doesNotMatch(code, /confirmButtonText: 'Simpan'/, `Simpan hardcode di web/${name}`);
    assert.doesNotMatch(code, /cancelButtonText: 'Batal'/, `Batal hardcode di web/${name}`);
  }
  assert.match(read('web/ui-wallets.js'), /title: t\('wallet\.added'\)/);
  assert.match(read('web/ui-wallets.js'), /title: t\('wallet\.primary_set'\)/);
  assert.match(read('web/ui-wallets.js'), /title: t\('dash\.add_wallet'\)/);
  assert.match(read('web/ui-dashboard.js'), /t\('dash\.empty_in'\)/);
  assert.match(read('web/ui-dashboard.js'), /t\('dash\.empty_out'\)/);
  assert.match(read('web/ui-dashboard.js'), /t\('dash\.record_in'\)/);
  assert.match(read('web/ui-dashboard.js'), /t\('dash\.record_out'\)/);
  assert.match(read('web/ui-debts.js'), /t\('utang\.kosong'\)/);
});

test('6C/U8+U23+U24+U39 paritas kamus 363=363 dan nilai kunci baru/ubah', () => {
  const i18n = loadI18nDictionary();
  const idKeys = Object.keys(i18n.id).sort();
  const enKeys = Object.keys(i18n.en).sort();
  assert.equal(idKeys.length, 417, 'kamus ID harus 417 kunci (372 Gelombang 6C + 45 kunci sync.* optimistic locking Gelombang 7c)');
  assert.deepEqual(idKeys, enKeys, 'I18N.id dan I18N.en harus identik');
  // Kunci baru Gelombang 6C ada di kedua bahasa.
  for (const key of [
    'wallet.added', 'wallet.primary_set', 'wallet.primary_set_text', 'wallet.empty',
    'dash.empty_in', 'dash.empty_out', 'dash.record_in', 'dash.record_out',
    'budget.no_activity_category', 'budget.no_activity_cashflow',
    'app.reload_data', 'form.title', 'form.wallet', 'form.wallet_in',
    'form.wallet_out', 'form.reset_nominal', 'form.split_bill',
    'lap.import_format', 'tg.webhook_hint', 'tg.webhook_updated',
    'tg.botfather_username_note', 'utang.add',
    // Kunci baru Gelombang 6B (navigasi Utang + tombol transfer terpisah).
    'nav.utang', 'nav.utang_short', 'dash.transfer', 'dash.transfer_full', 'dash.withdraw'
  ]) {
    assert.ok(i18n.id[key], `kunci ID hilang: ${key}`);
    assert.ok(i18n.en[key], `kunci EN hilang: ${key}`);
  }
  // Kunci lama yang dipecah sudah tidak ada.
  assert.ok(!('budget.no_activity' in i18n.id), 'budget.no_activity harus sudah dipecah');
  assert.ok(!('budget.no_activity' in i18n.en), 'budget.no_activity harus sudah dipecah');
  // U23: terjemahan Inggris yang bertabrakan diperbaiki.
  assert.equal(i18n.en['budget.warning'], 'Approaching');
  assert.equal(i18n.id['budget.warning'], 'Mendekati');
  assert.equal(i18n.en['budget.lebih'], 'Over by');
  assert.equal(i18n.id['budget.lebih'], 'Lebih');
  assert.notEqual(i18n.en['budget.lebih'], i18n.en['budget.over'],
    'budget.lebih dan budget.over tidak boleh lagi sama di EN');
  // U23: budget.lebih tidak dipakai di JS, jadi perubahan EN tidak bisa
  // merusak kalimat ("Lebih Rp X" tidak pernah dirangkai dari kunci ini).
  for (const name of webFiles) {
    assert.doesNotMatch(read(`web/${name}`), /t\('budget\.lebih'\)/, `budget.lebih dipakai di web/${name}`);
  }
  // U39: istilah diselaraskan.
  assert.equal(i18n.id['dash.piutang_saya'], 'Total Piutang (Mengutangi)');
  // Keputusan "Reset": ID memakai "Atur Ulang" (ID murni), EN tetap Reset.
  assert.equal(i18n.id['filter.reset'], 'Atur Ulang Filter');
  assert.equal(i18n.en['filter.reset'], 'Reset Filters');
  assert.equal(i18n.id['ai.reset_chat'], 'Atur Ulang Obrolan');
  assert.equal(i18n.en['ai.reset_chat'], 'Reset Chat');
  assert.equal(i18n.id['form.reset_nominal'], 'Atur Ulang');
});

/* ============================================================
   U7 — CTA utama brand, emerald hanya semantik pemasukan
   ============================================================ */

test('6C/U7 tombol Tambah Dompet & tambah kategori memakai bg-brand', () => {
  const dash = read('src/dashboard.html');
  assert.match(dash, /data-action="addWallet" class="[^"]*bg-brand /);
  assert.doesNotMatch(dash, /data-action="addWallet" class="[^"]*bg-emerald/);
  const form = read('src/form.html');
  assert.match(form, /data-action="promptAddCategory"[^>]*class="[^"]*bg-brand /);
  assert.doesNotMatch(form, /data-action="promptAddCategory"[^>]*class="[^"]*bg-emerald/);
  // Emerald tetap untuk hal semantik pemasukan — jangan ikut diubah.
  assert.match(read('src/histori.html'), /data-args='\["Pemasukan"\]'[^>]*bg-emerald-600/);
  assert.match(read('web/ui-form.js'), /tipe === 'Pemasukan' \? 'bg-emerald-600/);
});

/* ============================================================
   U21 — teks terpotong punya title berisi teks lengkap
   ============================================================ */

test('6C/U21 nama/keterangan transaksi yang di-truncate punya title', () => {
  const dash = read('web/ui-dashboard.js');
  assert.match(dash, /<p class="text-sm font-bold[^"]*truncate" title="\$\{safeCatHtml\}">/);
  assert.match(dash, /title="\$\{escapeHtmlJS\(String\(tx\.tanggal\)\.substring\(5\)\)\} · \$\{escapeHtmlJS\(tx\.keterangan \|\| '-'\)\}"/);
  const budget = read('web/ui-budget.js');
  assert.match(budget, /title="\$\{escapeHtmlJS\(tx\.keterangan \|\| '\(tanpa catatan\)'\)\}"/);
  assert.match(budget, /title="\$\{escapeHtmlJS\(b\.kategori\)\}"/);
  // Pola benar yang sudah ada tetap ada (utang, kalender).
  assert.match(read('web/ui-debts.js'), /title="\$\{safeName\}"/);
  // Nilai KPI dashboard ikut punya title (nilai penuh) lewat setText.
  assert.match(dash, /if \(el\) \{ el\.innerText = val; el\.title = val; \}/);
  // Judul dashboard (nama pengguna panjang) + nama pengguna sidebar.
  assert.match(read('web/ui-state.js'), /dEl\.title = dEl\.textContent;/);
  assert.match(read('web/ui-shell.js'), /uEl\.title = root\.sessionUser;/);
});

/* ============================================================
   U22 — satu ikon dompet: ph ph-wallet (regular)
   ============================================================ */

test('6C/U22 semua ikon dompet seragam ph ph-wallet', () => {
  for (const name of srcFiles) {
    const html = read(`src/${name}`);
    assert.doesNotMatch(html, /ph-fill ph-wallet/, `ph-fill ph-wallet di src/${name}`);
    assert.doesNotMatch(html, /ph-bold ph-wallet/, `ph-bold ph-wallet di src/${name}`);
    assert.doesNotMatch(html, /ph ph-credit-card/, `ph-credit-card di src/${name}`);
  }
  for (const name of webFiles) {
    const code = read(`web/${name}`);
    assert.doesNotMatch(code, /ph-fill ph-wallet/, `ph-fill ph-wallet di web/${name}`);
    assert.doesNotMatch(code, /ph-bold ph-wallet/, `ph-bold ph-wallet di web/${name}`);
    assert.doesNotMatch(code, /ph ph-credit-card/, `ph-credit-card di web/${name}`);
  }
  assert.match(read('src/Index.html'), /ph ph-wallet/);
  assert.match(read('src/dashboard.html'), /ph ph-wallet text-lg/);
  assert.match(read('web/ui-feat-hooks.js'), /let iconClass = 'ph ph-wallet';/);
  assert.match(read('web/supabase-auth.js'), /ph ph-wallet/);
});

/* ============================================================
   U24 — fallback sama dengan kamus; kunci no_activity dipecah
   ============================================================ */

test('6C/U24 fallback tombol budget sama dengan kamus; dua empty state berkunci beda', () => {
  const budgeting = read('src/budgeting.html');
  assert.match(budgeting, /data-i18n="budget\.btn_save">Simpan Budget</);
  assert.match(budgeting, /data-i18n="budget\.no_activity_category">Belum ada transaksi pengeluaran di periode ini\.</);
  assert.match(budgeting, /data-i18n="budget\.no_activity_cashflow">Belum ada data arus kas\.</);
  assert.doesNotMatch(budgeting, /data-i18n="budget\.no_activity"/);
  assert.match(read('web/ui-budget.js'), /t\('budget\.no_activity_category'\)/);
  assert.doesNotMatch(read('web/ui-budget.js'), /t\('budget\.no_activity'\)/);
});

/* ============================================================
   U25 — filter histori kosong menjelaskan + tombol reset
   ============================================================ */

test('6C/U25 empty state filter histori memakai lap.no_results + tombol reset', () => {
  const analytics = read('web/ui-feat-analytics.js');
  assert.match(analytics, /t\('lap\.no_results'\)/);
  assert.match(analytics, /data-action="resetHistoriFilters"/);
  // Tombol reset memanggil fungsi yang sama dengan tombol di histori.html.
  assert.match(analytics, /function resetHistoriFilters\(\)/);
  assert.match(read('src/histori.html'), /data-action="resetHistoriFilters"/);
});

/* ============================================================
   U26, U28, U29 — copy tanggal, webhook, BotFather
   ============================================================ */

test('6C/U26 pesan error tanggal tidak lagi menyebut format YYYY-MM-DD', () => {
  const form = read('web/ui-form.js');
  assert.doesNotMatch(form, /Isi tanggal dengan format YYYY-MM-DD/);
  assert.match(form, /Pilih tanggal dari kalender atau ketik tanggal yang benar, mis\. 28 November 2026\./);
});

test('6C/U28 tombol webhook punya keterangan awam + toast diperjelas', () => {
  const admin = read('web/ui-admin.js');
  assert.match(admin, /t\('tg\.webhook_hint'\)/);
  assert.match(admin, /title: t\('tg\.webhook_updated'\)/);
  const i18n = loadI18nDictionary();
  assert.equal(i18n.id['tg.webhook_hint'], 'Tekan bila bot berhenti menerima pesan');
  assert.match(i18n.id['tg.webhook_updated'], /bot siap menerima pesan lagi/);
});

test('6C/U29 panduan BotFather menautkan t.me/BotFather + catatan username', () => {
  const admin = read('web/ui-admin.js');
  assert.match(admin, /href="https:\/\/t\.me\/BotFather"/);
  assert.match(admin, /t\('tg\.botfather_username_note'\)/);
  const i18n = loadI18nDictionary();
  assert.equal(i18n.id['tg.botfather_username_note'], 'Bila username sudah dipakai, coba nama lain.');
});

/* ============================================================
   U31 — template CSV berisi 2 baris contoh yang lolos parser
   ============================================================ */

test('6C/U31 template CSV berisi header + 2 baris contoh', () => {
  const reports = read('web/ui-reports.js');
  const fnBody = reports.slice(reports.indexOf('function downloadTransactionTemplate()'));
  const segments = [...fnBody.slice(0, fnBody.indexOf('const filename')).matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.equal(segments.length, 3, 'template harus terdiri dari header + 2 baris contoh');
  assert.match(segments[0], /^tanggal,tipe,kategori,nominal,keterangan,dompet/);
  assert.match(segments[1], /^2026-11-28,Pemasukan,Gaji,5000000,Gaji November,BCA \(m-banking\)/);
  assert.match(segments[2], /^2026-11-27,Pengeluaran,Makanan & Minuman,75000,Makan siang,Cash/);
  // Kalimat format ada di dialog impor (pratinjau impor, file yang sama).
  assert.match(reports, /t\('lap\.import_format'\)/);
});

test('6C/U31 dua baris contoh template lolos parser impor untuk akun baru', () => {
  const reports = read('web/ui-reports.js');
  const fnBody = reports.slice(reports.indexOf('function downloadTransactionTemplate()'));
  const segments = [...fnBody.slice(0, fnBody.indexOf('const filename')).matchAll(/'([^']*)'/g)].map((m) => m[1]);
  // Segmen diekstrak dari sumber mentah: escape '\r\n' di dalam literal
  // string JS harus diubah menjadi CRLF asli seperti saat kode berjalan.
  const content = segments.join('').replace(/\\r\\n/g, '\r\n');
  const wallets = [
    { id: 'w-bca', name: 'BCA (m-banking)' },
    { id: 'w-cash', name: 'Cash' }
  ];
  const categories = {
    pemasukan: ['Gaji', 'Investasi', 'Bonus & Hadiah', 'Lainnya'],
    pengeluaran: ['Makanan & Minuman', 'Transportasi', 'Tagihan & Langganan', 'Belanja & Kebutuhan', 'Hiburan']
  };
  const result = parseTransactionCsv(content, [], wallets, { categories });
  assert.equal(result.invalidCount, 0, `baris contoh harus valid, error: ${JSON.stringify(result.rows.map((r) => r.errors))}`);
  assert.equal(result.valid.length, 2);
  assert.equal(result.valid[0].tanggal, '2026-11-28');
  assert.equal(result.valid[0].nominal, 5000000);
  assert.equal(result.valid[0].walletId, 'w-bca');
  assert.equal(result.valid[1].kategori, 'Makanan & Minuman');
  assert.equal(result.valid[1].nominal, 75000);
  assert.equal(result.valid[1].walletId, 'w-cash');
});

/* ============================================================
   U36, U37 — radius kartu & nilai besar
   ============================================================ */

test('6C/U36 kartu render-JS memakai pola rounded-2xl sm:rounded-3xl', () => {
  const analytics = read('web/ui-feat-analytics.js');
  assert.doesNotMatch(analytics, /(?<!sm:)rounded-3xl p-5 border/,
    'tidak boleh ada kartu rounded-3xl tetap (tanpa sm:) di ui-feat-analytics.js');
  assert.ok((analytics.match(/rounded-2xl sm:rounded-3xl p-5 border/g) || []).length >= 5,
    'semua kartu putih render-JS di ui-feat-analytics.js harus berpola responsif');
  assert.match(read('web/ui-dashboard.js'), /rounded-2xl sm:rounded-3xl border border-dashed/);
});

test('6C/U37 angka kekayaan bersih tidak lagi truncate di 360px; tombol admin boleh wrap', () => {
  const dash = read('src/dashboard.html');
  const hero = dash.slice(dash.indexOf('id="dash-total-aset"') - 200, dash.indexOf('id="dash-total-aset"'));
  assert.doesNotMatch(hero, /truncate/);
  assert.match(hero, /text-2xl min-\[400px\]:text-\[28px\] sm:text-5xl/);
  assert.match(hero, /whitespace-nowrap/);
  const admin = read('src/admin.html');
  const btn = admin.slice(admin.indexOf('data-action="changeOwnPassword"'), admin.indexOf('data-action="changeOwnPassword"') + 260);
  assert.doesNotMatch(btn, /truncate/);
});

/* ============================================================
   U38 — string form transaksi ber-i18n
   ============================================================ */

test('6C/U38 judul/label/tombol form transaksi memakai data-i18n', () => {
  const form = read('src/form.html');
  assert.match(form, /id="formTitle"[^>]*data-i18n="form\.title">Catat Transaksi</);
  assert.match(form, /id="tr_wallet_label"[^>]*data-i18n="form\.wallet">Dompet</);
  assert.match(form, /data-action="resetQuickNominalAmount"[^>]*data-i18n="form\.reset_nominal">Atur Ulang</);
  assert.match(form, /data-i18n="form\.split_bill">Split Bill \/ Patungan \(catatkan porsi teman otomatis ke Piutang\)</);
  // Label dompet yang diganti JS saat form dibuka juga lewat kamus.
  assert.match(read('web/ui-form.js'), /t\('form\.wallet_in'\)/);
  assert.match(read('web/ui-form.js'), /t\('form\.wallet_out'\)/);
});

/* ============================================================
   U39, U40, U41 — istilah, empty state dompet & utang
   ============================================================ */

test('6C/U39 tidak ada lagi Buang Gagal / Gaji atau pendapatan di kode UI', () => {
  for (const name of webFiles) {
    const code = read(`web/${name}`);
    assert.doesNotMatch(code, /Buang Gagal/, `Buang Gagal di web/${name}`);
    assert.doesNotMatch(code, /Gaji atau pendapatan/, `Gaji atau pendapatan di web/${name}`);
  }
  assert.match(read('web/ui-feat-offline.js'), /denyButtonText: 'Hapus yang Gagal'/);
  assert.match(read('web/ui-pro-hooks.js'), /Hapus yang Gagal/);
  assert.match(read('web/ui-feat-account.js'), /Gaji atau pemasukan lain/);
  // 'Buang Gagal' di src/updates.html adalah prosa catatan rilis lama
  // (riwayat), bukan label UI aktif — sengaja tidak diubah.
  assert.match(read('src/updates.html'), /Buang Gagal/);
});

test('6C/U40 panel dompet punya cabang kosong dengan tombol tambah', () => {
  const wallets = read('web/ui-wallets.js');
  assert.match(wallets, /if \(wallets\.length === 0\)/);
  assert.match(wallets, /t\('wallet\.empty'\)/);
  assert.match(wallets, /data-action="addWallet"[^>]*>/);
  assert.match(wallets, /t\('dash\.add_wallet'\)/);
  // Ikon empty state memakai ikon dompet yang sudah diseragamkan.
  assert.match(wallets, /ph ph-wallet text-3xl/);
});

test('6C/U41 empty state utang berikon + teks kamus + tombol tambah', () => {
  const debts = read('web/ui-debts.js');
  assert.doesNotMatch(debts, /Klik \+ untuk menambah<\/p>/);
  assert.match(debts, /ph ph-hand-coins text-3xl/);
  assert.match(debts, /t\('utang\.kosong'\)/);
  assert.match(debts, /data-action="manageDebtEntity" data-args='\["add", "\$\{g\.group\}"\]'/);
  assert.match(debts, /t\('utang\.add'\)/);
});
