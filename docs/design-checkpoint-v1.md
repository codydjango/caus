# Causality — Design Checkpoint

*An event-sourced 4X game where the world's event log is a contested resource.*

---

## Concept

A 4X-lite (expand / exploit / exterminate, plus an expanded eXplore axis) where the world is event-sourced and players can manipulate the log itself as a gameplay mechanic. Standard strategic play sits on top of an event ledger; rare/expensive actions let players reach into the ledger to rewind, fork, or force timelines.

The design thesis: event sourcing isn't just plumbing here — it's the feature. Mechanics like rollback, forking, and force-forward are only cleanly implementable on an event-sourced foundation, and they create gameplay impossible in conventional architectures.

---

## Core gameplay loop

1. Players issue commands (move unit, build, mine, attack, ally, etc.)
2. Commands are validated against current projection and appended to the world event log as events
3. Projections render current state (map, resources, armies, diplomacy)
4. Real-time encounters (combat, mining contests) are resolved in Durable Objects, which emit summary events back to the ledger
5. Rare temporal actions let players manipulate the log itself

---

## Signature mechanics

### Temporal Strike (rollback)

A player spends Chronite (scarce resource) to roll back a **time window** of events within a **scope**. Example:

```
TemporalStrike(
  target_region: "Vael Basin",
  window: 10 minutes,
  scope: ["resource_production", "unit_movement"]
)
```

All events matching scope in `[now - window, now]` are voided; the affected projection is rebuilt. Events outside the scope (diplomacy, distant battles) are untouched.

**Key design choice: time is the unit, not event count.** Time matches how players remember play ("undo the bad thing 10 minutes ago"), is invariant to event-schema changes, and naturally rewinds cascading events (a 3-minute plant growth chain unwinds automatically because its triggering conditions no longer hold during replay).

### Schism (forking)

A player forks a region into a parallel branch. Both timelines run independently for K turns; the forking player can act in both. The fork must eventually be collapsed; the discarded branch's events are voided, with partial refund of resources gained there. Opponents in the forked region also get to act in both branches.

### Chronomantic Seal (Force Forward)

A rare held item. When a rollback hits a player, they can play a Seal to **force the timeline forward**, restoring all rolled-back events to their original world-clock positions.

This turns rollback from a one-way subtractive attack into a contested temporal duel. Critically:

- **Costs of the original rollback remain paid** even if forced forward (otherwise aggressor gets a free retry).
- **Force Forward clobbers any actions taken in the window after the rollback** — including third parties who acted there. This creates *collateral political damage* and naturally generates alliances and grudges.
- **Seals are hidden information** — players know Seals exist in the game but not who holds one. Every Temporal Strike is a calculated risk against the possibility of a Seal counter.

### Temporal Acceptance (third option)

Defender voluntarily accepts a rollback in exchange for a small Chronite refund or future-turn bonus. Important because without it, players holding Seals feel obligated to play them, eliminating the bluff layer. With it, defenders choose between: accept (cheap, you lose ground), Force Forward (expensive item, full counter), or do nothing (worst case: you lose ground and signal you might not have a Seal).

### Causality Anchors

Players can spend resources to anchor specific events, making them immune to rollback *and* immune to being clobbered by Force Forward. Anchors are the defensive layer against temporal mechanics on both axes.

---

## Rollback time tiers

Rough tuning targets (numbers to be calibrated against tick rate and play density):

| Tier | Window | Use case |
|---|---|---|
| Tactical | 30s – 2min | Single battle, misclick, opening move |
| Strategic | 5 – 15min | Military buildup, coordinated push, turn of gathering |
| Catastrophic | 30min – 1hr | Endgame, extreme cost, once-per-match narrative pivot |

Number of events undone is whatever happens to fall in the window — which is the point. Players learn to time rollbacks for high-density windows.

---

## Sample gameplay user story

Turn 47–50, three players: Mara, Kestrel, Doru.

