const axios = require('axios');

async function getSignal(symbol, marketData) {
  const price = marketData?.price;
  const prompt = `You are a professional crypto trading analyst. Analyze ${symbol} and return ONLY valid JSON.
Market data: price=$${price?.price?.toFixed(2)}, 24h change=${price?.change24h?.toFixed(2)}%, volume=$${(price?.volume24h/1e6)?.toFixed(1)}M
On-chain: SOPR=${marketData?.onchain?.sopr?.toFixed(3) || 'N/A'}, MVRV=${marketData?.onchain?.mvrv?.toFixed(2) || 'N/A'}

Return exactly: {"signal":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reason":"one sentence","constraints":{}}`;

  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  }, {
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    timeout: 12000,
  });

  const text = res.data.content[0].text.trim();
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { getSignal };
