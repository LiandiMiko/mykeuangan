/* password-policy.js — shared password & PIN policy (Wave 3.1 / S5)
   Single source of truth for client-side password/PIN strength rules.
   The same rule set is mirrored server-side in
   supabase/functions/admin-password/index.ts (another agent's file) so
   client and server agree. Load this file BEFORE supabase-auth-ui.js /
   supabase-auth.js / supabase-admin.js / ui-feat-account.js
   (add 'password-policy.js' as the first entry of SUPABASE_MODULES in
   build.mjs). Consumers that run without it fall back to the old
   length-only check — they must never crash when the policy is absent.
   Exported as window.__mkPasswordPolicy and on window.__mkFeat. */
(function (root) {
  'use strict';

  // Top ~100 common / guessable passwords (lowercased). A password is
  // rejected when it equals an entry, equals an entry after stripping
  // trailing digits, or contains an entry of 6+ chars as a substring.
  var COMMON_PASSWORDS = [
    'password', 'password1', 'password123', 'password12', 'passw0rd', 'passw0rd1',
    'qwerty', 'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfgh', 'asdfghjkl',
    '123456', '1234567', '12345678', '123456789', '1234567890', '123123', '123321',
    '111111', '11111111', '000000', '00000000', '123456a', 'abc123', 'abc12345',
    'abcd1234', 'letmein', 'letmein123', 'welcome', 'welcome1', 'welcome123',
    'admin', 'admin123', 'admin1234', 'administrator', 'iloveyou', 'iloveyou1',
    'monkey', 'monkey123', 'dragon', 'dragon123', 'sunshine', 'sunshine1',
    'princess', 'princess1', 'football', 'football1', 'baseball', 'superman',
    'superman1', 'michael', 'michael1', 'shadow', 'shadow1', 'master', 'master123',
    '696969', '121212', '112233', '987654321', '98765432', '1234qwer', 'qwer1234',
    '1q2w3e4r', '1qaz2wsx', 'aa123456', 'a123456', 'pass123', 'pass1234',
    'secret', 'secret123', 'login123', 'user123', 'test123', 'test1234',
    'changeme', 'changeme123', 'default', 'default123', 'hello123', 'freedom',
    'freedom1', 'whatever', 'whatever1', 'charlie', 'thomas', 'jordan', 'jordan1',
    'hunter', 'hunter2', 'buster', 'buster1', 'soccer', 'soccer1', 'harley',
    'harley1', 'batman', 'batman1', 'andrew', 'andrew1', 'joshua', 'joshua1',
    'maggie', 'maggie1', 'cookie', 'cookie1', 'pepper', 'pepper1', 'summer1',
    'winter1', 'spring1', 'autumn1', 'killer', 'killer1', 'george', 'george1'
  ];

  var MESSAGES = {
    id: {
      too_short: 'Password harus terdiri dari 8 sampai 128 karakter.',
      too_long: 'Password harus terdiri dari 8 sampai 128 karakter.',
      repeated_chars: 'Password tidak boleh mengandung 3 karakter sama berurutan (mis. "aaa").',
      sequential: 'Password tidak boleh mengandung urutan berurutan 4 karakter atau lebih (mis. "1234" atau "abcd").',
      common_password: 'Password terlalu umum dan mudah ditebak. Gunakan kombinasi yang lebih unik.',
      contains_email: 'Password tidak boleh mengandung bagian dari alamat email Anda.',
      pin_format: 'PIN harus 4 sampai 6 angka.',
      pin_all_same: 'PIN tidak boleh semua digit sama (mis. 111111).',
      pin_sequential: 'PIN tidak boleh berupa urutan berurutan (mis. 123456 atau 654321).'
    },
    en: {
      too_short: 'Password must be 8 to 128 characters.',
      too_long: 'Password must be 8 to 128 characters.',
      repeated_chars: 'Password must not contain 3 identical characters in a row (e.g. "aaa").',
      sequential: 'Password must not contain a run of 4 or more sequential characters (e.g. "1234" or "abcd").',
      common_password: 'Password is too common and easy to guess. Choose something more unique.',
      contains_email: 'Password must not contain part of your email address.',
      pin_format: 'PIN must be 4 to 6 digits.',
      pin_all_same: 'PIN must not be all the same digit (e.g. 111111).',
      pin_sequential: 'PIN must not be a sequential run (e.g. 123456 or 654321).'
    }
  };

  function msg(code, lang) {
    var table = MESSAGES[lang === 'en' ? 'en' : 'id'] || MESSAGES.id;
    return table[code] || table.too_short;
  }

  // True when `s` (already lowercased) contains a run of >= 4 chars where
  // each next char code is exactly prev+1 (ascending) or prev-1
  // (descending), counting only letters/digits. Mixed runs such as
  // 'z123' do not count: the run resets when the step changes.
  function hasSequentialRun(s) {
    var run = 1;
    var step = 0;
    for (var i = 1; i < s.length; i++) {
      var prev = s.charCodeAt(i - 1);
      var cur = s.charCodeAt(i);
      if (!/[a-z0-9]/.test(s[i - 1]) || !/[a-z0-9]/.test(s[i])) { run = 1; step = 0; continue; }
      var d = cur - prev;
      if ((d === 1 || d === -1) && (step === 0 || step === d)) {
        step = d;
        run++;
        if (run >= 4) return true;
      } else if (d === 1 || d === -1) {
        step = d;
        run = 2;
      } else {
        run = 1;
        step = 0;
      }
    }
    return false;
  }

  function isCommonPassword(lower) {
    var stripped = lower.replace(/\d+$/, '');
    for (var i = 0; i < COMMON_PASSWORDS.length; i++) {
      var entry = COMMON_PASSWORDS[i];
      if (lower === entry) return true;
      if (stripped && stripped === entry) return true;
      if (entry.length >= 6 && lower.indexOf(entry) !== -1) return true;
    }
    return false;
  }

  // Returns { ok: true } or { ok: false, errors: [{ code, message }] }.
  // opts: { email, lang: 'id' | 'en' }.
  function validatePassword(password, opts) {
    var o = opts || {};
    var lang = o.lang === 'en' ? 'en' : 'id';
    var errors = [];
    var pw = typeof password === 'string' ? password : '';
    var add = function (code) { errors.push({ code: code, message: msg(code, lang) }); };
    if (pw.length < 8) { add('too_short'); return { ok: false, errors: errors }; }
    if (pw.length > 128) { add('too_long'); return { ok: false, errors: errors }; }
    var lower = pw.toLowerCase();
    if (/(.)\1{2,}/.test(pw)) add('repeated_chars');
    if (hasSequentialRun(lower)) add('sequential');
    if (isCommonPassword(lower)) add('common_password');
    var localPart = '';
    if (typeof o.email === 'string') {
      localPart = String(o.email).split('@')[0].trim().toLowerCase();
    }
    if (localPart.length >= 3 && lower.indexOf(localPart) !== -1) add('contains_email');
    return errors.length ? { ok: false, errors: errors } : { ok: true, errors: [] };
  }

  // PIN: 4-6 digits, not all the same digit, not a sequential run.
  // Returns the same { ok, errors } shape.
  function validatePin(pin, opts) {
    var lang = (opts && opts.lang) === 'en' ? 'en' : 'id';
    var errors = [];
    var p = typeof pin === 'string' ? pin : String(pin == null ? '' : pin);
    var add = function (code) { errors.push({ code: code, message: msg(code, lang) }); };
    if (!/^\d{4,6}$/.test(p)) { add('pin_format'); return { ok: false, errors: errors }; }
    if (/^(\d)\1+$/.test(p)) add('pin_all_same');
    var asc = true;
    var desc = true;
    for (var i = 1; i < p.length; i++) {
      var d = p.charCodeAt(i) - p.charCodeAt(i - 1);
      if (d !== 1) asc = false;
      if (d !== -1) desc = false;
    }
    if (asc || desc) add('pin_sequential');
    return errors.length ? { ok: false, errors: errors } : { ok: true, errors: [] };
  }

  var policy = {
    COMMON_PASSWORDS: COMMON_PASSWORDS,
    validatePassword: validatePassword,
    validatePin: validatePin,
    // True when the password contains the email's local-part (>= 3 chars).
    containsEmailLocalPart: function (password, email) {
      var pw = typeof password === 'string' ? password.toLowerCase() : '';
      var localPart = typeof email === 'string' ? String(email).split('@')[0].trim().toLowerCase() : '';
      return Boolean(localPart && localPart.length >= 3 && pw.indexOf(localPart) !== -1);
    },
    // First error message (or '' when valid) — the shape callers display.
    firstPasswordError: function (password, opts) {
      var r = validatePassword(password, opts);
      return r.ok ? '' : r.errors[0].message;
    },
    firstPinError: function (pin, opts) {
      var r = validatePin(pin, opts);
      return r.ok ? '' : r.errors[0].message;
    }
  };

  root.__mkPasswordPolicy = policy;
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.passwordPolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis);
