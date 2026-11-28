import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ANDROID_DIR = 'android';
const DEEP_LINK_SCHEME = 'com.mykeuguech.app';
const DEEP_LINK_HOST = 'auth-callback';
const BIOMETRIC_DEP = 'implementation "androidx.biometric:biometric:1.1.0"';

const NATIVE_BIOMETRIC_PLUGIN_JAVA = `package com.mykeuguech.app;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "NativeBiometric")
public class NativeBiometricPlugin extends Plugin {

    private String mapStatusReason(int statusCode) {
        switch (statusCode) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                return "available";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "none_enrolled";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "no_hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "hw_unavailable";
            default:
                return "unavailable";
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int statusCode = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        JSObject result = new JSObject();
        result.put("isAvailable", statusCode == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("statusCode", statusCode);
        result.put("reason", mapStatusReason(statusCode));
        call.resolve(result);
    }

    @PluginMethod
    public void verifyIdentity(PluginCall call) {
        FragmentActivity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("Activity unavailable", "unavailable");
            return;
        }
        BiometricManager manager = BiometricManager.from(activity);
        int statusCode = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        if (statusCode != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("Biometric unavailable", mapStatusReason(statusCode));
            return;
        }

        String rawTitle = call.getString("title", "MyKeuGuech");
        String title = (rawTitle == null || rawTitle.trim().isEmpty()) ? "MyKeuGuech" : rawTitle.trim();
        String rawSubtitle = call.getString("subtitle", "");
        String subtitle = rawSubtitle == null ? "" : rawSubtitle.trim();
        String rawReason = call.getString("reason", "");
        String reason = rawReason == null ? "" : rawReason.trim();
        String rawNeg = call.getString("negativeButtonText", "Gunakan PIN");
        String negativeText = (rawNeg == null || rawNeg.trim().isEmpty()) ? "Gunakan PIN" : rawNeg.trim();

        AtomicBoolean settled = new AtomicBoolean(false);
        activity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(activity);
                BiometricPrompt prompt = new BiometricPrompt(activity, executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        super.onAuthenticationError(errorCode, errString);
                        if (settled.compareAndSet(false, true)) {
                            call.reject(errString.toString(), String.valueOf(errorCode));
                        }
                    }

                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);
                        if (settled.compareAndSet(false, true)) {
                            JSObject ret = new JSObject();
                            ret.put("verified", true);
                            call.resolve(ret);
                        }
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                    }
                });

                BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                        .setNegativeButtonText(negativeText);
                if (!subtitle.isEmpty()) {
                    builder.setSubtitle(subtitle);
                }
                if (!reason.isEmpty()) {
                    builder.setDescription(reason);
                }
                prompt.authenticate(builder.build());
            } catch (Exception ex) {
                if (settled.compareAndSet(false, true)) {
                    String msg = ex.getMessage() != null ? ex.getMessage() : "Biometric prompt failed";
                    call.reject(msg, "prompt_error");
                }
            }
        });
    }
}
`;

