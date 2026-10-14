# The arithmetic, in full

Everything the NorthByte tool shows comes out of these equations. Nothing is
fitted, nothing is regressed; it is the build brief's model with the route table
as its input. This document is here so you can reproduce any number on the screen
by hand, and work out break-even yourself under any demand and price assumption.

- Implementation: `app/northbyte/model.ts`
- Data: `app/data/northbyte.json`, one row per directional route, 54 rows, FY25-26
- Checks: `scripts/verify_northbyte.ts` (63 of them)

---

## 1. What each route brings

| Symbol | Column | Meaning |
| --- | --- | --- |
| $f_0$ | `Flights_FY2526` | flights flown in FY25-26 |
| $f_{\text{pre}}$ | `Flights_PreSepFeb` | flights in Sep 2024 – Feb 2025 (half a year) |
| $f_{\text{plan}}$ | `PlanFlights` | the plan's target flights for the year |
| $R_0$ | `NetRev` | ticket + ancillary + refunds (refunds are negative) |
| $T_0$ | `TicketRev` | ticket revenue alone |
| $C_0$ | `Cost` | fuel + crew + maintenance + food |
| $c$ | `CostPerFlight` | $C_0 / f_0$ |
| $K$ | `Crew` | crew cost for the year |
| $F$ | `FeedToStableRev` | ticket revenue this route hands to the stable network |
| $G$ | `GateAlloc` | gate cost allocated to the route (display only) |

Network constants: gates $10{,}023{,}126$ actual, $10{,}095{,}839$ forecast,
idle gates releasable $433{,}500$, seasonal factor $s = 1.042$ on the rollback,
sustainable target $4.7\%$ of $\$189{,}641{,}058 = \$8.9\text{M}$.

---

## 2. Flights

Each cohort has its own level $\lambda \in [0, 1]$ — $0$ today, $1$ the plan.
The new routes carry on to $\lambda = 2$, where every one of them is exited.

$$
f_1 =
\begin{cases}
f_0 + \lambda\,(f_{\text{plan}}\,s - f_0) & \lambda \le 1\\[4pt]
f_{\text{plan}}\,s\,(2 - \lambda) & \lambda > 1
\end{cases}
\qquad
r = \frac{f_1}{f_0}
$$

$s = 1.042$ on the ten doubled routes when the seasonal baseline is on, $1$
otherwise. The Protect routes have $f_{\text{plan}} = f_0$, so they never move on
this lever.

---

## 3. Revenue when flights are cut — the $\rho$ model

$\rho$ is the share of a flight's revenue that leaves with the flight.

$$
R_1 = R_0 \bigl(1 + \rho\,(r - 1)\bigr)
$$

$\rho = 0$ means every ticket re-books onto what is left; $\rho = 1$ means the
revenue goes with the aircraft.

| Selector | $\rho$ | Where it comes from |
| --- | --- | --- |
| Demand holds | $0.046$ | revenue rose 2.4% when flights rose ~100%, so $0.024/0.52$ of the cut flows through |
| Same tickets per flight as before the expansion | $0.19$ | no route carries more tickets per flight than it did in Sep 2024 – Feb 2025 |
| Revenue leaves with the flights | $1.0$ | stress case |

Two exceptions, both so the curve has no step in it:

- **Exited routes** ($f_{\text{plan}} = 0$) always use $\rho = 1$: $R_1 = R_0\,r$.
- **Past the plan** ($\lambda > 1$) the revenue is taken off the plan's revenue in
  proportion to the flights still being removed, rather than recomputed:
  $R_1 = R_{\text{plan}} \cdot f_1 / f_{\text{plan}}$.

Tickets follow revenue: $T_1 = T_0 \cdot R_1/R_0$.

---

## 4. Fares and elasticity

A price rise $p$ on the 38 stable routes, with constant-elasticity demand $e$:

$$
\Delta_{\text{fare}} = T_0\Bigl[(1 + p)(1 + e\,p) - 1\Bigr]
$$

$(1+p)$ is the price, $(1 + e\,p)$ the quantity that survives it. Only the
Protect cohort gets this term.

### One basis, stated

Two true statements that look contradictory, because they are measured on
different sets of routes:

| | 38 stable routes | all 54 routes |
| --- | --- | --- |
| Flights | **+0.1%** | +20.3% |
| Average fare | **+3.46%** | +0.31% |
| Cost per flight | **+7.04%** | +2.65% |
| Tickets per flight | **+0.7%** | −12.6% |

**The stable routes are the like-for-like basis** and the one the deck should
quote: they flew within 0.1% of the same schedule in both years, so nothing is
being hidden by mix. The network figures are dragged down by the expansion
adding cheaper, shorter flying — which is itself a finding, not a correction.

So: **the stable routes raised prices 3.5% (1.9–6.4% route by route) and tickets
per flight did not move.** That is the only elasticity evidence in the data, it
covers one year, and it is why $e = 0$ is offered as the measured case rather
than as an assumption of convenience.

| Selector | $e$ | Source |
| --- | --- | --- |
| No response | $0$ | stable routes raised prices 3.5%, tickets per flight flat — one year only |
| Half | $-0.5$ | illustrative |
| National average | $-0.88$ | IATA/InterVISTAS, illustrative |
| Route level | $-1.54$ | IATA/InterVISTAS, illustrative |

### Where a fare rise stops paying

$(1+p)(1+e\,p) = 1 + (1+e)p + e p^2$ is a downward parabola in $p$ once $e < 0$,
so it peaks where the derivative is zero:

$$
\boxed{\;p^\* = -\frac{1+e}{2e}\;}
$$

