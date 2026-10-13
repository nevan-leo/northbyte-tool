# NorthByte Scenario Tool

NorthByte Airlines grew flights 20% in FY25-26 while revenue grew 4.8% and costs
grew 23%, losing **$58.8M after gate costs**. The tool lets a viewer move the
levers — how many flights, how much revenue is lost when flights are cut, how
much fares rise — and see immediately where profit lands against breakeven and a
sustainable target.

```bash
# rebuild the embedded route table, then verify against the deck
python3 scripts/build_northbyte_json.py
npx esbuild scripts/verify_northbyte.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/verify.mjs && node /tmp/verify.mjs
```

## Palette

Four colours: `#561C24` deep maroon, `#6D2932` wine, `#C7B7A3` tan, `#E8D8C4`
cream. Everything else is one of them mixed against the cream, so the page stays
in family. Wine is reserved for loss and for the mark; the deep maroon carries
text and anything that improved; tan is the one light value.

Four related colours cannot separate three cohorts by hue alone, so each cohort
also gets its own weight and texture, which happens to match the argument:

| Cohort | Drawn as | Why |
| --- | --- | --- |
| Restore (10) | wine, heavy, nearly opaque | they carry the whole loss |
| Decide (6) | tan, dashed over a dark underlay | few and short, so they need the contrast |
| Protect (38) | deep maroon, thin, 16% opacity | the network holding steady behind |

A negative figure also takes a wine tint behind it, so the signal never rests on
two neighbouring reds alone.

## Two views

**Scenario** carries the levers, the map and the scoreboard: the live demo. The
levers are grouped as the six pillars of the recommendation —

1. cut back the doubled routes · 2. raise fares on the stable ones ·
3. fewer flights on the new routes · 4. hand back the idle gates ·
5–6. seasonality

— with the first four driving the model and the last two carried as evidence:
the network already flies 28% fewer flights in Dec–Feb than Jun–Aug, while St
John's holds at 87% of its summer schedule through the winter. A month-by-month
trim is not modelled, because the plan works on annual frequency, and the panel
says so rather than implying it is in the numbers.
**Data and assumptions** carries the waterfall, the readouts, the cohort and
route tables and the assumption list: the evidence a judge asks for.

## The map

The opening frame is the network as it was last flown — **Aug 2026**, when the
fiscal year closed, at 1,474 flights a month, 76% above the pre-expansion
window. The timeline then runs **forward from the month after the one we are
actually in**: twelve months of the rollback phasing in, one tranche a quarter,
ending at 907 flights a month and **+$58.0M of profit if that frequency held for
a full year**.
Tranche landings are marked on the axis.

The readout leads with the profit recovered rather than the flights cut, because
the cut is the means and the recovery is the point. Every profit figure restates
FY25-26 at the chosen frequency — one year re-run, not a run rate. Nothing
compounds, and no second year is projected. Gaps elsewhere read as what
there is to close, not as a negative target to aim at.

The forecast is the model on a calendar, not a separate assumption: each month
asks `scenario()` for the tranches applied by then, capped by the tranche the
levers allow, so moving a lever moves the whole projection.

One aircraft stands for a fixed number of flights a month — about 14 — measured
against the busiest route-month ever flown rather than against whatever is on
screen, so cutting flights visibly thins the traffic: 105 aircraft today, 65
under the plan. The nine busiest airports are named; the rest stay as dots,
because twenty labels at this scale overlap into mush. The map itself is drawn plainly from the
Natural Earth geometry, with no data shading over it. Pinch or the buttons to zoom, drag to pan; symbols scale against the
frame, so aircraft, dots, labels and line weights hold their size on screen at
any zoom.

Today's figure is **real**, counted from the cost file as distinct (route,
departure timestamp) pairs; everything to the right of it is a forecast of the
plan phasing in, not a prediction of demand, and the legend says so. Everything is plain SVG at coordinates
projected in `scripts/build_map_data.py` (Web Mercator, so the country reads the
way every online map draws it) from the public-domain Natural Earth 1:50m provinces,
country outlines and lakes, so the frame can be pasted into a design tool as
vectors rather than a raster map, and no tiles are fetched at runtime. The 1:110m
set is too coarse to read as Canada once simplified enough to ship.

```bash
scripts/build_map_data.py    # regenerates app/data/northbyte-map.json
```

Figures ease to their new value rather than snapping, arcs and bars transition
their weight, and switching view fades in — all between 150 and 450ms, all tied
to something actually changing, and all off under `prefers-reduced-motion`.

