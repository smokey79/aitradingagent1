/**
 * Research scheduler. Freqtrade is the sole execution engine.
 * No exchange orders, simulated fills, balance tracking, or transfers in this process.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cron = require('node-cron');
const logger = require('../utils/logger');
const { buildSnapshot, freeze, attachFeeds, attachAnalysis } = require('../data/sharedSnapshot');
const { collectAgentFeeds } = require('../data/agentFeeds');
const { hardFilter } = require('../risk-gate/hardFilter');
const { runConsensus } = require('./consensus');
const { runPredictionGraph } = require('../agents/langgraph/predictionGraph');
const { saveSnapshot, logDecision } = require('../utils/researchJournal');

const PAIRS = ['BTC/USDT'];
let running = false;

async function runTradingCycle() {
  if (running) return; // Prevent overlapping API calls from the same process.
  running = true;
  try {
    for (const pair of PAIRS) {
      let snapshot;
      try {
        snapshot = await buildSnapshot(pair);
        saveSnapshot(snapshot);
        const filter = hardFilter(snapshot);
        if (!filter.approved) {
          logDecision({ snapshotId: snapshot.id, pair, status: 'rejected_before_ai', ...filter });
          logger.info('[' + pair + '] Rejected before AI: ' + filter.reasons.join(', '));
          continue;
        }
        // Shared optional feeds are fetched once after rejection checks.
        snapshot = attachFeeds(snapshot, await collectAgentFeeds(pair));
        saveSnapshot(snapshot);
        const forecast = await runPredictionGraph(pair, snapshot);
        snapshot = attachAnalysis(snapshot, forecast);
        saveSnapshot(snapshot);
        const marketData = freeze({
          pair, snapshotId: snapshot.id, features: snapshot.features, feeds: snapshot.feeds,
          mlPredictions: snapshot.analysis,
          featureVersion: snapshot.featureVersion, observedAt: snapshot.observedAt,
          asOf: snapshot.candleClose, ohlcv: snapshot.candles.bars, orderbook: snapshot.book,
          // Do not relabel a USDT quote as a USD aggregator quote.
          executionReference: { price: snapshot.book.mid, currency: 'USDT', source: 'bitget_orderbook' },
        });
        const consensus = await runConsensus(pair, marketData);
        logDecision({
          snapshotId: snapshot.id, pair, status: 'advisory_only',
          featureVersion: snapshot.featureVersion, forecast, consensus,
          executionAllowed: false,
        });
        logger.info('[' + pair + '] Advisory snapshot ' + snapshot.id +
          ' forecast=' + forecast.status + ' consensus=' + consensus.signal);
      } catch (error) {
        logDecision({ pair, snapshotId: snapshot && snapshot.id, status: 'research_error', error: error.message });
        logger.warn('[' + pair + '] Research unavailable: ' + error.message);
      }
    }
  } finally { running = false; }
}

// Five seconds after each UTC candle boundary, allowing the last bar to close.
if (require.main === module) {
  cron.schedule('5 */15 * * * *', runTradingCycle, { timezone: 'UTC' });
  runTradingCycle();
}
module.exports = { runTradingCycle };
