/* global DB, FinanceAnalysis, Swal, getSwalClass, formatNominalInputValue, getGeminiApiKeyAsync, configureGeminiApiKey, callGeminiApi, extractGeminiText, syncFormCategorySelect, localToday, currentLang, t */
/* ============================================================
   FEATURES — RECEIPT OCR SCANNER & AI CHAT BASE
   ============================================================ */
(function (root) {
  'use strict';

  async function runReceiptOcrWithImage(mimeType, base64) {
    const apiKey = typeof getGeminiApiKeyAsync === 'function' ? await getGeminiApiKeyAsync() : '';
    if (!apiKey || !base64) return;
    const btn = document.getElementById('btnScanReceipt');
    if (btn) btn.disabled = true;
    Swal.fire({
      title: 'Membaca struk dengan Gemini 4...',
      text: 'Mengekstrak tanggal, nominal, kategori, dan catatan.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      customClass: { popup: getSwalClass() }
    });
    try {
      const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
      const prompt = FinanceAnalysis.buildReceiptOcrPrompt(DB.categories, todayStr, currentLang);
      const systemInstruction = typeof FinanceAnalysis.buildGeminiSystemInstruction === 'function'
        ? FinanceAnalysis.buildGeminiSystemInstruction('receipt', currentLang) : '';
      const res = await callGeminiApi(apiKey, {
        input: [
          { type: 'text', text: prompt },
          { type: 'image', data: base64, mime_type: mimeType || 'image/jpeg' }
        ],
        systemInstruction,
        thinkingLevel: 'low',
        responseSchema: FinanceAnalysis.RECEIPT_OCR_SCHEMA
      });
      const rawText = (res && res.text) || (typeof extractGeminiText === 'function' ? extractGeminiText(res && res.json) : '');
      const parsed = FinanceAnalysis.parseReceiptOcrResponse(rawText, todayStr);
      applyParsedReceiptToForm(parsed);
      if (typeof root.triggerHaptic === 'function') root.triggerHaptic('success');
      const amtLabel = typeof formatNominalInputValue === 'function' ? formatNominalInputValue(parsed.nominal) : String(parsed.nominal);
      Swal.fire({
        icon: 'success',
        title: 'Struk terbaca!',
        text: `${parsed.kategori} · Rp ${amtLabel} · ${parsed.keterangan || parsed.tanggal}. Periksa lalu klik Simpan.`,
        timer: 2200,
        showConfirmButton: false,
        customClass: { popup: getSwalClass() }
      });
    } catch (err) {
      if (typeof root.triggerHaptic === 'function') root.triggerHaptic('error');
      Swal.fire({ icon: 'error', title: 'Gagal membaca struk', text: String((err && err.message) || err), customClass: { popup: getSwalClass() } });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function triggerReceiptOcr() {
    let key = typeof getGeminiApiKeyAsync === 'function' ? await getGeminiApiKeyAsync() : '';
    if (!key && typeof configureGeminiApiKey === 'function') {
      key = await configureGeminiApiKey();
      if (!key) return;
    }
    if (typeof root.isNativeApp === 'function' && root.isNativeApp() && typeof root.captureReceiptNative === 'function') {
      const photo = await root.captureReceiptNative();
      if (photo && photo.base64) {
        await runReceiptOcrWithImage(photo.mimeType, photo.base64);
        return;
      }
      if (photo && photo.cancelled) return;
    }
    const input = document.getElementById('trReceiptInput');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  function compressImageToBase64(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error('Ukuran gambar melebihi batas 10 MB.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => {
          const raw = String(reader.result || '');
          const comma = raw.indexOf(',');
          resolve({ mimeType: file.type || 'image/jpeg', base64: comma >= 0 ? raw.slice(comma + 1) : raw });
        };
        img.onload = () => {
          const maxDim = 1280;
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (w > maxDim || h > maxDim) {
            const scale = Math.min(maxDim / w, maxDim / h);
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve({ mimeType: 'image/jpeg', base64: dataUrl.split(',')[1] });
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  function applyParsedReceiptToForm(parsed) {
    document.getElementById('tr_tipe').value = parsed.tipe;
    const submitBtn = document.getElementById('btnSubmitTrans');
    if (submitBtn) {
      submitBtn.className = 'w-full min-h-[52px] text-white font-bold py-3.5 rounded-2xl shadow-xl transition-[background-color,opacity,transform] flex items-center justify-center gap-2 ' +
        (parsed.tipe === 'Pemasukan' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700');
    }
    const tipeKey = parsed.tipe === 'Pemasukan' ? 'form.pemasukan' : 'form.pengeluaran';
    const titleEl = document.getElementById('formTitle');
    if (titleEl) titleEl.innerText = t('form.title_add') + ' ' + t(tipeKey);
    const wl = document.getElementById('tr_wallet_label');
    if (wl) wl.innerText = parsed.tipe === 'Pemasukan' ? 'Masuk ke dompet' : 'Dibayar dari dompet';

    if (typeof syncFormCategorySelect === 'function') {
      const listKey = parsed.tipe === 'Pemasukan' ? 'pemasukan' : 'pengeluaran';
      syncFormCategorySelect();
      const catSelect = document.getElementById('tr_kategori');
      if (catSelect) {
        const opts = DB.categories[listKey] || [];
        const targetKey = String(parsed.kategori || '').trim().toLowerCase();
        const match = opts.find((c) => String(c || '').trim().toLowerCase() === targetKey);
        if (match) catSelect.value = match;
      }
    }

    document.getElementById('tr_tanggal').value = parsed.tanggal;
    if (root.fpTanggal) {
      try { root.fpTanggal.setDate(parsed.tanggal, true); } catch (_) { /* ignore */ }
    }
    document.getElementById('tr_nominal').value = formatNominalInputValue(parsed.nominal);
    document.getElementById('tr_keterangan').value = parsed.keterangan;
  }

  async function handleReceiptOcrFile(event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (event && event.target) event.target.value = '';
    if (!file) return;
    try {
      const { mimeType, base64 } = await compressImageToBase64(file);
      await runReceiptOcrWithImage(mimeType, base64);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Gagal membaca struk', text: String((err && err.message) || err), customClass: { popup: getSwalClass() } });
    }
  }

  function fillAiChatPrompt(text) {
    const input = document.getElementById('aiChatInput');
    if (input) {
      input.value = text;
      input.focus();
    }
  }

  Object.assign(root, {
    triggerReceiptOcr,
    handleReceiptOcrFile,
    fillAiChatPrompt
  });
})(typeof window !== 'undefined' ? window : globalThis);
