-- Unit economics from an operating airline's own books.
--
-- The route model can rank markets but has no idea what flying one costs. These
-- views turn two fiscal years of a Canadian carrier's transactions, per-flight
-- costs and gate leases into transferable per-seat-mile benchmarks, which the
-- candidate scoring then applies by stage length.
--
-- The benchmark airline flies a different network (eastern and western Canadian
-- domestic) in a different period (2024-09 to 2026-08) and in Canadian dollars.
-- None of that is hidden: the transfer is by stage length and per seat, and the
-- currency conversion is a config value.

SET search_path = nb, public;
BEGIN;

INSERT INTO config (key, value) VALUES
    -- The benchmark airline's own fleet size is not in the data. Its implied
    -- aircraft size is backed out from passengers per departure at this load
    -- factor, which is what makes a per-seat cost possible at all.
    ('benchmark_load_factor', '0.80'),
    ('cad_to_usd',            '0.73')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- One row per flight. Every flight files exactly four cost rows, so the flight
-- key is the route plus the timestamp, not the cost id.
CREATE OR REPLACE VIEW v_fb_flight AS
SELECT origin, destination, cost_ts,
       sum(amount)                                          AS total_cost_cad,
       sum(amount) FILTER (WHERE cost_type = 'Fuel')        AS fuel_cad,
       sum(amount) FILTER (WHERE cost_type = 'Crew')        AS crew_cad,
       sum(amount) FILTER (WHERE cost_type = 'Maintenance') AS maintenance_cad,
       sum(amount) FILTER (WHERE cost_type = 'Food')        AS food_cad,
       count(*)                                             AS cost_rows
FROM fb_cost
GROUP BY 1, 2, 3;

-- Cost side of each directional route, with the stage length that explains it.
CREATE OR REPLACE VIEW v_fb_route_cost AS
SELECT f.origin, f.destination,
       gc_miles(o.latitude, o.longitude, d.latitude, d.longitude) AS distance_miles,
       count(*)                        AS flights,
       round(avg(f.total_cost_cad), 2) AS cost_per_flight_cad,
       round(avg(f.fuel_cad), 2)       AS fuel_per_flight_cad,
       round(avg(f.crew_cad), 2)       AS crew_per_flight_cad,
       round(avg(f.maintenance_cad), 2) AS maintenance_per_flight_cad,
       round(avg(f.food_cad), 2)       AS food_per_flight_cad
FROM v_fb_flight f
JOIN airport_geo o ON o.iata = f.origin
JOIN airport_geo d ON d.iata = f.destination
GROUP BY 1, 2, 3;

-- Revenue side. Refunds are negative amounts, so a plain sum is already net;
-- tickets are counted separately because they stand in for passengers.
CREATE OR REPLACE VIEW v_fb_route_revenue AS
SELECT origin, destination,
       count(*) FILTER (WHERE txn_type = 'Ticket')                   AS tickets,
       round(avg(amount) FILTER (WHERE txn_type = 'Ticket'), 2)      AS avg_fare_cad,
       sum(amount)                                                   AS net_revenue_cad,
       sum(amount) FILTER (WHERE txn_type = 'Ticket')                AS ticket_revenue_cad,
       sum(amount) FILTER (WHERE txn_type IN
            ('Extra Baggage', 'Seat Upgrade', 'Food & Onboard', 'Change Fee')) AS ancillary_cad,
       sum(amount) FILTER (WHERE txn_type = 'Refund')                AS refunds_cad
FROM fb_transaction
GROUP BY 1, 2;

-- Gate leases. annual_gate_cost repeats on every row for a gate, so the lease is
-- taken once per (city, gate, year) and then shared evenly across the routes
-- that depart from that gate. Unassigned gates keep their cost in the city total
-- but carry no route, which is why the two are computed separately.
CREATE OR REPLACE VIEW v_fb_gate_lease AS
SELECT DISTINCT city, gate_number, lease_year, annual_gate_cost
FROM fb_gate;

