# Source of Truth

**Kaliris Labs** · prototype

*One organization. Every system. One source of truth.*

A working prototype of a cross-system organizational intelligence layer: it resolves one
identity per person across six business systems, computes the truth about them from a
configurable policy, and explains every disagreement it finds.

```
python3 source-of-truth/scripts/build.py     # bundle to dist/source-of-truth.html
node source-of-truth/scripts/engine_check.js # run the engine headless, assert its output
node source-of-truth/scripts/smoke.js        # drive the built app through every screen
```

Open `dist/source-of-truth.html` in any browser. No server, no build step, no dependencies.

---

## The idea in one paragraph

Salesforce, Workday, Gong, Clari and a territory planning system each hold a version of who
works where, reporting to whom, owning which territory. They disagree constantly, and no
system above them knows which one to believe. Source of Truth sits above all of them: it
works out that Salesforce user `0055f…`, Workday worker `WD-110224` and Gong seat `gong-55…`
are the same human being, decides which system is authoritative for each individual field,
and — when they still disagree — says what disagrees, why, which system to trust, and what
to fix.

## The one architectural decision that matters

**There is no golden record.**

The obvious way to build this is a big `employees` table with `manager_id`, `title`,
`territory`, and a nightly job that writes the "best" value into each column. That design
loses immediately, for three reasons: you have built a worse copy of Workday; you have
thrown away the evidence, so you can never answer *why*; and changing which system is
authoritative becomes a migration.

Instead, the system stores **immutable per-source assertions** — one system's claim about
one field of one person, with two timestamps — and computes the answer at read time:

```
source records → identities → assertions → policy → resolved truth
```

Every number, every org chart edge, every profile field in the application is the output of
that function. Change the policy in Admin and the whole application re-answers instantly,
with no migration and no re-sync, because nothing merged was ever stored. That is the demo
worth showing, and it is also the reason the product can be sold to a customer who wants
their own opinion about which system wins.

### Two timestamps, not one

Every assertion carries:

- **`observedAt`** — when *we* read it from the source system (sync freshness)
- **`effectiveFrom`** — when the *source* says the fact became true (business time)

Keeping those apart is the difference between a product and a noise generator. A promotion
Workday has effective-dated for the first of next month is not a conflict today. A territory
system that last ran on Sunday is not wrong about a change made on Tuesday — it is behind.
Systems that support effective dating (Workday, the planning system) are marked as such;
the CRM and revenue tools only know what they hold right now, and the engine treats their
timestamps accordingly.

### Three kinds of disagreement

| | meaning | action |
|---|---|---|
| **Divergence** | Both systems read recently, both confident, values differ | Someone must fix something |
| **Lag** | A system has not been read since the value changed | None — resolves on next sync |
| **Gap** | A system that should carry the field is empty | Populate it |

Only divergence and gaps generate remediation tasks. Lag is displayed and excluded from
the queue. This distinction is the main thing separating a credible product from the
spreadsheet of 4,000 differences that every customer already knows how to ignore.

## Identity resolution comes first

Nothing downstream works until the platform knows who is who, and matching is fuzzy in real
life: emails don't match, contractors have no HR record, rehires leave duplicate CRM users,
service accounts look like people. A wrong match doesn't produce a small error — it produces
a confident lie about someone.

So matches are **scored, not boolean**:

| rule | confidence |
|---|---|
| Work email matches exactly | 98% |
| Employee ID cross-referenced | 96% |
| Full name and team match, email does not | 66% |
| Full name matches, nothing corroborates | 45% |

At or above 90% the link is applied automatically. Between 40% and 90% it becomes a queue
item a human decides. Below that it is not a match. The seed data deliberately contains
seats that land in the middle — a Gong licence under a personal alias, an orphaned demo
account, contractors with CRM access and no worker record — because a visible queue of
uncertain matches is a better product than a silent one that invented facts.

The seed emits **only per-source records**. There is no ground-truth roster anywhere in the
output: the application discovers its ~91 people the same way it would in production.

## What is in the prototype

