import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db/store.js';
import { WorldClock } from '../src/domain/clock.js';

function makeTestDb() {
  return openDatabase(':memory:');
}

describe('WorldClock', () => {
  beforeEach(() => {
    WorldClock._reset();
  });

  it('starts near zero after init with a fresh DB', () => {
    const db = makeTestDb();
    WorldClock.init(db);
    const t = WorldClock.now();
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1_000_000); // less than 1 second
  });

  it('is monotonic within a process run', () => {
    const db = makeTestDb();
    WorldClock.init(db);
    const t1 = WorldClock.now();
    const t2 = WorldClock.now();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('reuses origin on re-init with the same DB', () => {
    const db = makeTestDb();
    WorldClock.init(db);
    const t1 = WorldClock.now();

    // Re-init should read the stored origin, not create a new one
    WorldClock._reset();
    WorldClock.init(db);
    const t2 = WorldClock.now();

    // t2 should be >= t1 (clock continues forward, not reset)
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('throws if now() is called before init', () => {
    expect(() => WorldClock.now()).toThrow('WorldClock not initialized');
  });
});
