/**
 * youtubeSentimentAgent.js
 *
 * Pulls recent videos from your YouTube subscriptions, scores crypto
 * sentiment per coin (using local Hermes via Ollama if available, else a
 * keyword fallback), and self-learns by tracking which channels' sentiment
 * actually predicted price direction -- upweighting reliable channels and
 * downweighting noisy ones over time.
 *
 * Output schema matches your existing agents: { signal, confidence, reason, constraints }
 *
 * SETUP: see SETUP_INSTRUCTIONS.md before running this file.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
const axios = require('axios');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, 'data');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CLIENT_SECRET_PATH = path.join(__dirname, '..', '..', 'client_secret.json'); // project root
const MEMORY_PATH = path.join(DATA_DIR, 'sentiment_memory.json');
const WEIGHTS_PATH = path.join(DATA_DIR, 'channel_weights.json');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes3';

// ---------- small JSON-file helpers (no DB needed for this scale) ----------
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ---------- auth ----------
function getOAuthClient() {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(
      `Missing client_secret.json at ${CLIENT_SECRET_PATH}. Follow SETUP_INSTRUCTIONS.md step 1.`
    );
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `Missing token.json. Run "node agents/sentiment/setup-youtube-auth.js" once first.`
    );
  }
  const { installed } = readJson(CLIENT_SECRET_PATH, {});
  const oAuth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret, installed.redirect_uris[0]);
  oAuth2Client.setCredentials(readJson(TOKEN_PATH, {}));
  return oAuth2Client;
}

function getYoutubeClient() {
  return google.youtube({ version: 'v3', auth: getOAuthClient() });
}

// ---------- fetching ----------
async function fetchMySubscriptions(maxResults = 50) {
  const youtube = getYoutubeClient();
  const res = await youtube.subscriptions.list({
    part: 'snippet',
    mine: true,
    maxResults,
  });
  return (res.data.items || []).map((item) => ({
    channelId: item.snippet.resourceId.channelId,
    channelTitle: item.snippet.title,
  }));
}

async function fetchRecentVideos(channelId, maxResults = 5) {
  const youtube = getYoutubeClient();
  const res = await youtube.search.list({
    part: 'snippet',
    channelId,
    order: 'date',
    type: 'video',
    maxResults,
  });
  return (res.data.items || []).map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
  }));
}

async function fetchTranscriptText(videoId) {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    return segments.map((s) => s.text).join(' ').slice(0, 6000); // cap length
  } catch {
    return null; // captions disabled/unavailable -- caller falls back to title+description
  }
}

// ---------- sentiment scoring ----------
const BULLISH_WORDS = ['bullish', 'breakout', 'rally', 'accumulate', 'undervalued', 'moon', 'buy the dip', 'higher high', 'support held'];
const BEARISH_WORDS = ['bearish', 'breakdown', 'dump', 'crash', 'overvalued', 'sell off', 'lower low', 'resistance rejected', 'capitulation'];

function scoreSentimentKeyword(text) {
  const lower = text.toLowerCase();
  let bull = 0, bear = 0;
  for (const w of BULLISH_WORDS) if (lower.includes(w)) bull++;
  for (const w of BEARISH_WORDS) if (lower.includes(w)) bear++;
  const total = bull + bear;
  if (total === 0) return { score: 0, confidence: 0.2 }; // -1..1 scale, low confidence
  const score = (bull - bear) / total;
  return { score, confidence: Math.min(0.5, 0.2 + total * 0.05) };
}

async function scoreSentimentHermes(text, symbol) {
  const prompt = `You are a crypto sentiment classifier. Given this YouTube video text about crypto markets, ` +
    `output ONLY a JSON object (no markdown, no prose) like {"score": -1 to 1, "confidence": 0 to 1} ` +
    `representing sentiment specifically toward ${symbol}. Text: """${text.slice(0, 3000)}"""`;
  try {
    const res = await axios.post(OLLAMA_URL, { model: HERMES_MODEL, prompt, stream: false }, { timeout: 20000 });
    const parsed = JSON.parse(res.data.response.trim());
    if (typeof parsed.score === 'number' && typeof parsed.confidence === 'number') return parsed;
    throw new Error('bad shape');
  } catch {
    return scoreSentimentKeyword(text); // Ollama down or bad output -> fallback
  }
}

// ---------- self-learning weights ----------
function getChannelWeight(channelId) {
  const weights = readJson(WEIGHTS_PATH, {});
  return weights[channelId] !== undefined ? weights[channelId] : 0.5; // neutral prior
}

function updateChannelWeight(channelId, wasCorrect) {
  const weights = readJson(WEIGHTS_PATH, {});
  const current = weights[channelId] !== undefined ? weights[channelId] : 0.5;
  // exponential moving average toward 1 (correct) or 0 (wrong); alpha=0.1 keeps it stable
  const updated = current * 0.9 + (wasCorrect ? 1 : 0) * 0.1;
  weights[channelId] = updated;
  writeJson(WEIGHTS_PATH, weights);
  return updated;
}

// ---------- core signal aggregation ----------
async function aggregateSentiment(symbol, lookbackHours = 24, videosPerChannel = 3) {
  const subs = await fetchMySubscriptions();
  const cutoff = Date.now() - lookbackHours * 3600 * 1000;
  const samples = [];

  for (const sub of subs) {
    let videos;
    try {
      videos = await fetchRecentVideos(sub.channelId, videosPerChannel);
    } catch {
      continue; // skip channel on API error, don't kill the whole run
    }
    for (const v of videos) {
      if (new Date(v.publishedAt).getTime() < cutoff) continue;
      const haystack = `${v.title} ${v.description}`.toLowerCase();
      if (!haystack.includes(symbol.toLowerCase())) continue; // only relevant mentions

      const transcript = await fetchTranscriptText(v.videoId);
      const text = transcript || `${v.title}. ${v.description}`;
      const { score, confidence } = await scoreSentimentHermes(text, symbol);
      const weight = getChannelWeight(sub.channelId);

      samples.push({ channelId: sub.channelId, videoId: v.videoId, score, confidence, weight, publishedAt: v.publishedAt });
    }
  }

  return samples;
}

async function getSentimentSignal(symbol) {
  const samples = await aggregateSentiment(symbol);
  if (samples.length === 0) {
    return { signal: 'neutral', confidence: 0, reason: `No subscription mentions of ${symbol} in lookback window`, constraints: {} };
  }

  let weightedSum = 0, weightSum = 0;
  for (const s of samples) {
    const w = s.confidence * s.weight;
    weightedSum += s.score * w;
    weightSum += w;
  }
  const avgScore = weightSum > 0 ? weightedSum / weightSum : 0;
  const confidence = Math.min(1, weightSum / samples.length); // averaged effective confidence

  const signal = avgScore > 0.15 ? 'bullish' : avgScore < -0.15 ? 'bearish' : 'neutral';

  // log for self-learning evaluation later
  ensureDataDir();
  const memory = readJson(MEMORY_PATH, []);
  memory.push({ symbol, signal, score: avgScore, confidence, samples: samples.map(({ channelId, videoId }) => ({ channelId, videoId })), timestamp: Date.now(), evaluated: false });
  writeJson(MEMORY_PATH, memory);

  return {
    signal,
    confidence,
    reason: `${samples.length} subscription video(s) mentioning ${symbol}, weighted sentiment ${avgScore.toFixed(2)}`,
    constraints: {},
  };
}

// ---------- self-learning evaluation loop ----------
// Call this periodically (e.g. every hour via PM2 cron or your orchestrator's tick)
// passing a function that returns a price for a symbol at a given timestamp.
async function evaluateAndLearn(getPriceAt, evaluationDelayHours = 4) {
  const memory = readJson(MEMORY_PATH, []);
  const now = Date.now();
  let updated = 0;

  for (const entry of memory) {
    if (entry.evaluated) continue;
    const ageHours = (now - entry.timestamp) / 3600000;
    if (ageHours < evaluationDelayHours) continue;

    const priceThen = await getPriceAt(entry.symbol, entry.timestamp);
    const priceNow = await getPriceAt(entry.symbol, now);
    if (priceThen == null || priceNow == null) continue;

    const actualDirection = priceNow > priceThen ? 'bullish' : priceNow < priceThen ? 'bearish' : 'neutral';
    const wasCorrect = entry.signal !== 'neutral' && entry.signal === actualDirection;

    for (const s of entry.samples) {
      updateChannelWeight(s.channelId, wasCorrect);
    }
    entry.evaluated = true;
    entry.actualDirection = actualDirection;
    updated++;
  }

  writeJson(MEMORY_PATH, memory);
  return { evaluatedCount: updated };
}

module.exports = {
  fetchMySubscriptions,
  getSentimentSignal,
  evaluateAndLearn,
  getChannelWeight, // exposed so you can inspect which channels your system trusts
};
