import type { EventEnvelope, MoneyReceivedPayload, MoneySpentPayload, MoneyRefundedPayload } from './events.js';

export type PlayerState = {
  money: number;
  version: number; // current max aggregate_version, 0 if no events
};

export function buildPlayerProjection(events: EventEnvelope[]): PlayerState {
  let money = 0;
  let version = 0;

  for (const e of events) {
    version = e.aggregate_version;
    switch (e.event_type) {
      case 'MoneyReceived':
        money += (e.payload as MoneyReceivedPayload).amount;
        break;
      case 'MoneySpent':
        money -= (e.payload as MoneySpentPayload).amount;
        break;
      case 'MoneyRefunded':
        money += (e.payload as MoneyRefundedPayload).amount;
        break;
    }
  }

  return { money, version };
}
