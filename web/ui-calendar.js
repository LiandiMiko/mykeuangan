/* global DB, FinanceAnalysis, Swal, formatRupiah, escapeHtmlJS, escapeAttrJS, renderHtml, getSwalClass, getPeriodRange, getMonthName, getMonthShort, openForm, walletName, t, mkActionAttrs */
/* ============================================================
   CALENDAR VIEW
   ============================================================ */
(function (root) {
  'use strict';

  root.kalenderYear = null;
  root.kalenderMonth = null;
  root.calendarFilter = 'all';

  function initKalenderState() {
    const now = new Date();
    if (root.kalenderYear === null || root.kalenderMonth === null) {
      const periodParts = /^(\d{4})-(\d{2})$/.exec(String(DB.currentPeriod || ''));
      if (periodParts) {
        root.kalenderYear = Number(periodParts[1]);
        root.kalenderMonth = Number(periodParts[2]);
      } else {
        root.kalenderYear = now.getFullYear();
        root.kalenderMonth = now.getMonth() + 1;
      }
    }
  }

  function kalenderPrev() {
    initKalenderState();
    root.kalenderMonth--;
    if (root.kalenderMonth < 1) {
      root.kalenderMonth = 12;
      root.kalenderYear--;
    }
    renderKalender();
  }

  function kalenderNext() {
    initKalenderState();
    root.kalenderMonth++;
    if (root.kalenderMonth > 12) {
      root.kalenderMonth = 1;
      root.kalenderYear++;
    }
    renderKalender();
  }

  function kalenderToday() {
    const now = new Date();
    root.kalenderYear = now.getFullYear();
    root.kalenderMonth = now.getMonth() + 1;
    renderKalender();
  }

  function setCalendarFilter(mode) {
    root.calendarFilter = mode || 'all';
    const buttons = [
      { el: document.getElementById('calFilterAll'), key: 'all' },
      { el: document.getElementById('calFilterOut'), key: 'out' },
      { el: document.getElementById('calFilterIn'), key: 'in' }
    ];
    buttons.forEach(({ el, key }) => {
      if (!el) return;
      const isActive = (mode || 'all') === key;
      el.classList.toggle('bg-white', isActive);
      el.classList.toggle('dark:bg-slate-900', isActive);
      el.classList.toggle('shadow-xs', isActive);
      el.classList.toggle('text-brand', isActive);
      el.classList.toggle('dark:text-brand-ink', isActive);
      el.classList.toggle('text-slate-600', !isActive);
      el.classList.toggle('dark:text-slate-300', !isActive);
      el.setAttribute('aria-pressed', String(isActive));
    });
    renderKalender();
  }

  function formatShortIDR(n) {
    if (root.hideNominal) return '•••';
    const val = Math.abs(Math.round(Number(n) || 0));
    if (val >= 1000000000) return (val / 1000000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (val >= 1000000) return (val / 1000000).toFixed(1).replace(/\.0$/, '') + 'jt';
    if (val >= 1000) return (val / 1000).toFixed(val >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'rb';
    return String(val);
  }

  function aggregateCalendarTransactions(period) {
    const txs = (DB.transactions || []).filter((tx) => String(tx.tanggal || '').startsWith(period));
    const byDay = {};
    txs.forEach((tx) => {
      const day = Number(String(tx.tanggal).slice(8, 10));
      if (!byDay[day]) {
        byDay[day] = { inAmt: 0, outAmt: 0, flowIn: 0, flowOut: 0, inCount: 0, outCount: 0, count: 0 };
      }
      const amt = Number(tx.nominal) || 0;
      const cat = String(tx.kategori || '');
      const isDebt = typeof FinanceAnalysis !== 'undefined' && typeof FinanceAnalysis.isDebtCategory === 'function'
        ? FinanceAnalysis.isDebtCategory(cat)
        : (cat.startsWith('Utang') || cat.startsWith('Piutang'));
      if (tx.tipe === 'Pemasukan') {
        byDay[day].inAmt += amt;
        if (!isDebt) byDay[day].flowIn += amt;
        byDay[day].inCount++;
      } else {
        byDay[day].outAmt += amt;
        if (!isDebt) byDay[day].flowOut += amt;
        byDay[day].outCount++;
      }
      byDay[day].count++;
    });
    return byDay;
  }

  function updateCalendarHeader(year, month, period) {
    const labelEl = document.getElementById('kalenderMonthLabel');
    if (!labelEl) return;
    const monthLabel = (typeof getMonthName === 'function' ? getMonthName(month - 1) : period) + ' ' + year;
    if (DB.payrollDay > 1 && typeof getPeriodRange === 'function') {
      const range = getPeriodRange(period, DB.payrollDay);
      const s = new Date(range.start + 'T00:00:00');
      const e = new Date(range.end + 'T00:00:00');
      const shortMonth = typeof getMonthShort === 'function' ? getMonthShort : (i) => String(i + 1).padStart(2, '0');
      const cycleLabel = s.getDate() + ' ' + shortMonth(s.getMonth()) + ' - ' +
        e.getDate() + ' ' + shortMonth(e.getMonth());
      const cyclePrefix = typeof t === 'function' ? t('cal.siklus') : 'Siklus';
      renderHtml(labelEl, escapeHtmlJS(monthLabel) + ' · <span class="text-brand dark:text-brand-ink font-bold">' +
        escapeHtmlJS(cyclePrefix + ': ' + cycleLabel) + '</span>');
    } else {
      labelEl.textContent = monthLabel;
    }
  }

  function resolveDayBgClass(hasData, mode, net) {
    if (!hasData) return 'bg-white dark:bg-slate-900';
    if (mode === 'out') return 'bg-rose-50/70 dark:bg-rose-500/10';
    if (mode === 'in') return 'bg-emerald-50/70 dark:bg-emerald-500/10';
    if (net > 0) return 'bg-emerald-50/70 dark:bg-emerald-500/10';
    if (net < 0) return 'bg-rose-50/70 dark:bg-rose-500/10';
    return 'bg-amber-50/70 dark:bg-amber-500/10';
  }

  function buildCalendarDayCell(d, period, data, mode, isToday) {
    const net = data.inAmt - data.outAmt;
    const showIn = mode === 'all' || mode === 'in';
    const showOut = mode === 'all' || mode === 'out';
    const activeAmt = mode === 'out' ? data.outAmt : (mode === 'in' ? data.inAmt : (data.inAmt > 0 || data.outAmt > 0));
    const hasData = Boolean(activeAmt);
    const visibleCount = mode === 'out' ? data.outCount : (mode === 'in' ? data.inCount : data.count);
    const bgClass = resolveDayBgClass(hasData, mode, net);
    const dateStr = period + '-' + String(d).padStart(2, '0');

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'text-left align-top min-h-[58px] sm:min-h-[82px] p-1 sm:p-2 border-b border-r border-slate-100 dark:border-slate-800/60 relative transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/60 focus-visible:ring-2 focus-visible:ring-brand ' + bgClass;
    const summaryLabel = mode === 'out'
      ? ('Keluar: ' + formatRupiah(data.outAmt))
      : (mode === 'in' ? ('Masuk: ' + formatRupiah(data.inAmt)) : ('Net: ' + formatRupiah(net)));
    cell.title = hasData ? (visibleCount + ' transaksi · ' + summaryLabel) : ('Lihat atau tambah transaksi ' + dateStr);
    cell.setAttribute('aria-label', dateStr + (hasData ? (', ' + visibleCount + ' transaksi') : ''));
    cell.addEventListener('click', () => openCalendarDayModal(dateStr));

    let html = '<div class="flex items-center justify-between mb-1">' +
      '<span class="text-[11px] sm:text-xs font-bold ' +
      (isToday ? 'w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-brand text-white inline-flex items-center justify-center' : 'text-slate-700 dark:text-slate-200') + '">' + d + '</span>';
    if (hasData) html += '<span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">' + visibleCount + 'x</span>';
    html += '</div>';

    if (hasData) {
      if (showIn && data.inAmt > 0) {
        html += '<p class="text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-400 leading-tight truncate tabular-nums">+' + formatShortIDR(data.inAmt) + '</p>';
      }
      if (showOut && data.outAmt > 0) {
        html += '<p class="text-[10px] sm:text-[11px] font-bold text-rose-600 dark:text-rose-400 leading-tight truncate tabular-nums">−' + formatShortIDR(data.outAmt) + '</p>';
      }
      if (mode === 'all' && data.inAmt > 0 && data.outAmt > 0) {
        html += '<p class="hidden sm:block text-[11px] font-black mt-0.5 tabular-nums ' +
          (net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400') + '">= ' +
          (net >= 0 ? '+' : '−') + formatShortIDR(Math.abs(net)) + '</p>';
      }
    }
    renderHtml(cell, html);
    return cell;
  }

  function updateCalendarFooterTotals(totalIn, totalOut) {
    const elIn = document.getElementById('kalenderTotalIn');
    const elOut = document.getElementById('kalenderTotalOut');
    const elNet = document.getElementById('kalenderTotalNet');
    const net = totalIn - totalOut;
    if (elIn) elIn.textContent = formatRupiah(totalIn);
    if (elOut) elOut.textContent = formatRupiah(totalOut);
    if (elNet) {
      elNet.textContent = formatRupiah(net);
      elNet.className = 'text-sm sm:text-base font-black truncate tabular-nums ' +
        (net > 0 ? 'text-emerald-600 dark:text-emerald-500'
          : net < 0 ? 'text-rose-600 dark:text-rose-500' : 'text-slate-700 dark:text-white');
    }
  }

  function renderKalender() {
    const grid = document.getElementById('kalenderGrid');
    if (!grid) {
      console.warn('[Kalender] grid element tidak ditemukan');
      return;
    }

    initKalenderState();
    grid.innerHTML = '';
    grid.classList.add('grid', 'grid-cols-7');

    const year = root.kalenderYear;
    const month = root.kalenderMonth;
    const period = year + '-' + String(month).padStart(2, '0');
    const byDay = aggregateCalendarTransactions(period);
    updateCalendarHeader(year, month, period);

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const rawDow = firstDay.getDay();
    const firstDayOfWeek = rawDow === 0 ? 6 : rawDow - 1;
    const emptyCellClass = 'min-h-[62px] sm:min-h-[82px] border-b border-r border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/40';

    for (let i = 0; i < firstDayOfWeek; i++) {
      const empty = document.createElement('div');
      empty.className = emptyCellClass;
      grid.appendChild(empty);
    }

    const now = new Date();
    const isCurrentMonthView = now.getFullYear() === year && (now.getMonth() + 1) === month;
    const todayDate = now.getDate();
    const mode = root.calendarFilter || 'all';
    let totalIn = 0;
    let totalOut = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const data = byDay[d] || { inAmt: 0, outAmt: 0, flowIn: 0, flowOut: 0, inCount: 0, outCount: 0, count: 0 };
      totalIn += data.flowIn;
      totalOut += data.flowOut;
      grid.appendChild(buildCalendarDayCell(d, period, data, mode, isCurrentMonthView && d === todayDate));
    }

    const remaining = (7 - ((firstDayOfWeek + daysInMonth) % 7)) % 7;
    for (let i = 0; i < remaining; i++) {
      const empty = document.createElement('div');
      empty.className = emptyCellClass;
      grid.appendChild(empty);
    }

    updateCalendarFooterTotals(totalIn, totalOut);
  }

  function openFormForDate(dateStr, tipe) {
    Swal.close();
    openForm(tipe || 'Pengeluaran');
    if (root.fpTanggal) {
      try { root.fpTanggal.setDate(dateStr, true); } catch (_) { /* ignore */ }
    }
    const el = document.getElementById('tr_tanggal');
    if (el) el.value = dateStr;
  }

  function openCalendarDayModal(dateStr) {
    const dayTxs = (DB.transactions || []).filter((tx) => String(tx.tanggal).slice(0, 10) === dateStr);
    const rowsHtml = dayTxs.length
      ? dayTxs.map((tx) => {
        const isIn = tx.tipe === 'Pemasukan';
        const color = isIn ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
        const sign = isIn ? '+' : '-';
        const idAttr = escapeAttrJS(tx.id);
        return `
          <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 text-xs">
            <div class="min-w-0 text-left">
              <p class="font-bold text-slate-800 dark:text-white truncate">${escapeHtmlJS(tx.kategori)}</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtmlJS(tx.keterangan || walletName(tx.walletId) || '-')}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="font-black tabular-nums ${color}">${sign}${formatRupiah(tx.nominal).replace(',00', '')}</span>
              <button type="button" ${mkActionAttrs('swalClose|editTransaction', [tx.id])} aria-label="Edit transaksi" class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center"><i class="ph ph-pencil" aria-hidden="true"></i></button>
              <button type="button" ${mkActionAttrs('swalClose|deleteTransaction', [tx.id])} aria-label="Hapus transaksi" class="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center"><i class="ph ph-trash" aria-hidden="true"></i></button>
            </div>
          </div>`;
      }).join('')
      : '<p class="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">Belum ada transaksi pada tanggal ini.</p>';

    Swal.fire({
      title: 'Transaksi · ' + dateStr,
      html: `<div class="space-y-2 max-h-64 overflow-y-auto">${rowsHtml}</div>`,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '+ Pengeluaran',
      denyButtonText: '+ Pemasukan',
      denyButtonColor: '#059669',
      cancelButtonText: t('btn.tutup'),
      customClass: { popup: getSwalClass() }
    }).then((res) => {
      if (res.isConfirmed) openFormForDate(dateStr, 'Pengeluaran');
      else if (res.isDenied) openFormForDate(dateStr, 'Pemasukan');
    });
  }

  Object.assign(root, {
    initKalenderState,
    kalenderPrev,
    kalenderNext,
    kalenderToday,
    setCalendarFilter,
    renderKalender,
    formatShortIDR,
    openFormForDate,
    openCalendarDayModal
  });
})(typeof window !== 'undefined' ? window : globalThis);
