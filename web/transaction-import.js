(function (root) {
  'use strict';

  function detectDelimiter(text) {
    const firstLine = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
    const countOutsideQuotes = (ch) => {
      let count = 0;
      let quoted = false;
      for (let i = 0; i < firstLine.length; i += 1) {
        if (firstLine[i] === '"') quoted = !quoted;
        else if (!quoted && firstLine[i] === ch) count += 1;
      }
      return count;
    };
    const commas = countOutsideQuotes(',');
    const semis = countOutsideQuotes(';');
    const tabs = countOutsideQuotes('\t');
    if (tabs > commas && tabs >= semis) return '\t';
    if (semis > commas) return ';';
    return ',';
  }

  function parseRows(text, explicitDelimiter) {
    if (typeof text !== 'string') throw new Error('File CSV tidak dapat dibaca sebagai teks.');
    const source = text.replace(/^\uFEFF/, '');
    const delimiter = explicitDelimiter || detectDelimiter(source);
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
      } else if (character === delimiter) {
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

  function normalizeDateString(value) {
    const raw = String(value || '').trim().split(/\s+/)[0];
    if (!raw) return '';
    let yyyy = '', mm = '', dd = '';
    let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
    if (match) {
      [, yyyy, mm, dd] = match;
    } else {
      match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw);
      if (!match) return '';
      [, dd, mm, yyyy] = match;
    }
    const iso = yyyy + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0');
    const date = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
  }

  function parseNumericToken(raw) {
    let clean = String(raw || '').trim()
      .replace(/^Rp\.?\s*/i, '')
      .replace(/\s+(DB|CR)$/i, '')
      .replace(/\s+/g, '');
    if (!clean) return NaN;
    if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(clean)) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(clean)) {
      clean = clean.replace(/,/g, '');
    } else if (/^-?\d+,\d{1,2}$/.test(clean)) {
      clean = clean.replace(',', '.');
    }
    return Number(clean);
  }

  function parseAmountAndDirection(rawAmount, rawType, rawDebit, rawCredit) {
    const typeLower = String(rawType || '').trim().toLowerCase();
    const amountRawStr = String(rawAmount || '').trim();
    const debitVal = parseNumericToken(rawDebit);
    const creditVal = parseNumericToken(rawCredit);

    let tipe = '';
    if (['pemasukan', 'cr', 'credit', 'kredit', 'in', 'masuk'].includes(typeLower)) {
      tipe = 'Pemasukan';
    } else if (['pengeluaran', 'db', 'debit', 'debet', 'out', 'keluar'].includes(typeLower)) {
      tipe = 'Pengeluaran';
    }

    let amount = NaN;
    if (Number.isFinite(debitVal) && debitVal > 0 && !(Number.isFinite(creditVal) && creditVal > 0)) {
      amount = debitVal;
      if (!tipe) tipe = 'Pengeluaran';
    } else if (Number.isFinite(creditVal) && creditVal > 0 && !(Number.isFinite(debitVal) && debitVal > 0)) {
      amount = creditVal;
      if (!tipe) tipe = 'Pemasukan';
    } else if (amountRawStr) {
      if (/\bDB\s*$/i.test(amountRawStr) && !tipe) tipe = 'Pengeluaran';
      else if (/\bCR\s*$/i.test(amountRawStr) && !tipe) tipe = 'Pemasukan';
      const parsed = parseNumericToken(amountRawStr);
      if (Number.isFinite(parsed)) {
        if (parsed < 0) {
          amount = Math.abs(parsed);
          if (!tipe) tipe = 'Pengeluaran';
        } else {
          amount = parsed;
        }
      }
    }

    return { amount, tipe };
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

    const pickColumn = (candidates) => {
      for (const name of candidates) {
        if (indexes.has(name)) return indexes.get(name);
      }
      return undefined;
    };

    const dateCol = pickColumn(['tanggal', 'date', 'tgl', 'posting date', 'transaction date']);
    const typeCol = pickColumn(['tipe', 'type', 'db/cr', 'mutasi tipe', 'jenis']);
    const catCol = pickColumn(['kategori', 'category']);
    const amountCol = pickColumn(['nominal', 'amount', 'mutasi', 'jumlah']);
    const debitCol = pickColumn(['debit', 'debet']);
    const creditCol = pickColumn(['kredit', 'credit']);
    const descCol = pickColumn(['keterangan', 'catatan', 'description', 'uraian', 'berita']);
    const walletCol = pickColumn(['dompet', 'nama_dompet', 'wallet']);

    const isBankMutation = debitCol !== undefined || creditCol !== undefined ||
      indexes.has('db/cr') || indexes.has('mutasi') || indexes.has('uraian') || indexes.has('berita');

    if (dateCol === undefined) throw new Error('Kolom wajib tidak ditemukan: tanggal');
    if (amountCol === undefined && debitCol === undefined && creditCol === undefined) {
      throw new Error('Kolom wajib tidak ditemukan: nominal');
    }
    if (!isBankMutation) {
      if (typeCol === undefined) throw new Error('Kolom wajib tidak ditemukan: tipe');
      if (catCol === undefined) throw new Error('Kolom wajib tidak ditemukan: kategori');
    }

    const walletList = wallets || [];
    const walletByName = new Map(walletList.map((wallet) => [
      String(wallet.name || '').trim().toLocaleLowerCase(),
      wallet
    ]));
    const defaultWalletId = walletList.length ? String(walletList[0].id || '') : '';
    const knownTransactions = new Set((existingTransactions || []).map(fingerprint));
    const fileTransactions = new Set();

    const parsedRows = rows.slice(1).map((cells, index) => {
      const readIdx = (colIdx) => (colIdx === undefined ? '' : String(cells[colIdx] || '').trim());
      const line = index + 2;
      const errors = [];
      const date = normalizeDateString(readIdx(dateCol));
      const { amount, tipe } = parseAmountAndDirection(
        readIdx(amountCol),
        readIdx(typeCol),
        readIdx(debitCol),
        readIdx(creditCol)
      );
      const rawCat = readIdx(catCol);
      const category = rawCat || (isBankMutation ? 'Lainnya' : '');
      const transaction = {
        tanggal: date,
        tipe,
        kategori: category,
        nominal: amount,
        keterangan: readIdx(descCol)
      };

      if (!date) errors.push('Tanggal tidak valid (gunakan YYYY-MM-DD atau DD/MM/YYYY).');
      if (!transaction.tipe) errors.push('Tipe harus Pemasukan/CR atau Pengeluaran/DB.');
      if (!category) errors.push('Kategori wajib diisi.');
      if (!Number.isFinite(amount) || amount <= 0) errors.push('Nominal harus berupa angka lebih dari 0.');

      const walletName = readIdx(walletCol);
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

  const api = { parseRows, parseTransactionCsv, normalizeDateString, parseAmountAndDirection };
  root.TransactionImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
