import type Database from 'better-sqlite3';
import { appendEvent, readEventsByAggregate } from '../db/store.js';
import { buildPlayerProjection } from '../domain/player.js';
import type { EventEnvelope } from '../domain/events.js';

export const PLAYER_ID = 'player-1';

export function handleGiveMoney(
  db: Database.Database,
  { amount }: { amount: number },
): EventEnvelope {
  if (amount <= 0) throw new Error('GiveMoney amount must be a positive integer');

  const events = readEventsByAggregate(db, 'Player', PLAYER_ID);
  const { version } = buildPlayerProjection(events);

  return appendEvent(db, {
    event_type: 'MoneyReceived',
    aggregate_type: 'Player',
    aggregate_id: PLAYER_ID,
    aggregate_version: version + 1,
    correlation_id: null,
    causation_id: null,
    scope_tags: ['economy'],
    payload: { amount, source: 'debug' },
  });
}
