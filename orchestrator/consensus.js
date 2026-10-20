/**
 * Advisory AI consensus. Social is disabled by default; when enabled it produces
 * a separate paired challenger score and never changes the price-only result.
 * These scores are agent agreement, not calibrated probabilities of trade success.
 */
const logger = require('../utils/logger');
const agents = {
  claude: require('../agents/claude/claudeAgent'),
  gpt4o: require('../agents/gpt4o/gpt4oAgent'),
  gemini: require('../agents/gemini/geminiAgent'),
  hermes: require('../agents/hermes/hermesAgent'),
};
const weights = { claude: 0.25, gpt4o: 0.20, gemini: 0.20, hermes: 0.20, sentiment: 0.15 };
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

async function withTimeout(promise, ms, name) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(name + ' timed out')), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function runConsensus(pair, marketData) {
  const names = Object.keys(agents);
  const results = await Promise.allSettled(names.map((name) =>
    withTimeout(Promise.resolve().then(() => agents[name].getSignal(pair.split('/')[0], marketData)),
      name === 'hermes' ? 20000 : 15000, name)));
  const signals = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') signals.push({ ...result.value, name: names[i] });
    else logger.warn('[' + names[i] + '] unavailable: ' + result.reason.message);
  });
  const baseline = aggregate(signals, names);
  let socialChallenger = null;
  if (process.env.SOCIAL_ABLATION_ENABLED === 'true') {
    // Deliberate research opt-in: optional social source performs its own timed fetch.
    // Keep source availability separate; it is not part of the captured price snapshot.
    const socialKnownAt = Date.now();
    try {
      const agent = require('../agents/sentiment/youtubeSentimentAgent');
      const social = await withTimeout(agent.getSentimentSignal(pair.split('/')[0]), 15000, 'sentiment');
      socialChallenger = {
        ...aggregate(signals.concat({ ...social, name: 'sentiment' }), names.concat('sentiment')),
        retrievedAt: Date.now(), requestedAt: socialKnownAt,
        status: 'unvalidated_research_score',
      };
    } catch (err) { socialChallenger = { status: 'unavailable' }; }
  }
  return { ...baseline, snapshotId: marketData.snapshotId, baseline: 'price_only_agents',
    socialChallenger, executionAllowed: false };
}

module.exports = { runConsensus, aggregate };
