-- Load staged CSVs into the fact tables.
--   psql -d northbound -f db/10_load.sql        (run from the project root)
--
-- Reads data/staged/*.csv, which scripts/normalize.py writes. psql's \copy does
-- not interpolate :'variables', so the paths are fixed and the staging directory
-- is the contract between the two steps.
--
-- Staging tables are all-text on purpose: a bad value should surface as a row we
-- can inspect and count, not as a COPY that aborts 400k rows in.

SET search_path = nb, public;
BEGIN;

CREATE TEMP TABLE stg_t100 (
    year text, month text, carrier_code text, origin text, destination text,
    passengers text, seats text, departures_performed text, distance_miles text
) ON COMMIT DROP;

CREATE TEMP TABLE stg_od (
    year text, origin text, destination text, passengers text,
    avg_fare_usd text, source text, confidence text
) ON COMMIT DROP;

\copy stg_t100 FROM 'data/staged/t100_segment.csv' WITH (FORMAT csv, HEADER true)
\copy stg_od   FROM 'data/staged/od_demand.csv'    WITH (FORMAT csv, HEADER true)

TRUNCATE t100_segment, od_demand;

-- The published file carries one row per carrier / segment / month / aircraft
-- type / service class, so the same segment appears several times. Sum them.
-- Rows for airports outside the reference set are dropped rather than silently
-- creating phantom markets; the count is reported below.
INSERT INTO t100_segment (year, month, carrier_code, origin, destination,
                          passengers, seats, departures_performed, distance_miles)
SELECT s.year::smallint, s.month::smallint, s.carrier_code,
       s.origin::char(3), s.destination::char(3),
       sum(s.passengers::int), sum(s.seats::int),
       sum(s.departures_performed::int), max(s.distance_miles::int)
FROM stg_t100 s
JOIN airports o ON o.iata = s.origin
JOIN airports d ON d.iata = s.destination
GROUP BY 1, 2, 3, 4, 5;

INSERT INTO od_demand (year, origin, destination, passengers, avg_fare_usd,
                       source, confidence)
SELECT s.year::smallint, s.origin::char(3), s.destination::char(3),
       sum(s.passengers::int),
       round(sum(s.avg_fare_usd::numeric * s.passengers::int)
             / nullif(sum(s.passengers::int), 0), 2),
       s.source,
       min(s.confidence::smallint)
FROM stg_od s
JOIN airports o ON o.iata = s.origin
JOIN airports d ON d.iata = s.destination
GROUP BY 1, 2, 3, 6;

\echo 'Rows rejected for unknown airport codes:'
SELECT (SELECT count(*) FROM stg_t100 s
         WHERE NOT EXISTS (SELECT 1 FROM airports a WHERE a.iata = s.origin)
            OR NOT EXISTS (SELECT 1 FROM airports a WHERE a.iata = s.destination)) AS t100_rejected,
       (SELECT count(*) FROM stg_od s
         WHERE NOT EXISTS (SELECT 1 FROM airports a WHERE a.iata = s.origin)
            OR NOT EXISTS (SELECT 1 FROM airports a WHERE a.iata = s.destination)) AS od_rejected;

COMMIT;

ANALYZE t100_segment;
ANALYZE od_demand;
