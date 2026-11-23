/* global DB, Swal, callServer, refreshFromServer, formatRupiah, formatNominalInputValue, parseFormattedNominal, bindNominalInputs, escapeHtmlJS, getSwalClass, showActionError, walletOptions, localToday */
/* ============================================================
   ASSET TOP-UP & LIQUIDATION MODALS
   ============================================================ */
(function (root) {
  'use strict';

  function getAssetUnitMeta(a) {
    const typeLower = String(a.type || '').toLowerCase();
    const isUnitAsset = ['crypto', 'emas', 'usd'].includes(typeLower);
    const unitLabel = typeLower === 'emas' ? 'gram' : (typeLower === 'usd' ? 'USD' : 'koin');
    const unitStep = typeLower === 'emas' ? '0.001' : (typeLower === 'usd' ? '0.01' : '0.00000001');
    const symbolLabel = a.symbol || (typeLower === 'emas' ? 'gram' : (typeLower === 'usd' ? 'USD' : 'unit'));
    const qty = Number(a.quantity || 0);
    const val = Number(a.value || 0);
    const implied = (qty > 0 && val > 0) ? val / qty : Number(a.buyPrice || 0);
    return { isUnitAsset, unitLabel, unitStep, symbolLabel, qty, val, implied };
  }

  function bindTopUpAutoAmount(implied) {
    const amtEl = document.getElementById('tu-amount');
    const qtyEl = document.getElementById('tu-qty');
    const priceEl = document.getElementById('tu-price');
    const syncFromUnit = () => {
      const qVal = parseFloat(qtyEl && qtyEl.value);
      const pVal = (priceEl ? parseFormattedNominal(priceEl.value) : 0) || implied;
      if (amtEl && qVal > 0 && pVal > 0 && (!parseFormattedNominal(amtEl.value) || amtEl.dataset.auto === '1')) {
        amtEl.value = formatNominalInputValue(Math.round(qVal * pVal));
        amtEl.dataset.auto = '1';
      }
    };
    if (amtEl) amtEl.addEventListener('input', () => { amtEl.dataset.auto = '0'; });
    if (qtyEl) qtyEl.addEventListener('input', syncFromUnit);
    if (priceEl) priceEl.addEventListener('input', syncFromUnit);
  }

  async function topUpAsset(id) {
    const a = (DB.assets || []).find((x) => String(x.id) === String(id));
    if (!a) return;
    const m = getAssetUnitMeta(a);
    const unitFieldsHtml = m.isUnitAsset
      ? `<label for="tu-qty" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Jumlah ${m.unitLabel} didapat — opsional</label>
         <input id="tu-qty" type="number" step="${m.unitStep}" class="swal2-input" placeholder="Jumlah ${m.unitLabel} didapat — opsional">
         <label for="tu-price" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Harga per ${m.unitLabel} saat beli (Rp) — opsional</label>
         <input id="tu-price" type="text" inputmode="numeric" class="swal2-input tabular-nums" placeholder="Harga per ${m.unitLabel} saat beli (Rp) — opsional">
         <p style="font-size:12px;color:#64748b;margin:6px 4px">${m.implied
           ? `Kosongkan keduanya untuk memakai harga terakhir (${formatRupiah(m.implied)} per ${escapeHtmlJS(m.symbolLabel)}).`
           : `Harga terakhir belum ada: isi jumlah ${m.unitLabel} atau harga per ${m.unitLabel}.`}</p>`
      : '';

    const res = await Swal.fire({
      title: 'Tambah ' + escapeHtmlJS(a.name),
      html: `
        <label for="tu-amount" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:4px 4px 0">Nominal ditambah (Rp)</label>
        <input id="tu-amount" type="text" inputmode="numeric" class="swal2-input tabular-nums" placeholder="Nominal ditambah (Rp), mis. 1.000.000">
        ${unitFieldsHtml}
        <label for="tu-wallet" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Sumber dana</label>
        <select id="tu-wallet" class="swal2-input"><option value="">Tidak dikurangi dari dompet</option>${walletOptions('')}</select>`,
      showCancelButton: true,
      confirmButtonText: 'Tambahkan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        bindNominalInputs(m.isUnitAsset ? ['tu-amount', 'tu-price'] : ['tu-amount']);
        if (m.isUnitAsset) bindTopUpAutoAmount(m.implied);
      },
      preConfirm: () => {
        const amount = parseFormattedNominal(document.getElementById('tu-amount').value);
        if (!Number.isFinite(amount) || amount <= 0) { Swal.showValidationMessage('Isi nominal yang valid.'); return false; }
        const readNum = (elId) => { const el = document.getElementById(elId); return el ? (parseFloat(el.value) || 0) : 0; };
        return {
          amount,
          quantity: readNum('tu-qty'),
          price: (() => {
            const pEl = document.getElementById('tu-price');
            const raw = String((pEl && pEl.value) || '').trim();
            if (!raw) return null;
            const parsed = parseFormattedNominal(raw);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
          })(),
          walletId: document.getElementById('tu-wallet').value,
          tanggal: localToday()
        };
      }
    });
    if (!res.isConfirmed || !res.value) return;
    try {
      await refreshFromServer(await callServer('api_topUpAsset', id, res.value));
      Swal.fire({ icon: 'success', title: 'Aset ditambah', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: String(e.message || e), customClass: { popup: getSwalClass() } });
    }
  }

  function buildWithdrawAssetHtml(m) {
    const qtyField = (m.isUnitAsset && m.qty > 0)
      ? `<label for="wd-qty" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Jumlah ${m.unitLabel} dijual (${m.qty} ${escapeHtmlJS(m.symbolLabel)}) — opsional</label>
         <input id="wd-qty" type="number" step="${m.unitStep}" min="0" max="${m.qty}" class="swal2-input" placeholder="Kosongkan untuk hitung proporsional">`
      : '';
    return `
      <label for="wd-amount" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:4px 4px 0">Nominal dicairkan (maks. ${formatRupiah(m.val)})</label>
      <input id="wd-amount" type="text" inputmode="numeric" value="${escapeHtmlJS(formatNominalInputValue(Math.round(m.val)))}" class="swal2-input tabular-nums" placeholder="Nominal dicairkan (Rp)">
      ${qtyField}
      <label for="wd-wallet" style="font-size:12px;color:#64748b;display:block;text-align:left;margin:8px 4px 0">Masuk ke dompet tujuan</label>
      <select id="wd-wallet" class="swal2-input">
        ${walletOptions('')}
        <option value="">Catat pencairan tanpa masuk dompet</option>
      </select>`;
  }

  async function withdrawAsset(id) {
    const a = (DB.assets || []).find((x) => String(x.id) === String(id));
    if (!a) return;
    const m = getAssetUnitMeta(a);
    const res = await Swal.fire({
      title: 'Cairkan / Jual ' + escapeHtmlJS(a.name),
      html: buildWithdrawAssetHtml(m),
      showCancelButton: true,
      confirmButtonText: 'Cairkan',
      cancelButtonText: 'Batal',
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        bindNominalInputs(['wd-amount']);
        if (!m.isUnitAsset || m.qty <= 0 || m.implied <= 0) return;
        const amtEl = document.getElementById('wd-amount');
        const qtyEl = document.getElementById('wd-qty');
        if (qtyEl && amtEl) {
          qtyEl.addEventListener('input', () => {
            const q = parseFloat(qtyEl.value);
            if (Number.isFinite(q) && q > 0) {
              amtEl.value = formatNominalInputValue(Math.min(Math.round(m.val), Math.max(1, Math.round(q * m.implied))));
            }
          });
        }
      },
      preConfirm: () => {
        const amount = parseFormattedNominal(document.getElementById('wd-amount').value);
        if (!Number.isFinite(amount) || amount <= 0 || amount > m.val + 1) {
          Swal.showValidationMessage('Nominal harus di antara 1 sampai nilai aset saat ini.');
          return false;
        }
        const qtyEl = document.getElementById('wd-qty');
        const soldQty = qtyEl && qtyEl.value !== '' ? parseFloat(qtyEl.value) : null;
        if (soldQty !== null && (!Number.isFinite(soldQty) || soldQty <= 0 || soldQty > m.qty)) {
          Swal.showValidationMessage(`Jumlah ${m.unitLabel} tidak valid.`);
          return false;
        }
        return { amount, quantity: soldQty, walletId: document.getElementById('wd-wallet').value, tanggal: localToday() };
      }
    });
    if (!res.isConfirmed || !res.value) return;
    try {
      await refreshFromServer(await callServer('api_withdrawAsset', id, res.value));
      Swal.fire({ icon: 'success', title: 'Aset dicairkan', timer: 1300, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (e) {
      showActionError(e);
    }
  }

  Object.assign(root, { topUpAsset, withdrawAsset });
})(typeof window !== 'undefined' ? window : globalThis);
