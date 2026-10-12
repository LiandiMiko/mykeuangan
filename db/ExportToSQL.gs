/************************************************************
 * ExportToSQL.gs — Ekspor SEKALI data MyKeuanganGuech → file SQL
 *
 * Cara pakai:
 *  1. Tambahkan file ini ke project Apps Script yang sama
 *     (butuh SS, readSheet, readAllCycleTransactions, getAllChatIds
 *     dari Code.gs / Telegram.gs).
 *  2. Isi EXPORT_EMAIL dengan email akun Supabase Auth Anda
 *     (akun harus sudah dibuat dulu di Supabase → Authentication).
 *  3. Jalankan exportToSQL(), setujui izin Drive.
 *  4. Buka file "mykeuangan_migrasi.sql" di Google Drive, salin isinya
 *     ke Supabase → SQL Editor, lalu Run (setelah schema.sql).
 *  5. HAPUS file .sql dari Drive setelah selesai (isinya data keuangan).
 ************************************************************/

const EXPORT_EMAIL = 'GANTI_DENGAN_EMAIL_AKUN_SUPABASE_ANDA';

function exportToSQL() {
  if (EXPORT_EMAIL.indexOf('GANTI_') === 0) {
    throw new Error('Isi EXPORT_EMAIL dulu.');
  }

  const tz = SS.getSpreadsheetTimeZone();

  // ---------- helper format literal SQL ----------
  const q = v => "'" + String(v === null || v === undefined ? '' : v).replace(/'/g, "''") + "'";
  const num = v => { const x = Number(v); return isFinite(x) ? String(x) : '0'; };
  const dstr = v => (v instanceof Date)
    ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
    : String(v || '').slice(0, 10);
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // rows = array of array literal SQL (tanpa user_id; ditambahkan otomatis)
  function insertBlocks(table, cols, rows, onConflict) {
    return chunk(rows, 200).map(c =>
      'insert into public.' + table + ' (' + cols + ', user_id) values\n' +
      c.map(r => '  (' + r.join(', ') + ', v_user)').join(',\n') +
      (onConflict ? '\n' + onConflict : '') + ';'
    ).join('\n');
  }

  // ---------- baca data ----------
  const payrollDay = getPayrollDay();

  const trxAll = readAllCycleTransactions();
  const trx = trxAll.filter(t =>
    validDate(dstr(t.tanggal)) &&
    (t.tipe === 'Pemasukan' || t.tipe === 'Pengeluaran') &&
    String(t.kategori || '').trim() !== ''
  );
  const trxSkipped = trxAll.length - trx.length;

  const cats = readSheet('categories').filter(c =>
    (c.tipe === 'pemasukan' || c.tipe === 'pengeluaran') && String(c.name || '').trim() !== '');
  const ents = readSheet('entities').filter(e =>
    ['UtangApp', 'UtangPerson', 'Piutang'].indexOf(e.group) >= 0 && String(e.name || '').trim() !== '');
  const assets = readSheet('assets').filter(a => String(a.name || '').trim() !== '');
  const budgets = readSheet('budgets').filter(b =>
    String(b.kategori || '').trim() !== '' && /^\d{4}-\d{2}$/.test(String(b.bulan || '')));
  const snaps = readSheet('snapshots').filter(s => validDate(dstr(s.tanggal)));
  const recs = readSheet('recurring').filter(r =>
    String(r.kategori || '').trim() !== '' &&
    (r.tipe === 'Pemasukan' || r.tipe === 'Pengeluaran'));

  // ---------- rakit SQL ----------
  const parts = [];

  parts.push(
    'do $$\n' +
    'declare v_user uuid;\n' +
    'begin\n' +
    '  select id into strict v_user from auth.users where email = ' + q(EXPORT_EMAIL) + ';\n' +
    '  if exists (select 1 from public.transactions where user_id = v_user) then\n' +
    "    raise exception 'Tabel transactions sudah berisi data, migrasi dibatalkan (hindari dobel).';\n" +
    '  end if;\n'
  );

  parts.push(
    "insert into public.settings (key, value, user_id) values ('payrollDay', " +
    q(String(payrollDay)) + ', v_user) on conflict (user_id, key) do update set value = excluded.value;'
  );

  if (cats.length) parts.push(insertBlocks('categories', 'tipe, name',
    cats.map(c => [q(c.tipe), q(c.name)]), 'on conflict do nothing'));

  if (ents.length) parts.push(insertBlocks('entities', 'grp, name',
    ents.map(e => [q(e.group), q(e.name)]), 'on conflict do nothing'));

  if (trx.length) parts.push(insertBlocks('transactions',
    'legacy_id, tanggal, tipe, kategori, nominal, keterangan, source',
    trx.map(t => [
      t.id ? q(t.id) : 'null',
      q(dstr(t.tanggal)),
      q(t.tipe),
      q(t.kategori),
      num(t.nominal),
      q(t.keterangan),
      q('import')
    ])));

  if (assets.length) parts.push(insertBlocks('assets',
    'name, type, symbol, quantity, buy_price, value',
    assets.map(a => [
      q(a.name), q(a.type || 'Other'), q(a.symbol),
      num(a.quantity), num(a.buyPrice), num(a.value)
    ])));

  if (budgets.length) parts.push(insertBlocks('budgets', 'kategori, bulan, jumlah',
    budgets.map(b => [q(b.kategori), q(String(b.bulan).slice(0, 7)), num(b.jumlah)]),
    'on conflict do nothing'));

  if (snaps.length) parts.push(insertBlocks('portfolio_snapshots',
    'tanggal, total_value, crypto_value, cash_value, other_value',
    snaps.map(s => [
      q(dstr(s.tanggal)), num(s.total_value), num(s.crypto_value),
      num(s.cash_value), num(s.other_value)
    ]),
    'on conflict do nothing'));

  if (recs.length) parts.push(insertBlocks('recurring',
    'tipe, kategori, nominal, keterangan, day_of_month, last_run, active',
    recs.map(r => {
      const last = dstr(r.lastRun);
      const day = Math.min(31, Math.max(1, Number(r.dayOfMonth) || 1));
      return [
        q(r.tipe), q(r.kategori), num(r.nominal), q(r.keterangan),
        String(day),
        validDate(last) ? q(last) : 'null',
        String(String(r.active).toLowerCase() === 'true')
      ];
    })));

  parts.push('end $$;');

  // ---------- chat ID (TIDAK dimigrasi otomatis) ----------
  // Di versi lama, siapa pun yang pernah chat ke bot ikut tersimpan.
  // Pilih sendiri chat_id milik Anda, lalu jalankan manual di Supabase:
  //   insert into public.telegram_chats (chat_id, name, user_id)
  //   values (<chat_id_anda>, 'Nama', (select id from auth.users where email = '...'));
  let chatInfo = [];
  try { chatInfo = getAllChatIds(); } catch (e) {}

  // ---------- ringkasan untuk verifikasi ----------
  const sum = (arr, tipe) => arr.filter(t => t.tipe === tipe)
    .reduce((s, t) => s + (Number(t.nominal) || 0), 0);

  const header = [
    '-- MyKeuanganGuech — migrasi data (dibuat ' + new Date().toISOString() + ')',
    '-- RINGKASAN (bandingkan dengan hasil query verifikasi di Supabase):',
    '--   transaksi      : ' + trx.length + ' (dilewati karena tidak valid: ' + trxSkipped + ')',
    '--   total pemasukan  : ' + sum(trx, 'Pemasukan'),
    '--   total pengeluaran: ' + sum(trx, 'Pengeluaran'),
    '--   kategori: ' + cats.length + ' | entitas: ' + ents.length + ' | aset: ' + assets.length +
      ' | budget: ' + budgets.length + ' | snapshot: ' + snaps.length + ' | recurring: ' + recs.length,
    '--   payrollDay     : ' + payrollDay,
    '--',
    '-- Chat ID yang pernah memakai bot lama (pilih milik Anda saja):',
    chatInfo.map(c => '--   ' + c.chatId + '  (' + c.name + ')').join('\n') || '--   (tidak ada)',
    '--',
    '-- Query verifikasi setelah import:',
    '--   select tipe, count(*), sum(nominal) from public.transactions group by tipe;',
    ''
  ].join('\n');

  const sql = header + '\n' + parts.join('\n\n') + '\n';

  const file = DriveApp.createFile('mykeuangan_migrasi.sql', sql, MimeType.PLAIN_TEXT);
  Logger.log('✅ File dibuat: ' + file.getUrl());
  Logger.log(header);
  Logger.log('Ukuran SQL: ' + Math.round(sql.length / 1024) + ' KB');
  Logger.log('⚠️ Hapus file ini dari Drive setelah migrasi selesai.');
}
