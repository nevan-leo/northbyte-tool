#!/usr/bin/env python3
"""Generate SYNTHETIC source-shaped CSVs so the pipeline is runnable end to end.

These files imitate the column layout of BTS T-100 Segment and a Statistics
Canada style O&D extract, but the numbers are fabricated. They exist so the SQL
can be developed and tested before the real extracts are downloaded; swap in the
real files and every query below stays exactly the same.
"""

import csv
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "sample"
OUT.mkdir(parents=True, exist_ok=True)

YEAR = 2024
RNG = random.Random(20240901)

# iata -> (lat, lon, market size index 0-1)
CA = {
    "YVR": (49.194, -123.184, 0.85), "YYZ": (43.677, -79.631, 1.00),
    "YUL": (45.470, -73.741, 0.72),  "YYC": (51.114, -114.020, 0.62),
    "YOW": (45.323, -75.669, 0.30),  "YEG": (53.310, -113.580, 0.28),
    "YHZ": (44.881, -63.509, 0.22),  "YWG": (49.910, -97.240, 0.20),
}

# Large U.S. airports Canadian hubs already fly to nonstop.
SERVED = {
    "SFO": (37.619, -122.375, 0.90), "LAX": (33.942, -118.408, 0.95),
    "SEA": (47.449, -122.309, 0.75), "ORD": (41.979, -87.904, 0.95),
    "JFK": (40.641, -73.779, 1.00),  "EWR": (40.693, -74.169, 0.80),
    "DEN": (39.862, -104.673, 0.70), "DFW": (32.897, -97.038, 0.80),
    "IAH": (29.990, -95.337, 0.70),  "ATL": (33.641, -84.427, 0.85),
    "BOS": (42.363, -71.006, 0.80),  "PHX": (33.434, -112.012, 0.75),
    "LAS": (36.084, -115.154, 0.85), "MCO": (28.429, -81.309, 0.85),
    "MIA": (25.793, -80.291, 0.85),  "SAN": (32.734, -117.190, 0.60),
    "DCA": (38.852, -77.038, 0.65),  "PHL": (39.872, -75.241, 0.55),
    "MSP": (44.882, -93.222, 0.55),  "DTW": (42.212, -83.353, 0.50),
}

# Mid-size U.S. airports with no Canadian nonstop from most hubs.
UNSERVED = {
    "BNA": (36.126, -86.678, 0.62), "AUS": (30.197, -97.666, 0.66),
    "SAT": (29.534, -98.469, 0.44), "RDU": (35.878, -78.788, 0.48),
    "PIT": (40.491, -80.233, 0.40), "CMH": (39.998, -82.892, 0.38),
    "MSY": (29.993, -90.258, 0.42), "IND": (39.717, -86.294, 0.36),
    "MCI": (39.297, -94.714, 0.38), "SLC": (40.788, -111.978, 0.50),
    "CLE": (41.412, -81.850, 0.34), "MKE": (42.947, -87.897, 0.30),
    "OMA": (41.303, -95.894, 0.24), "BOI": (43.564, -116.223, 0.26),
    "TUS": (32.116, -110.941, 0.26), "ABQ": (35.040, -106.609, 0.28),
    "BHM": (33.563, -86.753, 0.22), "JAX": (30.494, -81.688, 0.34),
    "MEM": (35.042, -89.977, 0.28), "OKC": (35.393, -97.601, 0.26),
    "RIC": (37.505, -77.320, 0.26), "SDF": (38.174, -85.736, 0.24),
    "CHS": (32.899, -80.041, 0.30), "SAV": (32.128, -81.202, 0.26),
    "GSP": (34.896, -82.219, 0.20), "PVD": (41.726, -71.428, 0.24),
    "ORF": (36.895, -76.201, 0.22), "DSM": (41.534, -93.663, 0.20),
    "GRR": (42.881, -85.523, 0.20), "BUF": (42.941, -78.732, 0.18),
}
US = {**SERVED, **UNSERVED}

# A few mid-size markets a competitor already serves from ONE hub. These stay in
# the data as real nonstop service so the supply-gap component has something to
# discriminate on.
EXISTING_MIDSIZE = [("YYZ", "BNA", "WS"), ("YYZ", "MCI", "AC"), ("YYC", "SLC", "DL")]

