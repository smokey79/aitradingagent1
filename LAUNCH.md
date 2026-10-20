# AiTradingAgent

Local trading research with a separate Freqtrade dry-run execution core.
Current checkpoint: [BOOKMARK.md](BOOKMARK.md).
Working branch: codex/next-candle-predictor.

## Launch commands

Run from the checked-out project directory after installing dependencies:

| Command | What it does |
| --- | --- |
| npm run check | Read-only file/dependency checks; exits with a failure code when prerequisites are missing |
| npm run research | Starts the Node research scheduler; no orders or transfers |
| npm run paper | Starts the separate Freqtrade Compose service in the background |
| npm run paper:status | Shows Compose service status |
| npm run paper:stop | Stops the Freqtrade service and preserves its mounted data |
| npm test | Runs the JavaScript tests |
| npm run dashboard | Starts the existing dashboard separately, when needed |

The commands are compatible with Windows shell invocation. Node 20+ is required by this project configuration. Docker Desktop/Compose is required for the paper service; its availability is not checked by the JavaScript configuration checker.

Freqtrade config.json remains dry_run=true with initial_state=stopped. Therefore starting its service does not authorize entries or establish that trading has started. First verify strategy imports, data, fees, order/fill behavior, persistent DB and recovery; then deliberately resume the stopped dry-run trader. Telegram is disabled until locally configured.

Only one Node research scheduler should run: choose direct npm invocation OR the supplied single-app PM2 manifest. Do not launch both. Existing processes/startup entries on the laptop must be inspected before using PM2; editing ecosystem.config.js does not remove an existing PM2 registry or saved startup list.

The default AI review path uses one local Ollama model with bull/bear roles, at most four review sessions daily. Paid calls and social analysis are excluded from this default path. DL4J requires an explicit opt-in and a trained artifact. Optional LightGBM research is separately configured; it is not selected by the execution service.

Secrets belong in the private local environment or ignored .env files. No token should be committed. The offline/unavailable laptop has not received these repository changes automatically.

## Verification state

Synthetic JavaScript behavior checks were performed through the tool runtime without launching terminals. Full Node dependency installation, native Python/FreqAI imports, Docker startup, live feed authentication, model training, fill and recovery tests remain pending. No profitability or guaranteed success rate has been established.
