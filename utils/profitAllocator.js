/**
 * Profit Allocator
 * On every profitable close:
 *   40% → reinvested back into trading balance
 *   50% → converted to BTC (savings)
 *   10% → long-term hold wallet
 *
 * At 2x initial deposit trigger → auto-allocate and log withdrawal recommendation
 */
const logger = require('./logger');
const { updateBalance, getBalance } = require('../risk-gate/riskGate');

const INITIAL_DEPOSIT   = parseFloat(process.env.INITIAL_DEPOSIT   || '250');
const REINVEST_PCT      = parseFloat(process.env.PROFIT_REINVEST_PCT || '0.40');
const BTC_PCT           = parseFloat(process.env.PROFIT_BTC_PCT      || '0.50');
const LONGTERM_PCT      = parseFloat(process.env.PROFIT_LONGTERM_PCT || '0.10');
const DOUBLE_TRIGGER    = parseFloat(process.env.PROFIT_DOUBLE_TRIGGER || '2');

let btcSavings   = 0;
let longtermHold = 0;
let totalWithdrawn = 0;

async function allocateProfits(tradeResult) {
  const { currentBalance } = getBalance();
  // Simplified PnL — in production parse from order fill
  const estimatedPnL = tradeResult?.pnl || 0;
  if (estimatedPnL <= 0) return;

  const reinvest  = estimatedPnL * REINVEST_PCT;
  const toBTC     = estimatedPnL * BTC_PCT;
  const longterm  = estimatedPnL * LONGTERM_PCT;

  btcSavings   += toBTC;
  longtermHold += longterm;
  updateBalance(currentBalance + reinvest, estimatedPnL);

  logger.info(`💰 Profit allocated: +$${reinvest.toFixed(2)} reinvested | +$${toBTC.toFixed(2)} → BTC savings | +$${longterm.toFixed(2)} → long-term`);
  logger.info(`   BTC savings pool: $${btcSavings.toFixed(2)} | Long-term pool: $${longtermHold.toFixed(2)}`);

  // 2x trigger check
  const { currentBalance: newBalance } = getBalance();
  if (newBalance >= INITIAL_DEPOSIT * DOUBLE_TRIGGER) {
    logger.info(`\n🎯 2x TRIGGER HIT — Balance $${newBalance.toFixed(2)} >= $${(INITIAL_DEPOSIT * DOUBLE_TRIGGER).toFixed(2)}`);
    logger.info(`   Recommend: withdraw $${btcSavings.toFixed(2)} BTC savings + $${longtermHold.toFixed(2)} long-term hold`);
    logger.info(`   Continuing with $${(newBalance * REINVEST_PCT).toFixed(2)} reinvested trading capital`);
  }
}

function getSummary() {
  return { btcSavings, longtermHold, totalWithdrawn, ...getBalance() };
}

module.exports = { allocateProfits, getSummary };
