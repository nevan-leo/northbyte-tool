# Northbound Route Lab

A transborder route-opportunity screening model for **western Canada to the U.S.
West**. PostgreSQL does the analysis; the Next.js app is a front end for the
result and a simulator for the assumptions behind it.

The question it answers: **given public aviation data, which unserved
Canada–U.S. market should the airline launch next, and what has to be true for
that route to work?**

Scope lives in `scripts/scope.json`: origins in British Columbia and Alberta
(hubs YVR, YYC, YEG), destinations across the thirteen western U.S. states.
Reference year **2018** — see *Data* below for why.

## How it fits together

```
data/raw/          source extracts (BTS T-100, Statistics Canada O&D)
   │  scripts/normalize.py      column mapping, type cleaning, row rejection
data/staged/       normalised CSVs
   │  db/10_load.sql            \copy into fact tables, de-duplicated
PostgreSQL (schema nb)
   │  db/20_views.sql           undirected markets, supply vs demand, candidates
   │  db/30_scoring.sql         normalised components, weighted opportunity score
   │  db/40_export.sql          one JSON document
app/data/routes.json
   │  app/page.tsx              rankings, map, simulator, methodology
```

Nothing in the interface is hardcoded. Every figure on screen is a column in
`db/40_export.sql`; to change what the app says, change the query and re-export.

## Running it

```bash
brew install postgresql@17
LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@17 start
scripts/db.sh fetch    # ~14 MB of public source files into data/raw/
scripts/db.sh all      # schema, reference, load, model, export
npm run dev
```

`scripts/db.sh` also takes `init`, `stage`, `load`, `model`, `export`, and `psql`
individually.

### Data

All three sources are public and downloaded by `scripts/fetch_sources.sh`:

| Source | What it measures | Rows in scope |
| --- | --- | --- |
| BTS T-100 International Segment (All Carriers), 2018 | operated nonstop capacity, every carrier | 1,862 |
| Statistics Canada 23-10-0256 | transborder O&D by city pair, outbound plus inbound | 130 |
| OurAirports | airport coordinates, city, region | 372 airports |

TranStats has no plain file URL — the download is an ASP.NET postback on its
field-selection page — so `scripts/fetch_bts.py` reproduces that form submission
and checks the filename BTS serves back to confirm it returned the table asked
for.

**Why 2018.** Statistics Canada discontinued the transborder O&D series after
2018. Using newer capacity against 2018 demand would mix vintages, so the whole
model is pinned to 2018 through `config.reference_year`. It is also the last
clean pre-pandemic year, which suits a structural screening question.

**Cities versus airports.** StatCan publishes by city, BTS by airport, so
`scripts/build_reference.py` builds a `city_airport` bridge from OurAirports and
gives a city's traffic to its largest scheduled airport. Pairs that cannot be
resolved are counted and reported, never guessed at.

**Fares are modelled, not observed.** The demand source publishes no fare, so
fare is a base plus a per-mile rate from `config`, flagged as modelled in the
export and labelled as such in the interface. Revenue figures are an
illustration; break-even capture, which needs no fare, is the real economic test.

`data/sample/` still holds synthetic files shaped like the real ones, so the
pipeline runs without network access: `SOURCE_DIR=data/sample scripts/db.sh all`.

## What the model does, and does not, claim

The opportunity score is a **screening rank**, not a profit forecast. Each
component is min-max normalised across the candidate set, so a score says
"better than the other candidates", nothing more.

Decisions worth defending, all of them enforced in SQL rather than in prose:

- **Demand and capacity are different tables.** T-100 counts seats an airline
  chose to fly; O&D counts people who wanted to travel, including everyone
  connecting today. Conflating them makes an unserved market look like no market.
- **Markets are undirected.** `market_key()` collapses YVR→AUS and AUS→YVR into
  one row, so a route cannot be double counted or rank twice.
- **Capacity is doubled against demand.** A weekly frequency flies both
  directions and market demand counts both directions; comparing one-way seats to
  two-way demand halves every load factor.
- **One vintage at a time.** `config.reference_year` pins the analysis year, and
  growth explicitly joins the prior year rather than mixing sources of different ages.
- **Screens before scoring.** Markets under `min_stage_miles` (people drive) or
  `min_market_demand` (too thin for mainline) never reach the ranking.
- **Confidence travels with the data.** Thinly sampled city pairs carry a lower
  confidence, which feeds the market-quality component instead of being ignored.
- **Weights are data.** `nb.score_weights` is a table, so sensitivity testing is
  an `UPDATE` and a re-run, not an edit to a query.

## What the data actually says

Almost every large western market is already flown nonstop: YVR–LAX carries
810K annual O&D passengers against 1.05M seats. What survives screening is thin.
Only YEG–SAN (26K passengers, no nonstop in 2018) clears an 80% load target at
E175 frequencies; the rest need a break-even capture above 100%, meaning no
schedule wins enough of the market to fill the aircraft.

That is the finding, not a failure of the model: the U.S. West is well served
from Canada, and what is left is seasonal, regional-jet sized, or not a route at
all. The simulator exists to let someone challenge that conclusion by changing
the aircraft, frequency, and capture assumptions and watching it hold or break.

Known limitations: fares are averages rather than a fare-class mix, no cost or
crew-base model, no slot or gate constraints, no seasonality in the launch
decision, and connecting-passenger flows are inferred from O&D minus nonstop
capacity rather than measured itinerary by itinerary.
