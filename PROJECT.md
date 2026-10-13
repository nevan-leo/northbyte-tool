# NorthByte Scenario Tool — complete project document

**BOLT UBC First Byte 2026 · NorthByte Airlines profit diagnosis**

A single-page interactive tool that diagnoses where NorthByte Airlines lost
$58.8M in FY25-26 and lets a viewer move the levers of the recommended plan to
see where profit lands against breakeven and a sustainable target.

- **Repository:** `~/Documents/MyProjects/airline-route-engine`
- **Runs at:** `http://localhost:3000`
- **Stack:** Next.js 16.2.6 · React 19.2.6 · TypeScript (strict) · vinext/Vite ·
  lucide-react · PostgreSQL 17 (verification only) · Python 3.13 (build scripts)
- **Status:** 19 commits, clean tree, lint clean, typecheck clean, production
  build clean, console clean, 21/21 acceptance tests passing

---

## 1. The case

NorthByte Airlines operates 54 directional domestic Canadian routes across 20
airports. Over two fiscal years (1 Sep 2024 – 31 Aug 2026) it expanded hard:

| Measure | Movement |
| --- | --- |
| Flights | +20% year over year (and about 2× on the expanded routes) |
| Revenue | +4.8% |
| Costs | +23% |
| Contribution (before gates) | **−$48.7M** |
| Profit after gates | **−$58.8M** |
| Margin | **−31.0%** |

The recommendation is a phased rollback of flights plus a modest fare rise on
the stable routes. The tool exists for the Q&A: a judge asks "what if revenue
falls more than you assumed", "what if we cut less", "what would it take to be
profitable", and the answer is on screen in seconds.

### The 54 routes split into three cohorts

| Cohort | Routes | What happened | Contribution today | Action |
| --- | --- | --- | --- | --- |
| **Restore** | 10 | Profitable before they roughly doubled; flights up ~2×, revenue up 2.4% | **−$48,798,729** | Roll back toward pre-expansion frequency, in tranches 1 → 2 → 3 |
| **Decide** | 6 | New routes: Toronto–London, Halifax–Moncton, Ottawa–Montréal | **−$10,259,846** | Re-cut London and Moncton (~10 tickets a flight), exit Ottawa–Montréal |
| **Protect** | 38 | Stable | **+$10,323,157** | Hold flights flat; the only lever is fares |

The ten Restore routes are Toronto–Ottawa, Toronto–Montréal, Halifax–Toronto,
Halifax–Montréal and Montréal–Vancouver, both directions. They carry essentially
the entire network loss.

---

## 2. Quick start

```bash
npm install
npm run dev              # http://localhost:3000
npm run build && npm start   # production
npm run lint
npx tsc --noEmit
```

Rebuild the embedded data (only needed if the source files change):

```bash
python3 scripts/build_northbyte_json.py    # route_model.csv  -> app/data/northbyte.json
python3 scripts/build_map_data.py          # geometry + monthly flights -> app/data/northbyte-map.json
python3 scripts/build_og_image.py          # public/og.png
```

Run the acceptance tests:

```bash
npx esbuild scripts/verify_northbyte.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/verify.mjs && node /tmp/verify.mjs
```

Re-check the prepared data against the raw workbooks (needs the Postgres load):

```bash
LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@17 start
psql -d northbound -f db/50_firstbyte_checks.sql
```

---

## 3. Architecture

```
route_model.csv  (54 rows, prepared)
   │  scripts/build_northbyte_json.py
app/data/northbyte.json          ← embedded at build time, no runtime fetch
   │
app/northbyte/model.ts           ← the model: scenario(levers) -> Scenario
   │                                every figure on screen comes out of this
   ├── app/northbyte/ScenarioTool.tsx   ← all screens, both tabs
   ├── app/northbyte/NetworkMap.tsx     ← map, aircraft, forecast timeline
   ├── app/northbyte/Figure.tsx         ← tweened numbers
   └── app/northbyte/Brand.tsx          ← the flight glyph (mark, favicon, aircraft)

Natural Earth 1:50m + Postgres monthly flights
   │  scripts/build_map_data.py  (Web Mercator, simplify, crop)
app/data/northbyte-map.json      ← projected SVG paths, airports, flights/month

transactions.xlsx / costs.xlsx / gates.xlsx  (raw case workbooks)
   │  scripts/xlsx_to_csv.py → scripts/normalize_firstbyte.py
   │  db/00_schema.sql → db/15_load_firstbyte.sql
PostgreSQL schema `nb`            ← independent check, not a runtime dependency
   │  db/50_firstbyte_checks.sql
```

