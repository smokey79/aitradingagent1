/**
 * Exchange Router
 * Compares fees/spread on Bitget and Crypto.com, executes on the cheaper one.
 * Uses ccxt for unified API access.
 */
const ccxt = require('ccxt');
const logger = require('./logger');

// Lazy-init exchanges so missing keys don't crash on startup
let _bitget, _cryptocom;

function getBitget() {
  if (!_bitget) {
    _bitget = new ccxt.bitget({
      apiKey:     process.env.BITGET_API_KEY,
      secret:     process.env.BITGET_API_SECRET,
      password:   process.env.BITGET_API_PASSPHRASE,
      options:    { defaultType: 'spot' },
    });
  }
  return _bitget;
}

function getCryptoCom() {
  if (!_cryptocom) {
    _cryptocom = new ccxt.cryptocom({
      apiKey: process.env.CRYPTOCOM_API_KEY,
      secret: process.env.CRYPTOCOM_API_SECRET,
    });
  }
  return _cryptocom;
}

async function getExchangeFee(exchange, symbol) {
  try {
    const markets = await exchange.loadMarkets();
    const market  = markets[symbol];
    return market?.taker || 0.001;
  } catch {
    return 0.001; // default 0.1%
  }
}

async function getBestExchange(pair) {
  const [bitgetFee, cryptocomFee] = await Promise.allSettled([
    getExchangeFee(getBitget(), pair),
    getExchangeFee(getCryptoCom(), pair),
  ]);

  const bg = bitgetFee.status   === 'fulfilled' ? bitgetFee.value   : 999;
  const cc = cryptocomFee.status === 'fulfilled' ? cryptocomFee.value : 999;

  logger.info(`  Fees — Bitget: ${(bg*100).toFixed(3)}%, Crypto.com: ${(cc*100).toFixed(3)}%`);
  return bg <= cc ? { exchange: getBitget(), name: 'Bitget' } : { exchange: getCryptoCom(), name: 'Crypto.com' };
}

async function executeTradeOnBestExchange(pair, signal, riskCheck) {
  const { exchange, name } = await getBestExchange(pair);
  const side = signal === 'bullish' ? 'buy' : 'sell';

  logger.info(`  Executing ${side.toUpperCase()} ${riskCheck.positionSize} USDT on ${name}`);

  const ticker = await exchange.fetchTicker(pair);
  const amount = riskCheck.positionSize / ticker.last;

  const order = await exchange.createOrder(pair, 'market', side, amount);

  logger.info(`  Order filled: ${JSON.stringify({ id: order.id, price: order.price, amount: order.amount })}`);
  return { exchange: name, order, pair, side, positionSize: riskCheck.positionSize };
}

module.exports = { executeTradeOnBestExchange, getBestExchange };
