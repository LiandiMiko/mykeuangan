/* global sessionUser, Swal, _origFormatRupiah, getSwalClass, walletName, getFilteredReportTransactions */
/* ============================================================
   CSV & PDF EXPORTS
   ============================================================ */
(function (root) {
  'use strict';

  function csvEscapeCell(val) {
    const s = String(val == null ? '' : val);
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }

  function exportCSV() {
    const en = localStorage.getItem('lang') === 'en';
    const { txs, period } = getFilteredReportTransactions();
    if (txs.length === 0) {
      Swal.fire({ icon: 'warning', title: en ? 'Empty' : 'Kosong', text: en ? 'No data available to export' : 'Tidak ada data untuk diekspor', customClass: { popup: getSwalClass() } });
      return;
    }
    const header = ['tanggal', 'tipe', 'kategori', 'nominal', 'keterangan', 'dompet'];
    const lines = [header.join(',')].concat(
      txs.map((r) => [
        csvEscapeCell(r.tanggal),
        csvEscapeCell(r.tipe),
        csvEscapeCell(r.kategori),
        csvEscapeCell(r.nominal),
        csvEscapeCell(r.keterangan || ''),
        csvEscapeCell(walletName(r.walletId))
      ].join(','))
    );
    const filename = `Laporan_Keuangan_${sessionUser}_${period || 'All'}.csv`;
    const csvContent = '\ufeff' + lines.join('\r\n');
    if (typeof root.saveOrShareFile === 'function') {
      root.saveOrShareFile(csvContent, filename, 'text/csv;charset=utf-8');
      return;
    }
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function drawPdfHeader(doc, pageWidth, period) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42);
    doc.text('MyKeuGuech', 14, 22);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('Laporan Transaksi Finansial', 14, 28);

    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Pengguna: ${sessionUser}`, pageWidth - 14, 22, { align: 'right' });
    doc.text(`Periode: ${period || 'Semua Waktu'}`, pageWidth - 14, 28, { align: 'right' });
    doc.text(`Dicetak: ${new Date().toLocaleDateString('id-ID')}`, pageWidth - 14, 34, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(14, 40, pageWidth - 14, 40);
  }

  function drawPdfSummaryCards(doc, totalMasuk, totalKeluar, selisih) {
    doc.setFillColor(236, 253, 245);
    doc.roundedRect(14, 46, 56, 22, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(5, 150, 105);
    doc.text('TOTAL PEMASUKAN', 18, 54);
    doc.setFontSize(12);
    doc.text(_origFormatRupiah(totalMasuk).replace(',00', ''), 18, 62);

    doc.setFillColor(255, 241, 242);
    doc.roundedRect(74, 46, 56, 22, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(225, 29, 72);
    doc.text('TOTAL PENGELUARAN', 78, 54);
    doc.setFontSize(12);
    doc.text(_origFormatRupiah(totalKeluar).replace(',00', ''), 78, 62);

    const isSurplus = selisih >= 0;
    doc.setFillColor(isSurplus ? 239 : 255, isSurplus ? 246 : 241, isSurplus ? 255 : 242);
    doc.roundedRect(134, 46, 62, 22, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(isSurplus ? 37 : 225, isSurplus ? 99 : 29, isSurplus ? 235 : 72);
    doc.text('SURPLUS / DEFISIT', 138, 54);
    doc.setFontSize(12);
    doc.text(`${isSurplus ? '+' : ''}${_origFormatRupiah(selisih).replace(',00', '')}`, 138, 62);
  }

  function exportPDF() {
    const en = localStorage.getItem('lang') === 'en';
    const { txs, period } = getFilteredReportTransactions();
    if (txs.length === 0) {
      Swal.fire({ icon: 'warning', title: en ? 'Empty' : 'Kosong', text: en ? 'No data available to export' : 'Tidak ada data untuk diekspor', customClass: { popup: getSwalClass() } });
      return;
    }
    if (!root.jspdf || !root.jspdf.jsPDF) {
      Swal.fire({ icon: 'info', title: en ? 'PDF module not ready' : 'Modul PDF belum siap', text: en ? 'Please wait a moment or reload the page.' : 'Tunggu beberapa detik atau muat ulang halaman.', customClass: { popup: getSwalClass() } });
      return;
    }

    const { jsPDF } = root.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();

    let totalMasuk = 0;
    let totalKeluar = 0;
    txs.forEach((r) => {
      const cat = String(r.kategori || '');
      if (cat.startsWith('Utang') || cat.startsWith('Piutang')) return;
      if (r.tipe === 'Pemasukan') totalMasuk += r.nominal;
      else totalKeluar += r.nominal;
    });

    drawPdfHeader(doc, pageWidth, period);
    drawPdfSummaryCards(doc, totalMasuk, totalKeluar, totalMasuk - totalKeluar);

    doc.autoTable({
      startY: 76,
      head: [['Tanggal', 'Tipe', 'Kategori', 'Dompet', 'Catatan', 'Nominal']],
      body: txs.map((r) => [
        r.tanggal, r.tipe, r.kategori, walletName(r.walletId), r.keterangan || '-',
        _origFormatRupiah(r.nominal).replace(',00', '')
      ]),
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', halign: 'center' },
      styles: { fontSize: 8.5, cellPadding: 4.5, font: 'helvetica' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 23 },
        1: { cellWidth: 22 },
        2: { cellWidth: 28 },
        3: { cellWidth: 24 },
        5: { halign: 'right', fontStyle: 'bold', cellWidth: 32 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 5) {
          const tipe = txs[data.row.index].tipe;
          data.cell.styles.textColor = tipe === 'Pemasukan' ? [5, 150, 105] : [225, 29, 72];
        }
      }
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Halaman ${i} dari ${pageCount} | Dicetak oleh MyKeuGuech`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
    }
    const pdfFilename = `Laporan_Keuangan_${sessionUser}_${period || 'All'}.pdf`;
    if (typeof root.isNativeApp === 'function' && root.isNativeApp() && typeof root.saveOrShareFile === 'function') {
      root.saveOrShareFile(doc.output('blob'), pdfFilename, 'application/pdf');
    } else {
      doc.save(pdfFilename);
    }
  }

  Object.assign(root, { csvEscapeCell, exportCSV, exportPDF });
})(typeof window !== 'undefined' ? window : globalThis);
