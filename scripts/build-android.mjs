import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_MAP = {
  'debug-apk': {
    gradleTask: 'assembleDebug',
    srcPath: path.join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    suffix: 'debug.apk'
  },
  'release-apk': {
    gradleTask: 'assembleRelease',
    srcPath: path.join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    suffix: 'release.apk'
  },
  'release-aab': {
    gradleTask: 'bundleRelease',
    srcPath: path.join('android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'),
    suffix: 'release.aab'
  }
};

export function resolveAndroidTarget(mode, version) {
  const key = String(mode || 'debug-apk').trim();
  const entry = TARGET_MAP[key];
  if (!entry) {
    throw new Error(`Target build Android tidak dikenal: "${key}". Gunakan debug-apk, release-apk, atau release-aab.`);
  }
  const cleanVer = String(version || '1.0.0').trim();
  return {
    mode: key,
    gradleTask: entry.gradleTask,
    srcPath: entry.srcPath,
    destName: `MyKeuGuech-v${cleanVer}-${entry.suffix}`
  };
}

function runTool(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd: cwd || process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Perintah gagal (exit ${res.status}): ${cmd} ${args.join(' ')}`);
  }
}

function ensureLocalPrereqs(mode) {
  process.stdout.write(`ℹ️ Menyiapkan build Android (${mode})...\n`);
  if (!fs.existsSync(path.join('node_modules', '@capacitor', 'cli'))) {
    throw new Error('Dependensi belum terpasang. Jalankan "npm install" terlebih dahulu.');
  }
  const javaCheck = spawnSync('java', ['-version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32'
  });
  if (javaCheck.error || javaCheck.status !== 0) {
    throw new Error('JDK 21 belum terpasang di PATH. Install JDK 21 + Android SDK 36 atau gunakan Cloud Build GitHub Actions.');
  }
}

function main() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const target = resolveAndroidTarget(process.argv[2] || 'debug-apk', pkg.version);
  ensureLocalPrereqs(target.mode);

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

  runTool(npmCmd, ['run', 'build:prod']);
  if (!fs.existsSync('android')) {
    runTool(npxCmd, ['cap', 'add', 'android']);
  }
  runTool(process.execPath, ['scripts/patch-android-project.mjs']);
  runTool(npmCmd, ['run', 'cap:assets']);
  runTool(npxCmd, ['cap', 'sync', 'android']);
  runTool(process.execPath, ['scripts/patch-android-project.mjs']);

  if (target.mode !== 'debug-apk' && !fs.existsSync(path.join('android', 'keystore.properties'))) {
    throw new Error('android/keystore.properties belum ada. Salin dari android/keystore.properties.example dan ikuti docs/ANDROID_PLAYSTORE_GUIDE.md.');
  }

  runTool(gradleCmd, [target.gradleTask], path.resolve('android'));
  if (!fs.existsSync(target.srcPath)) {
    throw new Error(`Output Gradle tidak ditemukan di ${target.srcPath}`);
  }

  fs.mkdirSync('release', { recursive: true });
  const destPath = path.join('release', target.destName);
  fs.copyFileSync(target.srcPath, destPath);
  const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2);
  process.stdout.write(`✅ Paket Android siap: ${destPath} (${sizeMb} MB)\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`❌ ${err.message || String(err)}\n`);
    process.exitCode = 1;
  }
}
