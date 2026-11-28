/* tests/wave6a-contrast-a11y.test.js — Gelombang 6A (U2–U6, U16–U20, U33–U35)
   Kontras & aksesibilitas: tema Emerald, teks slate-400, status budget,
   cincin fokus tombol tema, target sentuh, label screen reader, anti-zoom
   iOS, alternatif teks canvas, aria-label sel kalender, teks kecil.
   Semua fixture ada di dalam repo (baca source); tidak ada file di luar repo.
   Tes lolos di TZ=Asia/Jakarta dan TZ=UTC (tidak ada logika tanggal host). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const stylesHtml = fs.readFileSync('src/styles.html', 'utf8');
const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
const dashboardHtml = fs.readFileSync('src/dashboard.html', 'utf8');
const historiHtml = fs.readFileSync('src/histori.html', 'utf8');
const laporanHtml = fs.readFileSync('src/laporan.html', 'utf8');
const formHtml = fs.readFileSync('src/form.html', 'utf8');
const asetHtml = fs.readFileSync('src/aset.html', 'utf8');
const budgetingHtml = fs.readFileSync('src/budgeting.html', 'utf8');
const uiBudgetJs = fs.readFileSync('web/ui-budget.js', 'utf8');
const uiCalendarJs = fs.readFileSync('web/ui-calendar.js', 'utf8');
const uiPaletteJs = fs.readFileSync('web/ui-pro-palette.js', 'utf8');
const uiAssetsJs = fs.readFileSync('web/ui-assets.js', 'utf8');
const uiChartsJs = fs.readFileSync('web/ui-feat-charts.js', 'utf8');

/* WCAG: luminans relatif + rasio kontras (sama rumusnya dengan audit). */
function luminance(hex) {
  const c = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => {
    const v = parseInt(c.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(fg, bg) {
  const [hi, lo] = luminance(fg) > luminance(bg)
    ? [luminance(fg), luminance(bg)] : [luminance(bg), luminance(fg)];
  return (hi + 0.05) / (lo + 0.05);
}
function themeBlock(styles, name) {
  const m = styles.match(new RegExp(`\\.${name} \\{([\\s\\S]*?)\\}`));
  assert.ok(m, `blok .${name} tidak ditemukan di styles.html`);
  return m[1];
}
function themeInk(block) {
  const m = block.match(/--color-brand-ink:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(m, 'tidak ada --color-brand-ink di blok tema');
  return m[1].toLowerCase();
}

test('U2: semua tema lolos kontras AA 4,5:1 untuk teks brand di atas putih', () => {
  // Sanity: rumus yang sama dengan audit — nilai lama Emerald memang gagal.
  assert.ok(contrast('#059669', '#ffffff') < 4.5, 'sanity: #059669 harus < 4,5:1');
  assert.ok(contrast('#047857', '#ffffff') >= 4.5, 'sanity: #047857 harus >= 4,5:1');
  const root = stylesHtml.match(/:root \{([\s\S]*?)\}/);
  assert.ok(root, 'blok :root tidak ditemukan');
  assert.ok(contrast(themeInk(root[1]), '#ffffff') >= 4.5, 'tema default (Indigo) gagal AA');
  for (const name of ['theme-pink', 'theme-violet', 'theme-blue', 'theme-emerald']) {
    const ink = themeInk(themeBlock(stylesHtml, name));
    assert.ok(contrast(ink, '#ffffff') >= 4.5, `${name} ink ${ink} gagal AA di atas putih`);
    assert.ok(contrast('#ffffff', ink) >= 4.5, `${name} teks putih di atas ${ink} gagal AA`);
  }
  // Ink Emerald harus nilai baru, bukan #059669 lagi.
  assert.equal(themeInk(themeBlock(stylesHtml, 'theme-emerald')), '#047857');
  // Tombol Deny kalender memakai warna yang sama.
  assert.match(uiCalendarJs, /denyButtonColor: '#047857'/);
  assert.doesNotMatch(uiCalendarJs, /denyButtonColor: '#059669'/);
});

test('U3: tidak ada lagi teks mode-terang text-slate-400 (kecuali ikon dekoratif)', () => {
  // Semua teks slate-400 yang tersisa harus berupa <i> ikon aria-hidden,
  // atau varian dark: — bukan teks yang dibaca pengguna mode terang.
  const files = {};
  for (const name of fs.readdirSync('src').filter((n) => n.endsWith('.html'))) {
    files[`src/${name}`] = fs.readFileSync(`src/${name}`, 'utf8');
  }
  for (const name of fs.readdirSync('web').filter((n) => n.endsWith('.js'))) {
    files[`web/${name}`] = fs.readFileSync(`web/${name}`, 'utf8');
  }
  for (const [path, text] of Object.entries(files)) {
    text.split('\n').forEach((line, idx) => {
      const light = line.replace(/dark:text-slate-400/g, '');
      if (!light.includes('text-slate-400')) return;
      assert.match(line, /<i\s/, `${path}:${idx + 1} masih memakai text-slate-400 untuk teks: ${line.trim().slice(0, 100)}`);
    });
  }
  // Instans yang dikutip audit sudah berganti ke slate-500 (4,76:1).
  assert.match(budgetingHtml, /id="budgetCategoryChartEmpty"[^>]*text-slate-500/);
  assert.match(budgetingHtml, /id="budgetCashflowChartEmpty"[^>]*text-slate-500/);
  assert.match(uiPaletteJs, /Tidak ditemukan perintah yang cocok\.<\/p>'\)/);
  assert.match(uiPaletteJs, /text-slate-500">\$\{escapeHtmlJS\(it\.hint\)\}/);
  assert.ok(contrast('#64748b', '#ffffff') >= 4.5, 'sanity: slate-500 harus >= 4,5:1');
});

test('U4: status budget + total Net kalender memakai warna teks yang lolos AA', () => {
  const fn = uiBudgetJs.match(/function getBudgetStatusInfo[\s\S]*?\n  \}/);
  assert.ok(fn, 'getBudgetStatusInfo tidak ditemukan');
  assert.match(fn[0], /text-amber-700/);
  assert.match(fn[0], /text-emerald-700/);
  assert.doesNotMatch(fn[0], /text-amber-600/);
  assert.doesNotMatch(fn[0], /text-emerald-600/);
  assert.ok(contrast('#b45309', '#ffffff') >= 4.5, 'sanity: amber-700 harus >= 4,5:1');
  assert.ok(contrast('#047857', '#ffffff') >= 4.5, 'sanity: emerald-700 harus >= 4,5:1');
  assert.match(uiCalendarJs, /text-emerald-700 dark:text-emerald-500/);
  assert.doesNotMatch(uiCalendarJs, /text-emerald-600 dark:text-emerald-500/);
});

test('U5: kelima tombol tema tidak lagi memakai focus:outline-none', () => {
  const themeBtns = indexHtml.match(/<button[^>]*data-theme-btn[^>]*>/g);
  assert.ok(themeBtns, 'tombol tema tidak ditemukan');
  assert.equal(themeBtns.length, 5, `harus ada 5 tombol tema, ketemu ${themeBtns.length}`);
  themeBtns.forEach((btn) => assert.doesNotMatch(btn, /focus:outline-none/));
  assert.doesNotMatch(indexHtml, /data-theme-btn[^>]*focus:outline-none/);
});

test('U6: tombol Hapus aturan minimal 36px dan minta konfirmasi dua ketuk', () => {
  assert.match(uiPaletteJs, /data-del-rule[^>]*min-h-9 min-w-11/);
  assert.match(uiPaletteJs, /Yakin\?/);
  assert.match(uiPaletteJs, /dataset\.armed/);
});

test('U16: klaster tombol 36px naik ke 44px', () => {
  assert.doesNotMatch(uiCalendarJs, /aria-label="Edit transaksi" class="w-9 h-9/);
  assert.doesNotMatch(uiCalendarJs, /aria-label="Hapus transaksi" class="w-9 h-9/);
  assert.match(uiCalendarJs, /aria-label="Edit transaksi" class="w-11 h-11/);
  assert.match(uiCalendarJs, /aria-label="Hapus transaksi" class="w-11 h-11/);
  assert.match(uiBudgetJs, /data-budget-transaction[^>]*w-11 h-11/);
  assert.match(uiPaletteJs, /id="mkCmdCloseBtn"[^>]*w-11 h-11/);
  for (const id of ['calFilterAll', 'calFilterOut', 'calFilterIn']) {
    assert.match(dashboardHtml, new RegExp(`id="${id}"[^>]*min-h-11`));
  }
  const langBtns = indexHtml.match(/<button[^>]*data-lang-btn[^>]*>/g);
  assert.ok(langBtns, 'tombol bahasa tidak ditemukan');
  assert.equal(langBtns.length, 2);
  langBtns.forEach((btn) => assert.match(btn, /min-h-11/));
});

test('U17: kolom cari Histori punya aria-label', () => {
  assert.match(historiHtml, /id="historiSearch"[^>]*aria-label="Cari kategori atau catatan di siklus ini"/);
});

test('U18: Command Palette mengumumkan item aktif ke screen reader', () => {
  assert.match(uiPaletteJs, /role="listbox"/);
  assert.match(uiPaletteJs, /role="option"/);
  assert.match(uiPaletteJs, /aria-selected/);
  assert.match(uiPaletteJs, /aria-activedescendant/);
  assert.match(uiPaletteJs, /id="mkCmdOpt-\$\{idx\}"/);
  assert.match(uiPaletteJs, /role="combobox"[^>]*aria-controls="mkCmdList"/);
  // Focus trap yang sudah benar tidak rusak: handler Tab + kembalikan fokus.
  assert.match(uiPaletteJs, /e\.key !== 'Tab'/);
  assert.match(uiPaletteJs, /previousFocusEl\.focus\(\)/);
});

test('U19: input kunci 16px di HP (cegah auto-zoom iOS)', () => {
  const media = stylesHtml.match(/@media \(pointer: coarse\),\s*\(max-width: 639px\) \{([\s\S]*?)\n  \}/);
  assert.ok(media, 'blok media pointer kasar / <=639px tidak ditemukan');
  for (const id of ['#mkCmdInput', '#historiSearch', '#quickAddInput', '#lapSearch']) {
    assert.ok(media[1].includes(id), `${id} tidak ada di aturan 16px mobile`);
  }
  assert.match(media[1], /font-size: 16px !important/);
});

test('U20: keempat canvas punya role img + aria-label, diperbarui tiap render', () => {
  for (const [html, id] of [[asetHtml, 'portfolioChart'], [asetHtml, 'netWorthChart'],
    [budgetingHtml, 'budgetCategoryChart'], [budgetingHtml, 'budgetCashflowChart']]) {
    assert.match(html, new RegExp(`<canvas id="${id}" role="img" aria-label="[^"]+">`));
  }
  assert.match(uiAssetsJs, /portfolioChart[\s\S]*?setAttribute\('aria-label'/);
  assert.match(uiChartsJs, /budgetCategoryChart[\s\S]*?setAttribute\('aria-label'/);
  assert.match(uiChartsJs, /budgetCashflowChart[\s\S]*?setAttribute\('aria-label'/);
  assert.match(uiChartsJs, /netWorthChart[\s\S]*?setAttribute\('aria-label'/);
  // Label memuat tren naik/turun, bukan teks statis saja.
  assert.match(uiAssetsJs, /naik' : \(lastTotal < firstTotal \? 'turun'/);
  assert.match(uiChartsJs, /dirNW/);
});

test('U33: sel kalender ber-aria-label tanggal lokal + grid ber-role grid', () => {
  assert.match(uiCalendarJs, /Intl\.DateTimeFormat\(dayLocale, \{ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' \}\)/);
  assert.match(uiCalendarJs, /setAttribute\('aria-label', dayLabel \+/);
  assert.doesNotMatch(uiCalendarJs, /setAttribute\('aria-label', dateStr \+/);
  assert.match(dashboardHtml, /id="kalenderGrid"[^>]*role="grid"[^>]*aria-label="Kalender transaksi bulanan"/);
});

test('U34: label nav bawah + angka sel kalender minimal 12px', () => {
  const nav = indexHtml.match(/<nav id="mobileBottomNav"[\s\S]*?<\/nav>/);
  assert.ok(nav, '#mobileBottomNav tidak ditemukan');
  assert.doesNotMatch(nav[0], /text-\[11px\]/);
  assert.doesNotMatch(nav[0], /text-\[10px\]/);
  assert.match(uiCalendarJs, /<span class="text-xs font-bold '/);
  assert.doesNotMatch(uiCalendarJs, /text-\[11px\] sm:text-xs font-bold/);
  assert.doesNotMatch(uiCalendarJs, /text-\[10px\] sm:text-\[11px\] font-bold/);
  // Header tabel Laporan naik dari 10px ke 12px.
  assert.match(laporanHtml, /text-xs uppercase font-bold tracking-widest/);
  // Badge notifikasi naik dari 10px (12px tak muat di badge 16px — lihat laporan).
  assert.match(indexHtml, /id="notifBadge"[^>]*text-\[11px\]/);
});

test('U35: label kecil yang paling sering dibaca memakai slate-600 (7,58:1)', () => {
  assert.ok(contrast('#475569', '#ffffff') >= 7, 'sanity: slate-600 harus >= 7:1');
  const formLabels = formHtml.match(/<label[^>]*text-slate-600 dark:text-slate-400[^>]*>/g);
  assert.ok(formLabels, 'label form slate-600 tidak ditemukan');
  assert.ok(formLabels.length >= 5, `label form slate-600 harus >= 5, ketemu ${formLabels.length}`);
  // Gelombang 7a (U34): label statistik naik dari 11px ke 12px (text-xs) —
  // warna slate-600 tetap, dan ukuran 12px sekaligus menutup celah U35 di sini.
  assert.match(dashboardHtml, /text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider/);
  const nav = indexHtml.match(/<nav id="mobileBottomNav"[\s\S]*?<\/nav>/);
  assert.match(nav[0], /text-slate-600 dark:text-slate-400/);
});
