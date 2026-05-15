export type EventEnvelope = {
  event_id: string;
  event_type: EventType;
  aggregate_type: AggregateType;
  aggregate_id: string;
  aggregate_version: number;
  world_clock_at: number; // microseconds since world start
  wall_clock_at: number;  // ms since Unix epoch
  correlation_id: string | null;
  causation_id: string | null;
  scope_tags: string[];
  payload: EventPayload;
};

export type AggregateType = 'Player' | 'Site' | 'World';

export type EventType =
  | 'FarmBuildStarted'
  | 'FarmBuildCompleted'
  | 'FarmUpgradeStarted'
  | 'FarmUpgradeCompleted'
  | 'MoneyReceived'
  | 'MoneySpent'
  | 'MoneyRefunded'
  | 'WorldTickAdvanced';

export type FarmBuildStartedPayload = {
  started_at_world_clock: number;
  completes_at_world_clock: number;
};

export type FarmBuildCompletedPayload = {
  completed_at_world_clock: number;
};

export type FarmUpgradeStartedPayload = {
  from_level: number;
  to_level: number;
  started_at_world_clock: number;
  completes_at_world_clock: number;
};

export type FarmUpgradeCompletedPayload = {
  new_level: number;
  completed_at_world_clock: number;
};

export type MoneyReceivedPayload = {
  amount: number;
  source: string;
};

export type MoneySpentPayload = {
  amount: number;
  reason: string;
};

export type MoneyRefundedPayload = {
  amount: number;
  reason: string;
};

export type WorldTickAdvancedPayload = {
  tick_number: number;
};

export type EventPayload =
  | FarmBuildStartedPayload
  | FarmBuildCompletedPayload
  | FarmUpgradeStartedPayload
  | FarmUpgradeCompletedPayload
  | MoneyReceivedPayload
  | MoneySpentPayload
  | MoneyRefundedPayload
  | WorldTickAdvancedPayload;

export type NewEventInput = Omit<EventEnvelope, 'event_id' | 'world_clock_at' | 'wall_clock_at'>;
