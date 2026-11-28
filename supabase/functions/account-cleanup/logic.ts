// supabase/functions/account-cleanup/logic.ts
// ============================================================
// Logika MURNI fitur admin: hapus otomatis akun dormant +
// NOTIFIKASI IN-APP khusus admin (Gelombang admin, fitur
// "last change" — worker Edge Function).
//
// Peringatan H-1 dan konfirmasi hapus semula dikirim via email;
// sejak 2026-11-28 jalur email DIBATALKAN Liandi dan
// diganti notifikasi in-app yang hanya terlihat oleh admin
// (ditulis edge function ke tabel admin_notifications,
// dibaca panel admin lewat RPC get_admin_notifications).
// File ini membangun isi notifikasi itu (title + body, Bahasa
// Indonesia ramah awam); penulisan ke tabel tinggal di index.ts.
//
// File ini SENGAJA tanpa import dan tanpa Deno/global lain: hanya
// Date + Intl. Sintaks TypeScript-nya erasable saja (tanpa enum,
// namespace, atau parameter properties) supaya `node --test` bisa
// me-require() file ini langsung (Node >= 22.18 type stripping)
// dan logika bisa diuji tanpa men-deploy edge function.
// Semua I/O (Supabase, Deno env) tinggal di index.ts.
//
// Aturan (sesuai spesifikasi koordinator):
// - "Perubahan terakhir" = yang paling baru dari last_activity_at
//   (perubahan data), last_sign_in_at (login), created_at.
// - Kandidat HANYA status='active' dan role != 'admin'. Admin /
//   pemilik DIKECUALIKAN; suspended juga dikecualikan (admin
//   menghapus akun suspended secara manual).
// - Peringatan H-1: tidak aktif >= 6 hari DAN < 7 hari DAN belum
//   pernah diperingatkan (deletion_warning_sent_at IS NULL).
//   deletion_warning_sent_at kini berarti "peringatan (notifikasi
//   in-app) sudah dibuat", bukan lagi "email sudah terkirim".
// - Hapus: tidak aktif >= 7 hari DAN sudah pernah diperingatkan
//   (deletion_warning_sent_at terisi). Pengguna hari ke-7+ yang
//   BELUM sempat diperingatkan — mis. insert notifikasi gagal di
//   hari ke-6 — mendapat peringatan TERLAMBAT dulu dan baru
//   dihapus pada run berikutnya (paling cepat sehari sesudah
//   peringatan), supaya tidak ada akun yang dihapus tanpa pernah
//   diperingatkan. Konsekuensinya: bila insert notifikasi selalu
//   gagal, flag tidak pernah diset, dan tidak ada akun yang
//   dihapus — fail-closed, bukan hapus diam-diam.
// - "Hari" dihitung sebagai hari KALENDER di WIB (Asia/Jakarta),
//   bukan 24 jam mentah: akun yang terakhir aktif kemarin pukul
//   23:30 WIB sudah dihitung 1 hari tidak aktif keesokan paginya.
//   Batas hari berganti tepat tengah malam WIB.
// ============================================================

export const APP_TIMEZONE = 'Asia/Jakarta';
export const WARNING_DAY = 6;
export const DELETE_DAY = 7;

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

/** Isi satu baris admin_notifications (type + title + body). */
export interface AdminNotification {
  type: 'deletion_warning' | 'deletion_done';
  title: string;
  body: string;
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

/**
 * Tanggal run harian berikutnya (+24 jam) — dipakai sebagai tanggal
 * penghapusan pada peringatan TERLAMBAT (pengguna sudah >= 7 hari
 * tapi belum pernah diperingatkan): penghapusannya terjadi pada run
 * besok, jadi tanggal yang dijanjikan di notifikasi adalah besok.
 */
export function nextDayDate(d: Date): Date {
  return new Date(d.getTime() + 86_400_000);
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

/**
 * Klasifikasi satu pengguna pada saat `now`.
 * Urutan pengecekan penting: status/role dulu (pengecualian mutlak),
 * lalu hitung hari. Ambang hapus (>= 7) mensyaratkan peringatan
 * sudah dibuat (deletion_warning_sent_at terisi) — pengguna hari
 * ke-7+ yang belum sempat diperingatkan masuk 'warn' (peringatan
 * terlambat), bukan 'delete', supaya tidak ada yang dihapus tanpa
 * pernah diperingatkan.
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
    if (!user.deletion_warning_sent_at) {
      return { action: 'warn', daysInactive: days, lastChange, reason: 'tidak-aktif-7-hari-belum-diperingatkan' };
    }
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
 * Notifikasi peringatan H-1 untuk admin (dibuat saat pengguna
 * tidak aktif 6 hari, atau terlambat bila pengguna sudah >= 7
 * hari tapi belum pernah diperingatkan). `daysInactive` dan
 * `delDate` diparameterisasi supaya isi notifikasi jujur pada
 * kasus terlambat: jumlah hari yang disebut adalah hari
 * sebenarnya, dan tanggal penghapusan adalah tanggal run
 * berikutnya (besok), bukan tanggal yang sudah lewat.
 * Notifikasi ini ditujukan ke ADMIN (bukan ke pengguna yang
 * bersangkutan) — karena itu menyebut email target dan cara
 * pengguna mempertahankan akunnya.
 */
export function warningNotification(
  user: CleanupUser,
  lastChange: Date,
  daysInactive: number,
  delDate: Date,
): AdminNotification {
  const lastActive = formatTanggalId(lastChange);
  const delDateStr = formatTanggalId(delDate);
  return {
    type: 'deletion_warning',
    title: `Akun ${user.email} akan dihapus besok`,
    body: [
      `Akun ${user.email} sudah ${daysInactive} hari tidak ada perubahan. Terakhir aktif pada ${lastActive}.`,
      '',
      `Bila tidak ada aktivitas, akun ini akan dihapus otomatis pada ${delDateStr}, dan seluruh datanya (transaksi, dompet, dan pengaturan) akan ikut terhapus secara permanen dan tidak bisa dikembalikan.`,
      '',
      `Pengguna masih bisa mempertahankan akunnya dengan membuka aplikasi MyKeuGuech dan melakukan perubahan apa pun sebelum ${delDateStr} — misalnya mencatat transaksi atau mengubah pengaturan. Login saja sudah cukup untuk membatalkan penghapusan ini.`,
    ].join('\n'),
  };
}

/**
 * Notifikasi konfirmasi sesudah akun dihapus (dibuat SETELAH
 * admin.deleteUser sukses; target_email dicatat SEBELUM
 * penghapusan karena setelah itu alamat sudah tidak ada di
 * database). Baris ini sengaja bertahan di admin_notifications
 * sebagai bukti penghapusan.
 */
export function deletionNotification(user: CleanupUser, lastChange: Date): AdminNotification {
  const lastActive = formatTanggalId(lastChange);
  return {
    type: 'deletion_done',
    title: `Akun ${user.email} sudah dihapus`,
    body: [
      `Akun ${user.email} sudah dihapus otomatis karena tidak ada perubahan selama 7 hari. Terakhir aktif pada ${lastActive}.`,
      '',
      'Seluruh data akun (transaksi, dompet, dan pengaturan) ikut terhapus secara permanen dan tidak bisa dikembalikan.',
      '',
      'Bila penghapusan ini keliru — misalnya pengguna sebenarnya masih memakai akun ini — akun tidak bisa dipulihkan; pengguna perlu mendaftar ulang.',
    ].join('\n'),
  };
}
