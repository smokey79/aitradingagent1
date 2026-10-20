/** Identical compact price/book facts for all price-only advisory agents. */
function renderSnapshot(symbol, data) {
  const facts = {
    symbol, snapshotId: data.snapshotId, featureVersion: data.featureVersion,
    asOf: data.asOf, observedAt: data.observedAt, features: data.features,
    quote: data.executionReference,
    book: data.orderbook && {
      spreadBps: data.orderbook.spreadBps,
      bidDepthUsdt: data.orderbook.bidDepthUsdt, askDepthUsdt: data.orderbook.askDepthUsdt,
    },
  };
  return 'Analyze only this price/order-book snapshot. No social/news assumptions. ' +
    'This is advisory research; confidence is your subjective score, not win probability.\n' +
    JSON.stringify(facts) +
    '\nReturn only JSON: {"signal":"bullish|bearish|neutral","confidence":0.0,"reason":"brief","constraints":{}}';
}
module.exports = { renderSnapshot };
