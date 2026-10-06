# OpenRouter + Hermes Agent — Quick Start (No VS Code Needed)

**Goal:** Run self-learning trading bot with zero API costs. Setup time: ~10 minutes.

## What You Get

✅ **Free model rotation** (OpenRouter)  
✅ **Local validator** (Hermes via Ollama)  
✅ **Your hardware** (Radeon 5000, 16GB RAM)  
✅ **Zero monthly costs** ($0 — free tier only)  
✅ **Self-healing** (graceful fallbacks if any agent fails)

---

## Step 1: Get OpenRouter API Key (2 minutes)

1. Go to: https://openrouter.ai
2. Click "Sign up" → use email: `barclay0611@gmail.com`
3. In dashboard, go to API Keys → Create new key
4. Copy the key (starts with `sk-or-`)
5. Save it safely (you'll use it in .env)

---

## Step 2: Install Ollama + Hermes (3 minutes)

**On Windows/Mac:**
1. Download: https://ollama.ai
2. Install and launch
3. Open terminal/command prompt, run:
   ```bash
   ollama pull hermes3
   ```
   (Wait ~5 min for download, ~8GB)

**Verify it's working:**
```bash
ollama list
# Should show: hermes3
```

---

## Step 3: Setup Your Config (3 minutes)

**Do NOT edit files in VS Code. Use any text editor (Notepad++, TextEdit, etc).**

1. Open: `/home/user/aitradingagent1/.env.openrouter.example`
2. Copy all content
3. Create new file: `/home/user/aitradingagent1/.env`
4. Paste content into .env
5. Find this line:
   ```
   OPENROUTER_API_KEY=sk-or-xxxxx
   ```
6. Replace `sk-or-xxxxx` with your actual key from Step 1

**Example:**
```
OPENROUTER_API_KEY=sk-or-abc123def456ghi789
PAPER_TRADING=true
```

7. Save and close

---

## Step 4: Install Dependencies (2 minutes)

**Open terminal in this folder:**
```bash
cd /home/user/aitradingagent1
npm install
```

(Already done if you've run the project before.)

---

## Step 5: Run in Paper Mode First! (required) (2 minutes)

**ALWAYS test with paper trading before live!**

```bash
cd /home/user/aitradingagent1
PAPER_TRADING=true npm start
```

You should see:
```
🚀 AiTradingAgent (OpenRouter Optimized) starting
   Mode: 📄 PAPER TRADING
   Trading pairs: BTC/USDT,ETH/USDT,CRO/USDT,SOL/USDT
   Min confidence: 70%
   Agents: OpenRouter (free) + Hermes (local) + YouTube Sentiment
   Cost: $0/month

─── New trading cycle starting ───

[BTC/USDT] Fetching market data...
[BTC/USDT] Price: $42,500.00 (2.50% in 24h)
[BTC/USDT] Running consensus...
  Polling agents for BTC...
  [openrouter] BTC: bullish @ 75%
  [hermes] BTC: bullish @ 82%
  [sentiment] BTC: neutral @ 65%
[BTC/USDT] Consensus: BULLISH @ 79.3% (3/3 agents)
[BTC/USDT] Running risk gate...
[BTC/USDT] ✅ Risk gate approved — Position: $75.00 @ 1x leverage
[BTC/USDT] 📄 PAPER TRADE: BULLISH $75.00 USDT at 1x
```

**If you see this, you're ready!** Stop the bot with `Ctrl+C`.

---

## Step 6: Run Live (When Ready)

**⚠️ Only after you've tested paper mode and understand the signals.**

Edit `.env`:
```
PAPER_TRADING=false
```

Then run:
```bash
npm start
```

Bot will execute real trades on your exchange (Bitget/Crypto.com).

---

## Troubleshooting

### "Cannot find module axios"
```bash
npm install
```

### "Ollama connection refused"
Make sure Ollama is running:
```bash
ollama serve
```
(Leave this terminal open.)

### "OpenRouter API key invalid"
Double-check your key in `.env`:
- No spaces before/after
- Starts with `sk-or-`
- From https://openrouter.ai dashboard

### "No market data available"
Your exchange API is down. Check:
```bash
curl https://api.binance.com/api/v3/ping
```

### Bot runs but no trades executed
Check MIN_CONFIDENCE in .env. If agents don't agree strongly enough, trades are skipped (that's the risk gate working).

---

## Files You Created

```
/home/user/aitradingagent1/
├── .env                          ← YOUR CONFIG (created from example)
├── agents/
│   └── openrouter/
│       └── openrouterAgent.js   ← NEW: Free model rotation
├── orchestrator/
│   ├── consensus-openrouter.js  ← NEW: Updated consensus
│   └── index-openrouter.js      ← NEW: Updated main loop
├── .env.openrouter.example       ← Reference (don't edit)
└── OPENROUTER_QUICK_START.md     ← This file
```

---

## Daily Operations

**Every day:**
1. Make sure Ollama is running: `ollama serve`
2. Start bot: `npm start` (or `PAPER_TRADING=true npm start` to test first)
3. Monitor logs for trades
4. Check profits (if live)

**Once a month:**
- Review trades and PnL
- Adjust MIN_CONFIDENCE if too many skipped trades
- Check OpenRouter usage (dashboard: https://openrouter.ai)

---

## Cost Breakdown

| Component | Cost | Notes |
|-----------|------|-------|
| OpenRouter free | $0 | $5-10/month credits included |
| Hermes (local) | $0 | Runs on your Radeon 5000 |
| YouTube API | $0 | Free tier (100 req/day) |
| Your electricity | ~$5/month | GPU idle most of time |
| **TOTAL** | **$5/month** | If Ollama on 24/7 |

Much cheaper than paying for Claude/GPT-4 APIs!

---

## Next Steps

1. **Design System Artifact:** https://claude.ai/artifact/LKQgGDSZyVSX9sHhsuRmLx
   - Learn architecture patterns
   - See how consensus works
   - Understand risk gate rules

2. **Optimize for Your Market:**
   - Edit TRADING_PAIRS in .env
   - Tune MIN_CONFIDENCE (start at 0.70)
   - Adjust LEVERAGE_MAX (start at 1x, move to 2-3x after seeing profits)

3. **Monitor in Production:**
   - Logs show every decision
   - Set PAPER_TRADING=true to test changes
   - Only flip to false when confident

---

## Support

If stuck:
- Check `.env` has your OpenRouter key
- Verify Ollama running: `ollama list` shows `hermes3`
- Read error logs carefully (they tell you what's wrong)
- Adjust timeouts if agents timing out

**You've got this!** Start with paper trading, understand the signals, then go live. 🚀
