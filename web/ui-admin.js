/* global Swal, callServer, escapeHtmlJS, renderHtml, getSwalClass */
/* ============================================================
   ADMIN PANEL & TELEGRAM PAIRING
   ============================================================ */
(function (root) {
  'use strict';

  let adminUsersCache = [];
  let adminCurrentUserId = '';

  async function loadAdminData() {
    const tbody = document.getElementById('adm-user-table');
    const setAdminText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    };
    if (tbody) {
      renderHtml(tbody, '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400">Memuat data pengguna...</td></tr>');
    }

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
      filterAdminUsersTable();
      return true;
    } catch (err) {
      console.error('loadAdminData error:', err);
      if (tbody) {
        renderHtml(tbody, `
          <tr>
            <td colspan="5" class="px-6 py-8 text-center text-rose-600 dark:text-rose-400">
              <p>Gagal memuat data pengguna: ${escapeHtmlJS(String(err.message || err))}</p>
              <button type="button" onclick="loadAdminData()" class="mt-3 min-h-[44px] px-3 font-bold underline cursor-pointer">Coba lagi</button>
            </td>
          </tr>`);
      }
      return false;
    }
  }

  function buildAdminUserRowHtml(u) {
    const isSuspended = u.status === 'suspended';
    const statusBadge = isSuspended
      ? '<span class="px-2 py-1 rounded-md text-[10px] font-bold bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">Suspended</span>'
      : '<span class="px-2 py-1 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">Active</span>';
    const roleBadge = u.role === 'admin'
      ? '<span class="px-2 py-1 rounded-md text-[10px] font-bold bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400">Admin</span>'
      : '<span class="px-2 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">User</span>';

    const nextStatus = isSuspended ? 'active' : 'suspended';
    const statusBtnColor = isSuspended ? 'text-emerald-600 hover:text-emerald-800' : 'text-rose-500 hover:text-rose-700';
    const safeId = escapeHtmlJS(u.id);
    const actions = u.id === adminCurrentUserId
      ? '<span class="text-slate-400">Akun Anda</span>'
      : `<button type="button" data-admin-action="status" data-user-id="${safeId}" data-value="${nextStatus}" class="min-h-[44px] px-2 font-bold cursor-pointer ${statusBtnColor}">${isSuspended ? 'Aktifkan' : 'Suspend'}</button>
         <button type="button" data-admin-action="role" data-user-id="${safeId}" data-value="${u.role === 'admin' ? 'user' : 'admin'}" class="min-h-[44px] px-2 font-bold text-blue-500 hover:text-blue-700 cursor-pointer">${u.role === 'admin' ? 'Jadikan User' : 'Jadikan Admin'}</button>
         <button type="button" data-admin-action="password" data-user-id="${safeId}" class="min-h-[44px] px-2 font-bold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white cursor-pointer">Atur Password</button>`;

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td class="px-6 py-4">
          <p class="font-bold text-slate-800 dark:text-white">${escapeHtmlJS(u.display_name || 'User')}</p>
          <p class="text-[11px] text-slate-400">${escapeHtmlJS(u.email)}</p>
        </td>
        <td class="px-6 py-4">${roleBadge}</td>
        <td class="px-6 py-4">${statusBadge}</td>
        <td class="px-6 py-4 text-slate-500">${escapeHtmlJS(String(u.created_at || '').slice(0, 10))}</td>
        <td class="px-6 py-4 text-center"><div class="flex items-center justify-center gap-3">${actions}</div></td>
      </tr>`;
  }

  function filterAdminUsersTable() {
    const tbody = document.getElementById('adm-user-table');
    const countEl = document.getElementById('adm-user-count');
    if (!tbody) return;

    const search = ((document.getElementById('admSearchInput') || {}).value || '').trim().toLocaleLowerCase();
    const filter = (document.getElementById('admFilterStatus') || {}).value || '';
    const filtered = adminUsersCache.filter((u) => {
      if (search && !`${u.display_name || ''} ${u.email || ''}`.toLocaleLowerCase().includes(search)) return false;
      if ((filter === 'active' || filter === 'suspended') && u.status !== filter) return false;
      if ((filter === 'admin' || filter === 'user') && u.role !== filter) return false;
      return true;
    });

    if (countEl) countEl.textContent = String(filtered.length);
    if (!filtered.length) {
      renderHtml(tbody, '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400">Tidak ada pengguna yang cocok.</td></tr>');
      return;
    }

    renderHtml(tbody, filtered.map(buildAdminUserRowHtml).join(''));
    const usersById = new Map(adminUsersCache.map((user) => [user.id, user]));
    tbody.querySelectorAll('[data-admin-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const user = usersById.get(button.dataset.userId);
        if (!user) return;
        if (button.dataset.adminAction === 'status') toggleUserStatus(user.id, button.dataset.value);
        else if (button.dataset.adminAction === 'role') toggleUserRole(user.id, button.dataset.value);
        else if (button.dataset.adminAction === 'password') resetUserPassword(user.id, user.email || '');
      });
    });
  }

  async function confirmAndApplyAdminChange(opts) {
    const confirm = await Swal.fire({
      title: opts.title,
      text: opts.text,
      icon: opts.icon,
      showCancelButton: true,
      confirmButtonText: opts.confirmText,
      cancelButtonText: 'Batal',
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
      Swal.fire({ icon: 'error', title: 'Gagal', text: e.message || String(e), customClass: { popup: getSwalClass() } });
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

  async function promptNewPassword(title) {
    const { value: password } = await Swal.fire({
      title,
      html: `
        <label for="admin-new-password" class="block text-left text-sm font-semibold mb-1">Password baru</label>
        <input id="admin-new-password" type="password" class="swal2-input" autocomplete="new-password" minlength="8">
        <label for="admin-confirm-password" class="block text-left text-sm font-semibold mt-3 mb-1">Ulangi password</label>
        <input id="admin-confirm-password" type="password" class="swal2-input" autocomplete="new-password" minlength="8">`,
      showCancelButton: true,
      confirmButtonText: 'Simpan Password',
      cancelButtonText: 'Batal',
      focusConfirm: false,
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const newPassword = document.getElementById('admin-new-password').value;
        const confirmPassword = document.getElementById('admin-confirm-password').value;
        if (newPassword.length < 8 || newPassword.length > 128) {
          Swal.showValidationMessage('Password harus terdiri dari 8 sampai 128 karakter.');
          return false;
        }
        if (newPassword !== confirmPassword) {
          Swal.showValidationMessage('Konfirmasi password tidak cocok.');
          return false;
        }
        return newPassword;
      }
    });
    return password;
  }

  async function changeOwnPassword() {
    const password = await promptNewPassword('Ganti password akun Anda');
    if (!password) return;
    try {
      await callServer('api_updateOwnPassword', password);
      await Swal.fire({ icon: 'success', title: 'Password berhasil diperbarui.', customClass: { popup: getSwalClass() } });
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'Gagal mengganti password', text: err.message || String(err), customClass: { popup: getSwalClass() } });
    }
  }

  async function resetUserPassword(uid, email) {
    const password = await promptNewPassword(`Atur password untuk ${escapeHtmlJS(email)}`);
    if (!password) return;
    try {
      await callServer('api_adminSetPassword', uid, password);
      await Swal.fire({ icon: 'success', title: 'Password pengguna berhasil diatur ulang.', customClass: { popup: getSwalClass() } });
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'Gagal mengatur password', text: err.message || String(err), customClass: { popup: getSwalClass() } });
    }
  }

  async function openTelegramPairingModal() {
    try {
      Swal.fire({
        title: 'Membuat Kode Pairing...',
        allowOutsideClick: false,
        customClass: { popup: getSwalClass() },
        didOpen: () => Swal.showLoading()
      });

      const otp = await callServer('api_generateTelegramOTP');
      const linkCmd = `/link ${otp}`;
      Swal.fire({
        title: 'Hubungkan Bot Telegram',
        html: `
          <div class="text-left space-y-3 text-sm">
            <p class="text-slate-600 dark:text-slate-300">Gunakan kode OTP 8 digit berikut untuk menghubungkan akun Telegram Anda secara mandiri:</p>
            <div class="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl text-center">
              <span class="text-3xl font-black tracking-widest text-brand dark:text-white">${escapeHtmlJS(otp)}</span>
              <p class="text-[11px] text-slate-400 mt-1">Berlaku selama 10 menit</p>
            </div>
            <div class="p-3 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-xl text-xs space-y-2">
              <p class="font-bold">Cara Menghubungkan:</p>
              <p>1. Buka Bot Telegram MyKeuangan.</p>
              <p>2. Kirim pesan: <code class="font-bold">${escapeHtmlJS(linkCmd)}</code></p>
              <button type="button" id="btnCopyTgLink" class="w-full min-h-[40px] mt-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors">
                <i class="ph ph-copy" aria-hidden="true"></i> Salin Perintah /link
              </button>
            </div>
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
                copyBtn.textContent = '✓ Perintah Disalin!';
              } catch (_) { /* ignore */ }
            });
          }
        }
      });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: err.message || String(err), customClass: { popup: getSwalClass() } });
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
})(typeof window !== 'undefined' ? window : globalThis);
