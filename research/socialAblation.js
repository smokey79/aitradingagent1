/**
 * Paired OOS ablation report from resolved, cost-adjusted paper/replay outcomes.
 * No feeds, LLM calls, strategy mutation or promotion. R = P&L / initial risk.
 */
function evaluateAblation(rows) {
  if (!Array.isArray(rows) || !rows.length) return { status: 'awaiting_paired_oos_results' };
  const ids = new Set();
  for (const row of rows) {
    if (typeof row.snapshotId !== 'string' || ids.has(row.snapshotId) ||
        row.split !== 'oos' || !row.fold || row.costsIncluded !== true ||
        ![row.priceOnlyNetR, row.withSocialNetR, row.socialKnownAtMs,
          row.decisionAtMs, row.outcomeResolvedAtMs].every(Number.isFinite) ||
        row.socialKnownAtMs > row.decisionAtMs ||
        row.outcomeResolvedAtMs <= row.decisionAtMs) {
      throw new Error('Invalid, duplicated, future-leaking or non-OOS paired outcome');
    }
    ids.add(row.snapshotId);
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const summarize = (group) => ({
    samples: group.length,
    priceOnlyMeanNetR: mean(group.map((r) => r.priceOnlyNetR)),
    withSocialMeanNetR: mean(group.map((r) => r.withSocialNetR)),
    meanPairedLiftR: mean(group.map((r) => r.withSocialNetR - r.priceOnlyNetR)),
  });
  const folds = {};
  for (const fold of new Set(rows.map((r) => r.fold))) {
    folds[fold] = summarize(rows.filter((r) => r.fold === fold));
  }
  return {
    status: rows.length >= 100 && Object.keys(folds).length >= 3 ? 'descriptive_oos_report' : 'insufficient_evidence',
    ...summarize(rows), folds, promotionAllowed: false,
    note: 'Descriptive means only. Review drawdowns, uncertainty, cost assumptions and selection bias separately.',
  };
}
module.exports = { evaluateAblation };