| Screen | What it demonstrates |
|---|---|
| **Login** | Four roles, each landing somewhere different |
| **Dashboard** | Role-scoped rollup, organizational change feed, connector health |
| **Explorer** | Drill through a *configurable* hierarchy; reporting-tree view; people cards |
| **Profile** | Overview / Organization / Go-to-market / Systems / Data integrity, with deep links out to every source system |
| **Data integrity** | Every finding, filterable, each one explaining its own classification |
| **Identity** | The review queue, the scoring rules, flagged duplicates and ghost accounts |
| **Metrics** | Why the same metric reads differently in three systems, reconciled term by term |
| **Systems** | Six simulated connectors and how an integration plugs in |
| **Remediation** | Each actionable finding as a specific instruction with an owner |
| **Admin** | System-of-record policy with a live impact preview; hierarchy configuration; the permission model |

**The moment worth demoing:** Admin → Systems of record → *Territory* → make Salesforce
authoritative. Watch the resolved values, the org data, the findings and the remediation
tasks all change. Then note what the page tells you honestly: changing the system of record
usually doesn't *reduce* the number of disagreements, it changes which side is considered
wrong — and therefore which team gets the work.

### Deliberately not built

- **Write-back into source systems.** Detection plus a specific, evidenced instruction is
  sellable. Pushing corrections into a customer's Workday makes us liable for the state of
  their HRIS on day one, and no buyer grants a new vendor that access anyway.
- **A general metric-lineage engine.** Section 6 of the brief — "why don't these numbers
  match" across the warehouse and BI layer — needs query lineage and a semantic layer. It is
  a different product and a multi-year one. What is here is one narrow, fully computed
  worked example that proves the idea without promising the engine.
- **Real authentication and server-side authorization.** The permission model exists in the
  data (every field is classified `public` / `internal` / `restricted`, every role has a
  scope) and the interface honours it, but interface enforcement is not enforcement.

## Code layout

```
src/core/          the engine — no DOM, no framework, runs in Node
  model.js         systems, canonical field catalog, hierarchy levels, roles
  seed.js          synthetic source records for six systems (deterministic)
  adapters.js      per-vendor translation: identity keys + assertions   ← the integration seam
  identity.js      scored matching, clustering, the review queue
  policy.js        system-of-record policy per field
  resolve.js       resolution, conflict classification, alignment scoring, the org graph
  tasks.js         remediation items
  metrics.js       metric reconciliation
  store.js         mutable state; re-runs the pipeline on any change
src/ui/            presentation — plain functions returning HTML strings
scripts/           build, headless engine check, browser smoke test
```

`src/core` has no dependency on the browser or on the mock data — `engine_check.js` runs the
entire pipeline in Node and asserts its output. That is the part that becomes the product.

## Turning this into a real product

Roughly in order of what would need to happen:

1. **Wrap the UI in Next.js + TypeScript.** The view functions become React components with
   the same signatures. `src/core` moves into a package essentially unchanged.
2. **Move the engine server-side, behind Postgres.** The tables follow the model directly:
   `sources`, `source_records`, `identities`, `identity_links`, `assertions` (append-only),
   `policies`, `findings`, `tasks`. `resolveAll()` becomes an incremental job plus a query
   layer rather than a full recompute — the computation's shape does not change.
3. **Replace fixtures with real connectors.** Only `adapters.js` changes: the fetch becomes
   an API call, the output shape stays. One adapter per system, roughly forty lines.
4. **Authorization below the API.** Row- and field-level checks evaluated server-side on
   every read, per-tenant isolation, an immutable audit log of every resolved value served
   and every policy change. The sensitivity labels already exist on every field, so this is a
   filter over labelled data rather than a schema change.
5. **SSO and SCIM**, then the compliance work the buyer's security review will demand.

## Data

Entirely synthetic and generated deterministically from a fixed seed. One fictional company
(Cobalt Systems), ~91 people, ~450 source records, ~500 accounts and ~440 opportunities
across six simulated connectors. No live system is contacted, no credentials exist anywhere
in the codebase, and no real personal or company data is used.

The discrepancies are deliberate and documented in `seed.js`: a reorganization three days
old that slow connectors have not seen, hand-edited CRM hierarchies, territory drift,
terminated workers with live system access, a rehire's duplicate user, quota loaded into the
forecast tool before the CRM, promotions effective next month, a connector that has been
failing for nine days, and seats that belong to nobody.
