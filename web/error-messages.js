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
  const TECHNICAL_RE = /supabase|postgrest|postgres|database|deno|jwt|token|row.level|\brls\b|permission denied|violates|duplicate key|relation "|column "|function public|schema |constraint "|failed to fetch|networkerror|unexpected token|cannot read propert|is not a function|undefined is not|internal (server )?error|server error|at [A-Za-z_$]+\.[A-Za-z_$]+ \(|status [45]\d\d|error code|ECONN|ETIMEDOUT|ERR_/i;

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

  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.toUserErrorMessage = toUserErrorMessage;
  root.__mkFeat.userError = userError;
  root.toUserErrorMessage = toUserErrorMessage;
  root.userError = userError;
})(typeof window !== 'undefined' ? window : globalThis);
