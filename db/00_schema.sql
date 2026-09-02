-- Northbound Route Lab: analytical schema
-- Target: PostgreSQL 15+
--
-- Design notes
--   * Every fact table carries an explicit reference year. Vintages are never
--     silently mixed: analysis views pin a single year via config.reference_year.
--   * Airport pairs are stored directionally in the fact tables (that is how the
--     sources publish them) and collapsed to a canonical undirected market key
--     (least, greatest) in the views, so YVR-AUS and AUS-YVR never double count.
--   * Capacity (T-100) and demand (O&D) are kept in separate tables because they
--     measure different things: seats flown on a nonstop segment vs. people who
--     actually want to travel between two cities by any routing.

BEGIN;

DROP SCHEMA IF EXISTS nb CASCADE;
CREATE SCHEMA nb;
SET search_path = nb, public;

-- ---------------------------------------------------------------- reference --

CREATE TABLE config (
    key   text PRIMARY KEY,
    value text NOT NULL
);

CREATE TABLE airports (
    iata         char(3) PRIMARY KEY,
    icao         char(4),
    name         text    NOT NULL,
    city         text    NOT NULL,
    region       text,                       -- state / province code
    country      char(2) NOT NULL,           -- ISO-3166 alpha-2
    latitude     numeric(8,5)  NOT NULL,
    longitude    numeric(8,5)  NOT NULL,
    is_hub       boolean NOT NULL DEFAULT false,   -- carrier hub under study
    CONSTRAINT airports_lat_range CHECK (latitude  BETWEEN  -90 AND  90),
    CONSTRAINT airports_lon_range CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX airports_country_idx ON airports (country);

CREATE TABLE carriers (
    carrier_code text PRIMARY KEY,
    carrier_name text NOT NULL,
    country      char(2)
);

CREATE TABLE aircraft (
    aircraft_type text PRIMARY KEY,
    seats         integer NOT NULL CHECK (seats > 0),
    range_miles   integer NOT NULL CHECK (range_miles > 0)
);

-- ------------------------------------------------------------------- facts --

-- BTS T-100 Segment (All Carriers). One row per carrier / segment / month.
-- Measures OPERATED CAPACITY, not demand.
CREATE TABLE t100_segment (
    id                   bigserial PRIMARY KEY,
    year                 smallint NOT NULL,
    month                smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    carrier_code         text     NOT NULL,
    origin               char(3)  NOT NULL,
    destination          char(3)  NOT NULL,
    passengers           integer  NOT NULL CHECK (passengers >= 0),
    seats                integer  NOT NULL CHECK (seats >= 0),
    departures_performed integer  NOT NULL CHECK (departures_performed >= 0),
    distance_miles       integer  NOT NULL CHECK (distance_miles > 0),
    CONSTRAINT t100_not_self CHECK (origin <> destination),
    CONSTRAINT t100_unique UNIQUE (year, month, carrier_code, origin, destination)
);

CREATE INDEX t100_pair_idx ON t100_segment (origin, destination, year);
CREATE INDEX t100_year_idx ON t100_segment (year);

-- True origin-and-destination demand by city pair (Statistics Canada ITS /
-- BTS DB1B). Counts a passenger once for the journey they actually took,
-- including connections. Directional as published.
CREATE TABLE od_demand (
    id              bigserial PRIMARY KEY,
    year            smallint NOT NULL,
    origin          char(3)  NOT NULL,
    destination     char(3)  NOT NULL,
    passengers      integer  NOT NULL CHECK (passengers >= 0),
    avg_fare_usd    numeric(8,2) CHECK (avg_fare_usd >= 0),
    source          text     NOT NULL,   -- 'statcan' | 'db1b'
    -- How much we trust this row: survey-sampled sources are weaker than
    -- census-style ones, and small city pairs are suppressed or rounded.
    confidence      smallint NOT NULL DEFAULT 70 CHECK (confidence BETWEEN 0 AND 100),
    CONSTRAINT od_not_self CHECK (origin <> destination),
    CONSTRAINT od_unique UNIQUE (year, origin, destination, source)
);

CREATE INDEX od_pair_idx ON od_demand (origin, destination, year);

-- Tunable scoring weights, so the model is a row in a table rather than a
-- number buried in a query. Sensitivity testing = update these and re-run.
CREATE TABLE score_weights (
    component text PRIMARY KEY,
    weight    numeric(4,3) NOT NULL CHECK (weight BETWEEN 0 AND 1)
);

COMMIT;
