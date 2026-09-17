# MAQS — All Indices, Equity + Gold + Silver

Institutional-grade multi-asset portfolio analytics for the Sharpe Efficient
Portfolio strategy run over the **All Indices** universe with a **fixed bullion
sleeve**: 80% stocks, 10% GOLDBEES, 10% SILVERBEES.

This is a static dashboard (HTML / CSS / vanilla JS) served from GitHub Pages.

## One strategy, not a comparison tool

MAQS reports a single book. There is **no universe switch and no sleeve switch**:
the terminal is pinned to All Indices + Equity + Gold + Silver, and every chart,
table and export describes that one strategy against its benchmark.

`data.js` still carries the other universes (Nifty 50, Nifty 500, High Quality)
and the other sleeves (Equity Only, +Gold, +Silver), because one pipeline builds
them all — but nothing in the terminal reads them. In `app.js` that is enforced
by two constants and a single-entry list:

```js
const UNIVERSE = 'T759';
const SLEEVE   = 'goldsilver';
const VKEYS    = [SLEEVE];
```

Every renderer maps over `VKEYS`, so widening the terminal again means putting
keys back into that list, not rewriting the renderers.

## The strategy

The same EGP / Sharpe single-index selection that drives the equity-only SQE
sites, but a fixed slice of total capital is reserved for two ETFs — GOLDBEES
and SILVERBEES — and the stock sleeve gets whatever is left. The bullion weights
are fixed, not tactical: they are rebalanced back to target every month
alongside the equity basket. Metals never compete with stocks for a slot.

| Sleeve | Stocks | Gold | Silver |
|---|---|---|---|
| **MAQS — Equity + Gold + Silver** | **80%** | **10%** | **10%** |

## Backtest window

**Jan 2022 – latest completed month.**

Returns follow the engine's trade convention: the basket is formed on the signal
month's close, bought at the trade month's open and sold at its close.

### SILVERBEES history and the sleeve it changes

The silver ETF's price history in this repo starts on **10 May 2022**
(`NSE_SILVERBEES, 1D.csv`, first data row `2022-05-10`); GOLDBEES goes back to
29 May 2012. So for the opening trade months of the window there is no
SILVERBEES price at all, and no silver position can honestly be held.

The engine decides this from the data, not from a hardcoded date: a metal with
no usable price history as of the signal month is simply absent from that
month's book, and the weight it would have taken goes to the **stock** sleeve
rather than sitting in cash, so the portfolio is fully invested throughout.

| Trade months | Stocks | Gold | Silver |
|---|---|---|---|
| 2022-01 – 2022-05 (no silver data) | 90% | 10% | 0% |
| 2022-06 onward | 80% | 10% | 10% |

The first fully funded silver month is **Jun 2022**: that book is formed on the
May 2022 close, by which point SILVERBEES has been trading since 10 May.

Nothing is forward-filled or synthesised for the months silver did not exist.
Those months are `null` in every silver series in `data.js` — never `0`, which
would read as "silver was flat that month" — and every standalone SILVERBEES
statistic (CAGR, volatility, drawdown, correlation) is measured only over the
months it actually traded, with the benchmark and risk-free series sliced to
match. `data.js` records the boundary as `meta.window.silver_from` and
`meta.window.months_without_silver`.

### The live month

The newest month is usually still running. Its book is formed and traded, but
its return is only month-to-date, so folding it into an annualised statistic
would distort everything downstream. It is therefore held apart: `data.js` keeps
it under `live`, never inside `monthly`, and the site shows it in its own card,
as a marked cell in the heatmap (excluded from the year total) and as a labelled
row in the CSV export. Every headline figure — CAGR, Sharpe, drawdown, win rate
— covers completed months only.

The **Live Portfolio** tab shows the book formed on the last completed signal
month's close, i.e. the basket being held right now.

## Heatmap drill-down

Clicking any cell in the PnL heatmap opens the book that actually produced that
month: the month's Nifty 50 / Nifty 500 returns, portfolio beta and ex-ante
Sharpe, the month's return against the benchmark, and the full holdings list
with an investment calculator.

Two per-holding figures are shown and they are not the same thing:

