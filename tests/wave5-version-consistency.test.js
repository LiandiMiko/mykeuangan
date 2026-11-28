// Gelombang 5.3 (Q9): konsistensi versi, satu sumber.
//
// package.json adalah SATU-SATUNYA sumber versi. Tes ini membaca versi
// dari sana (bukan hardcode) lalu mengassert semua tempat lain cocok:
//   - <meta name="app-version"> di src/Index.html
//   - span #navUpdatesVersion di src/Index.html
//   - data-latest-release + data-latest-version di src/updates.html
//   - baris "Versi saat ini" di src/updates.html
//   - kartu rilis pertama (article[data-release-card]) di src/updates.html
//     — id-nya harus sama dengan data-latest-release
//   - header + badge versi di README.md
// Karena membandingkan ke package.json, tes ini lolos pada v3.20.8
// sekarang DAN setelah versi dinaikkan (mis. ke 3.20.9) — selama
// penanda-penanda di atas ikut diperbarui, seperti yang harus
// dilakukan setiap rilis. Tes kedua membuktikannya dengan simulasi:
// semua kemunculan versi lama diganti 3.20.9 di salinan memori, lalu
// assertion yang sama dijalankan terhadap versi baru itu.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
const updatesHtml = fs.readFileSync('src/updates.html', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertVersionConsistency({ version, indexHtml, updatesHtml, readme }) {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'versi package.json harus semver X.Y.Z');
  const v = `v${version}`;

  // 1. <meta name="app-version"> — dipakai build.mjs + update checker.
  const meta = /<meta\s+name="app-version"\s+content="([^"]+)"/i.exec(indexHtml);
  assert.ok(meta, 'src/Index.html harus punya <meta name="app-version">');
  assert.equal(meta[1], version, 'meta app-version harus sama dengan package.json');

  // 2. Badge versi di navigasi.
  const nav = /id="navUpdatesVersion"[^>]*>([^<]+)</.exec(indexHtml);
  assert.ok(nav, 'src/Index.html harus punya span #navUpdatesVersion');
  assert.equal(nav[1].trim(), v, 'navUpdatesVersion harus sama dengan package.json');

  // 3. Metadata rilis terbaru di halaman updates.
  const latestRelease = /data-latest-release="([^"]+)"/.exec(updatesHtml);
  const latestVersion = /data-latest-version="([^"]+)"/.exec(updatesHtml);
  assert.ok(latestRelease && latestVersion, 'src/updates.html harus punya data-latest-release/version');
  assert.equal(latestVersion[1], v, 'data-latest-version harus sama dengan package.json');
  assert.ok(latestRelease[1].endsWith(`-${v}`),
    `data-latest-release harus berakhiran -${v}, dapat ${latestRelease[1]}`);

  // 4. Baris "Versi saat ini" di halaman updates.
  assert.match(updatesHtml,
    new RegExp(`Versi saat ini</span>: <strong>Update ${escapeRegExp(v)}</strong>`),
    '"Versi saat ini" di updates.html harus sama dengan package.json');

  // 5. Kartu rilis pertama = rilis terbaru.
  const firstCard = /<article\s+data-release-card\s+data-release-id="([^"]+)"[\s\S]*?<\/article>/
    .exec(updatesHtml);
  assert.ok(firstCard, 'src/updates.html harus punya kartu rilis pertama (article[data-release-card])');
  assert.equal(firstCard[1], latestRelease[1],
    'data-release-id kartu pertama harus sama dengan data-latest-release');
  assert.match(firstCard[0], new RegExp(`>${escapeRegExp(v)}<`),
    'badge di kartu rilis pertama harus sama dengan package.json');
  assert.match(firstCard[0], new RegExp(`<h3[^>]*>Update ${escapeRegExp(v)}:`),
    'judul kartu rilis pertama harus sama dengan package.json');

  // 6. README: header + badge.
  assert.match(readme, new RegExp(`^> \\*\\*${escapeRegExp(v)}\\*\\*`, 'm'),
    'baris judul README harus sama dengan package.json');
  assert.match(readme, new RegExp(`badge/Version-${escapeRegExp(v)}-`),
    'badge Version di README harus sama dengan package.json');
}

test('5.3/Q9 semua penanda versi cocok dengan package.json (satu sumber)', () => {
  assertVersionConsistency({ version: pkg.version, indexHtml, updatesHtml, readme });
});

test('5.3/Q9 tes tidak hardcode versi: lolos juga bila versi naik ke 3.20.9', () => {
  const next = '3.20.9';
  const bump = (s) => s.split(pkg.version).join(next);
  assertVersionConsistency({
    version: next,
    indexHtml: bump(indexHtml),
    updatesHtml: bump(updatesHtml),
    readme: bump(readme)
  });
});
