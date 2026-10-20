/**
 * Low-cost advisory review: one existing local Ollama model in two sequential roles.
 * No cloud or social agent is called by this module. Roles are correlated opinions.
 */
const hermes = require('../agents/hermes/hermesAgent');
const { reserveReview } = require('./reviewBudget');
const weights = { bull: 0.5, bear: 0.5 };
const scores = { bullish: 1, neutral: 0, bearish: -1 };
function aggregate(signals, expectedNames) {
  const valid = signals.filter((s) => expectedNames.includes(s.name) &&
    Object.hasOwn(scores, s.signal) && Number.isFinite(s.confidence) &&
    s.confidence >= 0 && s.confidence <= 1);
  let weightedScore = 0, totalWeight = 0;
  for (const s of valid) {
    const effective = weights[s.name] * s.confidence;
    weightedScore += scores[s.signal] * effective;
    totalWeight += effective;
  }
  const avgScore = totalWeight ? weightedScore / totalWeight : 0;
  const signal = avgScore > 0.2 ? 'bullish' : avgScore < -0.2 ? 'bearish' : 'neutral';
  return {
    signal,
    confidence: Math.min(1, Math.abs(avgScore) * valid.length / expectedNames.length),
    agentsAgreeing: valid.filter((s) => s.signal === signal).length,
    totalAgents: expectedNames.length,
    breakdown: valid.map(({name, signal, confidence, reason}) => ({name, signal, confidence, reason})),
  };
}


async function runConsensus(pair, marketData, options = {}) {
  const allowance = (options.reserveReview || reserveReview)();
  if (!allowance.approved) {
    return { status: 'review_skipped', reason: allowance.reason, signal: 'neutral',
      confidence: 0, agentsAgreeing: 0, totalAgents: 2, breakdown: [],
      snapshotId: marketData.snapshotId, executionAllowed: false };
  }
  const reviewer = options.reviewer || hermes;
  const signals = [];
  for (const role of ['bull', 'bear']) {
    try {
      const result = await reviewer.getSignal(pair.split('/')[0], Object.freeze({
        ...marketData, analysisRole: role,
      }));
      signals.push({ ...result, name: role });
    } catch (_) { /* An unavailable local model supplies no evidence. */ }
  }
  return { ...aggregate(signals, ['bull','bear']), status: 'local_advisory_only',
    snapshotId: marketData.snapshotId, baseline: 'local_two_role_market_context',
    note: 'Two roles share one model; this is not independent corroboration.',
    executionAllowed: false };
}
module.exports = { runConsensus, aggregate };
