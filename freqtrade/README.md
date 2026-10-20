# Freqtrade dry-run profile and Telegram setup

This is a separate, optional Freqtrade instance. It does not route orders through the existing Node orchestrator. The checked-in profile is Bitget spot, BTC/USDT, 15-minute candles, one simulated position, $250 simulated wallet, and `dry_run: true`. It starts stopped and has Telegram disabled. No exchange or Telegram secrets are stored in this repository.

## Telegram

1. Create a bot with Telegram's BotFather and start a direct chat with it.
2. Get your Telegram user ID (or the group ID if using a group; a group gives members access to bot commands).
3. Add these to your machine's local environment or uncommitted `.env` file:
   `FREQTRADE__TELEGRAM__ENABLED=true`
   `FREQTRADE__TELEGRAM__TOKEN=<bot-token>`
   `FREQTRADE__TELEGRAM__CHAT_ID=<your-user-id>`
4. Keep `dry_run` true and `initial_state` stopped for initial setup. After startup, Freqtrade's `/tg_info` can confirm chat/group details; Telegram's `/status` can confirm the bot responds.

Freqtrade supports nested configuration overrides with `FREQTRADE__...` environment variables. Do not paste the token into chat, commit it, or place it in the tracked JSON file. This repository does not include a Telegram app connector, and no bot token/chat ID was available to test delivery in this session.

## Strategy requirement

The config names Freqtrade's `SampleStrategy` as a placeholder. Freqtrade's own sample strategy must be present in the configured strategy path for a Freqtrade process to start. Choose or write and backtest a strategy before running it. This change does not add a strategy, start Freqtrade, enable Telegram, or place orders.

Consult the official Freqtrade Telegram setup and configuration docs before enabling a bot. Keep Telegram commands private to your own user ID.
