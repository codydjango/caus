import type Database from 'better-sqlite3';

type MetaRow = { value: string };

let _originWallMs = 0;
let _initHrtimeNs = 0n;
let _initWallMs = 0;
let _initialized = false;

export const WorldClock = {
  init(db: Database.Database): void {
    const row = db
      .prepare<[], MetaRow>("SELECT value FROM meta WHERE key = 'world_origin_wall_ms'")
      .get();

    if (row) {
      _originWallMs = Number(row.value);
    } else {
      _originWallMs = Date.now();
      db.prepare("INSERT INTO meta (key, value) VALUES ('world_origin_wall_ms', ?)").run(
        String(_originWallMs),
      );
    }

    _initHrtimeNs = process.hrtime.bigint();
    _initWallMs = Date.now();
    _initialized = true;
  },

  now(): number {
    if (!_initialized) throw new Error('WorldClock not initialized — call WorldClock.init(db) first');
    // Within-process elapsed nanoseconds (high precision)
    const elapsedNs = process.hrtime.bigint() - _initHrtimeNs;
    // Cross-restart anchor: wall-clock ms difference from world origin → microseconds
    const anchorUs = BigInt(_initWallMs - _originWallMs) * 1000n;
    // Total microseconds since world origin
    return Number(anchorUs + elapsedNs / 1000n);
  },

  // Test helper: reset state so tests can re-init
  _reset(): void {
    _initialized = false;
    _originWallMs = 0;
    _initHrtimeNs = 0n;
    _initWallMs = 0;
  },
};
