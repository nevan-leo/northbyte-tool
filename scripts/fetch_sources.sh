#!/usr/bin/env bash
# Download the three public sources into data/raw/. Run from the project root.
#
# Nothing here is behind a login or a licence: BTS and Statistics Canada publish
# these, and OurAirports is public domain. Roughly 14 MB in total.

set -euo pipefail
YEAR=${YEAR:-2018}
RAW=data/raw
mkdir -p "$RAW"

echo "1/3  BTS T-100 International Segment (All Carriers), $YEAR"
python3 scripts/fetch_bts.py "$YEAR" "$RAW/t100i_segment_$YEAR.zip"
unzip -o -q "$RAW/t100i_segment_$YEAR.zip" -d "$RAW"
mv "$RAW/T_T100I_SEGMENT_ALL_CARRIER.csv" "$RAW/t100i_segment_$YEAR.csv"

echo "2/3  Statistics Canada 23-10-0256, transborder O&D by city pair"
url=$(curl -s "https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/23100256/en" \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["object"])')
curl -s -o "$RAW/statcan_23100256.zip" "$url"
unzip -o -q "$RAW/statcan_23100256.zip" -d "$RAW"

echo "3/3  OurAirports airport reference"
curl -sL -o "$RAW/ourairports_airports.csv" \
     "https://davidmegginson.github.io/ourairports-data/airports.csv"

ls -lh "$RAW"
