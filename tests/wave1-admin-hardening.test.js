const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

function loadAdminClient({ sessionRole = 'admin', authUserId = ADMIN_ID } = {}) {
  const invokeCalls = [];
  const fromCalls = [];
  const core = {
    handlers: {},
    sb: {
      functions: {
        invoke: async (fnName, { body } = {}) => {
          invokeCalls.push({ fnName, body });
          return { data: { success: true }, error: null };
        }
      },
      auth: {
        getUser: async () => ({ data: { user: { id: authUserId } }, error: null })
      },
      from: (table) => {
        fromCalls.push(table);
        throw new Error(`direct table access to ${table} must not happen from the client`);
      },
      rpc: async () => ({ data: null, error: null })
    },
    fail: (error) => { if (error) throw error; },
    fetchAll: async () => [],
    setSetting: async () => {}
  };
  const sandbox = { console, __mkSb: core, sessionRole };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync('web/supabase-admin.js', 'utf8'), sandbox);
  return { core, invokeCalls, fromCalls, sandbox };
}

test('K1: api_setUserRole/api_setUserStatus go through admin-user-ops, never profiles.update', async () => {
  const { core, invokeCalls, fromCalls } = loadAdminClient();
  await core.handlers.api_setUserRole(TARGET_ID, 'admin');
  await core.handlers.api_setUserStatus(TARGET_ID, 'suspended');

  assert.equal(fromCalls.length, 0, 'client must not touch profiles directly');
  // Objects built inside the vm realm carry that realm's prototype, so
  // compare via a JSON round-trip (same pattern as wave-v320 tests).
  assert.deepEqual(JSON.parse(JSON.stringify(invokeCalls)), [
    { fnName: 'admin-user-ops', body: { action: 'set_user_role', userId: TARGET_ID, role: 'admin' } },
    { fnName: 'admin-user-ops', body: { action: 'set_user_status', userId: TARGET_ID, status: 'suspended' } }
  ]);
});

test('K1: client keeps sessionRole only as a UX pre-check and keeps the self-demotion guard', async () => {
  const nonAdmin = loadAdminClient({ sessionRole: 'user' });
  await assert.rejects(() => nonAdmin.core.handlers.api_setUserRole(TARGET_ID, 'admin'), /Hanya untuk administrator/);
  await assert.rejects(() => nonAdmin.core.handlers.api_setUserStatus(TARGET_ID, 'suspended'), /Hanya untuk administrator/);
  assert.equal(nonAdmin.invokeCalls.length, 0, 'pre-check must run before any edge call');

  const self = loadAdminClient({ authUserId: TARGET_ID });
  await assert.rejects(() => self.core.handlers.api_setUserRole(TARGET_ID, 'user'), /menurunkan role/);
  await assert.rejects(() => self.core.handlers.api_setUserStatus(TARGET_ID, 'suspended'), /menonaktifkan/);
  assert.equal(self.invokeCalls.length, 0, 'self-demotion must be rejected client-side too');
});

test('K1: client no longer updates profiles directly or logs role/status twice', () => {
  const adminJs = fs.readFileSync('web/supabase-admin.js', 'utf8');
  assert.doesNotMatch(adminJs, /from\('profiles'\)\.update/);
  assert.match(adminJs, /invokeEdgeFunction\('admin-user-ops', \{ action: 'set_user_role', userId, role \}/);
  assert.match(adminJs, /invokeEdgeFunction\('admin-user-ops', \{ action: 'set_user_status', userId, status \}/);
  // Server enforcement must be stated next to the UX-only pre-check.
  assert.match(adminJs, /ditegakkan server oleh edge function admin-user-ops/);
  // logAdminActionSafe must not be *called* for role/status anymore (server audits).
  // (The code comment may still mention its name; only a call counts.)
  const roleFn = adminJs.slice(adminJs.indexOf('api_setUserRole'), adminJs.indexOf('api_updateOwnPassword'));
  const statusFn = adminJs.slice(adminJs.indexOf('api_setUserStatus'), adminJs.indexOf('api_setUserRole'));
  assert.doesNotMatch(roleFn, /logAdminActionSafe\(/);
  assert.doesNotMatch(statusFn, /logAdminActionSafe\(/);
});

test('K1: admin-user-ops validates role/status server-side, guards self and last admin, and audits', () => {
  const fn = fs.readFileSync('supabase/functions/admin-user-ops/index.ts', 'utf8');
  assert.match(fn, /set_user_role/);
  assert.match(fn, /set_user_status/);
  assert.match(fn, /\['user', 'admin'\]/);
  assert.match(fn, /\['active', 'suspended'\]/);
  assert.match(fn, /Admin tidak dapat menurunkan role akunnya sendiri/);
  assert.match(fn, /Admin tidak dapat menonaktifkan akunnya sendiri/);
  assert.match(fn, /Tidak dapat menurunkan role satu-satunya admin aktif/);
  assert.match(fn, /Tidak dapat menonaktifkan satu-satunya admin aktif/);
  assert.match(fn, /adminClient\.from\('profiles'\)\.update/);
  assert.match(fn, /old_role: target\.role, new_role: newValue/);
  assert.match(fn, /old_status: target\.status, new_status: newValue/);
  // Existing behaviour must survive: caller must be an active admin, old actions intact.
  assert.match(fn, /requester\.role !== 'admin' \|\| requester\.status !== 'active'/);
  assert.match(fn, /delete_user/);
  assert.match(fn, /unlink_telegram/);
});

test('K1: wave-1 migration drops first-user-admin, locks role/status columns, keeps admin policy', () => {
  const mig = fs.readFileSync('supabase/migrations/20261128000000_wave1_admin_hardening.sql', 'utf8');
  assert.match(mig, /handle_new_user/);
  assert.doesNotMatch(mig, /is_first/);
  assert.doesNotMatch(mig, /case when is_first/);
  // New sign-ups always get role 'user' (OAuth display-name handling preserved).
  assert.match(mig, /raw_user_meta_data->>'full_name'/);
  assert.match(mig, /insert into public\.profiles \(id, email, display_name, role\)[\s\S]*?'user'/);
  // No admin backfill anywhere in the migration (comments stripped first:
  // the header comment shows the manual appointment SQL as an example).
  const withoutComments = mig.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(withoutComments, /set role = 'admin'/);
  // Column lock: no direct UPDATE grant survives.
  assert.match(withoutComments, /revoke update on public\.profiles from authenticated/i);
  assert.doesNotMatch(withoutComments, /grant\s+update/i);
  // Admin UPDATE policy is re-asserted with is_admin().
  assert.match(mig, /drop policy if exists "admins_update_profiles"/);
  assert.match(mig, /create policy "admins_update_profiles" on public\.profiles/);
  assert.match(mig, /public\.is_admin\(\)/);
});
