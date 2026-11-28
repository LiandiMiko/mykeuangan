// @depends-on: error-messages.js, ui-state.js
/* global DB, FinanceAnalysis, Swal, escapeHtmlJS, renderHtml, getSwalClass, currentLang, localToday, saveAiAnalysisCache, t */
/* ============================================================
   ON-DEMAND GEMINI 4 AI CASHFLOW ANALYZER (INTERACTIONS API)
   ============================================================ */
(function (root) {
  'use strict';

  const GEMINI_KEY_STORAGE = 'mk_gemini_api_key';
  const GEMINI_MODEL_STORAGE = 'mk_gemini_model';
  const GEMINI_THINKING_STORAGE = 'mk_gemini_thinking';
  const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
  const GEMINI_FALLBACK_MODELS = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-4-argon'];
  const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1/interactions';

  // S15 (Gelombang 3.3): jeda + kuota harian di sisi klien — pelengkap
  // pembatas server. Jeda minimal 10 detik antar panggilan AI dan maks
  // 50 panggilan per hari (perangkat ini), dicatat di localStorage
  // (kunci mk_gemini_ai_usage: { date: 'YYYY-MM-DD', count, lastAt }).
  // Bila terblokir, pengguna melihat pesan "coba lagi" beserta sisa
  // waktu/kuota — fetch ke Gemini TIDAK dilakukan.
  const AI_COOLDOWN_MS = 10000;
  const AI_DAILY_LIMIT = 50;
  const AI_USAGE_STORAGE = 'mk_gemini_ai_usage';

  function aiTodayKey() {
    // Gelombang 5.3 (Q10): pakai localToday() bersama (komponen
    // lokal) — implementasi duplikat dihapus.
    return localToday();
  }

  function getAiDailyUsage() {
    try {
      const raw = JSON.parse(localStorage.getItem(AI_USAGE_STORAGE) || 'null');
      if (raw && raw.date === aiTodayKey()) return { count: Number(raw.count) || 0, lastAt: Number(raw.lastAt) || 0 };
    } catch (_) { /* abaikan: anggap kosong */ }
    return { count: 0, lastAt: 0 };
  }

  function checkAiCooldown() {
    const usage = getAiDailyUsage();
    const remaining = Math.max(0, AI_DAILY_LIMIT - usage.count);
    if (usage.count >= AI_DAILY_LIMIT) {
      return { allowed: false, reason: 'daily', waitSeconds: 0, remaining, message: 'Kuota analisis AI hari ini sudah habis (' + AI_DAILY_LIMIT + '/hari). Coba lagi besok.' };
    }
    const waitMs = usage.lastAt ? (AI_COOLDOWN_MS - (Date.now() - usage.lastAt)) : 0;
    if (waitMs > 0) {
      const waitSeconds = Math.ceil(waitMs / 1000);
      return { allowed: false, reason: 'cooldown', waitSeconds, remaining, message: 'Tunggu ' + waitSeconds + ' detik sebelum analisis AI berikutnya (jeda minimal 10 detik).' };
    }
    return { allowed: true, reason: '', waitSeconds: 0, remaining, message: '' };
  }

  function recordAiCall() {
    const usage = getAiDailyUsage();
    try {
      localStorage.setItem(AI_USAGE_STORAGE, JSON.stringify({ date: aiTodayKey(), count: usage.count + 1, lastAt: Date.now() }));
    } catch (_) { /* abaikan: penyimpanan diblokir */ }
  }

  const GEMINI_MODEL_PRESETS = [
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Rekomendasi · Seimbang & 1M Konteks)', note: 'Model harian terbaru: cepat, akurat untuk analisis arus kas, chat, dan OCR struk (Free & Paid tier).' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Cepat & Hemat Kuota)', note: 'Respons ultra-cepat dan hemat kuota untuk OCR struk maupun tanya jawab harian.' },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon (Reasoning Efisien)', note: 'Penalaran lebih tajam untuk simulasi utang, anggaran kompleks, dan strategi investasi.' },
    { id: 'gemini-4-neon', label: 'Gemini 4 Neon (Frontier Cepat · Paid Tier)', note: 'Kecerdasan frontier dengan penyelesaian cepat (khusus API Key Paid tier).' },
    { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon (Reasoning Paling Mendalam)', note: 'Model terkuat untuk audit finansial mendalam dan perencanaan kompleks.' }
  ];

  let lastCashflowSummaryText = '';

  function normalizeGeminiModel(rawModel) {
    const clean = String(rawModel || '').replace(/^models\//i, '').trim();
    if (!clean) return DEFAULT_GEMINI_MODEL;
    const lower = clean.toLowerCase();
    if (['gemini-4-hydrogen', 'gemini-4-argon', 'gemini-4-neon', 'gemini-4-carbon', 'gemini-3.5-flash-lite'].includes(lower)) return lower;
    if (/^gemini-(2\.0|2\.5|3\.1)-flash-lite/i.test(clean)) return 'gemini-3.5-flash-lite';
    if (/^gemini-(1\.5|2\.5|3(?:\.1)?)-pro/i.test(clean)) return 'gemini-4-argon';
    if (/^gemini-(1\.5|2\.0|2\.5|3\.5|3\.6|3\.7|3\.8|3)-flash/i.test(clean)) return DEFAULT_GEMINI_MODEL;
    if (/^gemini-(1\.5|2\.0|2\.5)/i.test(clean)) return DEFAULT_GEMINI_MODEL;
    return clean;
  }

  // S20 — kunci Gemini terenkripsi saat disimpan (bukan plaintext).
  // Memakai kembali DEK Wave 1 (PIN-derived AES-GCM 256-bit) lewat
  // `__mkFeat.pinCrypto` dari ui-feat-offline.js — tidak ada skema kripto
  // kedua. Format tersimpan: `v1:` + base64( IV 12 byte || ciphertext ),
  // satu envelope AES-GCM per simpan (IV acak). DEK hanya ada di memori
  // setelah PIN dibuka; tanpa DEK, kunci TIDAK PERNAH ditulis plaintext.
  const GEMINI_KEY_ENCRYPTED_PREFIX = 'v1:';
  const GEMINI_KEY_NO_DEK_ERROR = 'Buka kunci PIN aplikasi terlebih dahulu untuk menyimpan API key Gemini. Tanpa PIN, kunci tidak bisa disimpan terenkripsi.';

  function getPinCrypto() {
    const feat = root.__mkFeat || {};
    return feat.pinCrypto || null;
  }

  function getPinDek() {
    const feat = root.__mkFeat || {};
    return typeof feat.getPinDataKey === 'function' ? feat.getPinDataKey() : null;
  }

  function hasPinDek() {
    return Boolean(getPinDek()) && Boolean(getPinCrypto());
  }

  async function encryptGeminiApiKey(plaintext) {
    const dek = getPinDek();
    const pc = getPinCrypto();
    if (!dek || !pc) throw new Error(GEMINI_KEY_NO_DEK_ERROR);
    const env = await pc.encryptWithDek(dek, String(plaintext));
    const iv = pc.b64ToBytes(env.iv);
    const ct = pc.b64ToBytes(env.ct);
    const combined = new Uint8Array(iv.length + ct.length);
    combined.set(iv, 0);
    combined.set(ct, iv.length);
    return GEMINI_KEY_ENCRYPTED_PREFIX + pc.bytesToB64(combined);
  }

  // Mengembalikan '' bila DEK tidak tersedia atau dekripsi gagal (kunci
  // salah / data rusak) — pemanggil memperlakukannya sebagai "tidak ada key".
  async function decryptGeminiApiKey(stored) {
    const dek = getPinDek();
    const pc = getPinCrypto();
    if (!dek || !pc) return '';
    try {
      const combined = pc.b64ToBytes(String(stored || '').slice(GEMINI_KEY_ENCRYPTED_PREFIX.length));
      if (!combined || combined.length <= 12) return '';
      const iv = combined.slice(0, 12);
      const ct = combined.slice(12);
      return await pc.decryptWithDek(dek, { iv: pc.bytesToB64(iv), ct: pc.bytesToB64(ct) });
    } catch (_) {
      return '';
    }
  }

  // Simpan terenkripsi. Menolak (throw) bila DEK tidak tersedia — jangan
  // pernah fallback diam-diam ke plaintext.
  async function saveGeminiApiKey(key) {
    const clean = String(key || '').trim();
    if (!clean) throw new Error('Masukkan API Key Gemini terlebih dahulu.');
    const stored = await encryptGeminiApiKey(clean);
    try {
      localStorage.setItem(GEMINI_KEY_STORAGE, stored);
    } catch (_) { /* ignore: penyimpanan penuh / diblokir */ }
    return clean;
  }

  function hasStoredGeminiApiKey() {
    try {
      return Boolean((localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim());
    } catch (_) {
      return false;
    }
  }

  // Pembaca asinkron (dipakai semua pemanggil AI). Nilai `v1:` didekripsi;
  // nilai plaintext lama dipakai sekali lalu langsung dimigrasi ke
  // terenkripsi bila DEK tersedia; bila DEK tidak tersedia dan hanya ada
  // nilai lama, kembalikan '' (AI akan meminta key lewat modal).
  async function getGeminiApiKeyAsync() {
    let raw = '';
    try { raw = (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim(); } catch (_) { return ''; }
    if (!raw) return '';
    if (raw.startsWith(GEMINI_KEY_ENCRYPTED_PREFIX)) return decryptGeminiApiKey(raw);
    if (!hasPinDek()) return '';
    try { await saveGeminiApiKey(raw); } catch (_) { /* nilai lama tetap dipakai sekali ini */ }
    return raw;
  }

  function getGeminiApiKey() {
    // Shim sinkron: hanya untuk pengecekan keberadaan / kompatibilitas.
    // Nilai terenkripsi TIDAK BISA didekripsi sinkron, jadi kembalikan ''
    // untuknya — pemanggil yang butuh key asli wajib memakai
    // getGeminiApiKeyAsync(). Nilai plaintext lama dikembalikan apa adanya
    // hanya bila DEK tersedia (migrasi dilakukan jalur asinkron).
    let raw = '';
    try { raw = (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim(); } catch (_) { return ''; }
    if (!raw || raw.startsWith(GEMINI_KEY_ENCRYPTED_PREFIX)) return '';
    return hasPinDek() ? raw : '';
  }

  function getGeminiModel() {
    const raw = (localStorage.getItem(GEMINI_MODEL_STORAGE) || '').trim();
    if (!raw) return DEFAULT_GEMINI_MODEL;
    const normalized = normalizeGeminiModel(raw);
    if (normalized !== raw.replace(/^models\//i, '').trim()) {
      try { localStorage.setItem(GEMINI_MODEL_STORAGE, normalized); } catch (_) { /* ignore */ }
    }
    return normalized;
  }

  function getGeminiThinkingLevel() {
    const raw = String(localStorage.getItem(GEMINI_THINKING_STORAGE) || 'medium').trim().toLowerCase();
    return (raw === 'low' || raw === 'medium' || raw === 'high') ? raw : 'medium';
  }

  // Gelombang 5.3 (Q10): delegasi ke escapeHtmlJS — yang sendiri
  // mendelegasikan ke escapeHtml() kanonis (error-messages.js).
  // Rantai replace lama dihapus; jangan salin lagi ke sini.
  function escapeSafe(str) {
    if (typeof escapeHtmlJS === 'function') return escapeHtmlJS(str);
    return escapeHtml(str);
  }

  function formatInlineMarkdownSafe(escapedText) {
    return String(escapedText || '')
      .replace(/`([^`\n]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-800 dark:text-slate-100">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,!?:;)])/g, '$1<em>$2</em>');
  }

  function formatAiMarkdownSafe(rawText) {
    const lines = escapeSafe(String(rawText || '').trim()).split(/\r?\n/);
    const blocks = [];
    let listItems = [];
    let listTag = '';
    const flushList = () => {
      if (!listItems.length) return;
      const cls = (listTag === 'ol' ? 'list-decimal' : 'list-disc') + ' pl-5 space-y-1 my-1.5 text-slate-700 dark:text-slate-200';
      blocks.push(`<${listTag} class="${cls}">${listItems.join('')}</${listTag}>`);
      listItems = [];
      listTag = '';
    };
    lines.forEach((line) => {
      const tLine = line.trim();
      if (!tLine) { flushList(); return; }
      const heading = tLine.match(/^#{1,4}\s+(.+)$/);
      if (heading) {
        flushList();
        blocks.push(`<h4 class="font-bold text-xs sm:text-sm text-slate-900 dark:text-white mt-2.5 mb-1">${formatInlineMarkdownSafe(heading[1])}</h4>`);
        return;
      }
      const ul = tLine.match(/^(?:[-*]|•)\s+(.+)$/);
      const ol = !ul ? tLine.match(/^\d+[.)]\s+(.+)$/) : null;
      if (ul || ol) {
        const nextTag = ul ? 'ul' : 'ol';
        if (listTag && listTag !== nextTag) flushList();
        listTag = nextTag;
        listItems.push(`<li>${formatInlineMarkdownSafe((ul || ol)[1])}</li>`);
        return;
      }
      flushList();
      blocks.push(`<p class="leading-relaxed text-slate-700 dark:text-slate-200 my-1">${formatInlineMarkdownSafe(tLine)}</p>`);
    });
    flushList();
    return blocks.join('');
  }

  function extractGeminiText(json) {
    if (!json || typeof json !== 'object') return '';
    if (typeof json.output_text === 'string' && json.output_text.trim()) return json.output_text.trim();
    if (Array.isArray(json.steps)) {
      const chunks = [];
      json.steps.forEach((step) => {
        if (!step || step.type !== 'model_output' || !Array.isArray(step.content)) return;
        step.content.forEach((p) => { if (p && typeof p.text === 'string' && (!p.type || p.type === 'text')) chunks.push(p.text); });
      });
      if (chunks.length) return chunks.join('').trim();
    }
    const legacyParts = ((json.candidates || [])[0] || {}).content?.parts;
    return Array.isArray(legacyParts) ? legacyParts.map((p) => (p && p.text) || '').join('').trim() : '';
  }

  function convertLegacyContentsToInput(contents) {
    const first = Array.isArray(contents) && contents[0] ? contents[0] : {};
    const blocks = (Array.isArray(first.parts) ? first.parts : []).map((p) => {
      if (p && typeof p.text === 'string') return { type: 'text', text: p.text };
      if (p && p.inlineData && p.inlineData.data) {
        const mime = String(p.inlineData.mimeType || 'image/jpeg');
        return { type: mime.startsWith('audio/') ? 'audio' : 'image', data: p.inlineData.data, mime_type: mime };
      }
      return null;
    }).filter(Boolean);
    return blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks;
  }

  function buildInteractionsPayload(model, requestSpec) {
    const spec = requestSpec && typeof requestSpec === 'object' ? requestSpec : {};
    const legacyCfg = spec.generationConfig || {};
    const input = spec.input !== undefined ? spec.input : convertLegacyContentsToInput(spec.contents);
    const rawLevel = String(spec.thinkingLevel || getGeminiThinkingLevel()).toLowerCase();
    const valid = new Set(['low', 'medium', 'high']);
    if ((model === 'gemini-4-hydrogen' || model === 'gemini-4-neon') && rawLevel === 'xhigh') valid.add('xhigh');
    const body = { model, input, store: false, generation_config: { thinking_level: valid.has(rawLevel) ? rawLevel : 'medium' } };
    if (typeof spec.systemInstruction === 'string' && spec.systemInstruction.trim()) body.system_instruction = spec.systemInstruction.trim();
    const schema = spec.responseSchema || legacyCfg.responseSchema;
    const wantJson = Boolean(schema) || spec.responseMimeType === 'application/json' || legacyCfg.responseMimeType === 'application/json';
    if (wantJson) body.response_format = schema ? { type: 'text', mime_type: 'application/json', schema } : { type: 'text', mime_type: 'application/json' };
    return body;
  }

  const waitDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function postGeminiInteraction(apiKey, payloadBody) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timerId = controller ? setTimeout(() => controller.abort(), 35000) : null;
    try {
      const response = await fetch(GEMINI_INTERACTIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payloadBody),
        ...(controller ? { signal: controller.signal } : {})
      });
      const json = await response.json().catch(() => ({}));
      return { response, json };
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('Permintaan ke Gemini timeout (35 dtk). Coba model Gemini 3.5 Flash-Lite atau ulangi.');
      throw err;
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  }

  async function callGeminiApi(apiKey, requestSpec) {
    const primary = requestSpec && requestSpec.model ? normalizeGeminiModel(requestSpec.model) : getGeminiModel();
    const candidates = [primary, ...GEMINI_FALLBACK_MODELS].filter((m, idx, arr) => m && arr.indexOf(m) === idx);
    let lastError = null;

    for (let i = 0; i < candidates.length; i += 1) {
      const model = candidates[i];
      const payloadBody = buildInteractionsPayload(model, requestSpec);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let resPair;
        try {
          resPair = await postGeminiInteraction(apiKey, payloadBody);
        } catch (netErr) {
          lastError = netErr;
          if (attempt < 2) { await waitDelay((attempt + 1) * 900); continue; }
          throw lastError;
        }
        const { response, json } = resPair;
        if (response.ok && !(json && json.error)) {
          const text = extractGeminiText(json);
          if (!text) throw new Error('Gemini tidak mengembalikan respons teks.');
          return { json, text, model };
        }
        const msg = (json && json.error && json.error.message) || ('HTTP ' + response.status);
        lastError = new Error(msg);
        (String(msg).match(/models\/([a-z0-9._-]+)/gi) || []).forEach((tok) => {
          const nextModel = normalizeGeminiModel(tok);
          if (nextModel && nextModel !== model && !candidates.includes(nextModel)) candidates.splice(i + 1, 0, nextModel);
        });
        const transient = response.status === 429 || response.status === 503 || /high demand|overloaded|temporarily unavailable|rate limit/i.test(msg);
        if (transient && attempt < 2) { await waitDelay((attempt + 1) * 900); continue; }
        const unavailable = response.status === 404 || response.status === 403 || /no longer available|not found|not supported|deprecated|billing|paid tier|permission/i.test(msg);
        if (unavailable) break;
        throw lastError;
      }
    }
    throw lastError || new Error('Gagal memanggil Gemini API.');
  }

  function updateAiKeyStatusUI() {
    const badge = document.getElementById('aiKeyStatus');
    if (!badge) return;
    const hasKey = hasStoredGeminiApiKey();
    badge.textContent = hasKey ? (t('ai.key_saved') + ' · ' + getGeminiModel()) : t('ai.key_missing');
    badge.className = hasKey
      ? 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
      : 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  }

  function buildGeminiConfigModalHtml(existing, currentModel, currentThinking) {
    const isPreset = GEMINI_MODEL_PRESETS.some((p) => p.id === currentModel);
    const presetOptions = GEMINI_MODEL_PRESETS.map((p) =>
      `<option value="${escapeSafe(p.id)}"${p.id === currentModel ? ' selected' : ''}>${escapeSafe(p.label)}</option>`
    ).join('') + `<option value="__custom__"${!isPreset ? ' selected' : ''}>Model Kustom (ketik manual)...</option>`;
    return `
      <div class="text-left text-xs space-y-3">
        <p class="text-slate-500 dark:text-slate-400">API Key disimpan lokal di browser Anda, dipanggil dengan mode privat (<code>store: false</code>), dan hanya aktif saat Anda menekan tombol AI.</p>
        <p class="text-slate-500 dark:text-slate-400">Kunci disimpan terenkripsi dengan PIN aplikasi (AES-GCM) dan tidak pernah dikirim ke server mana pun kecuali API Google AI, langsung dari perangkat Anda. Jika Anda lupa PIN, kunci yang tersimpan tidak bisa dipulihkan dan harus dimasukkan ulang.</p>
        <div>
          <div class="flex items-center justify-between mb-1">
            <label for="swal-gemini-key" class="font-bold text-slate-600 dark:text-slate-300">API Key Google AI Studio</label>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="text-[11px] font-bold text-brand dark:text-brand-ink hover:underline">Buat Key &rarr;</a>
          </div>
          <input id="swal-gemini-key" type="password" class="swal2-input" style="margin:0;width:100%" placeholder="${existing ? '•••••••••••• (kosongkan jika tidak mengubah key)' : 'AIza...'}">
        </div>
        <div>
          <label for="swal-gemini-model-preset" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Model Gemini Terbaru</label>
          <select id="swal-gemini-model-preset" class="swal2-select" style="margin:0;width:100%">${presetOptions}</select>
          <p id="swal-gemini-model-note" class="text-[11px] text-slate-500 dark:text-slate-400 mt-1"></p>
          <input id="swal-gemini-model-custom" type="text" class="swal2-input mt-2${isPreset ? ' hide' : ''}" style="margin:0.5rem 0 0;width:100%" value="${escapeSafe(currentModel)}" placeholder="gemini-4-hydrogen">
        </div>
        <div>
          <label for="swal-gemini-thinking" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Kedalaman Analisis (Thinking Level)</label>
          <select id="swal-gemini-thinking" class="swal2-select" style="margin:0;width:100%">
            <option value="low"${currentThinking === 'low' ? ' selected' : ''}>Low — Respons cepat &amp; ringkas</option>
            <option value="medium"${currentThinking === 'medium' ? ' selected' : ''}>Medium — Seimbang (Rekomendasi)</option>
            <option value="high"${currentThinking === 'high' ? ' selected' : ''}>High — Reasoning mendalam</option>
          </select>
        </div>
      </div>`;
  }

  async function configureGeminiApiKey() {
    const existing = await getGeminiApiKeyAsync();
    const res = await Swal.fire({
      title: 'Konfigurasi Gemini 4 AI',
      width: 540,
      html: buildGeminiConfigModalHtml(existing, getGeminiModel(), getGeminiThinkingLevel()),
      showCancelButton: true,
      showDenyButton: Boolean(existing),
      denyButtonText: 'Hapus API Key',
      denyButtonColor: '#e11d48',
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      customClass: { popup: getSwalClass() },
      didOpen: () => {
        const sel = document.getElementById('swal-gemini-model-preset');
        const custom = document.getElementById('swal-gemini-model-custom');
        const noteEl = document.getElementById('swal-gemini-model-note');
        const sync = () => {
          if (!sel || !custom || !noteEl) return;
          custom.classList.toggle('hide', sel.value !== '__custom__');
          const found = GEMINI_MODEL_PRESETS.find((p) => p.id === sel.value);
          noteEl.textContent = found ? found.note : 'Masukkan ID model Gemini valid (contoh: gemini-4-hydrogen).';
        };
        if (sel) sel.addEventListener('change', sync);
        sync();
      },
      preConfirm: () => {
        const val = (document.getElementById('swal-gemini-key').value || '').trim();
        const presetVal = (document.getElementById('swal-gemini-model-preset').value || '').trim();
        const customVal = (document.getElementById('swal-gemini-model-custom').value || '').trim();
        const model = normalizeGeminiModel(presetVal === '__custom__' ? customVal : presetVal);
        const thinking = (document.getElementById('swal-gemini-thinking').value || 'medium').trim();
        const key = val || existing;
        if (!key) { Swal.showValidationMessage('Masukkan API Key Gemini terlebih dahulu.'); return false; }
        return { key, model, thinking };
      }
    });

    if (res.isDenied) {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
      updateAiKeyStatusUI();
      Swal.fire({ icon: 'info', title: 'API Key dihapus', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      return '';
    }
    if (res.isConfirmed && res.value) {
      try {
        await saveGeminiApiKey(res.value.key);
      } catch (saveErr) {
        Swal.fire({ icon: 'error', title: 'API Key tidak tersimpan', text: String((saveErr && saveErr.message) || saveErr), customClass: { popup: getSwalClass() } });
        return '';
      }
      localStorage.setItem(GEMINI_MODEL_STORAGE, res.value.model);
      localStorage.setItem(GEMINI_THINKING_STORAGE, res.value.thinking);
      updateAiKeyStatusUI();
      Swal.fire({ icon: 'success', title: 'Konfigurasi Gemini 4 disimpan', text: 'Model aktif: ' + res.value.model, timer: 1500, showConfirmButton: false, customClass: { popup: getSwalClass() } });
      return res.value.key;
    }
    return '';
  }

  async function copyAiCashflowSummary() {
    if (!lastCashflowSummaryText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(lastCashflowSummaryText);
      Swal.fire({ icon: 'success', title: 'Ringkasan analisis disalin', timer: 1200, showConfirmButton: false, customClass: { popup: getSwalClass() } });
    } catch (_) { /* ignore */ }
  }

  function renderAiCashflowResult(parsed, payload, meta) {
    const box = document.getElementById('aiAnalysisResult');
    if (!box) return;
    const score = parsed.healthScore;
    const scoreColor = score === null ? 'bg-brand text-white' : score >= 75 ? 'bg-emerald-600 text-white' : score >= 50 ? 'bg-amber-600 text-white' : 'bg-rose-600 text-white';
    const activeModel = (meta && meta.model) || getGeminiModel();
    const hr = (payload && payload.healthRatios) || {};
    const runwayText = hr.emergencyRunwayMonths !== null && hr.emergencyRunwayMonths !== undefined ? `${hr.emergencyRunwayMonths} bln` : '';

    lastCashflowSummaryText = [
      `Analisis Keuangan MyKeuGuech (${payload.period}) · Model: ${activeModel}`,
      score !== null ? `Skor Kesehatan: ${score}/100 (${parsed.statusLabel || 'Hasil'})` : '',
      parsed.ringkasan || '',
      parsed.sorotan?.length ? '\nSorotan:\n- ' + parsed.sorotan.join('\n- ') : '',
      parsed.bocorAnggaran?.length ? '\nPeringatan:\n- ' + parsed.bocorAnggaran.join('\n- ') : '',
      parsed.rekomendasi?.length ? '\nRekomendasi:\n- ' + parsed.rekomendasi.join('\n- ') : ''
    ].filter(Boolean).join('\n');

    const renderBullets = (items, emptyText) => {
      if (!items || !items.length) return emptyText ? `<p class="text-xs text-slate-500 dark:text-slate-400">${escapeSafe(emptyText)}</p>` : '';
      return '<ul class="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">' +
        items.map((item) => `<li>${formatInlineMarkdownSafe(escapeSafe(item))}</li>`).join('') + '</ul>';
    };

    const aiUsage = getAiDailyUsage();

    renderHtml(box, `
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700">
          <div class="flex items-center gap-3 min-w-0">
            ${score !== null ? `<div class="w-12 h-12 rounded-2xl ${scoreColor} flex flex-col items-center justify-center shrink-0 font-black tabular-nums"><span class="text-lg leading-none">${score}</span><span class="text-[10px] opacity-90">/100</span></div>` : ''}
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <p class="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 tabular-nums">${escapeSafe(t('ai.score'))} · ${escapeSafe(payload.period)}</p>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand/10 text-brand dark:text-brand-ink">${escapeSafe(activeModel)}</span>
              </div>
              <p class="text-base font-bold text-slate-800 dark:text-white">${escapeSafe(parsed.statusLabel || 'Hasil Analisis')} <span class="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">(Savings: ${escapeSafe(payload.savingsRate)}%${runwayText ? ' · Dana Darurat: ' + escapeSafe(runwayText) : ''}${hr.debtToAssetPct !== undefined ? ' · Rasio Utang: ' + escapeSafe(hr.debtToAssetPct) + '%' : ''})</span></p>
            </div>
          </div>
          <div class="flex items-center gap-2 self-start sm:self-center shrink-0">
            <button type="button" data-action="copyAiCashflowSummary" class="min-h-10 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:border-brand">Salin</button>
            <button type="button" data-action="hideAiAnalysisResult" class="min-h-10 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:border-brand">Tutup</button>
          </div>
        </div>
        ${parsed.ringkasan ? `<div class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">${formatAiMarkdownSafe(parsed.ringkasan)}</div>` : ''}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-900/30">
            <h4 class="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-2">${escapeSafe(t('ai.highlights'))}</h4>
            ${renderBullets(parsed.sorotan, '-')}
          </div>
          <div class="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-900/30">
            <h4 class="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">${escapeSafe(t('ai.alerts'))}</h4>
            ${renderBullets(parsed.bocorAnggaran, t('ai.no_alerts'))}
          </div>
          <div class="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-900/30">
            <h4 class="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">${escapeSafe(t('ai.recommendations'))}</h4>
            ${renderBullets(parsed.rekomendasi, '-')}
          </div>
        </div>
        <p class="text-[11px] text-slate-500 dark:text-slate-500">Kuota AI hari ini: ${aiUsage.count}/${AI_DAILY_LIMIT} panggilan · jeda minimal 10 detik antar analisis.</p>
      </div>`);
  }

  async function runAiCashflowAnalysis() {
    let apiKey = await getGeminiApiKeyAsync();
    if (!apiKey) {
      apiKey = await configureGeminiApiKey();
      if (!apiKey) return;
    }

    const btn = document.getElementById('btnRunAiAnalysis');
    const box = document.getElementById('aiAnalysisResult');
    if (!box) return;

    // S15: jeda + kuota harian — blokir SEBELUM fetch ke Gemini.
    const cooldown = checkAiCooldown();
    if (!cooldown.allowed) {
      box.classList.remove('hide');
      renderHtml(box, `
        <div class="p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-900/40 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
          <span>⏳ ${escapeSafe(cooldown.message)} Sisa kuota hari ini: ${cooldown.remaining}/${AI_DAILY_LIMIT}.</span>
          <button type="button" data-action="hideAiAnalysisResult" class="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 font-bold shrink-0">Tutup</button>
        </div>`);
      return;
    }

    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    box.classList.remove('hide');
    renderHtml(box, `
      <div class="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 text-sm text-slate-600 dark:text-slate-300">
        <div class="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin shrink-0"></div>
        <span>${escapeSafe(t('ai.loading'))} (${escapeSafe(getGeminiModel())})</span>
      </div>`);

    try {
      const todayStr = localToday();
      const payload = typeof FinanceAnalysis.buildEnrichedAiSnapshot === 'function'
        ? FinanceAnalysis.buildEnrichedAiSnapshot(DB, DB.currentPeriod, DB.payrollDay, todayStr)
        : FinanceAnalysis.buildAiCashflowPayload(DB, DB.currentPeriod, DB.payrollDay);
      const prompt = FinanceAnalysis.buildGeminiCashflowPrompt(payload, currentLang);
      const systemInstruction = typeof FinanceAnalysis.buildGeminiSystemInstruction === 'function'
        ? FinanceAnalysis.buildGeminiSystemInstruction('cashflow', currentLang) : '';
      recordAiCall();
      const { text, model } = await callGeminiApi(apiKey, {
        input: prompt,
        systemInstruction,
        thinkingLevel: getGeminiThinkingLevel(),
        responseSchema: FinanceAnalysis.CASHFLOW_ANALYSIS_SCHEMA
      });
      const parsed = FinanceAnalysis.parseGeminiCashflowResponse(text);
      const meta = { model, savedAt: new Date().toISOString() };
      renderAiCashflowResult(parsed, payload, meta);
      updateAiKeyStatusUI();
      if (typeof saveAiAnalysisCache === 'function') saveAiAnalysisCache(parsed, payload, meta);
    } catch (err) {
      console.error('runAiCashflowAnalysis error:', err);
      renderHtml(box, `
        <div class="p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <span>Gagal menjalankan analisis AI: ${escapeSafe(String((err && err.message) || err))}</span>
          <button type="button" data-action="hideAiAnalysisResult" class="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 font-bold shrink-0">Tutup</button>
        </div>`);
    } finally {
      if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    }
  }

  Object.assign(root, {
    GEMINI_MODEL_PRESETS, normalizeGeminiModel, getGeminiApiKey, getGeminiApiKeyAsync,
    saveGeminiApiKey, encryptGeminiApiKey, decryptGeminiApiKey, hasStoredGeminiApiKey, getGeminiModel,
    getGeminiThinkingLevel, extractGeminiText, formatAiMarkdownSafe, copyAiCashflowSummary,
    callGeminiApi, updateAiKeyStatusUI, configureGeminiApiKey, runAiCashflowAnalysis, renderAiCashflowResult,
    AI_COOLDOWN_MS, AI_DAILY_LIMIT, AI_USAGE_STORAGE, getAiDailyUsage, checkAiCooldown, recordAiCall
  });
})(typeof window !== 'undefined' ? window : globalThis);
