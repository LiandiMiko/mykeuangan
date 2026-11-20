const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('src/Index.html', 'utf8');
const dashboardHtml = fs.readFileSync('src/dashboard.html', 'utf8');
const laporanHtml = fs.readFileSync('src/laporan.html', 'utf8');
const historiHtml = fs.readFileSync('src/histori.html', 'utf8');
const asetHtml = fs.readFileSync('src/aset.html', 'utf8');
const aiHtml = fs.readFileSync('src/ai.html', 'utf8');
const buildMjs = fs.readFileSync('build.mjs', 'utf8');

test('index includes features-v35, mobile bottom nav, command palette trigger, and SW toast hook', () => {
  assert.match(indexHtml, /id="mobileBottomNav"/);
  assert.match(indexHtml, /include\('features-v35'\)/);
  assert.match(indexHtml, /openCommandPalette\(\)/);
  assert.match(indexHtml, /showPwaUpdateToast/);
  assert.match(buildMjs, /finance-pro\.js/);
});

test('dashboard provides 1-line quick add form and quick template container', () => {
  assert.match(dashboardHtml, /id="quickAddCard"/);
  assert.match(dashboardHtml, /id="quickAddInput"/);
  assert.match(dashboardHtml, /id="quickAddPreview"/);
  assert.match(dashboardHtml, /id="quickTemplateChips"/);
  assert.match(dashboardHtml, /openQuickTemplatesModal\(\)/);
});

test('laporan, histori, aset, and ai views wire grouped menus, bulk actions, tags, and calculators', () => {
  assert.match(laporanHtml, /id="lapImportMenu"/);
  assert.match(laporanHtml, /id="lapExportMenu"/);
  assert.match(laporanHtml, /id="lapBulkBar"/);
  assert.match(laporanHtml, /id="lapSelectAll"/);
  assert.match(laporanHtml, /id="lapTagBar"/);
  assert.match(laporanHtml, /openAnnualRecapModal\(\)/);
  assert.match(historiHtml, /id="historiTagBar"/);
  assert.match(asetHtml, /openFinancialCalculatorsModal\(\)/);
  assert.match(aiHtml, /openFinancialCalculatorsModal\(\)/);
  assert.match(aiHtml, /clearAiChatHistory\(\)/);
});
