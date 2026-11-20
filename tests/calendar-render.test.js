const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const calendarJs = fs.readFileSync('web/ui-calendar.js', 'utf8');
const shellJs = fs.readFileSync('web/ui-shell.js', 'utf8');
const dashboard = fs.readFileSync('src/dashboard.html', 'utf8');

test('calendar view contains a stable grid and filter controls', () => {
  assert.match(dashboard, /id="kalenderGrid"/);
  assert.match(dashboard, /id="calFilterAll"/);
  assert.match(dashboard, /id="calFilterOut"/);
  assert.match(dashboard, /id="calFilterIn"/);
  assert.match(calendarJs, /function renderKalender\(\)/);
});

test('calendar initializes from the active financial period', () => {
  assert.match(calendarJs, /const periodParts = \/\^\(\\d\{4\}\)-\(\\d\{2\}\)\$\/\.exec/);
  assert.match(calendarJs, /kalenderYear = Number\(periodParts\[1\]\)/);
  assert.match(calendarJs, /kalenderMonth = Number\(periodParts\[2\]\)/);
});

test('calendar rerenders when dashboard is opened and clears stale cells', () => {
  assert.match(shellJs, /if \(id === 'dashboard'\)/);
  assert.match(shellJs, /try \{ renderKalender\(\); \} catch/);
  assert.match(calendarJs, /grid\.innerHTML = '';/);
  assert.match(calendarJs, /grid\.classList\.add\('grid', 'grid-cols-7'\)/);
});
