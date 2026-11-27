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

  async function logAdminActionSafe(action, targetUserId, targetEmail, details) {
    try {
      await sb.rpc('admin_log_action', {
        p_action: action,
        p_target_user_id: targetUserId || null,
        p_target_email: targetEmail || '',
        p_details: details || {}
      });
    } catch (_) { /* ignore optional audit table failure */ }
  }

  Object.assign(core.handlers, {
    async api_getAdminData() {
      if (window.sessionRole !== 'admin') throw new Error('Akses ditolak: Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (!authData.user) throw new Error('Sesi login tidak valid. Silakan masuk kembali.');
      const [profiles, statsRes, auditRes] = await Promise.all([
        fetchAll('profiles', 'id,email,display_name,role,status,created_at', ['created_at']),
        sb.rpc('get_admin_platform_stats'),
        sb.from('admin_audit_logs').select('id,actor_email,action,target_email,details,created_at').order('created_at', { ascending: false }).limit(25)
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
        // Fallback bila RPC statistik gagal: jumlah chat Telegram platform
        // TIDAK bisa dihitung dari klien lagi — sejak Gelombang 2.2, policy
        // telegram_chats hanya mengizinkan SELECT baris sendiri, jadi query
        // langsung hanya mengembalikan chat milik admin sendiri (angka salah).
        // Tampilkan 0 daripada angka yang menyesatkan; angka benar hanya
        // dari RPC get_admin_platform_stats.
        stats = {
          totalUsers: profiles.length,
          activeUsers: profiles.filter((p) => p.status === 'active').length,
          suspendedUsers: profiles.filter((p) => p.status === 'suspended').length,
          totalTelegramChats: 0
        };
      }

      const auditLogs = !auditRes.error && Array.isArray(auditRes.data) ? auditRes.data : [];
      return { users: profiles, currentUserId: authData.user.id, stats, auditLogs };
    },

    async api_setUserStatus(userId, status) {
      // Pre-check UX saja: window.sessionRole bisa diubah dari DevTools, jadi
      // otorisasi sesungguhnya ditegakkan server oleh edge function admin-user-ops.
      if (window.sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (authData.user && authData.user.id === userId && status !== 'active') {
        throw new Error('Admin tidak dapat menonaktifkan akunnya sendiri.');
      }
      // Audit dicatat server oleh edge function (tidak lagi logAdminActionSafe di sini).
      await invokeEdgeFunction('admin-user-ops', { action: 'set_user_status', userId, status }, 'Gagal memperbarui status pengguna.');
      return true;
    },

    async api_setUserRole(userId, role) {
      // Pre-check UX saja: window.sessionRole bisa diubah dari DevTools, jadi
      // otorisasi sesungguhnya ditegakkan server oleh edge function admin-user-ops.
      if (window.sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (authData.user && authData.user.id === userId && role !== 'admin') {
        throw new Error('Admin tidak dapat menurunkan role akunnya sendiri.');
      }
      // Audit dicatat server oleh edge function (tidak lagi logAdminActionSafe di sini).
      await invokeEdgeFunction('admin-user-ops', { action: 'set_user_role', userId, role }, 'Gagal memperbarui role pengguna.');
      return true;
    },

    // T3: ganti password wajib membuktikan password lama dulu, lalu cabut
    // semua sesi lain (scope 'others') agar sesi di perangkat lain / yang
    // dicuri tidak tetap hidup setelah password diganti. Sesi saat ini
    // tetap berjalan. Pesan error sengaja generik: jangan membocorkan
    // apakah akun ada atau password mana yang salah.
    async api_updateOwnPassword(oldPassword, newPassword) {
      if (typeof oldPassword !== 'string' || !oldPassword) {
        throw new Error('Masukkan password lama Anda saat ini.');
      }
      if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
        throw new Error('Password harus terdiri dari 8 sampai 128 karakter.');
      }
      const { data: authData, error: authError } = await sb.auth.getUser();
      fail(authError);
      if (!authData.user || !authData.user.email) throw new Error('Sesi login tidak valid. Silakan masuk kembali.');
      let verifyError = null;
      try {
        const res = await sb.auth.signInWithPassword({ email: authData.user.email, password: oldPassword });
        verifyError = res && res.error ? res.error : null;
      } catch (err) {
        verifyError = err;
      }
      if (verifyError) throw new Error('Password lama tidak valid.');
      const { error } = await sb.auth.updateUser({ password: newPassword });
      fail(error);
      try {
        await sb.auth.signOut({ scope: 'others' });
      } catch (revokeError) {
        throw new Error('Password berhasil diubah, tetapi sesi lain gagal dicabut. Silakan logout lalu masuk kembali.');
      }
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
      await logAdminActionSafe('reset_password', userId, '', {});
    },

    async api_adminUnlinkTelegram(userId) {
      if (window.sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      try {
        return await invokeEdgeFunction('admin-user-ops', { action: 'unlink_telegram', userId }, 'Gagal memutus tautan Telegram.');
      } catch (edgeErr) {
        const { data, error } = await sb.rpc('admin_unlink_user_telegram', { p_target_user_id: userId });
        if (error) throw edgeErr;
        return { success: true, unlinkedCount: Number(data) || 0 };
      }
    },

    async api_adminDeleteUser(userId, confirmation) {
      if (window.sessionRole !== 'admin') throw new Error('Hanya untuk administrator.');
      const token = String(confirmation || '').trim().toUpperCase();
      if (!['HAPUS', 'DELETE'].includes(token)) throw new Error('Ketik HAPUS untuk konfirmasi penghapusan akun.');
      return invokeEdgeFunction('admin-user-ops', { action: 'delete_user', userId, confirmation: token }, 'Penghapusan akun pengguna gagal.');
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

    // --- Bot Telegram personal (Gelombang 2.2: bring your own bot) --------
    // Token bot TIDAK PERNAH disimpan di perangkat: token dikirim sekali ke
    // Edge Function telegram-setup, divalidasi ke Telegram (getMe),
    // dienkripsi (AES-GCM) dan disimpan di server. Status yang dikembalikan
    // hanya berisi username bot — tanpa token.
    async api_getTelegramBotStatus() {
      const res = await invokeEdgeFunction('telegram-setup', { action: 'get_status' });
      return res; // { connected: boolean, bot_username?, bot_user_id?, created_at? }
    },

    async api_connectTelegramBot(token) {
      const t = String(token || '').trim();
      if (!t) throw new Error('Tempel token bot dari @BotFather terlebih dahulu.');
      if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(t)) {
        throw new Error('Format token tidak valid. Salin token lengkap dari @BotFather.');
      }
      const res = await invokeEdgeFunction('telegram-setup', { action: 'connect_bot', token: t });
      return res; // { bot_username, bot_user_id }
    },

    async api_disconnectTelegramBot() {
      await invokeEdgeFunction('telegram-setup', { action: 'disconnect_bot' });
      return true;
    },

    async api_rotateTelegramBotWebhook() {
      await invokeEdgeFunction('telegram-setup', { action: 'rotate_webhook' });
      return true;
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

    // T4: hapus akun wajib autentikasi ulang dengan password saat ini.
    // Password diteruskan ke edge function `delete-account`, yang
    // memverifikasinya di server sebelum menghapus apa pun — klien hanya
    // memeriksa format, bukan kebenaran password.
    async api_deleteOwnAccount(confirmation, password) {
      const confirmToken = String(confirmation || '').trim().toUpperCase();
      if (confirmToken !== 'HAPUS' && confirmToken !== 'DELETE') {
        throw new Error('Ketik HAPUS untuk mengonfirmasi penghapusan akun.');
      }
      if (typeof password !== 'string' || !password) {
        throw new Error('Masukkan password akun Anda saat ini untuk mengonfirmasi penghapusan akun.');
      }
      await invokeEdgeFunction('delete-account', { confirmation: confirmToken, password }, 'Penghapusan akun gagal.');
      return true;
    }
  });
})();
