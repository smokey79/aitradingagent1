/**
 * Hermes Agent — Local Ollama validator
 * Acts as a final consensus checker using your local Hermes model.
 * Falls back gracefully if Ollama isn't running.
 */
const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL      = process.env.HERMES_MODEL || 'hermes3';

async function getSignal(symbol, marketData) {
  const price = marketData?.price;
  const prompt = `You are Hermes, a crypto trading consensus validator.
Analyze ${symbol}: price=$${price?.price?.toFixed(2)}, 24h=${price?.change24h?.toFixed(2)}%, SOPR=${marketData?.onchain?.sopr?.toFixed(3) || 'N/A'}, MVRV=${marketData?.onchain?.mvrv?.toFixed(2) || 'N/A'}
Output ONLY valid JSON, nothing else: {"signal":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reason":"brief","constraints":{}}`;

  const res = await axios.post(OLLAMA_URL, {
    model: MODEL,
    prompt,
    stream: false,
  }, { timeout: 20000 });

  const text = res.data.response.trim();
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { getSignal };
