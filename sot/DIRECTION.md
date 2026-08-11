# Direction — open

**Status: work in progress. The build is stable; the positioning is not decided.**

The prototype is complete and tested as an architecture proof. What has *not* been decided is
which problem it is sold against. This file exists so that decision can be picked up cold.

---

## What is settled

These are demonstrated in the build and worth keeping regardless of direction:

- **Truth is computed, not stored.** Immutable per-source assertions plus a policy the customer
  owns. Change the policy, every answer changes, no migration.
- **Disagreements are classified, not counted.** Divergence / lag / gap. A stalled connector
  produces lag, not four thousand false findings.
- **Time lives on the relationships.** Valid-time edges make the past queryable — who held a
  role, a ward, a territory, an access grant on a given date.
- **Identity is scored, with a human queue** for the uncertain middle.
- **A vertical is a declaration.** Six tenants across six industries, one engine.

## What the data says

Across all six tenants the engine produces **210 findings, 41 critical**. The critical band is
almost entirely two things:

| Finding | Count |
|---|---|
| Terminated in the HR system, still live somewhere else | 23 |
| Expired credential still on the books | 22 |
| Working with no authoritative HR record | 2 |
| Duplicate records inside one system | 5 |
| Uncertain identities awaiting a decision | 66 |

Everything else — mismatched miles, credit hours, ticket values, length of stay — is interesting
but nobody's job depends on it. That asymmetry is the strongest signal in the prototype about
where the product should point.

## Candidate directions

Ranked as of the last discussion. Not decided.

1. **Workforce access & credential integrity.** Named buyer with a compliance budget, visceral
   findings, days to value, and a recurring ritual (access reviews, expiry checks) rather than
   occasional lookup. All three architectural bets are load-bearing. Contested by SailPoint,
   Saviynt, Okta IG, Lumos, ConductorOne — who are strong on entitlements and provisioning and
   weak on fuzzy cross-system identity and point-in-time history.
2. **Licensed-workforce compliance** (healthcare, transport, advisers, trades). Narrower, sharper,
   less contested, fragmented incumbents. Licensing boards are public primary sources, and
   primary-source verification is a mandated paid activity.
3. **Contingent workforce visibility.** Real pain; buyer expects to buy a VMS suite.
4. **Revenue / GTM data hygiene.** Where this started. Weak budgets, crowded.
5. **People and org analytics.** Weak budgets.

## Honest risks in the current framing

- "One source of truth across your systems" is **Master Data Management** — a real market and a
  startup graveyard. Long cycles, committee buyers, services-heavy.
- **Six verticals is a demo asset, not a go-to-market.** The kit makes the code cheap; it does
  nothing about connectors, domain expertise, compliance regimes or six sales motions.
- The product as built is a **lookup tool**. Widely-used software is a queue with a deadline.

## What changes under direction 1 or 2

| Keep | Cut or defer | Add |
|---|---|---|
| Identity resolution and its queue | The client half of the graph — patients, students, guests | Access reviews and attestation with evidence export |
| Assertions and policy | Five of six verticals as *sales* targets | "As of \<date\>" across every screen |
| Divergence / lag / gap | Metric reconciliation | Dollarised impact — licence spend, days of exposure |
| Time-bounded edges | Universal drill-through as the *headline* | Entitlements, not only accounts |

Dropping the client half removes the worst regulatory exposure: access governance can be sold to
a hospital without touching a patient record, so no PHI and no BAA blocking the first deal.

## The two questions to answer

1. **Which vertical to sell into first?** The engine does not care. Pricing, packaging, the first
   three connectors and the compliance track all follow from the answer.
2. **Reframe or new product?** Reframing the existing app — same engine, queue-first, new headline
   — is roughly a week. Keeping the six-tenant build as an architecture proof and starting a
   focused product alongside it is longer but keeps this demo intact.

Until one of those is answered, the build stays as it is.
