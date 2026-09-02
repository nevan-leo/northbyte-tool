# Northbound Route Lab

A U.S.–Canada transborder route-opportunity screening model. PostgreSQL does the
analysis; the Next.js app is a front end for the result and a simulator for the
assumptions behind it.

The question it answers: **given public aviation data, which unserved
Canada–U.S. market should the airline launch next, and what has to be true for
that route to work?**

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
pg_ctl -D /opt/homebrew/var/postgresql@17 start   # LC_ALL must be set; see scripts/db.sh
scripts/db.sh all      # schema, reference data, load, model, export
npm run dev
```

`scripts/db.sh` also takes `init`, `stage`, `load`, `model`, `export`, and `psql`
individually.

### Data

`scripts/db.sh` defaults to `data/sample/`, which `scripts/make_sample.py`
generates: **synthetic** files shaped exactly like the real extracts, so the
pipeline runs on a fresh clone. They are placeholders, not evidence.

To run on real data, download both extracts into `data/raw/` and point the runner
at them:

| Source | What it measures | Where |
| --- | --- | --- |
| BTS T-100 Segment (All Carriers) | operated nonstop capacity | transtats.bts.gov |
| Statistics Canada / BTS DB1B | true origin–destination demand | statcan.gc.ca |
| OurAirports | airport coordinates and metadata | ourairports.com |

```bash
SOURCE_DIR=data/raw scripts/db.sh all
```

`scripts/normalize.py` maps source column names onto the staging layout, so a
renamed column in a future vintage is a one-line edit to `ALIASES`.

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

Known limitations: fares are averages rather than a fare-class mix, no cost or
crew-base model, no slot or gate constraints, no seasonality in the launch
decision, and connecting-passenger flows are inferred from O&D minus nonstop
capacity rather than measured itinerary by itinerary.
