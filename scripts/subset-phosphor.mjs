// Gelombang 7d (P5/P6): generator subset font ikon Phosphor.
// File vendor Phosphor lengkap (3 bobot x 1.530 ikon, ~249 KB CSS +
// ~429 KB woff2) sebagian besar tidak pernah dipakai: hanya ~100 nama
// ikon yang dirujuk dari src/*.html + web/*.js. Skrip ini memangkas
// tiap bobot menjadi hanya ikon yang dipakai + font-display: swap,
// lalu menulis hasilnya ke web/phosphor-subset/ (file ter-commit —
// build TIDAK menjalankan skrip ini, supaya CI tidak butuh fontTools).
//
// JALANKAN ULANG skrip ini setiap kali ada ikon baru yang dipakai:
//   node scripts/subset-phosphor.mjs
// Tes tests/wave7d-performa.test.js akan GAGAL bila ada ikon yang
// dirujuk kode tapi tidak ada di subset (penjaga agar ikon baru tidak
// diam-diam hilang di layar).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = path.join(REPO_ROOT, 'web', 'vendor', 'phosphor');
const SUBSET_ROOT = path.join(REPO_ROOT, 'web', 'phosphor-subset');

const WEIGHT_WORDS = new Set(['bold', 'fill', 'light', 'regular', 'duotone', 'thin']);

// Nama ikon yang dipakai secara DINAMIS (dipilih lewat ternary/variabel,
// jadi tidak tertangkap pemindaian `ph-<nama>` statis). Tiap entri
// dicantumkan beserta sumbernya — bila menambah jalur dinamis baru,
// tambahkan namanya di sini (dengan bobot yang benar).
export const DYNAMIC_ICONS = {
  // ui-assets.js resolveAssetPresentation(): jenis aset -> ikon.
  regular: [
    'currency-btc', 'currency-dollar', 'chart-line-up', 'bank', 'coins',
    // ui-debts.js: kelompok utang/piutang.
    'user-circle', 'device-mobile', 'hand-coins',
    // ui-budget.js: status anggaran (warning-circle/warning/check-circle).
    'warning-circle', 'warning', 'check-circle',
    // ui-dashboard.js: placeholder histori kosong.
    'tray-arrow-down', 'tray-arrow-up',
    // ui-recurring.js: tombol jeda/lanjutkan.
    'pause', 'play',
    // ui-wallets.js: jenis dompet (tunai/e-wallet/bank).
    'money',
    // supabase-auth-ui.js: tombol lihat/sembunyikan password.
    'eye', 'eye-slash'
  ],
  // ui-feat-account.js buildQuickMenuCard(): menu cepat akun.
  bold: ['minus-circle', 'plus-circle', 'camera', 'arrows-left-right'],
  fill: []
};

