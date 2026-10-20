/**
 * Optional shared aggregator feeds. Keys are read from the local environment.
 * No secret, request config, or raw provider error is returned to agent prompts.
 */
const axios = require('axios');

function normalizeQuote(price, updatedAt, extra, now) {
  if (!Number.isFinite(price) || price <= 0) return { status: 'invalid_data' };
  const timestamp = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 30000 || now - timestamp > 300000) {
    return { status: 'stale_or_unknown_timestamp', sourceUpdatedAt: Number.isFinite(timestamp) ? timestamp : null };
  }
  return { status: 'ok', currency: 'USD', price, sourceUpdatedAt: timestamp, ...extra };
}

function createFeedRouter({ http = axios, env = process.env, now = Date.now } = {}) {
  const cache = new Map();
  async function provider(name, request) {
    const old = cache.get(name);
    if (old && now() - old.createdAt < 60000) return old.promise;
    const createdAt = now();
    const promise = Promise.resolve().then(request).catch((error) => ({
      status: error.response && error.response.status === 429 ? 'rate_limited' : 'unavailable',
    })).then((result) => ({ ...result, retrievedAt: now() }));
    cache.set(name, { createdAt, promise });
    return promise;
  }
  async function collect(pair) {
    if (pair !== 'BTC/USDT') return { status: 'outside_baseline_universe', sources: {} };
    let [cmc, coingecko] = await Promise.all([
      provider('cmc:BTC', async () => {
        if (!env.CMC_API_KEY) return { status: 'missing_credentials' };
        const response = await http.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest', {
          headers: { 'X-CMC_PRO_API_KEY': env.CMC_API_KEY },
          params: { id: '1', convert: 'USD' }, timeout: 6000,
        });
        const quote = response.data && response.data.data && response.data.data['1'] &&
          response.data.data['1'].quote && response.data.data['1'].quote.USD;
        if (!quote) return { status: 'invalid_data' };
        return normalizeQuote(quote.price, quote.last_updated, {
          change24h: Number.isFinite(quote.percent_change_24h) ? quote.percent_change_24h : null,
          volume24h: Number.isFinite(quote.volume_24h) ? quote.volume_24h : null,
        }, now());
      }),
      provider('coingecko:BTC', async () => {
        const pro = !!env.COINGECKO_PRO_API_KEY;
        const key = pro ? env.COINGECKO_PRO_API_KEY : env.COINGECKO_API_KEY;
        if (!key) return { status: 'missing_credentials' };
        const response = await http.get((pro ? 'https://pro-api.coingecko.com' :
          'https://api.coingecko.com') + '/api/v3/simple/price', {
          headers: { [pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: key },
          params: { ids: 'bitcoin', vs_currencies: 'usd', include_24hr_vol: true,
            include_24hr_change: true, include_last_updated_at: true }, timeout: 6000,
        });
        const quote = response.data && response.data.bitcoin;
        if (!quote) return { status: 'invalid_data' };
        return normalizeQuote(quote.usd,
          Number.isFinite(quote.last_updated_at) ? quote.last_updated_at * 1000 : NaN, {
            change24h: Number.isFinite(quote.usd_24h_change) ? quote.usd_24h_change : null,
            volume24h: Number.isFinite(quote.usd_24h_vol) ? quote.usd_24h_vol : null,
          }, now());
      }),
    ]);
    const fresh = (quote) => quote.status === 'ok' && now() - quote.sourceUpdatedAt > 300000
      ? { status: 'stale_or_unknown_timestamp', sourceUpdatedAt: quote.sourceUpdatedAt,
          retrievedAt: quote.retrievedAt } : quote;
    cmc = fresh(cmc); coingecko = fresh(coingecko);
    return { schemaVersion: 1, capturedAt: now(), sources: { coinmarketcap: cmc, coingecko },
      usdDivergencePercent: cmc.status === 'ok' && coingecko.status === 'ok'
        ? Math.abs(cmc.price - coingecko.price) / ((cmc.price + coingecko.price) / 2) * 100 : null };
  }
  return { collect };
}
const router = createFeedRouter();
module.exports = { createFeedRouter, normalizeQuote, collectAgentFeeds: (pair) => router.collect(pair) };
