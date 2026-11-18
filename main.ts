/**
 * BTC race bot: Donchian breakout rider, long only.
 *
 * Strategy (for 1-minute cbBTC/USDC bars, 1000 USDC paper):
 *   - Indicators on closes: EMA(12), EMA(48), RSI(14), the 60-bar
 *     Donchian high, and the 30-bar slope of EMA(48).
 *   - Entry, flat only: the close breaks above the prior 60-bar high
 *     while EMA(12) sits above EMA(48), the slow EMA is sloping up,
 *     and RSI is not overbought. One position at a time, full cash.
 *   - Exits, all on price alone: take profit at +1.8% over cost, hard
 *     stop at -1.2% under cost, trailing stop -0.7% under the peak close
 *     since entry. No exits on bands or trend flips: on 1-minute bars
 *     those fire on noise and cut winners short.
 *   - After any sell, a 60-bar cooldown keeps the bot from re-entering
 *     the same whipsaw; no new entries in the last 60 bars.
 *
 * Everything is deterministic: plain float math on the closes seen so
 * far, no wall clock, no randomness, no environment reads.
 */

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

const EMA_FAST = 12;
const EMA_SLOW = 48;
const RSI_LEN = 14;
const DON_LEN = 60;
const TP_BPS = 180n;
const STOP_BPS = 120n;
const TRAIL_BPS = 70n;
const COOLDOWN = 60;
const NO_ENTRY_LAST = 60;
const MAX_SLIP = 100;
const WINDOW_BARS = 1440;
const BPS = 10000n;

/** EMA seeded with the mean of the first span closes, then alpha steps. */
function emaSeries(closes: number[], span: number): (number | null)[] {
  const out: (number | null)[] = [];
  let value: number | null = null;
  const warm: number[] = [];
  const alpha = 2 / (span + 1);
  for (const c of closes) {
    if (value === null) {
      warm.push(c);
      if (warm.length === span) {
        value = warm.reduce((a, b) => a + b, 0) / span;
        out.push(value);
      } else {
        out.push(null);
      }
    } else {
      value += alpha * (c - value);
      out.push(value);
    }
  }
  return out;
}

/** Simple RSI over the last `length` closes, or null. */
function rsi(closes: number[], length: number): number | null {
  if (closes.length < length + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - length; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  if (gains === 0) return 0;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

class Bot {
  private closes: number[] = [];
  private peak: bigint | null = null;
  private cooldownLeft = 0;

  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    this.closes.push(Number(bar.c));
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL) ?? null;
    if (held === null) {
      this.peak = null;
    } else {
      const close = BigInt(bar.c);
      if (this.peak === null || close > this.peak) this.peak = close;
    }
    if (this.cooldownLeft > 0) this.cooldownLeft -= 1;
    return this.decide(state, held);
  }

  private decide(
    state: BarsState,
    held: { qty: bigint; cost: bigint } | null,
  ): OrderInput[] {
    const closes = this.closes;
    const n = closes.length;
    if (n < EMA_SLOW + 1) return [];
    const fast = emaSeries(closes, EMA_FAST);
    const slow = emaSeries(closes, EMA_SLOW);
    if (fast[n - 1] === null || slow[n - 1] === null) return [];
    const r = rsi(closes, RSI_LEN);
    if (r === null) return [];
    const close = closes[n - 1];
    const trendUp = (fast[n - 1] as number) > (slow[n - 1] as number);
    let slopeBps = 0;
    const slow31 = slow[n - 31];
    if (slow31 !== null && slow31 !== undefined && slow31 > 0) {
      slopeBps = ((slow[n - 1] as number) - slow31) / slow31 * 10000;
    }
    const donHigh = n > DON_LEN ? Math.max(...closes.slice(-DON_LEN - 1, -1)) : null;

    if (held !== null) {
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      if (cost <= 0n) return [];
      if (value * BPS >= cost * (BPS + TP_BPS)) return this.sellAll(held);
      if (value * BPS <= cost * (BPS - STOP_BPS)) return this.sellAll(held);
      if (this.peak !== null && BigInt(closes[n - 1]) * BPS <= this.peak * (BPS - TRAIL_BPS)) {
        return this.sellAll(held);
      }
      return [];
    }

    // Flat: one entry rule, the breakout.
    if (n >= WINDOW_BARS - NO_ENTRY_LAST) return [];
    if (this.cooldownLeft > 0) return [];
    const breakout =
      donHigh !== null && close > donHigh && trendUp && slopeBps > 0 && r < 72;
    if (!breakout) return [];
    const room = state.weightRoom(SYMBOL);
    let amount = state.cash < room ? state.cash : room;
    if (amount < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: amount, max_slippage_bps: MAX_SLIP }];
  }

  private sellAll(held: { qty: bigint; cost: bigint }): OrderInput[] {
    this.cooldownLeft = COOLDOWN;
    this.peak = null;
    return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIP }];
  }
}

const bot = new Bot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