### Every file

| Path | Lines | Purpose |
| --- | --- | --- |
| `app/page.tsx` | 21 | The shell: header and the tool. Nothing else is on the site. |
| `app/layout.tsx` | 48 | Metadata, fonts, Open Graph, `metadataBase` from the environment |
| `app/globals.css` | 353 | The entire design system: tokens, primitives, tool, map, transitions |
| `app/icon.svg` | — | Favicon: the flight glyph on wine |
| `app/northbyte/model.ts` | 177 | Section 5 of the build brief, implemented exactly |
| `app/northbyte/ScenarioTool.tsx` | 475 | KPIs, levers (six pillars), waterfall, readouts, tables, chart, assumptions |
| `app/northbyte/NetworkMap.tsx` | 369 | Map, arcs, aircraft animation, zoom/pan, forecast timeline |
| `app/northbyte/Figure.tsx` | 39 | `useTween` + `<Figure>`: numbers that ease instead of snapping |
| `app/northbyte/Brand.tsx` | 17 | `FLIGHT_PATH` (Material Symbols) and the `<Flight>` component |
| `app/data/northbyte.json` | — | 54 routes, network constants, presets |
| `app/data/northbyte-map.json` | 102 KB | 73 province paths, 8 neighbour shapes, 12 lakes, 20 airports, 24 months of flights per route |
| `scripts/build_northbyte_json.py` | 50 | CSV → embedded JSON |
| `scripts/build_map_data.py` | 200 | Projection, simplification, cropping, monthly flight query |
| `scripts/build_og_image.py` | 53 | The share card, in the same palette and figures |
| `scripts/normalize_firstbyte.py` | 145 | Cleans the three workbooks, counting every repair |
| `scripts/xlsx_to_csv.py` | 32 | One-time conversion of 32 MB of workbook XML |
| `scripts/verify_northbyte.ts` | 61 | The 21 acceptance tests |
| `db/00_schema.sql` | 162 | Schema, including the FirstByte fact tables |
| `db/15_load_firstbyte.sql` | 66 | Staged load with duplicate collapse |
| `db/50_firstbyte_checks.sql` | 44 | Independent checks on the prepared table |

---

## 4. The data

### 4.1 Sources

| File | Rows | What it is |
| --- | --- | --- |
| `transactions.xlsx` | 559,985 | One row per customer transaction: ticket, extra baggage, seat upgrade, change fee, food and onboard, refund |
| `costs.xlsx` | 115,204 | One row per cost category per flight — fuel, crew, maintenance, food — so 28,801 flights × 4 |
| `gates.xlsx` | 112 | One row per (gate, route) pair, with the whole gate's annual lease repeated on every row |
| `route_model.csv` | 54 | The prepared route table, one row per directional route, FY25-26 |
| Natural Earth 1:50m | — | Admin-0 countries, admin-1 provinces, lakes (public domain) |

All amounts are Canadian dollars. The fiscal year runs 1 September to 31 August.

### 4.2 Every defect found, and what was done about it

