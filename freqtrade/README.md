# Freqtrade dry-run execution core

Freqtrade is the only intended order/fill/wallet engine. The Node entry point is now research-only and does not call the legacy exchange router or profit allocator.

The checked-in profile selects PriceOnlyChampion: BTC/USDT, Bitget spot, 15-minute bars, one position, 250 USDT simulated wallet and at most 25 USDT per allocation. This EMA/RSI/volume strategy is an unvalidated price-only baseline, with a 2% stop and 4% ROI target. It refuses live startup. It is not connected to AI prediction or social signals.

## Persistence and restart configuration

compose.yaml mounts user_data and sets a restart policy. SQLite is stored at user_data/tradesv3.dryrun.sqlite. Use one Freqtrade process per DB. Keep this file across restarts; do not reset it to hide losses or rerun outcomes. No container was started in this session. The config starts stopped; resume deliberately only after runtime validation. Order/fill recovery has not been tested here.

## Telegram

Telegram is disabled. No bot token or chat ID has been read or added. Optional local Compose variables are FREQTRADE__TELEGRAM__ENABLED, FREQTRADE__TELEGRAM__TOKEN and FREQTRADE__TELEGRAM__CHAT_ID. Keep secrets in the local environment or ignored freqtrade/.env, never in the tracked JSON.

Create a bot through BotFather, start a private conversation with it, and use your own Telegram user ID. A group chat may give other group members control. After starting the dry-run stack, /tg_info and /status can check routing and responses. No Telegram connector was available here, so delivery has not been verified.

## Validation required

Import the strategy on the target Freqtrade version, check Bitget/CCXT capabilities, backtest without lookahead, simulate fills with costs, and test a restart with outstanding orders/trades. Verify DB reconciliation and Telegram before any deployment conclusion. Node and Freqtrade intentionally have separate data feeds at present; Node does not send decisions to Freqtrade.

See ../../research/IMPLEMENTATION_STATUS.md for the full roadmap and remaining evidence.
