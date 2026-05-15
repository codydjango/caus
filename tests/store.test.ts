import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, appendEvent, readEvents, readEventsByAggregate, ConcurrencyError } from '../src/db/store.js';
import { WorldClock } from '../src/domain/clock.js';
import type Database from 'better-sqlite3';

function makeTestDb(): Database.Database {
  const db = openDatabase(':memory:');
  WorldClock._reset();
  WorldClock.init(db);
  return db;
}

describe('Event Store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  it('appends an event and reads it back', () => {
    appendEvent(db, {
      event_type: 'MoneyReceived',
      aggregate_type: 'Player',
      aggregate_id: 'player-1',
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: ['economy'],
      payload: { amount: 100, source: 'debug' },
    });

    const events = readEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('MoneyReceived');
    expect(events[0]?.aggregate_version).toBe(1);
    expect(events[0]?.event_id).toBeTruthy();
    expect(events[0]?.world_clock_at).toBeGreaterThanOrEqual(0);
  });

  it('sets world_clock_at and wall_clock_at automatically', () => {
    const before = Date.now();
    appendEvent(db, {
      event_type: 'MoneyReceived',
      aggregate_type: 'Player',
      aggregate_id: 'player-1',
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { amount: 50, source: 'debug' },
    });
    const after = Date.now();

    const events = readEvents(db);
    expect(events[0]?.wall_clock_at).toBeGreaterThanOrEqual(before);
    expect(events[0]?.wall_clock_at).toBeLessThanOrEqual(after);
  });

  it('enforces optimistic concurrency — rejects stale version', () => {
    appendEvent(db, {
      event_type: 'MoneyReceived',
      aggregate_type: 'Player',
      aggregate_id: 'player-1',
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { amount: 100, source: 'debug' },
    });

    expect(() =>
      appendEvent(db, {
        event_type: 'MoneyReceived',
        aggregate_type: 'Player',
        aggregate_id: 'player-1',
        aggregate_version: 1, // stale — should be 2
        correlation_id: null,
        causation_id: null,
        scope_tags: [],
        payload: { amount: 50, source: 'debug' },
      }),
    ).toThrow(ConcurrencyError);
  });

  it('accepts version 1 for a new aggregate', () => {
    expect(() =>
      appendEvent(db, {
        event_type: 'FarmBuildStarted',
        aggregate_type: 'Site',
        aggregate_id: 'site-1',
        aggregate_version: 1,
        correlation_id: null,
        causation_id: null,
        scope_tags: [],
        payload: { started_at_world_clock: 0, completes_at_world_clock: 30_000_000 },
      }),
    ).not.toThrow();
  });

  it('readEventsByAggregate returns only events for the requested aggregate', () => {
    appendEvent(db, {
      event_type: 'MoneyReceived',
      aggregate_type: 'Player',
      aggregate_id: 'player-1',
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { amount: 100, source: 'debug' },
    });
    appendEvent(db, {
      event_type: 'FarmBuildStarted',
      aggregate_type: 'Site',
      aggregate_id: 'site-1',
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { started_at_world_clock: 0, completes_at_world_clock: 30_000_000 },
    });

    const playerEvents = readEventsByAggregate(db, 'Player', 'player-1');
    expect(playerEvents).toHaveLength(1);
    expect(playerEvents[0]?.aggregate_type).toBe('Player');

    const siteEvents = readEventsByAggregate(db, 'Site', 'site-1');
    expect(siteEvents).toHaveLength(1);
    expect(siteEvents[0]?.aggregate_type).toBe('Site');
  });

  it('readEvents returns all events ordered by world_clock_at', () => {
    appendEvent(db, {
      event_type: 'MoneyReceived',
      aggregate_type: 'Player',
      aggregate_id: 'player-1',
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { amount: 100, source: 'debug' },
    });
    appendEvent(db, {
      event_type: 'FarmBuildStarted',
      aggregate_type: 'Site',
      aggregate_id: 'site-1',
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { started_at_world_clock: 0, completes_at_world_clock: 30_000_000 },
    });

    const all = readEvents(db);
    expect(all).toHaveLength(2);
    // Should be in world_clock_at order
    expect(all[0]!.world_clock_at).toBeLessThanOrEqual(all[1]!.world_clock_at);
  });
});