1. Mara has built up Chronite over 8 turns. Kestrel is 2 turns from invading her fortified mining outpost.
2. **Turn 48:** Mara plays Temporal Strike on Kestrel's military buildup, scoped to 4 turns of unit production in their capital. Kestrel's army is unmade. Doru, mining the basin's edge, loses some yield as collateral (basin resource state was in scope). He's annoyed but not destroyed.
3. **Turn 49:** Kestrel reveals a Chronomantic Seal. Rollback is reversed. Their army snaps back. Mara's defensive prep from turn 48 is erased. Her Chronite is permanently spent. Doru's caravan move from turn 48 is also erased — he's now *furious* and not at Mara.
4. **Turn 50:** Kestrel marches on Mara. Doru opens trade to Mara to spite Kestrel. A coalition forms not from prior alliance but from *collateral temporal damage*.

The mechanics generate diplomatic content. This is the design payoff.

---

## Visual goal

A logarithmic timeline scrub — recent events spread out, older events compressed. Rollback plays as a visible rewind: plants un-growing, units un-moving, fog of war un-revealing. Possible because:

1. Events are timestamped
2. Projections are deterministic functions of events
3. Scope filter lets us rewind some state while leaving UI/camera/chat stable

This is the trailer moment.

---

## Architecture

### Three projection tiers

**1. World ledger (authoritative, durable)**
- Append-only event store (Postgres is fine)
- Event types: `UnitMoved`, `ResourceMined`, `BattleResolved`, `TimelineForked`, `RollbackApplied`, `BranchCollapsed`, `ForceForwardApplied`, etc.
- Every event carries `wall_clock_at` and `world_clock_at` timestamps
- Source of truth; slow, consistent

**2. Strategic projections (eventually consistent, ~seconds)**
- Materialized views of map, player resources, diplomacy
- Rebuilt on demand for rollback/fork operations
- Read-heavy, cacheable
- Index events on `(world_clock_at, scope_tag, region_id)` for efficient temporal queries

**3. Tactical authority (real-time, strict consistency) via Cloudflare Durable Objects**
- Spawned per encounter site (battle, mining contest)
- **Authoritative for state inside the encounter for the duration of the encounter** — not a cache of the ledger
- Hold local state (HP, positions, progress, held reactive items), real-time WebSocket inputs from participants
- Last-moment reactive plays (shields, parries, in-encounter item use) resolved with strict consistency inside the DO
- On encounter end, emit summary event(s) (`BattleResolved` with outcomes, casualties, items consumed, spoils) back to ledger
- Perfect match for "many actors, one location, short-lived intense coordination"

### Command flow

```
Player → Command API
       → validate against current projection
       → append event(s) to ledger
       → notify projection workers
       → (if tactical) spawn/route to Durable Object
```

### Rollback flow

```
TemporalStrike command
  → validate (cost, scope, not hitting anchored events)
  → append RollbackRequested event
  → projection worker: rebuild affected projection by replaying
    events with scoped-affected events filtered/voided
  → emit RollbackApplied event with summary
  → notify affected players (Seal opportunity opens)
```

### Force Forward flow

```
ChronomanticSeal command (within reaction window after RollbackApplied)
  → validate (Seal held, target rollback exists, within window)
  → append ForceForwardApplied event
  → projection worker: restore voided events, void any actions
    taken in the rollback's after-window
  → notify all affected players (including collateral parties)
```

### Consistency model — authority transfers, ledger catches up

Competitive integrity requires that decisions are made against authoritative state, never stale projections. The architecture handles this not by forcing every action through a globally-consistent ledger (slow, fragile) but by **transferring authority** to the right coordinator at the right time:

- **Default authority: world ledger.** All standard commands validate against the current projection and append to the ledger. Strategic state can be eventually consistent on the order of seconds because no real-time decisions depend on it.
- **During an encounter: the Durable Object is authoritative** for everything inside its scope. Players in the encounter talk directly to the DO over WebSocket and see its authoritative state with low latency. Reactive items (shields, parries, last-moment plays) resolve inside the DO with strict consistency. The ledger sees nothing in real time; it receives summary events when the encounter ends.
- **During a reaction window: a per-event coordinator is authoritative.** When a player must respond to a rollback (Seal/accept/wait), the affected world-clock scope is frozen until they respond or the timer expires.

