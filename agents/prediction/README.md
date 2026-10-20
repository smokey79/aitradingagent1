# Next-candle predictor (shadow mode)

The predictor produces a probability that the next **15-minute close** will be above the most recently completed close. It does not place orders and is not connected to the risk gate.

## Data sources

- Online OHLCV history: CCXT, defaulting to public Bitget market data.
- Optional local CSV history: set \`LOCAL_CANDLE_HISTORY_CSV\` in the machine's uncommitted \`.env\`.
- The predictor drops the still-open candle, merges rows by timestamp, and uses a chronological 75/25 train/holdout split.
- TradingView script: \`tradingview/next_candle_audit.pine\`. It plots the matching feature family and can emit a bar-close JSON alert for independent chart-side auditing. The alert is not consumed by the bot until a separately secured webhook relay is configured.

## Local settings

Add these to the local \`.env\` file only; do not commit keys or private paths:

\`\`\`dotenv
PREDICTION_EXCHANGE=bitget
PREDICTION_TIMEFRAME=15m
PREDICTION_CANDLE_LIMIT=1000
PREDICTION_MIN_EXAMPLES=400
# Optional CSV with timestamp,open,high,low,close,volume and optional symbol columns
LOCAL_CANDLE_HISTORY_CSV=F:/your-folder/candles.csv
\`\`\`

Supported CSV timestamps are ISO-8601 or Unix seconds/milliseconds. CSV rows can include a symbol/pair column; if present, only the matching pair is used.

## Output and validation

Each orchestrator cycle logs direction, both probabilities, timestamp targeted, source, and recent chronological holdout metrics. Predictions remain shadow-only even when the recent holdout beats a constant base-rate forecast. Review calibration, balanced accuracy, baseline comparisons, and subsequent realized outcomes over many forward predictions before considering any use in trading.

Candle direction is not a trade return. Fees, spread, slippage, funding, and execution timing must be evaluated separately. Social/news feeds and LLM summaries are not included in candle training features because they can be timestamped late or leak future information.
