"""BTC race bot: Donchian breakout rider, long only.

Strategy (built for 1-minute cbBTC/USDC bars, 1000 USDC paper):
  - Indicators on closes: EMA(12), EMA(48), RSI(14), the 60-bar
    Donchian high, and the 30-bar slope of EMA(48).
  - Entry, flat only: the close breaks above the prior 60-bar high
    while EMA(12) sits above EMA(48), the slow EMA is sloping up,
    and RSI is not overbought. One position at a time, full cash.
  - Exits, all on price alone: take profit at +1.8% over cost, hard
    stop at -1.2% under cost, trailing stop -0.7% under the peak close
    since entry. No exits on bands or trend flips: on 1-minute bars
    those fire on noise and cut winners short.
  - After any sell, a 60-bar cooldown keeps the bot from re-entering
    the same whipsaw; no new entries in the last 60 bars.

Everything is deterministic: plain float math on the closes seen so far,
no wall clock, no randomness, no environment reads.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
import makefun_bars

SYMBOL = "CBBTC"

EMA_FAST = 12
EMA_SLOW = 48
RSI_LEN = 14
DON_LEN = 60
TP_BPS = 180
STOP_BPS = 120
TRAIL_BPS = 70
COOLDOWN = 60
NO_ENTRY_LAST = 60
MAX_SLIP = 100
WINDOW_BARS = 1440


def ema_series(closes, span):
    """EMA seeded with the mean of the first span closes, then alpha steps."""
    out = []
    value = None
    warm = []
    alpha = 2.0 / (span + 1)
    for c in closes:
        if value is None:
            warm.append(c)
            if len(warm) == span:
                value = sum(warm) / span
                out.append(value)
            else:
                out.append(None)
        else:
            value += alpha * (c - value)
            out.append(value)
    return out


def rsi(closes, length):
    """Wilder RSI over the last `length` closes, or None."""
    if len(closes) < length + 1:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(len(closes) - length, len(closes)):
        d = closes[i] - closes[i - 1]
        if d > 0:
            gains += d
        else:
            losses -= d
    if losses == 0.0:
        return 100.0 if gains > 0 else 50.0
    if gains == 0.0:
        return 0.0
    rs = (gains / length) / (losses / length)
    return 100.0 - 100.0 / (1.0 + rs)


class Bot:
    def __init__(self):
        self.closes = []
        self.peak = None
        self.cooldown_left = 0
        self.was_flat = True

    def on_batch(self, state, batch):
        bar = state.latest.get(SYMBOL)
        if bar is None:
            return []
        self.closes.append(int(bar["c"]))
        if state.warming_up:
            return []
        held = state.positions.get(SYMBOL)
        if held is None:
            self.peak = None
            self.was_flat = True
        else:
            close = self.closes[-1]
            if self.was_flat:
                self.peak = close
                self.was_flat = False
            elif self.peak is None or close > self.peak:
                self.peak = close
        if self.cooldown_left > 0:
            self.cooldown_left -= 1
        return self.decide(state, held)

    def decide(self, state, held):
        closes = self.closes
        n = len(closes)
        if n < EMA_SLOW + 1:
            return []
        fast = ema_series(closes, EMA_FAST)
        slow = ema_series(closes, EMA_SLOW)
        if fast[-1] is None or slow[-1] is None:
            return []
        r = rsi(closes, RSI_LEN)
        if r is None:
            return []
        close = closes[-1]
        trend_up = fast[-1] > slow[-1]
        slope_bps = 0.0
        if slow[-31] is not None and slow[-31] > 0:
            slope_bps = (slow[-1] - slow[-31]) / slow[-31] * 10000.0
        don_high = max(closes[-DON_LEN - 1:-1]) if n > DON_LEN else None

        if held is not None:
            value = state.value(SYMBOL, held.qty)
            cost = held.cost
            if cost <= 0:
                return []
            if value * 10000 >= cost * (10000 + TP_BPS):
                return self._sell_all(state, held)
            if value * 10000 <= cost * (10000 - STOP_BPS):
                return self._sell_all(state, held)
            if self.peak is not None and close * 10000 <= self.peak * (10000 - TRAIL_BPS):
                return self._sell_all(state, held)
            return []

        # Flat: one entry rule, the breakout.
        if n >= WINDOW_BARS - NO_ENTRY_LAST:
            return []
        if self.cooldown_left > 0:
            return []
        breakout = (
            don_high is not None
            and close > don_high
            and trend_up
            and slope_bps > 0
            and r < 72.0
        )
        if not breakout:
            return []
        room = state.weight_room(SYMBOL)
        amount = state.cash
        if amount > room:
            amount = room
        if amount < int(state.hello["fees"]["min_notional_quote_units"]):
            return []
        return [{
            "side": "buy",
            "symbol": SYMBOL,
            "notional_quote_units": amount,
            "max_slippage_bps": MAX_SLIP,
        }]

    def _sell_all(self, state, held):
        self.cooldown_left = COOLDOWN
        self.peak = None
        self.was_flat = True
        return [{
            "side": "sell",
            "symbol": SYMBOL,
            "qty": held.qty,
            "max_slippage_bps": MAX_SLIP,
        }]


BOT = Bot()


def on_batch(state, batch):
    return BOT.on_batch(state, batch)


if __name__ == "__main__":
    makefun_bars.run(on_batch)
