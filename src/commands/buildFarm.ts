import type Database from 'better-sqlite3';
import { appendEvent, readEventsByAggregate } from '../db/store.js';
import { buildSiteProjection } from '../domain/site.js';
import { WorldClock } from '../domain/clock.js';
import type { EventEnvelope } from '../domain/events.js';

export const SITE_ID = 'site-1';
const BUILD_DURATION_US = 30_000_000; // 30 seconds in microseconds

export function handleBuildFarm(db: Database.Database): EventEnvelope {
  const events = readEventsByAggregate(db, 'Site', SITE_ID);
  const site = buildSiteProjection(events);

  if (site.has_farm) throw new Error('BuildFarm rejected: farm already exists');
  if (site.build_in_progress) throw new Error('BuildFarm rejected: build already in progress');

  const started_at_world_clock = WorldClock.now();
  const completes_at_world_clock = started_at_world_clock + BUILD_DURATION_US;

  return appendEvent(db, {
    event_type: 'FarmBuildStarted',
    aggregate_type: 'Site',
    aggregate_id: SITE_ID,
    aggregate_version: site.version + 1,
    correlation_id: null,
    causation_id: null,
    scope_tags: ['site', 'build'],
    payload: { started_at_world_clock, completes_at_world_clock },
  });
}
