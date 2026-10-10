#!/usr/bin/env python3
"""Build the network-map payload: a projected Canada outline, the airports, and
the real month-by-month flight count for every route.

Geometry is projected here, not in the browser, so the component only ever draws
numbers and the SVG can be pasted straight into a design tool as clean vectors.

    scripts/build_map_data.py          (needs the northbound database loaded)
"""

import json
import math
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NE = ROOT / "data" / "raw" / "geo" / "ne_110m_admin_0_countries.geojson"
OUT = ROOT / "app" / "data" / "northbyte-map.json"
PSQL = "/opt/homebrew/opt/postgresql@17/bin/psql"

# Lambert conformal conic, the standard projection for Canada: straight
# meridians, true shape at the parallels that matter here.
LAT0, LON0, LAT1, LAT2 = 49.0, -91.87, 49.0, 77.0
R = 1.0


def lcc(lon, lat):
    lon, lat = math.radians(lon), math.radians(lat)
    lon0, lat0 = math.radians(LON0), math.radians(LAT0)
    lat1, lat2 = math.radians(LAT1), math.radians(LAT2)
    n = (math.log(math.cos(lat1) / math.cos(lat2))
         / math.log(math.tan(math.pi / 4 + lat2 / 2) / math.tan(math.pi / 4 + lat1 / 2)))
    f = math.cos(lat1) * math.tan(math.pi / 4 + lat1 / 2) ** n / n
    rho = R * f / math.tan(math.pi / 4 + lat / 2) ** n
    rho0 = R * f / math.tan(math.pi / 4 + lat0 / 2) ** n
    theta = n * (lon - lon0)
    return rho * math.sin(theta), rho0 - rho * math.cos(theta)


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
canada = next(f for f in json.loads(NE.read_text())["features"]
              if f["properties"]["NAME"] == "Canada")
rings = []
for polygon in canada["geometry"]["coordinates"]:
    ring = [lcc(lon, lat) for lon, lat in polygon[0]]
    # Arctic islands add noise at this size without adding orientation.
    area = abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1]
                   for i in range(len(ring)))) / 2
    if area > 0.0012:
        rings.append(simplify(ring, 0.004))

airports = {code: (float(lon), float(lat), city) for code, city, lat, lon in
            [(r[0], r[1], r[2], r[3]) for r in
             query("select iata, city, latitude, longitude from nb.airport_geo "
                   "where iata in (select distinct origin from nb.fb_cost)")]}
projected_airports = {code: lcc(lon, lat) for code, (lon, lat, _) in airports.items()}

# ------------------------------------------------------- fit to a viewBox ----
xs = [x for ring in rings for x, _ in ring] + [p[0] for p in projected_airports.values()]
ys = [y for ring in rings for _, y in ring] + [p[1] for p in projected_airports.values()]
PAD, W = 24, 1000
scale = (W - 2 * PAD) / (max(xs) - min(xs))
H = round((max(ys) - min(ys)) * scale + 2 * PAD)
# SVG's y axis points down, the projection's points up, so north is flipped here.
place = lambda x, y: (round((x - min(xs)) * scale + PAD, 1),
                      round((max(ys) - y) * scale + PAD, 1))

paths = []
for ring in rings:
    points = [place(x, y) for x, y in ring]
    paths.append("M" + "L".join(f"{x} {y}" for x, y in points) + "Z")

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
    "airports": {code: {"x": place(*projected_airports[code])[0],
                        "y": place(*projected_airports[code])[1],
                        "city": airports[code][2]}
                 for code in sorted(airports)},
    "months": months,
    "monthlyFlights": monthly,
    "monthlyTotals": [sum(counts[i] for counts in monthly.values()) for i in range(len(months))],
}
OUT.write_text(json.dumps(payload, separators=(",", ":")))
print(f"{OUT.name}: viewBox {payload['viewBox']}, {len(paths)} land paths, "
      f"{len(airports)} airports, {len(months)} months, {OUT.stat().st_size // 1024} KB")
