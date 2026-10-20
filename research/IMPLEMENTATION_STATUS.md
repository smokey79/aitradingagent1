# Execution and research roadmap

Changes are on codex/next-candle-predictor. No service has been started, installed, merged, or deployed.

| Item | Implemented in branch | Remaining validation |
| --- | --- | --- |
| Freqtrade execution core | Bitget spot, BTC/USDT, dry-run-only PriceOnlyChampion strategy; persistent SQLite under user_data; optional Compose restart policy | Install/import strategy, verify exchange capabilities on installed CCXT, simulate orders and fills, restart with open orders/trades, reconcile DB |
| Shared feature snapshot | One immutable versioned OHLCV/order-book snapshot shared across Node predictor and all four price agents; archived by content hash | Verify live timestamps/rate limits; Freqtrade still uses its own internal execution market feed |
| Hard filter before AI | Missing/gapped/stale history, invalid quotes, spread >15 bps, depth <2500 USDT within 0.2%, universe mismatch reject before any LLM call | Thresholds are initial engineering bounds, not optimized trading edge |
| Champion/challenger registry | Fixed dry-run baseline and research challengers; no automatic promotion or code mutation | At least 3 chronological walk-forward folds and 100 closed paper trades; costs, drawdown and paired comparisons need review |
| Social feature ablation | Social disabled by default; optional separate challenger score; paired OOS evaluator checks timestamps, duplicates and costs flag | Resolved price-only vs price-plus-social outcomes do not exist yet; no lift or profitability established |

## Execution boundary

The Node entry point is research-only. It no longer imports exchangeRouter, profitAllocator or the old simulated balance/risk path. Those legacy files remain in Git history/source for reference; do not start them as an alternative bot. Freqtrade owns order lifecycle, fill handling, wallet/position state, Telegram and its trade database. The Node journal records snapshots and advisory decisions only, never fabricated fills or account balances.

The Freqtrade baseline is an EMA8/21 crossover with RSI14 and volume20 screens. It is an unvalidated experiment. It uses a 250 USDT simulated wallet, at most one position, a 25 USDT allocation cap, no leverage, a 2% stop and a 4% ROI target. Stake allocation is not risk-at-stop. Freqtrade costs, stop execution and exchange minimums still need real dry-run validation. PriceOnlyChampion refuses live startup.

Initial state remains stopped. A container restart preserves the SQLite file through the user_data mount but does not establish that recovery works: validate order/trade reconciliation and deliberately resume the stopped trader. Do not delete the DB or run two Freqtrade instances on it. The restart policy is configured only; no container is running from this change. Pin a tested image digest before treating this as a stable deployment.

## Data contract and budget

The research schedule is five seconds after each 15-minute UTC boundary. One process cannot overlap its own cycles. Raw bars remain in the archived snapshot, while agents receive the same compact technical/order-book summary and snapshot ID. The predictor reuses those bars instead of making another CCXT history request. All four price agents use the same prompt builder. Unused CMC/Glassnode/Dex enrichment is not called on this price-only research path. Existing data/marketData.js remains available for a later separately versioned enriched challenger.

The hard filter is a research cost gate. Freqtrade independently runs its price-only baseline; Node filter approvals do not authorize Freqtrade entries. Do not present this as an integrated AI execution bridge: no Node decision is sent to Freqtrade yet.

## Social experiment

SOCIAL_ABLATION_ENABLED=true opts into one social-source call after price filtering. The result is a separate challenger score and does not alter the price-only consensus. That social call has its own requestedAt/retrievedAt metadata; its content is not falsely assigned the earlier price snapshot time.

research/socialAblation.js accepts paired resolved OOS outcomes with: snapshotId, fold, split="oos", costsIncluded=true, priceOnlyNetR, withSocialNetR, socialKnownAtMs, decisionAtMs and outcomeResolvedAtMs. Both alternatives must use the same decision opportunities, sizing, exits and cost assumptions. Later-retrieved social content cannot be replayed as if it was known earlier. Aggregate means are descriptive, not proof of significance. Research score differences alone are not net trade-return uplift.

## Promotion and rollback

strategy-registry.json names the fixed baseline and research-only challengers. Nobody is promoted automatically, regardless of AI confidence or paper-bandit ranking. Collect chronological walk-forward results without reusing holdouts, net costs, drawdown, sample counts, resolved paper outcomes and paired price-only comparisons. Review evidence before editing the selected strategy. Keep previous reviewed code/config commits so rollback is a normal version restore; preserve and reconcile Freqtrade state rather than replacing its DB.

Paper-outcome ranking now filters by pair, regime and close timestamp, deduplicates trade IDs, and waits for all configured experiment groups to reach the sample floor. Provide tradeId, pair, closedAt, strategy, regime, rewardR and closed=true. It does not ingest Freqtrade fills automatically yet.

## Checks performed here

JavaScript behavioral checks use synthetic fixtures and mock feeds in the tool runtime, without terminal launches. They cover one history call per snapshot, immutability, filters, identical agent facts, social-off aggregation, and OOS leakage rejection. Python/Freqtrade and Docker integration cannot be claimed validated without installing/running the target stack. See the assistant completion message for actual check results.
