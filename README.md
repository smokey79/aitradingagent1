# AiTradingAgent 🤖

Enterprise-grade multi-LLM crypto trading engine — UK compliant (Bitget + Crypto.com).

## Project Structure
```
├── orchestrator/       ← Main engine (runs every 15 min)
├── agents/claude,gpt4o,gemini,hermes,sentiment/
├── risk-gate/          ← Safety checks — 70% confidence minimum
├── data/               ← CMC, Glassnode, DexScreener feeds
├── utils/exchangeRouter, profitAllocator, logger
├── dashboard/          ← Live web dashboard
├── .env                ← YOUR KEYS — never goes to GitHub
└── ecosystem.config.js ← PM2 process manager
```

## Quick Start (copy-paste into PowerShell)
```
cd C:\Users\AlanJ\projects\AiTradingagent
npm install
npm run paper
```

## Profit Split
- 40% reinvested | 50% → BTC savings | 10% → long-term hold
- Auto-triggers at 2x initial deposit

## Still needed in .env
- BITGET_API_PASSPHRASE — Bitget website → avatar → API Management
- ANTHROPIC_API_KEY — console.anthropic.com → API Keys
- GLASSNODE_API_KEY — studio.glassnode.com → Account → API (optional)

## Community sentiment (Reddit / TradingView / Trading212)
`agents/community/communityAgent.js` is the 6th consensus agent (12% weight).
- Reddit works with no key (public RSS). Change subreddits with `REDDIT_SUBS` in `.env`.
- Add TradingView / Trading212 / any RSS feed with `COMMUNITY_FEEDS` (see `.env.example`).
- Paste any comment text (one per line) into `data/community/inbox.txt` and it is scored too.
- Everything collected is saved to `data/community/comments.jsonl`; per-source trust is learned in `source_weights.json`.
