import {
  Ctx, Tx, sb, esc, rp, pad, parseNominal, validateNominal, fetchAll, getCategories, normalizeCatKey, resolveUserCategory,
  periodLabel, isFlow, inPeriod, loadCore, actualFor, getBudgets, setTemp, getTemp, delTemp, send, mainKb,
} from './core.ts';

// UUID lengkap — pola yang sama dipakai admin-password/index.ts.
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function budgetBar(pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}

async function showBudgets(c: Ctx) {
  const { trx, pd, period } = await loadCore(c.uid);
  const label = periodLabel(period, pd);
  const budgets = await getBudgets(c.uid, period);
  if (budgets.length === 0) {
    return send(c.chat, `📊 <b>Budget ${period}</b>\n📅 Siklus: ${label}\n\n📭 Belum ada budget bulan ini.\n\n➕ Tambah:\n<code>/budget set Makanan 1500000</code>`, mainKb());
  }
  let s = `📊 <b>Budget ${period}</b>\n📅 ${label}\n━━━━━━━━━━━━━━━━\n\n`;
  let totalPlan = 0, totalActual = 0;
  for (const b of budgets) {
    const plan = Number(b.jumlah) || 0;
    const actual = actualFor(trx, b.kategori, period, pd);
    const pct = plan > 0 ? (actual / plan) * 100 : 0;
    const sisa = plan - actual;
    totalPlan += plan; totalActual += actual;
    const icon = pct > 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
    s += `${icon} <b>${esc(b.kategori)}</b>\n   <code>${budgetBar(pct)}</code> ${pct.toFixed(0)}%\n   ${rp(actual)} / ${rp(plan)}\n   ${sisa >= 0 ? 'Sisa: +' : 'Over: -'}${rp(Math.abs(sisa))}\n\n`;
  }
  const budgetedKeys = new Set(budgets.map((b) => normalizeCatKey(b.kategori)));
  const unbudgetedTx = trx.filter((t) =>
    t.tipe === 'Pengeluaran' && isFlow(t.kategori) &&
    inPeriod(String(t.tanggal), period, pd) && !budgetedKeys.has(normalizeCatKey(t.kategori))
  );
  const totalPct = totalPlan > 0 ? (totalActual / totalPlan) * 100 : 0;
  s += `━━━━━━━━━━━━━━━━\n📈 <b>Total:</b> ${totalPct.toFixed(0)}% terpakai\n📥 Actual: ${rp(totalActual)}\n🎯 Plan: ${rp(totalPlan)}`;
  if (unbudgetedTx.length > 0) {
    const unbMap = new Map<string, { label: string; total: number }>();
    let unbTotal = 0;
    for (const t of unbudgetedTx) {
      const amt = Number(t.nominal) || 0;
      unbTotal += amt;
      const clean = String(t.kategori || '').trim() || 'Lainnya';
      const k = normalizeCatKey(clean);
      const prev = unbMap.get(k);
      if (prev) prev.total += amt; else unbMap.set(k, { label: clean, total: amt });
    }
    const topUnb = Array.from(unbMap.values()).sort((a, b) => b.total - a.total).slice(0, 3).map((x) => esc(x.label)).join(', ');
    s += `\n\n📦 Di luar budget: <b>${rp(unbTotal)}</b> (${unbudgetedTx.length} trx: ${topUnb})`;
  }
  await send(c.chat, s, mainKb());
}

async function budgetDetail(c: Ctx, kategori: string) {
  const { trx, pd, period } = await loadCore(c.uid);
  const targetKey = normalizeCatKey(kategori);
  const b = (await getBudgets(c.uid, period)).find((x) => normalizeCatKey(x.kategori) === targetKey);
  if (!b) return send(c.chat, `❌ Budget <b>${esc(kategori)}</b> tidak ditemukan.\n\nTambah: <code>/budget set ${esc(kategori)} 1000000</code>`, mainKb());
  const plan = Number(b.jumlah) || 0;
  const actual = actualFor(trx, b.kategori, period, pd);
  const pct = plan > 0 ? (actual / plan) * 100 : 0;
  const sisa = plan - actual;
  const n = trx.filter((t) => t.tipe === 'Pengeluaran' && normalizeCatKey(t.kategori) === normalizeCatKey(b.kategori) && isFlow(t.kategori) && inPeriod(String(t.tanggal), period, pd)).length;
  const status = pct > 100 ? '🔴 Over' : pct >= 80 ? '🟡 Mendekati' : '🟢 Aman';
  await send(c.chat,
    `📊 <b>${esc(b.kategori)}</b>\n📅 ${periodLabel(period, pd)}\n━━━━━━━━━━━━━━━━\n\n` +
    `🎯 Plan: <b>${rp(plan)}</b>\n📥 Actual: <b>${rp(actual)}</b>\n💵 ${sisa >= 0 ? 'Sisa: ' : 'Over: '}<b>${sisa >= 0 ? '+' : '-'}${rp(Math.abs(sisa))}</b>\n📈 ${pct.toFixed(0)}% · ${n} transaksi · ${status}`, mainKb());
}

