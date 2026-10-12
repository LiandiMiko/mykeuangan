// Menggabungkan src/*.html (pengganti <?!= include('x') ?> Apps Script)
// + web/config.js + web/supabase-api.js  →  dist/index.html
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src', WEB = 'web', OUT = 'dist';
// Versi di-pin (hindari "latest"); naikkan manual setelah dites.
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const alias = { scripts: 'script' };          // Index.html memanggil 'scripts', filenya script.html

function read(name) {
  const file = path.join(SRC, (alias[name] || name) + '.html');
  if (!fs.existsSync(file)) {
    throw new Error(`File ${file} tidak ditemukan. (styles.html ada di project Apps Script lama, ` +
      `tapi tidak ikut di file upload — salin ke folder src/.)`);
  }
  return fs.readFileSync(file, 'utf8');
}

const config = fs.readFileSync(path.join(WEB, 'config.js'), 'utf8');
if (/GANTI-/.test(config)) console.warn('⚠️  web/config.js masih berisi placeholder GANTI-…');
const api = fs.readFileSync(path.join(WEB, 'supabase-api.js'), 'utf8');

let html = read('Index');
html = html.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, name) => {
  if (name === 'scripts') {
    return `<script src="${SUPABASE_JS}"></script>\n${read(name)}\n` +
           `<script>\n${config}\n</script>\n<script>\n${api}\n</script>`;
  }
  return read(name);
});
if (/<\?/.test(html)) throw new Error('Masih ada scriptlet Apps Script (<? ... ?>) yang belum diganti.');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`✅ ${OUT}/index.html (${Math.round(html.length / 1024)} KB)`);
