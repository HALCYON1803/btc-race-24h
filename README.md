# btc-race-24h — Donchian breakout bot for cbBTC/USDC

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/HALCYON1803/btc-race-24h/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/HALCYON1803/btc-race-24h/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A trading bot for [make.fun](https://make.fun)'s **“Race a BTC trading bot live for 24 hours”** bounty ($250 in USDC). It trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, in a replay of on-chain prices — with 1,000 USDC of paper money. Nothing is traded for real.

## Strategy

Donchian breakout rider, long-only:

- Enter when the close breaks above the highest close of the previous 60 bars, the fast EMA(12) is above the slow EMA(48), the slow EMA is sloping up, and RSI(14) is below 72.
- Exit on price only: take-profit +1.8%, stop-loss −1.2%, trailing stop −0.7% from the peak.
- 60-bar cooldown after every exit; no new entries in the last 60 bars of the window.

Local grade on the published dev window: **+11.94 USDC** (+1.19% on 1,000 USDC), 4 trades, max drawdown 0.93%. Deterministic — two local grades reproduce the action log byte for byte.

## Run

The harness runs the bot with Node 22:

```sh
node main.ts
```

It speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout): one `hello`, one batch per minute, one reply per batch. Only the standard library and the vendored SDK shim in `vendor/` are used.

## Invite

Try make.fun with my invite link: https://make.fun/r/dmrvxv79