The principle: **the ledger is the durable, replayable record of what happened. Authoritative resolution can happen elsewhere as long as resulting events flow back.** Spectator views may lag by a fraction of a second — fine, they're not making decisions. Players inside the live coordination see real-time authoritative state.

This is how high-stakes real-time systems on event-sourced architectures actually work (trading systems, multiplayer game servers). It buys strict consistency where it matters without paying for it everywhere.

### Reaction window protocol

A first-class concept, not an afterthought. Used for any reactive play that affects the world ledger (Seal in response to Strike, and potentially others):

1. Triggering event hits the ledger (e.g., `RollbackRequested`)
2. System opens a **reaction window** — e.g., 30 seconds wall-clock — and notifies eligible players
3. Affected world-clock scope is **frozen**: no new events accepted in that scope during the window
4. Affected players' sessions enter "reaction pending" state — they can play a counter, accept, or wait out the timer
5. Window closes → committing event is appended (`RollbackApplied`, `ForceForwardApplied`, or `RollbackAccepted`); scope unfreezes

Window events are themselves recorded in the ledger (`ReactionWindowOpened`, `ReactionWindowClosed`) so the audit/replay story stays complete.

**Design payoff:** the reaction window is a dramatic competitive moment. The match pauses while everyone watches to see if a Seal comes out. This is a feature, not a cost — the bluff layer becomes visible to spectators and the tension is real.

### Snapshot strategy

Projections aren't recomputed from world creation every time. The system maintains periodic snapshots (per region, every minute of world-clock or so) so replay starts from the most recent pre-window snapshot rather than from the beginning of time.

Natural snapshot points: right after an encounter resolves, after a rollback applies, after a reaction window closes — moments when state is known-coherent and nothing is in flight.

Rollback flow with snapshots:
1. Discard snapshots after the rollback window
2. Load most recent snapshot before the window
3. Replay events from snapshot to rollback start, applying the scope filter (rolled-back events voided)
4. Write a new snapshot at the rollback point
5. Resume normal play

This keeps replay cost proportional to `(window_size + snapshot_interval)` rather than total world age — load-bearing for keeping rollbacks tractable as worlds get large.


### Fork flow

- Events get a `branch_id`
- Active projection per player resolves to a specific branch
- Collapse appends `BranchCollapsed`, marks discarded branch's events as historical-only

### Wall clock vs world clock

