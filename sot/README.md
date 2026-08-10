# SOT — Source of Truth

**Kaliris Labs** · prototype

*Everything you know about someone, in one place.*

A unified entity graph across every system an organization runs. It resolves one identity per
person, place and event, computes each field from a policy the customer owns, and links
everything to everything else so a user can follow a question from a clinician to a ward to a
visit to a patient to the nurse who was on that visit — without leaving the page they started on.

```
python3 sot/scripts/build.py      # bundle to dist/sot.html
node sot/scripts/engine_check.js  # run the engine headless, assert its output
node sot/scripts/smoke.js         # drive the built app through every screen
```

Open `dist/sot.html` in any browser. No server, no build step, no dependencies.

---

## The idea

Every organization keeps the same information in five or six places that quietly disagree. A
hospital's HR system, EHR, scheduling platform, credentialing file, billing system and badge
reader each hold a version of who a clinician is, which ward they work, and whether they are
still employed. Nobody can say which one to believe, and no system above them can answer a
question that crosses two of them.

SOT sits above them and does three things:

1. **Resolves identity.** Works out that an Epic user, a Workday worker, a UKG person number and
   a badge record are one human being — with a confidence score, and a review queue for
   everything it isn't sure about.
2. **Resolves truth.** Computes every field at read time from a system-of-record policy, keeping
   each system's claim as evidence rather than overwriting it.
3. **Resolves relationships.** Stores every connection as a typed, **time-bounded** edge, so the
   past is queryable rather than lost.

## The two decisions everything rests on

### Every entity is equal

There is no privileged "employee" object. A clinician, a patient, a ward, a facility and a visit
are all entities: something with resolved fields, provenance, statistics and typed relationships.
They all render through **one** entity page. That is why the product can promise infinite
drill-through — there is no dead end where you reach a thing that isn't a first-class record.

### No golden record is ever stored

The obvious build is a wide table with a nightly job writing the "best" value into each column.
That loses immediately: you've built a worse copy of the source system, you've thrown away the
evidence so you can never answer *why*, and changing which system is authoritative becomes a
migration.

Instead the platform stores immutable **assertions** — one system's claim about one field of one
entity — and computes the answer from a policy:

```
source records → identities → assertions → policy → resolved entities → graph → statistics
```

Change the policy in Admin and every screen re-answers instantly. Nothing merged was ever stored,
so there is nothing to migrate.

### Time is on the edges

Every relationship carries `fromTs` and `toTs`. That single detail is what makes the product able
to answer:

- *Who used to cover that territory?*
- *Who was on the ward in March?*
- *Which platoon was this member in before the reassignment?*
- *Who was the nurse on that visit two years ago?*

All of them are the same query against the same edge table. A graph of current-state pointers —
which is what almost every source system stores — cannot answer any of them.

## Two timestamps, three kinds of disagreement

Every assertion carries **when we read it** (`observedAt`) and **when the source says it became
true** (`effectiveFrom`). Keeping those apart lets the engine classify rather than merely count:

| | meaning | action |
|---|---|---|
| **Divergence** | Both systems read recently, both confident, values differ | Someone must fix something |
| **Lag** | A system hasn't been read since the value changed | None — resolves on next sync |
| **Gap** | A system that should carry the field is empty | Populate it |

Only divergence and gaps raise remediation tasks. Reporting lag as a defect is exactly how
reconciliation tools produce four thousand findings, half of which fix themselves overnight, and
lose the customer's trust in the other half.

## Identity resolution comes first

Nothing works until the platform knows who is who, and matching is fuzzy in reality: agency staff
have no HR record, rehires leave duplicate logins, credentialing files key on provider number
rather than employee ID, two medical record numbers describe one patient. A wrong match doesn't
cause a small error — it causes a confident lie about a person, and in a hospital that lie gets
attached to a chart.

So matches are **scored**. Structural codes, work email, employee ID and provider numbers link
automatically; name-and-date-of-birth or name-and-unit go to a human queue; name alone is not a
match. The seeded data deliberately contains all of these, because a visible queue of uncertain
matches is a better product than a silent one that invented facts.

## Two verticals, one engine

The engine knows nothing about hospitals. Everything domain-specific lives in a **vertical pack**
that declares systems, entity types, relationship types, fields, policy, roles and statistics.

| | **Health system** | **Defence command** |
|---|---|---|
| Tenant | St. Aldwyn Health | Joint Task Force Meridian |
| Entities | staff, patients, units, facilities, visits | personnel, units, installations, readiness events |
| Systems | Epic, Workday, UKG, symplr, Waystar, Lenel | Personnel, Training, Medical readiness, Clearance, Installation access |
| Signature question | *Who was the nurse on that visit, and is their licence current?* | *Who was in that platoon in March, and is their clearance current?* |

Switch between them in the header. Identity resolution, conflict classification, the graph, the
statistics runner and the entire interface are byte-for-byte the same. The same architecture
serves a sales organization (people, territories, accounts), a police force, a university, or a
chain of salons — the pack is the difference.

