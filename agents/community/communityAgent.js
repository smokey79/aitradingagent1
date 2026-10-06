/**
 * communityAgent.js
 *
 * Reads public community chatter (Reddit, TradingView ideas, Trading212
 * community, any extra RSS/Atom feed you add) and turns it into one signal per
 * coin. Same output schema as the other agents:
 *   { signal, confidence, reason, constraints }
 *
 * - Every comment/post is saved to data/community/comments.jsonl (deduped) so
 *   you build your own dataset over time.
 * - Sentiment is scored by local Hermes (Ollama) with a keyword fallback.
 * - Self-learning: each source gets a weight that goes up when its sentiment
 *   preceded the right price move and down when it didn't.
 * - Fails soft: a blocked/broken feed is skipped and never stops the cycle.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../../utils/logger');

const DATA_DIR      = path.join(__dirname, '..', '..', 'data', 'community');
const COMMENTS_PATH = path.join(DATA_DIR, 'comments.jsonl');
const WEIGHTS_PATH  = path.join(DATA_DIR, 'source_weights.json');
const PENDING_PATH  = path.join(DATA_DIR, 'pending_outcomes.json');
const INBOX_PATH    = path.join(DATA_DIR, 'inbox.txt'); // paste anything here, one comment per line

const OLLAMA_URL   = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes3';
const UA           = process.env.COMMUNITY_USER_AGENT || 'AiTradingAgent/1.0 (personal research bot)';

const CACHE_MS       = 10 * 60 * 1000;      // refetch feeds at most every 10 min
const MAX_AGE_MS     = 24 * 60 * 60 * 1000; // ignore posts older than 24h
const EVAL_AFTER_MS  = 4 * 60 * 60 * 1000;  // judge a prediction after 4h
const MIN_MOVE_PCT   = 0.3;                 // price move needed to count as direction

const NAMES = {
  BTC: ['bitcoin'], ETH: ['ethereum', 'ether'], SOL: ['solana'],
  CRO: ['cronos', 'crypto.com'], XRP: ['ripple'], DOGE: ['dogecoin'], ADA: ['cardano'],
};

// ---------- feed list ----------
// COMMUNITY_FEEDS="name|url,name|url"  ({symbol} is replaced; feeds without it are fetched once and filtered)
function getFeeds() {
  const feeds = [];
  const subs = (process.env.REDDIT_SUBS || 'CryptoCurrency,CryptoMarkets,Bitcoin,ethtrader,solana').split(',').map(s => s.trim()).filter(Boolean);
  for (const sub of subs) {
    feeds.push({ name: `reddit:${sub}`, url: `https://www.reddit.com/r/${sub}/new.rss?limit=50` });
    feeds.push({ name: `reddit:${sub}:comments`, url: `https://www.reddit.com/r/${sub}/comments.rss?limit=100` });
  }
  const symbols = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,CRO/USDT,SOL/USDT').split(',').map(p => p.split('/')[0].trim());
  const extra = (process.env.COMMUNITY_FEEDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const e of extra) {
    const [name, url] = e.split('|');
    if (!name || !url) continue;
    if (url.includes('{symbol}')) {
      for (const sym of symbols) feeds.push({ name: `${name}:${sym}`, url: url.replace(/\{symbol\}/g, sym) });
    } else feeds.push({ name, url });
  }
  return feeds;
}

// ---------- tiny helpers ----------
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJson(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

function decode(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
function stripHtml(s) { return decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

// Parses both Atom (<entry>, Reddit) and RSS (<item>, most forums) feeds.
function parseFeed(xml) {
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>|<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => {
    const text = stripHtml(`${tag(b, 'title')}. ${tag(b, 'content') || tag(b, 'description') || tag(b, 'summary')}`);
    const when = Date.parse(stripHtml(tag(b, 'updated') || tag(b, 'published') || tag(b, 'pubDate'))) || Date.now();
    const id = stripHtml(tag(b, 'id') || tag(b, 'guid') || tag(b, 'link')) || text.slice(0, 80);
    return { id, text: text.slice(0, 1500), ts: when };
  }).filter(i => i.text.length > 10);
}

function mentions(text, symbol) {
  const names = NAMES[symbol] || [];
  // short tickers that are also normal words (SOL, CRO, ADA) must be uppercase or $-prefixed
  const flags = ['BTC', 'ETH', 'XRP', 'DOGE'].includes(symbol) ? 'i' : '';
  if (new RegExp(`(^|[^A-Za-z])\\$?${symbol}([^A-Za-z]|$)`, flags).test(text)) return true;
  const lower = text.toLowerCase();
  return names.some(n => lower.includes(n));
}

// ---------- sentiment scoring ----------
const BULL = ['bullish', 'breakout', 'rally', 'accumulate', 'undervalued', 'moon', 'buy the dip', 'higher high', 'support held', 'long', 'pump'];
const BEAR = ['bearish', 'breakdown', 'dump', 'crash', 'overvalued', 'sell off', 'lower low', 'rejected', 'capitulation', 'short', 'rug'];

function scoreKeyword(text) {
  const l = text.toLowerCase();
  let bull = 0, bear = 0;
  for (const w of BULL) if (l.includes(w)) bull++;
  for (const w of BEAR) if (l.includes(w)) bear++;
  const t = bull + bear;
  return t === 0 ? { score: 0, confidence: 0.1 } : { score: (bull - bear) / t, confidence: Math.min(0.5, 0.15 + t * 0.05) };
}

// One Hermes call per source per symbol (not per comment) to keep it fast on a laptop.
async function scoreBatch(texts, symbol) {
  const joined = texts.slice(0, 15).map((t, i) => `${i + 1}. ${t.slice(0, 300)}`).join('\n');
  const prompt = `You are a crypto sentiment classifier. Read these community comments about ${symbol}. ` +
    `Output ONLY JSON like {"score": -1 to 1, "confidence": 0 to 1} for overall sentiment toward ${symbol}. ` +
    `Ignore spam, giveaways and unrelated chatter.\n${joined}`;
  try {
    const res = await axios.post(OLLAMA_URL, { model: HERMES_MODEL, prompt, stream: false }, { timeout: 20000 });
    const p = JSON.parse(res.data.response.replace(/```json|```/g, '').trim());
    if (typeof p.score === 'number' && typeof p.confidence === 'number') return p;
    throw new Error('bad shape');
  } catch {
    const all = texts.map(scoreKeyword);
    const n = all.length || 1;
    return { score: all.reduce((a, x) => a + x.score, 0) / n, confidence: Math.min(0.5, all.reduce((a, x) => a + x.confidence, 0) / n) };
  }
}

// ---------- fetching + storage ----------
let cache = { at: 0, items: [] };
const warned = new Set();

async function fetchFeed(feed) {
  try {
    const res = await axios.get(feed.url, { timeout: 12000, headers: { 'User-Agent': UA, Accept: 'application/atom+xml,application/rss+xml,text/xml,*/*' }, responseType: 'text' });
    return parseFeed(String(res.data)).map(i => ({ ...i, source: feed.name }));
  } catch (err) {
    if (!warned.has(feed.name)) { warned.add(feed.name); logger.warn(`  [community] ${feed.name} unavailable: ${err.response?.status || err.message}`); }
    return [];
  }
}

