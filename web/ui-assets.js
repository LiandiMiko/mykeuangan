// @depends-on: ui-state.js
/* global DB, Chart, Swal, callServer, refreshFromServer, formatRupiah, formatShortIDR, escapeHtmlJS, escapeAttrJS, renderHtml, getSwalClass, showActionError, mkActionAttrs, toUserErrorMessage, t */
/* ============================================================
   ASSETS & 30-DAY PORTFOLIO CHART
   ============================================================ */
(function (root) {
  'use strict';

  let portfolioChartInstance = null;

  function buildPortfolioDatasets(snapshots, brandColor) {
    return [
      {
        label: 'Total',
        data: snapshots.map((s) => s.total),
        borderColor: brandColor,
        backgroundColor: brandColor + '20',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6
      },
      {
        label: 'Crypto',
        data: snapshots.map((s) => s.crypto),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [5, 5],
        tension: 0.3,
        pointRadius: 2
      },
      {
        label: 'Cash',
        data: snapshots.map((s) => s.cash),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [5, 5],
        tension: 0.3,
        pointRadius: 2
      }
    ];
  }

  function buildPortfolioChartOptions(isDark, textColor, gridColor) {
    const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      responsive: true,
      maintainAspectRatio: false,
      ...(reduceMotion ? { animation: false } : {}),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: textColor,
            font: { family: 'Inter', size: 11, weight: '600' },
            padding: 15,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          backgroundColor: isDark ? '#1e293b' : '#0f172a',
          titleColor: '#fff',
          bodyColor: '#cbd5e1',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (context) => context.dataset.label + ': ' + formatRupiah(context.parsed.y || 0)
          }
        }
      },
      scales: {
        x: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, font: { family: 'Inter', size: 10 }, maxRotation: 0, autoSkipPadding: 20 }
        },
        y: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, font: { family: 'Inter', size: 10 }, callback: (value) => formatShortIDR(value) }
        }
      }
    };
  }

  function buildPortfolioChartConfig(snapshots) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const labels = snapshots.map((s) => {
      const d = new Date(s.tanggal + 'T00:00:00');
      return d.getDate() + ' ' + months[d.getMonth()];
    });
    const style = getComputedStyle(document.documentElement);
    const brandColor = style.getPropertyValue('--color-brand').trim() || '#7c3aed';
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.2)';
    const textColor = isDark ? '#cbd5e1' : '#475569';

    return {
      type: 'line',
      data: {
        labels,
        datasets: buildPortfolioDatasets(snapshots, brandColor)
      },
      options: buildPortfolioChartOptions(isDark, textColor, gridColor)
    };
  }

  function renderPortfolioChart() {
    const canvas = document.getElementById('portfolioChart');
    if (!canvas) return;
    const snapshots = DB.snapshots || [];
    const placeholder = document.getElementById('portfolioChartPlaceholder');

    if (snapshots.length < 2) {
      canvas.style.display = 'none';
      canvas.setAttribute('aria-label', 'Grafik tren nilai portfolio 30 hari terakhir. Belum ada cukup data (butuh minimal 2 hari).');
      if (placeholder) placeholder.style.display = 'flex';
      return;
    }

    canvas.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';

    if (portfolioChartInstance) {
      portfolioChartInstance.destroy();
      portfolioChartInstance = null;
    }
    portfolioChartInstance = new Chart(canvas.getContext('2d'), buildPortfolioChartConfig(snapshots));
    // Gelombang 6 (U20): ringkasan tren untuk screen reader, diperbarui tiap render.
    const firstTotal = Number(snapshots[0].total) || 0;
    const lastTotal = Number(snapshots[snapshots.length - 1].total) || 0;
    const totalPct = firstTotal > 0 ? Math.round(((lastTotal - firstTotal) / firstTotal) * 100) : 0;
    const totalDir = lastTotal > firstTotal ? 'naik' : (lastTotal < firstTotal ? 'turun' : 'tetap');
    canvas.setAttribute('aria-label', 'Grafik tren nilai portfolio 30 hari terakhir. Total ' +
      formatRupiah(firstTotal).replace(',00', '') + ' menjadi ' + formatRupiah(lastTotal).replace(',00', '') +
      ', ' + totalDir + ' ' + Math.abs(totalPct) + '%.');
  }

  function resolveAssetPresentation(a, typeLower, qty) {
    const isCrypto = typeLower === 'crypto';
    const isEmas = typeLower === 'emas';
    const isUsd = typeLower === 'usd';
    const isSaham = typeLower === 'saham';

    const iconName = isCrypto ? 'currency-btc'
      : isUsd ? 'currency-dollar'
        : isSaham ? 'chart-line-up'
          : (typeLower === 'cash' ? 'bank' : 'coins');
    const iconColor = (isCrypto || isEmas) ? 'text-amber-700 dark:text-amber-400'
      : (typeLower === 'cash' || isUsd ? 'text-emerald-700 dark:text-emerald-400' : 'text-brand dark:text-brand-ink');
    const iconBG = (isCrypto || isEmas) ? 'bg-amber-50 dark:bg-amber-500/10'
      : (typeLower === 'cash' || isUsd ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-brand/10');

    let meta = `<span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtmlJS(a.type)}</span>`;
    if (isCrypto) meta = `<span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">${qty} ${escapeHtmlJS(a.symbol)} · Crypto</span>`;
    else if (isEmas) meta = `<span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">${qty} gram · Emas</span>`;
    else if (isUsd) meta = `<span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">$${qty.toLocaleString('id-ID')} USD · Valas</span>`;
    else if (isSaham) meta = `<span class="text-xs text-slate-500 dark:text-slate-400">${a.symbol ? escapeHtmlJS(a.symbol) + ' · ' : ''}Saham / Reksa Dana</span>`;

    return { iconName, iconColor, iconBG, meta, hasUnitPnl: isCrypto || isEmas || isUsd };
  }

  function buildAssetRowHtml(a) {
    const typeLower = String(a.type).toLowerCase();
    const qty = Number(a.quantity || 0);
    const value = Number(a.value || 0);
    const buyTotal = qty * Number(a.buyPrice || 0);
    const pnl = buyTotal > 0 ? (value - buyTotal) : 0;
    const pnlPct = buyTotal > 0 ? (pnl / buyTotal * 100) : 0;
    const ui = resolveAssetPresentation(a, typeLower, qty);
    const pnlHtml = ui.hasUnitPnl && buyTotal > 0
      ? `<div class="text-xs font-bold tabular-nums ${pnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${pnl >= 0 ? '+' : ''}${formatRupiah(pnl).replace(',00', '')} (${pnlPct.toFixed(1)}%)</div>`
      : '';
    const safeName = escapeHtmlJS(a.name);
    const idAttr = escapeAttrJS(a.id);

    return `
      <div class="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center group hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl ${ui.iconBG} ${ui.iconColor} flex items-center justify-center">
            <i class="ph ph-${ui.iconName} text-lg" aria-hidden="true"></i>
          </div>
          <div>
            <p class="font-bold text-slate-800 dark:text-white text-sm">${safeName}</p>
            ${ui.meta}
          </div>
        </div>
        <div class="flex items-center gap-2 text-right">
          <div>
            <p class="font-black tabular-nums ${ui.iconColor}">${formatRupiah(value)}</p>
            ${pnlHtml}
          </div>
          <div class="flex items-center gap-1 opacity-100 sm:opacity-75 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
            <button type="button" ${mkActionAttrs('topUpAsset', [a.id])} aria-label="Tambah nilai aset ${safeName}" title="Tambah nilai aset" class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center hover:bg-emerald-100 transition-colors">
              <i class="ph-bold ph-plus text-sm" aria-hidden="true"></i>
            </button>
            <button type="button" ${mkActionAttrs('withdrawAsset', [a.id])} aria-label="Cairkan atau jual aset ${safeName}" title="Cairkan / Jual ke Dompet" class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center justify-center hover:bg-amber-100 transition-colors">
              <i class="ph ph-hand-coins text-sm" aria-hidden="true"></i>
            </button>
            <button type="button" ${mkActionAttrs('deleteAsset', [a.id])} aria-label="Hapus aset ${safeName}" title="Hapus aset" class="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors">
              <i class="ph ph-trash text-sm" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderAssets() {
    const container = document.getElementById('list-manual-assets');
    if (!container) return;
    if (!DB.assets || DB.assets.length === 0) {
      renderHtml(container, '<p class="p-6 text-center text-xs text-slate-500 col-span-full">Belum ada aset. Klik "Tambah Aset".</p>');
      return;
    }
    renderHtml(container, DB.assets.map(buildAssetRowHtml).join(''));
  }

  async function refreshAssetPrices() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      Swal.fire({ icon: 'warning', title: 'Sedang Offline', text: 'Hubungkan koneksi internet untuk menyegarkan harga pasar.', customClass: { popup: getSwalClass() } });
      return;
    }
    Swal.fire({
      title: 'Refresh harga aset...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      customClass: { popup: getSwalClass() }
    });
    try {
      const data = await callServer('api_refreshPrices');
      await refreshFromServer(data);
      const meta = (data && data.refreshMeta) || {};
      if (meta.noMarketAssets) {
        Swal.fire({
          icon: 'info',
          title: 'Tidak ada aset harga otomatis',
          text: 'Hanya aset Crypto, Emas (gram), dan Valas USD dengan jumlah unit > 0 yang diperbarui otomatis.',
          customClass: { popup: getSwalClass() }
        });
        return;
      }
      if (meta.updated > 0 && Array.isArray(meta.missing) && meta.missing.length) {
        Swal.fire({
          icon: 'success',
          title: `${meta.updated} aset diperbarui`,
          text: 'Simbol belum tersedia: ' + meta.missing.join(', '),
          customClass: { popup: getSwalClass() }
        });
        return;
      }
      Swal.fire({
        icon: 'success',
        title: 'Harga diupdate!',
        text: meta.updated > 0 ? `${meta.updated} aset diperbarui sesuai harga pasar.` : undefined,
        timer: 1400,
        showConfirmButton: false,
        customClass: { popup: getSwalClass() }
      });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal refresh', text: toUserErrorMessage(e), customClass: { popup: getSwalClass() } });
    }
  }

  function deleteAsset(id) {
    Swal.fire({
      title: 'Hapus aset?',
      text: 'Data aset akan dihapus.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      confirmButtonText: t('btn.ya_hapus'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() }
    }).then(async (r) => {
      if (!r.isConfirmed) return;
      try {
        await refreshFromServer(await callServer('api_deleteAsset', id));
      } catch (e) {
        showActionError(e);
      }
    });
  }

  Object.assign(root, {
    renderPortfolioChart,
    renderAssets,
    refreshAssetPrices,
    deleteAsset
  });
})(typeof window !== 'undefined' ? window : globalThis);
