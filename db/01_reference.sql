-- Reference data: airports, aircraft, scoring weights, run configuration.
-- Airport coordinates and metadata originate from the OurAirports public domain
-- dataset; the subset below covers the Canadian hubs under study plus the U.S.
-- airports large enough to appear in transborder O&D.

SET search_path = nb, public;
BEGIN;

INSERT INTO config (key, value) VALUES
    ('reference_year',      '2024'),
    ('carrier_under_study', 'AC'),
    -- A market only counts as "served nonstop" above a token amount of annual
    -- capacity; a handful of charter or diverted flights is not scheduled service.
    ('nonstop_seat_floor',  '5000'),
    -- Demand below this is too thin for a mainline transborder launch.
    ('min_market_demand',   '30000'),
    -- Under this stage length people drive, so nonstop air demand is not real
    -- demand for a mainline aircraft (YYZ-BUF is 68 miles).
    ('min_stage_miles',     '300')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO airports (iata, name, city, region, country, latitude, longitude, is_hub) VALUES
    -- Canadian hubs
    ('YVR','Vancouver International','Vancouver','BC','CA',49.19400,-123.18400,true),
    ('YYZ','Toronto Pearson International','Toronto','ON','CA',43.67700,-79.63100,true),
    ('YUL','Montreal-Trudeau International','Montreal','QC','CA',45.47000,-73.74100,true),
    ('YYC','Calgary International','Calgary','AB','CA',51.11400,-114.02000,true),
    -- Other Canadian airports (origins we do not model as hubs)
    ('YOW','Ottawa Macdonald-Cartier','Ottawa','ON','CA',45.32300,-75.66900,false),
    ('YEG','Edmonton International','Edmonton','AB','CA',53.31000,-113.58000,false),
    ('YHZ','Halifax Stanfield International','Halifax','NS','CA',44.88100,-63.50900,false),
    ('YWG','Winnipeg Richardson International','Winnipeg','MB','CA',49.91000,-97.24000,false),
    -- U.S. mid-size candidates
    ('BNA','Nashville International','Nashville','TN','US',36.12600,-86.67800,false),
    ('AUS','Austin-Bergstrom International','Austin','TX','US',30.19700,-97.66600,false),
    ('SAT','San Antonio International','San Antonio','TX','US',29.53400,-98.46900,false),
    ('RDU','Raleigh-Durham International','Raleigh','NC','US',35.87800,-78.78800,false),
    ('PIT','Pittsburgh International','Pittsburgh','PA','US',40.49100,-80.23300,false),
    ('CMH','John Glenn Columbus International','Columbus','OH','US',39.99800,-82.89200,false),
    ('MSY','Louis Armstrong New Orleans Intl','New Orleans','LA','US',29.99300,-90.25800,false),
    ('IND','Indianapolis International','Indianapolis','IN','US',39.71700,-86.29400,false),
    ('MCI','Kansas City International','Kansas City','MO','US',39.29700,-94.71400,false),
    ('SLC','Salt Lake City International','Salt Lake City','UT','US',40.78800,-111.97800,false),
    ('CLE','Cleveland Hopkins International','Cleveland','OH','US',41.41200,-81.85000,false),
    ('MKE','Milwaukee Mitchell International','Milwaukee','WI','US',42.94700,-87.89700,false),
    ('OMA','Eppley Airfield','Omaha','NE','US',41.30300,-95.89400,false),
    ('BOI','Boise Air Terminal','Boise','ID','US',43.56400,-116.22300,false),
    ('TUS','Tucson International','Tucson','AZ','US',32.11600,-110.94100,false),
    ('ABQ','Albuquerque Sunport','Albuquerque','NM','US',35.04000,-106.60900,false),
    ('BHM','Birmingham-Shuttlesworth Intl','Birmingham','AL','US',33.56300,-86.75300,false),
    ('JAX','Jacksonville International','Jacksonville','FL','US',30.49400,-81.68800,false),
    ('MEM','Memphis International','Memphis','TN','US',35.04200,-89.97700,false),
    ('OKC','Will Rogers World','Oklahoma City','OK','US',35.39300,-97.60100,false),
    ('RIC','Richmond International','Richmond','VA','US',37.50500,-77.32000,false),
    ('SDF','Louisville Muhammad Ali Intl','Louisville','KY','US',38.17400,-85.73600,false),
    ('CHS','Charleston International','Charleston','SC','US',32.89900,-80.04100,false),
    ('SAV','Savannah/Hilton Head Intl','Savannah','GA','US',32.12800,-81.20200,false),
    ('GSP','Greenville-Spartanburg Intl','Greenville','SC','US',34.89600,-82.21900,false),
    ('PVD','Rhode Island T.F. Green Intl','Providence','RI','US',41.72600,-71.42800,false),
    ('ORF','Norfolk International','Norfolk','VA','US',36.89500,-76.20100,false),
    ('DSM','Des Moines International','Des Moines','IA','US',41.53400,-93.66300,false),
    ('GRR','Gerald R. Ford International','Grand Rapids','MI','US',42.88100,-85.52300,false),
    ('BUF','Buffalo Niagara International','Buffalo','NY','US',42.94100,-78.73200,false),
    -- U.S. large hubs (already served nonstop; needed so the supply join is honest)
    ('SFO','San Francisco International','San Francisco','CA','US',37.61900,-122.37500,false),
    ('LAX','Los Angeles International','Los Angeles','CA','US',33.94200,-118.40800,false),
    ('SEA','Seattle-Tacoma International','Seattle','WA','US',47.44900,-122.30900,false),
    ('ORD','Chicago O''Hare International','Chicago','IL','US',41.97900,-87.90400,false),
    ('JFK','John F. Kennedy International','New York','NY','US',40.64100,-73.77900,false),
    ('EWR','Newark Liberty International','Newark','NJ','US',40.69300,-74.16900,false),
    ('DEN','Denver International','Denver','CO','US',39.86200,-104.67300,false),
    ('DFW','Dallas/Fort Worth International','Dallas','TX','US',32.89700,-97.03800,false),
    ('IAH','George Bush Intercontinental','Houston','TX','US',29.99000,-95.33700,false),
    ('ATL','Hartsfield-Jackson Atlanta Intl','Atlanta','GA','US',33.64100,-84.42700,false),
    ('BOS','Boston Logan International','Boston','MA','US',42.36300,-71.00600,false),
    ('PHX','Phoenix Sky Harbor International','Phoenix','AZ','US',33.43400,-112.01200,false),
    ('LAS','Harry Reid International','Las Vegas','NV','US',36.08400,-115.15400,false),
    ('MCO','Orlando International','Orlando','FL','US',28.42900,-81.30900,false),
    ('MIA','Miami International','Miami','FL','US',25.79300,-80.29100,false),
    ('SAN','San Diego International','San Diego','CA','US',32.73400,-117.19000,false),
    ('DCA','Ronald Reagan Washington National','Washington','DC','US',38.85200,-77.03800,false),
    ('PHL','Philadelphia International','Philadelphia','PA','US',39.87200,-75.24100,false),
    ('MSP','Minneapolis-St Paul International','Minneapolis','MN','US',44.88200,-93.22200,false),
    ('DTW','Detroit Metropolitan Wayne County','Detroit','MI','US',42.21200,-83.35300,false)
ON CONFLICT (iata) DO NOTHING;

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
INSERT INTO aircraft (aircraft_type, seats, range_miles) VALUES
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
