/** Layer 3: local DL4J challenger inference; no training or execution. */
const axios = require('axios');
const { featureAt } = require('./nextCandlePredictor');
const FEATURE_VERSION = 'dl4j-ohlcv12-v1';
const FEATURE_NAMES = ['log_return_1','log_return_3','log_return_6','log_return_12',
  'log_return_24','candle_body_ratio','range_ratio','close_location','log_volume_ratio20',
  'ema8_21_gap_ratio','rsi14_scaled','volatility6_24_ratio'];

async function predictDl4j(pair, snapshot, options = {}) {
  const env = options.env || process.env;
  if (env.DL4J_ENABLED === 'false') return { status: 'disabled', executionAllowed: false };
  const now = options.now ? options.now() : Date.now();
  const bars = snapshot && snapshot.candles && snapshot.candles.bars;
  if (pair !== 'BTC/USDT' || !snapshot || snapshot.timeframe !== '15m' ||
      !bars || bars.length < 25 || !Number.isFinite(snapshot.candleClose) ||
      snapshot.candleClose > now || now - snapshot.candleClose > 120000) {
    return { status: 'invalid_snapshot', executionAllowed: false };
  }
  const features = featureAt(bars, bars.length - 1);
  if (!features || features.length !== 12 || !features.every(Number.isFinite))
    return { status: 'invalid_features', executionAllowed: false };
  const request = { schemaVersion: 1, featureVersion: FEATURE_VERSION, pair, timeframe: '15m',
    snapshotId: snapshot.id, asOfMs: snapshot.candleClose, features };
  try {
    const response = await (options.http || axios).post('http://127.0.0.1:8766/predict',
      request, { timeout: 2000, maxContentLength: 16384 });
    const data = response.data;
    if (!data || data.status !== 'shadow_only' || data.snapshotId !== request.snapshotId ||
        data.featureVersion !== FEATURE_VERSION || data.asOfMs !== request.asOfMs ||
        !Number.isFinite(data.scoreUp) || data.scoreUp < 0 || data.scoreUp > 1 ||
        !Number.isFinite(data.trainedThroughMs) || data.trainedThroughMs <= 0 || data.trainedThroughMs >= request.asOfMs ||
        typeof data.modelId !== 'string' || !data.modelId ||
        !/^[a-f0-9]{64}$/.test(data.modelSha256 || '')) {
      return { status: 'invalid_response', executionAllowed: false };
    }
    return { status: 'shadow_only', provider: 'dl4j', modelId: data.modelId,
      modelSha256: data.modelSha256, featureVersion: FEATURE_VERSION,
      inputSnapshotId: snapshot.id, asOfMs: request.asOfMs, trainedThroughMs: data.trainedThroughMs,
      scoreUp: data.scoreUp, scoreDown: 1 - data.scoreUp,
      executionAllowed: false, note: 'Model scores are not calibrated trade-win probabilities.' };
  } catch (error) {
    return { status: error.response && error.response.status === 503 ? 'model_not_ready' : 'unavailable',
      executionAllowed: false };
  }
}
module.exports = { predictDl4j, FEATURE_VERSION, FEATURE_NAMES };
