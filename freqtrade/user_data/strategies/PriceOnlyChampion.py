"""Price-only dry-run baseline. No LLM, external signals, or extra trade database."""
from datetime import datetime
from pandas import DataFrame
import talib.abstract as ta
from freqtrade.strategy import IStrategy


class PriceOnlyChampion(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "15m"
    can_short = False
    startup_candle_count = 100
    process_only_new_candles = True
    position_adjustment_enable = False
    minimal_roi = {"0": 0.04}
    stoploss = -0.02
    use_exit_signal = True

    def bot_start(self, **kwargs) -> None:
        # Research baseline: refuse live mode even if an environment override changes dry_run.
        if self.config.get("dry_run") is not True:
            raise RuntimeError("PriceOnlyChampion is restricted to dry-run evaluation")
        if self.config.get("trading_mode", "spot") != "spot":
            raise RuntimeError("PriceOnlyChampion requires spot mode")

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["ema_fast"] = ta.EMA(dataframe, timeperiod=8)
        dataframe["ema_slow"] = ta.EMA(dataframe, timeperiod=21)
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=14)
        dataframe["volume_mean"] = dataframe["volume"].rolling(20).mean()
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["enter_long"] = 0
        # Cross plus a mild momentum/volume screen. This is a hypothesis, not proven edge.
        crossed = (
            (dataframe["ema_fast"] > dataframe["ema_slow"])
            & (dataframe["ema_fast"].shift(1) <= dataframe["ema_slow"].shift(1))
        )
        dataframe.loc[
            crossed & dataframe["rsi"].between(50, 68)
            & (dataframe["volume"] > dataframe["volume_mean"])
            & (dataframe["volume"] > 0),
            ["enter_long", "enter_tag"],
        ] = (1, "price_only_v1")
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["exit_long"] = 0
        dataframe.loc[
            (dataframe["ema_fast"] < dataframe["ema_slow"])
            & (dataframe["ema_fast"].shift(1) >= dataframe["ema_slow"].shift(1))
            & (dataframe["volume"] > 0),
            ["exit_long", "exit_tag"],
        ] = (1, "trend_reversal")
        return dataframe

    def custom_stake_amount(
        self, pair: str, current_time: datetime, current_rate: float,
        proposed_stake: float, min_stake: float | None, max_stake: float,
        leverage: float, entry_tag: str | None, side: str, **kwargs,
    ) -> float:
        # Freqtrade owns wallet/position accounting. Cap one allocation at 25 USDT.
        try:
            if self.config.get("dry_run") is not True or side != "long" or leverage != 1:
                return 0.0
            cap = min(float(proposed_stake), float(max_stake), 25.0)
            return cap if cap > 0 and (min_stake is None or cap >= min_stake) else 0.0
        except (ValueError, TypeError):
            return 0.0

    def confirm_trade_entry(
        self, pair: str, order_type: str, amount: float, rate: float,
        time_in_force: str, current_time: datetime, entry_tag: str | None,
        side: str, **kwargs,
    ) -> bool:
        return (
            self.config.get("dry_run") is True
            and pair == "BTC/USDT" and side == "long"
            and amount > 0 and rate > 0 and amount * rate <= 25.01
        )