CREATE OR REPLACE VIEW v_fb_gate_route_cost AS
WITH routes_per_gate AS (
    SELECT city, gate_number, lease_year, count(*) AS routes
    FROM fb_gate
    WHERE origin IS NOT NULL
    GROUP BY 1, 2, 3
)
SELECT g.origin, g.destination, g.lease_year,
       round(l.annual_gate_cost / r.routes, 2) AS gate_cost_per_route_cad
FROM fb_gate g
JOIN v_fb_gate_lease l USING (city, gate_number, lease_year)
JOIN routes_per_gate r USING (city, gate_number, lease_year)
WHERE g.origin IS NOT NULL;

-- Everything the benchmark knows about one route, per flight and per seat.
CREATE OR REPLACE VIEW v_fb_route_economics AS
SELECT c.origin, c.destination, c.distance_miles, c.flights,
       c.cost_per_flight_cad, c.fuel_per_flight_cad, c.crew_per_flight_cad,
       c.maintenance_per_flight_cad, c.food_per_flight_cad,
       r.tickets, r.avg_fare_cad, r.net_revenue_cad,
       round(r.tickets::numeric / c.flights, 1)                     AS pax_per_flight,
       -- Seats are not published. Backing them out of passengers per departure
       -- at a reference load factor is the only way to express cost per seat.
       round(r.tickets::numeric / c.flights
             / cfg('benchmark_load_factor')::numeric)               AS implied_seats,
       round(r.net_revenue_cad / c.flights, 2)                      AS revenue_per_flight_cad,
       round(r.net_revenue_cad / c.flights - c.cost_per_flight_cad, 2) AS margin_per_flight_cad,
       round(coalesce(r.ancillary_cad, 0) / nullif(r.tickets, 0), 2) AS ancillary_per_ticket_cad,
       round(c.cost_per_flight_cad
             / (r.tickets::numeric / c.flights / cfg('benchmark_load_factor')::numeric)
             / c.distance_miles, 5)                                 AS cost_per_seat_mile_cad
FROM v_fb_route_cost c
JOIN v_fb_route_revenue r USING (origin, destination);

-- The transferable model: one row, fitted across the benchmark's routes.
-- Cost is regressed on stage length per seat, so applying it to a 76-seat
-- regional jet does not inherit the benchmark fleet's aircraft size.
CREATE OR REPLACE VIEW v_unit_benchmark AS
SELECT
    count(*)                                                    AS routes_observed,
    sum(flights)                                                AS flights_observed,
    sum(tickets)                                                AS tickets_observed,
    -- Cost per seat: intercept is the cost of turning an aircraft at all,
    -- slope is the mileage-driven part.
    round(regr_intercept(cost_per_flight_cad / implied_seats, distance_miles)::numeric, 4)
                                                                AS seat_cost_fixed_cad,
    round(regr_slope(cost_per_flight_cad / implied_seats, distance_miles)::numeric, 6)
                                                                AS seat_cost_per_mile_cad,
    round(regr_r2(cost_per_flight_cad / implied_seats, distance_miles)::numeric, 3)
                                                                AS seat_cost_r2,
    round(regr_intercept(avg_fare_cad, distance_miles)::numeric, 2) AS fare_fixed_cad,
    round(regr_slope(avg_fare_cad, distance_miles)::numeric, 4)     AS fare_per_mile_cad,
    round(regr_r2(avg_fare_cad, distance_miles)::numeric, 3)        AS fare_r2,
    round(sum(ancillary_per_ticket_cad * tickets) / sum(tickets), 2) AS ancillary_per_ticket_cad,
    round(avg(implied_seats))                                   AS benchmark_seats,
    round(avg(cost_per_seat_mile_cad), 5)                       AS avg_cost_per_seat_mile_cad,
    (SELECT round(avg(gate_cost_per_route_cad), 2) FROM v_fb_gate_route_cost)
                                                                AS gate_cost_per_route_cad
FROM v_fb_route_economics;

COMMIT;
