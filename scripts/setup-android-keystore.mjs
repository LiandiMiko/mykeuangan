import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const ANDROID_DIR = 'android';
const KEYSTORE_NAME = 'mykeuguech-upload.jks';
const DEFAULT_ALIAS = 'mykeuguech-upload';
const KEYSTORE_PATH = path.join(ANDROID_DIR, KEYSTORE_NAME);
const PROPS_PATH = path.join(ANDROID_DIR, 'keystore.properties');

async function promptSecret(rl, label, minLen = 6) {
  const val = (await rl.question(label)).trim();
  if (val.length < minLen) throw new Error(`Minimal ${minLen} karakter.`);
  return val;
}

async function main() {
  if (!fs.existsSync(ANDROID_DIR)) {
    fs.mkdirSync(ANDROID_DIR, { recursive: true });
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const alias = ((await rl.question(`Key alias [${DEFAULT_ALIAS}]: `)).trim()) || DEFAULT_ALIAS;
    const storePass = await promptSecret(rl, 'Password keystore (min 6 karakter): ');
    const keyPass = ((await rl.question('Password key [Enter jika sama dengan keystore]: ')).trim()) || storePass;
    const cn = ((await rl.question('Nama Pemilik / Organisasi [MyKeuGuech]: ')).trim()) || 'MyKeuGuech';

    if (!fs.existsSync(KEYSTORE_PATH)) {
      execFileSync('keytool', [
        '-genkey', '-v',
        '-keystore', KEYSTORE_PATH,
        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-alias', alias,
        '-storepass', storePass, '-keypass', keyPass,
        '-dname', `CN=${cn.replace(/[,=+<>#;\\"]/g, ' ')}, OU=Mobile, O=${cn.replace(/[,=+<>#;\\"]/g, ' ')}, C=ID`
      ], { stdio: 'inherit' });
    } else {
      process.stdout.write(`ℹ️ Keystore sudah ada di ${KEYSTORE_PATH}; melewati pembuatan ulang.\n`);
    }

    fs.writeFileSync(PROPS_PATH, [
      `storeFile=${KEYSTORE_NAME}`,
      `storePassword=${storePass}`,
      `keyAlias=${alias}`,
      `keyPassword=${keyPass}`,
      ''
    ].join('\n'));

    const b64 = fs.readFileSync(KEYSTORE_PATH).toString('base64');
    process.stdout.write('\n✅ Keystore & android/keystore.properties siap (aman di-.gitignore).\n');
    process.stdout.write('Tambahkan 4 GitHub Repository Secrets di Settings -> Secrets and variables -> Actions -> Secrets:\n');
    process.stdout.write(`  - ANDROID_KEY_ALIAS    : ${alias}\n`);
    process.stdout.write('  - ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD : <sesuai input Anda>\n');
    process.stdout.write(`  - ANDROID_KEYSTORE_BASE64 panjang: ${b64.length} karakter (jalankan PowerShell berikut untuk salin ke clipboard):\n`);
    process.stdout.write(`    [Convert]::ToBase64String([IO.File]::ReadAllBytes("${KEYSTORE_PATH.replaceAll('\\', '/')}")) | Set-Clipboard\n`);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  process.stderr.write(`❌ Gagal menyiapkan keystore: ${(err && err.message) || err}\n`);
  process.exit(1);
});
