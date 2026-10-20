# Project bookmark — 20 October 2026

Checkpoint: low-cost Freqtrade-first research configuration.
Branch: codex/next-candle-predictor.
This file is the durable project bookmark requested in chat.

## Implemented in this checkpoint

- One Freqtrade dry-run execution core: BTC/USDT, 250-USDT simulated wallet, one position capped at 25 USDT.
- Default Node reviews use one existing local Ollama model in sequential bull/bear roles. No cloud or social model calls in this default path.
- Review reservations persist to the ignored research directory: four sessions per UTC day, at least six hours between sessions; a failed review consumes its reservation. An unreadable budget or concurrent lock rejects the review.
- Ollama calls request two CPU threads, a 2048-token context and 180 generated tokens per role; the existing configured model is retained. A smaller model must be selected only after measuring actual laptop RAM. No model is downloaded automatically.
- DL4J calls now require DL4J_ENABLED=true. The Java integration remains available as an experimental challenger.
- The statistical predictor trains once per UTC day per Node process, reusing the model for subsequent candles. Restarting the process rebuilds this in-memory cache; this is not a persistent trained artifact or an accuracy improvement.
- CoinGecko is the primary aggregator, with CoinMarketCap fallback. Requests are cached for one hour, including missing-key/failure statuses. Cached quotes still become stale after five minutes and are excluded from fresh-price reasoning. FEED_CROSSCHECK_ENABLED=true deliberately requests both providers. Local price/book data remains the real-time reference.
- Freqtrade entry confirmation includes closed-trade net-loss gates: -2.50 USDT per UTC day and -7.50 USDT per UTC calendar week, measured against the fixed 250-USDT allocation. This stops new entries; it does not include open unrealised losses or force-close positions. Existing stops/exits remain necessary.
- A separate LowCostFreqAI LightGBM profile uses two training threads, 180 training days, 30-day sliding backtests and a 24-hour retrain interval. It is not selected by config.json or the execution Compose file.
- research-jobs.json describes a 365-day history download, baseline bias checks and development comparisons, with a final holdout reserved. Jobs are not automatically run.

## Current limitations and next concrete steps

The laptop was offline at the last connection check. No F:/E: inspection, PM2 cleanup, installation, real API authentication, data download, model training, Telegram delivery, fill/restart verification or deployment has been completed. The code branch is not the running laptop installation.

1. Reconnect Desktop Commander and identify the current project/process before stopping old agents or removing their PM2 entries. Preserve account state and the current DB.
2. Verify installed Freqtrade/FreqAI/CCXT versions and the Python strategy imports.
3. Run history collection and inspect actual coverage. Downloading 365 days is a request, not a guarantee the venue provides them.
4. Run the baseline lookahead/recursive checks and restart/fill tests.
5. Run chronological price-only versus LightGBM comparisons with identical opportunity windows and fees, plus stressed spread/slippage. The classifier's 8-bar close-return hurdle is only a research target; it does not model fills, intrabar barriers or calibrated trade-win probabilities.
6. Review train/test boundary leakage explicitly. Internal chronological FreqAI validation is diagnostic; purged walk-forward and an untouched holdout are still required. An eight-bar training buffer does not itself prove all train/test boundaries are purged.
7. Collect at least 100 resolved paper outcomes across multiple market conditions. This is an initial evidence floor, not proof of edge.
8. Promote nothing automatically. Research ML and AI output still does not authorize orders.

## Reference

config/lowCostPolicy.json records the chosen policy.
freqtrade/user_data/config.json is the selected execution baseline.
freqtrade/user_data/config.freqai-research.json is an optional separate experiment.
Official FreqAI parameters: https://www.freqtrade.io/en/stable/freqai-parameter-table/
Official trade ledger API: https://www.freqtrade.io/en/stable/trade-object/
