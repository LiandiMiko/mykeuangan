/* global DB, FinanceAnalysis, Swal, escapeHtmlJS, renderHtml, getSwalClass, currentLang, saveAiAnalysisCache, t */
/* ============================================================
   ON-DEMAND GEMINI AI CASHFLOW ANALYZER
   ============================================================ */
(function (root) {
  'use strict';

  const GEMINI_KEY_STORAGE = 'mk_gemini_api_key';
  const GEMINI_MODEL_STORAGE = 'mk_gemini_model';
  const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

  function getGeminiApiKey() {
    return (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim();
  }

  function getGeminiModel() {
    return (localStorage.getItem(GEMINI_MODEL_STORAGE) || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  }

  async function callGeminiApi(apiKey, requestBody) {
    const configured = getGeminiModel();
    const candidates = [configured, DEFAULT_GEMINI_MODEL, 'gemini-2.0-flash']
      .filter((m, idx, arr) => m && arr.indexOf(m) === idx);
    let lastError = null;

    for (let i = 0; i < candidates.length; i += 1) {
      const model = candidates[i];
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody)
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok) return { json, model };

      const msg = (json && json.error && json.error.message) || ('HTTP ' + response.status);
      lastError = new Error(msg);
      const suggested = String(msg).match(/models\/([a-z0-9._-]+)/gi);
      if (suggested) {
        suggested.forEach((tok) => {
          const name = tok.replace(/^models\//i, '').trim();
          if (name && name !== model && !candidates.includes(name)) candidates.splice(i + 1, 0, name);
        });
      }
      const isUnavailable = response.status === 404 || /no longer available|not found|not supported|deprecated/i.test(msg);
      if (!isUnavailable) throw lastError;
    }
    throw lastError || new Error('Gagal memanggil Gemini API.');
  }

  function updateAiKeyStatusUI() {
    const badge = document.getElementById('aiKeyStatus');
    if (!badge) return;
    const hasKey = Boolean(getGeminiApiKey());
    badge.textContent = hasKey ? (t('ai.key_saved') + ' · ' + getGeminiModel()) : t('ai.key_missing');
    badge.className = hasKey
      ? 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
      : 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  }

  async function configureGeminiApiKey() {
    const existing = getGeminiApiKey();
    const currentModel = getGeminiModel();
    const res = await Swal.fire({
      title: 'API Key Google Gemini',
      html: `
        <div class="text-left text-xs space-y-2.5">
          <p class="text-slate-500 dark:text-slate-400">Masukkan Gemini API Key dari Google AI Studio. Key disimpan secara lokal di browser Anda dan hanya dipakai ketika Anda menekan tombol analisis.</p>
          <div>
            <label for="swal-gemini-key" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">API Key</label>
            <input id="swal-gemini-key" type="password" class="swal2-input" style="margin:0;width:100%" placeholder="${existing ? '•••••••••••• (kosongkan jika tidak mengubah key)' : 'AIza...'}">
          </div>
          <div>
            <label for="swal-gemini-model" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Model Gemini</label>
            <input id="swal-gemini-model" type="text" class="swal2-input" style="margin:0;width:100%" value="${escapeHtmlJS(currentModel)}" placeholder="gemini-2.5-flash">
          </div>
        </div>`,
      showCancelButton: true,
      showDenyButton: Boolean(existing),
      denyButtonText: 'Hapus API Key',
      denyButtonColor: '#e11d48',
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      preConfirm: () => {
        const val = (document.getElementById('swal-gemini-key').value || '').trim();
        const model = (document.getElementById('swal-gemini-model').value || '').trim() || DEFAULT_GEMINI_MODEL;
        const key = val || existing;
        if (!key) { Swal.showValidationMessage('Masukkan API Key Gemini terlebih dahulu.'); return false; }
        return { key, model };
      }
    });

    if (res.isDenied) {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
      updateAiKeyStatusUI();
      Swal.fire({ icon: 'info', title: 'API Key dihapus', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      return '';
    }
    if (res.isConfirmed && res.value) {
      localStorage.setItem(GEMINI_KEY_STORAGE, res.value.key);
      localStorage.setItem(GEMINI_MODEL_STORAGE, res.value.model);
      updateAiKeyStatusUI();
      Swal.fire({ icon: 'success', title: 'Konfigurasi Gemini disimpan', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      return res.value.key;
    }
    return '';
  }

  function renderAiCashflowResult(parsed, payload) {
    const box = document.getElementById('aiAnalysisResult');
    if (!box) return;
    const score = parsed.healthScore;
    const scoreColor = score === null ? 'bg-brand text-white'
      : score >= 75 ? 'bg-emerald-600 text-white'
        : score >= 50 ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white';

    const renderBullets = (items, emptyText) => {
      if (!items || !items.length) return emptyText ? `<p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtmlJS(emptyText)}</p>` : '';
      return '<ul class="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">' +
        items.map((item) => `<li>${escapeHtmlJS(item)}</li>`).join('') + '</ul>';
    };

    renderHtml(box, `
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700">
          <div class="flex items-center gap-3">
            ${score !== null ? `<div class="w-12 h-12 rounded-2xl ${scoreColor} flex flex-col items-center justify-center shrink-0 font-black"><span class="text-lg leading-none">${score}</span><span class="text-[9px] opacity-80">/100</span></div>` : ''}
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">${escapeHtmlJS(t('ai.score'))} · ${escapeHtmlJS(payload.period)}</p>
              <p class="text-base font-bold text-slate-800 dark:text-white">${escapeHtmlJS(parsed.statusLabel || 'Hasil Analisis')} <span class="text-xs font-medium text-slate-500 dark:text-slate-400">(Savings Rate: ${escapeHtmlJS(payload.savingsRate)}%)</span></p>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('aiAnalysisResult').classList.add('hide')" class="min-h-10 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:border-brand self-start sm:self-center">Tutup</button>
        </div>
        ${parsed.ringkasan ? `<p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">${escapeHtmlJS(parsed.ringkasan)}</p>` : ''}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-900/30">
            <h4 class="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-2">${escapeHtmlJS(t('ai.highlights'))}</h4>
            ${renderBullets(parsed.sorotan, '-')}
          </div>
          <div class="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-900/30">
            <h4 class="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">${escapeHtmlJS(t('ai.alerts'))}</h4>
            ${renderBullets(parsed.bocorAnggaran, t('ai.no_alerts'))}
          </div>
          <div class="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-900/30">
            <h4 class="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">${escapeHtmlJS(t('ai.recommendations'))}</h4>
            ${renderBullets(parsed.rekomendasi, '-')}
          </div>
        </div>
      </div>`);
  }

  async function runAiCashflowAnalysis() {
    let apiKey = getGeminiApiKey();
    if (!apiKey) {
      apiKey = await configureGeminiApiKey();
      if (!apiKey) return;
    }

    const btn = document.getElementById('btnRunAiAnalysis');
    const box = document.getElementById('aiAnalysisResult');
    if (!box) return;
    if (btn) btn.disabled = true;
    box.classList.remove('hide');
    renderHtml(box, `
      <div class="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 text-sm text-slate-600 dark:text-slate-300">
        <div class="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin shrink-0"></div>
        <span>${escapeHtmlJS(t('ai.loading'))}</span>
      </div>`);

    try {
      const payload = FinanceAnalysis.buildAiCashflowPayload(DB, DB.currentPeriod, DB.payrollDay);
      const prompt = FinanceAnalysis.buildGeminiCashflowPrompt(payload, currentLang);
      const { json } = await callGeminiApi(apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
      });
      const rawText = (((json || {}).candidates || [])[0] || {}).content?.parts?.map((p) => p.text || '').join('') || '';
      if (!rawText) throw new Error('Gemini tidak mengembalikan respons teks.');
      const parsed = FinanceAnalysis.parseGeminiCashflowResponse(rawText);
      renderAiCashflowResult(parsed, payload);
      if (typeof saveAiAnalysisCache === 'function') saveAiAnalysisCache(parsed, payload);
    } catch (err) {
      console.error('runAiCashflowAnalysis error:', err);
      renderHtml(box, `
        <div class="p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <span>Gagal menjalankan analisis AI: ${escapeHtmlJS(String(err.message || err))}</span>
          <button type="button" onclick="document.getElementById('aiAnalysisResult').classList.add('hide')" class="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 font-bold shrink-0">Tutup</button>
        </div>`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  Object.assign(root, {
    getGeminiApiKey,
    getGeminiModel,
    callGeminiApi,
    updateAiKeyStatusUI,
    configureGeminiApiKey,
    runAiCashflowAnalysis,
    renderAiCashflowResult
  });
})(typeof window !== 'undefined' ? window : globalThis);
