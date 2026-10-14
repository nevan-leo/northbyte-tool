#!/usr/bin/env python3
"""Embed route_model.csv in the app as JSON.

The scenario tool has to run with no server and no fetch, so the 54-route table
ships inside the page rather than being loaded at runtime.
"""
import csv, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "raw" / "firstbyte" / "route_model.csv"
OUT = ROOT / "app" / "data" / "northbyte.json"

NUMERIC = {"Tranche", "Flights_FY2526", "Flights_PreSepFeb", "Tickets", "TicketRev",
           "AncRev", "Refunds", "NetRev", "Fuel", "Crew", "Maint", "Food", "Cost",
           "GateAlloc", "Contrib", "ProfitAfterGates", "ConnTickets", "FeedToStableRev",
           "CostPerFlight", "TicketsPerFlight", "AvgFare", "PlanFlights", "Exit"}

routes = []
for row in csv.DictReader(SRC.open(newline="")):
    record = {}
    for key, value in row.items():
        if key in NUMERIC:
            record[key] = float(value) if value not in ("", None) else 0.0
        else:
            record[key] = (value or "").strip()
    record["Exit"] = bool(record["Exit"])
    # Ottawa-Montreal loses $3,624 a flight. The prepared table phases it with
    # the rest of the new routes in tranche 4, which is nine months of flying it
    # at a known loss: 818 flights, $2.96M. It exits in the first tranche.
    if record["Exit"]:
        record["Tranche"] = 1
    routes.append(record)

payload = {
    "source": "FirstByte 2026 / NorthByte Airlines, FY25-26",
    "currency": "CAD",
    "routes": routes,
    # Measured year over year from the raw workbooks, FY24-25 against FY25-26,
    # by db/50_firstbyte_checks.sql.
    #
    # TWO BASES, and they say different things because of mix. The 38 stable
    # routes flew within 0.1% of the same number of flights in both years, so
    # they are the like-for-like read; the network figures are dragged down by
    # the expansion adding cheaper, shorter flying.
    "drift": {
        # Like for like, the 38 stable routes:
        "stableFareGrowth": 0.0346,       # $1,043.66 -> $1,079.73 a ticket
        "stableCostPerFlightGrowth": 0.0704,  # $15,494 -> $16,584 a flight
        "stableTicketsPerFlightGrowth": 0.007,  # 16.6 -> 16.8, flat
        # All 54 routes, where the expansion changes the mix:
        "flightsGrowth": 0.2033,        # 13,072 -> 15,729 flights
        "costGrowth": 0.2352,           # $192.99M -> $238.38M
        "costPerFlightGrowth": 0.0265,  # $14,763 -> $15,155 a flight
        "revenueGrowth": 0.0514,        # $177.83M -> $186.97M on dated rows
        "fareGrowth": 0.0031,           # $1,029.51 -> $1,032.75 a ticket
    },
    # Network constants from the build brief, editable in the UI.
    "constants": {
        "gatesActual": 10_023_126,
        "gatesForecast": 10_095_839,
        "idleGatesReleasable": 433_500,
        "seasonalFactor": 1.042,
        "targetMarginPct": 4.7,
        "netRevenueToday": 189_641_058,
    },
    "presets": {
        "rhoDown": {"High": 0.046, "Mid": 0.19, "Low": 1.0},
        "rhoUp": 0.024,
        "costPassThroughFarePct": 3.45,
    },
}
OUT.write_text(json.dumps(payload, indent=1))
print(f"{OUT}: {len(routes)} routes, {OUT.stat().st_size/1024:.0f} KB")
