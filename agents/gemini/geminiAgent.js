const axios = require('axios');

async function getSignal(symbol, marketData) {
  const price = marketData?.price;
  const prompt = `Crypto trading analysis for ${symbol}.
Price: $${price?.price?.toFixed(2)}, 24h: ${price?.change24h?.toFixed(2)}%, Vol: $${(price?.volume24h/1e6)?.toFixed(1)}M
Respond ONLY with JSON: {"signal":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reason":"one sentence","constraints":{}}`;

  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] },
    { headers: { 'Content-Type': 'application/json' }, timeout: 12000 }
  );

  const text = res.data.candidates[0].content.parts[0].text.trim();
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { getSignal };
