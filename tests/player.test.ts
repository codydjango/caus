import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db/store.js';
import { WorldClock } from '../src/domain/clock.js';
import { buildPlayerProjection } from '../src/domain/player.js';
import { handleGiveMoney, PLAYER_ID } from '../src/commands/giveMoney.js';
import { readEventsByAggregate } from '../src/db/store.js';
import type Database from 'better-sqlite3';
import type { EventEnvelope } from '../src/domain/events.js';

function makeTestDb(): Database.Database {
  const db = openDatabase(':memory:');
  WorldClock._reset();
  WorldClock.init(db);
  return db;
}

function makeMoneyReceived(amount: number, version: number): EventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    event_type: 'MoneyReceived',
    aggregate_type: 'Player',
    aggregate_id: PLAYER_ID,
    aggregate_version: version,
    world_clock_at: 0,
    wall_clock_at: 0,
    correlation_id: null,
    causation_id: null,
    scope_tags: [],
    payload: { amount, source: 'debug' },
  };
}

function makeMoneySpent(amount: number, version: number): EventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    event_type: 'MoneySpent',
    aggregate_type: 'Player',
    aggregate_id: PLAYER_ID,
    aggregate_version: version,
    world_clock_at: 0,
    wall_clock_at: 0,
    correlation_id: null,
    causation_id: null,
    scope_tags: [],
    payload: { amount, reason: 'upgrade_farm' },
  };
}

function makeMoneyRefunded(amount: number, version: number): EventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    event_type: 'MoneyRefunded',
    aggregate_type: 'Player',
    aggregate_id: PLAYER_ID,
    aggregate_version: version,
    world_clock_at: 0,
    wall_clock_at: 0,
    correlation_id: null,
    causation_id: null,
    scope_tags: [],
    payload: { amount, reason: 'upgrade_farm_failed' },
  };
}

describe('Player Projection', () => {
  it('returns zero money for empty event list', () => {
    expect(buildPlayerProjection([])).toEqual({ money: 0, version: 0 });
  });

  it('accumulates money from MoneyReceived events', () => {
    const events = [makeMoneyReceived(100, 1), makeMoneyReceived(20, 2)];
    expect(buildPlayerProjection(events).money).toBe(120);
  });

  it('deducts money from MoneySpent events', () => {
    const events = [makeMoneyReceived(100, 1), makeMoneySpent(40, 2), makeMoneyReceived(20, 3)];
    expect(buildPlayerProjection(events).money).toBe(80);
  });

  it('adds back money from MoneyRefunded events', () => {
    const events = [makeMoneyReceived(100, 1), makeMoneySpent(50, 2), makeMoneyRefunded(50, 3)];
    expect(buildPlayerProjection(events).money).toBe(100);
  });

  it('tracks the current version', () => {
    const events = [makeMoneyReceived(100, 1), makeMoneyReceived(50, 2)];
    expect(buildPlayerProjection(events).version).toBe(2);
  });
});

describe('GiveMoney Command', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  it('appends MoneyReceived event with correct amount and source', () => {
    handleGiveMoney(db, { amount: 100 });
    const events = readEventsByAggregate(db, 'Player', PLAYER_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('MoneyReceived');
    expect(events[0]?.payload).toMatchObject({ amount: 100, source: 'debug' });
  });

  it('accumulates across multiple GiveMoney calls', () => {
    handleGiveMoney(db, { amount: 100 });
    handleGiveMoney(db, { amount: 50 });
    const events = readEventsByAggregate(db, 'Player', PLAYER_ID);
    expect(buildPlayerProjection(events).money).toBe(150);
  });

  it('throws for zero amount', () => {
    expect(() => handleGiveMoney(db, { amount: 0 })).toThrow();
  });

  it('throws for negative amount', () => {
    expect(() => handleGiveMoney(db, { amount: -10 })).toThrow();
  });
});
