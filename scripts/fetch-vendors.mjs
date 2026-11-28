import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR_DIR = path.join('web', 'vendor');
// Jaringan lewat egress proxy lambat (unduhan vendor nyata memakan waktu
// sampai ~7 menit untuk 17 file); timeout 30 dtk terbukti menggagalkan
// unduhan yang sebenarnya valid. 120 dtk x 3 percobaan.
const FETCH_TIMEOUT_MS = 120000;
const FETCH_ATTEMPTS = 3;

// Wave 3.4 / S24–S25 — SATU-SATUNYA sumber kebenaran vendor:
// setiap entri membawa hash dari BYTES AKHIR yang tersimpan di
// web/vendor/ (setelah rewrite CSS Phosphor, bila ada).
// - sha256 (hex): verifikasi integritas saat fetch & saat build.
// - sha384 (base64): nilai integrity="sha384-…" (SRI) untuk tag <script>/<link>
//   yang masih merujuk CDN di source (src/styles.html); tag-tag itu diganti
//   ke ./vendor/ saat build, dan karena bytes-nya identik, hash SRI-nya
//   tetap valid untuk file lokal tersebut.
// Hash BUKAN rahasia — ini checksum publik dari file publik (sama seperti
// SRI di HTML) dan aman di-commit. File vendor sendiri tetap gitignored
// (web/vendor/ tidak pernah di-commit, hanya hash-nya).
export const VENDOR_MANIFEST = [
  { file: 'supabase.js', url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js', sha256: '8816af04d9915dbba1882d6f84f0b402dc40268063a63d9c66d24f52f371c263', sha384: 'A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ' },
  { file: 'sweetalert2.all.min.js', url: 'https://cdn.jsdelivr.net/npm/sweetalert2@11.14.5/dist/sweetalert2.all.min.js', sha256: 'd66e2a55bb1d712535f6dba55536de4117a0d018d9896eb219f7e796bfcd26ee', sha384: 'YB/DdIkloKoRpclWB8bNcYXWakt57USgtQPDzvnIDHYU0lasD5eWlXVo1S4ODukY' },
  { file: 'flatpickr.min.css', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css', sha256: '1b34a42552c96f10e4dfaaa4a367276b03868aacff63c1ac42ffe331352bc754', sha384: 'RkASv+6KfBMW9eknReJIJ6b3UnjKOKC5bOUaNgIY778NFbQ8MtWq9Lr/khUgqtTt' },
  { file: 'monthSelect-style.css', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/plugins/monthSelect/style.css', sha256: 'd6b99c057e2222a7c279c81caced0fcf6bdf2fd44aa402b81ade6c1d2a19a10a', sha384: 'iENKmnGeeAGTWfH/ajxq1dMSwLjASdk1v+taA112fikKow0tdV9cbUJcAiBEfHhG' },
  { file: 'flatpickr.min.js', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js', sha256: '1eeab1cb779471a0b0aaa93dd91c2eb1aa537d696f01ab05ea9dabc55e8525a1', sha384: '5JqMv4L/Xa0hfvtF06qboNdhvuYXUku9ZrhZh3bSk8VXF0A/RuSLHpLsSV9Zqhl6' },
  { file: 'monthSelect-index.js', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/plugins/monthSelect/index.js', sha256: '07782c68d4ee9a21c122227cc5228bbee134517ea0c99f1577af3f014746633e', sha384: '6p33UqcS/7ZxiJzlAi3gfOsrVSlBlFNr/6gfN12AC0ETbTmPgMGSfHuN+H0QcWoO' },
  { file: 'flatpickr-id.js', url: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/id.js', sha256: '72f1c2a479adf44a8a7ec05e0c73ae8c8951e7067c5b2decf7475ad4bdec1a47', sha384: 'KMhDAY3QD073iimt/X068iLaMgNPBD+J57j7adrjgvlWbfAv2ONSvLFyOtU9TzDN' },
  { file: 'jspdf.umd.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js', sha256: 'e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54', sha384: 'qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3' },
  { file: 'jspdf.plugin.autotable.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/5.0.9/jspdf.plugin.autotable.min.js', sha256: '83dd8e5ae29436bd3d3ef4f4a915125b3951264994c25de0359d3fbd105abe15', sha384: 'A77YsHWitrPuAj8E0AuB033EXzymUxIajnWKPzrrzqFoYYSCEpFennDUjMG2R1L3' },
  { file: 'chart.umd.min.js', url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', sha256: 'b38076762f7363bc9e912b68b8e034826798db5df26bb61f000ec2e7a3137bc7', sha384: 'NrKB+u6Ts6AtkIhwPixiKTzgSKNblyhlk0Sohlgar9UHUBzai/sgnNNWWd291xqt' },
  { file: 'inter/inter-latin-wght-normal.woff2', url: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.1.0/files/inter-latin-wght-normal.woff2', sha256: 'f052ee44c3728dfd23aba8a4567150bc314d23903026fbb6ad089422c2df56af', sha384: 'pCtvkC4NA9hNQJNEL7G47sNECZ22hJYRcHfL7RucH6R8r4lAclMC5zglhonFQka5' },
  { file: 'phosphor/regular/Phosphor.woff2', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/Phosphor.woff2', sha256: 'c2ea45ea05ff5c7df1936770c104725f2a68f43fd343f35f3da23a30b27de32a', sha384: 'm+KpvLpX1Z9u15CUi7ufA3tQoODb7pNrYUWh5CDi1bej2N/yEq9p/GApOosSDfPQ' },
  { file: 'phosphor/regular/style.css', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css', sha256: 'acbedb1be548a784846863272db5a69a13181235b81a4dab387e9bcdf42eaf01', sha384: '9NSy/mKAQLUayFiRP6f70pZV/g40YyUEed3qwv3WvaDkbnt4ZdU8Mx/cV+21KaXi', fontFile: 'Phosphor.woff2' },
  { file: 'phosphor/bold/Phosphor-Bold.woff2', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/bold/Phosphor-Bold.woff2', sha256: '2153b52cea9e06fc0cc8496048be485b381a0f8bf130adea5a9756fc8f100b87', sha384: 'Yeq9eMW9pGRyFK5elPf7yblEVzyHojK8erfdgSJ6+qlvVvLZthA90x0eZwqEY4MY' },
  { file: 'phosphor/bold/style.css', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/bold/style.css', sha256: '5ad3432f7f077f788e32e5b9e5252779ba1b5e192d11c549ca7c0284de0766cb', sha384: '7a5koj8WumsBFB5koPHlCyQe+Tw7CAVLXLqtpQA9uA2wFyRiwhySspn6/2MZYLHM', fontFile: 'Phosphor-Bold.woff2' },
  { file: 'phosphor/fill/Phosphor-Fill.woff2', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/fill/Phosphor-Fill.woff2', sha256: '660bd6045c0e0d9756cddb8ba2ece3aad855df7d4a170ef23f7b1c0bf511c430', sha384: '2OXNCWFbm32rM41wUHyURyGC/RgegH0wT0OvZNqWWDxiKhwkm+PiUkn8ejkf2nCJ' },
  { file: 'phosphor/fill/style.css', url: 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/fill/style.css', sha256: 'cd04db5e373d7531fcb3b0c658d06bd66b5499a45e98722592337dc6b63c6530', sha384: 'nZB6gIbRoLV1ZVqiI73eVfsea4TI7VMfTyyfLRvYN9DrehNyfAB14o9pCd7inSyS', fontFile: 'Phosphor-Fill.woff2' }
];

// File vendor turunan (bukan unduhan langsung): dibuat script ini dari
// entri manifest. Build memeriksa keberadaan + tidak kosong (tanpa hash,
// karena isinya turunan lokal). tailwind.min.css TIDAK di sini — ia
// dibuat oleh `npm run build:css` dan diperiksa terpisah oleh build.mjs.
export const DERIVED_VENDOR_FILES = [
  { file: 'inter/inter.css', note: 'dibuat oleh node scripts/fetch-vendors.mjs dari inter-latin-wght-normal.woff2' }
];

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha384Base64(buf) {
  return crypto.createHash('sha384').update(buf).digest('base64');
}

function rewritePhosphorCss(cssText, woff2File) {
  return cssText.replace(/@font-face\s*\{[\s\S]*?\}/g, (block) => {
    let replaced = false;
    return block.replace(/^\s*src\s*:[^;]*;\s*\r?\n?/gm, () => {
      if (replaced) return '';
      replaced = true;
      return `  src: url("./${woff2File}") format("woff2");\n`;
    });
  });
}

// Bytes yang HARUS tersimpan di disk untuk satu entri: bytes unduhan
// mentah, kecuali CSS Phosphor yang URL font-nya ditulis ulang ke lokal.
export function storedBytesFor(entry, raw) {
  if (entry.fontFile) return Buffer.from(rewritePhosphorCss(raw.toString('utf8'), entry.fontFile), 'utf8');
  return raw;
}

// Throw bila bytes tidak cocok dengan hash manifest. Entri tanpa hash
// dilewati (tidak ada di manifest saat ini — semua entri wajib ber-hash).
export function verifyVendorBytes(entry, buf) {
  if (entry.sha256 && sha256Hex(buf) !== entry.sha256) {
    throw new Error(`hash sha256 tidak cocok untuk ${entry.file} (bytes bukan dari ${entry.url} yang dipin)`);
  }
  if (entry.sha384 && sha384Base64(buf) !== entry.sha384) {
    throw new Error(`hash sha384 tidak cocok untuk ${entry.file} (bytes bukan dari ${entry.url} yang dipin)`);
  }
}

// Throw bila file vendor hilang, kosong, atau hash-nya tidak cocok.
// Dipakai build.mjs (gerbang build) dan test Wave 3.4.
export function verifyVendorFile(entry) {
  const dest = path.join(VENDOR_DIR, entry.file);
  if (!fs.existsSync(dest)) {
    throw new Error(`Vendor tidak ada: ${dest} — jalankan node scripts/fetch-vendors.mjs.`);
  }
  const buf = fs.readFileSync(dest);
  if (buf.length === 0) {
    throw new Error(`Vendor kosong: ${dest} — jalankan node scripts/fetch-vendors.mjs --force.`);
  }
  verifyVendorBytes(entry, buf);
  return true;
}

// Verifikasi SEMUA entri manifest; throw berisi daftar lengkap masalah
// (bukan hanya yang pertama) supaya satu jalan build memberi tahu semua
// file yang harus diperbaiki.
export function verifyAllVendors() {
  const problems = [];
  for (const entry of VENDOR_MANIFEST) {
    try {
      verifyVendorFile(entry);
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (problems.length) {
    throw new Error(`Vendor tidak terverifikasi:\n- ${problems.join('\n- ')}`);
  }
  return VENDOR_MANIFEST.length;
}

async function fetchBufferWithRetry(url) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function writeInterStylesheet() {
  const interDir = path.join(VENDOR_DIR, 'inter');
  if (!fs.existsSync(path.join(interDir, 'inter-latin-wght-normal.woff2'))) return;
  const css = [
    '@font-face {',
    "  font-family: 'Inter';",
    '  font-style: normal;',
    '  font-display: swap;',
    '  font-weight: 300 900;',
    "  src: url('./inter-latin-wght-normal.woff2') format('woff2');",
    '}',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(interDir, 'inter.css'), css);
}

async function downloadVendorEntry(entry, force) {
  const dest = path.join(VENDOR_DIR, entry.file);
  const existsNonEmpty = fs.existsSync(dest) && fs.statSync(dest).size > 0;
  if (existsNonEmpty && !force) {
    // Wave 3.4: JANGAN percaya cache tanpa verifikasi. File cache yang
    // diracuni dulu lolos selamanya; sekarang hash-nya dicek dulu
    // (setelah normalisasi CSS Phosphor) dan file yang tidak cocok
    // DIHAPUS lalu proses gagal (exit 1) — unduh ulang pakai --force.
    let buf = fs.readFileSync(dest);
    if (entry.fontFile) {
      const normalized = rewritePhosphorCss(buf.toString('utf8'), entry.fontFile);
      if (normalized !== buf.toString('utf8')) {
        fs.writeFileSync(dest, normalized);
        buf = Buffer.from(normalized, 'utf8');
      }
    }
    try {
      verifyVendorBytes(entry, buf);
    } catch (err) {
      fs.rmSync(dest, { force: true });
      throw new Error(`Vendor cache rusak (hash tidak cocok): ${dest} — file dihapus, jalankan ulang dengan --force untuk mengunduh ulang. (${err.message})`);
    }
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = await fetchBufferWithRetry(entry.url);
  const stored = storedBytesFor(entry, raw);
  fs.writeFileSync(dest, stored);
  // Verifikasi hasil unduhan SEBELUM dianggap selesai: kalau CDN
  // menyajikan bytes yang salah, file dihapus dan proses gagal.
  try {
    verifyVendorBytes(entry, stored);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw new Error(`Vendor hasil unduhan gagal verifikasi hash: ${dest} — file dihapus. (${err.message})`);
  }
  return true;
}

async function main() {
  const force = process.argv.includes('--force');
  let downloaded = 0;
  let skipped = 0;
  for (const entry of VENDOR_MANIFEST) {
    const didDownload = await downloadVendorEntry(entry, force);
    if (didDownload) downloaded += 1;
    else skipped += 1;
  }
  writeInterStylesheet();
  process.stdout.write(`✅ Vendor assets ready (${downloaded} downloaded, ${skipped} cached) in ${VENDOR_DIR}/\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`❌ Failed to fetch vendor assets: ${err.message || String(err)}\n`);
    process.exitCode = 1;
  });
}
