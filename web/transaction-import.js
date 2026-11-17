(function (root) {
  'use strict';

  function parseRows(text) {
    if (typeof text !== 'string') throw new Error('File CSV tidak dapat dibaca sebagai teks.');
    const source = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === ',') {
        row.push(field);
        field = '';
      } else if (character === '\n' || character === '\r') {
        if (character === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((cell) => cell.trim() !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += character;
      }
    }

    if (quoted) throw new Error('CSV memiliki tanda kutip yang tidak berpasangan.');
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    return rows;
  }

  function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function fingerprint(transaction) {
    return [
      transaction.tanggal,
      transaction.tipe,
      String(transaction.kategori || '').trim().toLocaleLowerCase(),
      Number(transaction.nominal),
      String(transaction.keterangan || '').trim(),
      transaction.walletId || ''
    ].join('\u001f');
  }

  function parseTransactionCsv(text, existingTransactions, wallets) {
    const rows = parseRows(text);
    if (rows.length < 1) throw new Error('File CSV kosong.');

    const headers = rows[0].map((header) => header.trim().toLocaleLowerCase());
    const indexes = new Map();
    headers.forEach((header, index) => {
      if (header && indexes.has(header)) throw new Error('Kolom CSV duplikat: ' + header);
      if (header) indexes.set(header, index);
    });
    ['tanggal', 'tipe', 'kategori', 'nominal'].forEach((required) => {
      if (!indexes.has(required)) throw new Error('Kolom wajib tidak ditemukan: ' + required);
    });

    const walletList = wallets || [];
    const walletByName = new Map(walletList.map((wallet) => [
      String(wallet.name || '').trim().toLocaleLowerCase(),
      wallet
    ]));
    const defaultWalletId = walletList.length ? String(walletList[0].id || '') : '';
    const knownTransactions = new Set((existingTransactions || []).map(fingerprint));
    const fileTransactions = new Set();
    const parsedRows = rows.slice(1).map((cells, index) => {
      const cell = (name) => {
        const column = indexes.get(name);
        return column === undefined ? '' : String(cells[column] || '').trim();
      };
      const line = index + 2;
      const errors = [];
      const date = cell('tanggal');
      const typeValue = cell('tipe').toLocaleLowerCase();
      const category = cell('kategori');
      const amountValue = cell('nominal').replace(/^Rp\s*/i, '').replace(/\s/g, '');
      const amount = Number(amountValue);
      const transaction = {
        tanggal: date,
        tipe: typeValue === 'pemasukan' ? 'Pemasukan' :
          typeValue === 'pengeluaran' ? 'Pengeluaran' : '',
        kategori: category,
        nominal: amount,
        keterangan: cell('keterangan')
      };

      if (!isValidDate(date)) errors.push('Tanggal harus berformat YYYY-MM-DD dan valid.');
      if (!transaction.tipe) errors.push('Tipe harus Pemasukan atau Pengeluaran.');
      if (!category) errors.push('Kategori wajib diisi.');
      if (!Number.isFinite(amount) || amount <= 0) errors.push('Nominal harus berupa angka lebih dari 0.');

      const walletName = cell('dompet') || cell('nama_dompet');
      if (walletName) {
        const wallet = walletByName.get(walletName.toLocaleLowerCase());
        if (!wallet) errors.push('Dompet tidak ditemukan: ' + walletName);
        else transaction.walletId = String(wallet.id || '');
      } else {
        transaction.walletId = defaultWalletId;
      }

      let duplicate = false;
      if (errors.length === 0) {
        const key = fingerprint(transaction);
        duplicate = knownTransactions.has(key) || fileTransactions.has(key);
        fileTransactions.add(key);
      }
      return { line, transaction, errors, duplicate };
    });

    const valid = parsedRows
      .filter((item) => item.errors.length === 0 && !item.duplicate)
      .map((item) => item.transaction);
    return {
      rows: parsedRows,
      valid,
      duplicateCount: parsedRows.filter((item) => item.duplicate).length,
      invalidCount: parsedRows.filter((item) => item.errors.length > 0).length
    };
  }

  const api = { parseRows, parseTransactionCsv };
  root.TransactionImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
