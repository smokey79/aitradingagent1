/**
 * AiTradingAgent — OpenRouter Optimized Orchestrator
 * Main loop: fetch data → poll agents → consensus → risk gate → execute
 * Uses free OpenRouter + local Hermes (zero API cost)
 */
require('../utils/loadEnv');
const cron = require('node-cron');
const logger = require('../utils/logger');
const { fetchMarketData } = require('../data/marketData');
const { runConsensus } = require('./consensus-openrouter');
const { checkRiskGate } = require('../risk-gate/riskGate');
const { executeTradeOnBestExchange } = require('../utils/exchangeRouter');
const { allocateProfits } = require('../utils/profitAllocator');

const PAIRS = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,CRO/USDT,SOL/USDT').split(',');
const PAPER = process.env.PAPER_TRADING !== 'false';
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || '0.70');
const CYCLE_INTERVAL = process.env.CYCLE_INTERVAL || '*/15 * * * *'; // Every 15 minutes

logger.info(`🚀 AiTradingAgent (OpenRouter Optimized) starting`);
logger.info(`   Mode: ${PAPER ? '📄 PAPER TRADING' : '🔴 LIVE TRADING'}`);
logger.info(`   Trading pairs: ${PAIRS.join(', ')}`);
logger.info(`   Min confidence: ${(MIN_CONFIDENCE * 100).toFixed(0)}%`);
logger.info(`   Agents: OpenRouter (free) + Hermes (local) + YouTube Sentiment`);
logger.info(`   Cost: $0/month (free tier only)\n`);

async function runTradingCycle() {
  const cycleStart = Date.now();
  logger.info('─── New trading cycle starting ───');

  let successCount = 0, skipCount = 0, failCount = 0;

  for (const pair of PAIRS) {
    try {
      logger.info(`\n[${pair}] Fetching market data...`);
      const marketData = await fetchMarketData(pair);

      if (!marketData.price) {
        logger.warn(`[${pair}] ⚠️  No market data — skipping`);
        skipCount++;
        continue;
      }

      logger.info(`[${pair}] Price: $${marketData.price.price?.toFixed(2)} (${marketData.price.change24h?.toFixed(2)}% in 24h)`);

      logger.info(`[${pair}] Running consensus...`);
      const consensus = await runConsensus(pair, marketData);
      logger.info(`[${pair}] Consensus: ${consensus.signal.toUpperCase()} @ ${(consensus.confidence * 100).toFixed(1)}% (${consensus.agentsAgreeing}/${consensus.totalAgents} agents)`);

      if (consensus.confidence < MIN_CONFIDENCE) {
        logger.info(`[${pair}] ⚠️  Confidence ${(consensus.confidence * 100).toFixed(1)}% < ${(MIN_CONFIDENCE * 100)}% — skipping`);
        skipCount++;
        continue;
      }

      logger.info(`[${pair}] Running risk gate...`);
      const riskCheck = await checkRiskGate(pair, consensus, marketData);
      if (!riskCheck.approved) {
        logger.info(`[${pair}] 🛑 Risk gate rejected: ${riskCheck.reason}`);
        skipCount++;
        continue;
      }

      logger.info(`[${pair}] ✅ Risk gate approved — Position: $${riskCheck.positionSize} @ ${riskCheck.leverage}x leverage`);

      if (PAPER) {
        logger.info(`[${pair}] 📄 PAPER TRADE: ${consensus.signal.toUpperCase()} $${riskCheck.positionSize} USDT at ${riskCheck.leverage}x`);
        successCount++;
      } else {
        logger.info(`[${pair}] 🚨 LIVE TRADE: Executing ${consensus.signal.toUpperCase()} order...`);
        const result = await executeTradeOnBestExchange(pair, consensus.signal, riskCheck);
        logger.info(`[${pair}] ✅ Trade executed: ${JSON.stringify(result)}`);
        await allocateProfits(result);
        successCount++;
      }
    } catch (err) {
      logger.error(`[${pair}] ❌ Cycle error: ${err.message}`);
      failCount++;
    }
  }

  const cycleTime = ((Date.now() - cycleStart) / 1000).toFixed(2);
  logger.info(`\n─── Cycle complete (${cycleTime}s) ───`);
  logger.info(`   Results: ${successCount} trades, ${skipCount} skipped, ${failCount} errors\n`);
}

// Schedule: Run every 15 minutes (or custom interval from .env)
cron.schedule(CYCLE_INTERVAL, runTradingCycle);

// Run immediately on startup
runTradingCycle();

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('💤 Shutting down gracefully...');
  process.exit(0);
});
