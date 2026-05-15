import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, readEventsByAggregate, appendEvent } from '../src/db/store.js';
import { WorldClock } from '../src/domain/clock.js';
import { buildSiteProjection } from '../src/domain/site.js';
import { handleBuildFarm, SITE_ID } from '../src/commands/buildFarm.js';
import type Database from 'better-sqlite3';
import type { EventEnvelope } from '../src/domain/events.js';

function makeTestDb(): Database.Database {
  const db = openDatabase(':memory:');
  WorldClock._reset();
  WorldClock.init(db);
  return db;
}

function makeSiteEvent(
  event_type: EventEnvelope['event_type'],
  payload: EventEnvelope['payload'],
  version: number,
): EventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    event_type,
    aggregate_type: 'Site',
    aggregate_id: SITE_ID,
    aggregate_version: version,
    world_clock_at: 0,
    wall_clock_at: 0,
    correlation_id: null,
    causation_id: null,
    scope_tags: [],
    payload,
  };
}

describe('Site Projection', () => {
  it('returns initial state for empty event list', () => {
    const state = buildSiteProjection([]);
    expect(state.has_farm).toBe(false);
    expect(state.level).toBe(0);
    expect(state.build_in_progress).toBeNull();
    expect(state.upgrade_in_progress).toBeNull();
    expect(state.version).toBe(0);
  });

  it('shows build in progress after FarmBuildStarted', () => {
    const events = [
      makeSiteEvent('FarmBuildStarted', { started_at_world_clock: 1000, completes_at_world_clock: 31_000_000 }, 1),
    ];
    const state = buildSiteProjection(events);
    expect(state.has_farm).toBe(false);
    expect(state.build_in_progress).toMatchObject({ started_at: 1000, completes_at: 31_000_000 });
  });

  it('has_farm = true and level = 1 after FarmBuildCompleted', () => {
    const events = [
      makeSiteEvent('FarmBuildStarted', { started_at_world_clock: 1000, completes_at_world_clock: 31_000_000 }, 1),
      makeSiteEvent('FarmBuildCompleted', { completed_at_world_clock: 31_000_001 }, 2),
    ];
    const state = buildSiteProjection(events);
    expect(state.has_farm).toBe(true);
    expect(state.level).toBe(1);
    expect(state.build_in_progress).toBeNull();
  });

  it('level increments with each FarmUpgradeCompleted', () => {
    const events = [
      makeSiteEvent('FarmBuildStarted', { started_at_world_clock: 0, completes_at_world_clock: 1 }, 1),
      makeSiteEvent('FarmBuildCompleted', { completed_at_world_clock: 2 }, 2),
      makeSiteEvent('FarmUpgradeStarted', { from_level: 1, to_level: 2, started_at_world_clock: 3, completes_at_world_clock: 4 }, 3),
      makeSiteEvent('FarmUpgradeCompleted', { new_level: 2, completed_at_world_clock: 5 }, 4),
      makeSiteEvent('FarmUpgradeStarted', { from_level: 2, to_level: 3, started_at_world_clock: 6, completes_at_world_clock: 7 }, 5),
      makeSiteEvent('FarmUpgradeCompleted', { new_level: 3, completed_at_world_clock: 8 }, 6),
    ];
    expect(buildSiteProjection(events).level).toBe(3);
  });
});

describe('BuildFarm Command', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  it('appends FarmBuildStarted on empty site', () => {
    handleBuildFarm(db);
    const events = readEventsByAggregate(db, 'Site', SITE_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('FarmBuildStarted');
    const payload = events[0]?.payload as { started_at_world_clock: number; completes_at_world_clock: number };
    expect(payload.completes_at_world_clock - payload.started_at_world_clock).toBe(30_000_000);
  });

  it('sets aggregate_id to site-1', () => {
    handleBuildFarm(db);
    const events = readEventsByAggregate(db, 'Site', SITE_ID);
    expect(events[0]?.aggregate_id).toBe('site-1');
  });

  it('rejects BuildFarm when build is already in progress', () => {
    handleBuildFarm(db);
    expect(() => handleBuildFarm(db)).toThrow('in progress');
  });

  it('rejects BuildFarm when farm already exists', () => {
    appendEvent(db, {
      event_type: 'FarmBuildStarted',
      aggregate_type: 'Site',
      aggregate_id: SITE_ID,
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { started_at_world_clock: 0, completes_at_world_clock: 1 },
    });
    appendEvent(db, {
      event_type: 'FarmBuildCompleted',
      aggregate_type: 'Site',
      aggregate_id: SITE_ID,
      aggregate_version: 2,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { completed_at_world_clock: 2 },
    });
    expect(() => handleBuildFarm(db)).toThrow('already exists');
  });
});
