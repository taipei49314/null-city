import type { EventEnvelope, EventKindName } from "@null-city/contracts/truth";

/** Mirrors the server player transport allow-list for receipt playerLogHash. */
export const PLAYER_EVENT_KINDS: ReadonlySet<EventKindName> = new Set([
  "ScenarioStarted",
  "ObservationCreated",
  "ObservationDelayed",
  "ObservationCorrupted",
  "ObservationLost",
  "ObservationDelivered",
  "CommandIssued",
  "CommandRejected",
  "CommandAccepted",
  "TeamDispatched",
  "TeamArrived",
  "ActionApplied",
  "ScoreChanged",
  "ScenarioCompleted",
]);

export function toPlayerEventLog(events: readonly EventEnvelope[]): EventEnvelope[] {
  return events.filter((event) => PLAYER_EVENT_KINDS.has(event.kind)).map((event) => structuredClone(event));
}
