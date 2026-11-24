/* supabase-admin.js — admin RBAC, profile settings, Telegram OTP & debt due dates */
(function () {
  'use strict';
  const core = window.__mkSb;
  if (!core) return;
  const { sb, fail, fetchAll, setSetting } = core;

  async function invokeEdgeFunction(fnName, body, fallbackErr) {
    const { data, error } = await sb.functions.invoke(fnName, { body });
    if (error) {
      let message = error.message || fallbackErr;
      const response = error.context;
      if (response && typeof response.json === 'function') {
        try {
          const details = await response.json();
          if (details && typeof details.error === 'string') message = details.error;
        } catch (parseError) {
          console.error(`Gagal membaca detail error ${fnName}:`, parseError);
        }
      }
      throw new Error(message);
    }
    if (!data || data.success !== true) throw new Error((data && data.error) || fallbackErr);
    return data;
  }

  Object.assign(core.handlers, {
    async api_getAdminData() {
      if (window.sessionRole !== 'admin') throw new Error('Akses ditolak: Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (!authData.user) throw new Error('Sesi login tidak valid. Silakan masuk kembali.');
      const [profiles, statsRes] = await Promise.all([
        fetchAll('profiles', 'id,email,display_name,role,status,created_at', ['created_at']),
        sb.rpc('get_admin_platform_stats')
      ]);

      let stats;
      if (!statsRes.error && Array.isArray(statsRes.data) && statsRes.data.length) {
        const s = statsRes.data[0];
        stats = {
          totalUsers: Number(s.total_users) || profiles.length,
          activeUsers: Number(s.active_users) || 0,
          suspendedUsers: Number(s.suspended_users) || 0,
          totalTelegramChats: Number(s.total_telegram_chats) || 0,
          totalTransactions: Number(s.total_transactions) || 0
        };
      } else {
        const chCount = await sb.from('telegram_chats').select('chat_id', { count: 'exact', head: true });
        fail(chCount.error);
        stats = {
          totalUsers: profiles.length,
          activeUsers: profiles.filter((p) => p.status === 'active').length,
          suspendedUsers: profiles.filter((p) => p.status === 'suspended').length,
          totalTelegramChats: chCount.count || 0
        };
      }

      return { users: profiles, currentUserId: authData.user.id, stats };
    },

    async api_setUserStatus(userId, status) {
      if (window.sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (authData.user && authData.user.id === userId && status !== 'active') {
        throw new Error('Admin tidak dapat menonaktifkan akunnya sendiri.');
      }
      const { error } = await sb.from('profiles').update({ status }).eq('id', userId);
      fail(error);
      return true;
    },

    async api_setUserRole(userId, role) {
      if (window.sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (authData.user && authData.user.id === userId && role !== 'admin') {
        throw new Error('Admin tidak dapat menurunkan role akunnya sendiri.');
      }
      const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
      fail(error);
      return true;
    },

    async api_updateOwnPassword(password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('Password harus terdiri dari 8 sampai 128 karakter.');
      }
      const { error } = await sb.auth.updateUser({ password });
      fail(error);
    },

    async api_updateOwnProfile(displayName) {
      const name = String(displayName || '').trim().slice(0, 60);
      if (name.length < 2) throw new Error('Nama tampilan minimal 2 karakter.');
      const { data, error } = await sb.rpc('update_own_display_name', { p_display_name: name });
      fail(error);
      window.sessionUser = data || name;
      return { displayName: window.sessionUser };
    },

    async api_adminSetPassword(userId, password) {
      if (window.sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('Password harus terdiri dari 8 sampai 128 karakter.');
      }
      await invokeEdgeFunction('admin-password', { userId, password }, 'Reset password gagal.');
    },

    async api_generateTelegramOTP() {
      if (!window.crypto || !window.crypto.getRandomValues) {
        throw new Error('Browser ini tidak mendukung pembuatan kode pairing yang aman.');
      }
      const sample = new Uint32Array(1);
      const ceiling = Math.floor(0x100000000 / 100000000) * 100000000;
      let value;
      do {
        window.crypto.getRandomValues(sample);
        value = sample[0];
      } while (value >= ceiling);
      const otp = String(value % 100000000).padStart(8, '0');
      const { error } = await sb.rpc('replace_telegram_pairing', { p_otp: otp });
      fail(error);
      return otp;
    },

    async api_saveDebtDueDates(dueMap) {
      const clean = {};
      if (dueMap && typeof dueMap === 'object' && !Array.isArray(dueMap)) {
        Object.keys(dueMap).forEach((k) => {
          const v = String(dueMap[k] || '').slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) clean[String(k).slice(0, 120)] = v;
        });
      }
      await setSetting('debtDueDates', JSON.stringify(clean));
      return { debtDueDates: clean };
    },

    async api_deleteOwnAccount(confirmation) {
      const confirmToken = String(confirmation || '').trim().toUpperCase();
      if (confirmToken !== 'HAPUS' && confirmToken !== 'DELETE') {
        throw new Error('Ketik HAPUS untuk mengonfirmasi penghapusan akun.');
      }
      await invokeEdgeFunction('delete-account', { confirmation: confirmToken }, 'Penghapusan akun gagal.');
      return true;
    }
  });
})();