async function setBudget(c: Ctx, kategori: string, jumlah: number) {
  const { pd, period } = await loadCore(c.uid);
  const cats = await getCategories(c.uid, 'pengeluaran');
  const found = cats.find((k) => normalizeCatKey(k) === normalizeCatKey(kategori));
  if (!found) {
    return send(c.chat, `❌ Kategori <b>${esc(kategori)}</b> tidak ada.\n\nTambah: <code>/kategori tambah Pengeluaran ${esc(kategori)}</code>`, mainKb());
  }
  const { error } = await sb.from('budgets').upsert({ user_id: c.uid, kategori: found, bulan: period, jumlah }, { onConflict: 'user_id,kategori,bulan' });
  if (error) throw error;
  await send(c.chat, `✅ <b>Budget di-set!</b>\n\n📌 ${esc(found)}\n💵 ${rp(jumlah)}\n📅 ${periodLabel(period, pd)}`, mainKb());
}

async function deleteBudget(c: Ctx, kategori: string) {
  const { period } = await loadCore(c.uid);
  const b = (await getBudgets(c.uid, period)).find((x) => normalizeCatKey(x.kategori) === normalizeCatKey(kategori));
  if (!b) return send(c.chat, `❌ Budget <b>${esc(kategori)}</b> tidak ditemukan bulan ini.`, mainKb());
  const { error } = await sb.from('budgets').delete().eq('id', b.id).eq('user_id', c.uid);
  if (error) throw error;
  await send(c.chat, `🗑️ Budget <b>${esc(b.kategori)}</b> dihapus.`, mainKb());
}

