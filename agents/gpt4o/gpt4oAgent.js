const { renderSnapshot } = require('../../data/agentSnapshotPrompt');
const axios = require('axios');

async function getSignal(symbol, marketData) {
  const prompt = renderSnapshot(symbol, marketData);

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
