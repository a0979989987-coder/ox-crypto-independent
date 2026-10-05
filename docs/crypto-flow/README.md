# OX Crypto Tools — compact review build


## Run and review

`node scripts/dev-server.mjs --port 4174` → `/previews/crypto-flow.html`.

`node scripts/export-crypto-flow-preview.mjs [destination.html]` exports a portable offline review containing actual captured responses. It is explicitly a snapshot, not a continuously live production feed. The pressure view can request a manual refresh. Bybit liquidations have an explicit session-connect control.

## Implemented review surfaces

| Tool | Actual functionality | Scope |
| --- | --- | --- |
| Sector rotation | 15m/1h/4h; four quadrants; 8 historical frames; selected 6-point trail (all trails optional); replay; equal-size default/turnover toggle; ranks; search; favorites; member drilldown; table | Five classified crypto observation baskets, 24 constituents plus BTC benchmark |
| Heatmap | 15m/1h/4h/24h return colors; area by period USDT turnover, global market cap or equal; sector grouping/filter; asset drilldown | 25 Bitget USDT perpetual instruments; CoinGecko cap timestamps may differ |
| Taker pressure | 15m/1h/4h same-asset buy/sell imbalance; quadrant change; data table; manual refresh | Recorded top-20 crypto universe; missing source rows excluded |
| Derivatives | OI base/notional; funding and interval; mark/index premium; available account long-short ratios; OI × Price snapshot comparison | Not all metrics are available for every asset. Unknowns stay blank |
| Footprint | Actual trades; 1m OHLC and price bins; bid/ask; delta; total; POC; diagonal imbalance; bar detail | BTC/ETH/SOL, 3,000 recorded trades each; narrow historical sample; incomplete edge bars marked |
| CVD | Price + accumulated signed base volume, anchored at first loaded trade | Same recorded sample, not all-day/full-market CVD |
| Volume Profile | Actual loaded trades grouped by price; bid/ask and POC | Same loaded interval |
| Liquidations | Bybit session adapter, period/asset filters, balance and event rows, explicit observation window | Historical 1/4/12/24H data is NOT connected. Capture could not establish WS connection; snapshot remains unavailable, never zero |
| Estimated zones | Honest unavailable state and distinction from observed events | NOT implemented as a numeric model/feed. No fabricated heatmap |

## Sector semantics

X = equal-weight mean constituent period return − BTC same-period return, in percentage points.
Y = current X − previous adjacent-period X, in percentage points.
Each return uses closed 15m candles with contiguous coverage. Replay windows are anchored to whole UTC intervals. A fixed cohort is used across all displayed frames; a member with a missing required candle is excluded from every frame. Each basket requires at least two valid constituents.

Quadrants: X>0,Y>0 領先擴大; X>0,Y<0 領先降溫; X<0,Y>0 落後改善; X<0,Y<0 落後擴大. An axis value of exactly zero is 持平. This is a transparent relative-return map, not a proprietary RRG calculation or statistical buy/sell forecast.

The default equal-size circles show every classified sector clearly and encode no turnover in area. The turnover toggle makes area proportional to current-period constituent USDT turnover; exact turnover remains in the detail. Trade-activity share = basket turnover / turnover across included baskets. Share change is in pp. Rising share does not prove capital transferred into that sector. Market cap is never equated to new cash inflow.

Classification uses explicit CoinGecko IDs checked against category responses and Bitget crypto instrument metadata; one chosen primary group per asset avoids duplicate totals. The baskets cover L1, DeFi, Meme, AI and L2. They are selected observation pools, not complete investable sector indices. RWA/oracle requests failed during collection and were not fabricated. Historical replay uses today's selected membership and therefore is not a survivorship-bias-free backtest.

Every bubble keeps its measured center and area. External labels may move to avoid collisions, joined to the center by a leader. The numeric table and sector details provide precise coordinates. Playback stops at the most recent frame; no indefinite loop.

## Public sources and captured evidence

`previews/data/crypto-tools-snapshot.json` retains source candle responses, timestamps, instruments/tickers, CoinGecko membership and cap metadata, trade records and REST pagination provenance. `crypto-flow-snapshot.json` retains pressure source records. `crypto-liquidations-snapshot.json` records the failed connection explicitly.

