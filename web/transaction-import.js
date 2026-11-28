// @depends-on: error-messages.js
(function (root) {
  'use strict';

  // Gelombang 5.3 (Q10): di Node, muat helper bersama agar
  // isValidIsoDate() tersedia (di browser error-messages.js sudah
  // dimuat pertama lewat build.mjs).
  if (typeof module !== 'undefined' && module.exports) {
    try { require('./error-messages.js'); } catch (_) { /* abaikan: fallback lokal di bawah */ }
  }

  // Wave 3.5 §9: batas ditegakkan DI PARSER (bukan hanya di UI/server).
  const MAX_DATA_ROWS = 500;
  const MAX_NOMINAL = 999999999999.99;

  // Gelombang 7c Item 4 — pemilih dompet impor CSV.
  // Dompet tujuan default: dompet utama bank (setting
  // primaryBankWalletId dari PR #2) bila ada DAN valid (masih ada di
  // daftar dompet dan berjenis bank); bila tidak ada/tidak valid,
  // dompet pertama dalam daftar — persis perilaku lama yang dikunci
  // tes bank-statement (dulu: selalu wallets[0]).
  function resolveDefaultImportWalletId(wallets, primaryBankWalletId) {
    const list = Array.isArray(wallets) ? wallets : [];
    const primaryId = typeof primaryBankWalletId === 'string' ? primaryBankWalletId.trim() : '';
    if (primaryId) {
      const primary = list.find((w) => String(w && w.id || '') === primaryId);
      if (primary && String(primary.kind || '') === 'bank') return String(primary.id || '');
    }
    return list.length ? String(list[0].id || '') : '';
  }

  // Pilihan eksplisit (dari pemilih dompet di UI impor) menang atas
  // default. Pilihan yang tidak valid (dompet terhapus / id asing)
  // TIDAK menggagalkan impor diam-diam dan TIDAK masuk ke dompet
  // yang salah: fallback ke default di atas dan laporkan lewat
  // walletFallback supaya UI menampilkan pesan yang jelas.
  function resolveImportTargetWallet(wallets, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const fallbackId = resolveDefaultImportWalletId(wallets, opts.primaryBankWalletId);
    const requested = typeof opts.targetWalletId === 'string' ? opts.targetWalletId.trim() : '';
    if (!requested) return { targetWalletId: fallbackId, walletFallback: null };
    const list = Array.isArray(wallets) ? wallets : [];
    if (list.some((w) => String(w && w.id || '') === requested)) {
      return { targetWalletId: requested, walletFallback: null };
    }
    return { targetWalletId: fallbackId, walletFallback: { requested, used: fallbackId } };
  }

  function isKnownImportCategory(rawCat, tipe, options) {
    const clean = String(rawCat || '').trim();
    if (!clean) return true;
    const categories = options && typeof options === 'object' ? options.categories : null;
    if (!categories) return true;
    const list = Array.isArray(categories)
      ? categories
      : [...(categories.pemasukan || []), ...(categories.pengeluaran || [])];
    if (!Array.isArray(list) || !list.length) return true;
    const targetKey = clean.toLocaleLowerCase();
    return list.some((c) => String(c || '').trim().toLocaleLowerCase() === targetKey);
  }

  function detectDelimiter(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 10);
    const countOutsideQuotes = (ch) => lines.reduce((sum, line) => {
      let count = 0;
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '"') quoted = !quoted;
        else if (!quoted && line[i] === ch) count += 1;
      }
      return sum + count;
    }, 0);
    const commas = countOutsideQuotes(',');
    const semis = countOutsideQuotes(';');
    const tabs = countOutsideQuotes('\t');
    if (tabs > commas && tabs >= semis) return '\t';
    if (semis > commas) return ';';
    return ',';
  }

  function parseRowsWithLineNumbers(text, explicitDelimiter) {
    if (typeof text !== 'string') throw new Error('File CSV tidak dapat dibaca sebagai teks.');
    const source = text.replace(/^\uFEFF/, '');
    const delimiter = explicitDelimiter || detectDelimiter(source);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let currentLine = 1;
    let rowStartLine = 1;

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
          if (character === '\n' || (character === '\r' && source[index + 1] !== '\n')) currentLine += 1;
        }
      } else if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === delimiter) {
        row.push(field);
        field = '';
      } else if (character === '\n' || character === '\r') {
        if (character === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((cell) => cell.trim() !== '')) rows.push({ cells: row, line: rowStartLine });
        currentLine += 1;
        row = [];
        field = '';
        rowStartLine = currentLine;
      } else {
        field += character;
      }
    }

    if (quoted) throw new Error('CSV memiliki tanda kutip yang tidak berpasangan.');
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push({ cells: row, line: rowStartLine });
    return rows;
  }

  function parseRows(text, explicitDelimiter) {
    return parseRowsWithLineNumbers(text, explicitDelimiter).map((entry) => entry.cells);
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
    // Gelombang 5.3 (Q10): validasi via isValidIsoDate() bersama
    // (komponen lokal) — BUKAN round-trip toISOString() (UTC).
    // Fallback lokal hanya bila modul dimuat sendiri tanpa helper.
    if (typeof isValidIsoDate === 'function') return isValidIsoDate(iso) ? iso : '';
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return date.getFullYear() === Number(yyyy) && date.getMonth() === Number(mm) - 1 && date.getDate() === Number(dd) ? iso : '';
  }

  function parseNumericToken(raw) {
    let clean = String(raw || '').trim()
      .replace(/^(?:Rp\.?|IDR)\s*/i, '')
      .replace(/(?:\d|\s|\)|\.|,)\s*(DB|CR)$/i, (m, s) => m.slice(0, m.length - s.length))
      .replace(/\s+/g, '');
    if (!clean) return NaN;
    let negative = false;
    if (/^\([^()]+\)$/.test(clean)) {
      negative = true;
      clean = clean.slice(1, -1);
    }
    clean = clean.replace(/^(?:Rp\.?|IDR)\s*/i, '');
    if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(clean)) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(clean)) {
      clean = clean.replace(/,/g, '');
    } else if (/^-?\d+,\d{1,2}$/.test(clean)) {
      clean = clean.replace(',', '.');
    }
    const num = Number(clean);
    return negative && Number.isFinite(num) ? -Math.abs(num) : num;
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
      if (/(?:^|\b|\d|\s|\)|\.|,)DB\s*$/i.test(amountRawStr) && !tipe) tipe = 'Pengeluaran';
      else if (/(?:^|\b|\d|\s|\)|\.|,)CR\s*$/i.test(amountRawStr) && !tipe) tipe = 'Pemasukan';
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
      String(transaction.keterangan || '').trim().toLocaleLowerCase(),
      transaction.walletId || ''
    ].join('\u001f');
  }

  function resolveImportAutoCategory(description, tipe, options) {
    if (!options || typeof options !== 'object') return '';
    if (!options.autoCategorize && !options.autoCategoryRules && !options.categories) return '';
    const opts = options;
    let fp = root && root.FinancePro ? root.FinancePro : null;
    if (!fp && typeof require === 'function') {
      try {
        fp = require('./finance-pro.js');
      } catch (_) {
        return '';
      }
    }
    if (fp && typeof fp.applyAutoCategoryRules === 'function') {
      return fp.applyAutoCategoryRules(description, tipe, opts.autoCategoryRules, opts.categories);
    }
    return '';
  }

  function resolveCsvColumns(headers) {
    const indexes = new Map();
    headers.forEach((header, index) => {
      if (header && indexes.has(header)) throw new Error('Kolom CSV duplikat: ' + header);
      if (header) indexes.set(header, index);
    });
    const pick = (candidates) => candidates.map((n) => indexes.get(n)).find((v) => v !== undefined);
    const cols = {
      dateCol: pick(['tanggal', 'date', 'tgl', 'posting date', 'transaction date']),
      typeCol: pick(['tipe', 'type', 'db/cr', 'mutasi tipe', 'jenis']),
      catCol: pick(['kategori', 'category']),
      amountCol: pick(['nominal', 'amount', 'mutasi', 'jumlah']),
      debitCol: pick(['debit', 'debet']),
      creditCol: pick(['kredit', 'credit']),
      descCol: pick(['keterangan', 'catatan', 'description', 'uraian', 'berita']),
      walletCol: pick(['dompet', 'nama_dompet', 'wallet'])
    };
    const isBankMutation = cols.debitCol !== undefined || cols.creditCol !== undefined ||
      indexes.has('db/cr') || indexes.has('mutasi') || indexes.has('uraian') || indexes.has('berita');
    if (cols.dateCol === undefined) throw new Error('Kolom wajib tidak ditemukan: tanggal');
    if (cols.amountCol === undefined && cols.debitCol === undefined && cols.creditCol === undefined) {
      throw new Error('Kolom wajib tidak ditemukan: nominal');
    }
    if (!isBankMutation && cols.typeCol === undefined) throw new Error('Kolom wajib tidak ditemukan: tipe');
    if (!isBankMutation && cols.catCol === undefined) throw new Error('Kolom wajib tidak ditemukan: kategori');
    return { ...cols, isBankMutation };
  }

  function canonicalizeImportCategory(rawCat, tipe, options) {
    const clean = String(rawCat || '').trim();
    if (!clean) return '';
    const categories = options && typeof options === 'object' ? options.categories : null;
    if (!categories) return clean;
    const list = Array.isArray(categories)
      ? categories
      : (tipe === 'Pemasukan'
        ? (categories.pemasukan || [])
        : (tipe === 'Pengeluaran'
          ? (categories.pengeluaran || [])
          : [...(categories.pengeluaran || []), ...(categories.pemasukan || [])]));
    if (!Array.isArray(list) || !list.length) return clean;
    const targetKey = clean.toLocaleLowerCase();
    return list.find((c) => String(c || '').trim().toLocaleLowerCase() === targetKey) || clean;
  }

  function parseCsvDataRow(cells, index, ctx, explicitLine) {
    const readIdx = (colIdx) => (colIdx === undefined ? '' : String(cells[colIdx] || '').trim());
    const { cols, walletByName, defaultWalletId, knownTransactions, fileTransactions, options, headerIndex } = ctx;
    const line = explicitLine || ((headerIndex || 0) + index + 2);
    const errors = [];
    const date = normalizeDateString(readIdx(cols.dateCol));
    const { amount, tipe } = parseAmountAndDirection(
      readIdx(cols.amountCol), readIdx(cols.typeCol), readIdx(cols.debitCol), readIdx(cols.creditCol)
    );
    const desc = readIdx(cols.descCol);
    const rawCatCell = readIdx(cols.catCol);
    const rawCat = canonicalizeImportCategory(rawCatCell, tipe, options);
    const autoCat = !rawCat && cols.isBankMutation ? resolveImportAutoCategory(desc, tipe, options) : '';
    const category = rawCat || autoCat || (cols.isBankMutation ? 'Lainnya' : '');
    const transaction = { tanggal: date, tipe, kategori: category, nominal: amount, keterangan: desc };

    if (!date) errors.push('Tanggal tidak valid (gunakan YYYY-MM-DD atau DD/MM/YYYY).');
    if (!transaction.tipe) errors.push('Tipe harus Pemasukan/CR atau Pengeluaran/DB.');
    if (!category) errors.push('Kategori wajib diisi.');
    // §9b: kategori eksplisit yang tidak ada di daftar user DITOLAK
    // per baris (dulu lolos apa adanya). Kategori hasil auto-categorize
    // / default 'Lainnya' untuk mutasi bank tidak kena aturan ini.
    if (rawCatCell && !isKnownImportCategory(rawCatCell, tipe, options)) {
      errors.push('Kategori tidak dikenal: ' + rawCatCell + ' (baris ' + line + ').');
    }
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Nominal harus berupa angka lebih dari 0.');
    if (Number.isFinite(amount) && amount > MAX_NOMINAL) errors.push('Nominal melebihi batas Rp 999.999.999.999,99 (baris ' + line + ').');
    // §9d: nominal negatif eksplisit (tanda minus) pada baris biasa
    // DITOLAK, bukan diam-diam dibalik jadi Pengeluaran. Notasi mutasi
    // bank tetap berlaku: tanda kurung akuntansi (150.000), akhiran
    // DB/CR, dan kolom Debit/Kredit — itu penanda arah dari file
    // banknya sendiri, bukan input minus dari user.
    const amountCell = readIdx(cols.amountCol);
    const amountToken = parseNumericToken(amountCell);
    const hasBankDirection = cols.debitCol !== undefined || cols.creditCol !== undefined
      || /(?:DB|CR)\s*$/i.test(amountCell) || /^\(.*\)$/.test(amountCell.trim());
    if (Number.isFinite(amountToken) && amountToken < 0 && !hasBankDirection) {
      errors.push('Nominal negatif tidak diizinkan, tulis nominal positif dan isi kolom tipe (baris ' + line + ').');
    }

    const walletName = readIdx(cols.walletCol);
    if (cols.walletCol !== undefined) {
      // §9c: kolom dompet ADA tapi sel kosong -> error per baris,
      // bukan diam-diam dompet pertama.
      if (!walletName) {
        errors.push('Dompet wajib diisi (baris ' + line + ').');
      } else {
        const wallet = walletByName.get(walletName.toLocaleLowerCase());
        if (!wallet) errors.push('Dompet tidak ditemukan: ' + walletName);
        else transaction.walletId = String(wallet.id || '');
      }
    } else {
      // Berkas mutasi bank tidak punya kolom dompet: memakai dompet
      // tujuan impor (pilihan pengguna di UI, atau default =
      // dompet utama bank bila valid, bila tidak dompet pertama =
      // perilaku lama yang dikunci tes bank-statement). Pemilih
      // dompet di UI impor (Gelombang 7c Item 4) menutup
      // penyimpangan §9c yang dulu didokumentasikan di sini.
      transaction.walletId = defaultWalletId;
    }

    let duplicate = false;
    if (errors.length === 0) {
      const key = fingerprint(transaction);
      duplicate = knownTransactions.has(key) || fileTransactions.has(key);
      fileTransactions.add(key);
    }
    return { line, transaction, errors, duplicate };
  }

  function findHeaderRowIndex(rows) {
    const limit = Math.min(rows.length, 30);
    for (let i = 0; i < limit; i += 1) {
      const headers = rows[i].map((header) => header.trim().toLocaleLowerCase());
      try {
        return { cols: resolveCsvColumns(headers), headerIndex: i };
      } catch (_) {
        /* try next candidate row */
      }
    }
    return { cols: resolveCsvColumns(rows[0].map((header) => header.trim().toLocaleLowerCase())), headerIndex: 0 };
  }

  function parseTransactionCsv(text, existingTransactions, wallets, options) {
    const rowEntries = parseRowsWithLineNumbers(text);
    if (rowEntries.length < 1) throw new Error('File CSV kosong.');
    const { cols, headerIndex } = findHeaderRowIndex(rowEntries.map((entry) => entry.cells));

    const walletList = wallets || [];
    const walletByName = new Map(walletList.map((w) => [String(w.name || '').trim().toLocaleLowerCase(), w]));
    // Gelombang 7c Item 4: dompet tujuan impor ditentukan DI SINI,
    // sebelum satu baris pun diproses — pilihan eksplisit dari UI,
    // atau default (dompet utama bank bila valid, bila tidak dompet
    // pertama = perilaku lama). Baris yang membawa kolom dompet
    // sendiri tetap memakai dompet dari file (§9c, tidak berubah);
    // dompet tujuan berlaku untuk semua baris TANPA kolom dompet —
    // yaitu setiap baris mutasi bank, kasus yang diperbaiki item ini.
    const target = resolveImportTargetWallet(walletList, options);
    const ctx = {
      cols,
      headerIndex,
      walletByName,
      defaultWalletId: target.targetWalletId,
      knownTransactions: new Set((existingTransactions || []).map(fingerprint)),
      fileTransactions: new Set(),
      options: options || {}
    };

    const parsedRows = rowEntries.slice(headerIndex + 1);
    // §9a: batas 500 BARIS DATA (setelah header) ditegakkan di sini.
    // Dulu limit hanya hidup di UI (yang menghitung SEMUA baris
    // termasuk preamble/header, sehingga 15 preamble + 500 data
    // ditolak keliru) dan di server (tolak grosir tanpa nomor baris).
    if (parsedRows.length > MAX_DATA_ROWS) {
      throw new Error('File CSV melebihi batas 500 baris data (ditemukan ' + parsedRows.length + ' baris data setelah header).');
    }
    const parsed = parsedRows.map((entry, index) => parseCsvDataRow(entry.cells, index, ctx, entry.line));
    const valid = parsed.filter((item) => item.errors.length === 0 && !item.duplicate).map((item) => item.transaction);
    return {
      rows: parsed,
      valid,
      duplicateCount: parsed.filter((item) => item.duplicate).length,
      invalidCount: parsed.filter((item) => item.errors.length > 0).length,
      targetWalletId: target.targetWalletId,
      walletFallback: target.walletFallback,
      hasWalletColumn: cols.walletCol !== undefined
    };
  }

  const api = { parseRows, parseTransactionCsv, normalizeDateString, parseAmountAndDirection, resolveDefaultImportWalletId, resolveImportTargetWallet, MAX_DATA_ROWS, MAX_NOMINAL };
  root.TransactionImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
