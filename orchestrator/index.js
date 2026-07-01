/**
 * AiTradingAgent — Main Orchestrator
 * Runs the full cycle: fetch data → poll all agents → consensus → risk gate → execute
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cron = require('node-cron');
const logger = require('../utils/logger');
const { fetchMarketData } = require('../data/marketData');
const { runConsensus } = require('./consensus');
const { checkRiskGate } = require('../risk-gate/riskGate');
const { executeTradeOnBestExchange } = require('../utils/exchangeRouter');
const { allocateProfits } = require('../utils/profitAllocator');

const PAIRS = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,CRO/USDT,SOL/USDT').split(',');
const PAPER = process.env.PAPER_TRADING !== 'false';
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || '0.70');

logger.info(`🚀 AiTradingAgent starting — ${PAPER ? '📄 PAPER MODE' : '🔴 LIVE MODE'}`);
logger.info(`Trading pairs: ${PAIRS.join(', ')}`);
logger.info(`Min confidence threshold: ${(MIN_CONFIDENCE * 100).toFixed(0)}%`);

async function runTradingCycle() {
  logger.info('─── New trading cycle starting ───');
  for (const pair of PAIRS) {
    try {
      logger.info(`\n[${pair}] Fetching market data...`);
      const marketData = await fetchMarketData(pair);

      logger.info(`[${pair}] Running multi-LLM consensus...`);
      const consensus = await runConsensus(pair, marketData);
      logger.info(`[${pair}] Consensus: ${consensus.signal} @ ${(consensus.confidence * 100).toFixed(1)}% (${consensus.agentsAgreeing}/${consensus.totalAgents} agents)`);

      if (consensus.confidence < MIN_CONFIDENCE) {
        logger.info(`[${pair}] ⚠️  Confidence ${(consensus.confidence * 100).toFixed(1)}% < ${(MIN_CONFIDENCE * 100)}% threshold — skipping`);
        continue;
      }

      logger.info(`[${pair}] Running risk gate...`);
      const riskCheck = await checkRiskGate(pair, consensus, marketData);
      if (!riskCheck.approved) {
        logger.info(`[${pair}] 🛑 Risk gate rejected: ${riskCheck.reason}`);
        continue;
      }

      logger.info(`[${pair}] ✅ Risk gate approved — sizing: ${riskCheck.positionSize} USDT, leverage: ${riskCheck.leverage}x`);

      if (PAPER) {
        logger.info(`[${pair}] 📄 PAPER TRADE: ${consensus.signal.toUpperCase()} ${riskCheck.positionSize} USDT`);
      } else {
        const result = await executeTradeOnBestExchange(pair, consensus.signal, riskCheck);
        logger.info(`[${pair}] ✅ Trade executed: ${JSON.stringify(result)}`);
        await allocateProfits(result);
      }
    } catch (err) {
      logger.error(`[${pair}] ❌ Cycle error: ${err.message}`);
    }
  }
  logger.info('─── Cycle complete ───\n');
}

// Run every 15 minutes
cron.schedule('*/15 * * * *', runTradingCycle);

// Run immediately on start
runTradingCycle();
