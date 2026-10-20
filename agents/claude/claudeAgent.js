const { renderSnapshot } = require('../../data/agentSnapshotPrompt');
const axios = require('axios');

async function getSignal(symbol, marketData) {
  const prompt = renderSnapshot(symbol, marketData);

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