Bitget:
- `/api/v3/market/instruments?category=USDT-FUTURES`
- `/api/v2/mix/market/tickers?productType=USDT-FUTURES`
- `/api/v2/mix/market/candles` (15m; 200 records per symbol)
- `/api/v2/mix/market/fills-history` (3 pages × 1,000 per BTC/ETH/SOL)
- `/api/v2/mix/market/current-fund-rate`
- `/api/v2/mix/market/long-short`
- `/api/v2/mix/market/taker-buy-sell`

CoinGecko: `/api/v3/coins/markets` with verified category or explicit bitcoin ID. Source metadata and per-coin update times remain available in the information dialog.
Bybit: `wss://stream.bybit.com/v5/public/linear`, `allLiquidation.{symbol}`. Buy is liquidated long; Sell is liquidated short. The provided bankruptcy price times size is labelled bankruptcy-price notional, never actual execution USD. Identical fields are deduplicated because the feed has no unique event identifier; this is another reason not to certify the session as an audit-complete exchange total.

## Calculation integrity

- OI notional = base holdings × mark price. OI change uses base holdings, so changing price alone cannot create OI expansion.
- OI/price compares actual source snapshot timestamps (~30 minutes in this capture), not a claimed 1h interval.
- Perpetual premium = mark/index − 1. No invented maturity or annualized futures basis.
- Funding intervals use source contract fields. Long-short ratios describe accounts and are not dollar position shares.
- Trades are validated and deduplicated by exact string tradeId. Ask=aggressor buy; Bid=aggressor sell. Base volume is never allocated from OHLCV candles.
- Price bucket=floor(price/step); 1-minute time bucket=floor(timestamp/60000). Delta=Ask−Bid; CVD sums signed volume from the first loaded trade. Bid/Ask labels describe executed aggressive volume, not resting order-book liquidity.
- POC=max total volume price bucket. Diagonal imbalance compares Ask(k) to Bid(k−1), or Bid(k) to Ask(k+1), at 3× and at least 1% of bar total; zero denominator is not assigned infinity.
- Only first/last loaded-minute boundaries are marked partial. Interior bars reconcile to retrieved pages; full exchange completeness has not been certified.
- Missing data remains absent. Healthy zero-events is shown only after subscription acknowledgement and only for the stated session window.

## UI and performance

No hero heading, promotional paragraph or redundant introductory cards. Essential units and provenance remain. Reading details are under the small information control. Desktop adds a ranking/detail rail; mobile uses a bottom detail sheet, horizontal tool navigation and a dedicated fullscreen exit. Canvas rendering preserves data geometry with one active chart. DPR is capped at 2. No force-layout loop, persistent background animation or per-cell DOM. Motion is a finite opacity/translate entrance, disabled by reduced-motion preference.

Every chart disposes its ResizeObserver and pending RAF. Replay and WebSocket stop when leaving their tool; requests abort on navigation or hidden page. Pressure snapshots are cached per timeframe to prevent a refresh erasing other periods. Shared state, localStorage and CSS are scoped to the analytics module.

## Remaining production work

1. Shared backend collectors/cache, rate limits, freshness and reconnect gap monitoring. Current snapshot-first review is not a production realtime backend.
2. Continuous durable trade storage with gap detection/backfill and instrument-unit validation, before wider-symbol/historical Footprint promises.
3. Licensed or qualified historical liquidation source for complete 1h/4h/12h/24h totals; session capture does not substitute for it.
4. Estimated liquidation-zone source/model with explicit assumptions, uncertainty, versioning and out-of-sample validation. Do not reverse-engineer account leverage from only candles/OI.
5. Review data redistribution terms and costs before public multi-user service; review this UI before merging to main/deploying.

## Verification

`npm test` checks the existing project and analytic data invariants. The new model tests verify fixed cohorts, return/share conservation, missing-candle exclusions, exact treemap area weights, trade deduplication and reconciliation, partial boundaries and base-unit OI changes.

`OX_CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell node scripts/test-crypto-flow.cjs` exercises all tools at 320/390/768/1440px, real snapshots, sector filters/search/favorites, replay, fullscreen/pinch, asset dialogs, order modes, unavailable-liquidation display, failure fallback, reduced motion, standalone export and Crypto-only launcher boundaries.