| Problem | Scale | Treatment |
| --- | --- | --- |
| `Route_ID` spelling drift (`YVR-YLW`, `yvrylw`, `YVRYLW`) | **216 spellings for 54 routes** | Strip non-letters, upper-case, split 3+3; unparsable rows counted |
| `Transaction_Type` case and alias drift | **45,476 rows** | Mapped to six canonical types |
| `Booking_Channel` drift (`OTA`, `Online Travel Agcy`, `Web`, `App`…) | **55,525 rows, 16 spellings** | Mapped to four canonical channels |
| `Transaction_Date` in three formats, and the slash format mixes DD/MM with MM/DD | 22,385 slash rows; **7,941 provably day-first, 5,696 provably month-first** | Resolved where one component exceeds 12. **8,748 rows are genuinely undecidable: timestamp left null and flagged, never guessed** |
| Duplicate transaction IDs | **1,856** (1,794 byte-identical) | Collapsed to one row per ID, preferring the copy with a resolvable date. Summing them would have inflated revenue |
| Gate lease repeated on every route row | 112 rows for **34 gates** | De-duplicated per (city, gate, year) before summing, then shared across the routes departing from that gate |
| Membership tier missing as `NONE`, `N/A`, `Unknown`, blank | **8,390 rows** | Kept as `Unknown` rather than folded into `Non-Member`, which would invent a fact about the customer |
| Gate leases follow the calendar year, not the fiscal year | 2 lease years | Kept distinct; 2026-27 records are missing from the source and that is stated, not interpolated |

### 4.3 Independent verification

The three workbooks were loaded into PostgreSQL from scratch rather than
trusting the prepared table.

| Check | Result |
| --- | --- |
| FY25-26 flights, counted as distinct (route, departure timestamp) in the cost file | **15,729 — exactly matches** the prepared table |
| FY25-26 ticket revenue | $190.78M |
| FY25-26 ancillary | $3.91M |
| FY25-26 refunds | −$7.72M |
| FY25-26 net | $186.97M vs the prepared **$189.64M** |
| Difference | **1.4%**, fully explained by the 8,657 in-window transactions whose dates could not be resolved and were excluded here |
| Gate leases, de-duplicated | 2024-25: $9,664,400 · 2025-26: $9,877,700 (34 gates each year) |
| Expansion | 5,021 flights in Sep 2024–Feb 2025 vs 15,729 in FY25-26 |

Seasonal evidence computed from the same load:

- The network flies **28% fewer flights in Dec–Feb than Jun–Aug** (1,040 vs 1,447 a month).
- **St John's holds at 87% of its summer schedule through the winter** (27 vs 31 a month).

---

## 5. The model

`app/northbyte/model.ts` implements section 5 of the build brief exactly. The
interface computes nothing of its own; every figure comes out of `scenario()`.

### 5.1 Inputs

| Lever | Range | Default | Note |
| --- | --- | --- | --- |
| Mode | preset / manual | preset | Manual uses a flights multiplier per cohort |
| Phase | 0–100% | 100% | Interpolates flights from today to the plan target |
| Tranche | 0–4 | 4 | Only routes with `Tranche ≤ n` move |
| Cohort multiplier (manual) | 0–150% | 100% | Applied to today's flights |
| ρ_down | 0–1 | 0.19 | Revenue lost per flight cut. Presets High 0.046 · Mid 0.19 · Low 1.0 |
| ρ_up | 0–1 | 0.024 | Observed on the expansion: +2.4% revenue on ~+100% flights |
| Crew shed | 0–100% | 100% | Share of crew cost saved on cut flights |
| Protect fare change `p` | 0–15% | 3.45% in the full plan | Cost pass-through preset is 3.45% |
| Elasticity `e` | 0 to −1.5 | 0 | Illustrative; no price variation exists in the data to measure it |
| Gates | actual / forecast | FY25-26 actual | $10,023,126 / $10,095,839 |
| Release idle gates | on / off | off (on in the full plan) | −$433,500 (Halifax A3, Ottawa A2) |
| Seasonal baseline | on / off | on | ×1.042 on Restore targets |
| Target margin | 0–10% | 4.7% | × $189,641,058 = $8.9M |

### 5.2 Per route