| $e$ | $p^\*$ | reading |
| --- | --- | --- |
| $0$ | no peak | revenue rises with every dollar |
| $-0.5$ | $50\%$ | far outside anything defensible |
| $-0.88$ | $6.8\%$ | just above the evidence band, and worth only **+$0.6M** at its best |
| $-1.54$ | $-17.5\%$ | **negative: any rise loses money.** Leave fares alone |

The stable routes moved their own prices by 1.9–6.4% across the two years, so
**6.4% is the ceiling the data can speak to.** Everything above it is shaded in
the tool.

---

## 5. Cost

$$
C_1 = f_1\,c \;+\; (1 - \sigma)\max(0,\,f_0 - f_1)\frac{K}{f_0}
$$

$\sigma$ is the crew shed: at $\sigma = 1$ crew cost leaves with the flight
(redeployment, no severance); at $\sigma = 0$ the crew cost of a cut flight stays
on the books. Aircraft leases are **not in the data and are not modelled.**

---

## 6. Feed lost to the stable network

Cutting a route also costs the connecting traffic it hands over:

$$
L = F\,\rho\,(1 - r) \qquad (L = 0 \text{ on exited routes})
$$

---

## 7. The network

$$
\Pi = \underbrace{\sum_i \bigl(R_1^i + \Delta^i_{\text{fare}} - C_1^i\bigr) - \sum_i L^i}_{\text{contribution}} \;-\; \Gamma
$$

$\Gamma$ is gates: the chosen basis minus $433{,}500$ if the idle gates are handed
back. Margin is $\Pi$ over $\sum R_1 + \sum \Delta_{\text{fare}} - \sum L$.

**Every $\Pi$ is FY25-26 restated at the chosen frequency — one year re-run.
Nothing compounds and no second year is projected.**

---

## 8. Break even

$\Pi = 0$. With the flight levers at their end (rollback 100%, every new route
exited, idle gates handed back) and $B = \sum_{\text{Protect}} T_0 = \$142.4\text{M}$,
the fare rise that closes the remaining gap $g$ solves

$$
B\bigl[(1+p)(1+e\,p) - 1\bigr] = g
$$

$$
p = \frac{g}{B}\ \ (e = 0), \qquad
p = \frac{-(1+e) + \sqrt{(1+e)^2 + 4eg/B}}{2e}\ \ (e \ne 0)
$$

A negative discriminant means no price reaches it: the parabola's peak is below
the gap.

### What that gives, case by case

Flights maxed, gates handed back, fares at zero:

| Demand | $\Pi$ before fares | $e=0$ | $e=-0.5$ | $e=-0.88$ | $e=-1.54$ |
| --- | --- | --- | --- | --- | --- |
| Demand holds | −$1.6M | **1.13%** | **2.31%** | unreachable | unreachable |
| Base | −$5.4M | **3.76%** | 8.19% ✗ | unreachable | unreachable |
| Revenue leaves | −$26.5M | 18.58% ✗ | unreachable | unreachable | unreachable |

✗ = above the 6.4% the data supports. "Unreachable" = the parabola peaks below
the gap, so no price breaks even.

**Read it this way.** The flights do 90% of the work — $42.8M from the rollback
and $10.3M from exiting the new routes, against a $58.8M hole. What is left is
$1.6M to $5.4M depending on how demand answers the cuts, and whether fares can
close it depends entirely on $e$:

- **$e = 0$** (what your data actually shows): 1.1–3.8% does it. The plan's 3.45%
  cost pass-through is exactly in this range.
- **$e = -0.5$**: still possible in the base case, but it needs 8.2% — outside the
  evidence.
- **$e = -0.88$ or $-1.54$**: fares cannot close it at any price. The gap has to
  come from cost per flight, seasonality, or fleet.

---

## 9. Doing nothing

Two readings, each on the basis that fits it.

**Flights held** — nothing is added, so the like-for-like rates from the stable
routes apply: cost per flight +7.04%, their own fares +3.46% on $B = \$142.4$M
of stable ticket revenue.

$$
\Pi_{\text{hold}} = R + B(0.0346) - C(1 + 0.0704) - \Gamma = -\$70.7\text{M}
$$
**The expansion carries on** — the mix changes again, so the network rates apply:

$$
\Pi_{\text{expand}} = R(1 + 0.0514) - C(1 + 0.2352) - \Gamma = -\$105.1\text{M}
$$

An extrapolation of two observed years, not a forecast of demand.

---

## 10. The forecast months

Every figure on the map is an **average month**: the annual flights at that stage
of the plan, divided by twelve. Real calendar months are not comparable with each
other — August flew 1,474 and February 1,103 — so showing them made the plan's
effect wobble up and down when what it does is come steadily down.

$$
\text{shown for month } m = \frac{f_1(\text{tranches landed by } m)}{12}
$$

The first column is FY25-26 as flown on the same basis, 1,311 a month, and each
forecast month is read against it. Seasonality is a finding in its own right and
sits in the evidence tab rather than in this number.

**Tranche order.** One tranche lands a quarter. Ottawa–Montréal is in the first,
not the fourth: it loses **\$3,624 a flight**, so the nine months between T1 and
T4 would be 818 flights and **\$2.96M** of avoidable loss. London and Moncton
stay in T4, because they are being reduced rather than exited.

---

## 11. Reproducing any of it

```bash
npx esbuild scripts/verify_northbyte.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/verify.mjs && node /tmp/verify.mjs      # 63 checks
psql -d northbound -f db/50_firstbyte_checks.sql          # the raw-data figures
```
