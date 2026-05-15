import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, appendEvent, readEvents, readEventsByAggregate } from '../src/db/store.js';
import { WorldClock } from '../src/domain/clock.js';
import { processTick } from '../src/domain/tick.js';
import { SITE_ID } from '../src/commands/buildFarm.js';
import type Database from 'better-sqlite3';
import type { WorldTickAdvancedPayload } from '../src/domain/events.js';

function makeTestDb(): Database.Database {
  const db = openDatabase(':memory:');
  WorldClock._reset();
  WorldClock.init(db);
  return db;
}

describe('processTick — WorldTickAdvanced', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  it('emits no tick events when clock is under 1 second', () => {
    // Clock starts near 0µs, well under 1_000_000µs
    processTick(db);
    const events = readEvents(db).filter((e) => e.event_type === 'WorldTickAdvanced');
    expect(events).toHaveLength(0);
  });

  it('emits one WorldTickAdvanced when one boundary is crossed', () => {
    // Override: inject a meta origin far enough in the past (1.5 seconds ago)
    const db2 = openDatabase(':memory:');
    WorldClock._reset();
    // Set origin to 1500ms ago so clock starts at ~1_500_000µs
    const originWallMs = Date.now() - 1500;
    db2.prepare("INSERT INTO meta (key, value) VALUES ('world_origin_wall_ms', ?)").run(String(originWallMs));
    WorldClock.init(db2);

    processTick(db2);

    const ticks = readEvents(db2).filter((e) => e.event_type === 'WorldTickAdvanced');
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect((ticks[0]?.payload as WorldTickAdvancedPayload).tick_number).toBe(1);
  });

  it('catch-up: emits multiple ticks when several boundaries crossed', () => {
    const db2 = openDatabase(':memory:');
    WorldClock._reset();
    // Set origin to 3500ms ago → clock is ~3_500_000µs → 3 full seconds crossed
    const originWallMs = Date.now() - 3500;
    db2.prepare("INSERT INTO meta (key, value) VALUES ('world_origin_wall_ms', ?)").run(String(originWallMs));
    WorldClock.init(db2);

    processTick(db2);

    const ticks = readEvents(db2).filter((e) => e.event_type === 'WorldTickAdvanced');
    expect(ticks.length).toBeGreaterThanOrEqual(3);

    // Ticks should be in order: 1, 2, 3, ...
    const tickNumbers = ticks.map((e) => (e.payload as WorldTickAdvancedPayload).tick_number);
    for (let i = 1; i < tickNumbers.length; i++) {
      expect(tickNumbers[i]!).toBe(tickNumbers[i - 1]! + 1);
    }
  });

  it('no duplicate ticks when processTick called twice at same clock', () => {
    const db2 = openDatabase(':memory:');
    WorldClock._reset();
    const originWallMs = Date.now() - 2500;
    db2.prepare("INSERT INTO meta (key, value) VALUES ('world_origin_wall_ms', ?)").run(String(originWallMs));
    WorldClock.init(db2);

    processTick(db2);
    const countAfterFirst = readEvents(db2).filter((e) => e.event_type === 'WorldTickAdvanced').length;

    processTick(db2); // call again immediately
    const countAfterSecond = readEvents(db2).filter((e) => e.event_type === 'WorldTickAdvanced').length;

    // Should not have added duplicates (at most +1 for crossing a new boundary in the tiny time between calls)
    expect(countAfterSecond - countAfterFirst).toBeLessThanOrEqual(1);
  });
});

describe('processTick — Build Completion', () => {
  it('fires FarmBuildCompleted when completes_at is past', () => {
    const db2 = openDatabase(':memory:');
    WorldClock._reset();
    // Start clock at 35 seconds in
    const originWallMs = Date.now() - 35_000;
    db2.prepare("INSERT INTO meta (key, value) VALUES ('world_origin_wall_ms', ?)").run(String(originWallMs));
    WorldClock.init(db2);

    // Add a FarmBuildStarted that should already be complete
    appendEvent(db2, {
      event_type: 'FarmBuildStarted',
      aggregate_type: 'Site',
      aggregate_id: SITE_ID,
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { started_at_world_clock: 1_000_000, completes_at_world_clock: 2_000_000 },
    });

    processTick(db2);

    const siteEvents = readEventsByAggregate(db2, 'Site', SITE_ID);
    const completed = siteEvents.filter((e) => e.event_type === 'FarmBuildCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.causation_id).toBeTruthy(); // references the FarmBuildStarted
  });

  it('does not fire duplicate FarmBuildCompleted', () => {
    const db2 = openDatabase(':memory:');
    WorldClock._reset();
    const originWallMs = Date.now() - 35_000;
    db2.prepare("INSERT INTO meta (key, value) VALUES ('world_origin_wall_ms', ?)").run(String(originWallMs));
    WorldClock.init(db2);

    appendEvent(db2, {
      event_type: 'FarmBuildStarted',
      aggregate_type: 'Site',
      aggregate_id: SITE_ID,
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { started_at_world_clock: 1_000_000, completes_at_world_clock: 2_000_000 },
    });

    processTick(db2);
    processTick(db2);

    const siteEvents = readEventsByAggregate(db2, 'Site', SITE_ID);
    const completed = siteEvents.filter((e) => e.event_type === 'FarmBuildCompleted');
    expect(completed).toHaveLength(1); // still exactly one
  });
});
