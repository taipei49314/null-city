import type { PlayerEventEnvelope } from "@null-city/contracts";
import { detectPublicLeak } from "@null-city/epistemics";

/** @deprecated M1 uses the epistemics player stream; kept for leak test helpers. */
export function toPlayerEvents(events: readonly PlayerEventEnvelope[]): PlayerEventEnvelope[] {
  return events.map((event) => structuredClone(event));
}

export function containsForbiddenTruth(value: unknown): string | null {
  return detectPublicLeak(value);
}
