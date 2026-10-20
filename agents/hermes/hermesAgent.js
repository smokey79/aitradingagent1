const { renderSnapshot } = require('../../data/agentSnapshotPrompt');
/**
 * Hermes Agent — Local Ollama validator
 * Acts as a final consensus checker using your local Hermes model.
 * Falls back gracefully if Ollama isn't running.
 */
const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL      = process.env.HERMES_MODEL || 'hermes3';

async function getSignal(symbol, marketData) {
  const prompt = renderSnapshot(symbol, marketData);

  const res = await axios.post(OLLAMA_URL, {
    model: MODEL,
    prompt,
    stream: false,
    keep_alive: '2m',
    options: { num_ctx: 2048, num_predict: 180, num_thread: 2 },
  }, { timeout: 20000 });

  const text = res.data.response.trim();
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { getSignal };
