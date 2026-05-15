import type Database from 'better-sqlite3';
import { appendEvent, readEvents, readEventsByAggregate } from '../db/store.js';
import { buildSiteProjection } from './site.js';
import { WorldClock } from './clock.js';
import type {
  EventEnvelope,
  FarmBuildStartedPayload,
  FarmUpgradeStartedPayload,
  WorldTickAdvancedPayload,
} from './events.js';
import { SITE_ID } from '../commands/buildFarm.js';

const WORLD_AGGREGATE_ID = 'world-1';

function getLastTickNumber(events: EventEnvelope[]): number {
  let last = 0;
  for (const e of events) {
    if (e.event_type === 'WorldTickAdvanced') {
      last = (e.payload as WorldTickAdvancedPayload).tick_number;
    }
  }
  return last;
}

function getWorldVersion(events: EventEnvelope[]): number {
  let v = 0;
  for (const e of events) {
    if (e.aggregate_type === 'World') v = e.aggregate_version;
  }
  return v;
}

export function processTick(db: Database.Database): void {
  const nowUs = WorldClock.now();
  const nowSeconds = Math.floor(nowUs / 1_000_000);

  const allEvents = readEvents(db);
  const lastTick = getLastTickNumber(allEvents);

  // Emit WorldTickAdvanced for each crossed integer-second boundary
  let worldVersion = getWorldVersion(allEvents);
  for (let tick = lastTick + 1; tick <= nowSeconds; tick++) {
    worldVersion += 1;
    appendEvent(db, {
      event_type: 'WorldTickAdvanced',
      aggregate_type: 'World',
      aggregate_id: WORLD_AGGREGATE_ID,
      aggregate_version: worldVersion,
      correlation_id: null,
      causation_id: null,
      scope_tags: [],
      payload: { tick_number: tick },
    });
  }

  // Check for due build completion
  const siteEvents = readEventsByAggregate(db, 'Site', SITE_ID);
  const site = buildSiteProjection(siteEvents);

  if (site.build_in_progress && !site.has_farm && site.build_in_progress.completes_at <= nowUs) {
    // Find the FarmBuildStarted event to use as causation
    const buildStarted = siteEvents.findLast((e) => e.event_type === 'FarmBuildStarted');
    appendEvent(db, {
      event_type: 'FarmBuildCompleted',
      aggregate_type: 'Site',
      aggregate_id: SITE_ID,
      aggregate_version: site.version + 1,
      correlation_id: buildStarted?.correlation_id ?? null,
      causation_id: buildStarted?.event_id ?? null,
      scope_tags: ['site', 'build'],
      payload: { completed_at_world_clock: nowUs },
    });
  }

  // Check for due upgrade completion
  if (site.upgrade_in_progress && site.upgrade_in_progress.completes_at <= nowUs) {
    const upgradeStarted = siteEvents.findLast((e) => e.event_type === 'FarmUpgradeStarted');
    const payload = upgradeStarted?.payload as FarmUpgradeStartedPayload | undefined;
    const toLevel = payload?.to_level ?? site.level + 1;

    // Re-read site version in case build completed above
    const freshSiteEvents = readEventsByAggregate(db, 'Site', SITE_ID);
    const freshSite = buildSiteProjection(freshSiteEvents);

    if (freshSite.upgrade_in_progress) {
      appendEvent(db, {
        event_type: 'FarmUpgradeCompleted',
        aggregate_type: 'Site',
        aggregate_id: SITE_ID,
        aggregate_version: freshSite.version + 1,
        correlation_id: upgradeStarted?.correlation_id ?? null,
        causation_id: upgradeStarted?.event_id ?? null,
        scope_tags: ['site', 'build'],
        payload: { new_level: toLevel, completed_at_world_clock: nowUs },
      });
    }
  }
}

export function startTickLoop(db: Database.Database): ReturnType<typeof setInterval> {
  return setInterval(() => {
    processTick(db);
  }, 100);
}