FLEET = [("AC", 137), ("WS", 174), ("UA", 128), ("AA", 128), ("DL", 130), ("AS", 124)]


def miles(a, b):
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return round(3958.7613 * 2 * math.asin(math.sqrt(h)))


def demand_for(ca_code, us_code):
    """Gravity-ish: both endpoints' size over a mild distance decay."""
    ca, us = CA[ca_code], US[us_code]
    d = max(miles(ca, us), 200)
    pull = ca[2] * us[2] * 5_500_000 / (d ** 0.55)
    return int(pull * RNG.uniform(0.75, 1.3))


def fare_for(dist):
    return round(118 + dist * 0.115 * RNG.uniform(0.85, 1.2), 2)


# ------------------------------------------------------------------ T-100 --
t100_header = [
    "DEPARTURES_PERFORMED", "SEATS", "PASSENGERS", "DISTANCE", "UNIQUE_CARRIER",
    "ORIGIN", "DEST", "YEAR", "MONTH",
]
t100_rows = []


def write_segment(carrier, origin, dest, seats_per_dep, deps_per_month, load):
    for month in range(1, 13):
        season = 1 + 0.18 * math.sin((month - 3) / 12 * 2 * math.pi)
        deps = max(1, round(deps_per_month * season))
        seats = deps * seats_per_dep
        pax = round(seats * load * RNG.uniform(0.94, 1.03))
        for o, d in ((origin, dest), (dest, origin)):
            t100_rows.append({
                "DEPARTURES_PERFORMED": deps, "SEATS": seats,
                "PASSENGERS": min(pax, seats), "DISTANCE": miles(CA[origin], US[dest]),
                "UNIQUE_CARRIER": carrier, "ORIGIN": o, "DEST": d,
                "YEAR": YEAR, "MONTH": month,
            })


for ca_code in CA:
    for us_code in SERVED:
        dist = miles(CA[ca_code], US[us_code])
        if dist > 3400:
            continue
        pull = CA[ca_code][2] * SERVED[us_code][2]
        if pull < 0.16:
            continue
        for carrier, seats in RNG.sample(FLEET, k=1 if pull < 0.4 else RNG.choice([1, 2])):
            write_segment(carrier, ca_code, us_code, seats,
                          deps_per_month=max(4, round(pull * 60)),
                          load=RNG.uniform(0.78, 0.88))

for ca_code, us_code, carrier in EXISTING_MIDSIZE:
    seats = dict(FLEET)[carrier]
    write_segment(carrier, ca_code, us_code, seats, deps_per_month=18, load=RNG.uniform(0.74, 0.84))

with (OUT / "t100_segment.csv").open("w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=t100_header)
    w.writeheader()
    w.writerows(t100_rows)

# --------------------------------------------------------------- O&D demand --
od_header = ["YEAR", "ORIGIN", "DEST", "PASSENGERS", "AVG_FARE_USD", "SOURCE", "CONFIDENCE"]
od_rows = []
for ca_code in CA:
    for us_code in US:
        dist = miles(CA[ca_code], US[us_code])
        if dist > 4600:
            continue
        total = demand_for(ca_code, us_code)
        if total < 20_000:
            continue
        growth = RNG.uniform(-0.04, 0.19)
        fare = fare_for(dist)
        # Smaller markets are sampled more thinly, so trust them less.
        conf = int(max(58, min(92, 55 + 40 * min(1.0, total / 120_000) + RNG.uniform(-6, 6))))
        for year, scale in ((YEAR, 1.0), (YEAR - 1, 1 / (1 + growth))):
            for o, d, share in ((ca_code, us_code, 0.52), (us_code, ca_code, 0.48)):
                od_rows.append({
                    "YEAR": year, "ORIGIN": o, "DEST": d,
                    "PASSENGERS": int(total * scale * share),
                    "AVG_FARE_USD": round(fare * (1 if year == YEAR else RNG.uniform(0.93, 1.0)), 2),
                    "SOURCE": "statcan", "CONFIDENCE": conf,
                })

with (OUT / "od_demand.csv").open("w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=od_header)
    w.writeheader()
    w.writerows(od_rows)

print(f"t100_segment.csv: {len(t100_rows)} rows")
print(f"od_demand.csv:    {len(od_rows)} rows")
