// supabase/functions/account-cleanup/logic.ts
// ============================================================
// Logika MURNI fitur admin: hapus otomatis akun dormant + email
// peringatan/konfirmasi via Resend (Gelombang admin, fitur
// "last change" — worker Edge Function).
//
// File ini SENGAJA tanpa import dan tanpa Deno/global lain: hanya
// Date + Intl. Sintaks TypeScript-nya erasable saja (tanpa enum,
// namespace, atau parameter properties) supaya `node --test` bisa
// me-require() file ini langsung (Node >= 22.18 type stripping)
// dan logika bisa diuji tanpa men-deploy edge function.
// Semua I/O (Supabase, Resend, Deno env) tinggal di index.ts.
//
// Aturan (sesuai spesifikasi koordinator):
// - "Perubahan terakhir" = yang paling baru dari last_activity_at
//   (perubahan data), last_sign_in_at (login), created_at.
// - Kandidat HANYA status='active' dan role != 'admin'. Admin /
//   pemilik DIKECUALIKAN; suspended juga dikecualikan (admin
//   menghapus akun suspended secara manual).
// - Peringatan H-1: tidak aktif >= 6 hari DAN < 7 hari DAN belum
//   pernah diperingatkan (deletion_warning_sent_at IS NULL).
// - Hapus: tidak aktif >= 7 hari.
// - "Hari" dihitung sebagai hari KALENDER di WIB (Asia/Jakarta),
//   bukan 24 jam mentah: akun yang terakhir aktif kemarin pukul
//   23:30 WIB sudah dihitung 1 hari tidak aktif keesokan paginya.
//   Batas hari berganti tepat tengah malam WIB.
// ============================================================

export const APP_TIMEZONE = 'Asia/Jakarta';
export const WARNING_DAY = 6;
export const DELETE_DAY = 7;
export const RESEND_API_URL = 'https://api.resend.com/emails';
export const RESEND_TIMEOUT_MS = 15_000;

/** Satu baris gabungan profiles + auth.users untuk satu pengguna. */
export interface CleanupUser {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string | null;
  last_activity_at: string | null;
  last_sign_in_at: string | null;
  deletion_warning_sent_at: string | null;
}

export type CleanupAction = 'warn' | 'delete' | 'skip';

export interface Classification {
  action: CleanupAction;
  /** Hari kalender penuh tidak aktif di WIB (-1 bila tanggal tak diketahui). */
  daysInactive: number;
  /** Perubahan terakhir (login atau perubahan data), null bila tak ada. */
  lastChange: Date | null;
  reason: string;
}

export interface CleanupSelection {
  warn: CleanupUser[];
  delete: CleanupUser[];
  /** Pengguna yang diperiksa tetapi tidak masuk warn/delete. */
  skipped: number;
}

export interface CleanupEmail {
  subject: string;
  html: string;
  text: string;
}

/** Tanggal kalender 'YYYY-MM-DD' dari sebuah Date, di zona WIB. */
export function wibDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(d);
}

/**
 * Perubahan terakhir pengguna: yang paling baru dari
 * last_activity_at, last_sign_in_at, created_at.
 * Mengembalikan null bila ketiganya kosong / tidak valid — pemanggil
 * harus memperlakukan pengguna itu sebagai 'skip' (tidak bisa
 * dihitung, jangan ditebak).
 */
