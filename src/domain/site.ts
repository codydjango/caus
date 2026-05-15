import type {
  EventEnvelope,
  FarmBuildStartedPayload,
  FarmUpgradeStartedPayload,
  FarmUpgradeCompletedPayload,
} from './events.js';

export type TimerState = {
  started_at: number;
  completes_at: number;
};

export type UpgradeTimerState = TimerState & {
  from_level: number;
  to_level: number;
};

export type SiteState = {
  has_farm: boolean;
  level: number;
  build_in_progress: TimerState | null;
  upgrade_in_progress: UpgradeTimerState | null;
  version: number;
};

export function buildSiteProjection(events: EventEnvelope[]): SiteState {
  let has_farm = false;
  let level = 0;
  let build_in_progress: TimerState | null = null;
  let upgrade_in_progress: UpgradeTimerState | null = null;
  let version = 0;

  for (const e of events) {
    version = e.aggregate_version;
    switch (e.event_type) {
      case 'FarmBuildStarted': {
        const p = e.payload as FarmBuildStartedPayload;
        build_in_progress = { started_at: p.started_at_world_clock, completes_at: p.completes_at_world_clock };
        break;
      }
      case 'FarmBuildCompleted': {
        has_farm = true;
        level = 1;
        build_in_progress = null;
        break;
      }
      case 'FarmUpgradeStarted': {
        const p = e.payload as FarmUpgradeStartedPayload;
        upgrade_in_progress = {
          from_level: p.from_level,
          to_level: p.to_level,
          started_at: p.started_at_world_clock,
          completes_at: p.completes_at_world_clock,
        };
        break;
      }
      case 'FarmUpgradeCompleted': {
        const p = e.payload as FarmUpgradeCompletedPayload;
        level = p.new_level;
        upgrade_in_progress = null;
        break;
      }
    }
  }

  return { has_farm, level, build_in_progress, upgrade_in_progress, version };
}
