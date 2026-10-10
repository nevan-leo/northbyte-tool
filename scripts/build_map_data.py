#!/usr/bin/env python3
"""Build the network-map payload: a projected Canada outline, the airports, and
the real month-by-month flight count for every route.

Geometry is projected here, not in the browser, so the component only ever draws
numbers and the SVG can be pasted straight into a design tool as clean vectors.

    scripts/build_map_data.py          (needs the northbound database loaded)
"""

import json
import math
import sys
import subprocess
from pathlib import Path

# Douglas-Peucker recurses once per retained point on a long coastline.
sys.setrecursionlimit(20000)

ROOT = Path(__file__).resolve().parent.parent
GEO = ROOT / "data" / "raw" / "geo"
COUNTRIES = GEO / "ne_50m_admin_0_countries.geojson"
PROVINCES = GEO / "ne_50m_admin_1_states_provinces.geojson"
LAKES = GEO / "ne_50m_lakes.geojson"
OUT = ROOT / "app" / "data" / "northbyte-map.json"
PSQL = "/opt/homebrew/opt/postgresql@17/bin/psql"

# Web Mercator: the projection every online map uses, so the country reads the
# way people are used to seeing it — flat across the bottom, no conic fan. It
# stretches the far north, which costs nothing here because the frame is cropped
# to the band the airline actually flies.
def lcc(lon, lat):                       # name kept: every caller projects through it
    lat = max(min(lat, 84.0), -84.0)
    return (math.radians(lon),
            math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def simplify(points, tolerance):
    """Douglas-Peucker. The outline is decoration for orientation, not a survey."""
    if len(points) < 3:
        return points
    first, last = points[0], points[-1]
    index, furthest = 0, 0.0
    for i in range(1, len(points) - 1):
        d = perpendicular(points[i], first, last)
        if d > furthest:
            index, furthest = i, d
    if furthest > tolerance:
        return simplify(points[:index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)
    return [first, last]


def perpendicular(point, start, end):
    (x, y), (x1, y1), (x2, y2) = point, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def query(sql):
    out = subprocess.run([PSQL, "-d", "northbound", "-At", "-F", "\t", "-c", sql],
                         capture_output=True, text=True, check=True,
                         env={"PATH": "/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin",
                              "LC_ALL": "en_US.UTF-8", "HOME": str(Path.home())})
    return [line.split("\t") for line in out.stdout.strip().splitlines()]


# ------------------------------------------------------------------ land ----
# Natural Earth 1:50m. The 1:110m outline is too coarse to read as Canada once
# it is simplified enough to ship; at 50m Hudson Bay, the Gulf and the Arctic
# islands survive, which is what makes the map recognisable.

def rings_of(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"][0]]
    return [polygon[0] for polygon in geometry["coordinates"]]


def shrink(ring, tolerance, min_area):
    projected = [lcc(lon, lat) for lon, lat in ring]
    area = abs(sum(projected[i][0] * projected[i - 1][1] - projected[i - 1][0] * projected[i][1]
                   for i in range(len(projected)))) / 2
    if area < min_area:
        return None
    return simplify(projected, tolerance)


def collect(features, tolerance, min_area):
    out = []
    for feature in features:
        for ring in rings_of(feature["geometry"]):
            reduced = shrink(ring, tolerance, min_area)
            if reduced and len(reduced) > 3:
                out.append(reduced)
    return out


countries = json.loads(COUNTRIES.read_text())["features"]
provinces = [f for f in json.loads(PROVINCES.read_text())["features"]
             if f["properties"].get("admin") == "Canada"]
lakes = [f for f in json.loads(LAKES.read_text())["features"]
         if (f["properties"].get("name") or "") in {
             "Lake Superior", "Lake Huron", "Lake Michigan", "Lake Erie", "Lake Ontario",
             "Lake Winnipeg", "Great Bear Lake", "Great Slave Lake", "Lake Athabasca",
             "Lake Nipigon", "Reindeer Lake", "Lake Manitoba"}]

# Provinces carry the national outline and the internal borders in one pass.
rings = collect(provinces, 0.0009, 0.00012)
neighbour_rings = collect([f for f in countries
                           if f["properties"]["NAME"] in ("United States of America", "Greenland")],
                          0.0016, 0.0006)
lake_rings = collect(lakes, 0.0006, 0.00002)

airports = {code: (float(lon), float(lat), city) for code, city, lat, lon in
            [(r[0], r[1], r[2], r[3]) for r in
             query("select iata, city, latitude, longitude from nb.airport_geo "
                   "where iata in (select distinct origin from nb.fb_cost)")]}
projected_airports = {code: lcc(lon, lat) for code, (lon, lat, _) in airports.items()}

# ------------------------------------------------------- fit to a viewBox ----
all_rings = rings + neighbour_rings + lake_rings
xs = [x for ring in rings for x, _ in ring] + [p[0] for p in projected_airports.values()]
ys = [y for ring in rings for _, y in ring] + [p[1] for p in projected_airports.values()]
PAD, W = 24, 1000
scale = (W - 2 * PAD) / (max(xs) - min(xs))
H = round((max(ys) - min(ys)) * scale + 2 * PAD)
# SVG's y axis points down, the projection's points up, so north is flipped here.
place = lambda x, y: (round((x - min(xs)) * scale + PAD, 1),
                      round((max(ys) - y) * scale + PAD, 1))

def to_path(ring):
    return "M" + "L".join(f"{x} {y}" for x, y in (place(x, y) for x, y in ring)) + "Z"

paths = [to_path(ring) for ring in rings]
neighbours = [to_path(ring) for ring in neighbour_rings]
lake_paths = [to_path(ring) for ring in lake_rings]

# --------------------------------------------------------- flights/month ----
rows = query("""
    SELECT origin || '-' || destination AS route,
           to_char(date_trunc('month', cost_ts), 'YYYY-MM') AS month,
           count(*) AS flights
    FROM (SELECT DISTINCT origin, destination, cost_ts FROM nb.fb_cost) f
    GROUP BY 1, 2 ORDER BY 1, 2
""")
months = sorted({month for _, month, _ in rows})
monthly = {}
for route, month, flights in rows:
    monthly.setdefault(route, [0] * len(months))[months.index(month)] = int(flights)

# Crop to the network. The Arctic is a third of the country's height and none
# of its flights, and a tall frame wastes the slide it ends up on.
ax = [a[0] for a in (place(*projected_airports[c]) for c in projected_airports)]
ay = [a[1] for a in (place(*projected_airports[c]) for c in projected_airports)]
x0, y0 = min(ax) - 40, min(ay) - 90
view = (x0, y0, max(ax) - x0 + 40, max(ay) - y0 + 60)

payload = {
    "viewBox": " ".join(str(round(v)) for v in view),
    "land": paths,
    "neighbours": neighbours,
    "lakes": lake_paths,
    "airports": {code: {"x": place(*projected_airports[code])[0],
                        "y": place(*projected_airports[code])[1],
                        "city": airports[code][2]}
                 for code in sorted(airports)},
    "months": months,
    "monthlyFlights": monthly,
    "monthlyTotals": [sum(counts[i] for counts in monthly.values()) for i in range(len(months))],
}
OUT.write_text(json.dumps(payload, separators=(",", ":")))
print(f"{OUT.name}: viewBox {payload['viewBox']} · {len(paths)} provinces, "
      f"{len(neighbours)} neighbour shapes, {len(lake_paths)} lakes, {len(airports)} airports, "
      f"{len(months)} months · {OUT.stat().st_size // 1024} KB")
