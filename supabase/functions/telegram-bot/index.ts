import {
  Any, Ctx, Tx, SECRET, sb, esc, safeEqual, getCategories, isActiveUser,
  setTemp, getTemp, delTemp, saveTx, savedMsg, tg, send, mainKb, tambahKb, kategoriKb,
} from './core.ts';
import { getWallets, handleTarik, handleTransfer, handleUtang, handlePiutang } from './wallets.ts';
import { confirmPreview, handleMediaMessage, handleInsight } from './ai.ts';
import { handleBudget, checkBudgetAlert, handleRecurring } from './planning.ts';
import {
  handleStatus, handleSaldo, handleBulan, handleTambah, handleFreeText,
  handleKategori, handleHapus, handleUndo, handleBatch, handleCari,
} from './commands.ts';
import { buildCorsHeaders, handleJob } from './jobs.ts';

async function handleCallback(c: Ctx, cbq: Any) {
  await tg('answerCallbackQuery', { callback_query_id: cbq.id });
  const data: string = cbq.data || '';
  const quickCmds: Record<string, () => Promise<unknown>> = {
    cmd_saldo: () => handleSaldo(c),
    cmd_bulan: () => handleBulan(c),
    cmd_status: () => handleStatus(c),
    cmd_kategori: () => handleKategori(c, ''),
    cmd_tambah: () => send(c.chat, '📝 Ketik atau rekam transaksi:', tambahKb()),
  };
  if (quickCmds[data]) return quickCmds[data]();
  if (data === 'confirm_cancel') {
    await delTemp(c.chat, 'pending');
    return send(c.chat, '❌ Dibatalkan. Tidak ada yang disimpan.', mainKb());
  }

  const pending = await getTemp(c.chat, 'pending');
  if (!pending) return send(c.chat, '⌛ Sesi kadaluarsa. Silakan input ulang.');
  if (data === 'confirm_save') {
    const p: Tx = { tanggal: pending.tanggal, tipe: pending.tipe, kategori: pending.kategori, nominal: Number(pending.nominal), keterangan: pending.keterangan, wallet_id: pending.wallet_id ?? null, walletName: pending.walletName };
    await saveTx(c, p);
    await delTemp(c.chat, 'pending');
    await send(c.chat, savedMsg('✅ <b>Tersimpan!</b>', p), mainKb());
    if (p.tipe === 'Pengeluaran') await checkBudgetAlert(c, p.kategori);
    return;
  }
  if (data === 'confirm_back') return confirmPreview(c.chat, pending);
  if (data === 'confirm_wallet') {
    const ws = await getWallets(c.uid);
    if (ws.length >= 2) {
      const next = ws[(ws.findIndex((w) => w.id === pending.wallet_id) + 1) % ws.length];
      pending.wallet_id = next.id;
      pending.walletName = next.name;
      await setTemp(c.chat, 'pending', pending);
    }
    return confirmPreview(c.chat, pending);
  }
  if (data === 'confirm_edit_cat') {
    const cats = await getCategories(c.uid, pending.tipe === 'Pemasukan' ? 'pemasukan' : 'pengeluaran');
    const rows = cats.reduce<Any[]>((acc, cat, idx) => {
      if (idx % 2 === 0) acc.push([{ text: cat, callback_data: `set_cat_${idx}` }]);
      else acc[acc.length - 1].push({ text: cat, callback_data: `set_cat_${idx}` });
      return acc;
    }, []);
    rows.push([{ text: '⬅️ Kembali', callback_data: 'confirm_back' }]);
    return send(c.chat, '🏷️ <b>Pilih kategori baru:</b>', { inline_keyboard: rows });
  }
  if (data.startsWith('set_cat_')) {
    const cats = await getCategories(c.uid, pending.tipe === 'Pemasukan' ? 'pemasukan' : 'pengeluaran');
    const chosen = cats[parseInt(data.slice(8), 10)];
    if (chosen) {
      pending.kategori = chosen;
      await setTemp(c.chat, 'pending', pending);
      return confirmPreview(c.chat, pending);
    }
  }
}

const GREETINGS = ['halo', 'hai', 'hi', 'hello', 'helo', 'hei', 'pagi', 'siang', 'malam', 'sore', 'assalamualaikum', 'salam'];

