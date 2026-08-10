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

## Six industries, one engine

The engine knows nothing about hospitals. Everything domain-specific lives in a **vertical pack**
that declares systems, entity types, relationship types, fields, policy, roles and statistics.
Six ship in the box:

| Tenant | Industry | People / places / events | Signature question |
|---|---|---|---|
| St. Aldwyn Health | Healthcare | staff · patients · units · facilities · visits | *Who was the nurse on that visit, and is their licence current?* |
| Joint Task Force Meridian | Public sector & defence | personnel · units · installations · readiness events | *Who was in that platoon in March, and is their clearance current?* |
| Vestry & Bloom | Personal services | team · guests · departments · locations · appointments | *Who cut this guest's hair last time, and were they licensed that day?* |
| Thornfield University | Higher education | faculty · students · departments · campuses · enrolments | *Who taught this section, and do the bursar and the registrar agree on the credits?* |
| Halyard Wealth Partners | Financial services | advisers · households · desks · offices · reviews | *Who advised this household before the current adviser, and was their registration live?* |
| Cardinal Freightways | Transportation | drivers · shippers · fleets · terminals · loads | *Who ran this load, and do dispatch, the ELD and the invoice agree on the miles?* |

Switch between them in the header. Identity resolution, conflict classification, the graph, the
statistics runner and the entire interface are byte-for-byte the same.

### Adding an industry is a declaration

Two packs are hand-written (`packs/health.js`, `packs/defense.js`). The other four are declared
against a toolkit (`packs/kit.js`) that supplies a deliberately small skeleton:

```
site     somewhere work happens        hospital · campus · branch · terminal · salon
group    a team inside a site          ward · department · desk · fleet · chair row
worker   someone who does the work     nurse · lecturer · adviser · driver · stylist
client   someone the work is done for  patient · student · household · shipper · guest
event    a dated thing joining them    visit · enrolment · review · load · appointment
```

A pack supplies the vocabulary, the systems, a field map per system, the policy, the roles, how
much data to generate and which of the standard failure modes to inject — a lapsed credential, a
leaver with live access, a transfer the slow connector hasn't seen, a duplicate record, a billing
figure that disagrees with what was delivered. The kit produces source records, adapters,
time-bounded edges and statistics. Nothing downstream can tell a declared pack from a
hand-written one, which is the point.

A police force, a construction firm, a home-care agency or a law practice are the same shape.

## Operator console

Sign in as **Kaliris Labs** rather than into a tenant and you get the platform view:

| Page | What it shows |
|---|---|
| **Tenants** | Every organization on the instance — entities, records, connectors, findings, alignment. Click into any of them. |
| **Connectors** | All 31 integrations across all tenants, worst first, with the notices explaining each degraded one. |
| **Model** | What a chosen tenant declares: entity types, relationship types, the full field catalog, and the shared matching rules. |
| **Access** | Operator accounts, and every tenant role with its scope and maximum sensitivity. |
| **Activity** | Policy edits, identity decisions and remediation calls — the actions that change what the platform reports as true. |
| **Roadmap** | What is left to build, in dependency order, including the decisions that are yours rather than engineering's. |

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
| **Operator console** | The platform view across every tenant, plus the build roadmap |

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
  packs/kit.js       vertical toolkit — turns a declaration into a whole world
  packs/health.js    the hospital, hand-written
  packs/defense.js   the command, hand-written
  packs/verticals.js salon, university, wealth manager and freight carrier, declared
src/ui/              presentation — plain functions returning HTML strings
  views.js           dashboard, browser, and the universal entity page
  views-admin.js     integrity, identity, systems, remediation, admin
  views-owner.js     the operator console and the roadmap
scripts/             build, headless engine check, browser smoke test
brand/               the mark and the lockup
```

`src/core` has no browser dependency — `engine_check.js` runs the whole pipeline in Node and
asserts its output for **every** vertical: that each entity type resolves, no edge dangles, every
field is reachable, findings of all three kinds appear, history is queryable, and every role
produces a coherent non-empty scope. `smoke.js` then drives the built bundle through 128 checks
in a real browser, including the full drill-through path and every screen of every tenant.

## Turning this into a real product

The same list is in the app under **Operator console → Roadmap**, with the reasoning for each
item and the decisions that are yours rather than engineering's.

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

Entirely synthetic and generated deterministically from fixed seeds. Across the six tenants:
**9,117 resolved entities, 21,900 source records, 29,663 time-bounded relationships and 31
simulated connectors.**

| Tenant | Entities | Records | Edges | Findings | Identity queue |
|---|---|---|---|---|---|
| St. Aldwyn Health | 716 | 1,942 | 3,046 | 39 | 10 |
| Joint Task Force Meridian | 1,704 | 2,982 | 3,080 | 18 | 6 |
| Vestry & Bloom | 1,604 | 3,344 | 5,598 | 36 | 11 |
| Thornfield University | 1,554 | 4,754 | 5,307 | 40 | 14 |
| Halyard Wealth Partners | 1,741 | 3,609 | 6,097 | 42 | 11 |
| Cardinal Freightways | 1,798 | 5,269 | 6,535 | 35 | 14 |

**No live system is contacted, no credentials exist anywhere in the codebase, and no real
personal, clinical, financial or personnel data is used.** All names, identifiers, diagnoses,
account numbers and readiness data are fabricated.

The disagreements are deliberate and documented in each pack: a lapsed licence still on the
schedule, terminated workers with live chart access and active badges, a ward transfer four days
old that slower connectors haven't seen, agency staff with no HR record, a rehire's duplicate
login, two medical record numbers for one patient, dates of birth that disagree between
registration and billing, billed days that don't match the clinical stay, and a badge connector
that has been failing for eleven days.