- **Return** — the price move across the trade month, open to close.
- **Contrib** — the position's P&L that month as a share of capital.

The engine runs a real book: positions carry forward at average cost, so a name
can book a gain in a month its price fell. Contribution therefore is *not*
weight × return, and only contribution reconciles:

```
sum(contributions of held positions) + P&L on positions exited this month
    = the month's portfolio return
```

Both terms are shown in the table footer. The exited-position line is a real
quantity taken from the engine, not a plug — its median across all 600
month-books is 0.02%.

## Portfolio Size — restating the whole dashboard for an amount

The **Portfolio Size** bar switches the entire terminal between two views:

- **Model ₹1 Cr** — the engine's own book, where rounding a position to whole
  shares is immaterial.
- **Your Amount** — every statistic on every tab (CAGR, Sharpe, drawdown, win
  rate, the equity curves, the heatmap, the tail table, the radar) restated for
  the amount entered.

Each month the published book is re-sized into whole shares with a one-share
floor, and **only what that rounding changed** is carried onto the model's own
month:

```
adjustment = return at achieved weights − return at target weights
month      = the model's month + adjustment
```

Anchoring to the model is deliberate. Rebuilding each month's return from the
holdings alone would also swap out the engine's accounting — it carries
positions at average cost and books their P&L on rebalance, which a fresh buyer
of the published book does not — and over this window that is worth about **4
percentage points of CAGR**. That difference is a property of the accounting
method, not of the amount, so it is held constant. The result is the behaviour
you want: capital compounds, the rounding effect fades as the book grows, and at
a large enough amount the numbers converge back on the published ones.

Measured on the Nifty 500 overlay, the mean monthly deviation from the model is
0.48% at ₹1 lakh, 0.019% at ₹25 lakh and 0.0008% at ₹5 crore.

## Which price is shown

The workbooks record three prices per holding and only one of them is a price
anyone can transact at:

| column | what it is |
|---|---|
| `Buy Price` | the **open of the trade month** — what the book was entered at |
| `Sell Price` | the close of the trade month, or the latest close for the live month |
| `Avg Price` | the engine's **carried cost basis** |

The site prices and sizes everything off the **Buy Price**. The average cost is
not a market price: the engine has held GOLDBEES since May 2022 and averages its
cost across years of rebalancing, so by July 2026 that column reads ₹61.71
against a market price of ₹115.36 — and SILVERBEES ₹121.90 against ₹212.50.
Sizing quantities off it would have roughly doubled every long-held position.
Across the 15,178 priced rows on this site, 8,616 sit more than 5% away from
their cost basis, so this is not an edge case.

The cost basis is still carried in the data as `a` and surfaced in a tooltip on
the price cell, because it is what makes a position's contribution differ from
weight × return.

Every displayed price is verified against the month-open in the underlying price
CSVs, per universe (the three stock folders carry different corporate-action
adjustments for the same name).

## Sizing for a real amount

The model book is sized against ₹1 crore, where rounding a position to whole
shares is immaterial. At ₹1 lakh it is not, so entering an amount does not
scale the model's numbers — it re-derives them from what could actually be
bought:

- whole shares only, and **at least one of every holding**, so nothing the
  model holds is rounded away;
- the achieved weight of each position is therefore its own cost over the total
  cost, not its target weight;
- **Contrib** is that achieved weight × the stock's return, and the footer's
  return is their sum — the return on *your* amount, not the model's.

The one-share floor has a consequence worth stating plainly: a high-priced name
can only be bought in a lump, so at small amounts its achieved weight overshoots
its target and the book can cost more than the amount entered. At ₹1 lakh, 441
of the 600 month-books do. The table shows each position's achieved weight
against its target (flagged when it drifts more than 2pp) and the footer turns
"Cash Left" into "Additional needed for 1 share of each", so the shortfall is
visible rather than silently truncated.

The model's own result stays on screen underneath, clearly labelled, so the two
are never confused.

## Churning Analysis

How long the book actually holds a name, and which tax period that lands in.

Everything on this tab is read off `MONTHLY_HOLDINGS` — the engine's own book for
each trade month — rather than inferred from trade counts. A position is *held*
in every month it appears in, so **Avg Stocks Held** is the mean of the monthly
position counts, not `total trades / months`.

