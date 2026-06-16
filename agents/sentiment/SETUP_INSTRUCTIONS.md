# Hermes Sentiment Agent — Setup Guide

This adds a new agent to your AiTradingAgent project that reads your YouTube
subscriptions, scores crypto sentiment per coin, and self-learns over time by
tracking which channels' sentiment actually predicted price direction.

## 0. VS Code extensions (one-time)

Open VS Code → click the square icon on the far left sidebar (Extensions) →
search and install:
- **ESLint** (publisher: Microsoft) — flags JS errors as you type
- **DotENV** (publisher: mikestead) — makes your `.env` file readable

You don't need anything else for this — VS Code has Node.js/JavaScript
support built in.

## 1. Google Cloud setup (gets you YouTube API access)

1. Go to console.cloud.google.com → create a new project (any name).
2. Left menu → **APIs & Services → Library** → search "YouTube Data API v3" → **Enable**.
3. Left menu → **APIs & Services → Credentials** → **+ Create Credentials → OAuth client ID**.
4. If asked, configure the consent screen first: select **External**, fill in
   an app name, your email, save. You don't need to publish it.
5. Application type: **Desktop app**. Name it anything. Click **Create**.
6. Click **Download JSON** on the credential you just created.
7. Rename the downloaded file to `client_secret.json` and move it into your
   project root: `C:\Users\AlanJ\projects\AiTradingagent\client_secret.json`

## 2. Place the files

In VS Code: **File → Open Folder** → select
`C:\Users\AlanJ\projects\AiTradingagent`.

In the Explorer sidebar (left side), right-click your project name → **New
Folder** → name it `agents` (skip if it already exists) → right-click
`agents` → **New Folder** → name it `sentiment`.

Move the two downloaded files into that `agents/sentiment` folder:
- `youtubeSentimentAgent.js`
- `setup-youtube-auth.js`

## 3. Install dependencies

**Terminal → New Terminal** (top menu of VS Code). In the terminal that opens
at the bottom, run:

```
npm install googleapis youtube-transcript axios dotenv
```

## 4. Authorize your YouTube account (one time only)

In the same terminal:

```
node agents/sentiment/setup-youtube-auth.js
```

It prints a URL — open it in your browser, sign in, click **Allow**, copy
the code shown, paste it back into the terminal, press Enter. This creates
`token.json` inside `agents/sentiment/` and you won't need to repeat this
step.

## 5. Test it

```
node -e "require('./agents/sentiment/youtubeSentimentAgent').getSentimentSignal('BTC').then(console.log)"
```

This should print something like:
```
{ signal: 'neutral', confidence: 0, reason: 'No subscription mentions of BTC in lookback window', constraints: {} }
```
That's normal if none of your subscriptions mentioned BTC in the last 24
hours — try a coin that's currently being discussed, or widen
`lookbackHours` in `aggregateSentiment()`.

## 6. Optional: local Hermes scoring instead of keyword fallback

If Ollama is running locally with your Hermes model (matching how
`hermesAgent.js` already calls it), this agent will automatically use it for
sentiment scoring instead of the basic keyword fallback — no extra setup
needed beyond Ollama already being up. If your model name differs from
`hermes3`, add this line to your `.env`:

```
HERMES_MODEL=your-model-name-here
```

## 7. Wire it into your orchestrator

Wherever your orchestrator currently collects agent signals (e.g. alongside
where `hermesAgent.js` is called), add:

```js
const sentimentAgent = require('./agents/sentiment/youtubeSentimentAgent');
const sentimentSignal = await sentimentAgent.getSentimentSignal(symbol);
// fold sentimentSignal into your existing consensus array, same shape
// as your other agents: { signal, confidence, reason, constraints }
```

And on a periodic tick (e.g. once an hour, via PM2 cron or your existing
scheduler), call the self-learning evaluator, passing it your existing price
feed function:

```js
const { evaluateAndLearn } = require('./agents/sentiment/youtubeSentimentAgent');
await evaluateAndLearn(yourExistingPriceLookupFunction);
```

This is what causes the agent to actually learn: every 4+ hours, it checks
whether each channel's past sentiment calls matched what price did
afterward, and nudges that channel's trust weight up or down accordingly.
Channels that are consistently right gain influence; noisy ones get
filtered out automatically over time.

## Notes / limits

- YouTube's `subscriptions.list` and `search.list` API calls are
  quota-limited (10,000 units/day free tier; each `search.list` call costs
  100 units) — with many subscriptions, the agent will burn quota fast if
  you call it too often. Consider caching subscription video lists for ~1
  hour rather than re-fetching every call.
- Some channels disable captions, so the agent falls back to title +
  description text for those — lower-quality signal, but still functional.
- `data/sentiment_memory.json` and `data/channel_weights.json` are created
  automatically the first time you run the agent — back these up
  periodically since they hold your learned channel trust scores.
