// @depends-on: error-messages.js, ui-state.js
/* global DB, FinancePro, FinanceAnalysis, Swal, formatRupiah, formatShortIDR, escapeHtmlJS, renderHtml, getGeminiApiKeyAsync, getGeminiModel, getGeminiThinkingLevel, configureGeminiApiKey, callGeminiApi, extractGeminiText, formatAiMarkdownSafe, renderAiCashflowResult, updateAiKeyStatusUI, localToday, walletBalances, currentLang, t, toUserErrorMessage */
/* ============================================================
   PRO FEATURES — CALCULATORS, MULTI-TURN AI CHAT & REBALANCING
   ============================================================ */
(function (root) {
  'use strict';

  function extractUserDebtItems() {
    const balMap = {};
    (DB.transactions || []).forEach((tr) => {
      const cat = String(tr.kategori || '');
      if (cat.startsWith('UtangApp - ') || cat.startsWith('UtangPerson - ')) {
        balMap[cat] = (balMap[cat] || 0) + (tr.tipe === 'Pemasukan' ? Number(tr.nominal) || 0 : -(Number(tr.nominal) || 0));
      }
    });
    return Object.entries(balMap)
      .filter(([, bal]) => bal > 0)
      .map(([name, balance]) => ({ name: name.replace(/^Utang(App|Person) - /, ''), balance, annualRatePct: 12, minPayment: 0 }));
  }

  function renderDebtCalcTab(pane, userDebts, totalUserDebt, fmt) {
    const base = userDebts.length ? userDebts : [{ name: 'Contoh Utang', balance: 5000000, annualRatePct: 15, minPayment: 300000 }];
    renderHtml(pane, `
      <div class="space-y-3">
        <div class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-slate-600 dark:text-slate-300">
          Terdeteksi <strong class="text-slate-900 dark:text-white">${userDebts.length}</strong> utang aktif · Total <strong class="text-slate-900 dark:text-white tabular-nums">${escapeHtmlJS(fmt(totalUserDebt))}</strong>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 items-end">
          <div>
            <label for="calc-extra" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Ekstra bayar bulanan (Rp)</label>
            <input id="calc-extra" type="number" min="0" value="500000" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand" placeholder="500000">
          </div>
          <button type="button" id="btnRunDebtCalc" class="min-h-11 px-4 py-2 rounded-xl bg-brand text-white text-xs font-bold hover:opacity-95 transition-opacity">Hitung Ulang</button>
        </div>
        <div id="debtCalcOut" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 tabular-nums"></div>
      </div>
    `);
    const run = () => {
      const extra = Number(document.getElementById('calc-extra').value) || 0;
      const snow = FinancePro.simulateDebtPayoff(base, extra, 'snowball');
      const aval = FinancePro.simulateDebtPayoff(base, extra, 'avalanche');
      const capWarn = (snow.capped || aval.capped)
        ? '<p class="sm:col-span-2 text-xs font-semibold text-amber-600 dark:text-amber-400">Catatan: cicilan belum melunasi bunga penuh dalam 600 bulan (50 thn); tambah ekstra bayar bulanan.</p>'
        : '';
      renderHtml(document.getElementById('debtCalcOut'), `
        <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Snowball (Terkecil Dulu)</p>
          <p class="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">${snow.months}${snow.capped ? '+' : ''} bulan</p>
          <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Total bayar: <strong>${escapeHtmlJS(fmt(snow.totalPaid))}</strong></p>
        </div>
        <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Avalanche (Bunga Tertinggi)</p>
          <p class="text-base font-extrabold text-brand dark:text-brand-ink mt-0.5">${aval.months}${aval.capped ? '+' : ''} bulan</p>
          <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Total bayar: <strong>${escapeHtmlJS(fmt(aval.totalPaid))}</strong></p>
        </div>
        ${capWarn}
      `);
    };
    document.getElementById('btnRunDebtCalc').onclick = run;
    run();
  }

  function renderCompoundCalcTab(pane, fmt) {
    renderHtml(pane, `
      <div class="space-y-3">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <label for="cmp-init" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Modal Awal (Rp)</label>
            <input id="cmp-init" type="number" min="0" value="5000000" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
          <div>
            <label for="cmp-mon" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Setor / Bulan</label>
            <input id="cmp-mon" type="number" min="0" value="1000000" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
          <div>
            <label for="cmp-rate" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Return (% / th)</label>
            <input id="cmp-rate" type="number" step="0.5" value="8" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
          <div>
            <label for="cmp-yrs" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Durasi (Thn)</label>
            <input id="cmp-yrs" type="number" min="1" max="40" value="5" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
        </div>
        <div id="compCalcOut" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 tabular-nums"></div>
      </div>
    `);
    const run = () => {
      const res = FinancePro.simulateCompoundGrowth(
        document.getElementById('cmp-init').value, document.getElementById('cmp-mon').value,
        document.getElementById('cmp-rate').value, document.getElementById('cmp-yrs').value
      );
      renderHtml(document.getElementById('compCalcOut'), `
        <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Estimasi Nilai Akhir</p>
          <p class="text-base font-extrabold text-brand dark:text-brand-ink mt-0.5">${escapeHtmlJS(fmt(res.finalValue))}</p>
        </div>
        <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total Setoran &amp; Imbal Hasil</p>
          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1">${escapeHtmlJS(fmt(res.totalContributed))}</p>
          <p class="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">+${escapeHtmlJS(fmt(res.totalGain))} gain</p>
        </div>
      `);
    };
    ['cmp-init', 'cmp-mon', 'cmp-rate', 'cmp-yrs'].forEach((id) => { document.getElementById(id).oninput = run; });
    run();
  }

  function renderInstallmentCalcTab(pane, fmt) {
    renderHtml(pane, `
      <div class="space-y-3">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <label for="ins-cash" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Harga Tunai (Rp)</label>
            <input id="ins-cash" type="number" min="0" value="10000000" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
          <div>
            <label for="ins-dp" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Uang Muka / DP</label>
            <input id="ins-dp" type="number" min="0" value="2000000" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
          <div>
            <label for="ins-mon" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Cicilan / Bulan</label>
            <input id="ins-mon" type="number" min="0" value="850000" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
          <div>
            <label for="ins-cnt" class="block font-bold text-slate-600 dark:text-slate-300 mb-1">Tenor (Bln)</label>
            <input id="ins-cnt" type="number" min="1" value="12" class="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
          </div>
        </div>
        <div id="instCalcOut" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 tabular-nums"></div>
      </div>
    `);
    const run = () => {
      const res = FinancePro.simulateInstallmentVsCash(
        document.getElementById('ins-cash').value, document.getElementById('ins-dp').value,
        document.getElementById('ins-mon').value, document.getElementById('ins-cnt').value
      );
      renderHtml(document.getElementById('instCalcOut'), `
        <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total Skema Cicilan</p>
          <p class="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">${escapeHtmlJS(fmt(res.totalInstallment))}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Harga tunai: ${escapeHtmlJS(fmt(res.cashPrice))}</p>
        </div>
        <div class="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-500/10 border border-rose-200/70 dark:border-rose-500/30">
          <p class="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide">Selisih Biaya Bunga/Admin</p>
          <p class="text-base font-extrabold text-rose-600 dark:text-rose-400 mt-0.5">+${escapeHtmlJS(fmt(res.extraCost))}</p>
          <p class="text-xs text-rose-700/80 dark:text-rose-300 mt-0.5">Efektif +${res.effectiveMarkupPct}% lebih mahal</p>
        </div>
      `);
    };
    ['ins-cash', 'ins-dp', 'ins-mon', 'ins-cnt'].forEach((id) => { document.getElementById(id).oninput = run; });
    run();
  }

  async function openFinancialCalculatorsModal() {
    const pro = root.__mkPro || {};
    const userDebts = extractUserDebtItems();
    const totalUserDebt = userDebts.reduce((s, d) => s + d.balance, 0);

    await Swal.fire(pro.swalOpt({
      title: 'Kalkulator Finansial Lokal',
      width: 640,
      html: `
        <div class="text-left space-y-3 text-xs">
          <div class="p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 grid grid-cols-3 gap-1" id="calcTabs">
            <button type="button" data-calc-tab="debt" class="min-h-10 px-2.5 py-2 rounded-xl bg-brand text-white font-bold shadow-xs transition-colors">Lunas Utang</button>
            <button type="button" data-calc-tab="compound" class="min-h-10 px-2.5 py-2 rounded-xl text-slate-600 dark:text-slate-300 font-bold transition-colors">Majemuk</button>
            <button type="button" data-calc-tab="installment" class="min-h-10 px-2.5 py-2 rounded-xl text-slate-600 dark:text-slate-300 font-bold transition-colors">Cicilan</button>
          </div>
          <div id="calcPane"></div>
        </div>
      `,
      confirmButtonText: t('btn.tutup'),
      didOpen: () => {
        const pane = document.getElementById('calcPane');
        const fmt = (n) => formatRupiah(n).replace(',00', '');
        document.querySelectorAll('[data-calc-tab]').forEach((btn) => {
          btn.onclick = () => {
            document.querySelectorAll('[data-calc-tab]').forEach((b) => {
              const on = b === btn;
              b.className = `min-h-10 px-2.5 py-2 rounded-xl font-bold transition-colors ${on ? 'bg-brand text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'}`;
            });
            const tab = btn.getAttribute('data-calc-tab');
            if (tab === 'compound') renderCompoundCalcTab(pane, fmt);
            else if (tab === 'installment') renderInstallmentCalcTab(pane, fmt);
            else renderDebtCalcTab(pane, userDebts, totalUserDebt, fmt);
          };
        });
        renderDebtCalcTab(pane, userDebts, totalUserDebt, fmt);
      }
    }));
  }

  function renderAiChatThread(history) {
    const out = document.getElementById('aiChatResult');
    if (!out) return;
    if (!history.length) {
      out.classList.add('hide');
      out.textContent = '';
      return;
    }
    out.classList.remove('hide');
    renderHtml(out, `<div id="aiChatScroll" class="space-y-3 max-h-[28rem] overflow-y-auto pr-1">${history.map((msg) => {
      const isUser = msg.role === 'user';
      const formatted = !isUser && typeof formatAiMarkdownSafe === 'function'
        ? formatAiMarkdownSafe(msg.text)
        : escapeHtmlJS(msg.text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
      const modelPill = !isUser && msg.model
        ? `<span class="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs font-semibold normal-case text-slate-500 dark:text-slate-400">${escapeHtmlJS(msg.model)}</span>`
        : '';
      return `
        <div class="${isUser ? 'bg-brand/10 border-brand/20 ml-3 sm:ml-8' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 mr-1 sm:mr-4'} p-3.5 rounded-2xl border text-xs sm:text-sm">
          <p class="text-xs font-bold uppercase tracking-wider mb-1 ${isUser ? 'text-brand dark:text-brand-ink' : 'text-slate-500 dark:text-slate-400'}">${isUser ? 'Anda' : 'Gemini AI'}${modelPill}</p>
          <div class="leading-relaxed">${formatted}</div>
        </div>
      `;
    }).join('')}</div>`);
    const scroller = document.getElementById('aiChatScroll');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function clearAiChatHistory() {
    const pro = root.__mkPro || {};
    try { localStorage.removeItem(pro.KEYS.AI_CHAT_HISTORY); } catch (_) { /* ignore */ }
    renderAiChatThread([]);
  }

  function saveAiAnalysisCache(parsed, payload, meta) {
    const pro = root.__mkPro || {};
    if (!parsed || !payload || !payload.period) return;
    const savedAt = (meta && meta.savedAt) || new Date().toISOString();
    pro.safeWriteJson(pro.KEYS.AI_ANALYSIS_CACHE, { period: payload.period, savedAt, meta: meta || null, parsed, payload });
    const box = document.getElementById('aiAnalysisResult');
    if (box) box.dataset.cachedPeriod = payload.period;
  }

  function restoreAiAnalysisCache() {
    const pro = root.__mkPro || {};
    const box = document.getElementById('aiAnalysisResult');
    if (!box || !root.isDataReady) return;
    const cached = pro.safeReadJson(pro.KEYS.AI_ANALYSIS_CACHE, null);
    if (cached && cached.period === DB.currentPeriod && typeof renderAiCashflowResult === 'function') {
      if (box.dataset.cachedPeriod !== DB.currentPeriod || !box.hasChildNodes()) {
        box.classList.remove('hide');
        renderAiCashflowResult(cached.parsed, cached.payload, cached.meta);
        box.dataset.cachedPeriod = cached.period;
      }
    } else if (box.dataset.cachedPeriod && box.dataset.cachedPeriod !== DB.currentPeriod) {
      box.textContent = '';
      box.classList.add('hide');
      delete box.dataset.cachedPeriod;
    }
    const hist = pro.safeReadJson(pro.KEYS.AI_CHAT_HISTORY, []);
    if (Array.isArray(hist) && hist.length) {
      const out = document.getElementById('aiChatResult');
      if (out && !out.hasChildNodes()) renderAiChatThread(hist);
    }
  }

  async function runAiFinancialChat() {
    const pro = root.__mkPro || {};
    const input = document.getElementById('aiChatInput');
    const out = document.getElementById('aiChatResult');
    const btn = document.getElementById('btnAskAiChat');
    const question = ((input && input.value) || '').trim();
    if (!question) { if (input) input.focus(); return; }

    let apiKey = typeof getGeminiApiKeyAsync === 'function' ? await getGeminiApiKeyAsync() : '';
    if (!apiKey && typeof configureGeminiApiKey === 'function') {
      apiKey = await configureGeminiApiKey();
      if (!apiKey) return;
    }

    const hist = pro.safeReadJson(pro.KEYS.AI_CHAT_HISTORY, []);
    const history = Array.isArray(hist) ? hist : [];
    const priorHistory = history.slice();
    const activeModel = typeof getGeminiModel === 'function' ? getGeminiModel() : 'gemini-4-hydrogen';

    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    history.push({ role: 'user', text: question });
    renderAiChatThread(history);
    if (input) input.value = '';
    if (out) {
      const loader = document.createElement('p');
      loader.className = 'text-xs text-slate-500 dark:text-slate-400 mt-2 animate-pulse';
      loader.textContent = `Gemini (${activeModel}) sedang menyusun jawaban...`;
      out.appendChild(loader);
    }

    try {
      const todayStr = localToday();
      const payload = typeof FinanceAnalysis.buildEnrichedAiSnapshot === 'function'
        ? FinanceAnalysis.buildEnrichedAiSnapshot(DB, DB.currentPeriod, DB.payrollDay, todayStr)
        : FinanceAnalysis.buildAiCashflowPayload(DB, DB.currentPeriod, DB.payrollDay);
      const steps = typeof FinanceAnalysis.buildAiChatSteps === 'function'
        ? FinanceAnalysis.buildAiChatSteps(payload, priorHistory, question, currentLang)
        : FinanceAnalysis.buildAiFinancialChatPrompt(payload, question, currentLang);
      const systemInstruction = typeof FinanceAnalysis.buildGeminiSystemInstruction === 'function'
        ? FinanceAnalysis.buildGeminiSystemInstruction('chat', currentLang) : '';
      const res = await callGeminiApi(apiKey, {
        input: steps,
        systemInstruction,
        thinkingLevel: typeof getGeminiThinkingLevel === 'function' ? getGeminiThinkingLevel() : 'medium'
      });
      const answer = (res && res.text) || (typeof extractGeminiText === 'function' ? extractGeminiText(res && res.json) : '');
      if (!answer) throw new Error('Gemini tidak mengembalikan jawaban.');
      history.push({ role: 'assistant', text: answer, model: (res && res.model) || activeModel });
      const trimmed = history.slice(-12);
      pro.safeWriteJson(pro.KEYS.AI_CHAT_HISTORY, trimmed);
      renderAiChatThread(trimmed);
      if (typeof updateAiKeyStatusUI === 'function') updateAiKeyStatusUI();
    } catch (err) {
      history.pop();
      pro.safeWriteJson(pro.KEYS.AI_CHAT_HISTORY, history);
      renderAiChatThread(history);
      Swal.fire(pro.swalOpt({ icon: 'error', title: 'Gagal meminta jawaban AI', text: toUserErrorMessage(err) }));
    } finally {
      if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    }
  }

  async function openRebalanceTargetsModal() {
    const pro = root.__mkPro || {};
    const defaults = { 'Kas & Likuid': 25, Emas: 25, 'Valas USD': 15, 'Saham & Lainnya': 20, Crypto: 15 };
    const saved = pro.safeReadJson(pro.KEYS.REBALANCE_TARGETS, defaults) || defaults;
    const keys = Object.keys(defaults);

    const res = await Swal.fire(pro.swalOpt({
      title: 'Target Alokasi & Rebalance',
      width: 480,
      html: `
        <div class="text-left space-y-2.5 text-xs">
          <div class="flex items-center justify-between gap-2">
            <p class="text-slate-600 dark:text-slate-300">Atur target porsi portofolio (wajib total 100%).</p>
            <span id="rebTotalBadge" class="px-2.5 py-1 rounded-full text-xs font-extrabold tabular-nums">Total: 100%</span>
          </div>
          ${keys.map((k, idx) => `
            <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70">
              <label for="reb-${idx}" class="font-bold text-slate-700 dark:text-slate-200">${escapeHtmlJS(k)}</label>
              <div class="flex items-center gap-1.5 shrink-0">
                <input id="reb-${idx}" data-reb-key="${escapeHtmlJS(k)}" type="number" min="0" max="100" value="${Number(saved[k]) || 0}"
                       class="w-20 min-h-10 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand">
                <span class="font-bold text-slate-500 dark:text-slate-400">%</span>
              </div>
            </div>`).join('')}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
      didOpen: () => {
        const badge = document.getElementById('rebTotalBadge');
        const syncTotal = () => {
          let sum = 0;
          document.querySelectorAll('[data-reb-key]').forEach((inp) => { sum += Math.max(0, Number(inp.value) || 0); });
          if (!badge) return;
          badge.textContent = `Total: ${sum}%`;
          const ok = Math.round(sum) === 100;
          badge.className = `px-2.5 py-1 rounded-full text-xs font-extrabold tabular-nums ${ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'}`;
        };
        document.querySelectorAll('[data-reb-key]').forEach((inp) => { inp.oninput = syncTotal; });
        syncTotal();
      },
      preConfirm: () => {
        const next = {};
        let sum = 0;
        document.querySelectorAll('[data-reb-key]').forEach((inp) => {
          const val = Math.max(0, Number(inp.value) || 0);
          next[inp.getAttribute('data-reb-key')] = val;
          sum += val;
        });
        if (Math.round(sum) !== 100) {
          Swal.showValidationMessage(`Total harus 100% (saat ini ${sum}%).`);
          return false;
        }
        return next;
      }
    }));

    if (res.isConfirmed && res.value && typeof root.renderAssetAllocation === 'function') {
      pro.safeWriteJson(pro.KEYS.REBALANCE_TARGETS, res.value);
      root.renderAssetAllocation();
    }
  }

  function decorateAssetRebalanceStrip() {
    const pro = root.__mkPro || {};
    const panel = document.getElementById('assetAllocationPanel');
    if (!panel || typeof FinancePro === 'undefined' || !root.isDataReady) return;
    const card = panel.firstElementChild;
    if (!card) return;
    card.querySelectorAll('.mk-rebalance-strip').forEach((oldStrip) => oldStrip.remove());

    const saved = pro.safeReadJson(pro.KEYS.REBALANCE_TARGETS, null);
    const wb = typeof walletBalances === 'function' ? walletBalances() : null;
    const alloc = FinanceAnalysis.computeAssetAllocation({
      wallets: DB.wallets || [],
      assets: DB.assets || [],
      transactions: DB.transactions || [],
      transfers: DB.transfers || [],
      walletBalances: wb
    });
    const rebalance = saved && alloc.total > 0 ? FinancePro.computePortfolioRebalance(alloc.segments, saved) : null;

    const strip = document.createElement('div');
    strip.className = 'mk-rebalance-strip mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs';
    renderHtml(strip, `
      <div class="flex flex-wrap items-center gap-1.5">
        ${rebalance ? rebalance.rows.map((r) => `
          <span class="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 tabular-nums">
            <strong>${escapeHtmlJS(r.label)}</strong>: ${r.currentPct}% → ${r.targetPct}%
            (<span class="${r.action === 'Tambah' ? 'text-emerald-700 dark:text-emerald-400' : r.action === 'Kurangi' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'} font-bold">${escapeHtmlJS(r.action)}${r.action !== 'Seimbang' ? ' ' + escapeHtmlJS(formatShortIDR(Math.abs(r.deltaAmount))) : ''}</span>)
          </span>`).join('') : '<span class="text-slate-500 dark:text-slate-400">Belum ada target alokasi rebalancing.</span>'}
      </div>
      <button type="button" data-action="openRebalanceTargetsModal" class="min-h-9 px-3 py-1.5 rounded-xl bg-brand/10 text-brand dark:text-brand-ink font-bold hover:bg-brand/20">Atur Target</button>
    `);
    card.appendChild(strip);
  }

  root.__mkPro = Object.assign(root.__mkPro || {}, { decorateAssetRebalanceStrip });
  Object.assign(root, {
    openFinancialCalculatorsModal,
    clearAiChatHistory,
    saveAiAnalysisCache,
    restoreAiAnalysisCache,
    runAiFinancialChat,
    openRebalanceTargetsModal
  });
})(typeof window !== 'undefined' ? window : globalThis);
