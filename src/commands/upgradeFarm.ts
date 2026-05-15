import type Database from 'better-sqlite3';
import { appendEvent, readEventsByAggregate, ConcurrencyError } from '../db/store.js';
import { buildPlayerProjection } from '../domain/player.js';
import { buildSiteProjection } from '../domain/site.js';
import { WorldClock } from '../domain/clock.js';
import type { EventEnvelope } from '../domain/events.js';
import { PLAYER_ID } from './giveMoney.js';
import { SITE_ID } from './buildFarm.js';

const UPGRADE_DURATION_US = 120_000_000; // 120 seconds in microseconds

export function upgradeCost(currentLevel: number): number {
  return 100 * currentLevel;
}

export function handleUpgradeFarm(db: Database.Database): {
  moneySpent: EventEnvelope;
  upgradeStarted: EventEnvelope;
} {
  const playerEvents = readEventsByAggregate(db, 'Player', PLAYER_ID);
  const siteEvents = readEventsByAggregate(db, 'Site', SITE_ID);

  const player = buildPlayerProjection(playerEvents);
  const site = buildSiteProjection(siteEvents);

  if (!site.has_farm) throw new Error('UpgradeFarm rejected: no farm exists');
  if (site.upgrade_in_progress) throw new Error('UpgradeFarm rejected: upgrade already in progress');

  const cost = upgradeCost(site.level);
  if (player.money < cost) {
    throw new Error(`UpgradeFarm rejected: insufficient money (have ${player.money}, need ${cost})`);
  }

  const correlationId = crypto.randomUUID();
  const fromLevel = site.level;
  const toLevel = fromLevel + 1;

  const moneySpent = appendEvent(db, {
    event_type: 'MoneySpent',
    aggregate_type: 'Player',
    aggregate_id: PLAYER_ID,
    aggregate_version: player.version + 1,
    correlation_id: correlationId,
    causation_id: null,
    scope_tags: ['economy'],
    payload: { amount: cost, reason: 'upgrade_farm' },
  });

  try {
    const started_at_world_clock = WorldClock.now();
    const completes_at_world_clock = started_at_world_clock + UPGRADE_DURATION_US;

    const upgradeStarted = appendEvent(db, {
      event_type: 'FarmUpgradeStarted',
      aggregate_type: 'Site',
      aggregate_id: SITE_ID,
      aggregate_version: site.version + 1,
      correlation_id: correlationId,
      causation_id: moneySpent.event_id,
      scope_tags: ['site', 'build'],
      payload: { from_level: fromLevel, to_level: toLevel, started_at_world_clock, completes_at_world_clock },
    });

    return { moneySpent, upgradeStarted };
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      // Compensate by refunding the money
      const refundedPlayerEvents = readEventsByAggregate(db, 'Player', PLAYER_ID);
      const refundedPlayer = buildPlayerProjection(refundedPlayerEvents);

      appendEvent(db, {
        event_type: 'MoneyRefunded',
        aggregate_type: 'Player',
        aggregate_id: PLAYER_ID,
        aggregate_version: refundedPlayer.version + 1,
        correlation_id: correlationId,
        causation_id: moneySpent.event_id,
        scope_tags: ['economy'],
        payload: { amount: cost, reason: 'upgrade_farm_failed' },
      });
    }
    throw err;
  }
}
