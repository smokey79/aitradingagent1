/**
 * Next-candle direction forecaster (shadow mode only).
 * Trains a small regularized logistic model on closed OHLCV bars. It forecasts
 * whether the next bar closes above the last completed bar; it never places orders.
 */
const fs = require('fs');
const ccxt = require('ccxt');
const { getCrossAssetCorrelation } = require('./crossAssetCorrelation');
const { recommendPaperStrategy } = require('./contextualBandit');

const EPS = 1e-12;
const FEATURE_COUNT = 12;
let exchangeInstance = null;

function timeframeMs(value) {
  const match = /^(\d+)(m|h|d)$/.exec(value);
  if (!match) throw new Error('Unsupported prediction timeframe: ' + value);
  const amount = Number(match[1]);
  const unitMs = { m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return amount * unitMs;
}

function normalizePair(pair) {
  const cleaned = String(pair).trim().replace('-', '/');
  return cleaned.includes('/') ? cleaned : cleaned.replace(/(USDT|USDC|BTC|ETH)$/, '/$1');
}

function parseTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function validBar(bar) {
  return Array.isArray(bar) && bar.length >= 6 &&
    bar.slice(0, 6).every((v) => Number.isFinite(Number(v))) &&
    Number(bar[1]) > 0 && Number(bar[2]) >= Math.max(Number(bar[1]), Number(bar[4])) &&
    Number(bar[3]) <= Math.min(Number(bar[1]), Number(bar[4])) &&
    Number(bar[4]) > 0 && Number(bar[5]) >= 0;
}

function csvBars(filePath, pair, intervalMs, now) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((v) => v.trim().toLowerCase());
  const col = (...names) => headers.findIndex((name) => names.includes(name));
  const timeCol = col('timestamp', 'time', 'open_time', 'opentime', 'date');
  const openCol = col('open', 'o');
  const highCol = col('high', 'h');
  const lowCol = col('low', 'l');
  const closeCol = col('close', 'c');
  const volumeCol = col('volume', 'vol', 'v');
  const symbolCol = col('symbol', 'pair', 'ticker');
  if ([timeCol, openCol, highCol, lowCol, closeCol, volumeCol].some((i) => i < 0)) return [];

  const wanted = normalizePair(pair).replace('/', '').toUpperCase();
  const output = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    if (symbolCol >= 0 && cells[symbolCol]) {
      const rowSymbol = normalizePair(cells[symbolCol]).replace('/', '').toUpperCase();
      if (rowSymbol !== wanted) continue;
    }
    const ts = parseTimestamp(cells[timeCol]);
    const bar = [ts, Number(cells[openCol]), Number(cells[highCol]),
      Number(cells[lowCol]), Number(cells[closeCol]), Number(cells[volumeCol])];
    if (validBar(bar) && ts + intervalMs <= now) output.push(bar);
  }
  return output;
}

function getExchange() {
  if (exchangeInstance) return exchangeInstance;
  const id = (process.env.PREDICTION_EXCHANGE || 'bitget').toLowerCase();
  if (!ccxt[id]) throw new Error('CCXT exchange is not available: ' + id);
  exchangeInstance = new ccxt[id]({ enableRateLimit: true, timeout: 12000 });
  return exchangeInstance;
}

