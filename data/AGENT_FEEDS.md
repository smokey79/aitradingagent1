# Shared agent feeds (v2)

This extends the earlier price-only research configuration. The Freqtrade price-only execution baseline remains its own experiment; Node agent reports are now labelled market_context_agents_v2 and must not be mixed with earlier price-only agent scores.

| Feed | Wiring | Runtime requirement |
| --- | --- | --- |
| Bitget via CCXT | Existing 15-minute closed candles, book spread/depth, RSI/EMA/volume features; reused by predictor and agents | Installed runtime with network access; public history/book do not use private account keys |
| CoinMarketCap | BTC USD quote, 24-hour change and volume | Local CMC_API_KEY |
| CoinGecko Demo | BTC USD quote, 24-hour change, volume, source update timestamp | Local COINGECKO_API_KEY |
| CoinGecko Pro | Same fields using the Pro host/header | Local COINGECKO_PRO_API_KEY; takes precedence over Demo |
| Gold and FX | Existing separate CSV correlation research module | Real chart export directory; no placeholder path or provider credentials were installed |
| YouTube/social | Existing optional ablation path | SOCIAL_ABLATION_ENABLED=true plus that agent's existing setup; off by default |
| Telegram | Freqtrade notifications/control | Existing local bot token/chat ID setup; disabled until configured |
| Hugging Face | No inference feed added | HF token storage remains blocked by the offline laptop; do not reuse the token pasted in chat |

The shared aggregator router runs only after the hard price/book filter. Concurrent collectors share one provider promise; success, missing credentials and failures are cached for 60 seconds per process. Quotes require a positive numeric price and source timestamp no more than five minutes old. Each result retains sourceUpdatedAt and retrievedAt. Timeouts are six seconds; there are no immediate retry loops. Statuses are ok, missing_credentials, rate_limited, unavailable, invalid_data or stale_or_unknown_timestamp. Provider errors are reduced to status codes, not raw errors or request headers.

Both aggregator quotes are USD, so their USD divergence can be reported. Bitget's reference remains USDT and is not silently treated as USD. All four agents receive the identical compact feed context. A new content hash archives the final enriched snapshot and references its parent price snapshot. Agent agreement remains subjective research output.

Keys are read from the machine's existing private environment. No secrets, master .env, local drive paths or trading credentials were written. The old data/marketData.js is a legacy optional module; the new research scheduler uses data/agentFeeds.js and does not also call the legacy aggregator.

Validation here: JavaScript syntax and five synthetic behavioral checks passed for concurrent cache reuse, provider mapping, missing credentials, stale timestamp rejection and sanitized rate-limit failures. Live API authentication, the installed CCXT version and laptop services have not been tested. Nothing was launched.