export function lastChangeAt(user: CleanupUser): Date | null {
  let best: Date | null = null;
  for (const raw of [user.last_activity_at, user.last_sign_in_at, user.created_at]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}

/**
 * Selisih hari KALENDER di WIB antara lastChange dan now.
 * Kedua tanggal dipotong ke tengah malam WIB dulu, jadi 23:30 WIB
 * kemarin -> 00:30 WIB hari ini = 1 hari, bukan 0.
 */
export function daysInactive(lastChange: Date, now: Date): number {
  const a = Date.parse(wibDateString(lastChange) + 'T00:00:00Z');
  const b = Date.parse(wibDateString(now) + 'T00:00:00Z');
  return Math.floor((b - a) / 86_400_000);
}

/** Tanggal penghapusan = perubahan terakhir + 7 hari kalender. */
export function deletionDate(lastChange: Date): Date {
  return new Date(lastChange.getTime() + DELETE_DAY * 86_400_000);
}

/** '28 November 2026' — format tanggal Indonesia di WIB. */
export function formatTanggalId(d: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: APP_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Klasifikasi satu pengguna pada saat `now`.
 * Urutan pengecekan penting: status/role dulu (pengecualian mutlak),
 * lalu hitung hari, lalu ambang hapus (>= 7) mendahului ambang
 * peringatan (>= 6) — pengguna hari ke-7 yang belum sempat
 * diperingatkan langsung masuk 'delete', bukan 'warn'.
 */
export function classifyUser(user: CleanupUser, now: Date): Classification {
  if (user.status !== 'active') {
    return { action: 'skip', daysInactive: -1, lastChange: null, reason: 'status-bukan-active' };
  }
  if (user.role === 'admin') {
    return { action: 'skip', daysInactive: -1, lastChange: null, reason: 'admin-dikecualikan' };
  }
  const lastChange = lastChangeAt(user);
  if (!lastChange) {
    return { action: 'skip', daysInactive: -1, lastChange: null, reason: 'tanggal-perubahan-tidak-diketahui' };
  }
  const days = daysInactive(lastChange, now);
  if (days >= DELETE_DAY) {
    return { action: 'delete', daysInactive: days, lastChange, reason: 'tidak-aktif-7-hari' };
  }
  if (days >= WARNING_DAY) {
    if (user.deletion_warning_sent_at) {
      return { action: 'skip', daysInactive: days, lastChange, reason: 'sudah-diperingatkan' };
    }
    return { action: 'warn', daysInactive: days, lastChange, reason: 'tidak-aktif-6-hari' };
  }
  return { action: 'skip', daysInactive: days, lastChange, reason: 'masih-aktif' };
}

/** Pisahkan daftar pengguna menjadi yang diperingatkan / dihapus / dilewati. */
export function selectCandidates(users: CleanupUser[], now: Date): CleanupSelection {
  const warn: CleanupUser[] = [];
  const toDelete: CleanupUser[] = [];
  let skipped = 0;
  for (const user of users) {
    const c = classifyUser(user, now);
    if (c.action === 'warn') warn.push(user);
    else if (c.action === 'delete') toDelete.push(user);
    else skipped++;
  }
  return { warn, delete: toDelete, skipped };
}

/**
 * Email peringatan H-1 (dikirim saat tidak aktif 6 hari).
 * Berisi: tanggal terakhir aktif, tanggal penghapusan (perubahan
 * terakhir + 7 hari), dan cara mempertahankan akun — cukup buka
 * aplikasi / lakukan perubahan apa pun sebelum tanggal itu.
 */
export function warningEmail(user: CleanupUser, lastChange: Date): CleanupEmail {
  const subject = 'Akun MyKeuGuech Anda akan dihapus dalam 1 hari';
  const lastActive = formatTanggalId(lastChange);
  const delDate = formatTanggalId(deletionDate(lastChange));
  const text = [
    'Halo,',
    '',
    `Kami melihat akun MyKeuGuech Anda (${user.email}) sudah tidak ada perubahan selama 6 hari. Terakhir Anda aktif pada ${lastActive}.`,
    '',
    `Bila tidak ada aktivitas, akun Anda akan dihapus otomatis pada ${delDate}, dan seluruh data Anda (transaksi, dompet, dan pengaturan) akan ikut terhapus secara permanen dan tidak bisa dikembalikan.`,
    '',
    'Cara mempertahankan akun Anda:',
    `Cukup buka aplikasi MyKeuGuech dan lakukan perubahan apa pun sebelum ${delDate} — misalnya mencatat transaksi atau mengubah pengaturan. Login saja sudah cukup untuk membatalkan penghapusan ini.`,
    '',
    'Bila Anda memang sudah tidak memakai MyKeuGuech, Anda tidak perlu melakukan apa-apa; akun akan terhapus sendiri sesuai jadwal di atas.',
    '',
    'Salam,',
    'Tim MyKeuGuech',
  ].join('\n');
  const html = [
    '<p>Halo,</p>',
    `<p>Kami melihat akun MyKeuGuech Anda (${escapeHtml(user.email)}) sudah tidak ada perubahan selama 6 hari. Terakhir Anda aktif pada <strong>${escapeHtml(lastActive)}</strong>.</p>`,
    `<p>Bila tidak ada aktivitas, akun Anda akan <strong>dihapus otomatis pada ${escapeHtml(delDate)}</strong>, dan seluruh data Anda (transaksi, dompet, dan pengaturan) akan ikut terhapus secara permanen dan tidak bisa dikembalikan.</p>`,
    '<p><strong>Cara mempertahankan akun Anda:</strong></p>',
    `<p>Cukup buka aplikasi MyKeuGuech dan lakukan perubahan apa pun sebelum <strong>${escapeHtml(delDate)}</strong> — misalnya mencatat transaksi atau mengubah pengaturan. Login saja sudah cukup untuk membatalkan penghapusan ini.</p>`,
    '<p>Bila Anda memang sudah tidak memakai MyKeuGuech, Anda tidak perlu melakukan apa-apa; akun akan terhapus sendiri sesuai jadwal di atas.</p>',
    '<p>Salam,<br>Tim MyKeuGuech</p>',
  ].join('\n');
  return { subject, html, text };
}

/**
 * Email konfirmasi sesudah akun dihapus (dikirim ke alamat email yang
 * dicatat SEBELUM penghapusan — setelah deleteUser, alamat itu sudah
 * tidak ada di database).
 */
export function deletionEmail(user: CleanupUser, lastChange: Date): CleanupEmail {
  const subject = 'Akun MyKeuGuech Anda telah dihapus';
  const lastActive = formatTanggalId(lastChange);
  const text = [
    'Halo,',
    '',
    `Akun MyKeuGuech Anda (${user.email}) telah dihapus karena tidak ada perubahan selama 7 hari. Terakhir Anda aktif pada ${lastActive}.`,
    '',
    'Seluruh data akun Anda (transaksi, dompet, dan pengaturan) ikut terhapus secara permanen dan tidak bisa dikembalikan.',
    '',
    'Bila penghapusan ini keliru — misalnya Anda sebenarnya masih memakai akun ini — silakan hubungi admin MyKeuGuech agar dapat dibantu.',
    '',
    'Salam,',
    'Tim MyKeuGuech',
  ].join('\n');
  const html = [
    '<p>Halo,</p>',
    `<p>Akun MyKeuGuech Anda (${escapeHtml(user.email)}) <strong>telah dihapus</strong> karena tidak ada perubahan selama 7 hari. Terakhir Anda aktif pada <strong>${escapeHtml(lastActive)}</strong>.</p>`,
    '<p>Seluruh data akun Anda (transaksi, dompet, dan pengaturan) ikut terhapus secara permanen dan tidak bisa dikembalikan.</p>',
    '<p>Bila penghapusan ini keliru — misalnya Anda sebenarnya masih memakai akun ini — silakan hubungi admin MyKeuGuech agar dapat dibantu.</p>',
    '<p>Salam,<br>Tim MyKeuGuech</p>',
  ].join('\n');
  return { subject, html, text };
}

/**
 * Body JSON untuk POST https://api.resend.com/emails.
 * `from` WAJIB berasal dari edge secret RESEND_FROM_EMAIL (index.ts)
 * — JANGAN pernah hardcode alamat pengirim di sini.
 */
export function buildResendPayload(
  from: string,
  to: string,
  email: CleanupEmail,
): { from: string; to: string; subject: string; html: string; text: string } {
  return { from, to, subject: email.subject, html: email.html, text: email.text };
}