// Pindai src/*.html + web/*.js dan kembalikan { regular, bold, fill }
// berisi nama ikon yang dipakai per bobot. Nama yang bobotnya tidak
// bisa ditentukan dari konteks (mis. di dalam string 'ph-magic-wand')
// dimasukkan ke SEMUA bobot — lebih boros beberapa byte, tapi tidak
// pernah menghilangkan ikon.
export function collectUsedIcons() {
  const used = { regular: new Set(), bold: new Set(), fill: new Set() };
  const assign = (name, weight) => {
    if (!name || WEIGHT_WORDS.has(name)) return;
    if (weight) used[weight].add(name);
    else for (const w of Object.keys(used)) used[w].add(name);
  };
  const files = [
    ...fs.readdirSync(path.join(REPO_ROOT, 'src')).filter((f) => f.endsWith('.html')).map((f) => path.join(REPO_ROOT, 'src', f)),
    ...fs.readdirSync(path.join(REPO_ROOT, 'web')).filter((f) => f.endsWith('.js')).map((f) => path.join(REPO_ROOT, 'web', f))
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // 1. Atribut class="..." / class='...' — bobot dibaca dari kelas
    //    yang sama (ph-bold / ph-fill / ph biasa).
    for (const m of text.matchAll(/class\s*=\s*["']([^"']*)["']/g)) {
      const classes = m[1].split(/\s+/);
      const weight = classes.includes('ph-fill') ? 'fill' : classes.includes('ph-bold') ? 'bold' : 'regular';
      for (const c of classes) {
        const im = c.match(/^ph-([a-z0-9-]+)$/);
        if (im) assign(im[1], weight);
      }
    }
    // 1b. Pola dinamis `ph-<awalan>-${... ? 'a' : 'b'}` — mis.
    //     `ph-caret-${isExpanded ? 'up' : 'down'}` (ui-budget.js) —>
    //     caret-up + caret-down. Bobot dibaca dari teks sebelum
    //     pola (ph-bold/ph-fill di dekatnya, default regular).
    for (const m of text.matchAll(/ph-([a-z0-9-]+)\$\{([^}]*)\}/g)) {
      const prefix = m[1];
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      const weight = before.includes('ph-fill') ? 'fill' : before.includes('ph-bold') ? 'bold' : 'regular';
      for (const lit of m[2].matchAll(/['"]([a-z0-9-]+)['"]/g)) {
        assign(prefix + lit[1], weight);
      }
    }
    // 2. Token ph-<nama> lain di file (string JS, dsb.) — bobot tidak
    //    diketahui -> masukkan ke semua bobot (pengaman). Token yang
    //    langsung diikuti '-' dilewati: itu awalan pola dinamis 1b
    //    (mis. `ph-caret-${...}` — nama lengkapnya sudah ditangani 1b).
    for (const m of text.matchAll(/\bph-([a-z0-9-]+)\b/g)) {
      const name = m[1];
      if (text[m.index + m[0].length] === '-') continue;
      const already = used.regular.has(name) || used.bold.has(name) || used.fill.has(name);
      if (!already) assign(name, null);
    }
  }
  for (const [weight, names] of Object.entries(DYNAMIC_ICONS)) {
    for (const name of names) used[weight].add(name);
  }
  return used;
}

const WEIGHTS = [
  { dir: 'regular', fontFile: 'Phosphor.woff2', baseClass: 'ph', family: 'Phosphor' },
  { dir: 'bold', fontFile: 'Phosphor-Bold.woff2', baseClass: 'ph-bold', family: 'Phosphor-Bold' },
  { dir: 'fill', fontFile: 'Phosphor-Fill.woff2', baseClass: 'ph-fill', family: 'Phosphor-Fill' }
];

function parseFullCss(weight) {
  const css = fs.readFileSync(path.join(VENDOR_ROOT, weight.dir, 'style.css'), 'utf8');
  const fontFace = css.match(/@font-face \{[\s\S]*?\n\}/);
  if (!fontFace) throw new Error(`@font-face tidak ditemukan di phosphor/${weight.dir}/style.css`);
  const base = css.match(new RegExp(`\\.${weight.baseClass} \\{[\\s\\S]*?\\n\\}`));
  if (!base) throw new Error(`kelas dasar .${weight.baseClass} tidak ditemukan di phosphor/${weight.dir}/style.css`);
  const rules = new Map(); // nama ikon -> { rule, codepoint }
  const re = new RegExp(`\\.${weight.baseClass}\\.ph-([a-z0-9-]+):before \\{\\n\\s*content: "\\\\([0-9a-fA-F]+)";\\n\\}`, 'g');
  for (const m of css.matchAll(re)) {
    rules.set(m[1], { rule: m[0], codepoint: m[2] });
  }
  if (rules.size < 1000) throw new Error(`hanya ${rules.size} aturan ikon terbaca dari phosphor/${weight.dir}/style.css (diharapkan ~1530)`);
  return { fontFace: fontFace[0], base: base[0], rules };
}

function main() {
  const used = collectUsedIcons();
  for (const w of Object.keys(used)) {
    console.log(`ikon dipakai (${w}): ${used[w].size} — ${[...used[w]].sort().join(', ')}`);
  }
  for (const weight of WEIGHTS) {
    const { fontFace, base, rules } = parseFullCss(weight);
    const names = [...used[weight.dir]].sort();
    const missing = names.filter((n) => !rules.has(n));
    if (missing.length) {
      throw new Error(`ikon tidak ada di font ${weight.dir}: ${missing.join(', ')} — periksa ejaan atau tambah ke DYNAMIC_ICONS`);
    }
    const unicodes = names.map((n) => `U+${rules.get(n).codepoint.toUpperCase()}`).join(',');
    const outDir = path.join(SUBSET_ROOT, weight.dir);
    fs.mkdirSync(outDir, { recursive: true });
    const subsetCss = [
      `/* Subset Phosphor (${weight.dir}) — dibuat oleh scripts/subset-phosphor.mjs`,
      `   dari @phosphor-icons/web 2.1.1. HANYA ${names.length} ikon yang dipakai`,
      `   aplikasi (lihat DYNAMIC_ICONS + pemindaian src/ + web/ di skrip itu).`,
      `   JANGAN edit manual — jalankan ulang: node scripts/subset-phosphor.mjs.`,
      `   font-display: swap (dulu block — ikon sempat hilang sampai font tiba). */`,
      fontFace.replace('font-display: block', 'font-display: swap'),
      '',
      base,
      '',
      ...names.map((n) => rules.get(n).rule),
      ''
    ].join('\n');
    fs.writeFileSync(path.join(outDir, 'style.css'), subsetCss);
    const srcFont = path.join(VENDOR_ROOT, weight.dir, weight.fontFile);
    const dstFont = path.join(outDir, weight.fontFile);
    execFileSync('python3', [
      '-m', 'fontTools.subset', srcFont,
      `--output-file=${dstFont}`,
      `--unicodes=${unicodes}`,
      '--flavor=woff2',
      '--no-hinting',
      '--desubroutinize'
    ], { stdio: 'inherit' });
    const before = fs.statSync(srcFont).size;
    const after = fs.statSync(dstFont).size;
    console.log(`${weight.dir}: CSS ${names.length} ikon, woff2 ${before} -> ${after} byte (${Math.round((1 - after / before) * 100)}% lebih kecil)`);
  }
  console.log(`Selesai — subset di ${SUBSET_ROOT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