async function copyBudget(c: Ctx) {
  const { pd, period } = await loadCore(c.uid);
  const [y, m] = period.split('-').map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${pad(m === 1 ? 12 : m - 1)}`;
  const source = await getBudgets(c.uid, prev);
  if (source.length === 0) return send(c.chat, '❌ Tidak ada budget di bulan sebelumnya untuk di-copy.', mainKb());
  const have = new Set((await getBudgets(c.uid, period)).map((b) => normalizeCatKey(b.kategori)));
  const rows = source.filter((b) => !have.has(normalizeCatKey(b.kategori))).map((b) => ({ user_id: c.uid, kategori: String(b.kategori || '').trim(), bulan: period, jumlah: b.jumlah }));
  if (rows.length) {
    const { error } = await sb.from('budgets').insert(rows);
    if (error) throw error;
  }
  await send(c.chat, rows.length
    ? `✅ <b>Budget di-copy!</b>\n\n📋 Dari: ${periodLabel(prev, pd)}\n📌 Ke: ${periodLabel(period, pd)}\n\n${rows.length} kategori di-copy.`
    : `ℹ️ Seluruh budget dari ${periodLabel(prev, pd)} sudah ada di bulan ini.`, mainKb());
}

export async function handleBudget(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();
  if (!action || action === 'list' || action === 'lihat') return showBudgets(c);
  if (['set', 'tambah', 'add'].includes(action)) {
    const jumlah = parts.length >= 3 ? parseNominal(parts[parts.length - 1]) : 0;
    if (parts.length < 3 || jumlah <= 0) return send(c.chat, '❌ Format: <code>/budget set Makanan 1500000</code>', mainKb());
    return setBudget(c, parts.slice(1, -1).join(' '), jumlah);
  }
  if (['hapus', 'delete', 'remove'].includes(action)) {
    if (parts.length < 2) return send(c.chat, '❌ Format: <code>/budget hapus [Kategori]</code>', mainKb());
    return deleteBudget(c, parts.slice(1).join(' '));
  }
  if (['cek', 'detail'].includes(action)) {
    if (parts.length < 2) return send(c.chat, '❌ Format: <code>/budget cek [Kategori]</code>', mainKb());
    return budgetDetail(c, parts.slice(1).join(' '));
  }
  if (action === 'copy') return copyBudget(c);
  return send(c.chat, '<b>📊 Command Budget</b>\n\n• <code>/budget</code>\n• <code>/budget set Makanan 1500000</code>\n• <code>/budget cek Makanan</code>\n• <code>/budget copy</code>', mainKb());
}

export async function checkBudgetAlert(c: Ctx, kategori: string) {
  try {
    if (!isFlow(kategori)) return;
    const { trx, pd, period } = await loadCore(c.uid);
    const b = (await getBudgets(c.uid, period)).find((x) => normalizeCatKey(x.kategori) === normalizeCatKey(kategori));
    if (!b) return;
    const plan = Number(b.jumlah) || 0;
    const actual = actualFor(trx, b.kategori, period, pd);
    const pct = plan > 0 ? (actual / plan) * 100 : 0;
    if (pct < 80) return;
    const sisa = plan - actual;
    await send(c.chat,
      `${pct >= 100 ? '🚨' : '⚠️'} <b>${pct >= 100 ? 'BUDGET OVER!' : 'BUDGET WARNING'}</b>\n\n` +
      `📌 <b>${esc(b.kategori)}</b> · Terpakai <b>${pct.toFixed(0)}%</b> (${rp(actual)} / ${rp(plan)})\n` +
      (sisa >= 0 ? `💵 Sisa: ${rp(sisa)}` : `💸 Over: ${rp(Math.abs(sisa))}`));
  } catch (e) { console.error('budgetAlert', e); }
}

async function showRecurring(c: Ctx) {
  const list = await fetchAll('recurring', 'id,tipe,kategori,nominal,keterangan,day_of_month,active', c.uid, ['day_of_month', 'kategori']);
  if (list.length === 0) return send(c.chat, '🔄 Belum ada recurring.\n➕ <code>/recurring add Pengeluaran Tagihan 350000 5</code>', mainKb());
  let s = '🔄 <b>Recurring Transactions</b>\n━━━━━━━━━━━━━━━━\n\n';
  for (const r of list) {
    s += `${r.active ? '🟢' : '⚫'} <b>${esc(r.kategori)}</b> · ${rp(Number(r.nominal))} · tgl <b>${r.day_of_month}</b> · <code>${r.id.slice(0, 8)}</code>\n`;
  }
  await send(c.chat, s + '\n• <code>/recurring toggle [id]</code>\n• <code>/recurring hapus [id]</code>\n💡 Pakai ID lengkap (UUID), bukan 8 karakter pertama. Lihat ID lengkap: <code>/recurring id [awalan]</code>', mainKb());
}

export async function handleRecurring(c: Ctx, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();
  if (!action || action === 'list' || action === 'lihat') return showRecurring(c);
  if (['add', 'tambah', 'set'].includes(action)) {
    if (parts.length < 5) return send(c.chat, '❌ Format: <code>/recurring add Pengeluaran Tagihan 350000 5</code>', mainKb());
    const tipe = (parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase()) as Tx['tipe'];
    const day = parseInt(parts[parts.length - 1], 10);
    const nominal = parseNominal(parts[parts.length - 2]);
    if ((tipe !== 'Pemasukan' && tipe !== 'Pengeluaran') || !day || day < 1 || day > 31) {
      return send(c.chat, '❌ Tipe atau tanggal (1-31) tidak valid.', mainKb());
    }
    const nominalCheck = validateNominal(nominal);
    if (!nominalCheck.ok) return send(c.chat, `❌ ${nominalCheck.error}`, mainKb());
    const kategori = await resolveUserCategory(c.uid, tipe, parts.slice(2, -2).join(' '));
    const { error } = await sb.from('recurring').insert({ user_id: c.uid, tipe, kategori, nominal, keterangan: 'Auto via Telegram', day_of_month: day, active: true });
    if (error) throw error;
    return send(c.chat, `✅ <b>Recurring ditambahkan!</b> ${esc(kategori)} (${rp(nominal)}) tgl ${day}`, mainKb());
  }
  // Lihat ID lengkap (UUID) dari awalan — daftar ini hanya menampilkan,
  // tidak pernah bertindak. Hapus/toggle tetap butuh UUID lengkap.
  if ((action === 'id' || action === 'detail') && parts.length >= 2) {
    const rows = await fetchAll('recurring', 'id,kategori,nominal,active', c.uid, ['id']);
    const matches = rows.filter((r) => String(r.id).toLowerCase().startsWith(parts[1].toLowerCase()));
    if (matches.length === 0) return send(c.chat, '❌ Recurring tidak ditemukan untuk awalan itu.', mainKb());
    const lines = matches.map((r) => `• <b>${esc(r.kategori)}</b> · ${rp(Number(r.nominal))}${r.active ? '' : ' (nonaktif)'}\n  <code>${r.id}</code>`);
    return send(c.chat, `🔑 <b>ID lengkap (${matches.length})</b>\n\n${lines.join('\n')}\n\nSalin UUID di atas untuk <code>/recurring hapus</code> / <code>/recurring toggle</code>.`, mainKb());
  }
  if (['hapus', 'delete', 'toggle', 'aktif'].includes(action) && parts.length >= 2) {
    const input = parts[1];
    const rows = await fetchAll('recurring', 'id,kategori,nominal,active', c.uid, ['id']);
    // S14 (Gelombang 3.3): JANGAN PERNAH cocokkan by-prefix lalu bertindak
    // pada hasil pertama — dua recurring bisa berbagi 8 karakter pertama
    // dan hapus bisa mengenai tagihan yang salah. Prefix hanya boleh
    // DITOLAK (dengan petunjuk) atau DIDAFTAR; aksi butuh UUID lengkap.
    if (!UUID_RE.test(input)) {
      const matches = rows.filter((r) => String(r.id).toLowerCase().startsWith(input.toLowerCase()));
      if (matches.length === 0) {
        return send(c.chat, '❌ Recurring tidak ditemukan. Masukkan ID lengkap (UUID) — lihat lewat <code>/recurring id [awalan]</code>.', mainKb());
      }
      if (matches.length === 1) {
        return send(c.chat, `⚠️ ID tidak lengkap. Recurring yang cocok:\n• <b>${esc(matches[0].kategori)}</b>\n  <code>${matches[0].id}</code>\n\nSalin UUID lengkap di atas untuk melanjutkan.`, mainKb());
      }
      const lines = matches.map((r) => `• <b>${esc(r.kategori)}</b> · <code>${r.id}</code>`).join('\n');
      return send(c.chat, `⚠️ Awalan "<code>${esc(input)}</code>" cocok dengan ${matches.length} recurring — tidak ada yang diubah:\n\n${lines}\n\nSalin UUID lengkap salah satunya untuk melanjutkan.`, mainKb());
    }
    const found = rows.find((r) => String(r.id).toLowerCase() === input.toLowerCase());
    if (!found) return send(c.chat, '❌ Recurring tidak ditemukan', mainKb());
    const isDel = action === 'hapus' || action === 'delete';
    if (isDel) {
      // Konfirmasi dua langkah untuk hapus (destruktif): panggilan pertama
      // hanya menyimpan niat (kind 'confirm', 5 menit); penghapusan
      // terjadi hanya bila pengguna mengulang dengan kata 'ya'.
      const pending = await getTemp(c.chat, 'confirm');
      const confirmed = parts[2]?.toLowerCase() === 'ya' &&
        pending?.action === 'recurring_delete' && String(pending?.id).toLowerCase() === String(found.id).toLowerCase();
      if (!confirmed) {
        await setTemp(c.chat, 'confirm', { action: 'recurring_delete', id: found.id, kategori: found.kategori }, 300);
        return send(c.chat, `⚠️ Hapus recurring <b>${esc(found.kategori)}</b> (${rp(Number(found.nominal))})?\n\nKirim <code>/recurring hapus ${found.id} ya</code> untuk mengonfirmasi.`, mainKb());
      }
      await delTemp(c.chat, 'confirm');
    }
    const { error } = isDel
      ? await sb.from('recurring').delete().eq('id', found.id).eq('user_id', c.uid)
      : await sb.from('recurring').update({ active: !found.active }).eq('id', found.id).eq('user_id', c.uid);
    if (error) throw error;
    return send(c.chat, isDel ? `🗑️ <b>${esc(found.kategori)}</b> dihapus.` : `🔄 <b>${esc(found.kategori)}</b> ${found.active ? 'nonaktif ⚫' : 'aktif 🟢'}`, mainKb());
  }
  return send(c.chat, '❓ Gunakan <code>/recurring</code> untuk melihat daftar jadwal.', mainKb());
}