async function handleMessage(c: Ctx, msg: Any) {
  if (msg.document || msg.photo || msg.voice) return handleMediaMessage(c, msg);
  let text = String(msg.text || '').trim();
  if (!text) return;
  if (text.startsWith('/') && text.split(' ')[0].includes('@')) text = text.split(' ')[0].split('@')[0] + text.slice(text.split(' ')[0].length);
  const cmd = text.toLowerCase();

  const menu: Record<string, () => Promise<unknown>> = {
    '📊 status keuangan': () => handleStatus(c),
    '💰 saldo bulan ini': () => handleSaldo(c),
    '📅 transaksi bulan ini': () => handleBulan(c),
    '🏷️ kelola kategori': () => handleKategori(c, ''),
    '📚 lihat kategori': () => handleKategori(c, ''),
    '↩️ undo terakhir': () => handleUndo(c),
    '📈 budget': () => handleBudget(c, ''),
    '🔄 recurring': () => handleRecurring(c, ''),
    '💡 insight ai': () => handleInsight(c),
    '💡 insight': () => handleInsight(c),
    '📝 tambah transaksi': () => send(c.chat, '📝 Ketik bebas (mis. <i>kopi 25rb</i>) atau rekam voice note.', tambahKb()),
    '❓ bantuan': () => send(c.chat, '<b>❓ Bantuan</b>\n• <i>kopi 25rb</i>\n• <code>/cari laundry</code>\n• <code>/tarik 500rb</code>\n• <code>/transfer bca cash 200rb</code>\n• <code>/utang pinjam Budi 500rb</code>', mainKb()),
    '🔙 menu utama': () => send(c.chat, '🏠 <b>Menu Utama</b>', mainKb()),
    '🟢 pemasukan': () => send(c.chat, '🟢 Contoh: <code>/tambah Pemasukan Gaji 5000000</code>', tambahKb()),
    '🔴 pengeluaran': () => send(c.chat, '🔴 Contoh: <code>/tambah Pengeluaran Makanan 25000</code>', tambahKb()),
    '➕ tambah kategori': () => send(c.chat, '➕ Contoh: <code>/kategori tambah Pemasukan Crypto</code>', kategoriKb()),
  };
  if (menu[cmd]) return void (await menu[cmd]());
  if (GREETINGS.includes(cmd.split(/\s+/)[0])) return handleStatus(c);
  if (cmd === '/start' || cmd === 'start') return send(c.chat, `👋 Halo <b>${esc(c.name)}</b>! Saya <b>MyKeuGuech Bot</b> 💰`, mainKb());
  if (['/status', 'status', 'info', 'rekap'].includes(cmd)) return handleStatus(c);
  if (cmd === '/saldo' || cmd === 'saldo') return handleSaldo(c);
  if (cmd === '/bulan' || cmd === 'bulan') return handleBulan(c);
  if (cmd === '/hapus' || cmd === 'hapus') return handleHapus(c);
  if (cmd === '/undo' || cmd === 'undo') return handleUndo(c);
  if (['/help', 'help', 'bantuan', '/menu', 'menu'].includes(cmd)) return send(c.chat, '🏠 <b>Menu Utama</b>', mainKb());
  if (cmd === '/insight' || cmd === 'insight' || cmd === '/analisis') return handleInsight(c);
  if (/^\/?(kategori)(\s|$)/i.test(text)) return handleKategori(c, text.replace(/^\/?kategori\s*/i, '').trim());
  if (/^\/?(cari|search)(\s|$)/i.test(text)) return handleCari(c, text.replace(/^\/?(cari|search)\s*/i, ''));
  if (/^\/?(tambah)\s/i.test(text)) return handleTambah(c, text.replace(/^\/?tambah\s*/i, ''));
  if (/^\/?budget(\s|$)/i.test(text)) return handleBudget(c, text.replace(/^\/?budget\s*/i, ''));
  if (/^\/?recurring(\s|$)/i.test(text)) return handleRecurring(c, text.replace(/^\/?recurring\s*/i, ''));
  if (/^\/?batch(\s|$)/i.test(text)) return handleBatch(c, text);
  if (/^\/?tarik(\s|$)/i.test(text)) return handleTarik(c, text.replace(/^\/?tarik\s*/i, ''));
  if (/^\/?transfer(\s|$)/i.test(text)) return handleTransfer(c, text.replace(/^\/?transfer\s*/i, ''));
  if (/^\/?utang(\s|$)/i.test(text)) return handleUtang(c, text.replace(/^\/?utang\s*/i, ''));
  if (/^\/?piutang(\s|$)/i.test(text)) return handlePiutang(c, text.replace(/^\/?piutang\s*/i, ''));
  if (!cmd.startsWith('/') && text.length >= 3) return handleFreeText(c, text);
  return send(c.chat, '🤖 Perintah tidak dikenal. Ketik transaksi mis. <i>makan siang 25rb</i>', mainKb());
}

