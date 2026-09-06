-- Analysis layer: collapse directional source rows into undirected markets,
-- separate demand from supply, and expose the candidate set.

SET search_path = nb, public;
BEGIN;

-- Great-circle distance in statute miles. T-100 publishes a distance, but a
-- candidate route has no T-100 rows by definition, so distance has to come
-- from the coordinates.
CREATE OR REPLACE FUNCTION gc_miles(
    lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT round((3958.7613 * 2 * asin(sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        power(sin(radians(lon2 - lon1) / 2), 2)
    )))::numeric, 0);
$$;

CREATE OR REPLACE FUNCTION cfg(k text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT value FROM nb.config WHERE key = k;
$$;

-- Canonical undirected market key. YVR-AUS and AUS-YVR are one market.
CREATE OR REPLACE FUNCTION market_key(a char(3), b char(3))
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT least(a, b) || '-' || greatest(a, b);
$$;

-- ------------------------------------------------------- supply (capacity) --

-- Annual operated nonstop capacity per market, for the reference year.
-- This is what airlines FLEW, not what travellers wanted.
CREATE OR REPLACE VIEW v_supply AS
SELECT
    market_key(origin, destination)          AS market,
    sum(seats)                               AS annual_seats,
    sum(passengers)                          AS annual_segment_pax,
    sum(departures_performed)                AS annual_departures,
    count(DISTINCT carrier_code)             AS carriers,
    count(DISTINCT carrier_code) FILTER (
        WHERE carrier_code = cfg('carrier_under_study'))  AS incumbent_is_self
FROM t100_segment
WHERE year = cfg('reference_year')::smallint
GROUP BY 1;

-- ---------------------------------------------------------------- demand --

-- True O&D demand per market: both directions summed, fare weighted by the
-- passengers it applies to, confidence taken from the weakest contributing row.
CREATE OR REPLACE VIEW v_demand AS
SELECT
    market_key(origin, destination)                       AS market,
    year,
    sum(passengers)                                       AS pax,
    round(sum(avg_fare_usd * passengers)
          / nullif(sum(passengers), 0), 2)                AS avg_fare_usd,
    min(confidence)                                       AS confidence,
    string_agg(DISTINCT source, '+' ORDER BY source)      AS sources
FROM od_demand
GROUP BY 1, 2;

-- Year-over-year growth, using the reference year and the one before it.
CREATE OR REPLACE VIEW v_demand_current AS
SELECT
    cur.market,
    cur.pax,
    cur.avg_fare_usd,
    cur.confidence,
    cur.sources,
    prior.pax                                             AS prior_pax,
    CASE WHEN prior.pax > 0
         THEN round(100.0 * (cur.pax - prior.pax) / prior.pax, 1)
    END                                                   AS growth_pct
FROM v_demand cur
LEFT JOIN v_demand prior
       ON prior.market = cur.market
      AND prior.year   = cur.year - 1
WHERE cur.year = cfg('reference_year')::smallint;

-- ---------------------------------------------------------------- markets --

-- Every Canada<->U.S. market we have demand for, with both endpoints resolved
-- and supply attached. Orientation is forced to Canadian origin so the app can
-- speak in "hub -> destination" terms even though the market itself is undirected.
CREATE OR REPLACE VIEW v_market AS
WITH pair AS (
    SELECT
        d.market,
        split_part(d.market, '-', 1)::char(3) AS a,
        split_part(d.market, '-', 2)::char(3) AS b,
        d.pax, d.avg_fare_usd, d.confidence, d.sources, d.growth_pct
    FROM v_demand_current d
)
SELECT
    p.market,
    ca.iata                       AS origin,
    us.iata                       AS destination,
    ca.city                       AS origin_city,
    us.city                       AS destination_city,
    ca.latitude                   AS origin_lat,
    ca.longitude                  AS origin_lon,
    us.latitude                   AS destination_lat,
    us.longitude                  AS destination_lon,
    ca.is_hub                     AS origin_is_hub,
    p.pax                         AS demand_pax,
    -- Statistics Canada publishes no fare, so fall back to the modelled fare
    -- curve and flag it, rather than presenting an assumption as an observation.
    coalesce(p.avg_fare_usd,
             round(cfg('fare_base_usd')::numeric
                   + cfg('fare_per_mile_usd')::numeric
                     * gc_miles(ca.latitude, ca.longitude, us.latitude, us.longitude), 2)
    )                             AS avg_fare_usd,
    p.avg_fare_usd IS NULL        AS fare_is_modelled,
    p.growth_pct,
    p.confidence,
    p.sources,
    gc_miles(ca.latitude, ca.longitude, us.latitude, us.longitude) AS distance_miles,
    coalesce(s.annual_seats, 0)   AS nonstop_seats,
    coalesce(s.carriers, 0)       AS nonstop_carriers,
    coalesce(s.annual_seats, 0) >= cfg('nonstop_seat_floor')::int AS has_nonstop
FROM pair p
JOIN airports ca ON ca.iata IN (p.a, p.b) AND ca.country = 'CA'
JOIN airports us ON us.iata IN (p.a, p.b) AND us.country = 'US'
LEFT JOIN v_supply s ON s.market = p.market;

-- Candidate set: an unserved market from a hub we actually fly from, big enough
-- to matter, and reachable by at least one aircraft in the fleet.
CREATE OR REPLACE VIEW v_candidate AS
SELECT m.*,
       (SELECT min(a.range_miles) FROM aircraft a
         WHERE a.range_miles >= m.distance_miles) AS min_capable_range
FROM v_market m
WHERE m.origin_is_hub
  AND NOT m.has_nonstop
  AND m.demand_pax >= cfg('min_market_demand')::int
  AND m.distance_miles >= cfg('min_stage_miles')::int
  AND EXISTS (SELECT 1 FROM aircraft a WHERE a.range_miles >= m.distance_miles);

COMMIT;
