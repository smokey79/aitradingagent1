const axios = require('axios');

async function getSignal(symbol, marketData) {
  const price = marketData?.price;
  const prompt = `You are a crypto trading analyst. Analyze ${symbol}.
Price: $${price?.price?.toFixed(2)}, 24h: ${price?.change24h?.toFixed(2)}%, Vol: $${(price?.volume24h/1e6)?.toFixed(1)}M
Return ONLY JSON: {"signal":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reason":"brief reason","constraints":{}}`;

  const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150,
  }, {
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 12000,
  });

  const text = res.data.choices[0].message.content.trim();
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { getSignal };