Rollback operates on **world_clock_at**. The world clock advances only while the simulation runs (pauses, maintenance, async-turn waits don't count). Force Forward restores events to their original world-clock positions; the simulation resumes from there. This prevents exploits like "rollback through an opponent's lunch break."

---

## Aggregates and consistency boundaries

### Principle

An aggregate is a consistency boundary. Inside the boundary, invariants are enforced strictly within a single transaction. Across boundaries, you can't — at least not without distributed coordination (process managers, sagas, compensations). The discipline: make aggregates as small as possible while keeping inside them all invariants that *must* hold synchronously; accept eventual consistency for everything else.

The cost of getting this wrong: either aggregates become god-objects that serialize too much (terrible for concurrency), or invariants scatter across boundaries and sagas proliferate (terrible for complexity).

### Candidate aggregates

| Aggregate | Owns | Lifecycle |
|---|---|---|
| **Player** | Held resources (Ore, Chronite), inventory (Seals), faction state, command rate limits | Long-lived |
| **Site** | Occupancy, current building, building progress, local deposits, anchor refs | Long-lived |
| **Unit** (or Army) | Position, HP, members, current orders, equipment | Created/destroyed during play |
| **Branch / Timeline** | branch_id, parent branch, divergence point, collapse rules | Created on fork, destroyed on collapse |
| **Encounter** (DO-backed) | Real-time tactical state during active encounter | Short-lived; spawn on encounter start, destroy on resolution |
| **ReactionWindow** | Open/closed status, eligible reactors, expiry, triggering event | Short-lived; seconds |
| **Anchor** | Protected event ref, protecting player ref | Long-lived until consumed/expired |

Working list, not final. Anchors get their own aggregate to sidestep the question of where they "live" — gives rollback-validation a single thing to query.

### Cross-aggregate hotspots

The intersections that matter, with how each is handled:

**1. Player resources + any action that costs resources.** The most common cross-aggregate transaction (every move, build, attack, Strike). Pattern: command targets the consuming aggregate, with resource debit as a co-event on the Player aggregate. Validate optimistically against the projection; treat the player debit as a near-certainly-successful follow-up. Failures (concurrent spending) are rare and handled by compensation. Technically eventual consistency on player resources, but the window is sub-second and over-spending is recoverable.

**2. Site occupancy + Unit position.** When a unit claims a site, the **Site aggregate wins** — occupancy is its invariant, so site-claim commands serialize on Site. The losing unit emits `MovementBlocked` and Unit state updates as a follow-up.

**3. Encounter spawn — many units, many players, one site.** **Site is authoritative for "is there an active encounter here?"** Spawning is a command on Site that emits `EncounterStarted`; the Encounter DO is born from that event with hydrated unit state. During the encounter, authority transfers to the DO (per the consistency model section). On resolution, the DO's summary event fans out to update Site, Units, Players.

**4. Building construction (the button-factory case).** Cross-aggregate: Site (vacant?) + Player (materials? level?). Modeled as a **process manager**:
   1. Validate preconditions against current projection
   2. Reserve materials on Player (`MaterialsReserved`)
   3. Claim site (`SiteClaimedForBuilding`)
   4. Both succeed → `BuildingStarted`
   5. Site claim fails → compensate (`MaterialsReleased`)

   Acceptable because building isn't a real-time competitive moment — 200ms of serialization is invisible.

**5. Temporal Strike — touches everything.** Can't be a single transaction. Modeled as **macro-event + aggregate-local events**:
   - `RollbackRequested` synchronously validates Player (Chronite) and scope
   - Fan-out process manager iterates affected aggregates, emitting voiding events for each (their own event streams)
   - Reaction window holds everything suspended
   - `RollbackApplied` is the commit point summarizing what was voided
   
   World ledger sees both layers (macro + aggregate-local). Aggregates see only their local events. Projections build from either view depending on what they need.

### The pattern that emerges

- **Hot-path real-time competition** → authority transfers to a single coordinator (DO); no cross-aggregate transactions during the encounter window
- **Strategic commands with cross-aggregate preconditions** → small, named process managers per command type, with compensation for the rare failure
- **World-touching actions (rollback, fork)** → macro-events at world level + aggregate-local events; both recorded
- **Cost / resource debit** → eventually consistent with the action it pays for, validated optimistically against the projection

The architecture buys consistency where it's needed by *concentrating* it in the right places (DOs for tactical, reaction windows for reactive plays, Site aggregates for occupancy) rather than spreading it thinly across everything.

### What's deferred

Exact event lists per aggregate, exact process-manager state machines, exact compensation handlers — all v0 implementation work, firmed up while writing code. The decisions captured here are the ones hard to retrofit later.

---

## Performance and scaling

### The key property

**Projection rebuild cost scales with events-in-scope, not events-in-world.** Tightly-scoped rollbacks (region + subsystem + bounded time window) keep replay tractable even in worlds with hundreds of millions of total events. This is why the scope-filter design isn't just gameplay constraint — it's a performance constraint disguised as gameplay constraint. Design and architecture are aligned.

### Real concerns at scale

1. **Index pressure on the event table.** Indexes on `(world_clock_at, scope_tag)`, `(region_id, world_clock_at)`, `(branch_id, world_clock_at)` get large and write-heavy. Postgres handles this well into hundreds of millions of rows with time-based partitioning.
2. **Projection rebuild latency on large scopes.** Mitigated by the snapshot strategy above.
3. **Hot-path contention on popular regions.** What Durable Objects are *for* — DO serializes the interaction and emits one summary event; the ledger never sees the contention.
4. **Projection invalidation fan-out.** Treat projections as functions of `(snapshot_id, scope_filter)` with predictable cache keys so invalidation is set-based, not graph-based.

### Polyglot architecture (a future seam, not v0 work)

A clean language seam exists between "write events" (any language) and "replay events to derive state" (where per-event constants matter at scale):

- **Command/API layer** — Python/Django or TypeScript. Schemas, validation, business logic; iteration speed matters.
- **Durable Objects** — TypeScript (platform requirement). Encounter resolution.
- **Projection/replay engine** — eventual Rust candidate. Tight loop over many events, deterministic state folding. Snapshot generation has the same workload shape.
- **Event store + projection snapshots** — Postgres.

For v0: build everything in the comfort language (Python/Django given existing fluency). Instrument projection rebuild latency. Build the snapshot system early — it's load-bearing regardless of language. If projection rebuild becomes the bottleneck and snapshot-tuning + indexing have been exhausted, *then* extract the replay engine into Rust as a targeted hot-path replacement. The seam makes that a contained project, not a rewrite.

This is the right way to introduce Rust to a system being learned: as a hot-path replacement, not the language of the whole system.

### What not to over-engineer at v0

The smallest-viable spec won't hit any of these scaling problems. Architectural choices that matter *now*:

1. **Event schema** — scope tags, timestamps, branch IDs. Hard to change later.
2. **Snapshot system** — even if it feels unnecessary at small scale.
3. **Language seam** — keep replay logic in a self-contained module so it can be rewritten later without touching everything else.



Enough to prove the architecture and the mechanic:

- 2 resources: one mundane (Ore), one temporal (Chronite)
- 1 unit type
- 1 building type
- Sites as a graph of named nodes (hex grid is a v1 concern)
- Mining (tactical, DO-mediated)
- Combat (tactical, DO-mediated)
- 1 rollback mechanic (Temporal Strike)
- 1 counter mechanic (Chronomantic Seal / Force Forward)
- 1 anchor mechanic
- Async-tick play (commands queue, resolve every N seconds)
- No UI — CLI or JSON API for v0

---

## Open design threads

Things to dig into when this picks up again:

1. **Scope filter definition** — regions, subsystems, both? Determines surgical vs. messy rollbacks.
2. **Temporal economy** — where Chronite and Seals come from, supply curves, anti-snowball mechanisms (preventing a leader from stockpiling).
3. **Seal rarity and source** — random drops, expensive crafting, quest rewards?
4. **Layered temporal items** — can a Seal counter a Seal? Cursed but potentially amazing.
5. **Information on a failed Strike** — should the aggressor get partial Chronite refund or intel about the defender when their Strike is sealed? (Probably yes — every duel should leak information so even the loser gains something.)
6. **Anchor economics** — how many can a player hold, what events qualify, can they decay?
7. **Concurrent rollback resolution** — what if two players issue rollbacks affecting overlapping scopes simultaneously?
8. **Reaction window tuning** — duration (30s? 60s?), whether duration scales with rollback tier, what happens if the reacting player is offline.
9. **DO ↔ ledger handoff details** — exactly which state hydrates into a DO on encounter start, exactly which summary events fire on encounter end, how mid-encounter disconnects are handled.
10. **Snapshot granularity** — per region, per scope, or both? How often? Storage cost vs. replay cost tradeoff.
11. **Aggregate-local event streams vs. global ledger** — do aggregates have their own event streams that project up to the world ledger, or do they share one ledger with filtered views? Affects partitioning and replay strategy.
12. **Compensation timeouts** — if a process manager's compensation step fails (e.g., can't release materials because Player aggregate is locked), what's the escalation path?
13. **Optimistic concurrency for resource debits** — version numbers on Player aggregate? Conditional events? How does the system detect concurrent spending of the same Chronite?