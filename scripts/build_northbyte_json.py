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
    routes.append(record)

payload = {
    "source": "FirstByte 2026 / NorthByte Airlines, FY25-26",
    "currency": "CAD",
    "routes": routes,
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
