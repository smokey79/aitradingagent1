const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot } = require('../data/sharedSnapshot');
const { hardFilter } = require('../risk-gate/hardFilter');
const { renderSnapshot } = require('../data/agentSnapshotPrompt');
const { rollingCorrelation } = require('../agents/prediction/crossAssetCorrelation');
const { evaluateAblation } = require('../research/socialAblation');

function fixture() {
  const close = Math.floor(Date.now() / 900000) * 900000;
  const now = close + 5000;
  const bars = Array.from({ length: 425 }, (_, i) =>
    [close - (425 - i) * 900000, 100, 101, 99, 100, 100]);
  return { now, bars, loaded: { bars, intervalMs: 900000, source: 'ccxt', exchange: 'bitget' },
    book: { bids: [[99.99, 100]], asks: [[100.01, 100]], timestamp: now } };
}

test('one fetch per source; snapshot is immutable and independent of input rows', async () => {
  const f = fixture();
  let historyCalls = 0, bookCalls = 0;
  const snapshot = await buildSnapshot('BTC/USDT', {
    now: () => f.now,
    loadCandles: async () => { historyCalls++; return f.loaded; },
    fetchBook: async () => { bookCalls++; return f.book; },
  });
  assert.equal(historyCalls, 1);
  assert.equal(bookCalls, 1);
  assert.ok(Object.isFrozen(snapshot.candles.bars[0]));
  f.bars[0][4] = 10;
  assert.equal(snapshot.candles.bars[0][4], 100);
  assert.equal(hardFilter(snapshot, f.now).approved, true);
});

test('filter fails closed for wide spread, stale book and candle gaps', async () => {
  const f = fixture();
  const snapshot = await buildSnapshot('BTC/USDT', {
    now: () => f.now, loadCandles: async () => f.loaded, fetchBook: async () => f.book,
  });
  const wide = JSON.parse(JSON.stringify(snapshot));
  wide.book.spreadBps = 30;
  assert.ok(hardFilter(wide, f.now).reasons.includes('spread_above_15bps'));
  const stale = JSON.parse(JSON.stringify(snapshot));
  stale.book.timestamp = f.now - 31000;
  assert.ok(hardFilter(stale, f.now).reasons.includes('stale_orderbook'));
  const gap = JSON.parse(JSON.stringify(snapshot));
  gap.candles.bars[400][0] -= 900000;
  assert.ok(hardFilter(gap, f.now).reasons.includes('history_gap'));
});

test('all price agents receive one compact prompt without social enrichment', () => {
  const facts = { snapshotId: 'abc', asOf: 1000, features: { rsi14: 55 } };
  assert.equal(renderSnapshot('BTC', facts), renderSnapshot('BTC', { ...facts, social: 'ignored' }));
  assert.ok(renderSnapshot('BTC', facts).includes('abc'));
});

test('constant asset returns produce null correlation, not a crash or false zero', () => {
  const bars = Array.from({ length: 50 }, (_, i) => [i * 900000, 100, 101, 99, 100, 1]);
  const asset = bars.map((r) => ({ ts: r[0], close: 100 }));
  assert.equal(rollingCorrelation(bars, asset, 900000).windows[48].correlation, null);
});

test('social ablation rejects leaked, duplicated or uncosted observations', () => {
  const row = { snapshotId: 'x', fold: '1', split: 'oos', costsIncluded: true,
    priceOnlyNetR: 0.1, withSocialNetR: 0.2, socialKnownAtMs: 1,
    decisionAtMs: 2, outcomeResolvedAtMs: 3 };
  assert.throws(() => evaluateAblation([{ ...row, socialKnownAtMs: 4 }]));
  assert.throws(() => evaluateAblation([row, row]));
  assert.throws(() => evaluateAblation([{ ...row, costsIncluded: false }]));
  assert.equal(evaluateAblation([row]).promotionAllowed, false);
  assert.equal(evaluateAblation([row]).status, 'insufficient_evidence');
});

test('paired OOS descriptive lift is computed without promotion', () => {
  const rows = Array.from({ length: 102 }, (_, i) => ({
    snapshotId: 's' + i, fold: String(i % 3), split: 'oos', costsIncluded: true,
    priceOnlyNetR: 0.1, withSocialNetR: 0.2, socialKnownAtMs: i * 10,
    decisionAtMs: i * 10 + 1, outcomeResolvedAtMs: i * 10 + 2,
  }));
  const result = evaluateAblation(rows);
  assert.equal(result.status, 'descriptive_oos_report');
  assert.ok(Math.abs(result.meanPairedLiftR - 0.1) < 1e-9);
  assert.equal(result.promotionAllowed, false);
});