```
flights_new = Exit ? 0 : flights_now + phase × (PlanFlights × seasonal − flights_now)
ratio       = flights_new / flights_now
rho         = ratio < 1 ? rho_down : rho_up
rev_new     = Exit ? 0 : NetRev × (1 + rho × (ratio − 1))
cost_new    = flights_new × CostPerFlight
              + (1 − crew_shed) × max(0, flights_now − flights_new) × (Crew / flights_now)
fare_gain   = Cohort == Protect ? TicketRev × ((1+p)(1+e·p) − 1) : 0
feed_loss   = FeedToStableRev × rho × (1 − ratio)      // 0 for exited routes
contrib_new = rev_new + fare_gain − cost_new
```

The seasonal factor applies to Restore targets only. A route whose tranche has
not been applied is left untouched.

### 5.3 Network

```
contribution  = Σ contrib_new − Σ feed_loss
gates         = chosen basis − (released idle gates)
profit        = contribution − gates
margin        = profit / (Σ rev_new + Σ fare_gain − Σ feed_loss)
gap_breakeven = max(0, −profit)
gap_target    = target − profit
```

### 5.4 Derived readouts

- **Required Protect fare rise** solves `B((1+p)(1+e·p) − 1) = gap` for `p`.
  With `e = 0` it is `gap / B`; otherwise the positive root of the quadratic.
  Returns "not reachable by fares alone" when the discriminant is negative or
  `e ≤ −1`. `B` = Protect ticket revenue = **$142.4M**.
- **Breakeven revenue response**: profit is linear in ρ_down, so it is evaluated
  at ρ=0 and ρ=1 and interpolated. Currently **ρ = 0.16**.
- **Fill**: tickets per flight against `CostPerFlight / AvgFare`. Routes below it
  are flagged — **21 of 52 flying routes** under the full plan.

### 5.5 What a profit figure means

Every profit number restates **FY25-26 at the chosen frequency**: the same year
re-run as if that frequency had held all year. It is **not a run rate, nothing
compounds, and no second year is projected**. The map readout says so in words:
"+$58.0M if this frequency held for a full year".

---

## 6. Acceptance tests

21 tests from section 7 of the brief, tolerance ±$0.05M, all passing.

| Test | Got | Want |
| --- | --- | --- |
| today: flights | 15,729 | 15,729 |
| today: net revenue | 189,641,058 | 189,641,058 |
| today: cost | 238,376,482 | 238,376,476 |
| today: contribution | −48,735,423 | −48,735,418 |
| today: gates | 10,023,126 | 10,023,126 |
| today: profit after gates | −58,758,549 | −58,758,544 |
| today: margin % | −30.984 | −31.000 |
| today: Restore contribution | −48,798,731 | −48,798,729 |
| today: Decide contribution | −10,259,850 | −10,259,846 |
| today: Protect contribution | 10,323,158 | 10,323,157 |
| plan, ρ High (0.046) | −2,091,206 | −2,090,000 |
| plan, ρ Mid (0.19) | −6,141,043 | −6,180,000 |
| plan, ρ Low (1.0) | −28,921,375 | −28,920,000 |
| full plan, ρ High | **+3,254,486** | +3,260,000 |
| full plan, ρ Mid | −795,350 | −840,000 |
| full plan, ρ Low | −23,575,682 | −23,580,000 |
| YUL-YVR: flights today | 306 | 306 |
| YUL-YVR: plan flights (pre-seasonal) | 144 | 144 |
| YUL-YVR: revenue today | 9,289,406 | 9,290,000 |
| YUL-YVR: cost today | 19,629,343 | 19,630,000 |
| YUL-YVR: contribution today | −10,339,937 | −10,340,000 |

The deck's own bridge table shows +3.2 / −1.1 / −24.6 for the three ρ cases
because it applies one revenue-loss percentage to every cut route; the tool
applies the response route by route. The small differences above are that, and
the tool's numbers are the ones to use.

---

## 7. The six pillars

The lever panel is grouped as the recommendation, numbered. The first four drive
the model.

