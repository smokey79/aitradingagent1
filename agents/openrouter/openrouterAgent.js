/**
 * OpenRouter Agent — Free Model Rotation
 * Cycles through free-tier models to avoid API costs while maintaining signal quality.
 * Optimized for 16GB RAM / Radeon 5000 (offloads computation to cloud).
 */
const axios = require('axios');
const logger = require('../../utils/logger');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;

// Free-tier models (guaranteed $0 with credits)
const MODELS = [
  'mistralai/mistral-7b-instruct:free',
  'nousresearch/hermes-2-mistral-7b-dpo:free',
  'meta-llama/llama-2-7b-chat:free',
];

let modelIndex = 0;
let lastCall = 0;
const RATE_LIMIT_MS = 150; // ~6-7 requests/sec (safe for free tier)

async function getSignal(symbol, marketData) {
  // Rate limiting to respect OpenRouter free-tier quotas
  const now = Date.now();
  if (now - lastCall < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - (now - lastCall)));
  }
  lastCall = Date.now();

  // Rotate models for load balancing
  const model = MODELS[modelIndex % MODELS.length];
  modelIndex++;

  const price = marketData?.price;
  const prompt = `You are a professional crypto trading analyst. Analyze ${symbol} signal.

Market Data:
- Price: $${price?.price?.toFixed(2)}
- 24h Change: ${price?.change24h?.toFixed(2)}%
- Volume: $${(price?.volume24h / 1e6)?.toFixed(1)}M
- SOPR: ${marketData?.onchain?.sopr?.toFixed(3) || 'N/A'}
- MVRV: ${marketData?.onchain?.mvrv?.toFixed(2) || 'N/A'}

Respond with ONLY valid JSON (no markdown, no explanation):
{"signal":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reason":"one sentence"}`;

  try {
    const response = await axios.post(
      OPENROUTER_URL,
      {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.3, // Deterministic for consistent signals
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'HTTP-Referer': 'https://aitradingagent.local',
          'X-Title': 'AI Trading Agent',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const text = response.data.choices[0].message.content.trim();
    const signal = JSON.parse(text.replace(/```json|```/g, '').trim());

    logger.info(`  [openrouter] ${symbol}: ${signal.signal} @ ${(signal.confidence * 100).toFixed(0)}% (${model.split('/')[1].split(':')[0]})`);

    return signal;
  } catch (err) {
    logger.warn(`  [openrouter] ❌ ${err.message}`);
    throw err;
  }
}

module.exports = { getSignal };