function readInbox() {
  try {
    return fs.readFileSync(INBOX_PATH, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 10)
      .map(text => ({ id: `inbox:${text.slice(0, 60)}`, text, ts: Date.now(), source: 'inbox' }));
  } catch { return []; }
}

function saveNew(items) {
  ensureDir();
  const seen = new Set();
  try { fs.readFileSync(COMMENTS_PATH, 'utf8').split('\n').forEach(l => { if (l) try { seen.add(JSON.parse(l).id); } catch {} }); } catch {}
  const fresh = items.filter(i => !seen.has(i.id));
  if (fresh.length) fs.appendFileSync(COMMENTS_PATH, fresh.map(i => JSON.stringify(i)).join('\n') + '\n');
}

async function getAllItems() {
  if (Date.now() - cache.at < CACHE_MS) return cache.items;
  const lists = await Promise.all(getFeeds().map(fetchFeed));
  const items = [...lists.flat(), ...readInbox()];
  saveNew(items);
  cache = { at: Date.now(), items };
  return items;
}

// ---------- self-learning ----------
function sourceWeight(src) { const w = readJson(WEIGHTS_PATH, {}); return w[src] !== undefined ? w[src] : 0.5; }

function evaluatePending(symbol, price) {
  if (!price) return;
  const pending = readJson(PENDING_PATH, []);
  const weights = readJson(WEIGHTS_PATH, {});
  const keep = [];
  for (const p of pending) {
    if (p.symbol !== symbol || Date.now() - p.ts < EVAL_AFTER_MS) { keep.push(p); continue; }
    const move = ((price - p.price) / p.price) * 100;
    if (Math.abs(move) < MIN_MOVE_PCT) continue; // no clear move, learn nothing
    for (const [src, score] of Object.entries(p.scores)) {
      if (Math.abs(score) < 0.2) continue;
      const correct = (score > 0) === (move > 0);
      const cur = weights[src] !== undefined ? weights[src] : 0.5;
      weights[src] = cur * 0.9 + (correct ? 1 : 0) * 0.1; // EMA, same as YouTube agent
    }
  }
  writeJson(WEIGHTS_PATH, weights);
  writeJson(PENDING_PATH, keep.slice(-500));
}

// ---------- main entry ----------
async function getCommunitySignal(symbol, marketData) {
  const price = marketData?.price?.price;
  evaluatePending(symbol, price);

  const items = (await getAllItems()).filter(i => Date.now() - i.ts < MAX_AGE_MS && mentions(i.text, symbol));
  if (items.length < 3) return { signal: 'neutral', confidence: 0, reason: `only ${items.length} recent community posts mention ${symbol}`, constraints: {} };

  const bySource = {};
  for (const i of items) (bySource[i.source.split(':').slice(0, 2).join(':')] ||= []).push(i.text);

  let num = 0, den = 0;
  const scores = {};
  for (const [src, texts] of Object.entries(bySource)) {
    const { score, confidence } = await scoreBatch(texts, symbol);
    scores[src] = score;
    const w = sourceWeight(src) * confidence * Math.log2(texts.length + 1); // more posts = a bit more trust
    num += score * w; den += w;
  }
  const avg = den > 0 ? num / den : 0;

  if (price) {
    const pending = readJson(PENDING_PATH, []);
    pending.push({ symbol, ts: Date.now(), price, scores });
    writeJson(PENDING_PATH, pending);
  }

  const signal = avg > 0.15 ? 'bullish' : avg < -0.15 ? 'bearish' : 'neutral';
  // community chatter is noisy: cap confidence well below the LLM agents
  const confidence = Math.min(0.6, Math.abs(avg) * Math.min(1, items.length / 20));
  return {
    signal, confidence,
    reason: `${items.length} posts from ${Object.keys(bySource).length} sources, net sentiment ${avg.toFixed(2)}`,
    constraints: {},
  };
}

module.exports = { getCommunitySignal, _internals: { parseFeed, mentions, scoreKeyword } };