| # | Pillar | In the tool | Model effect |
| --- | --- | --- | --- |
| **1** | Cut back the doubled routes | Tranches applied (0–3), phase toward target, ρ presets and slider, crew shed | Restore cohort rollback |
| **2** | Raise fares on the stable routes | Fare change %, elasticity | Protect `fare_gain` |
| **3** | Fewer flights on the new routes | "Apply" checkbox (sets tranche 4; follows tranche 3) | Decide re-cut and the Ottawa–Montréal exit |
| **4** | Hand back the idle gates | Release toggle, gate basis toggle | −$433,500 and/or the 2026-27 basis |
| **5–6** | Seasonality | Seasonal baseline toggle, plus the evidence | **Not modelled route-by-route.** The panel states this outright |

On 5–6 the panel carries the real finding — St John's holds 87% of its summer
schedule through winter while the network flies 28% less — and says plainly that
a month-by-month trim is not in the numbers, because the plan works on annual
frequency.

---

## 8. The map

### 8.1 Geometry

- **Source:** Natural Earth 1:50m admin-1 provinces (the national outline and the
  internal borders in one pass), admin-0 countries for the United States and
  Greenland, and 12 named lakes. The 1:110m set was tried first and is too coarse
  to read as Canada once simplified enough to ship.
- **Projection:** Web Mercator, so the country reads the way every online map
  draws it. Projected in Python, not in the browser.
- **Simplification:** Douglas–Peucker at 0.0009 for provinces, 0.0016 for
  neighbours, 0.0006 for lakes, with a minimum-area filter per ring.
- **Crop:** the airports' bounding box plus padding — viewBox `48 801 967 504`.
- **Output:** 73 province paths, 8 neighbour shapes, 12 lakes, 20 airports,
  102 KB of plain SVG coordinates. Nothing is fetched at runtime, and the frame
  pastes into a design tool as vectors.

### 8.2 Aircraft

- Glyph: Material Symbols `flight`, filled, which is also the mark and the favicon.
- **One aircraft stands for a fixed quantity — about 14 flights a month —
  measured against the busiest route-month ever flown**, not against whatever is
  on screen. (An earlier version normalised against the current state, which kept
  the fleet the same size however many flights were cut. That was the bug.)
- Result: **105 aircraft today → 79 → 77 → 65 under the plan**, tracking the
  1,474 → 907 flights-per-month drop.
- Maximum 7 per route. A crossing takes ~3.4s with slight per-route variation.
- Positioned by writing each node's `transform` inside the animation frame rather
  than through React: 140 glyphs at 60fps is not a state update.
- Heading comes from the derivative of the quadratic Bézier; the glyph is
  nose-up, so the rotation is heading + 90°.

### 8.3 Reading the map

- Arc geometry: quadratic Bézier with a perpendicular bow (16% of length, capped
  at 70 units) so the two directions of a route stay apart.
- Line weight follows flights per month.
- **Nine busiest airports are named** (YYZ, YVR, YUL, YYC, YOW, YHZ, YEG, YLW,
  YYJ), ranked by total traffic in the data; the other eleven stay as dots.
  Twenty labels at this scale overlap into mush.
- Labels are bold with a cream halo; the eastern cluster is labelled to the left
  so the labels clear the routes leaving it.
- **Zoom:** pinch or the buttons (1.35× a step); a bare wheel scrolls the page.
  Drag to pan, clamped to the base extent, 8× maximum.
- **Symbols scale against the frame**, so aircraft, dots, labels and line weights
  hold their size on screen at any zoom.

### 8.4 The timeline

- The first column is the **last month actually flown — Aug 2026**, when the
  fiscal year closed. Its figure is real, counted from the cost file.
- The twelve columns after it run **forward from the month after the current
  one**, reading the clock rather than counting on from the end of the data.
- **One tranche lands a quarter**, capped by the tranche the levers allow, with
  T1–T4 marked on the axis. The forecast is the model on a calendar, not a
  separate assumption: each month asks `scenario()` for the tranches applied by
  then, so moving any lever moves the whole projection.
- Current path: 1,474 → 1,198 → 1,145 → 1,095 → **907 flights a month**.
- Play walks the thirteen steps and loops.

