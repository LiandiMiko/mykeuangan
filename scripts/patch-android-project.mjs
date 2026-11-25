import fs from 'node:fs';
import path from 'node:path';

const ANDROID_DIR = 'android';
const DEEP_LINK_SCHEME = 'com.mykeuguech.app';
const DEEP_LINK_HOST = 'auth-callback';

function computeAndroidVersion(pkgVersion) {
  const parts = String(pkgVersion || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const [major = 1, minor = 0, patch = 0] = parts;
  return { versionName: `${major}.${minor}.${patch}`, versionCode: major * 10000 + minor * 100 + patch };
}

function patchVariablesGradle(filePath) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, 'utf8');
  text = text
    .replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 24')
    .replace(/compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = 36')
    .replace(/targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = 36');
  fs.writeFileSync(filePath, text);
}

function patchAndroidManifest(filePath) {
  if (!fs.existsSync(filePath)) return;
  let xml = fs.readFileSync(filePath, 'utf8');
  if (/android:allowBackup="[^"]*"/.test(xml)) {
    xml = xml.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
  } else {
    xml = xml.replace(/<application\b/, '<application\n        android:allowBackup="false"');
  }
  if (!xml.includes('android.permission.POST_NOTIFICATIONS')) {
    xml = xml.replace(/<application\b/, '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <application');
  }
  if (!xml.includes(`android:scheme="${DEEP_LINK_SCHEME}"`)) {
    xml = xml.replace(/([ \t]*)<\/activity>/, (_, indent) => [
      `${indent}    <intent-filter>`,
      `${indent}        <action android:name="android.intent.action.VIEW" />`,
      `${indent}        <category android:name="android.intent.category.DEFAULT" />`,
      `${indent}        <category android:name="android.intent.category.BROWSABLE" />`,
      `${indent}        <data android:scheme="${DEEP_LINK_SCHEME}" android:host="${DEEP_LINK_HOST}" />`,
      `${indent}    </intent-filter>`,
      `${indent}</activity>`
    ].join('\n'));
  }
  fs.writeFileSync(filePath, xml);
}

function patchAppBuildGradle(filePath, versionInfo) {
  if (!fs.existsSync(filePath)) return;
  let gradle = fs.readFileSync(filePath, 'utf8');
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionInfo.versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${versionInfo.versionName}"`);

  if (!gradle.includes('MYKEU_KEYSTORE_PATCH')) {
    const header = [
      '// MYKEU_KEYSTORE_PATCH',
      'def keystorePropsFile = rootProject.file("keystore.properties")',
      'def keystoreProps = new Properties()',
      'if (keystorePropsFile.exists()) {',
      '    keystorePropsFile.withInputStream { keystoreProps.load(it) }',
      '}',
      '',
      'android {'
    ].join('\n');
    gradle = gradle.replace(/^android\s*\{/m, header);

    const signingBlock = [
      '    signingConfigs {',
      '        release {',
      '            if (keystorePropsFile.exists()) {',
      '                storeFile rootProject.file(keystoreProps.getProperty("storeFile"))',
      '                storePassword keystoreProps.getProperty("storePassword")',
      '                keyAlias keystoreProps.getProperty("keyAlias")',
      '                keyPassword keystoreProps.getProperty("keyPassword")',
      '            }',
      '        }',
      '    }',
      '    buildTypes {'
    ].join('\n');
    gradle = gradle.replace(/\n\s*buildTypes\s*\{/, `\n${signingBlock}`);
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{)/,
      '$1\n            if (keystorePropsFile.exists()) { signingConfig signingConfigs.release }'
    );
  }
  fs.writeFileSync(filePath, gradle);
}

function writeKeystoreExample() {
  const dest = path.join(ANDROID_DIR, 'keystore.properties.example');
  const content = [
    'storeFile=mykeuguech-upload.jks',
    'storePassword=GANTI_PASSWORD_KEYSTORE',
    'keyAlias=mykeuguech-upload',
    'keyPassword=GANTI_PASSWORD_KEY',
    ''
  ].join('\n');
  fs.writeFileSync(dest, content);
}

function main() {
  if (!fs.existsSync(ANDROID_DIR)) {
    process.stdout.write('ℹ️ Folder android/ belum ditemukan. Jalankan "npm install && npm run cap:init:android" terlebih dahulu.\n');
    return;
  }
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const versionInfo = computeAndroidVersion(pkg.version);
  patchVariablesGradle(path.join(ANDROID_DIR, 'variables.gradle'));
  patchAndroidManifest(path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml'));
  patchAppBuildGradle(path.join(ANDROID_DIR, 'app', 'build.gradle'), versionInfo);
  writeKeystoreExample();
  process.stdout.write(`✅ Android project patched (API 36, v${versionInfo.versionName} / code ${versionInfo.versionCode}, OAuth deep link + release keystore hook).\n`);
}

main();
