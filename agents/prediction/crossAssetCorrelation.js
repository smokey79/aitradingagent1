/**
 * Timestamp-matched rolling correlations for BTC and local gold/FX chart exports.
 * Inputs are read-only CSVs. This reports association, not causation.
 */
const fs = require('fs');
const path = require('path');

function parseTimestamp(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

function parseChartCsv(filePath, intervalMs, now = Date.now()) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map((s) => s.trim().toLowerCase());
  const col = (...names) => headers.findIndex((name) => names.includes(name));
  const ti = col('timestamp', 'time', 'open_time', 'opentime', 'date');
  const oi = col('open', 'o'), hi = col('high', 'h'), li = col('low', 'l');
  const ci = col('close', 'c');
  if ([ti, oi, hi, li, ci].some((i) => i < 0)) return [];
  const out = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    const ts = parseTimestamp(cells[ti]);
    const open = Number(cells[oi]), high = Number(cells[hi]);
    const low = Number(cells[li]), close = Number(cells[ci]);
    if (!Number.isFinite(ts) || !(open > 0) || !(close > 0) ||
        !(high >= Math.max(open, close)) || !(low <= Math.min(open, close)) ||
        ts + intervalMs > now) continue;
    out.set(ts, { ts, close });
  }
  return Array.from(out.values()).sort((a, b) => a.ts - b.ts);
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
}

function rollingCorrelation(btcBars, assetBars, intervalMs, windows = [48, 96]) {
  const assetByTime = new Map(assetBars.map((bar) => [bar.ts, bar.close]));
  const joined = btcBars
    .filter((bar) => assetByTime.has(Number(bar[0])))
    .map((bar) => ({ ts: Number(bar[0]), btc: Number(bar[4]), asset: assetByTime.get(Number(bar[0])) }))
    .sort((a, b) => a.ts - b.ts);
  const paired = [];
  for (let i = 1; i < joined.length; i++) {
    if (joined[i].ts - joined[i - 1].ts !== intervalMs) continue;
    paired.push({
      ts: joined[i].ts,
      btc: Math.log(joined[i].btc / joined[i - 1].btc),
      asset: Math.log(joined[i].asset / joined[i - 1].asset),
    });
  }
  const result = { matchedBars: joined.length, returnPairs: paired.length, windows: {} };
  for (const window of windows) {
    const sample = paired.slice(-window);
    result.windows[window] = {
      samples: sample.length,
      correlation: sample.length >= Math.min(30, window)
        ? Number(pearson(sample.map((p) => p.btc), sample.map((p) => p.asset)).toFixed(4))
        : null,
    };
  }
  return result;
}

function getCrossAssetCorrelation(btcBars, intervalMs) {
  const directory = process.env.CROSS_ASSET_DATA_DIR || '';
  const symbols = (process.env.CORRELATION_SYMBOLS || 'XAUUSD,EURUSD,GBPUSD,USDJPY,AUDUSD')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!directory) return { status: 'not_configured', source: 'local_csv', assets: {} };
  const assets = {};
  for (const symbol of symbols) {
    const filePath = path.join(directory, symbol + '.csv');
    const bars = parseChartCsv(filePath, intervalMs);
    assets[symbol] = bars.length
      ? rollingCorrelation(btcBars, bars, intervalMs)
      : { status: 'missing_csv', file: symbol + '.csv', matchedBars: 0, returnPairs: 0, windows: {} };
  }
  return { status: 'available', source: 'timestamp_aligned_local_csv', assets };
}

module.exports = { parseChartCsv, pearson, rollingCorrelation, getCrossAssetCorrelation };
