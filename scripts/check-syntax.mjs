import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const targets = ['build.mjs'];
if (fs.existsSync('scripts')) {
  for (const name of fs.readdirSync('scripts').sort()) {
    if (name.endsWith('.mjs')) targets.push(path.join('scripts', name));
  }
}
if (fs.existsSync('web')) {
  for (const name of fs.readdirSync('web').sort()) {
    if (name.endsWith('.js') && name !== 'config.js') targets.push(path.join('web', name));
  }
}

for (const file of targets) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

process.stdout.write(`✅ Syntax verified across ${targets.length} JS/MJS files.\n`);
