/**
 * Consensus Engine — OpenRouter + Hermes Optimized
 * Uses free OpenRouter models + local Hermes validator for cost-free trading.
 * Better for constrained hardware (16GB RAM, Radeon 5000).
 */
const logger = require('../utils/logger');
const openrouterAgent = require('../agents/openrouter/openrouterAgent');
const hermesAgent = require('../agents/hermes/hermesAgent');
const sentimentAgent = require('../agents/sentiment/youtubeSentimentAgent');

// Agent credibility weights — Hermes acts as tie-breaker validator
const AGENT_WEIGHTS = {
  openrouter: 0.40, // Fast consensus from free cloud models (40%)
  hermes:     0.35, // Local validator, secondary vote (35%)
  sentiment:  0.25, // Contrarian signal (25%)
};

const SIGNAL_SCORES = { bullish: 1, neutral: 0, bearish: -1 };

async function runConsensus(pair, marketData) {
  const symbol = pair.split('/')[0];

  logger.info(`  Polling agents for ${symbol}...`);

  // Poll all agents simultaneously — fail-safe design
  const results = await Promise.allSettled([
    withTimeout(openrouterAgent.getSignal(symbol, marketData), 20000, 'openrouter'),
    withTimeout(hermesAgent.getSignal(symbol, marketData), 25000, 'hermes'),
    withTimeout(sentimentAgent.getSentimentSignal(symbol), 20000, 'sentiment'),
  ]);

  const agentNames = ['openrouter', 'hermes', 'sentiment'];
  const signals = [];

  for (let i = 0; i < results.length; i++) {
    const name = agentNames[i];
    if (results[i].status === 'fulfilled') {
      signals.push({ name, ...results[i].value, weight: AGENT_WEIGHTS[name] });
      logger.info(`  [${name}] ${results[i].value.signal} @ ${(results[i].value.confidence * 100).toFixed(0)}%`);
    } else {
      logger.warn(`  [${name}] ⚠️  failed: ${results[i].reason?.message}`);
    }
  }

  if (signals.length === 0) {
    return { signal: 'neutral', confidence: 0, agentsAgreeing: 0, totalAgents: agentNames.length, breakdown: [] };
  }

  // Weighted average: score × (agent_weight × agent_confidence)
  let weightedScore = 0, totalWeight = 0;
  for (const s of signals) {
    const effectiveWeight = s.weight * s.confidence;
    weightedScore += (SIGNAL_SCORES[s.signal] || 0) * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  const avgScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const signal = avgScore > 0.2 ? 'bullish' : avgScore < -0.2 ? 'bearish' : 'neutral';
  const confidence = Math.min(1, Math.abs(avgScore) * (signals.length / agentNames.length));

  const agentsAgreeing = signals.filter(s => s.signal === signal).length;

  return {
    signal,
    confidence,
    avgScore,
    agentsAgreeing,
    totalAgents: agentNames.length,
    breakdown: signals.map(s => ({ name: s.name, signal: s.signal, confidence: s.confidence, reason: s.reason })),
  };
}

function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
    )
  ]);
}

module.exports = { runConsensus };
