-- Export the scored candidate set as one JSON document for the web app.
--   psql -At -d northbound -f db/40_export.sql > app/data/routes.json
--
-- The app renders whatever this produces. Numbers in the interface exist here
-- first, so a claim on screen can always be traced back to a query.

SET search_path = nb, public;

SELECT jsonb_pretty(jsonb_build_object(
    'generatedAt',   to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'referenceYear', cfg('reference_year')::int,
    'dataset', jsonb_build_object(
        't100Rows',      (SELECT count(*) FROM t100_segment),
        'odRows',        (SELECT count(*) FROM od_demand),
        'airports',      (SELECT count(*) FROM airports),
        'marketsScreened', (SELECT count(*) FROM v_market),
        'sources',       (SELECT to_jsonb(array_agg(DISTINCT source ORDER BY source))
                            FROM od_demand)
    ),
    'assumptions', jsonb_build_object(
        'baseAircraft',   cfg('base_aircraft'),
        'baseFrequency',  cfg('base_frequency')::int,
        'baseLoadFactor', cfg('base_load_factor')::int,
        'minMarketDemand', cfg('min_market_demand')::int,
        'minStageMiles',   cfg('min_stage_miles')::int,
        'nonstopSeatFloor', cfg('nonstop_seat_floor')::int
    ),
    'weights',  (SELECT jsonb_object_agg(component, weight) FROM score_weights),
    'aircraft', (SELECT jsonb_object_agg(aircraft_type,
                        jsonb_build_object('seats', seats, 'range', range_miles))
                   FROM aircraft),
    'routes', (
        SELECT coalesce(jsonb_agg(r ORDER BY r->>'rank'), '[]'::jsonb) FROM (
            SELECT jsonb_build_object(
                'rank',            lpad((row_number() OVER (ORDER BY opportunity_score DESC,
                                                            demand_pax DESC))::text, 2, '0'),
                'code',            origin || ' → ' || destination,
                'originCode',      origin,
                'destinationCode', destination,
                'origin',          jsonb_build_array(origin_lon::float8, origin_lat::float8),
                'destination',     jsonb_build_array(destination_lon::float8, destination_lat::float8),
                'city',            origin_city || ' to ' || destination_city,
                'demand',          demand_pax,
                'fare',            avg_fare_usd::float8,
                'growth',          coalesce(growth_pct, 0)::float8,
                'competitors',     dest_canada_carriers,
                'distance',        distance_miles::int,
                'confidence',      confidence,
                'score',           opportunity_score,
                'breakeven',       breakeven_capture_pct::float8,
                'components',      jsonb_build_object(
                                      'demand',        round(c_demand, 3)::float8,
                                      'supplyGap',     round(c_supply_gap, 3)::float8,
                                      'economics',     round(c_economics, 3)::float8,
                                      'marketQuality', round(c_market_quality, 3)::float8)
            ) AS r
            FROM v_opportunity
            ORDER BY opportunity_score DESC, demand_pax DESC
            LIMIT 12
        ) ranked
    )
));
