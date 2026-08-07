import type { EventEnvelope } from "./events.js";

/**
 * Internal truth stream events. Only the kernel and trusted server internals
 * may consume these. Public clients must use PlayerEventEnvelope instead.
 */
export type TruthEvent = EventEnvelope;

export type TruthEventEnvelope = EventEnvelope & { stream?: "truth" };

export function asTruthEvent(event: EventEnvelope): TruthEventEnvelope {
  return { ...event, stream: "truth" };
}
