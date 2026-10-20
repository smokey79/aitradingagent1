/**
 * One immutable research snapshot per pair/candle. All Node agents share this payload.
 * Freqtrade maintains its own internal execution feed and trade database.
 */
const crypto = require('crypto');
const { loadCandles, getExchange, featureAt, deriveRegime } = require('../agents/prediction/nextCandlePredictor');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

function bookFeatures(book, receivedAt) {
  const bids = (book.bids || []).filter((r) => r[0] > 0 && r[1] > 0);
  const asks = (book.asks || []).filter((r) => r[0] > 0 && r[1] > 0);
  if (!bids.length || !asks.length) return null;
  const bid = bids[0][0], ask = asks[0][0], mid = (bid + ask) / 2;
  return {
    bid, ask, mid, spreadBps: (ask - bid) / mid * 10000,
    bidDepthUsdt: bids.filter((r) => r[0] >= mid * 0.998).reduce((n, r) => n + r[0] * r[1], 0),
    askDepthUsdt: asks.filter((r) => r[0] <= mid * 1.002).reduce((n, r) => n + r[0] * r[1], 0),
    timestamp: book.timestamp || receivedAt,
    receivedAt,
    timestampSource: book.timestamp ? 'exchange' : 'receipt',
  };
}

async function buildSnapshot(pair, options = {}) {
  const timeframe = '15m'; // Fixed baseline shared with the checked-in Freqtrade profile.
  const limit = 1000;
  const loader = options.loadCandles || loadCandles;
  const fetchBook = options.fetchBook || ((symbol) => getExchange().fetchOrderBook(symbol, 50));
  const now = options.now || Date.now;
  const results = await Promise.allSettled([loader(pair, timeframe, limit), fetchBook(pair)]);
  const loaded = results[0].status === 'fulfilled' ? results[0].value
    : { bars: [], intervalMs: 900000, source: 'none', exchangeError: 'history_unavailable' };
  const observedAt = now();
  const bars = loaded.bars.map((row) => row.slice());
  const last = bars[bars.length - 1];
  const vector = bars.length >= 25 ? featureAt(bars, bars.length - 1) : null;
  const features = vector ? {
    lastClosedClose: last[4], logReturn1: vector[0], logReturn6: vector[2],
    logReturn24: vector[4], candleRangeRatio: vector[6], volumeRatio20: Math.exp(vector[8]),
    emaGapRatio: vector[9], rsi14: (vector[10] + 1) * 50,
    volatilityRatio: vector[11], regime: deriveRegime(bars),
  } : null;
  const payload = {
    schemaVersion: 1, featureVersion: 'price-book-v1', pair, timeframe, features,
    observedAt, candleOpen: last ? last[0] : null,
    candleClose: last ? last[0] + loaded.intervalMs : null,
    intervalMs: loaded.intervalMs,
    source: loaded.source, exchange: loaded.exchange || 'bitget',
    candles: { ...loaded, bars },
    book: results[1].status === 'fulfilled' ? bookFeatures(results[1].value, observedAt) : null,
  };
  const id = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return freeze({ ...payload, id });
}

function attachFeeds(snapshot, feeds) {
  const payload = { ...snapshot, parentSnapshotId: snapshot.id,
    featureVersion: 'price-book-aggregators-v2', feeds };
  delete payload.id;
  const id = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return freeze({ ...payload, id });
}
module.exports = { buildSnapshot, bookFeatures, freeze, attachFeeds };
