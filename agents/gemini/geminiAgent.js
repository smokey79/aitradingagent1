const { renderSnapshot } = require('../../data/agentSnapshotPrompt');
const axios = require('axios');

async function getSignal(symbol, marketData) {
  const prompt = renderSnapshot(symbol, marketData);

  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] },
    { headers: { 'Content-Type': 'application/json' }, timeout: 12000 }
  );

  const text = res.data.candidates[0].content.parts[0].text.trim();
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { getSignal };