A **spell** is one continuous holding: the same symbol in consecutive trade
months. A name that leaves and comes back later is two spells, which is also how
the holding period treats it — the clock restarts on re-entry. Because the engine
buys at a trade month's open and sells at its last month's close, a spell runs
from the first day of its first month to the last day of its last, so the
shortest possible holding is one month rather than zero days.

**Long-term threshold** — 365 days by default (Indian listed equity: long-term is
a holding of *more* than 12 months). It is a selector, not a constant, because
the rule is a policy input rather than a property of the book; 24- and 36-month
rules are available for comparison. Exactly 12 months is *not* long-term.

Two different classifications are shown, and the tab says which is which:

- **Avg stocks held (long/short)** is point-in-time. In each month a position
  counts as long-term once it has *already* been held past the threshold. It
  never uses knowledge of how the position was eventually sold.
- **Exits, holding periods and contribution** describe closed positions by the
  period they actually achieved.

Positions still open in the final book are counted as held but never as exits —
counting them as sales would understate every holding period. GOLDBEES and
SILVERBEES are excluded throughout: they are a fixed-weight sleeve that is never
churned, and an ETF is not taxed on the equity holding period this tab is about.

**Positions opened / closed** counts position entries and exits, not trades. The
book rebalances every holding every month, so a transaction count would measure
the rebalance schedule rather than the churn.

Two limits worth stating plainly:

- The published book is **monthly**, so the shortest holding this data can
  express is one month. A name bought and sold within a single month never
  reaches a book and cannot appear here.
- A security that is delisted, or that drops out of the price data, ends its
  spell in the same way a sale does. The monthly books carry no exit reason, so
  the two are indistinguishable from this data.

There is no universe, sleeve or date-range filter on this dashboard, so the tab
covers the whole backtest window for the one strategy. It does not vary with
**Portfolio Size** either, because `sizeBook()` keeps at least one share of every
holding, so the set of names is the same at any amount. The long-term threshold
selector is the only control on the tab.

## Files
- `index.html` — page shell and layout
- `style.css` — styling (shared with the other SQE terminals)
- `app.js` — rendering logic and interactivity
- `data.js` — precomputed dashboard data (`MULTIASSET_DATA`)
- `holdings.js` — per-month books for the drill-down and the Churning tab
  (`MONTHLY_HOLDINGS`, `MONTH_META`, `SECTOR_MAP`)
- `test_terminal.js` — `node test_terminal.js`. Loads the real `app.js` against
  the real data with a stub DOM and checks the churning reconstruction (every
  book's positions accounted for by exactly one spell, entries and exits
  reconciling, the 365-day boundary) and the trailing-return periods (1Y/2Y/3Y
  are the same calculation over a longer slice; a period the history cannot fill
  reports `N/A`). Run it after touching either.

## Where the numbers come from

`data.js` is generated by `build_multiasset.py` in the main research repo. That
script merges two JSON files produced by the report pipeline, which in turn
recompute every statistic from first principles out of the backtest workbooks
(`Sharpe_Summary_{UNIV}_A_{VARIANT}.xlsx`):

- `metrics.json` — 12 runs (3 universes x 4 sleeves), monthly return series,
  standalone bullion statistics, the correlation matrix and the crisis-month table
- `holdings.json` — the current Equity + Gold + Silver book per universe
- `holdings_monthly.json` — every month's book for all 12 runs, pulled from the
  per-month `PM_YYYY-MM` sheets, plus a sector map built from the price files'
  own Industry column (the index constituent lists stop at the Nifty 500, which
  left most of the All-Indices book unclassified)

Nothing on this site is hand-typed, and nothing is recomputed in the browser
except chart-level derivations (equity curves, drawdown, rolling returns) that
follow directly from the monthly series shipped in `data.js`.

## Local preview

```sh
python -m http.server 8000
# then visit http://localhost:8000
```

## Deploy (GitHub Pages)

Push to `main`, then in repo settings enable **Pages → Deploy from branch → main / root**.

> `index.html` loads `app.js` / `data.js` with a `?v=` cache-bust token. Bump it
> whenever those files change so browsers pick up the fresh copies.
