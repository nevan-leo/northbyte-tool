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

## The map

The opening frame is the network as it is flown: one arc per route, with line
weight and a population of aircraft in proportion to flights per month. Scrub the
timeline and the traffic thins — Jul 2025 carried 1,478 flights in the month, the
recommended plan carries 907, a 39% cut.

The 24 months on that timeline are **real**, counted from the cost file as
distinct (route, departure timestamp) pairs; only the step marked *Plan* is a
scenario, and the legend says so. Everything is plain SVG at coordinates
projected in `scripts/build_map_data.py` (Lambert conformal conic, the standard
projection for Canada, from the public-domain Natural Earth 110m outline), so the
frame can be pasted into a design tool as vectors rather than a raster map, and
no tiles are fetched at runtime.

```bash
scripts/build_map_data.py    # regenerates app/data/northbyte-map.json
```

Aircraft drift along the arcs; `prefers-reduced-motion` holds them still, and the
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
