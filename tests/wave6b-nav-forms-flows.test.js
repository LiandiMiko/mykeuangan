const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Gelombang 6B — navigasi, formulir & alur (temuan U1, U10–U15, U27, U30, U32).
// Sebagian besar tes adalah pola source (gaya tes repo yang sudah ada);
// U11 diuji juga secara perilaku lewat vm (walletOptions + saldo).

const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
const dashboardHtml = fs.readFileSync('src/dashboard.html', 'utf8');
const asetHtml = fs.readFileSync('src/aset.html', 'utf8');
const formHtml = fs.readFileSync('src/form.html', 'utf8');
const laporanHtml = fs.readFileSync('src/laporan.html', 'utf8');
const i18nHtml = fs.readFileSync('src/i18n.html', 'utf8');
const uiShellJs = fs.readFileSync('web/ui-shell.js', 'utf8');
const uiWalletsJs = fs.readFileSync('web/ui-wallets.js', 'utf8');
const uiNativeUxJs = fs.readFileSync('web/ui-feat-native-ux.js', 'utf8');
const uiAccountJs = fs.readFileSync('web/ui-feat-account.js', 'utf8');
const uiOfflineJs = fs.readFileSync('web/ui-feat-offline.js', 'utf8');
const uiHooksJs = fs.readFileSync('web/ui-feat-hooks.js', 'utf8');

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('6B-U1 sidebar dan bottom nav berisi Utang & Piutang; Budgeting tetap di sidebar', () => {
  assert.match(indexHtml, /id="nav-utang"/);
  assert.match(indexHtml, /data-action="switchView" data-args='\["utang"\]' id="nav-utang"/);
  assert.match(indexHtml, /data-i18n="nav\.utang">Utang &amp; Piutang</);
  assert.match(indexHtml, /id="nav-utang"[^>]*nav-btn|nav-btn[^>]*id="nav-utang"/);
  assert.match(indexHtml, /data-mobile-nav="utang"/);
  assert.match(indexHtml, /data-action="switchView" data-args='\["utang"\]' data-mobile-nav="utang"/);
  assert.match(indexHtml, /data-i18n="nav\.utang_short">Utang</);
  // Bottom nav tetap 5 kolom (FAB tetap di tengah); Budget diganti Utang
  // karena Budgeting adalah layar bulanan yang tetap terjangkau dari
  // sidebar + Command Palette, sementara Utang sebelumnya tanpa nav.
  assert.match(indexHtml, /id="mobileBottomNav"[^>]*grid-cols-5/);
  assert.doesNotMatch(indexHtml, /data-mobile-nav="budgeting"/);
  assert.match(indexHtml, /id="nav-budgeting"/);
  // Jalan masuk lama dari kartu dashboard tidak rusak.
  assert.match(dashboardHtml, /data-action="switchView" data-args='\["utang"\]'/);
});

test('6B-U1 active-state utang menandai nav Utang, bukan Dashboard', () => {
  assert.doesNotMatch(uiShellJs, /id\.includes\('utang'\)/);
  assert.match(uiShellJs, /getElementById\('nav-' \+ id\)/);
});

test('6B-U10 tombol Command Palette tampil di mobile (header) dan tetap ada di desktop', () => {
  const paletteButtons = [...indexHtml.matchAll(/<button[^>]*data-action="openCommandPalette"[^>]*>/g)];
  assert.equal(paletteButtons.length, 2, 'harus ada 2 tombol palette: mobile + desktop');
  assert.match(paletteButtons.map((m) => m[0]).join('\n'), /inline-flex lg:hidden/);
  assert.match(paletteButtons.map((m) => m[0]).join('\n'), /hidden lg:inline-flex/);
  // Tombol mobile: ikon kaca pembesar, target sentuh 40px.
  assert.match(indexHtml, /inline-flex lg:hidden w-10 h-10[^>]*>\s*<i class="ph ph-magnifying-glass"/);
  // Ruang header di 360px: padding dipersempit di bawah 400px dan
  // pemilih bulan menyusut (120px; "Nov 2026" muat) agar tombol baru
  // tidak menutupi elemen lain.
  assert.match(indexHtml, /px-2 min-\[400px\]:px-3 py-2 sm:px-6/);
  assert.match(indexHtml, /w-\[120px\] min-\[400px\]:w-\[148px\] sm:w-44/);
});

