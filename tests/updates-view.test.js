const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
const updatesHtml = fs.readFileSync('src/updates.html', 'utf8');
const adminHtml = fs.readFileSync('src/admin.html', 'utf8');
const shellJs = fs.readFileSync('web/ui-shell.js', 'utf8');

test('public updates view is included and accessible in sidebar for all users', () => {
  assert.match(indexHtml, /include\('updates'\)/);
  assert.match(indexHtml, /id="nav-updates"/);
  const navUpdatesLine = indexHtml.split(/\r?\n/).find((line) => line.includes('id="nav-updates"')) || '';
  assert.doesNotMatch(navUpdatesLine, /display\s*:\s*none/i);
});

test('updates view provides release metadata, filters, and complete changelog entries', () => {
  assert.match(updatesHtml, /id="view-updates"/);
  assert.match(updatesHtml, /data-latest-release="[^"]+"/);
  assert.match(updatesHtml, /data-latest-version="[^"]+"/);
  assert.match(updatesHtml, /id="updatesSearchInput"/);
  assert.match(updatesHtml, /setUpdatesTopic\('/);
  assert.match(updatesHtml, /toggleAllReleaseDetails\(\)/);
  assert.match(updatesHtml, /datetime="2026-11-20"/);
  assert.match(updatesHtml, /datetime="2026-11-18"/);
  assert.match(updatesHtml, /datetime="2026-11-17"/);
});

test('admin panel links to public updates page without duplicating release cards', () => {
  assert.match(adminHtml, /switchView\('updates'\)/);
  assert.doesNotMatch(adminHtml, /<article\b/i);
});

test('switching to updates view marks latest release as seen', () => {
  assert.match(shellJs, /if \(id === 'updates'/);
  assert.match(shellJs, /markLatestReleaseSeen\(/);
});
