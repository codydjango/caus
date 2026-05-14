# Causality Prototype — "FarmTime/TimeFarm"

*Smallest viable single-player slice to prove the event-sourcing architecture and the feel of temporal mechanics.*

## Goal

Build the minimum game that exercises every load-bearing piece of the Causality architecture: event-sourced state, projections, temporal verbs (timer modifiers + rollback + force forward), public CP bar, visual narration of state transitions. Single player, single site, single building type.

**Out of scope for prototype:** multiplayer, PvP, Durable Objects, encounters, sites as a graph, units, anchors, Schism (stretch only).

**Honest framing:** the *competitive depth* of Causality emerges from multiplayer. This prototype proves the plumbing works and the temporal verbs *feel right*. It doesn't (and can't) prove the game is fun yet.

---

## The loop

1. Player starts with $0, an empty site, and a full CP bar that regenerates over time
2. Player builds a farm (free, 30s timer)
3. Farm completes; starts generating $10 every 10s automatically
4. When player has $100, they spend it to upgrade the farm (2min timer)
5. Farm upgrades; visually grows (each level adds 1/3 size); generation rate increases (e.g., +$10/10s per level)
6. Repeat indefinitely

Throughout this loop, the player can use **Chronite Points** to:
- **Speedup**: increase rate of in-flight timers (sustained CP drain while active)
- **Slowdown**: decrease rate of in-flight timers (sustained CP drain while active) *— included for symmetry; less useful in single-player, but proves the pattern*
- **Temporal Strike (rollback)**: void events in `[now - window, now]` for a CP burst cost. Undoes upgrades, money earned, building progress.
- **Force Forward**: spend a large CP burst to reverse a rollback, restoring voided events.

**Stretch:** Schism — fork the timeline into two branches, switch between them via tab/button, auto-collapse after a timeout with rewards merged.

---

## Why these mechanics specifically

| Mechanic | What it proves |
|---|---|
| Build farm (timed) | Basic event emission, projection update, timer-driven `BuildingCompleted` events from the world tick |
| Income generation | Recurring tick-driven events that compound on projection state |
| Upgrade | Multi-step process manager (debit money + start upgrade + complete upgrade) |
| Speedup/Slowdown | Activity-timer modifier events; effective `completes_at_world_clock` recomputation |
| Rollback | Scoped event voiding, projection rebuild, the visual scrub-backward |
| Force Forward | The "events ahead of current state" concept; reaction-window-style commitment |
| Public CP bar | Always-visible HUD element; powers all temporal verbs from one pool |

If all of these work, the architecture has been validated end-to-end at small scale.

---

## Architecture (prototype scope)

Everything from the main checkpoint applies, scoped down:

- **Single event log** (SQLite is fine; Postgres if convenient)
- **One Player aggregate** (HP omitted; just CP + current + cap + regen rate, plus money balance)
- **One Site aggregate** (current building, building level, build progress)
- **World clock**: monotonic time since prototype start, always on, no pause (per checkpoint)
- **One tick loop** (background worker / setInterval) emitting `WorldTickAdvanced` events and firing scheduled completions
- **One projection** that reads all events and produces current state for the UI
- **No DOs, no multi-aggregate consistency challenges** beyond the local upgrade process

### Event types (minimum)

- `FarmBuildStarted { started_at, completes_at }`
- `FarmBuildCompleted { completed_at }`
- `MoneyGenerated { amount, source: "farm", at }`
- `UpgradeStarted { from_level, to_level, cost, started_at, completes_at }`
- `MoneySpent { amount, reason }`
- `UpgradeCompleted { new_level, completed_at }`
- `TimerModifierApplied { target_activity_id, multiplier, started_at, expires_at }`
- `TimerModifierExpired { target_activity_id }`
- `CPSpent { amount, reason }`
- `CPRegenerated { amount, at }` *(or recomputed lazily; either works)*
- `RollbackRequested { window_seconds, scope, cp_cost }`
- `RollbackApplied { voided_event_ids, summary }`
- `ForceForwardApplied { reverses_rollback_id, voided_after_window_event_ids }`
- `WorldTickAdvanced { tick_number }`

All carry the envelope (event_id, world_clock_at, correlation_id, scope_tags, etc.) per the main checkpoint.

---

## UI / Visual scope

Minimal but specific.

**The site (center of screen):**
- An ASCII character or simple shape representing the farm
- Visually grows 1/3 larger with each upgrade level (CSS transform scale, simplest possible)
- When a rollback happens: shape *shrinks back* over ~3-5 seconds of client animation, even if the rolled-back window represents 10 minutes of game time
- When Force Forward happens: shape *re-grows* with the same animation

**HUD (top bar):**
- Money balance
- CP bar (current / max, with regen rate label)
- World clock (game-seconds since start)

**Action buttons (bottom):**
- Build Farm (if none exists)
- Upgrade Farm (when affordable)
- Speedup (target: current activity; while held / toggled)
- Slowdown (target: current activity; while held / toggled)
- Temporal Strike (with a window selector: 30s, 2min, 5min)
- Force Forward (only active when a recent rollback is reversible)

**Debug panel (collapsible side or bottom drawer):**

This is a first-class deliverable, not an afterthought. It makes the system legible during development and doubles as a teaching tool.

- World clock value (live)
- Each aggregate's current projected state (Player CP/money, Site building/level/progress)
- Event log (scrollable, newest first), with type + payload summary + world_clock_at
- Event count
- "Events ahead of current state" — events that were voided by a rollback but are still in the log; these are Force-Forward-eligible. Count + list.
- Active timer modifiers on any activity, with effective completion times
- A button to dump the current event log to JSON for inspection

---

## Backend ↔ frontend contract

Per the presentation-decoupling principle:

- Backend computes state transitions atomically and authoritatively
- For rollback, backend pushes: `{ post_state, voided_events: [...], rollback_summary }`
- Frontend animates the scrub at its own pace (~3-5s regardless of game-time window)
- During animation, no new commands are accepted (matches the conceptual reaction window even though in single-player there's no reactor)

This contract exists from day one of the prototype even though it's "overkill" for single-player — practicing it now means it scales correctly when multiplayer is added.

---

## Implementation suggestion

Stack agnostic, but since this is for learning event sourcing and the existing comfort zone is Python/Django:

- **Backend:** single Python service (Django or FastAPI; FastAPI lighter for a prototype). SQLite as event store. Background asyncio task (or APScheduler) for the world tick. WebSocket push to frontend for state updates.
- **Frontend:** vanilla HTML/JS/CSS. No framework. The whole UI is small enough to be one HTML file with a few hundred lines of JS. Keep it ugly.
- **Storage:** event log as a single table, projection as in-memory dict rebuilt on demand or on event append (cheap at this scale; no snapshots needed).

Total scope is probably one weekend of focused work for the happy path, plus another for the temporal verbs and the rollback animation, plus another for polish on the debug panel. Three weekends to a working prototype that exercises everything.

---

## What this prototype tells us

After playing it for an hour:

1. Does building events and replaying them *actually feel right*? (Architecture validation.)
2. Is the rollback scrub-backward visually satisfying? (Trailer-moment validation.)
3. Does the CP economy feel taut or sloppy? (Tuning baseline for the real game.)
4. Is the debug panel actually useful, and does it suggest tools we'll want at scale?
5. What did we get wrong about the event schema or aggregate boundaries that's now obvious?

If answers are yes / yes / sloppy-but-tunable / yes / "we need X", the prototype has done its job and we proceed to the next slice (probably: add a second site type, then add the DO seam, then add a second player).