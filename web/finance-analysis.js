(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const core = isNode ? require('./finance-analysis-core.js') : root.FinanceAnalysisCore;
  const ai = isNode ? require('./finance-analysis-ai.js') : root.FinanceAnalysisAi;
  const portfolio = isNode ? require('./finance-analysis-portfolio.js') : root.FinanceAnalysisPortfolio;
  const backup = isNode ? require('./finance-analysis-backup.js') : root.FinanceAnalysisBackup;

  const api = Object.assign({}, core, ai, portfolio, backup);
  root.FinanceAnalysis = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
