"""Optional FreqAI LightGBM challenger. Not selected by the execution profile."""
from datetime import datetime, timedelta, timezone
import math
import numpy as np
from freqtrade.persistence import Trade
from pandas import DataFrame
import talib.abstract as ta
from freqtrade.strategy import IStrategy


class LowCostFreqAI(IStrategy):
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
            raise RuntimeError("LowCostFreqAI is restricted to dry-run evaluation")
        if self.config.get("trading_mode", "spot") != "spot":
            raise RuntimeError("LowCostFreqAI requires spot mode")

    def feature_engineering_expand_all(self, dataframe, period, metadata, **kwargs):
        dataframe["%-rsi"] = ta.RSI(dataframe, timeperiod=period)
        dataframe["%-atr_ratio"] = ta.ATR(dataframe, timeperiod=period) / dataframe["close"]
        return dataframe

    def feature_engineering_expand_basic(self, dataframe, metadata, **kwargs):
        dataframe["%-return1"] = dataframe["close"].pct_change()
        dataframe["%-relative_volume"] = dataframe["volume"] / dataframe["volume"].rolling(20).mean()
        dataframe["%-range_ratio"] = (dataframe["high"] - dataframe["low"]) / dataframe["close"]
        return dataframe

    def feature_engineering_standard(self, dataframe, metadata, **kwargs):
        hour = dataframe["date"].dt.hour + dataframe["date"].dt.minute / 60
        dataframe["%-hour_sin"] = np.sin(2 * np.pi * hour / 24)
        dataframe["%-hour_cos"] = np.cos(2 * np.pi * hour / 24)
        return dataframe

    def set_freqai_targets(self, dataframe, metadata, **kwargs):
        self.freqai.class_names = ["down", "flat", "up"]
        horizon = self.freqai_info["feature_parameters"]["label_period_candles"]
        forward_return = dataframe["close"].shift(-horizon) / dataframe["close"] - 1
        # Directional-return proxy with a 0.4% hurdle, NOT a simulated filled-trade label.
        dataframe["&-direction"] = np.select(
            [forward_return > 0.004, forward_return < -0.004], ["up", "down"], default="flat"
        ).astype(object)
        dataframe.loc[forward_return.isna(), "&-direction"] = np.nan
        return dataframe

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        return self.freqai.start(dataframe, metadata, self)

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["enter_long"] = 0
        dataframe.loc[
            (dataframe["do_predict"] == 1)
            & (dataframe["&-direction"] == "up") & (dataframe["volume"] > 0),
            ["enter_long", "enter_tag"],
        ] = (1, "lightgbm_research_v1")
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["exit_long"] = 0
        dataframe.loc[
            (dataframe["do_predict"] == 1)
            & (dataframe["&-direction"] == "down") & (dataframe["volume"] > 0),
            ["exit_long", "exit_tag"],
        ] = (1, "lightgbm_reversal")
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

    def _loss_budget_ok(self, current_time: datetime) -> bool:
        """Closed-trade net loss gates, measured against the fixed 250-USDT allocation."""
        try:
            now = current_time.astimezone(timezone.utc)
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            week_start = day_start - timedelta(days=day_start.weekday())
            trades = Trade.get_trades_proxy(is_open=False, close_date=week_start)
            day_pnl, week_pnl = 0.0, 0.0
            for trade in trades:
                closed = trade.close_date_utc
                pnl = float(trade.close_profit_abs)
                if closed is None or not math.isfinite(pnl):
                    return False
                if closed > now:
                    continue
                week_pnl += pnl
                if closed >= day_start:
                    day_pnl += pnl
            return day_pnl > -2.50 and week_pnl > -7.50
        except Exception:
            return False  # A missing/unreadable ledger cannot authorize new entries.

    def confirm_trade_entry(
        self, pair: str, order_type: str, amount: float, rate: float,
        time_in_force: str, current_time: datetime, entry_tag: str | None,
        side: str, **kwargs,
    ) -> bool:
        return (
            self.config.get("dry_run") is True
            and pair == "BTC/USDT" and side == "long"
            and amount > 0 and rate > 0 and amount * rate <= 25.01
            and self._loss_budget_ok(current_time)
        )
