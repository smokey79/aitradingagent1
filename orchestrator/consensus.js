/**
 * Consensus Engine
 * Polls all agents in parallel, applies credibility weights,
 * returns a single weighted signal + confidence score.
 */
const logger = require('../utils/logger');
const claudeAgent  = require('../agents/claude/claudeAgent');
const gpt4oAgent   = require('../agents/gpt4o/gpt4oAgent');
const geminiAgent  = require('../agents/gemini/geminiAgent');
const hermesAgent  = require('../agents/hermes/hermesAgent');
const sentimentAgent = require('../agents/sentiment/youtubeSentimentAgent');

// Agent weights — Hermes acts as validator/tie-breaker
const AGENT_WEIGHTS = {
  claude:    0.25,
  gpt4o:     0.20,
  gemini:    0.20,
  hermes:    0.20,  // local Hermes consensus validator
  sentiment: 0.15,
};

const SIGNAL_SCORES = { bullish: 1, neutral: 0, bearish: -1 };

async function runConsensus(pair, marketData) {
  const symbol = pair.split('/')[0];

  // Poll all agents simultaneously — don't let one slow agent block others
  const results = await Promise.allSettled([
    withTimeout(claudeAgent.getSignal(symbol, marketData),   15000, 'claude'),
    withTimeout(gpt4oAgent.getSignal(symbol, marketData),    15000, 'gpt4o'),
    withTimeout(geminiAgent.getSignal(symbol, marketData),   15000, 'gemini'),
    withTimeout(hermesAgent.getSignal(symbol, marketData),   20000, 'hermes'),
    withTimeout(sentimentAgent.getSentimentSignal(symbol),   15000, 'sentiment'),
  ]);

  const agentNames = ['claude', 'gpt4o', 'gemini', 'hermes', 'sentiment'];
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

  // Weighted average
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
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms))
  ]);
}

module.exports = { runConsensus };