---

## 9. Design system

### 9.1 Palette

Four colours, everything else mixed from them against the cream.

| Token | Hex | Role |
| --- | --- | --- |
| `--maroon` / `--ink` | `#561C24` | Text, and anything that improved. 11.3:1 on paper |
| `--wine` / `--clay` | `#6D2932` | **Loss, and the mark. Nothing else.** 8.1:1 on paper |
| `--tan` / `--grey` | `#C7B7A3` | The one light value: borders, the Decide cohort |
| `--cream` / `--page` | `#E8D8C4` | The page |
| `--paper` | `#F5EBDE` | Panels, lifted off the page |
| `--ink-3` | `#865A5C` | Muted text, 4.8:1 on paper, safe at 11px |

### 9.2 Cohort encoding

Four related colours cannot separate three cohorts by hue alone, so each takes
its own weight and texture — which also matches the argument.

| Cohort | Drawn as | Why |
| --- | --- | --- |
| Restore | Wine, 1.6× weight, 85% opacity | They carry the whole loss |
| Decide | Tan, dashed, over a dark underlay, outlined aircraft | Six short routes need the contrast |
| Protect | Deep maroon, 0.9× weight, 16% opacity, 50% aircraft | The network holding steady behind |

The legend shows those lines as drawn, with route counts, instead of three dots
that all read dark.

### 9.3 Structure

- **Spacing:** a strict 4-point scale (`--s1` 4px … `--s8` 64px). No other values.
- **Radius:** one, 4px, everywhere.
- **Elevation:** one, barely there; hairline borders do the work.
- **Type:** Geist Sans for text, Geist Mono with `tabular-nums` for every figure,
  so money columns align on the decimal. One ramp: display
  `clamp(38px,4.4vw,58px)`, figure 26px, h2 18px, body 14px, small 12px,
  label 11px uppercase with 0.08em tracking.
- **Negative numbers** carry a minus sign as well as the colour; nothing relies
  on colour alone, and no figure sits on a tinted block.

### 9.4 Transitions

All between 150 and 450ms, all tied to something actually changing, all disabled
under `prefers-reduced-motion`.

- Figures **ease to their new value** (`useTween`, 420ms, ease-out cubic) rather
  than snapping — the whole scoreboard recomputes on every lever change.
- Arc weights and opacity, bar widths and tick heights transition over 450ms.
- Aircraft fade in as routes gain traffic.
- Switching view fades and lifts 6px over 280ms; the hero, tabs and KPI strip
  stay put, so only the content below changes.

### 9.5 Technical fundamentals

- Page title, description, Open Graph card (1200×630, built from the same palette
  and figures), favicon, `metadataBase` from the environment rather than a
  hard-coded host.
- Every interactive element works: tabs switch, presets apply, sliders move,
  sortable headers toggle direction and report it through `aria-sort`, the
  timeline scrubs, play plays, zoom zooms, reset resets.
- No horizontal overflow at 375px; wide tables scroll inside their own panel.
- `aria-label` on the map describing the current state, `aria-pressed` on toggles,
  focus-visible rings in wine.

---

## 10. What is assumption, not measurement

Stated in the tool itself, not only here.

- ρ, the fare elasticity and the 4.7% sustainable target are **our assumptions**.
  The target is NorthByte's own pre-expansion margin after gates; the case gives
  no target.
- **No price response is measurable** — the data contains no price variation.
- **Aircraft lease costs are absent from the data and are not modelled.** Crew
  shed at 100% assumes redeployment and no severance.
- **One ticket is treated as one passenger.** Seat counts do not exist in the
  data, so load factor is never shown; fill is tickets per flight against the
  break-even count.
- Every profit figure **restates FY25-26 at the chosen frequency**. Nothing
  compounds; no second year is projected.
- Connecting passengers are inferred from the route table's `FeedToStableRev`,
  not measured itinerary by itinerary.
- These are scenarios, not forecasts, and nothing here establishes causation.

---

## 11. History

