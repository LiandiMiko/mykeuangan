const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync('src/script.html', 'utf8');
const dashboard = fs.readFileSync('src/dashboard.html', 'utf8');

test('calendar view contains a stable grid and filter controls', () => {
  assert.match(dashboard, /id="kalenderGrid"/);
  assert.match(dashboard, /id="calFilterAll"/);
  assert.match(dashboard, /id="calFilterOut"/);
  assert.match(dashboard, /id="calFilterIn"/);
  assert.match(script, /function renderKalender\(\)/);
});

test('calendar initializes from the active financial period', () => {
  assert.match(script, /const periodParts = \/\^\(\\d\{4\}\)-\(\\d\{2\}\)\$\/\.exec/);
  assert.match(script, /kalenderYear = Number\(periodParts\[1\]\)/);
  assert.match(script, /kalenderMonth = Number\(periodParts\[2\]\)/);
});

test('calendar rerenders when dashboard is opened and clears stale cells', () => {
  assert.match(script, /if \(id === 'dashboard'\)/);
  assert.match(script, /try \{ renderKalender\(\); \} catch/);
  assert.match(script, /grid\.innerHTML = '';/);
  assert.match(script, /grid\.classList\.add\('grid', 'grid-cols-7'\)/);
});