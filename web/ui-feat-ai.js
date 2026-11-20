/* global DB, FinanceAnalysis, Swal, getSwalClass, escapeHtmlJS, renderHtml, getGeminiApiKey, configureGeminiApiKey, callGeminiApi, syncFormCategorySelect, localToday, currentLang, t */
/* ============================================================
   FEATURES — RECEIPT OCR SCANNER & AI CHAT BASE
   ============================================================ */
(function (root) {
  'use strict';

  async function triggerReceiptOcr() {
    let key = typeof getGeminiApiKey === 'function' ? getGeminiApiKey() : (localStorage.getItem('mk_gemini_api_key') || '');
    if (!key && typeof configureGeminiApiKey === 'function') {
      key = await configureGeminiApiKey();
      if (!key) return;
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
      submitBtn.className = 'w-full text-white font-bold py-5 rounded-2xl shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 ' +
        (parsed.tipe === 'Pemasukan' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600');
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
        const match = opts.find((c) => c.toLowerCase() === parsed.kategori.toLowerCase());
        if (match) catSelect.value = match;
      }
    }

    document.getElementById('tr_tanggal').value = parsed.tanggal;
    if (root.fpTanggal) {
      try { root.fpTanggal.setDate(parsed.tanggal, true); } catch (_) { /* ignore */ }
    }
    document.getElementById('tr_nominal').value = parsed.nominal;
    document.getElementById('tr_keterangan').value = parsed.keterangan;
  }

  async function handleReceiptOcrFile(event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    const apiKey = typeof getGeminiApiKey === 'function' ? getGeminiApiKey() : '';
    if (!apiKey) return;

    const btn = document.getElementById('btnScanReceipt');
    if (btn) btn.disabled = true;
    Swal.fire({
      title: 'Membaca struk dengan AI...',
      text: 'Mengekstrak tanggal, nominal, kategori, dan catatan.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      customClass: { popup: getSwalClass() }
    });

    try {
      const { mimeType, base64 } = await compressImageToBase64(file);
      const todayStr = typeof localToday === 'function' ? localToday() : new Date().toISOString().slice(0, 10);
      const prompt = FinanceAnalysis.buildReceiptOcrPrompt(DB.categories, todayStr, currentLang);
      const { json } = await callGeminiApi(apiKey, {
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      });
      const rawText = (((json || {}).candidates || [])[0] || {}).content?.parts?.map((p) => p.text || '').join('') || '';
      const parsed = FinanceAnalysis.parseReceiptOcrResponse(rawText, todayStr);
      applyParsedReceiptToForm(parsed);

      Swal.fire({
        icon: 'success',
        title: 'Struk terbaca!',
        text: 'Periksa kembali isian lalu klik Enkripsi & Simpan.',
        timer: 1800,
        showConfirmButton: false,
        customClass: { popup: getSwalClass() }
      });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Gagal membaca struk', text: String((err && err.message) || err), customClass: { popup: getSwalClass() } });
    } finally {
      if (btn) btn.disabled = false;
      if (event && event.target) event.target.value = '';
    }
  }

  function fillAiChatPrompt(text) {
    const input = document.getElementById('aiChatInput');
    if (input) {
      input.value = text;
      input.focus();
    }
  }

  function formatAiTextSafe(text) {
    return escapeHtmlJS(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }

  async function runAiFinancialChat() {
    const input = document.getElementById('aiChatInput');
    const out = document.getElementById('aiChatResult');
    const btn = document.getElementById('btnAskAiChat');
    const question = ((input && input.value) || '').trim();
    if (!question) { if (input) input.focus(); return; }

    let apiKey = typeof getGeminiApiKey === 'function' ? getGeminiApiKey() : '';
    if (!apiKey && typeof configureGeminiApiKey === 'function') {
      apiKey = await configureGeminiApiKey();
      if (!apiKey) return;
    }

    if (btn) btn.disabled = true;
    if (out) {
      out.classList.remove('hide');
      renderHtml(out, '<div class="flex items-center gap-2 text-slate-500"><div class="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin"></div><span>Gemini sedang menjawab pertanyaan Anda...</span></div>');
    }

    try {
      const payload = FinanceAnalysis.buildAiCashflowPayload(DB, DB.currentPeriod, DB.payrollDay);
      const prompt = FinanceAnalysis.buildAiFinancialChatPrompt(payload, question, currentLang);
      const { json } = await callGeminiApi(apiKey, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.35 } });
      const answer = (((json || {}).candidates || [])[0] || {}).content?.parts?.map((p) => p.text || '').join('') || '';
      if (!answer) throw new Error('Gemini tidak mengembalikan jawaban.');
      if (out) {
        renderHtml(out, `<div class="leading-relaxed space-y-2"><p class="text-[11px] font-bold uppercase tracking-wider text-brand dark:text-brand-ink">Jawaban Gemini AI</p><div>${formatAiTextSafe(answer)}</div></div>`);
      }
    } catch (err) {
      if (out) {
        renderHtml(out, `<p class="text-rose-600 dark:text-rose-400 font-semibold">Gagal meminta jawaban AI: ${escapeHtmlJS(String((err && err.message) || err))}</p>`);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  Object.assign(root, {
    triggerReceiptOcr,
    handleReceiptOcrFile,
    fillAiChatPrompt,
    runAiFinancialChat
  });
})(typeof window !== 'undefined' ? window : globalThis);
