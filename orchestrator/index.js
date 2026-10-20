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
const { runPredictionGraph } = require('../agents/langgraph/predictionGraph');

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
      logger.info(`\\n[${pair}] Fetching market data...`);
      const marketData = await fetchMarketData(pair);

      // LangGraph research workflow. Its guard prevents the forecast entering order decisions.
      try {
        const forecast = await runPredictionGraph(pair);
        if (forecast.status === 'shadow_only') {
          const holdout = forecast.holdout || {};
          logger.info('[' + pair + '] LangGraph next-candle shadow forecast: ' + forecast.direction +
            ' P(up)=' + forecast.probabilityUp + ' P(down)=' + forecast.probabilityDown +
            ' target=' + forecast.predictsFor + ' OOS balanced accuracy=' + holdout.balancedAccuracy +
            ' Brier=' + holdout.brier + ' vs baseline=' + holdout.baseRateBrier);
          const assets = forecast.crossAssetCorrelation && forecast.crossAssetCorrelation.assets;
          if (assets) {
            for (const [asset, correlation] of Object.entries(assets)) {
              const windows = correlation.windows || {};
              logger.info('[' + pair + '] BTC/' + asset + ' correlation 48=' +
                (windows[48] ? windows[48].correlation : null) + ' 96=' +
                (windows[96] ? windows[96].correlation : null) + ' samples=' +
                (correlation.returnPairs || 0));
            }
          }
          const learned = forecast.paperLearning || {};
          logger.info('[' + pair + '] Paper-learning: regime=' + forecast.regime +
            ' status=' + learned.status + ' recommendation=' + (learned.strategy || 'none'));
        } else {
          logger.info('[' + pair + '] Next-candle forecast status: ' + forecast.status +
            ' source=' + (forecast.source || 'none') + ' candles=' + (forecast.candles || 0));
        }
      } catch (forecastError) {
        logger.warn('[' + pair + '] LangGraph predictor unavailable: ' + forecastError.message);
      }

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
  logger.info('─── Cycle complete ───\\n');
}

// Run every 15 minutes
cron.schedule('*/15 * * * *', runTradingCycle);

// Run immediately on start
runTradingCycle();