| Commit | Date | What |
| --- | --- | --- |
| `a6e2b1a` | 1 Sep | Build Northbound route simulator |
| `6254d5f` | 1 Sep | Add interactive map and working navigation |
| `2a8e9c4` | 1 Sep | Replace map renderer with hosted-safe Leaflet map |
| `cae4612` | 1 Sep | Replace hardcoded route data with a PostgreSQL screening pipeline |
| `a45fe1f` | 1 Sep | Order the score formula and default capture above break-even |
| `38d6485` | 5 Sep | Run the model on real 2018 data, scoped to western North America |
| `4e294dd` | 9 Oct | **Add the NorthByte scenario tool** |
| `7c6f242` | 9 Oct | Replace the seat-based cost benchmark with verification queries |
| `eb6dc7e` | 9 Oct | Make the site the NorthByte tool and nothing else |
| `4f63742` | 10 Oct | Rebuild the interface on a red, black and white system |
| `a2b7739` | 10 Oct | Put the network back on a map, with the traffic it actually flies |
| `43c0525` | 10 Oct | Real map, real icons, and a second view for the evidence |
| `2d6549e` | 10 Oct | Mercator map with zoom, real aircraft glyph, opening on today |
| `29f3a1b` | 10 Oct | Point the timeline forward, shade the provinces, calm the zoom |
| `cecb9d5` | 10 Oct | Earth palette, honest dating, and a positive thing to aim at |
| `d67b3b2` | 10 Oct | Four-colour palette, and cohorts that separate by weight as well as hue |
| `4b4d556` | 10 Oct | Scale the fleet to the flights, plain map, levers as the six pillars |
| `62d2295` | 10 Oct | Name only the busy airports, ease every change, cut the lever prose |
| `27c049b` | 10 Oct | Say what the profit figure actually is, and cut the legend |

### Bugs found and fixed along the way

1. **Aircraft did not thin when flights were cut** — the fleet was normalised
   against the busiest route in the current state, so the yardstick shrank with
   the network. Fixed with a fixed reference.
2. **The map zoomed itself** — a bare wheel was captured for zoom, so any page
   scroll with the pointer over the map hijacked it and left the frame zoomed in.
3. **A grid blowout** pushed the page 106px wider than a phone screen (`1fr`
   instead of `minmax(0,1fr)` with a wide table inside).
4. **Leaflet teardown race** threw on `_leaflet_pos` when a view switch unmounted
   the map mid-animation (that renderer has since been replaced entirely).
5. **The timeline looked backwards** — two years of history on a slide whose
   question is what happens next.
6. **"Today" was two months stale** — Aug 2026 is the last month in the data, not
   today, and the forecast started from the data rather than from the calendar.
7. **"Profit a year" implied a run rate** when the model restates a single year.
8. **An inferred seat count** (19 seats against a $15k cost per flight) revealed
   the transaction file is not a full manifest; that analysis was deleted rather
   than shipped.

---

## 12. Open items

- **The brief asks for a single HTML file that opens offline from a local file.**
  This runs as a Next app and needs `npm run dev`. The page already fetches
  nothing at runtime, so a standalone build is a packaging job, not a rewrite.
- **The forecast reads the real clock**, so it shifts forward each month. Correct
  for a live demo; if the deck screenshots need to be reproducible forever, the
  start month should be pinned to a constant.
- **Pillar 5 is not modelled.** The monthly flights per route are already loaded,
  so a seasonal multiplier per route-month is the obvious next step if you want
  St John's winter trimming inside the numbers.
- **An unrelated pipeline still sits in the repo**: `db/01_reference.sql` through
  `db/40_export.sql`, `scripts/fetch_*`, `build_reference.py`, `normalize.py`,
  `make_sample.py` and `data/sample/` belong to an earlier U.S.–Canada transborder
  route screen built from BTS T-100 and Statistics Canada data. It is not part of
  the site and can be deleted.
- **`tsconfig.tsbuildinfo` is tracked in git** and should be ignored.

---

*Generated 12 October 2026. All figures verified against the running build.*