## Roles are scopes, not menus

Permissions are modelled on the data, not hidden in the interface:

- **Attending physician** — all staff; only patients and visits in their care; clinical detail visible.
- **Nurse manager** — their ward's roster, its visits, and the patients on it. Nothing else.
- **Operations executive** — the whole system, with clinical detail redacted.
- **Workforce operations** — all staff. Cannot open a patient at all; the records are not in scope.
- **Access & compliance** — credentials, access and every record that disagrees.

Every field carries a sensitivity (`public` / `internal` / `confidential` / `protected`) and every
role a maximum. An executive can count patients without seeing a diagnosis.

## What's in the prototype

| Screen | What it demonstrates |
|---|---|
| **Sign-in** | Two verticals, five roles, each landing somewhere different |
| **Overview** | Counts per entity type, findings by kind, connector health, recent activity |
| **Browse** | Any entity type as a table with its own statistics as columns |
| **Entity page** | Overview · Connections · Timeline · Systems · Integrity — for every entity type |
| **Data integrity** | Every finding, filterable, each explaining its own classification |
| **Identity** | The review queue, the scoring rules, duplicates and unmatched accounts |
| **Remediation** | Each actionable finding as an instruction with a named owner |
| **Systems** | Connector health and how an integration plugs in |
| **Admin** | Policy with a live impact preview, the model itself, roles and sensitivity |

Two things worth doing in a demo:

1. **Follow a thread.** Open a clinician → Connections → their ward → *Show previous* on the staff
   roster → someone who left → their visits → a patient → the care team on that visit. The trail
   in the header keeps the whole path clickable.
2. **Move the policy.** Admin → Systems of record → *Home unit* → make Workday authoritative.
   The preview computes how many people change their answer before you commit, and the page tells
   you the honest truth: changing the system of record rarely reduces the number of disagreements,
   it changes which side is wrong — and therefore which team gets the work.

### Deliberately not built

- **Write-back into source systems.** Detection plus an evidenced instruction is sellable. Writing
  corrections into a customer's EHR makes us liable for a clinical record on day one, and no
  hospital grants a new vendor that access anyway.
- **Real authentication and server-side authorization.** The permission model exists in the data
  and the interface honours it, but interface enforcement is not enforcement.
- **Anything that needs a real credential.** No live system is contacted anywhere.

## Code layout

```
src/core/            the engine — no DOM, no framework, runs in Node
  schema.js          entities, assertions, edges, sensitivity, match strengths
  graph.js           typed, time-bounded relationships, indexed both ways
  identity.js        scored matching, clustering, the review queue
  resolve.js         resolution, conflict classification, alignment scoring
  stats.js           per-entity-type statistics computed from the graph
  tasks.js           remediation items with owners
  store.js           mutable state; re-runs the pipeline on any change
  packs/health.js    the hospital: systems, entities, edges, fields, roles, seed
  packs/defense.js   the command: same shape, different world
src/ui/              presentation — plain functions returning HTML strings
scripts/             build, headless engine check, browser smoke test
brand/               the mark and the lockup
```

`src/core` has no browser dependency — `engine_check.js` runs the whole pipeline in Node and
asserts its output. That is the part that becomes the product.

## Turning this into a real product

1. **Wrap the UI in Next.js + TypeScript.** The view functions become components with the same
   signatures; `src/core` moves into a package essentially unchanged.
2. **Move the engine server-side, behind Postgres.** Tables follow the model directly: `sources`,
   `source_records`, `entities`, `entity_links`, `assertions` (append-only), `edges` (with valid-time
   columns), `policies`, `findings`, `tasks`. `resolveAll()` becomes an incremental job plus a
   query layer; the shape of the computation doesn't change.
3. **Replace fixtures with real connectors.** Only the pack's `adapters` change: the fetch becomes
   an API call (FHIR, HL7, SCIM, vendor REST), the output shape stays. One adapter per system.
4. **Authorization below the API**, per-tenant isolation, and an immutable audit log of every value
   served and every policy change. Every field is already classified, so this is a filter over
   labelled data rather than a schema change.
5. **SSO, then the compliance work** the buyer's security review will demand — HIPAA and SOC 2 for
   health, the equivalent controls for public sector.

## Data

Entirely synthetic and generated deterministically from a fixed seed. The health pack builds ~716
entities from ~1,940 source records across six simulated connectors; the defence pack ~1,570
entities from ~2,750. **No live system is contacted, no credentials exist anywhere in the
codebase, and no real personal, clinical or personnel data is used.** All names, identifiers,
diagnoses and readiness data are fabricated.

The disagreements are deliberate and documented in each pack: a lapsed licence still on the
schedule, terminated workers with live chart access and active badges, a ward transfer four days
old that slower connectors haven't seen, agency staff with no HR record, a rehire's duplicate
login, two medical record numbers for one patient, dates of birth that disagree between
registration and billing, billed days that don't match the clinical stay, and a badge connector
that has been failing for eleven days.
