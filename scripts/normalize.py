#!/usr/bin/env python3
"""Map a source CSV onto the staging column layout the SQL loader expects.

Sources publish the same facts under different column names, and the real BTS
extract carries roughly 40 columns we do not need. Doing the column selection
here keeps the SQL free of source-specific trivia and means a change in the
published layout is a one-line edit to ALIASES.

    scripts/normalize.py --source t100 data/raw/t100i_segment_2018.csv \
                                       data/staged/t100_segment.csv

The "statcan" source is handled separately: Statistics Canada publishes O&D as a
long table keyed by a "US City, State - Canadian City, Province" label, so it
needs city->airport resolution rather than a column rename.
"""

import argparse
import collections
import csv
import sys
from pathlib import Path

ALIASES = {
    "t100": {
        "year":                 ["YEAR"],
        "month":                ["MONTH"],
        "carrier_code":         ["UNIQUE_CARRIER", "CARRIER", "IATA_CODE"],
        "origin":               ["ORIGIN"],
        "destination":          ["DEST", "DESTINATION"],
        "passengers":           ["PASSENGERS"],
        "seats":                ["SEATS"],
        "departures_performed": ["DEPARTURES_PERFORMED", "DEPARTURES"],
        "distance_miles":       ["DISTANCE", "DISTANCE_MILES"],
    },
    "od": {
        "year":         ["YEAR", "REF_DATE"],
        "origin":       ["ORIGIN"],
        "destination":  ["DEST", "DESTINATION"],
        "passengers":   ["PASSENGERS", "VALUE"],
        "avg_fare_usd": ["AVG_FARE_USD", "AVERAGE_FARE", "FARE"],
        "source":       ["SOURCE"],
        "confidence":   ["CONFIDENCE"],
    },
}

DEFAULTS = {"source": "statcan", "confidence": "70", "avg_fare_usd": ""}
INTEGER_FIELDS = {"year", "month", "passengers", "seats", "departures_performed",
                  "distance_miles", "confidence"}


def resolve(header, spec):
    """Build canonical -> source-column mapping, case- and space-insensitive."""
    lookup = {h.strip().upper().replace(" ", "_"): h for h in header}
    mapping, missing = {}, []
    for canonical, candidates in spec.items():
        for candidate in candidates:
            if candidate in lookup:
                mapping[canonical] = lookup[candidate]
                break
        else:
            if canonical not in DEFAULTS:
                missing.append(f"{canonical} (looked for {', '.join(candidates)})")
    if missing:
        sys.exit("Source file is missing required columns:\n  " + "\n  ".join(missing))
    return mapping


def clean(value, field):
    value = (value or "").strip().strip('"')
    if field in INTEGER_FIELDS:
        # Sources emit "1,234", "1234.00" and "" for the same idea.
        value = value.replace(",", "")
        if value in ("", "."):
            return None
        return str(int(float(value)))
    if field == "avg_fare_usd":
        value = value.replace(",", "").replace("$", "")
        return value or None
    return value.upper() if field in ("origin", "destination", "carrier_code") else value


# ------------------------------------------------------------ Statistics Canada --

def statcan_od(input_path, output_path, year_floor=2017):
    """Convert the StatCan city-pair table into od_demand rows.

    Two things make this source different from a column rename:
      * it counts a city pair, so "Vancouver, British Columbia" has to be
        resolved to YVR through data/staged/city_airport.csv;
      * VALUE is outbound PLUS inbound, so one row already covers both
        directions of the market and must not be emitted twice.
    """
    bridge_path = Path(output_path).parent / "city_airport.csv"
    if not bridge_path.exists():
        sys.exit("Run scripts/build_reference.py first: city_airport.csv is missing.")
    with bridge_path.open(newline="") as fh:
        bridge = {row["city_key"]: row["iata"] for row in csv.DictReader(fh)}

    kept, unresolved, out_of_scope = 0, collections.Counter(), 0
    with open(input_path, newline="", encoding="utf-8-sig") as fh, \
         open(output_path, "w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(ALIASES["od"]))
        writer.writeheader()
        for row in csv.DictReader(fh):
            if row["Estimates"] != "Number of outbound and inbound passengers":
                continue
            if not row["VALUE"] or int(row["REF_DATE"]) < year_floor:
                continue
            cities = [c.strip() for c in row["GEO"].split(" - ")]
            if len(cities) != 2:
                continue
            codes = [bridge.get(city) for city in cities]
            if None in codes:
                # Either outside the study area or a city with no scheduled
                # airport of its own. Counted, never guessed at.
                for city, code in zip(cities, codes):
                    if code is None:
                        unresolved[city] += 1
                out_of_scope += 1
                continue
            passengers = int(float(row["VALUE"]))
            # The published table starts at 4,000 passengers a year; volume is
            # the only quality signal it gives, so confidence tracks it.
            confidence = int(max(60, min(92, 60 + 32 * min(1.0, passengers / 150_000))))
            writer.writerow({
                "year": row["REF_DATE"], "origin": codes[0], "destination": codes[1],
                "passengers": passengers, "avg_fare_usd": "", "source": "statcan",
                "confidence": confidence,
            })
            kept += 1

    print(f"statcan: wrote {kept} rows to {output_path} "
          f"({out_of_scope} pairs outside the study area)")
    if unresolved:
        top = ", ".join(f"{city} x{n}" for city, n in unresolved.most_common(5))
        print(f"         unmatched cities (top 5 of {len(unresolved)}): {top}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=sorted(ALIASES) + ["statcan"], required=True)
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()

    if args.source == "statcan":
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        statcan_od(args.input, args.output)
        return

    spec = ALIASES[args.source]
    with open(args.input, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        mapping = resolve(reader.fieldnames or [], spec)

        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, "w", newline="") as out:
            writer = csv.DictWriter(out, fieldnames=list(spec))
            writer.writeheader()
            kept = dropped = 0
            for row in reader:
                # BTS ships scheduled (F) and charter/other service in one file.
                if args.source == "t100" and row.get("CLASS", "F") not in ("F", ""):
                    dropped += 1
                    continue
                record = {}
                for field in spec:
                    raw = row.get(mapping[field]) if field in mapping else DEFAULTS.get(field)
                    record[field] = clean(raw, field)
                required = ["year", "origin", "destination", "passengers"]
                if any(record.get(f) in (None, "") for f in required) \
                        or record["origin"] == record["destination"]:
                    dropped += 1
                    continue
                if args.source == "t100" and int(record["departures_performed"] or 0) == 0:
                    dropped += 1        # a segment nobody actually flew
                    continue
                writer.writerow(record)
                kept += 1

    print(f"{args.source}: wrote {kept} rows to {args.output} ({dropped} dropped)")


if __name__ == "__main__":
    main()
