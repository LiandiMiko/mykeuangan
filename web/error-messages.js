/* ============================================================
   PESAN ERROR AMAN UNTUK PENGGUNA (Gelombang 4)
   ============================================================ */
(function (root) {
  'use strict';

  // Temuan R: pesan mentah Supabase (mis. "Invalid login credentials",
  // "Database error saving new user") dan error internal (SQL, stack,
  // nama fungsi) ditampilkan apa adanya ke pengguna lewat
  // showActionError() dan berbagai Swal/status. Pesan seperti itu
  // membocorkan detail implementasi dan membingungkan pengguna awam.
  //
  // Aturan di sini (toUserErrorMessage):
  //   1. Error yang membawa `userMessage` (string) ditampilkan apa
  //      adanya — itu pesan yang memang ditulis untuk pengguna
  //      (validasi klien, mis. "Batas impor 500 baris").
  //   2. Pola Supabase/auth/jaringan/DB yang dikenal dipetakan ke
  //      pesan ramah (ID/EN) — tanpa detail teknis.
  //   3. Pesan yang mengandung penanda teknis (nama layanan, SQL,
  //      stack, kode HTTP) diganti pesan umum.
  //   4. Selain itu, pesan diteruskan apa adanya: itu pesan berbahasa
  //      Indonesia yang ditulis aplikasi sendiri (validasi klien /
  //      pesan server yang memang untuk pengguna).
  // Pesan mentah SELALU tetap masuk log (console.error di
  // showActionError) untuk diagnosis — yang disembunyikan hanya
  // tampilannya ke pengguna, bukan jejaknya.

  const GENERIC = {
    id: 'Terjadi kesalahan. Coba lagi.',
    en: 'Something went wrong. Please try again.'
  };

  // Pola pesan mentah yang dikenal -> pesan ramah (tanpa detail teknis).
  const MAPPINGS = [
    {
      re: /invalid login credentials|invalid email or password/i,
      id: 'Email atau kata sandi salah. Periksa kembali lalu coba lagi.',
      en: 'Incorrect email or password. Check and try again.'
    },
    {
      re: /user already registered|user already exists|email already/i,
      id: 'Email ini sudah terdaftar. Coba masuk atau pulihkan kata sandi.',
      en: 'This email is already registered. Try signing in or reset your password.'
    },
    {
      re: /email not confirmed|email link is invalid or has expired/i,
      id: 'Email belum dikonfirmasi atau tautan sudah kedaluwarsa. Periksa kotak masuk Anda.',
      en: 'Email not confirmed yet or the link has expired. Check your inbox.'
    },
    {
      re: /too many requests|rate limit|over_request_rate_limit|too many login attempts/i,
      id: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
      en: 'Too many attempts. Wait a moment and try again.'
    },
    {
      re: /failed to fetch|network request failed|networkerror|network error|load failed|offline|tidak ada koneksi|ERR_INTERNET_DISCONNECTED|ERR_NETWORK/i,
      id: 'Tidak ada koneksi internet. Periksa koneksi lalu coba lagi.',
      en: 'No internet connection. Check your connection and try again.'
    },
    {
      re: /jwt expired|invalid jwt|session expired|refresh token.*(expired|invalid|not found)|user not found.*session|session not found/i,
      id: 'Sesi Anda berakhir. Masuk kembali.',
      en: 'Your session has expired. Please sign in again.'
    },
    {
      re: /password.*(weak|too short|should be different|same as|commonly used)|weak password/i,
      id: 'Kata sandi tidak memenuhi syarat. Gunakan kata sandi lain yang lebih kuat.',
      en: 'Password does not meet the requirements. Use a different, stronger password.'
    },
    {
      re: /row level security|rls.*policy|permission denied|not authorized|unauthorized|forbidden/i,
      id: 'Anda tidak punya akses untuk tindakan ini.',
      en: 'You do not have access to do that.'
    },
    {
      re: /duplicate key|already exists/i,
      id: 'Data sudah ada — tidak disimpan dua kali.',
      en: 'This already exists — it was not saved twice.'
    }
  ];

  // Penanda teknis: bila pesan mengandung salah satunya, tampilkan
  // pesan umum saja (detailnya tetap ada di console.error).
  // Hotfix P0 (2026-11-28): DUA pesan mentah lolos ke pengguna di live
  // v3.20.16 karena tidak cocok dengan pola di bawah:
  //   - 'column reference "id" is ambiguous' (Postgres 42702):
  //     "column \"" tidak cocok karena pesannya 'column reference "',
  //     bukan 'column "'. Tambah 'column reference' + 'is ambiguous'.
  //   - 'hasPin is not defined' (ReferenceError JS): 'is not a function'
  //     dan 'undefined is not' tidak cocok dengan 'is not defined'.
  // Tambah juga 'syntax error', kode Postgres 42702/42P0x, dan PGRST.
  const TECHNICAL_RE = /supabase|postgrest|postgres|database|deno|jwt|token|row.level|\brls\b|permission denied|violates|duplicate key|relation "|column "|column reference|is ambiguous|is not defined|syntax error|42702|42P0|PGRST|function public|schema |constraint "|failed to fetch|networkerror|unexpected token|cannot read propert|is not a function|undefined is not|internal (server )?error|server error|at [A-Za-z_$]+\.[A-Za-z_$]+ \(|status [45]\d\d|error code|ECONN|ETIMEDOUT|ERR_/i;

  function detectLang(lang) {
    if (lang === 'en' || lang === 'id') return lang;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'en') return 'en';
    } catch (_) { /* abaikan: default Indonesia */ }
    return 'id';
  }

  function toUserErrorMessage(error, lang) {
    const en = detectLang(lang) === 'en';
    const pick = (pair) => (en ? pair.en : pair.id);
    if (error && typeof error.userMessage === 'string' && error.userMessage.trim()) {
      return error.userMessage;
    }
    if (error == null || error === '') return pick(GENERIC);
    const code = String((error && error.code) || '');
    // Hati-hati: String(new Error('')) === 'Error' — ambil .message
    // bila ada, jangan String(error) untuk Error tanpa pesan.
    let raw = '';
    if (typeof error === 'string') raw = error;
    else if (error && typeof error.message === 'string') raw = error.message;
    else if (error != null) raw = String(error);
    if (!raw.trim()) return pick(GENERIC);
    if (/^23505$/.test(code)) {
      return pick({ id: 'Data sudah ada — tidak disimpan dua kali.', en: 'This already exists — it was not saved twice.' });
    }
    // Optimistic locking (Gelombang 7c): konflik TIDAK PERNAH boleh
    // sampai ke pengguna sebagai error mentah — jalur yang ditangani
    // (form, laporan, flush) menampilkan dialog pilihan; ini hanya
    // jaring pengaman bila konflik lolos ke showActionError dari
    // pemanggil yang belum menanganinya (mis. restore cadangan).
    // Pesan 'CONFLICT:...' juga akan ditangkap TECHNICAL_RE di bawah,
    // tetapi pemetaan eksplisit ini memberi kalimat yang menjelaskan
    // apa yang terjadi, bukan GENERIC.
    if (code === 'MK_CONFLICT') {
      return pick({ id: 'Data ini baru saja diubah di perangkat lain. Muat ulang dan coba lagi.', en: 'This record was just changed on another device. Reload and try again.' });
    }
    for (const m of MAPPINGS) {
      if (m.re.test(raw)) return pick(m);
    }
    if (TECHNICAL_RE.test(raw)) return pick(GENERIC);
    return raw;
  }

  // Pembungkus untuk pesan yang memang ditulis untuk pengguna:
  // tandai Error agar sanitizer menampilkannya apa adanya.
  function userError(message) {
    const err = new Error(String(message || ''));
    err.userMessage = String(message || '');
    return err;
  }

  /* ============================================================
     HELPER BERSAMA — Gelombang 5.3 (Q10)
     ------------------------------------------------------------
     Modul ini dimuat PERTAMA (WEB_MODULES[0] di build.mjs), jadi
     helper di sini tersedia untuk semua modul lain tanpa
     dependensi pemuatan tambahan. Sebelumnya helper yang sama
     hidup di banyak tempat dengan implementasi berbeda:
       - escape HTML: escapeHtmlJS (ui-state.js), escapeSafe
         (ui-ai.js), escUpdateHtml (ui-feat-updates.js),
         escapeAuthAttr (supabase-auth-ui.js) — empat rantai
         replace yang sama; kini semuanya mendelegasikan ke
         escapeHtml() di sini.
       - tanggal "hari ini": localToday() dulu didefinisikan di
         ui-wallets.js (UI_CORE, urutan ke-9) sementara modul
         lain memakai guard typeof-check dengan fallback UTC
         (toISOString) — fallback itu SALAH di WIB: sebelum
         07:00 WIB tanggal UTC masih kemarin (kelas bug yang
         sama dengan bug validasi tanggal Gelombang 3). Kini
         localToday() tinggal di sini dan semua call site
         memanggilnya langsung, tanpa fallback UTC.
       - validasi YYYY-MM-DD: pola `new Date(v).toISOString()
         .slice(0, 10) === v` (round-trip UTC) diganti
         isValidIsoDate() yang memakai komponen lokal.
     ============================================================ */

  // Escape HTML (lima karakter). Satu-satunya implementasi
  // kanonis — JANGAN salin rantai replace ini ke modul lain;
  // panggil escapeHtml() / escapeHtmlJS() sebagai gantinya.
  function escapeHtml(value) {
    if (value == null) return '';
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Format Date menjadi 'YYYY-MM-DD' memakai komponen LOKAL
  // (getFullYear/getMonth/getDate). JANGAN pakai toISOString()
  // di sini: itu UTC dan menggeser hari di zona WIB.
  // Mengembalikan '' untuk tanggal tak valid.
  function localDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 'Hari ini' lokal ('YYYY-MM-DD'). Satu-satunya definisi —
  // definisi lama di web/ui-wallets.js dipindah ke sini agar
  // tersedia sejak modul pertama dimuat.
  function localToday() {
    return localDateKey(new Date());
  }

  // Validasi ketat 'YYYY-MM-DD' + tanggal kalender nyata
  // (tolak 2026-02-30). Memakai konstruktor lokal
  // new Date(y, m-1, d) + perbandingan komponen, BUKAN
  // round-trip toISOString() (UTC) — bandingkan komentar lama
  // di supabase-admin.js § debtDueDates (Gelombang 3): parse
  // lokal tengah malam lalu round-trip UTC menolak tanggal
  // valid di zona waktu positif.
  function isValidIsoDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
  }

  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.toUserErrorMessage = toUserErrorMessage;
  root.__mkFeat.userError = userError;
  root.toUserErrorMessage = toUserErrorMessage;
  root.userError = userError;
  // Helper bersama Gelombang 5.3 (Q10) — lihat blok di atas.
  root.escapeHtml = escapeHtml;
  root.localDateKey = localDateKey;
  root.localToday = localToday;
  root.isValidIsoDate = isValidIsoDate;
})(typeof window !== 'undefined' ? window : globalThis);