test('6B-U11 walletOptions menampilkan saldo bila diminta; tanpa saldo bila tidak', () => {
  const sandbox = {
    DB: {
      wallets: [
        { id: 'w1', name: 'BCA', kind: 'bank', openingBalance: 1000000 },
        { id: 'w2', name: 'Tunai', kind: 'cash', openingBalance: 50000 }
      ],
      transactions: [],
      transfers: [],
      payrollDay: 1
    },
    localToday: () => '2026-11-28',
    formatRupiah: (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID'),
    escapeHtmlJS: (s) => String(s),
    escapeAttrJS: (s) => String(s),
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('web/ui-wallets.js', 'utf8'), sandbox);
  const withBalance = sandbox.walletOptions('w1', true);
  assert.match(withBalance, /BCA \(Bank\) — Rp 1\.000\.000/);
  assert.match(withBalance, /Tunai \(Tunai\) — Rp 50\.000/);
  const plain = sandbox.walletOptions('w1');
  assert.match(plain, /BCA \(Bank\)</);
  assert.doesNotMatch(plain, /Rp/);
  // Modal transfer memakai opsi bersaldo + peringatan inline + validasi
  // pre-submit (nominal + biaya vs saldo dompet asal).
  assert.match(uiWalletsJs, /walletOptions\(fromWallet\.id, true\)/);
  assert.match(uiWalletsJs, /walletOptions\(toWallet\.id, true\)/);
  assert.match(uiWalletsJs, /id="tf-bal-warn"/);
  assert.match(uiWalletsJs, /Melebihi saldo/);
  assert.match(uiWalletsJs, /nominal \+ feeAmt > fromBal/);
  assert.match(uiWalletsJs, /Nominal melebihi saldo/);
});

test('6B-U12 nominal utama memakai inputmode decimal; tombol operator kalkulator tetap ada', () => {
  assert.match(formHtml, /<input type="text" id="tr_nominal" inputmode="decimal"/);
  assert.doesNotMatch(formHtml, /id="tr_nominal" inputmode="text"/);
  ['+', '-', '*', '/'].forEach((op) => {
    assert.ok(formHtml.includes(`data-action="insertNominalCalcOp" data-args='["${op}"]'`), `tombol operator ${op} harus tetap ada`);
  });
  assert.match(formHtml, /data-action="applyNominalCalc"/);
});

test('6B-U13 label biometrik jujur soal PIN sekali; alur enkripsi/PIN tidak berubah', () => {
  assert.match(uiNativeUxJs, /Buka dengan Sidik Jari \+ PIN sekali/);
  assert.match(uiNativeUxJs, /Unlock with Biometrics \+ PIN once/);
  assert.match(uiNativeUxJs, /hasPinDataKey\(\)/);
  // Penjelasan di layar pengaturan biometrik.
  assert.match(uiNativeUxJs, /id = 'acc-bio-note'/);
  assert.match(uiNativeUxJs, /PIN tetap diminta sekali setiap kali aplikasi dibuka dari nol/);
  // Alur enkripsi/PIN tidak disentuh: sidik jari sukses + DEK ada tetap
  // membuka kunci; tanpa DEK tetap jatuh ke prompt PIN.
  assert.match(uiAccountJs, /if \(bioOk && hasPinDataKey\(\)\)/);
});

test('6B-U14 toast offline sekali per sesi offline, direset saat online', () => {
  assert.match(uiOfflineJs, /Anda offline/);
  assert.match(uiOfflineJs, /Transaksi tersimpan di perangkat dan akan terkirim otomatis saat online\./);
  assert.match(uiOfflineJs, /id = 'mkOfflineToast'/);
  assert.match(uiOfflineJs, /let offlineToastShown = false/);
  assert.match(uiOfflineJs, /function showOfflineToastOnce\(\)/);
  assert.match(uiOfflineJs, /if \(offlineToastShown/);
  assert.match(uiOfflineJs, /root\.addEventListener\('offline', handleOfflineEvent\)/);
  assert.match(uiOfflineJs, /root\.addEventListener\('online', handleOnlineEvent\)/);
  // Reset flag saat kembali online supaya sesi offline berikutnya
  // memberitahu lagi — bukan spam tiap perubahan status.
  assert.match(uiOfflineJs, /function handleOnlineEvent\(\) \{\s*offlineToastShown = false;/);
  // Toast memakai pola .mk-toast yang sama seperti toast PWA.
  assert.match(uiOfflineJs, /mk-toast fixed left-4 right-4/);
});

test('6B-U15 Restore Backup JSON ada di kedua menu (duplikasi, handler sama)', () => {
  assert.equal(countOccurrences(laporanHtml, 'data-action="triggerRestoreJson"'), 2);
  const importMenu = laporanHtml.slice(laporanHtml.indexOf('id="lapImportMenu"'), laporanHtml.indexOf('id="lapExportMenu"'));
  const exportMenu = laporanHtml.slice(laporanHtml.indexOf('id="lapExportMenu"'));
  assert.match(importMenu, /data-action="triggerRestoreJson"/);
  assert.match(exportMenu, /data-action="triggerRestoreJson"/);
  assert.match(exportMenu, /data-action="exportBackupJson"/);
  assert.match(laporanHtml, /data-i18n="lap\.restore_json">Restore Backup JSON</);
});

test('6B-U27 re-lock menutupi konten dengan layar kunci penuh (overlay opaque)', () => {
  assert.match(uiAccountJs, /id = 'mkPinLockOverlay'/);
  assert.match(uiAccountJs, /fixed inset-0 z-\[90\] bg-slate-50 dark:bg-slate-950/);
  assert.match(uiAccountJs, /showPinLockOverlay\(\);/);
  assert.match(uiAccountJs, /hidePinLockOverlay\(\);/);
  // Overlay ditampilkan saat prompt PIN dimulai dan disembunyikan di
  // finally — DOM konten tidak dihapus, data kembali setelah PIN benar.
  const verifyFn = uiAccountJs.slice(uiAccountJs.indexOf('async function verifyAppPinIfEnabled'));
  assert.match(verifyFn, /showPinLockOverlay\(\);/);
  assert.match(verifyFn, /finally \{[\s\S]*?hidePinLockOverlay\(\);/);
  // Blur dipertahankan sebagai lapisan kedua, bukan satu-satunya.
  assert.match(verifyFn, /blur-md/);
  assert.doesNotMatch(uiAccountJs, /only blurs it as a mitigation/);
});

test('6B-U30 Firefox Android mendapat tombol install + petunjuk manual', () => {
  assert.match(uiHooksJs, /const isFirefoxAndroid = \(\) => \/android\/i\.test\(navigator\.userAgent/);
  assert.match(uiHooksJs, /firefox\/i\.test\(navigator\.userAgent/);
  assert.match(uiHooksJs, /isFirefoxAndroid\(\)\)\)/);
  assert.match(uiHooksJs, /root\.addEventListener\('beforeinstallprompt'/);
  assert.match(uiAccountJs, /Firefox Android/);
  assert.match(uiAccountJs, /Tambahkan ke Layar Utama/);
  // Petunjuk manual hanya untuk yang tanpa beforeinstallprompt: cabang
  // promptEvt tetap didahulukan di installPwaApp.
  const installFn = uiAccountJs.slice(uiAccountJs.indexOf('async function installPwaApp'));
  assert.match(installFn, /if \(promptEvt && typeof promptEvt\.prompt === 'function'\)/);
});

test('6B-U32 tombol Transfer dan Tarik Tunai terpisah dengan jenis yang benar', () => {
  [dashboardHtml, asetHtml].forEach((html) => {
    assert.match(html, /data-action="openTransferModal" data-args='\["transfer"\]'/);
    assert.match(html, /data-action="openTransferModal" data-args='\["tarik_tunai"\]'/);
  });
  // Label singkat di mobile, lengkap di layar ≥sm.
  assert.match(dashboardHtml, /<span class="sm:hidden" data-i18n="dash\.transfer">Transfer<\/span><span class="hidden sm:inline" data-i18n="dash\.transfer_full">Transfer Antar Dompet<\/span>/);
  assert.match(dashboardHtml, /data-i18n="dash\.withdraw">Tarik Tunai<\/span>/);
  // Kunci lama berlabel ganda sudah tidak dipakai di mana pun.
  assert.doesNotMatch(indexHtml + dashboardHtml + asetHtml + formHtml + laporanHtml, /dash\.transfer_wallet/);
  assert.doesNotMatch(i18nHtml, /dash\.transfer_wallet/);
  // Judul modal tarik tunai kini tunggal, bukan ganda.
  assert.match(uiWalletsJs, /kind === 'tarik_tunai' \? 'Tarik Tunai' : 'Transfer Antar Dompet'/);
  assert.doesNotMatch(uiWalletsJs, /'Tarik Tunai \/ Transfer Antar Dompet'/);
});

test('6B-i18n kunci baru nav utang + tombol transfer ada di ID dan EN', () => {
  ['nav.utang', 'nav.utang_short', 'dash.transfer', 'dash.transfer_full', 'dash.withdraw'].forEach((key) => {
    assert.equal(countOccurrences(i18nHtml, `'${key}':`), 2, `kunci ${key} harus ada di ID dan EN`);
  });
});
