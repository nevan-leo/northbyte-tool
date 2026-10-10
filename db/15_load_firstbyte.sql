-- Load the operating benchmark: airport geography plus one airline's own
-- transactions, per-flight costs and gate leases.
--   psql -d northbound -f db/15_load_firstbyte.sql     (from the project root)

SET search_path = nb, public;
BEGIN;

TRUNCATE airport_geo, fb_transaction, fb_cost, fb_gate;

\copy airport_geo FROM 'data/staged/airport_geo.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE stg_txn (
    transaction_id text, booking_id text, txn_ts text, date_ambiguous text,
    origin text, destination text, txn_type text, tier text, channel text, amount text
) ON COMMIT DROP;
\copy stg_txn FROM 'data/staged/fb_transactions.csv' WITH (FORMAT csv, HEADER true)

-- 1,856 transaction IDs arrive twice, nearly all byte-identical: a double
-- export, not two real sales. Summing them would inflate revenue, so one row
-- per ID survives, preferring the copy whose date could be resolved.
INSERT INTO fb_transaction (transaction_id, booking_id, txn_ts, date_ambiguous,
                            origin, destination, txn_type, tier, channel, amount)
SELECT DISTINCT ON (transaction_id)
       transaction_id, booking_id,
       nullif(txn_ts, '')::timestamp, date_ambiguous::boolean,
       origin::char(3), destination::char(3), txn_type, tier, channel, amount::numeric
FROM stg_txn
ORDER BY transaction_id, date_ambiguous, txn_ts;

CREATE TEMP TABLE stg_cost (
    cost_id text, cost_ts text, cost_type text, origin text, destination text,
    from_city text, to_city text, amount text
) ON COMMIT DROP;
\copy stg_cost FROM 'data/staged/fb_costs.csv' WITH (FORMAT csv, HEADER true)

INSERT INTO fb_cost
SELECT DISTINCT ON (cost_id)
       cost_id, cost_ts::timestamp, cost_type, origin::char(3), destination::char(3),
       from_city, to_city, amount::numeric
FROM stg_cost
ORDER BY cost_id;

CREATE TEMP TABLE stg_gate (
    city text, gate_number text, origin text, destination text,
    lease_year text, annual_gate_cost text
) ON COMMIT DROP;
\copy stg_gate FROM 'data/staged/fb_gates.csv' WITH (FORMAT csv, HEADER true)

INSERT INTO fb_gate
SELECT city, gate_number, nullif(origin, '')::char(3), nullif(destination, '')::char(3),
       lease_year, annual_gate_cost::numeric
FROM stg_gate;

\echo 'Loaded operating benchmark (duplicate ids collapsed):'
SELECT (SELECT count(*) FROM stg_txn) - (SELECT count(*) FROM fb_transaction) AS txn_duplicates_dropped,
       (SELECT count(*) FROM stg_cost) - (SELECT count(*) FROM fb_cost)       AS cost_duplicates_dropped,
       (SELECT count(*) FROM fb_transaction)                              AS transactions,
       (SELECT count(*) FROM fb_transaction WHERE date_ambiguous)         AS undated,
       (SELECT count(*) FROM fb_cost)                                     AS cost_rows,
       (SELECT count(*) FROM fb_gate)                                     AS gate_rows,
       (SELECT count(*) FROM airport_geo)                                 AS airports;

COMMIT;

ANALYZE fb_transaction;
ANALYZE fb_cost;
