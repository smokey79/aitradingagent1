/**
 * Market Data Aggregator
 * Pulls price, volume, on-chain, and DeFi data from all sources in parallel.
 */
const axios = require('axios');
const logger = require('../utils/logger');

const CMC_KEY     = process.env.CMC_API_KEY;
const GLASSNODE_KEY = process.env.GLASSNODE_API_KEY;
const COINGECKO_URL = process.env.COINGECKO_API_URL || 'https://api.geckoterminal.com/api/v2';

const CMC_SYMBOL_MAP = { BTC:'1', ETH:'1027', CRO:'3635', SOL:'5426', AVAX:'5805', ARB:'11841', OP:'11840' };
const CG_SYMBOL_MAP  = { BTC:'bitcoin', ETH:'ethereum', CRO:'crypto-com-chain', SOL:'solana', AVAX:'avalanche-2', ARB:'arbitrum', OP:'optimism' };

async function fetchMarketData(pair) {
  const symbol = pair.split('/')[0];
  const [price, onchain, dex] = await Promise.allSettled([
    fetchCMCPrice(symbol),
    fetchGlassnodeOnChain(symbol),
    fetchDexScreener(symbol),
  ]);

  return {
    symbol,
    pair,
    price:   price.status === 'fulfilled'   ? price.value   : null,
    onchain: onchain.status === 'fulfilled' ? onchain.value : null,
    dex:     dex.status === 'fulfilled'     ? dex.value     : null,
    timestamp: Date.now(),
  };
}

async function fetchCMCPrice(symbol) {
  if (!CMC_KEY) { logger.warn('CMC_API_KEY not set — skipping CMC price'); return null; }
  const id = CMC_SYMBOL_MAP[symbol];
  if (!id) return null;
  const res = await axios.get(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest`, {
    headers: { 'X-CMC_PRO_API_KEY': CMC_KEY },
    params: { id },
    timeout: 8000,
  });
  const data = res.data.data[id].quote.USD;
  return {
    price: data.price,
    change1h:  data.percent_change_1h,
    change24h: data.percent_change_24h,
    change7d:  data.percent_change_7d,
    volume24h: data.volume_24h,
    marketCap: data.market_cap,
  };
}

async function fetchGlassnodeOnChain(symbol) {
  if (!GLASSNODE_KEY) { logger.warn('GLASSNODE_API_KEY not set — skipping on-chain data'); return null; }
  if (!['BTC', 'ETH'].includes(symbol)) return null; // Glassnode mainly covers BTC/ETH
  try {
    const [sopr, mvrv] = await Promise.all([
      axios.get('https://api.glassnode.com/v1/metrics/indicators/sopr',
        { params: { a: symbol, api_key: GLASSNODE_KEY, i: '24h' }, timeout: 8000 }),
      axios.get('https://api.glassnode.com/v1/metrics/market/mvrv',
        { params: { a: symbol, api_key: GLASSNODE_KEY, i: '24h' }, timeout: 8000 }),
    ]);
    return {
      sopr: sopr.data?.slice(-1)[0]?.v,
      mvrv: mvrv.data?.slice(-1)[0]?.v,
    };
  } catch (e) {
    logger.warn(`Glassnode error for ${symbol}: ${e.message}`);
    return null;
  }
}

async function fetchDexScreener(symbol) {
  try {
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${symbol}USDT`, { timeout: 8000 });
    const pairs = res.data?.pairs?.slice(0, 3) || [];
    return pairs.map(p => ({
      dex: p.dexId, chain: p.chainId,
      price: p.priceUsd, volume24h: p.volume?.h24,
      priceChange24h: p.priceChange?.h24,
    }));
  } catch (e) {
    logger.warn(`DexScreener error: ${e.message}`);
    return null;
  }
}

module.exports = { fetchMarketData };
