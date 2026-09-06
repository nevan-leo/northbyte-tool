#!/usr/bin/env python3
"""Download one year of a BTS TranStats T-100 table.

TranStats has no plain file URL: the download is an ASP.NET postback on the
field-selection page, so this reproduces that form submission rather than
scraping a directory listing. The table is identified by TranStats' own
obfuscated code (FJE = T-100 International Segment, All Carriers).

    scripts/fetch_bts.py 2018 data/raw/t100i_segment_2018.zip
"""

import http.cookiejar
import re
import sys
import urllib.parse
import urllib.request

TABLES = {
    "FJE": "T-100 International Segment (All Carriers)",
    "FJD": "T-100 International Market (All Carriers)",
    "GEE": "T-100 Domestic Segment (All Carriers)",
}
FIELDS = ["YEAR", "MONTH", "UNIQUE_CARRIER", "ORIGIN", "DEST", "PASSENGERS",
          "SEATS", "DEPARTURES_PERFORMED", "DISTANCE", "CLASS"]


def fetch(year, out_path, table="FJE"):
    url = ("https://www.transtats.bts.gov/DL_SelectFields.aspx"
           f"?gnoyr_VQ={table}&QO_fu146_anzr=Nv4%20Pn44vr45")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", "Mozilla/5.0"), ("Referer", url)]

    page = opener.open(url, timeout=120).read().decode("latin-1")
    # ASP.NET rejects a postback that does not echo these back verbatim.
    form = dict(re.findall(
        r'<input type="hidden" name="(__[A-Z]+)"[^>]*value="([^"]*)"', page))
    form.update({field: "on" for field in FIELDS})
    form.update({"cboGeography": "All", "cboYear": str(year),
                 "cboPeriod": "All", "btnDownload": "Download"})

    request = urllib.request.Request(
        url, urllib.parse.urlencode(form).encode(), method="POST")
    with opener.open(request, timeout=900) as response:
        body = response.read()
        served = response.headers.get("Content-Disposition", "")

    if body[:2] != b"PK":
        sys.exit(f"TranStats returned {response.headers.get('Content-Type')} "
                 f"instead of a zip; the form layout has probably changed.")
    # The filename TranStats serves names the table it actually gave us, which is
    # the only confirmation that the table code still means what we think.
    print(f"{TABLES.get(table, table)} {year}: {len(body):,} bytes  [{served}]")
    with open(out_path, "wb") as fh:
        fh.write(body)


if __name__ == "__main__":
    fetch(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "FJE")
