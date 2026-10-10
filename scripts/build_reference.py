#!/usr/bin/env python3
"""Build the airport reference table and the city->airport bridge from OurAirports.

Three jobs:
  1. data/staged/airports.csv   - the airports inside the study scope
  2. data/staged/city_airport.csv - "City, Region" -> IATA, needed because
     Statistics Canada publishes O&D by CITY while BTS publishes by AIRPORT.
  3. data/staged/airport_geo.csv - every scheduled airport in Canada and the
     U.S., regardless of scope. The operating-cost benchmark comes from an
     airline flying eastern Canadian routes, so stage lengths have to be
     computable outside the study area.

Scope comes from scripts/scope.json, which is the single place the study area is
defined.
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCOPE = json.loads((ROOT / "scripts" / "scope.json").read_text())
SOURCE = ROOT / "data" / "raw" / "ourairports_airports.csv"
OUT = ROOT / "data" / "staged"
OUT.mkdir(parents=True, exist_ok=True)

# Statistics Canada writes region names in full ("British Columbia"); OurAirports
# uses ISO codes ("CA-BC"). This is the join between them.
REGION_NAMES = {
    "CA-AB": "Alberta", "CA-BC": "British Columbia", "CA-MB": "Manitoba",
    "CA-NB": "New Brunswick", "CA-NL": "Newfoundland and Labrador",
    "CA-NS": "Nova Scotia", "CA-NT": "Northwest Territories", "CA-NU": "Nunavut",
    "CA-ON": "Ontario", "CA-PE": "Prince Edward Island", "CA-QC": "Quebec",
    "CA-SK": "Saskatchewan", "CA-YT": "Yukon",
    "US-AK": "Alaska", "US-AL": "Alabama", "US-AR": "Arkansas", "US-AZ": "Arizona",
    "US-CA": "California", "US-CO": "Colorado", "US-CT": "Connecticut",
    "US-DC": "District of Columbia", "US-DE": "Delaware", "US-FL": "Florida",
    "US-GA": "Georgia", "US-HI": "Hawaii", "US-IA": "Iowa", "US-ID": "Idaho",
    "US-IL": "Illinois", "US-IN": "Indiana", "US-KS": "Kansas", "US-KY": "Kentucky",
    "US-LA": "Louisiana", "US-MA": "Massachusetts", "US-MD": "Maryland",
    "US-ME": "Maine", "US-MI": "Michigan", "US-MN": "Minnesota", "US-MO": "Missouri",
    "US-MS": "Mississippi", "US-MT": "Montana", "US-NC": "North Carolina",
    "US-ND": "North Dakota", "US-NE": "Nebraska", "US-NH": "New Hampshire",
    "US-NJ": "New Jersey", "US-NM": "New Mexico", "US-NV": "Nevada",
    "US-NY": "New York", "US-OH": "Ohio", "US-OK": "Oklahoma", "US-OR": "Oregon",
    "US-PA": "Pennsylvania", "US-RI": "Rhode Island", "US-SC": "South Carolina",
    "US-SD": "South Dakota", "US-TN": "Tennessee", "US-TX": "Texas", "US-UT": "Utah",
    "US-VA": "Virginia", "US-VT": "Vermont", "US-WA": "Washington",
    "US-WI": "Wisconsin", "US-WV": "West Virginia", "US-WY": "Wyoming",
}

IN_SCOPE = {f"CA-{r}" for r in SCOPE["canada"]["regions"]} | \
           {f"US-{r}" for r in SCOPE["unitedStates"]["regions"]}
HUBS = set(SCOPE["canada"]["hubs"])
# A city's traffic belongs to its commercial airport, so only airports with
# scheduled service can represent one.
RANK = {"large_airport": 0, "medium_airport": 1, "small_airport": 2}

airports, by_city, geo = {}, {}, {}
with SOURCE.open(newline="", encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        iata, region = row["iata_code"].strip(), row["iso_region"]
        if len(iata) != 3 or row["scheduled_service"] != "yes" or row["type"] not in RANK:
            continue
        if region[:2] in ("CA", "US") and region in REGION_NAMES:
            geo.setdefault(iata, {
                "iata": iata, "city": row["municipality"].strip() or row["name"],
                "country": region[:2],
                "latitude": round(float(row["latitude_deg"]), 5),
                "longitude": round(float(row["longitude_deg"]), 5),
            })
        if region not in IN_SCOPE:
            continue
        municipality = row["municipality"].strip()
        if not municipality:
            continue
        record = {
            "iata": iata,
            "name": row["name"],
            "city": municipality,
            "region": region.split("-")[1],
            "country": region.split("-")[0],
            "latitude": round(float(row["latitude_deg"]), 5),
            "longitude": round(float(row["longitude_deg"]), 5),
            "is_hub": "true" if iata in HUBS else "false",
            "_rank": RANK[row["type"]],
        }
        airports[iata] = record
        # StatCan names a city, not an airport. When a city has more than one,
        # the largest one carries the city's traffic.
        key = f"{municipality}, {REGION_NAMES[region]}"
        if key not in by_city or record["_rank"] < by_city[key]["_rank"]:
            by_city[key] = record

fields = ["iata", "name", "city", "region", "country", "latitude", "longitude", "is_hub"]
with (OUT / "airports.csv").open("w", newline="") as fh:
    writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for record in sorted(airports.values(), key=lambda r: r["iata"]):
        writer.writerow(record)

with (OUT / "city_airport.csv").open("w", newline="") as fh:
    writer = csv.writer(fh)
    writer.writerow(["city_key", "iata"])
    for key, record in sorted(by_city.items()):
        writer.writerow([key, record["iata"]])

with (OUT / "airport_geo.csv").open("w", newline="") as fh:
    writer = csv.DictWriter(fh, fieldnames=["iata", "city", "country", "latitude", "longitude"])
    writer.writeheader()
    for record in sorted(geo.values(), key=lambda r: r["iata"]):
        writer.writerow(record)

missing = sorted(HUBS - set(airports))
if missing:
    raise SystemExit(f"Hub(s) not found in scope: {', '.join(missing)}")

print(f"airports.csv:     {len(airports)} airports in scope "
      f"({sum(1 for a in airports.values() if a['country'] == 'CA')} CA / "
      f"{sum(1 for a in airports.values() if a['country'] == 'US')} US)")
print(f"city_airport.csv: {len(by_city)} city keys")
print(f"airport_geo.csv:  {len(geo)} scheduled airports across CA and US")
