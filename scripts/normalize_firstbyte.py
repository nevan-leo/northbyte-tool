#!/usr/bin/env python3
"""Clean the FirstByte operating datasets into staging CSVs.

The three workbooks carry the usual operational-export damage, and each kind is
repaired here rather than in SQL so the repair is visible and counted:

  * Route_ID appears in 216 spellings ("YVR-YLW", "yvrylw", "YVRYLW") for 54
    real routes. Non-letters are stripped and the result split 3+3.
  * Transaction_Type, Booking_Channel and Membership_Tier arrive in mixed case
    and under several aliases ("OTA", "Online Travel Agcy").
  * Transaction_Date mixes three formats, and the slash format mixes DD/MM with
    MM/DD. Rows where the order cannot be decided keep a null timestamp and are
    flagged rather than guessed; the count is reported.

    scripts/normalize_firstbyte.py
"""

import collections
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "firstbyte"
OUT = ROOT / "data" / "staged"
OUT.mkdir(parents=True, exist_ok=True)

TXN_TYPES = {"ticket": "Ticket", "extra baggage": "Extra Baggage",
             "seat upgrade": "Seat Upgrade", "change fee": "Change Fee",
             "food & onboard": "Food & Onboard", "refund": "Refund"}
CHANNELS = {"direct web": "Direct Web", "website": "Direct Web", "web": "Direct Web",
            "corporate portal": "Corporate Portal", "corp portal": "Corporate Portal",
            "corporate": "Corporate Portal",
            "online travel agency": "Online Travel Agency",
            "online travel agcy": "Online Travel Agency", "ota": "Online Travel Agency",
            "mobile app": "Mobile App", "app": "Mobile App", "mobile": "Mobile App"}
TIERS = {"non-member": "Non-Member", "blue": "Blue", "silver": "Silver",
         "gold": "Gold", "platinum": "Platinum"}
# "NONE", "N/A", "Unknown" and blanks are missing values, not a sixth tier. They
# are kept as Unknown instead of being folded into Non-Member, which would
# invent a fact about the customer.
TIER_MISSING = {"none", "n/a", "unknown", ""}

counters = collections.Counter()


def route(raw):
    code = re.sub(r"[^A-Za-z]", "", raw or "").upper()
    if len(code) != 6:
        counters["route_unparsable"] += 1
        return None, None
    return code[:3], code[3:]


def timestamp(raw):
    """Return (iso_string_or_blank, ambiguous_flag)."""
    raw = (raw or "").strip()
    iso = re.match(r"^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})", raw)
    if iso:
        y, m, d, hh, mm = iso.groups()
        return f"{y}-{m}-{d} {hh}:{mm}", False
    slash = re.match(r"^(\d{2})/(\d{2})/(\d{4})[ T](\d{2}):(\d{2})", raw)
    if slash:
        a, b, y, hh, mm = slash.groups()
        first, second = int(a), int(b)
        if first > 12 and second <= 12:            # 26/08/2025 -> day first
            return f"{y}-{b}-{a} {hh}:{mm}", False
        if second > 12 and first <= 12:            # 01/20/2026 -> month first
            return f"{y}-{a}-{b} {hh}:{mm}", False
        counters["date_ambiguous"] += 1            # both <= 12, order unknowable
        return "", True
    counters["date_unparsable"] += 1
    return "", True


def lookup(table, value, counter_name):
    key = (value or "").strip().lower()
    if key in table:
        if table[key] != (value or "").strip():
            counters[counter_name] += 1
        return table[key]
    counters[counter_name + "_unmapped"] += 1
    return (value or "").strip() or "Unknown"


# ------------------------------------------------------------- transactions --
with (RAW / "transactions.csv").open(newline="") as fh, \
     (OUT / "fb_transactions.csv").open("w", newline="") as out:
    writer = csv.writer(out)
    writer.writerow(["transaction_id", "booking_id", "txn_ts", "date_ambiguous",
                     "origin", "destination", "txn_type", "tier", "channel", "amount"])
    kept = 0
    for row in csv.DictReader(fh):
        origin, destination = route(row["Route_ID"])
        if not origin:
            continue
        ts, ambiguous = timestamp(row["Transaction_Date"])
        tier_key = (row["Membership_Tier"] or "").strip().lower()
        tier = "Unknown" if tier_key in TIER_MISSING else lookup(TIERS, row["Membership_Tier"], "tier_normalised")
        writer.writerow([
            row["Transaction_ID"], row["Booking_ID"], ts, "true" if ambiguous else "false",
            origin, destination,
            lookup(TXN_TYPES, row["Transaction_Type"], "txn_type_normalised"),
            tier,
            lookup(CHANNELS, row["Booking_Channel"], "channel_normalised"),
            row["Amount"],
        ])
        kept += 1
print(f"fb_transactions.csv: {kept:,} rows")

# -------------------------------------------------------------------- costs --
with (RAW / "costs.csv").open(newline="") as fh, \
     (OUT / "fb_costs.csv").open("w", newline="") as out:
    writer = csv.writer(out)
    writer.writerow(["cost_id", "cost_ts", "cost_type", "origin", "destination",
                     "from_city", "to_city", "amount"])
    kept = 0
    for row in csv.DictReader(fh):
        origin, destination = route(row["Route_ID"])
        if not origin:
            continue
        writer.writerow([row["Cost_ID"], row["Cost_Date"][:19], row["Cost_Type"].strip().title(),
                         origin, destination, row["From"], row["To"], row["Amount"]])
        kept += 1
print(f"fb_costs.csv:        {kept:,} rows")

# -------------------------------------------------------------------- gates --
with (RAW / "gates.csv").open(newline="") as fh, \
     (OUT / "fb_gates.csv").open("w", newline="") as out:
    writer = csv.writer(out)
    writer.writerow(["city", "gate_number", "origin", "destination",
                     "lease_year", "annual_gate_cost"])
    kept = 0
    for row in csv.DictReader(fh):
        # A gate with no route assigned is still a leased gate, so the row is
        # kept with null endpoints instead of dropped.
        origin, destination = route(row["Route_ID"]) if row["Route_ID"].strip() else (None, None)
        writer.writerow([row["City"], row["Gate_Number"], origin or "", destination or "",
                         row["Year"], row["Annual_Gate_Cost"]])
        kept += 1
print(f"fb_gates.csv:        {kept:,} rows")

print("\ncleaning actions:")
for name, count in sorted(counters.items()):
    print(f"  {name:28} {count:,}")
