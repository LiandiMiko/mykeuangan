// @depends-on: ui-state.js
/* global Swal, callServer, escapeHtmlJS, renderHtml, getSwalClass, toUserErrorMessage, t */
/* ============================================================
   ADMIN PANEL & TELEGRAM PAIRING
   ============================================================ */
(function (root) {
  'use strict';

  let adminUsersCache = [];
  let adminCurrentUserId = '';

  // --- Perubahan Terakhir (aktivitas pengguna) ----------------------
  // Kontrak RPC get_admin_user_activity: days_inactive (int) dan
  // deletion_due_in_days (int). Aktif = days_inactive < 4; Dormant =
  // days_inactive >= 4; penghapusan dalam 7 - days_inactive hari.
  const ADMIN_DORMANT_AFTER_DAYS = 4;
  const ADMIN_DELETION_AFTER_DAYS = 7;
  const ADMIN_JUST_NOW_MINUTES = 60;

  // t() tinggal di src/i18n.html; bila modul dimuat sendiri (tes vm
  // tanpa i18n), pakai key-nya apa adanya supaya tidak crash.
  function admT(key) {
    return (typeof t === 'function') ? t(key) : key;
  }

  // `now` boleh Date dari realm mana pun (tes vm memakai Date konteks
  // luar) — jangan instanceof Date, cukup duck-type getTime().
  function adminRefDate(now) {
    if (now && typeof now.getTime === 'function' && !Number.isNaN(now.getTime())) return now;
    return new Date();
  }

  // Selisih hari kalender LOKAL (bukan UTC) antara timestamp server
  // dan `now` — penting di WIB: 00:30 WIB masih "hari ini" walau
  // di UTC masih kemarin. `now` opsional (default: sekarang) supaya
  // bisa diuji deterministik, termasuk batas tengah malam WIB.
  function adminDayDiffFromNow(ts, now) {
    if (!ts) return null;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    const ref = adminRefDate(now);
    const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const b = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate());
    return Math.round((b - a) / 86400000);
  }

  function formatLastChangeDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // { date: 'YYYY-MM-DD' | '', rel: 'baru saja' | 'hari ini' |
  //   'kemarin' | 'N hari lalu' | 'Belum ada perubahan' }
  function formatLastChangeRelative(ts, now) {
    if (!ts) return { date: '', rel: admT('adm.no_change') };
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return { date: String(ts).slice(0, 10), rel: admT('adm.no_change') };
    const ref = adminRefDate(now);
    const diff = adminDayDiffFromNow(ts, ref);
    if (diff === null) return { date: formatLastChangeDate(ts), rel: admT('adm.no_change') };
    if (diff < 0) return { date: formatLastChangeDate(ts), rel: admT('adm.just_now') };
    if (diff === 0) {
      const mins = Math.max(0, Math.round((ref.getTime() - d.getTime()) / 60000));
      return { date: formatLastChangeDate(ts), rel: mins < ADMIN_JUST_NOW_MINUTES ? admT('adm.just_now') : admT('adm.today') };
    }
    if (diff === 1) return { date: formatLastChangeDate(ts), rel: admT('adm.yesterday') };
    return { date: formatLastChangeDate(ts), rel: diff + ' ' + admT('adm.days_ago') };
  }

  // days_inactive dari RPC bila ada; fallback: hitung dari
  // last_change_at / last_activity_at; null bila tidak ada data.
  function adminDaysInactive(u) {
    if (u && typeof u.days_inactive === 'number' && Number.isFinite(u.days_inactive)) return u.days_inactive;
    const ts = (u && (u.last_change_at || u.last_activity_at)) || null;
    const diff = adminDayDiffFromNow(ts, new Date());
    return diff === null ? null : Math.max(0, diff);
  }

  function classifyAdminActivity(u) {
    const days = adminDaysInactive(u);
    if (days === null) return 'active';
    return days >= ADMIN_DORMANT_AFTER_DAYS ? 'dormant' : 'active';
  }

  // Hanya untuk baris dormant; '' untuk yang aktif / tanpa data.
  function deletionCountdownText(u) {
    if (classifyAdminActivity(u) !== 'dormant') return '';
    const due = (u && typeof u.deletion_due_in_days === 'number' && Number.isFinite(u.deletion_due_in_days))
      ? Math.max(0, Math.floor(u.deletion_due_in_days))
      : Math.max(0, ADMIN_DELETION_AFTER_DAYS - (adminDaysInactive(u) || 0));
    if (due <= 0) return admT('adm.delete_today');
    return admT('adm.delete_in') + ' ' + due + ' ' + admT('adm.days');
  }

  // Blok "Perubahan Terakhir" — dipakai tabel desktop & kartu mobile.
  // Semua nilai server lewat escapeHtmlJS; label lewat admT().
  function buildAdminActivityHtml(u) {
    const last = formatLastChangeRelative(u && u.last_change_at);
    const dormant = classifyAdminActivity(u) === 'dormant';
    const countdown = deletionCountdownText(u);
    let html = '<p class="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">' + escapeHtmlJS(last.date || '-') + '</p>'
      + '<p class="text-[11px] text-slate-500 dark:text-slate-400">' + escapeHtmlJS(last.rel) + '</p>';
    if (dormant) {
      html += '<p class="mt-1"><span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">' + escapeHtmlJS(admT('adm.dormant')) + '</span></p>';
    }
    if (countdown) {
      html += '<p class="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">' + escapeHtmlJS(countdown) + '</p>';
    }
    return html;
  }

  // Fungsi murni (tanpa DOM) supaya filter + pencarian bisa diuji:
  // filter 'active_activity'/'dormant' digabung dengan pencarian teks.
  function filterAdminUsers(users, search, filter) {
    const q = String(search || '').trim().toLocaleLowerCase();
    return (users || []).filter((u) => {
      if (q && !`${u.display_name || ''} ${u.email || ''}`.toLocaleLowerCase().includes(q)) return false;
      if ((filter === 'active' || filter === 'suspended') && u.status !== filter) return false;
      if ((filter === 'admin' || filter === 'user') && u.role !== filter) return false;
      if (filter === 'active_activity' && classifyAdminActivity(u) !== 'active') return false;
      if (filter === 'dormant' && classifyAdminActivity(u) !== 'dormant') return false;
      return true;
    });
  }

  async function loadAdminData() {
    const tbody = document.getElementById('adm-user-table');
    const mobileList = document.getElementById('adm-user-mobile-list');
    const setAdminText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    };
    if (tbody) renderHtml(tbody, '<tr><td colspan="6" class="px-6 py-8 text-center text-slate-500 dark:text-slate-400">Memuat data pengguna...</td></tr>');
    if (mobileList) renderHtml(mobileList, '<div class="p-6 text-center text-xs text-slate-500 dark:text-slate-400">Memuat data pengguna...</div>');

    try {
      const data = await callServer('api_getAdminData');
      if (!data) throw new Error('Supabase tidak mengembalikan data panel admin.');
      adminUsersCache = data.users || [];
      adminCurrentUserId = data.currentUserId || '';

      const s = data.stats || {};
      setAdminText('adm-total-users', s.totalUsers || 0);
      setAdminText('adm-active-users', s.activeUsers || 0);
      setAdminText('adm-suspended-users', s.suspendedUsers || 0);
      setAdminText('adm-total-chats', s.totalTelegramChats || 0);
      renderAdminAuditLogs(data.auditLogs || []);
      renderAdminNotifications(data.notifications || [], data.notificationsError);
      filterAdminUsersTable();
      return true;
    } catch (err) {
      console.error('loadAdminData error:', err);
      const errMsg = escapeHtmlJS(toUserErrorMessage(err));
      renderAdminNotifications([], true);
      if (tbody) {
        renderHtml(tbody, `
          <tr>
            <td colspan="6" class="px-6 py-8 text-center text-rose-600 dark:text-rose-400">
              <p>Gagal memuat data pengguna: ${errMsg}</p>
              <button type="button" data-action="loadAdminData" class="mt-3 min-h-[44px] px-3 font-bold underline cursor-pointer">Coba lagi</button>
            </td>
          </tr>`);
      }
      if (mobileList) {
        renderHtml(mobileList, `
          <div class="p-6 text-center text-xs text-rose-600 dark:text-rose-400">
            <p>Gagal memuat data pengguna: ${errMsg}</p>
            <button type="button" data-action="loadAdminData" class="mt-2 min-h-[44px] px-3 font-bold underline cursor-pointer">Coba lagi</button>
          </div>`);
      }
      return false;
    }
  }

  function buildAdminUserMeta(u, mobileBtnCls) {
    const isSuspended = u.status === 'suspended';
    const statusBadge = isSuspended
      ? '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">Suspended</span>'
      : '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Active</span>';
    const roleBadge = u.role === 'admin'
      ? '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400">Admin</span>'
      : '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">User</span>';

    const nextStatus = isSuspended ? 'active' : 'suspended';
    const statusBtnColor = isSuspended ? 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-800' : 'text-rose-600 dark:text-rose-400 hover:text-rose-700';
    const safeId = escapeHtmlJS(u.id);
    const padCls = mobileBtnCls ? 'min-h-11 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs ' : 'min-h-[44px] px-2 ';
    const actions = u.id === adminCurrentUserId
      ? '<span class="text-xs text-slate-500 dark:text-slate-400">Akun Anda</span>'
      : `<button type="button" data-admin-action="status" data-user-id="${safeId}" data-value="${nextStatus}" class="${padCls}font-bold cursor-pointer ${statusBtnColor}">${isSuspended ? 'Aktifkan' : 'Suspend'}</button>
         <button type="button" data-admin-action="role" data-user-id="${safeId}" data-value="${u.role === 'admin' ? 'user' : 'admin'}" class="${padCls}font-bold text-blue-700 dark:text-blue-400 hover:text-blue-800 cursor-pointer">${u.role === 'admin' ? 'Jadikan User' : 'Jadikan Admin'}</button>
         <button type="button" data-admin-action="password" data-user-id="${safeId}" class="${padCls}font-bold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white cursor-pointer">Atur Password</button>
         <button type="button" data-admin-action="unlink_telegram" data-user-id="${safeId}" class="${padCls}font-bold text-amber-700 dark:text-amber-400 hover:text-amber-800 cursor-pointer">Putus Telegram</button>
         <button type="button" data-admin-action="delete" data-user-id="${safeId}" class="${padCls}font-bold text-rose-700 dark:text-rose-400 hover:text-rose-800 cursor-pointer">Hapus Akun</button>`;
    return { statusBadge, roleBadge, actions };
  }

  function buildAdminUserRowHtml(u) {
    const m = buildAdminUserMeta(u, false);
    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td class="px-6 py-4">
          <p class="font-bold text-slate-800 dark:text-white">${escapeHtmlJS(u.display_name || 'User')}</p>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtmlJS(u.email)}</p>
        </td>
        <td class="px-6 py-4">${m.roleBadge}</td>
        <td class="px-6 py-4">${m.statusBadge}</td>
        <td class="px-6 py-4 text-slate-500 dark:text-slate-400 tabular-nums">${escapeHtmlJS(String(u.created_at || '').slice(0, 10))}</td>
        <td class="px-6 py-4">${buildAdminActivityHtml(u)}</td>
        <td class="px-6 py-4 text-center"><div class="flex items-center justify-center gap-3">${m.actions}</div></td>
      </tr>`;
  }

  function buildAdminUserMobileCardHtml(u) {
    const m = buildAdminUserMeta(u, true);
    return `
      <div class="p-4 space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="font-bold text-sm text-slate-800 dark:text-white truncate" title="${escapeHtmlJS(u.display_name || 'User')}">${escapeHtmlJS(u.display_name || 'User')}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate" title="${escapeHtmlJS(u.email)}">${escapeHtmlJS(u.email)}</p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">${m.roleBadge}${m.statusBadge}</div>
        </div>
        <p class="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">Terdaftar: ${escapeHtmlJS(String(u.created_at || '').slice(0, 10) || '-')}</p>
        <div>
          <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">${escapeHtmlJS(admT('adm.last_change'))}</p>
          ${buildAdminActivityHtml(u)}
        </div>
        <div class="flex flex-wrap gap-2">${m.actions}</div>
      </div>`;
  }

  function bindAdminActionButtons(container, usersById) {
    if (!container) return;
    container.querySelectorAll('[data-admin-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const user = usersById.get(button.dataset.userId);
        if (!user) return;
        if (button.dataset.adminAction === 'status') toggleUserStatus(user.id, button.dataset.value);
        else if (button.dataset.adminAction === 'role') toggleUserRole(user.id, button.dataset.value);
        else if (button.dataset.adminAction === 'password') resetUserPassword(user.id, user.email || '');
        else if (button.dataset.adminAction === 'unlink_telegram') adminUnlinkUserTelegram(user.id, user.email || '');
        else if (button.dataset.adminAction === 'delete') adminDeleteUserAccount(user.id, user.email || '');
      });
    });
  }

  function filterAdminUsersTable() {
    const tbody = document.getElementById('adm-user-table');
    const mobileList = document.getElementById('adm-user-mobile-list');
    const countEl = document.getElementById('adm-user-count');
    if (!tbody) return;

    const search = ((document.getElementById('admSearchInput') || {}).value || '').trim().toLocaleLowerCase();
    const filter = (document.getElementById('admFilterStatus') || {}).value || '';
    const filtered = filterAdminUsers(adminUsersCache, search, filter);

    if (countEl) countEl.textContent = String(filtered.length);
    if (!filtered.length) {
      renderHtml(tbody, '<tr><td colspan="6" class="px-6 py-8 text-center text-slate-500 dark:text-slate-400">Tidak ada pengguna yang cocok.</td></tr>');
      if (mobileList) renderHtml(mobileList, '<div class="p-6 text-center text-xs text-slate-500 dark:text-slate-400">Tidak ada pengguna yang cocok.</div>');
      return;
    }

    renderHtml(tbody, filtered.map(buildAdminUserRowHtml).join(''));
    if (mobileList) renderHtml(mobileList, filtered.map(buildAdminUserMobileCardHtml).join(''));
    const usersById = new Map(adminUsersCache.map((user) => [user.id, user]));
    bindAdminActionButtons(tbody, usersById);
    bindAdminActionButtons(mobileList, usersById);
  }

  async function confirmAndApplyAdminChange(opts) {
    const confirm = await Swal.fire({
      title: opts.title,
      text: opts.text,
      icon: opts.icon,
      showCancelButton: true,
      confirmButtonText: opts.confirmText,
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!confirm.isConfirmed) return;
    try {
      await callServer(opts.apiMethod, opts.uid, opts.value);
      if (!await loadAdminData()) {
        await Swal.fire({
          icon: 'warning',
          title: opts.reloadWarningTitle,
          text: 'Daftar pengguna gagal dimuat ulang. Tekan Segarkan Data untuk mencoba lagi.',
          customClass: { popup: getSwalClass() }
        });
        return;
      }
      Swal.fire({ icon: 'success', title: 'Berhasil', text: opts.successText, timer: 1500, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: toUserErrorMessage(e), customClass: { popup: getSwalClass() } });
    }
  }

  function toggleUserStatus(uid, status) {
    const actionText = status === 'suspended' ? 'menonaktifkan (suspend)' : 'mengaktifkan kembali';
    return confirmAndApplyAdminChange({
      title: 'Konfirmasi Status',
      text: `Apakah Anda yakin ingin ${actionText} akun ini?`,
      icon: 'warning',
      confirmText: 'Ya, Lanjutkan',
      apiMethod: 'api_setUserStatus',
      uid,
      value: status,
      reloadWarningTitle: 'Status tersimpan',
      successText: 'Status pengguna telah diperbarui.'
    });
  }

  function toggleUserRole(uid, role) {
    return confirmAndApplyAdminChange({
      title: 'Konfirmasi Peran',
      text: `Ubah hak akses pengguna ini menjadi ${role.toUpperCase()}?`,
      icon: 'question',
      confirmText: 'Ubah Role',
      apiMethod: 'api_setUserRole',
      uid,
      value: role,
      reloadWarningTitle: 'Role tersimpan',
      successText: 'Role pengguna telah diperbarui.'
    });
  }

  // T3: bila opts.requireCurrent, minta password lama juga (ganti password
  // sendiri). Reset password oleh admin (resetUserPassword) tidak memakai
  // opsi itu — admin tidak tahu password lama pengguna dan tidak boleh
  // diminta memasukkannya.
  // Wave 3.1 / S5 — pakai validator bersama (web/password-policy.js);
  // jatuh kembali ke cek panjang saja bila file policy belum dimuat.
  // Namanya dibedakan dari checkPasswordPolicy di supabase-auth.js agar
  // tidak tertukar — keduanya memanggil validator yang sama.
  function checkAdminPasswordPolicy(pass, email) {
    const pol = (window.__mkFeat && window.__mkFeat.passwordPolicy) || window.__mkPasswordPolicy;
    if (pol && typeof pol.validatePassword === 'function') {
      const res = pol.validatePassword(pass, { email, lang: 'id' });
      return res.ok ? '' : (res.errors[0] && res.errors[0].message) || '';
    }
    if (typeof pass !== 'string' || pass.length < 8 || pass.length > 128) {
      return 'Password harus terdiri dari 8 sampai 128 karakter.';
    }
    return '';
  }

  async function promptNewPassword(title, opts) {
    const requireCurrent = Boolean(opts && opts.requireCurrent);
    const { value: result } = await Swal.fire({
      title,
      html: `
        <div class="text-left space-y-3">
          ${requireCurrent ? `
          <div>
            <label for="admin-current-password" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Password lama</label>
            <input id="admin-current-password" type="password" class="swal2-input" style="margin:0;width:100%" autocomplete="current-password" placeholder="Password akun saat ini">
          </div>` : ''}
          <div>
            <label for="admin-new-password" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Password baru</label>
            <input id="admin-new-password" type="password" class="swal2-input" style="margin:0;width:100%" autocomplete="new-password" minlength="8" placeholder="Minimal 8 karakter">
          </div>
          <div>
            <label for="admin-confirm-password" class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Ulangi password</label>
            <input id="admin-confirm-password" type="password" class="swal2-input" style="margin:0;width:100%" autocomplete="new-password" minlength="8" placeholder="Ketik ulang password">
          </div>
          ${requireCurrent ? `<p class="text-[11px] text-slate-500 dark:text-slate-400">Setelah password diganti, semua sesi di perangkat lain akan dicabut; sesi di perangkat ini tetap berjalan.</p>` : ''}
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Simpan Password',
      cancelButtonText: t('btn.batal'),
      focusConfirm: false,
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const oldPassword = requireCurrent ? document.getElementById('admin-current-password').value : '';
        const newPassword = document.getElementById('admin-new-password').value;
        const confirmPassword = document.getElementById('admin-confirm-password').value;
        if (requireCurrent && !oldPassword) {
          Swal.showValidationMessage('Masukkan password lama Anda saat ini.');
          return false;
        }
        const policyError = checkAdminPasswordPolicy(newPassword, opts && opts.email);
        if (policyError) {
          Swal.showValidationMessage(policyError);
          return false;
        }
        if (newPassword !== confirmPassword) {
          Swal.showValidationMessage('Konfirmasi password tidak cocok.');
          return false;
        }
        return requireCurrent ? { oldPassword, newPassword } : newPassword;
      }
    });
    return result;
  }

  async function changeOwnPassword() {
    const result = await promptNewPassword('Ganti password akun Anda', { requireCurrent: true });
    if (!result) return;
    try {
      await callServer('api_updateOwnPassword', result.oldPassword, result.newPassword);
      await Swal.fire({ icon: 'success', title: 'Password berhasil diperbarui. Sesi di perangkat lain telah dicabut.', customClass: { popup: getSwalClass() } });
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'Gagal mengganti password', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
    }
  }

  function renderAdminAuditLogs(logs) {
    const box = document.getElementById('adm-audit-log-list');
    if (!box) return;
    if (!Array.isArray(logs) || !logs.length) {
      renderHtml(box, '<p class="text-xs text-slate-500 dark:text-slate-400 py-2">Belum ada catatan aktivitas admin atau migrasi audit belum dijalankan.</p>');
      return;
    }
    const html = logs.map((item) => {
      const ts = escapeHtmlJS(String(item.created_at || '').slice(0, 16).replace('T', ' '));
      return `<div class="py-2.5 flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0 text-xs">
        <div class="min-w-0">
          <p class="font-bold text-slate-800 dark:text-slate-100 truncate" title="${escapeHtmlJS(item.action || '-')} → ${escapeHtmlJS(item.target_email || item.target_user_id || '-')}">${escapeHtmlJS(item.action || '-')} &rarr; ${escapeHtmlJS(item.target_email || item.target_user_id || '-')}</p>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate" title="Oleh: ${escapeHtmlJS(item.actor_email || 'Admin')}">Oleh: ${escapeHtmlJS(item.actor_email || 'Admin')}</p>
        </div>
        <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums shrink-0">${ts}</span>
      </div>`;
    }).join('');
    renderHtml(box, html);
  }

  // --- Notifikasi admin (auto-hapus akun dormant) ----------------------
  // Kontrak RPC get_admin_notifications: id, type
  // ('deletion_warning'|'deletion_done'), target_user_id, target_email,
  // title, body, created_at, read_at. Belum dibaca = read_at null.
  function countUnreadAdminNotifications(list) {
    return (list || []).filter((n) => n && !n.read_at).length;
  }

  // Tanggal hapus terjadwal untuk peringatan: peringatan dibuat hari
  // ke-6 tidak aktif, penghapusan jatuh hari ke-7 — jadi created_at +
  // 1 hari kalender LOKAL. '' bila created_at tidak bisa diparse
  // (jangan mengarang tanggal: pemanggil hanya menampilkan baris ini
  // bila tanggalnya ada; info dormant lain sudah ada di title/body).
  function adminNotificationDeletionDate(n) {
    if (!n || !n.created_at) return '';
    const d = new Date(n.created_at);
    if (Number.isNaN(d.getTime())) return '';
    const due = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return formatLastChangeDate(due);
  }

  // Fungsi murni (tanpa DOM) supaya bisa diuji: title + body + email
  // target + waktu dibuat + info dormant. Semua nilai server lewat
  // escapeHtmlJS; semua label lewat admT().
  function buildAdminNotificationHtml(n) {
    const unread = !n.read_at;
    const isWarning = n.type === 'deletion_warning';
    const typeLabel = isWarning ? admT('adm.notif_warning') : admT('adm.notif_deleted');
    const typeBadgeCls = isWarning
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    const deleteOn = isWarning ? adminNotificationDeletionDate(n) : '';
    let html = '<div class="py-3.5' + (unread ? ' -mx-3 sm:-mx-4 px-3 sm:px-4 rounded-xl bg-rose-50/60 dark:bg-rose-500/5 border-l-4 border-rose-500' : '') + '">'
      + '<div class="flex items-start justify-between gap-2">'
      + '<p class="font-bold text-sm text-slate-800 dark:text-white min-w-0">' + escapeHtmlJS(n.title || '-') + '</p>'
      + '<div class="flex items-center gap-1.5 shrink-0">'
      + (unread ? '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-600 text-white">' + escapeHtmlJS(admT('adm.notif_new')) + '</span>' : '')
      + '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold ' + typeBadgeCls + '">' + escapeHtmlJS(typeLabel) + '</span>'
      + '</div></div>'
      + '<p class="text-xs text-slate-600 dark:text-slate-300 mt-1">' + escapeHtmlJS(n.body || '') + '</p>'
      + '<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">' + escapeHtmlJS(n.target_email || '-') + ' &middot; ' + escapeHtmlJS(formatLastChangeDate(n.created_at) || '-') + '</p>';
    if (deleteOn) {
      html += '<p class="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">' + escapeHtmlJS(admT('adm.notif_delete_on')) + ' ' + escapeHtmlJS(deleteOn) + '</p>';
    }
    if (unread) {
      html += '<button type="button" data-admin-notif-read data-notif-id="' + escapeHtmlJS(String(n.id || '')) + '" class="mt-2 min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">' + escapeHtmlJS(admT('adm.notif_mark_read')) + '</button>';
    }
    return html + '</div>';
  }

  function renderAdminNotifications(notifications, failed) {
    const list = document.getElementById('adm-notif-list');
    const badge = document.getElementById('adm-notif-unread-count');
    const unread = countUnreadAdminNotifications(notifications);
    if (badge) {
      badge.textContent = String(unread);
      badge.classList.toggle('hidden', unread === 0);
    }
    if (!list) return;
    if (failed) {
      renderHtml(list, '<p class="text-xs text-rose-600 dark:text-rose-400 py-3">' + escapeHtmlJS(admT('adm.notif_load_failed')) + '</p>');
      return;
    }
    if (!Array.isArray(notifications) || !notifications.length) {
      renderHtml(list, '<p class="text-xs text-slate-500 dark:text-slate-400 py-3">' + escapeHtmlJS(admT('adm.notif_empty')) + '</p>');
      return;
    }
    renderHtml(list, notifications.map(buildAdminNotificationHtml).join(''));
    bindAdminNotificationButtons(list);
  }

  function bindAdminNotificationButtons(container) {
    if (!container) return;
    container.querySelectorAll('[data-admin-notif-read]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.notifId;
        if (!id) return;
        button.disabled = true;
        try {
          await callServer('api_markAdminNotificationRead', id);
          // Muat ulang seluruh panel (sederhana & andal): lencana
          // belum dibaca + daftar ikut terbarui.
          await loadAdminData();
        } catch (err) {
          button.disabled = false;
          Swal.fire({ icon: 'error', title: 'Gagal', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
        }
      });
    });
  }

  async function adminUnlinkUserTelegram(uid, email) {
    const conf = await Swal.fire({
      icon: 'warning',
      title: 'Putus Tautan Telegram?',
      text: `Putuskan koneksi bot Telegram untuk ${email || uid}?`,
      showCancelButton: true,
      confirmButtonText: 'Ya, Putuskan',
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    });
    if (!conf.isConfirmed) return;
    try {
      await callServer('api_adminUnlinkTelegram', uid);
      await loadAdminData();
      Swal.fire({ icon: 'success', title: 'Tautan Telegram Diputus', timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: toUserErrorMessage(e), customClass: { popup: getSwalClass() } });
    }
  }

  async function adminDeleteUserAccount(uid, email) {
    const conf = await Swal.fire({
      icon: 'warning',
      title: 'Hapus Akun Pengguna?',
      html: `<p class="text-xs text-slate-600 dark:text-slate-300 text-left">Seluruh data milik <strong>${escapeHtmlJS(email || uid)}</strong> akan dihapus permanen. Ketik <strong>HAPUS</strong> untuk konfirmasi.</p>`,
      input: 'text',
      inputPlaceholder: 'HAPUS',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: 'Hapus Permanen',
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      preConfirm: (val) => {
        const token = String(val || '').trim().toUpperCase();
        if (!['HAPUS', 'DELETE'].includes(token)) {
          Swal.showValidationMessage('Ketik HAPUS terlebih dahulu.');
          return false;
        }
        return token;
      }
    });
    if (!conf.isConfirmed || !conf.value) return;
    try {
      await callServer('api_adminDeleteUser', uid, conf.value);
      await loadAdminData();
      Swal.fire({ icon: 'success', title: 'Akun Pengguna Dihapus', timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal Menghapus', text: toUserErrorMessage(e), customClass: { popup: getSwalClass() } });
    }
  }

  async function resetUserPassword(uid, email) {
    const password = await promptNewPassword(`Atur password untuk ${escapeHtmlJS(email)}`, { email });
    if (!password) return;
    try {
      await callServer('api_adminSetPassword', uid, password);
      await Swal.fire({ icon: 'success', title: 'Password pengguna berhasil diatur ulang.', customClass: { popup: getSwalClass() } });
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'Gagal mengatur password', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
    }
  }

  // --- Bot Telegram Saya (Gelombang 2.2: bring your own bot) ----------------
  // Satu pintu masuk: bila pengguna belum memasang bot personal, tampilkan
  // panduan BotFather + form token; bila sudah, tampilkan status bot +
  // kode pairing OTP untuk botnya sendiri.
  async function openTelegramPairingModal() {
    try {
      Swal.fire({
        title: 'Memuat Pengaturan Bot...',
        allowOutsideClick: false,
        customClass: { popup: getSwalClass() },
        didOpen: () => Swal.showLoading()
      });
      const status = await callServer('api_getTelegramBotStatus').catch(() => ({ connected: false }));
      if (!status || !status.connected) return openTelegramBotSetupModal();
      return openTelegramBotPairingModal(status);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
    }
  }

  async function openTelegramBotSetupModal() {
    Swal.fire({
      title: 'Bot Telegram Saya',
      html: `
        <div class="text-left space-y-3 text-sm">
          <p class="text-slate-600 dark:text-slate-300">Mulai sekarang, tiap pengguna memakai <strong>bot Telegram-nya sendiri</strong>. Buat bot Anda sekali lewat <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="font-bold text-blue-700 dark:text-blue-300 underline">@BotFather</a>, lalu hubungkan di sini.</p>
          <div class="p-3 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-xl text-xs space-y-2">
            <p class="font-bold">Cara Membuat Bot (sekali saja):</p>
            <p>1. Buka Telegram, ketuk <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="font-bold underline">@BotFather</a>.</p>
            <p>2. Kirim <code>/newbot</code>, beri nama bot, lalu beri username (harus diakhiri <em>bot</em>). ${escapeHtmlJS(t('tg.botfather_username_note'))}</p>
            <p>3. Salin <strong>token</strong> yang diberikan BotFather (format: angka, titik dua, kode rahasia).</p>
            <p>4. Tempel token di bawah, lalu tekan <strong>Hubungkan Bot Saya</strong>.</p>
          </div>
          <div>
            <label for="tgBotTokenInput" class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Token Bot Anda</label>
            <input id="tgBotTokenInput" type="password" autocomplete="off" placeholder="123456789:AAE..." class="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono" />
            <p class="text-[11px] text-slate-500 mt-1">Token dikirim sekali ke server, divalidasi, lalu disimpan terenkripsi. Token tidak pernah ditampilkan lagi dan tidak tersimpan di perangkat ini.</p>
          </div>
          <button type="button" id="btnConnectTgBot" class="w-full min-h-[44px] px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-colors">
            <i class="ph ph-plugs-connected" aria-hidden="true"></i> Hubungkan Bot Saya
          </button>
        </div>`,
      confirmButtonText: 'Nanti Saja',
      showCloseButton: true,
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        const input = document.getElementById('tgBotTokenInput');
        const btn = document.getElementById('btnConnectTgBot');
        if (input) input.focus();
        if (btn) {
          btn.addEventListener('click', async () => {
            const token = input ? input.value.trim() : '';
            if (!token) {
              Swal.showValidationMessage('Tempel token bot dari @BotFather terlebih dahulu.');
              return;
            }
            try {
              Swal.fire({
                title: 'Menghubungkan Bot...',
                text: 'Token sedang divalidasi ke Telegram.',
                allowOutsideClick: false,
                customClass: { popup: getSwalClass() },
                didOpen: () => Swal.showLoading()
              });
              const res = await callServer('api_connectTelegramBot', token);
              await Swal.fire({
                icon: 'success',
                title: 'Bot Terhubung!',
                text: `Bot Anda @${res && res.bot_username ? res.bot_username : ''} sudah terhubung. Lanjutkan dengan kode pairing di bawah.`,
                customClass: { popup: getSwalClass() }
              });
              return openTelegramPairingModal();
            } catch (err) {
              Swal.fire({ icon: 'error', title: 'Gagal Menghubungkan', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
            }
          });
        }
      }
    });
  }

  async function openTelegramBotPairingModal(status) {
    try {
      Swal.fire({
        title: 'Membuat Kode Pairing...',
        allowOutsideClick: false,
        customClass: { popup: getSwalClass() },
        didOpen: () => Swal.showLoading()
      });

      const otp = await callServer('api_generateTelegramOTP');
      const linkCmd = `/link ${otp}`;
      const botName = status && status.bot_username ? `@${status.bot_username}` : 'bot Anda';
      const since = status && status.created_at ? String(status.created_at).slice(0, 10) : '';
      Swal.fire({
        title: 'Hubungkan Bot Telegram',
        html: `
          <div class="text-left space-y-3 text-sm">
            <div class="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs flex items-center justify-between gap-2">
              <span><span class="font-bold">Bot Anda: ${escapeHtmlJS(botName)}</span>${since ? `<br>Terhubung sejak ${escapeHtmlJS(since)}` : ''}</span>
              <span class="shrink-0 px-2 py-1 rounded-full bg-emerald-600 text-white font-bold">Terhubung</span>
            </div>
            <p class="text-slate-600 dark:text-slate-300">Gunakan kode OTP 8 digit berikut untuk menghubungkan akun Telegram Anda secara mandiri:</p>
            <div class="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl text-center">
              <span class="text-3xl font-black tracking-widest text-brand dark:text-white">${escapeHtmlJS(otp)}</span>
              <p class="text-[11px] text-slate-500 mt-1">Berlaku selama 10 menit</p>
            </div>
            <div class="p-3 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-xl text-xs space-y-2">
              <p class="font-bold">Cara Menghubungkan:</p>
              <p>1. Buka bot Anda ${escapeHtmlJS(botName)}.</p>
              <p>2. Kirim pesan: <code class="font-bold">${escapeHtmlJS(linkCmd)}</code></p>
              <button type="button" id="btnCopyTgLink" class="w-full min-h-[40px] mt-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors">
                <i class="ph ph-copy" aria-hidden="true"></i> Salin Perintah /link
              </button>
            </div>
            <div class="flex gap-2">
              <button type="button" id="btnRotateTgWebhook" class="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 font-bold text-xs text-slate-600 dark:text-slate-300">Perbarui Webhook</button>
              <button type="button" id="btnDisconnectTgBot" class="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-800 font-bold text-xs text-rose-600 dark:text-rose-400">Putus Bot</button>
            </div>
            <p class="text-[11px] text-slate-500 -mt-1">${escapeHtmlJS(t('tg.webhook_hint'))}</p>
          </div>`,
        confirmButtonText: 'Selesai',
        showCloseButton: true,
        customClass: { popup: getSwalClass() },
        didOpen: () => {
          const copyBtn = document.getElementById('btnCopyTgLink');
          if (copyBtn && navigator.clipboard) {
            copyBtn.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(linkCmd);
                renderHtml(copyBtn, '<i class="ph-bold ph-check" aria-hidden="true"></i> <span>Perintah Disalin!</span>');
              } catch (_) { /* ignore */ }
            });
          }
          const rotateBtn = document.getElementById('btnRotateTgWebhook');
          if (rotateBtn) {
            rotateBtn.addEventListener('click', async () => {
              try {
                await callServer('api_rotateTelegramBotWebhook');
                Swal.fire({ icon: 'success', title: t('tg.webhook_updated'), timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
              } catch (err) {
                Swal.fire({ icon: 'error', title: 'Gagal', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
              }
            });
          }
          const discBtn = document.getElementById('btnDisconnectTgBot');
          if (discBtn) {
            discBtn.addEventListener('click', async () => {
              const conf = await Swal.fire({
                title: 'Putus Bot Telegram?',
                text: 'Bot Anda akan diputus dan webhook-nya dicabut. Chat yang sudah terhubung ikut terputus.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Ya, Putuskan',
                cancelButtonText: t('btn.batal'),
                confirmButtonColor: '#e11d48',
                customClass: { popup: getSwalClass() }
              });
              if (!conf.isConfirmed) return;
              try {
                await callServer('api_disconnectTelegramBot');
                await Swal.fire({ icon: 'success', title: 'Bot Diputus', timer: 1400, showConfirmButton: false, customClass: { popup: getSwalClass() } });
                return openTelegramBotSetupModal();
              } catch (err) {
                Swal.fire({ icon: 'error', title: 'Gagal', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
              }
            });
          }
        }
      });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: toUserErrorMessage(err), customClass: { popup: getSwalClass() } });
    }
  }

  Object.assign(root, {
    loadAdminData,
    filterAdminUsersTable,
    toggleUserStatus,
    toggleUserRole,
    promptNewPassword,
    changeOwnPassword,
    resetUserPassword,
    openTelegramPairingModal
  });

  // Helper Perubahan Terakhir diekspos untuk tes (tests/admin-last-activity.test.js).
  root.__mkFeat = root.__mkFeat || {};
  root.__mkFeat.adminActivity = {
    ADMIN_DORMANT_AFTER_DAYS,
    ADMIN_DELETION_AFTER_DAYS,
    formatLastChangeDate,
    formatLastChangeRelative,
    adminDaysInactive,
    classifyAdminActivity,
    deletionCountdownText,
    filterAdminUsers,
    buildAdminUserRowHtml,
    buildAdminUserMobileCardHtml,
    countUnreadAdminNotifications,
    adminNotificationDeletionDate,
    buildAdminNotificationHtml,
    renderAdminNotifications
  };
})(typeof window !== 'undefined' ? window : globalThis);