Aircraft are Material Symbols' `flight` glyph, which is also the mark and the
favicon, positioned by writing each node's
transform inside the animation frame rather than through React, since a hundred
and forty glyphs at sixty frames a second is not a state update. Icons elsewhere
are Lucide; `prefers-reduced-motion` holds them still, and the
static frame carries the same information because density, not movement, is the
signal.

`app/northbyte/model.ts` implements the brief's model exactly; every figure the
interface shows comes out of `scenario()`. The 54-route table is embedded as JSON
at build time, so the page runs with no server call and no fetch.

**All 21 acceptance tests pass** within the brief's ±$0.05M tolerance, including
Today (−$58.76M profit), the three ρ cases at plan, the full plan
(+$3.26M / −$0.84M / −$23.58M) and the Montreal–Vancouver spot check.

### Independently verified against the raw case files

The three workbooks were loaded into Postgres from scratch
(`db/15_load_firstbyte.sql`) rather than trusting the prepared table. Re-run the
checks with `psql -d northbound -f db/50_firstbyte_checks.sql`:

- **Flights agree exactly**: 15,729 FY25-26 departures, counted as distinct
  (route, timestamp) pairs in the cost file.
- Revenue agrees to 1.4%, the difference being the 8,657 transactions whose
  dates are genuinely ambiguous (see below).

The cleaning the case data needs, all of it counted in
`scripts/normalize_firstbyte.py`:

| Problem | Scale | Treatment |
| --- | --- | --- |
| `Route_ID` spelling | 216 spellings for 54 routes | strip non-letters, split 3+3 |
| `Transaction_Type` / `Booking_Channel` case and aliases | 101,001 rows | mapped to canonical values |
| `Transaction_Date` in three formats, slash dates mixing DD/MM with MM/DD | 22,385 slash rows | resolved where one component exceeds 12; **8,748 left null and flagged**, never guessed |
| Duplicate transaction IDs | 1,856 | collapsed to one row, preferring the copy with a resolvable date |
| Gate lease repeated on every route row | 112 rows, 34 gates | de-duplicated per (city, gate, year), then shared across the routes departing from it |
| Membership tier missing as `NONE`, `N/A`, blank | 8,390 | kept as Unknown rather than folded into Non-Member |

### What is assumption, not measurement

Stated in the tool itself, not just here: ρ, the fare elasticity and the 4.7%
sustainable target are assumptions; no price response is measurable because the
data has no price variation; aircraft leases are absent and unmodelled; one
ticket is treated as one passenger, and with no seat counts load factor is never
shown — fill is tickets per flight against the break-even count. The results are
scenarios, not forecasts, and nothing in them establishes causation.


## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

> **If the page loads but nothing on it works**, the production server is serving
> HTML that points at JavaScript chunks a later `npm run build` has already
> replaced, and the browser gets a 404 for them. Rebuild and restart in that
> order (`pkill -f "vinext start"; npm run build && npm start`), then hard-reload
> the browser. `npm run dev` does not have this failure mode.


The page is the tool: no other views, no map, no server calls.

## Files

| Path | What it is |
| --- | --- |
| `app/page.tsx` | the shell — header plus the tool |
| `app/northbyte/model.ts` | the model from section 5 of the brief |
| `app/northbyte/ScenarioTool.tsx` | every screen from section 6 |
| `app/northbyte/NetworkMap.tsx` | the map, the aircraft and the month timeline |
| `app/data/northbyte-map.json` | projected outline, airports and flights per route per month |
| `app/data/northbyte.json` | the 54-route table, embedded at build time |
| `scripts/build_northbyte_json.py` | rebuilds that JSON from `route_model.csv` |
| `scripts/normalize_firstbyte.py` | cleans the three source workbooks, counting every repair |
| `scripts/verify_northbyte.ts` | the acceptance tests |
| `db/00_schema.sql`, `db/15_load_firstbyte.sql`, `db/50_firstbyte_checks.sql` | the independent Postgres load used to check the prepared table |

---

### Also in this repo

`db/01_reference.sql` through `db/40_export.sql` and the `scripts/fetch_*`,
`build_reference.py` and `normalize.py` files belong to an earlier, unrelated
model: a U.S.–Canada transborder route screen built from BTS T-100 and
Statistics Canada data. It is no longer part of the site. Kept only because it
runs; delete it if this repo should be the case tool and nothing else.
