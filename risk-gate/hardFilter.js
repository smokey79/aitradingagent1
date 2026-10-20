/** Cheap fail-closed research filter. It is not a profitability model. */
function hardFilter(snapshot, now = Date.now()) {
  const reasons = [];
  const bars = snapshot.candles && snapshot.candles.bars || [];
  if (snapshot.pair !== 'BTC/USDT' || snapshot.timeframe !== '15m') reasons.push('outside_baseline_universe');
  if (bars.length < 425) reasons.push('insufficient_history');
  if (!Number.isFinite(snapshot.candleClose) || snapshot.candleClose > now ||
      now - snapshot.candleClose > 120000) reasons.push('stale_or_open_candle');
  if (!Number.isFinite(snapshot.observedAt) || snapshot.observedAt > now ||
      now - snapshot.observedAt > 30000) reasons.push('stale_snapshot');
  const recent = bars.slice(-100);
  for (let i = 0; i < recent.length; i++) {
    const b = recent[i];
    if (b.length < 6 || !b.every(Number.isFinite) || b[1] <= 0 || b[4] <= 0 ||
        b[2] < Math.max(b[1], b[4]) || b[3] > Math.min(b[1], b[4]) ||
        b[3] <= 0 || b[5] < 0) {
      reasons.push('invalid_candle'); break;
    }
    if (i && b[0] - recent[i - 1][0] !== snapshot.intervalMs) {
      reasons.push('history_gap'); break;
    }
  }
  const book = snapshot.book;
  if (!book) reasons.push('missing_orderbook');
  else {
    if (![book.bid, book.ask, book.spreadBps, book.bidDepthUsdt, book.askDepthUsdt,
      book.timestamp].every(Number.isFinite)) reasons.push('invalid_orderbook');
    if (book.bid <= 0 || book.ask < book.bid || book.spreadBps > 15) reasons.push('spread_above_15bps');
    if (Math.min(book.bidDepthUsdt, book.askDepthUsdt) < 2500) reasons.push('depth_below_2500usdt');
    if (book.timestamp > now + 1000 || now - book.timestamp > 30000) reasons.push('stale_orderbook');
  }
  return { approved: reasons.length === 0, reasons, policyVersion: 'prefilter-v1' };
}
module.exports = { hardFilter };
