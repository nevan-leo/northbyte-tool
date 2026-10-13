-- Independent checks on the prepared NorthByte route table.
--
-- app/data/northbyte.json is built from route_model.csv, which arrived already
-- aggregated. These queries rebuild the same figures from the raw workbooks so
-- the tool is not trusting someone else's arithmetic.
--
--   psql -d northbound -f db/50_firstbyte_checks.sql

SET search_path = nb, public;

\echo 'FY25-26 flights (distinct route + departure timestamp in the cost file):'
\echo '  expected 15,729'
SELECT count(*) AS flights
FROM (SELECT DISTINCT origin, destination, cost_ts
        FROM fb_cost
       WHERE cost_ts >= '2025-09-01' AND cost_ts < '2026-09-01') f;

\echo 'FY25-26 revenue by component, excluding the undated rows:'
\echo '  the prepared table reads 189.64M; the gap is the ambiguous-date rows'
SELECT round(sum(amount) FILTER (WHERE txn_type = 'Ticket') / 1e6, 2)  AS ticket_rev_m,
       round(sum(amount) FILTER (WHERE txn_type IN
             ('Extra Baggage', 'Seat Upgrade', 'Food & Onboard', 'Change Fee')) / 1e6, 2)
                                                                       AS ancillary_m,
       round(sum(amount) FILTER (WHERE txn_type = 'Refund') / 1e6, 2)  AS refunds_m,
       round(sum(amount) / 1e6, 2)                                     AS net_m,
       count(*) FILTER (WHERE date_ambiguous)                          AS undated_rows_excluded
FROM fb_transaction
WHERE txn_ts >= '2025-09-01' AND txn_ts < '2026-09-01';

\echo 'Gate leases: each lease counted once per gate and year, not once per route:'
SELECT lease_year,
       count(*)                      AS gates,
       round(sum(annual_gate_cost))  AS total_lease_cad
FROM (SELECT DISTINCT city, gate_number, lease_year, annual_gate_cost FROM fb_gate) g
GROUP BY 1 ORDER BY 1;

\echo 'Expansion check: flights and revenue, pre-expansion half vs FY25-26:'
SELECT 'flights Sep24-Feb25' AS window,
       (SELECT count(*) FROM (SELECT DISTINCT origin, destination, cost_ts FROM fb_cost
                               WHERE cost_ts >= '2024-09-01' AND cost_ts < '2025-03-01') a) AS value
UNION ALL
SELECT 'flights Sep25-Aug26',
       (SELECT count(*) FROM (SELECT DISTINCT origin, destination, cost_ts FROM fb_cost
                               WHERE cost_ts >= '2025-09-01' AND cost_ts < '2026-09-01') b);

\echo 'Year over year, FY24-25 against FY25-26. These rates drive the "do nothing"'
\echo 'projection in the tool, and are what makes doing nothing cost money:'
WITH flights AS (
  SELECT CASE WHEN cost_ts >= '2024-09-01' AND cost_ts < '2025-09-01' THEN 'FY24-25'
              WHEN cost_ts >= '2025-09-01' AND cost_ts < '2026-09-01' THEN 'FY25-26' END AS fy,
         origin, destination, cost_ts, sum(amount) AS flight_cost
    FROM fb_cost GROUP BY 1, 2, 3, 4),
cost AS (
  SELECT fy, count(*) AS flights, sum(flight_cost) AS total, avg(flight_cost) AS per_flight
    FROM flights WHERE fy IS NOT NULL GROUP BY 1),
revenue AS (
  SELECT CASE WHEN txn_ts >= '2024-09-01' AND txn_ts < '2025-09-01' THEN 'FY24-25'
              WHEN txn_ts >= '2025-09-01' AND txn_ts < '2026-09-01' THEN 'FY25-26' END AS fy,
         sum(amount) AS net, avg(amount) FILTER (WHERE txn_type = 'Ticket') AS fare
    FROM fb_transaction WHERE txn_ts IS NOT NULL GROUP BY 1)
SELECT c.fy, c.flights, round(c.total / 1e6, 2) AS cost_m, round(c.per_flight) AS cost_per_flight,
       round(r.net / 1e6, 2) AS net_rev_m, round(r.fare, 2) AS avg_fare
FROM cost c JOIN revenue r USING (fy) WHERE c.fy IS NOT NULL ORDER BY 1;
