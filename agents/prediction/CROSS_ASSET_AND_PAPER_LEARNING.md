# Cross-asset and paper-learning checks

## BTC vs gold and FX correlations

Export completed charts from TradingView as CSV, one chart per file, and put them in a local directory. Use the same timeframe and UTC timestamps as the BTC feed. The correlation checker aligns exact candle-open timestamps and compares log returns; it needs consecutive common bars. It reports 48- and 96-return rolling Pearson correlations for XAUUSD, EURUSD, GBPUSD, USDJPY, and AUDUSD by default. Missing assets or insufficient overlap are reported without a number.

Set these in the machine's uncommitted `.env`:

```dotenv
CROSS_ASSET_DATA_DIR=F:/your-folder/correlation
CORRELATION_SYMBOLS=XAUUSD,EURUSD,GBPUSD,USDJPY,AUDUSD
PAPER_RL_OUTCOMES_PATH=F:/your-folder/paper_outcomes.jsonl
PAPER_RL_MIN_OUTCOMES=20
```

Each chart export should be named, for example, `XAUUSD.csv`, and include timestamp/time plus OHLC columns. The BTC series comes from the predictor's existing closed-bar CCXT data. A separate market session, timezone, or candle-boundary mismatch will reduce matched samples. Correlation describes co-movement in this historical window; it does not establish causation or predict direction.

## Paper-only reinforcement-style learning

The bandit ranks the configured paper strategy hypotheses within a simple BTC regime (up/down/flat, high/low realized volatility). It uses UCB1 on realized reward measured in R after the paper simulation accounts for fees and slippage. It requires at least 20 closed outcomes per strategy per regime by default. The initial labels are `consensus`, `trend_follow`, and `mean_reversion`; labels are experiment groups, not additional strategies implemented by this change.

Append one JSON object per closed paper outcome to the configured JSONL file:

```json
{"closed":true,"timestamp":"2026-10-20T12:00:00Z","pair":"BTC/USDT","regime":"up_lowvol","strategy":"consensus","rewardR":0.15}
```

Only outcomes closed before the prediction timestamp belong in the file. Do not use open-trade P&L or labels computed from future prices. Until sufficient outcomes exist, the report says it is collecting feedback.

## Safety and validation

Both reports are advisory. The bandit does not change the active consensus signal, risk gate, or order path. The correlation check is context only; it is not fed into model training, which avoids silently changing the existing model's learned feature set. Validate both in shadow/paper mode across multiple time blocks before drawing conclusions. Neither correlation nor a paper bandit establishes profitability.