// Gelombang 5.2 / Q12 — skema versionCode BARU: major*1000000 +
// minor*1000 + patch (tahan hingga minor/patch 999; skema lama
// major*10000+minor*100+patch bertabrakan bila minor/patch mencapai 100).
// Nilai HARUS naik monoton dari 32008 (3.20.8 skema lama): 3.20.9 baru =
// 3020009 > 32008. Skema ini diduplikasi di build.mjs (parseVersionCode)
// — ubah keduanya bersamaan.
export function computeAndroidVersion(pkgVersion) {
  const parts = String(pkgVersion || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const [major = 1, minor = 0, patch = 0] = parts;
  return { versionName: `${major}.${minor}.${patch}`, versionCode: major * 1000000 + minor * 1000 + patch };
}

export function patchVariablesGradle(filePath) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, 'utf8');
  text = text
    .replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 24')
    .replace(/compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = 36')
    .replace(/targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = 36');
  fs.writeFileSync(filePath, text);
}

export function patchAndroidManifest(filePath) {
  if (!fs.existsSync(filePath)) return;
  let xml = fs.readFileSync(filePath, 'utf8');
  if (/android:allowBackup="[^"]*"/.test(xml)) {
    xml = xml.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
  } else {
    xml = xml.replace(/<application\b/, '<application\n        android:allowBackup="false"');
  }
  const permissions = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT'
  ];
  for (const perm of permissions) {
    if (!xml.includes(perm)) {
      xml = xml.replace(/<application\b/, `<uses-permission android:name="${perm}" />\n    <application`);
    }
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

const KEYSTORE_PROPS_HEADER = [
  '// MYKEU_KEYSTORE_PATCH',
  'def keystorePropsFile = rootProject.file("keystore.properties")',
  'def keystoreProps = new Properties()',
  'if (keystorePropsFile.exists()) {',
  '    keystorePropsFile.withInputStream { keystoreProps.load(it) }',
  '}',
  'def debugKeystorePropsFile = rootProject.file("debug-keystore.properties")',
  'def debugKeystoreProps = new Properties()',
  'if (debugKeystorePropsFile.exists()) {',
  '    debugKeystorePropsFile.withInputStream { debugKeystoreProps.load(it) }',
  '}',
  '',
  'android {'
].join('\n');

const SIGNING_CONFIGS_BLOCK = [
  '    signingConfigs {',
  '        debug {',
  '            if (debugKeystorePropsFile.exists()) {',
  '                storeFile rootProject.file(debugKeystoreProps.getProperty("storeFile"))',
  '                storePassword debugKeystoreProps.getProperty("storePassword")',
  '                keyAlias debugKeystoreProps.getProperty("keyAlias")',
  '                keyPassword debugKeystoreProps.getProperty("keyPassword")',
  '            }',
  '        }',
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

function findMatchingBraceEnd(str, openBraceIdx) {
  let depth = 0;
  for (let i = openBraceIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

function injectBuildTypesSigning(gradle) {
  const btMatch = /\bbuildTypes\s*\{/.exec(gradle);
  if (!btMatch) return gradle;
  const btEnd = findMatchingBraceEnd(gradle, btMatch.index + btMatch[0].length - 1);
  if (btEnd <= btMatch.index) return gradle;
  let btBlock = gradle.slice(btMatch.index, btEnd);
  if (/\brelease\s*\{/.test(btBlock) && !btBlock.includes('signingConfigs.release')) {
    btBlock = btBlock.replace(
      /(\brelease\s*\{)/,
      '$1\n            if (keystorePropsFile.exists()) { signingConfig signingConfigs.release }'
    );
  }
  if (/\bdebug\s*\{/.test(btBlock) && !btBlock.includes('signingConfigs.debug')) {
    btBlock = btBlock.replace(
      /(\bdebug\s*\{)/,
      '$1\n            if (debugKeystorePropsFile.exists()) { signingConfig signingConfigs.debug }'
    );
  } else if (!btBlock.includes('signingConfigs.debug')) {
    btBlock = btBlock.replace(
      /(buildTypes\s*\{)/,
      '$1\n        debug {\n            if (debugKeystorePropsFile.exists()) { signingConfig signingConfigs.debug }\n        }'
    );
  }
  return gradle.slice(0, btMatch.index) + btBlock + gradle.slice(btEnd);
}

export function patchAppBuildGradle(filePath, versionInfo) {
  if (!fs.existsSync(filePath)) return;
  let gradle = fs.readFileSync(filePath, 'utf8');
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionInfo.versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${versionInfo.versionName}"`);

  if (!gradle.includes('MYKEU_KEYSTORE_PATCH')) {
    gradle = gradle.replace(/^android\s*\{/m, KEYSTORE_PROPS_HEADER);
    gradle = injectBuildTypesSigning(gradle);
    gradle = gradle.replace(/\n\s*buildTypes\s*\{/, `\n${SIGNING_CONFIGS_BLOCK}`);
  }
  if (!gradle.includes('androidx.biometric:biometric')) {
    gradle = gradle.replace(/^dependencies\s*\{/m, `dependencies {\n    ${BIOMETRIC_DEP}`);
  }
  fs.writeFileSync(filePath, gradle);
}

export function writeNativeBiometricPlugin(androidDir) {
  const dest = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'mykeuguech', 'app', 'NativeBiometricPlugin.java');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, NATIVE_BIOMETRIC_PLUGIN_JAVA);
  return dest;
}

export function patchMainActivity(filePath) {
  if (!fs.existsSync(filePath)) return;
  let java = fs.readFileSync(filePath, 'utf8');
  if (java.includes('NativeBiometricPlugin')) return;
  if (!java.includes('import android.os.Bundle;')) {
    if (java.includes('import com.getcapacitor.BridgeActivity;')) {
      java = java.replace('import com.getcapacitor.BridgeActivity;', 'import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;');
    } else {
      java = java.replace(/(package\s+[^;]+;)/, '$1\n\nimport android.os.Bundle;');
    }
  }
  if (/super\.onCreate\s*\(/.test(java)) {
    java = java.replace(/([ \t]*)(super\.onCreate\s*\()/, '$1registerPlugin(NativeBiometricPlugin.class);\n$1$2');
  } else {
    java = java.replace(
      /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{[\s\S]*?\}/,
      [
        'public class MainActivity extends BridgeActivity {',
        '    @Override',
        '    public void onCreate(Bundle savedInstanceState) {',
        '        registerPlugin(NativeBiometricPlugin.class);',
        '        super.onCreate(savedInstanceState);',
        '    }',
        '}'
      ].join('\n')
    );
  }
  fs.writeFileSync(filePath, java);
}

function writeKeystoreExample(androidDir) {
  const dest = path.join(androidDir, 'keystore.properties.example');
  const content = [
    'storeFile=mykeuguech-upload.jks',
    'storePassword=GANTI_PASSWORD_KEYSTORE',
    'keyAlias=mykeuguech-upload',
    'keyPassword=GANTI_PASSWORD_KEY',
    ''
  ].join('\n');
  fs.writeFileSync(dest, content);
}

export function patchAndroidProject(androidDir = ANDROID_DIR, pkgVersion = null) {
  const versionInfo = computeAndroidVersion(
    pkgVersion || JSON.parse(fs.readFileSync('package.json', 'utf8')).version
  );
  patchVariablesGradle(path.join(androidDir, 'variables.gradle'));
  patchAndroidManifest(path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'));
  patchAppBuildGradle(path.join(androidDir, 'app', 'build.gradle'), versionInfo);
  writeNativeBiometricPlugin(androidDir);
  patchMainActivity(path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'mykeuguech', 'app', 'MainActivity.java'));
  writeKeystoreExample(androidDir);
  return versionInfo;
}

function main() {
  if (!fs.existsSync(ANDROID_DIR)) {
    process.stdout.write('ℹ️ Folder android/ belum ditemukan. Jalankan "npm install && npm run cap:init:android" terlebih dahulu.\n');
    return;
  }
  const versionInfo = patchAndroidProject(ANDROID_DIR);
  process.stdout.write(`✅ Android project patched (API 36, v${versionInfo.versionName} / code ${versionInfo.versionCode}, NativeBiometric + OAuth deep link + release keystore hook).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