async function handlePairingCommand(chat: number, firstName: string, otp: string) {
  const { data: allowed, error: attemptErr } = await sb.rpc('consume_telegram_pairing_attempt', { p_chat_id: chat });
  if (attemptErr) throw attemptErr;
  if (!allowed) return send(chat, 'Terlalu banyak percobaan kode. Tunggu 10 menit sebelum mencoba lagi.');

  const { data: pair, error: pairErr } = await sb.from('telegram_pairings')
    .delete().eq('otp', otp).gt('expires_at', new Date().toISOString()).select('user_id, expires_at').maybeSingle();
  if (pairErr) throw pairErr;
  if (!pair) return send(chat, 'Kode pairing salah atau sudah kedaluwarsa (10 menit).');
  if (!await isActiveUser(pair.user_id)) return send(chat, 'Akun ini sedang dinonaktifkan.');

  const { error: upsertErr } = await sb.from('telegram_chats').upsert({ chat_id: chat, user_id: pair.user_id, name: firstName || 'User' }, { onConflict: 'chat_id' });
  if (upsertErr) throw upsertErr;
  return send(chat, '🎉 <b>Selamat!</b> Akun Telegram Anda berhasil terhubung dengan MyKeuGuech.', mainKb());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return new Response('ok');
  let update: Any;
  try { update = await req.json(); } catch { return new Response('bad request', { status: 400 }); }
  if (typeof update?.job === 'string') return handleJob(req, update.job);
  if (!await safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', SECRET)) return new Response('forbidden', { status: 403 });

  try {
    if (update.update_id) {
      const { error } = await sb.from('telegram_updates').insert({ update_id: update.update_id });
      if (error?.code === '23505') return new Response('dup');
      if (Math.random() < 0.02) {
        await sb.from('telegram_updates').delete().lt('received_at', new Date(Date.now() - 86_400_000).toISOString());
        await sb.from('telegram_pending').delete().lt('expires_at', new Date().toISOString());
      }
    }
    const msg = update.message ?? update.callback_query?.message;
    const from = update.message?.from ?? update.callback_query?.from;
    if (!msg || !from) return new Response('ok');
    const chat: number = msg.chat.id;
    const mPair = String(update.message?.text || '').trim().match(/^\/(?:start\s+PAIR_|link\s+)(\d{8})$/i);
    if (mPair) { await handlePairingCommand(chat, from.first_name || 'User', mPair[1]); return new Response('ok'); }

    const { data: reg, error: regErr } = await sb.from('telegram_chats').select('user_id').eq('chat_id', chat).maybeSingle();
    if (regErr) throw regErr;
    if (!reg) { await send(chat, `🔒 Chat belum terhubung. <code>chat_id: ${chat}</code>`); return new Response('ok'); }
    if (!await isActiveUser(reg.user_id)) { await send(chat, 'Akun ini sedang dinonaktifkan.'); return new Response('ok'); }

    const c: Ctx = { chat, uid: reg.user_id, name: from.first_name || 'User' };
    try {
      if (update.callback_query) await handleCallback(c, update.callback_query);
      else await handleMessage(c, update.message);
    } catch (e) { console.error('handler error', e); await send(chat, `❌ Gagal: <code>${esc((e as Error).message || e)}</code>`); }
  } catch (e) {
    console.error('webhook error', e);
  }
  return new Response('ok');
});
