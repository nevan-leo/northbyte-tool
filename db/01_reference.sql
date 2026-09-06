-- Reference data: airports, aircraft, scoring weights, run configuration.
--
-- Airports are NOT typed out here. scripts/build_reference.py filters the
-- OurAirports public-domain dataset down to the study area defined in
-- scripts/scope.json and writes data/staged/airports.csv, which this loads.
-- The study area is therefore changed in one file, not in a SQL literal.

SET search_path = nb, public;
BEGIN;

INSERT INTO config (key, value) VALUES
    -- Statistics Canada discontinued the transborder O&D series after 2018, so
    -- 2018 is the newest year where demand and capacity can share a vintage.
    ('reference_year',      '2018'),
    ('carrier_under_study', 'AC'),
    -- A market only counts as "served nonstop" above a token amount of annual
    -- capacity; a handful of charter or diverted flights is not scheduled service.
    ('nonstop_seat_floor',  '5000'),
    -- Floor for a market to be worth screening at all. The western candidate
    -- set is small and thin, so this sits at the level Statistics Canada
    -- publishes rather than at a mainline-sized threshold; whether a market can
    -- actually carry an aircraft is then decided by break-even capture, not by
    -- a cutoff chosen in advance.
    ('min_market_demand',   '4000'),
    -- Under this stage length people drive, so nonstop air demand is not real
    -- demand for a mainline aircraft.
    ('min_stage_miles',     '300'),
    -- Statistics Canada publishes passenger counts but no fares, so fare is a
    -- MODELLED input, not an observation: a base plus a per-mile rate. Anything
    -- derived from it (revenue) is an illustration, not a measurement.
    ('fare_base_usd',       '95'),
    ('fare_per_mile_usd',   '0.115')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE TEMP TABLE stg_airports (
    iata text, name text, city text, region text, country text,
    latitude text, longitude text, is_hub text
) ON COMMIT DROP;

\copy stg_airports FROM 'data/staged/airports.csv' WITH (FORMAT csv, HEADER true)

TRUNCATE airports CASCADE;
INSERT INTO airports (iata, name, city, region, country, latitude, longitude, is_hub)
SELECT iata, name, city, region, country,
       latitude::numeric, longitude::numeric, is_hub::boolean
FROM stg_airports;

INSERT INTO carriers (carrier_code, carrier_name, country) VALUES
    ('AC','Air Canada','CA'),
    ('WS','WestJet','CA'),
    ('AA','American Airlines','US'),
    ('UA','United Airlines','US'),
    ('DL','Delta Air Lines','US'),
    ('WN','Southwest Airlines','US'),
    ('AS','Alaska Airlines','US')
ON CONFLICT (carrier_code) DO NOTHING;

-- Seat counts are Air Canada mainline configurations; range is practical
-- still-air range with a full payload, which is what constrains a route.
-- Western transborder candidates are thin, so the regional fleet matters more
-- than the mainline one: an E175 at 3x weekly is the realistic launch shape.
INSERT INTO aircraft (aircraft_type, seats, range_miles) VALUES
    ('CRJ-900',    76, 1550),
    ('E175',       76, 2150),
    ('A220-300',  137, 3450),
    ('737 MAX 8', 169, 3550),
    ('A321XLR',   182, 4700)
ON CONFLICT (aircraft_type) DO UPDATE
    SET seats = EXCLUDED.seats, range_miles = EXCLUDED.range_miles;

-- Weights must sum to 1. Checked by 30_scoring.sql before scoring runs.
INSERT INTO score_weights (component, weight) VALUES
    ('demand',         0.35),
    ('supply_gap',     0.20),
    ('economics',      0.25),
    ('market_quality', 0.20)
ON CONFLICT (component) DO UPDATE SET weight = EXCLUDED.weight;

COMMIT;
