import type { CommandName, EventEnvelope } from "@null-city/contracts/truth";
import type { Scenario } from "@null-city/scenario-schema";

import { SimulationEngine } from "./engine.js";

/**
 * Deterministic replay.
 *
 * The engine is re-run from an empty world using the same scenario and seed.
 * Commands are re-submitted at the exact tick recorded in the event log, in
 * log order. Because the engine is deterministic, the regenerated event log
 * must be byte-identical to the original (same hash chain).
 */
export function replayEventLog(
  events: readonly EventEnvelope[],
  scenario: Scenario,
  sessionId: string,
  seed: number,
): SimulationEngine {
  const engine = new SimulationEngine({ scenario, seed, sessionId });

  for (const event of events) {
    if (event.kind !== "CommandIssued") {
      continue;
    }
    const payload = event.payload as {
      commandId: string;
      commandName: CommandName;
      idempotencyKey: string;
      params: Record<string, unknown>;
    };
    while (engine.currentTick < event.tick && engine.step()) {
      // advance to the tick where the command was issued
    }
    if (engine.currentTick === event.tick) {
      engine.submitCommand(payload.commandName, payload.params, payload.idempotencyKey);
    }
  }

  engine.runToEnd();
  return engine;
}

export function replayResult(
  events: readonly EventEnvelope[],
  scenario: Scenario,
  sessionId: string,
  seed: number,
) {
  const engine = replayEventLog(events, scenario, sessionId, seed);
  return {
    engine,
    eventLogHash: engine.eventLogHash,
    finalStateDigest: engine.finalStateDigest(),
    score: engine.worldState.score.total,
  };
}