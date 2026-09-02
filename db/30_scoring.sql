-- Opportunity scoring. Deliberately a screening model, not a profit forecast.
--
-- Every component is min-max normalised across the candidate set, so a score is
-- a RANKING statement ("better than the other candidates"), never an absolute
-- claim about profitability. Weights live in nb.score_weights.

SET search_path = nb, public;
BEGIN;

INSERT INTO config (key, value) VALUES
    ('base_aircraft',    'A220-300'),
    ('base_frequency',   '4'),      -- flights per week, each way
    ('base_load_factor', '85')      -- percent
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Weights are a model input, so a typo in them should stop the run, not quietly
-- rescale every score.
DO $$
DECLARE total numeric;
BEGIN
    SELECT sum(weight) INTO total FROM score_weights;
    IF total IS NULL OR abs(total - 1) > 0.0001 THEN
        RAISE EXCEPTION 'score_weights must sum to 1.0, got %', total;
    END IF;
END $$;

-- How much nonstop capacity already exists from ANY Canadian airport to each
-- U.S. airport. A market is less distinctive if a rival already connects that
-- U.S. city to Canada from a different hub.
CREATE OR REPLACE VIEW v_dest_canada_supply AS
SELECT us.iata AS destination,
       sum(t.seats)                    AS canada_seats,
       count(DISTINCT t.carrier_code)  AS canada_carriers
FROM t100_segment t
JOIN airports ca ON ca.iata IN (t.origin, t.destination) AND ca.country = 'CA'
JOIN airports us ON us.iata IN (t.origin, t.destination) AND us.country = 'US'
WHERE t.year = cfg('reference_year')::smallint
GROUP BY 1;

CREATE OR REPLACE VIEW v_route_economics AS
SELECT
    c.market,
    c.origin,
    c.destination,
    c.demand_pax,
    c.avg_fare_usd,
    ac.aircraft_type,
    ac.seats,
    cfg('base_frequency')::int   AS weekly_frequency,
    cfg('base_load_factor')::int AS target_load_factor,
    -- A weekly frequency flies the route in both directions, and market demand
    -- counts both directions, so annual capacity is doubled to match.
    2 * ac.seats * cfg('base_frequency')::int * 52                AS annual_seats,
    round(2.0 * ac.seats * cfg('base_frequency')::int * 52
              * cfg('base_load_factor')::int / 100.0)             AS required_pax,
    -- Share of the market that must be captured just to hit the load target.
    round(100.0 * (2.0 * ac.seats * cfg('base_frequency')::int * 52
              * cfg('base_load_factor')::int / 100.0)
          / nullif(c.demand_pax, 0), 1)                           AS breakeven_capture_pct
FROM v_candidate c
CROSS JOIN aircraft ac
WHERE ac.aircraft_type = cfg('base_aircraft');

-- Normalise, weight, rank.
CREATE OR REPLACE VIEW v_opportunity AS
WITH base AS (
    SELECT
        c.*,
        e.breakeven_capture_pct,
        e.annual_seats,
        e.required_pax,
        coalesce(ds.canada_seats, 0)    AS dest_canada_seats,
        coalesce(ds.canada_carriers, 0) AS dest_canada_carriers,
        -- Distance comfort: full marks well inside the aircraft's range, tapering
        -- to zero at the limit, where payload restrictions start to bite.
        greatest(0, least(1, (c.min_capable_range - c.distance_miles)
                             / (0.25 * c.min_capable_range))) AS range_headroom
    FROM v_candidate c
    JOIN v_route_economics e ON e.market = c.market
    LEFT JOIN v_dest_canada_supply ds ON ds.destination = c.destination
),
bounds AS (
    SELECT
        min(demand_pax)            AS d_lo, max(demand_pax)            AS d_hi,
        min(dest_canada_seats)     AS s_lo, max(dest_canada_seats)     AS s_hi,
        min(breakeven_capture_pct) AS b_lo, max(breakeven_capture_pct) AS b_hi,
        min(coalesce(growth_pct,0))AS g_lo, max(coalesce(growth_pct,0))AS g_hi
    FROM base
),
-- norm() maps a value onto 0..1 against the candidate set, and returns 0.5 for a
-- degenerate range rather than dividing by zero.
scored AS (
    SELECT
        b.*,
        CASE WHEN x.d_hi = x.d_lo THEN 0.5
             ELSE (b.demand_pax - x.d_lo)::numeric / (x.d_hi - x.d_lo) END AS c_demand,
        CASE WHEN x.s_hi = x.s_lo THEN 0.5
             ELSE 1 - (b.dest_canada_seats - x.s_lo)::numeric / (x.s_hi - x.s_lo) END AS c_supply_gap,
        CASE WHEN x.b_hi = x.b_lo THEN 0.5
             ELSE 1 - (b.breakeven_capture_pct - x.b_lo) / (x.b_hi - x.b_lo) END AS c_economics,
        (
            0.5 * CASE WHEN x.g_hi = x.g_lo THEN 0.5
                       ELSE (coalesce(b.growth_pct,0) - x.g_lo) / (x.g_hi - x.g_lo) END
          + 0.3 * b.confidence / 100.0
          + 0.2 * b.range_headroom
        ) AS c_market_quality
    FROM base b CROSS JOIN bounds x
)
SELECT
    s.*,
    round(100 * (
        (SELECT weight FROM score_weights WHERE component = 'demand')         * s.c_demand
      + (SELECT weight FROM score_weights WHERE component = 'supply_gap')     * s.c_supply_gap
      + (SELECT weight FROM score_weights WHERE component = 'economics')      * s.c_economics
      + (SELECT weight FROM score_weights WHERE component = 'market_quality') * s.c_market_quality
    ), 0)::int AS opportunity_score
FROM scored s;

COMMIT;
