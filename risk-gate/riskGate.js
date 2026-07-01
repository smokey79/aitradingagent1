/**
 * Risk Gate
 * Hard rules that MUST pass before any trade is placed.
 * Returns { approved, reason, positionSize, leverage }
 */
const logger = require('../utils/logger');

const INITIAL_DEPOSIT  = parseFloat(process.env.INITIAL_DEPOSIT  || '250');
const MIN_CONFIDENCE   = parseFloat(process.env.MIN_CONFIDENCE   || '0.70');
const LEVERAGE_MAX     = parseFloat(process.env.LEVERAGE_MAX     || '5');
const MAX_SINGLE_TRADE = 0.10; // Never risk more than 10% of balance on one trade
const MIN_AGENTS       = 3;    // At least 3 agents must agree

// Simulated balance tracker (in production, query exchange directly)
let currentBalance = INITIAL_DEPOSIT;
let totalPnL = 0;

async function checkRiskGate(pair, consensus, marketData) {
  const checks = [];

  // 1. Confidence threshold
  if (consensus.confidence < MIN_CONFIDENCE) {
    return fail(`Confidence ${(consensus.confidence*100).toFixed(1)}% below ${(MIN_CONFIDENCE*100)}% minimum`);
  }
  checks.push('✓ Confidence');

  // 2. Minimum agents agreeing
  if (consensus.agentsAgreeing < MIN_AGENTS) {
    return fail(`Only ${consensus.agentsAgreeing} agents agree — need ${MIN_AGENTS}`);
  }
  checks.push(`✓ Agent agreement (${consensus.agentsAgreeing})`);

  // 3. Don't trade neutral signals
  if (consensus.signal === 'neutral') {
    return fail('Signal is neutral — no edge detected');
  }
  checks.push('✓ Signal direction');

  // 4. Check market data available
  if (!marketData.price) {
    return fail('No price data available — cannot size position');
  }
  checks.push('✓ Market data');

  // 5. Position sizing (Kelly-inspired: scale with confidence)
  const baseRisk   = currentBalance * MAX_SINGLE_TRADE;
  const kellySized = baseRisk * consensus.confidence;
  const positionSize = Math.max(10, Math.min(kellySized, currentBalance * 0.25)); // $10 min, 25% max

  // 6. Leverage — only allow above 1x if confidence is very high
  let leverage = 1;
  if (consensus.confidence >= 0.85 && LEVERAGE_MAX > 1) leverage = 2;
  if (consensus.confidence >= 0.92 && LEVERAGE_MAX >= 5) leverage = 3;

  logger.info(`  Risk gate checks: ${checks.join(', ')}`);

  return {
    approved: true,
    positionSize: parseFloat(positionSize.toFixed(2)),
    leverage,
    stopLossPercent: 2.0,   // 2% stop loss
    takeProfitPercent: 4.0, // 4% take profit (2:1 R:R)
    reason: checks.join(', '),
  };
}

function fail(reason) {
  return { approved: false, reason, positionSize: 0, leverage: 1 };
}

function updateBalance(newBalance, pnl) {
  currentBalance = newBalance;
  totalPnL += pnl;
  logger.info(`Balance updated: $${currentBalance.toFixed(2)} (Total PnL: $${totalPnL.toFixed(2)})`);
}

function getBalance() { return { currentBalance, totalPnL }; }

module.exports = { checkRiskGate, updateBalance, getBalance };
