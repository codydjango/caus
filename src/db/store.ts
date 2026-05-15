import Database from 'better-sqlite3';
import { WorldClock } from '../domain/clock.js';
import type { AggregateType, EventEnvelope, NewEventInput } from '../domain/events.js';

export class ConcurrencyError extends Error {
  constructor(
    public readonly aggregateType: string,
    public readonly aggregateId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Concurrency conflict on ${aggregateType}:${aggregateId} — ` +
        `expected version ${expectedVersion}, actual max is ${actualVersion}`,
    );
    this.name = 'ConcurrencyError';
  }
}

type StoredRow = {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  world_clock_at: number;
  wall_clock_at: number;
  correlation_id: string | null;
  causation_id: string | null;
  scope_tags: string;
  payload: string;
};

function rowToEnvelope(row: StoredRow): EventEnvelope {
  return {
    event_id: row.event_id,
    event_type: row.event_type as EventEnvelope['event_type'],
    aggregate_type: row.aggregate_type as EventEnvelope['aggregate_type'],
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    world_clock_at: row.world_clock_at,
    wall_clock_at: row.wall_clock_at,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    scope_tags: JSON.parse(row.scope_tags) as string[],
    payload: JSON.parse(row.payload) as EventEnvelope['payload'],
  };
}

export function openDatabase(path = 'data/events.db'): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id          TEXT PRIMARY KEY,
      event_type        TEXT NOT NULL,
      aggregate_type    TEXT NOT NULL,
      aggregate_id      TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL,
      world_clock_at    INTEGER NOT NULL,
      wall_clock_at     INTEGER NOT NULL,
      correlation_id    TEXT,
      causation_id      TEXT,
      scope_tags        TEXT NOT NULL,
      payload           TEXT NOT NULL,
      UNIQUE(aggregate_type, aggregate_id, aggregate_version)
    );
  `);

  return db;
}

export function appendEvent(db: Database.Database, input: NewEventInput): EventEnvelope {
  const maxVersionRow = db
    .prepare<[string, string], { max_v: number | null }>(
      'SELECT MAX(aggregate_version) AS max_v FROM events WHERE aggregate_type = ? AND aggregate_id = ?',
    )
    .get(input.aggregate_type, input.aggregate_id);

  const currentVersion = maxVersionRow?.max_v ?? 0;
  const expectedCurrent = input.aggregate_version - 1;

  if (currentVersion !== expectedCurrent) {
    throw new ConcurrencyError(
      input.aggregate_type,
      input.aggregate_id,
      input.aggregate_version,
      currentVersion,
    );
  }

  const event_id = crypto.randomUUID();
  const world_clock_at = WorldClock.now();
  const wall_clock_at = Date.now();

  db.prepare(
    `INSERT INTO events (
      event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
      world_clock_at, wall_clock_at, correlation_id, causation_id, scope_tags, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event_id,
    input.event_type,
    input.aggregate_type,
    input.aggregate_id,
    input.aggregate_version,
    world_clock_at,
    wall_clock_at,
    input.correlation_id,
    input.causation_id,
    JSON.stringify(input.scope_tags),
    JSON.stringify(input.payload),
  );

  return { ...input, event_id, world_clock_at, wall_clock_at };
}

export function readEvents(db: Database.Database): EventEnvelope[] {
  const rows = db
    .prepare<[], StoredRow>(
      'SELECT * FROM events ORDER BY world_clock_at ASC, aggregate_version ASC',
    )
    .all();
  return rows.map(rowToEnvelope);
}

export function readEventsByAggregate(
  db: Database.Database,
  aggregateType: AggregateType,
  aggregateId: string,
): EventEnvelope[] {
  const rows = db
    .prepare<[string, string], StoredRow>(
      'SELECT * FROM events WHERE aggregate_type = ? AND aggregate_id = ? ORDER BY aggregate_version ASC',
    )
    .all(aggregateType, aggregateId);
  return rows.map(rowToEnvelope);
}