async function loadCandles(pair, timeframe, limit) {
  const intervalMs = timeframeMs(timeframe);
  const now = Date.now();
  const localPath = process.env.LOCAL_CANDLE_HISTORY_CSV || '';
  const local = csvBars(localPath, pair, intervalMs, now);
  let exchangeBars = [];
  let exchangeError = null;
  try {
    const exchange = getExchange();
    if (!exchange.markets) await exchange.loadMarkets();
    const symbol = normalizePair(pair);
    if (!exchange.markets[symbol]) throw new Error('Pair is not listed on ' + exchange.id + ': ' + symbol);
    const raw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    exchangeBars = raw
      .filter((bar) => validBar(bar) && Number(bar[0]) + intervalMs <= now)
      .map((bar) => bar.map(Number));
  } catch (error) {
    exchangeError = error.message;
  }

  const unique = new Map();
  for (const bar of local.concat(exchangeBars)) unique.set(Number(bar[0]), bar);
  const bars = Array.from(unique.values()).sort((a, b) => a[0] - b[0]).slice(-limit);
  return {
    bars,
    source: exchangeBars.length && local.length ? 'ccxt+local_csv'
      : exchangeBars.length ? 'ccxt' : local.length ? 'local_csv' : 'none',
    exchange: (process.env.PREDICTION_EXCHANGE || 'bitget').toLowerCase(),
    exchangeError,
    intervalMs,
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function emaAt(values, end, period) {
  const start = Math.max(0, end - period * 4);
  const alpha = 2 / (period + 1);
  let result = values[start];
  for (let i = start + 1; i <= end; i++) result = alpha * values[i] + (1 - alpha) * result;
  return result;
}

function rsiAt(closes, end, period) {
  let gains = 0;
  let losses = 0;
  const start = Math.max(1, end - period + 1);
  for (let i = start; i <= end; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const count = Math.max(1, end - start + 1);
  const avgGain = gains / count;
  const avgLoss = losses / count;
  if (avgLoss < EPS) return 1;
  return 1 - (1 / (1 + avgGain / avgLoss));
}

function featureAt(bars, index) {
  if (index < 24) return null;
  const closes = bars.map((bar) => bar[4]);
  const current = bars[index];
  const close = current[4];
  const returns = [];
  for (let i = index - 24; i < index; i++) {
    if (closes[i] > 0 && closes[i + 1] > 0) returns.push(Math.log(closes[i + 1] / closes[i]));
  }
  const volumes = bars.slice(index - 19, index + 1).map((bar) => bar[5]);
  const avgVolume = mean(volumes);
  const candleRange = Math.max(current[2] - current[3], EPS);
  const emaFast = emaAt(closes, index, 8);
  const emaSlow = emaAt(closes, index, 21);
  return [
    Math.log(close / closes[index - 1]),
    Math.log(close / closes[index - 3]),
    Math.log(close / closes[index - 6]),
    Math.log(close / closes[index - 12]),
    Math.log(close / closes[index - 24]),
    (current[4] - current[1]) / current[1],
    (current[2] - current[3]) / close,
    (2 * current[4] - current[2] - current[3]) / candleRange,
    Math.log((current[5] + EPS) / (avgVolume + EPS)),
    (emaFast - emaSlow) / close,
    (rsiAt(closes, index, 14) - 0.5) * 2,
    std(returns.slice(-6)) / (std(returns) + EPS),
  ];
}

function deriveRegime(bars) {
  const closes = bars.map((bar) => bar[4]);
  const returns = [];
  for (let i = Math.max(1, closes.length - 97); i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const recent = returns.slice(-24);
  const longer = returns.slice(-96);
  const drift = closes.length >= 7 ? Math.log(closes[closes.length - 1] / closes[closes.length - 7]) : 0;
  const recentVol = std(recent);
  const longVol = std(longer);
  const threshold = Math.max(0.001, recentVol * 0.35);
  const trend = drift > threshold ? 'up' : drift < -threshold ? 'down' : 'flat';
  const volatility = longVol > 0 && recentVol > longVol * 1.15 ? 'highvol' : 'lowvol';
  return trend + '_' + volatility;
}

function makeExamples(bars) {
  const examples = [];
  for (let i = 24; i < bars.length - 1; i++) {
    const x = featureAt(bars, i);
    if (x && x.length === FEATURE_COUNT && x.every(Number.isFinite)) {
      examples.push({ x, y: bars[i + 1][4] > bars[i][4] ? 1 : 0 });
    }
  }
  return examples;
}

function scalerFor(rows) {
  const dimensions = rows[0].length;
  const means = Array(dimensions).fill(0);
  const scales = Array(dimensions).fill(1);
  for (let j = 0; j < dimensions; j++) {
    means[j] = mean(rows.map((row) => row[j]));
    const deviation = std(rows.map((row) => row[j]));
    scales[j] = deviation > EPS ? deviation : 1;
  }
  return {
    transform: (row) => row.map((value, j) => (value - means[j]) / scales[j]),
  };
}

function sigmoid(z) {
  if (z >= 0) return 1 / (1 + Math.exp(-Math.min(z, 35)));
  const exp = Math.exp(Math.max(z, -35));
  return exp / (1 + exp);
}

function trainLogistic(samples, scaler) {
  const x = samples.map((row) => scaler.transform(row.x));
  const y = samples.map((row) => row.y);
  const weights = Array(FEATURE_COUNT + 1).fill(0);
  const prior = Math.min(0.99, Math.max(0.01, mean(y)));
  weights[weights.length - 1] = Math.log(prior / (1 - prior));
  const rate = 0.04;
  const regularization = 0.02;

  for (let epoch = 0; epoch < 350; epoch++) {
    const gradient = Array(weights.length).fill(0);
    for (let i = 0; i < x.length; i++) {
      let z = weights[weights.length - 1];
      for (let j = 0; j < x[i].length; j++) z += weights[j] * x[i][j];
      const error = sigmoid(z) - y[i];
      for (let j = 0; j < x[i].length; j++) gradient[j] += error * x[i][j];
      gradient[gradient.length - 1] += error;
    }
    for (let j = 0; j < weights.length - 1; j++) {
      weights[j] -= rate * (gradient[j] / x.length + regularization * weights[j]);
    }
    weights[weights.length - 1] -= rate * gradient[gradient.length - 1] / x.length;
  }

  return (features) => {
    const row = scaler.transform(features);
    let z = weights[weights.length - 1];
    for (let j = 0; j < row.length; j++) z += weights[j] * row[j];
    return sigmoid(z);
  };
}

function evaluate(train, test) {
  const scaler = scalerFor(train.map((row) => row.x));
  const predict = trainLogistic(train, scaler);
  const prior = mean(train.map((row) => row.y));
  let brier = 0;
  let baselineBrier = 0;
  let correct = 0;
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const sample of test) {
    const p = predict(sample.x);
    const predicted = p >= 0.5 ? 1 : 0;
    brier += (p - sample.y) ** 2;
    baselineBrier += (prior - sample.y) ** 2;
    if (predicted === sample.y) correct++;
    if (predicted && sample.y) tp++;
    else if (predicted && !sample.y) fp++;
    else if (!predicted && !sample.y) tn++;
    else fn++;
  }
  const sensitivity = tp + fn ? tp / (tp + fn) : 0;
  const specificity = tn + fp ? tn / (tn + fp) : 0;
  return {
    samples: test.length,
    accuracy: correct / test.length,
    balancedAccuracy: (sensitivity + specificity) / 2,
    brier: brier / test.length,
    baseRateBrier: baselineBrier / test.length,
  };
}

async function predictNextCandle(pair) {
  const timeframe = process.env.PREDICTION_TIMEFRAME || '15m';
  const limit = Math.max(300, Math.min(1000, parseInt(process.env.PREDICTION_CANDLE_LIMIT || '1000', 10)));
  const minExamples = Math.max(250, parseInt(process.env.PREDICTION_MIN_EXAMPLES || '400', 10));
  const loaded = await loadCandles(pair, timeframe, limit);
  const bars = loaded.bars;
  if (bars.length < 100) {
    return { status: 'insufficient_history', pair, timeframe, candles: bars.length, source: loaded.source, exchangeError: loaded.exchangeError };
  }

  const lastBar = bars[bars.length - 1];
  const forecastTime = lastBar[0] + loaded.intervalMs;
  const staleAfterMs = loaded.intervalMs * 1.5;
  if (Date.now() - forecastTime > staleAfterMs) {
    return { status: 'stale_data', pair, timeframe, candles: bars.length, source: loaded.source, exchangeError: loaded.exchangeError };
  }

  const examples = makeExamples(bars);
  if (examples.length < minExamples) {
    return { status: 'warming_up', pair, timeframe, candles: bars.length, examples: examples.length, requiredExamples: minExamples, source: loaded.source };
  }

  const split = Math.floor(examples.length * 0.75);
  const train = examples.slice(0, split);
  const test = examples.slice(split);
  const holdout = evaluate(train, test);

  const fullScaler = scalerFor(examples.map((row) => row.x));
  const predict = trainLogistic(examples, fullScaler);
  const probabilityUp = predict(featureAt(bars, bars.length - 1));
  const validationPassed = holdout.samples >= 100 &&
    holdout.brier < holdout.baseRateBrier && holdout.balancedAccuracy > 0.5;
  const regime = deriveRegime(bars);
  const correlation = getCrossAssetCorrelation(bars, loaded.intervalMs);
  const paperLearning = recommendPaperStrategy(regime);

  return {
    status: 'shadow_only',
    pair,
    timeframe,
    source: loaded.source,
    exchange: loaded.exchange,
    candles: bars.length,
    examples: examples.length,
    asOf: new Date(lastBar[0] + loaded.intervalMs - 1).toISOString(),
    predictsFor: new Date(forecastTime).toISOString(),
    direction: probabilityUp >= 0.5 ? 'up' : 'down',
    probabilityUp: Number(probabilityUp.toFixed(4)),
    probabilityDown: Number((1 - probabilityUp).toFixed(4)),
    regime,
    crossAssetCorrelation: correlation,
    paperLearning,
    holdout: {
      samples: holdout.samples,
      accuracy: Number(holdout.accuracy.toFixed(4)),
      balancedAccuracy: Number(holdout.balancedAccuracy.toFixed(4)),
      brier: Number(holdout.brier.toFixed(4)),
      baseRateBrier: Number(holdout.baseRateBrier.toFixed(4)),
      beatsSimpleBaseRate: validationPassed,
    },
    exchangeError: loaded.exchangeError,
    note: 'Forecast, correlations, and paper strategy ranking are advisory only. Holdout results are one recent time block and do not establish future profitability.',
  };
}

module.exports = { predictNextCandle, loadCandles, makeExamples, featureAt, deriveRegime };
