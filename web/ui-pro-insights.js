/* global DB, FinancePro, FinanceAnalysis, Swal, formatRupiah, formatShortIDR, escapeHtmlJS, renderHtml, getGeminiApiKey, configureGeminiApiKey, callGeminiApi, renderAiCashflowResult, walletBalances, currentLang, t */
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
      <p class="text-slate-500 mb-2">Terdeteksi <strong>${userDebts.length}</strong> utang aktif (${escapeHtmlJS(fmt(totalUserDebt))}).</p>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input id="calc-extra" type="number" min="0" value="500000" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Ekstra bayar/bln">
        <button type="button" id="btnRunDebtCalc" class="px-3 py-2 rounded-lg bg-brand text-white font-bold">Bandingkan Strategi</button>
      </div>
      <div id="debtCalcOut" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"></div>
    `);
    const run = () => {
      const extra = Number(document.getElementById('calc-extra').value) || 0;
      const snow = FinancePro.simulateDebtPayoff(base, extra, 'snowball');
      const aval = FinancePro.simulateDebtPayoff(base, extra, 'avalanche');
      renderHtml(document.getElementById('debtCalcOut'), `
        <p><strong>Snowball</strong> (terkecil dulu): <strong>${snow.months} bln</strong> · Total ${escapeHtmlJS(fmt(snow.totalPaid))}</p>
        <p class="mt-1"><strong>Avalanche</strong> (bunga/saldo terbesar dulu): <strong>${aval.months} bln</strong> · Total ${escapeHtmlJS(fmt(aval.totalPaid))}</p>
      `);
    };
    document.getElementById('btnRunDebtCalc').onclick = run;
    run();
  }

  function renderCompoundCalcTab(pane, fmt) {
    renderHtml(pane, `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <input id="cmp-init" type="number" value="5000000" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Modal awal">
        <input id="cmp-mon" type="number" value="1000000" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Setor/bln">
        <input id="cmp-rate" type="number" step="0.5" value="8" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Return %/th">
        <input id="cmp-yrs" type="number" min="1" max="40" value="5" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Tahun">
      </div>
      <div id="compCalcOut" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"></div>
    `);
    const run = () => {
      const res = FinancePro.simulateCompoundGrowth(
        document.getElementById('cmp-init').value, document.getElementById('cmp-mon').value,
        document.getElementById('cmp-rate').value, document.getElementById('cmp-yrs').value
      );
      renderHtml(document.getElementById('compCalcOut'), `
        <p>Nilai Akhir: <strong class="text-brand dark:text-brand-ink">${escapeHtmlJS(fmt(res.finalValue))}</strong></p>
        <p class="mt-1">Total Setoran: ${escapeHtmlJS(fmt(res.totalContributed))} · Imbal Hasil: <strong class="text-emerald-600">+${escapeHtmlJS(fmt(res.totalGain))}</strong></p>
      `);
    };
    ['cmp-init', 'cmp-mon', 'cmp-rate', 'cmp-yrs'].forEach((id) => { document.getElementById(id).oninput = run; });
    run();
  }

  function renderInstallmentCalcTab(pane, fmt) {
    renderHtml(pane, `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <input id="ins-cash" type="number" value="10000000" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Harga Tunai">
        <input id="ins-dp" type="number" value="2000000" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="DP">
        <input id="ins-mon" type="number" value="850000" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Cicilan/bln">
        <input id="ins-cnt" type="number" min="1" value="12" class="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Tenor (bln)">
      </div>
      <div id="instCalcOut" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"></div>
    `);
    const run = () => {
      const res = FinancePro.simulateInstallmentVsCash(
        document.getElementById('ins-cash').value, document.getElementById('ins-dp').value,
        document.getElementById('ins-mon').value, document.getElementById('ins-cnt').value
      );
      renderHtml(document.getElementById('instCalcOut'), `
        <p>Total Cicilan: <strong>${escapeHtmlJS(fmt(res.totalInstallment))}</strong> vs Tunai <strong>${escapeHtmlJS(fmt(res.cashPrice))}</strong></p>
        <p class="mt-1">Selisih Biaya: <strong class="text-rose-600">+${escapeHtmlJS(fmt(res.extraCost))} (${res.effectiveMarkupPct}%)</strong></p>
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
          <div class="flex flex-wrap gap-1.5" id="calcTabs">
            <button type="button" data-calc-tab="debt" class="px-3 py-1.5 rounded-xl bg-brand text-white font-bold">Lunas Utang</button>
            <button type="button" data-calc-tab="compound" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold">Bunga Majemuk</button>
            <button type="button" data-calc-tab="installment" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold">Cicilan vs Tunai</button>
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
              b.className = `px-3 py-1.5 rounded-xl font-bold ${on ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800'}`;
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
    renderHtml(out, `<div class="space-y-3 max-h-96 overflow-y-auto pr-1">${history.map((msg) => {
      const isUser = msg.role === 'user';
      const formatted = escapeHtmlJS(msg.text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
      return `
        <div class="${isUser ? 'bg-brand/10 border-brand/20 ml-6' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 mr-6'} p-3 rounded-2xl border text-xs sm:text-sm">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-1 ${isUser ? 'text-brand dark:text-brand-ink' : 'text-slate-400'}">${isUser ? 'Anda' : 'Gemini AI'}</p>
          <div class="leading-relaxed">${formatted}</div>
        </div>
      `;
    }).join('')}</div>`);
  }

  function clearAiChatHistory() {
    const pro = root.__mkPro || {};
    try { localStorage.removeItem(pro.KEYS.AI_CHAT_HISTORY); } catch (_) { /* ignore */ }
    renderAiChatThread([]);
  }

  function saveAiAnalysisCache(parsed, payload) {
    const pro = root.__mkPro || {};
    if (!parsed || !payload || !payload.period) return;
    pro.safeWriteJson(pro.KEYS.AI_ANALYSIS_CACHE, { period: payload.period, savedAt: new Date().toISOString(), parsed, payload });
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
        renderAiCashflowResult(cached.parsed, cached.payload);
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

    let apiKey = typeof getGeminiApiKey === 'function' ? getGeminiApiKey() : '';
    if (!apiKey && typeof configureGeminiApiKey === 'function') {
      apiKey = await configureGeminiApiKey();
      if (!apiKey) return;
    }

    const hist = pro.safeReadJson(pro.KEYS.AI_CHAT_HISTORY, []);
    const history = Array.isArray(hist) ? hist : [];
    const recentTurns = history.slice(-4).map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n');
    const contextPrompt = recentTurns ? `${recentTurns}\nPertanyaan lanjutan: ${question}` : question;

    if (btn) btn.disabled = true;
    history.push({ role: 'user', text: question });
    renderAiChatThread(history);
    if (input) input.value = '';
    if (out) {
      const loader = document.createElement('p');
      loader.className = 'text-xs text-slate-400 mt-2 animate-pulse';
      loader.textContent = 'Gemini sedang menyusun jawaban...';
      out.appendChild(loader);
    }

    try {
      const payload = FinanceAnalysis.buildAiCashflowPayload(DB, DB.currentPeriod, DB.payrollDay);
      const prompt = FinanceAnalysis.buildAiFinancialChatPrompt(payload, contextPrompt, currentLang);
      const { json } = await callGeminiApi(apiKey, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.35 } });
      const answer = (((json || {}).candidates || [])[0] || {}).content?.parts?.map((p) => p.text || '').join('') || '';
      if (!answer) throw new Error('Gemini tidak mengembalikan jawaban.');
      history.push({ role: 'assistant', text: answer });
      const trimmed = history.slice(-12);
      pro.safeWriteJson(pro.KEYS.AI_CHAT_HISTORY, trimmed);
      renderAiChatThread(trimmed);
    } catch (err) {
      history.pop();
      pro.safeWriteJson(pro.KEYS.AI_CHAT_HISTORY, history);
      renderAiChatThread(history);
      Swal.fire(pro.swalOpt({ icon: 'error', title: 'Gagal meminta jawaban AI', text: String((err && err.message) || err) }));
    } finally {
      if (btn) btn.disabled = false;
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
          <p class="text-slate-500">Atur target persentase portofolio (total harus 100%).</p>
          ${keys.map((k) => `
            <div class="flex items-center justify-between gap-2">
              <label class="font-bold">${escapeHtmlJS(k)}</label>
              <input data-reb-key="${escapeHtmlJS(k)}" type="number" min="0" max="100" value="${Number(saved[k]) || 0}"
                     class="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right">
            </div>`).join('')}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: t('btn.simpan'),
      cancelButtonText: t('btn.batal'),
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
          <span class="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
            <strong>${escapeHtmlJS(r.label)}</strong>: ${r.currentPct}% → ${r.targetPct}%
            (<span class="${r.action === 'Tambah' ? 'text-emerald-600' : r.action === 'Kurangi' ? 'text-rose-600' : 'text-slate-400'} font-bold">${escapeHtmlJS(r.action)}${r.action !== 'Seimbang' ? ' ' + escapeHtmlJS(formatShortIDR(Math.abs(r.deltaAmount))) : ''}</span>)
          </span>`).join('') : '<span class="text-slate-400">Belum ada target alokasi rebalancing.</span>'}
      </div>
      <button type="button" onclick="openRebalanceTargetsModal()" class="px-3 py-1.5 rounded-xl bg-brand/10 text-brand dark:text-brand-ink font-bold hover:bg-brand/20">Atur Target</button>
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
