import { buildRunArtifact, scenarioDigest, type RunArtifact } from "@null-city/simulation";
import type { SessionRecord } from "./hub.js";

/**
 * Exports a completed session's run artifact.
 *
 * Only callable when the engine has reached `phase === "completed"` —
 * `buildRunArtifact` itself throws if the truth log has not reached
 * `ScenarioCompleted`, so an active session structurally cannot produce an
 * artifact. Callers (rpc.ts) additionally check phase first so active
 * sessions get an actionable `not_completed` error instead of a thrown
 * exception.
 */
export function buildSessionArtifact(record: SessionRecord): RunArtifact {
  return buildRunArtifact({
    result: record.engine.result(),
    scenarioDigest: scenarioDigest(record.engine.scenario),
    truthEvents: record.engine.eventLog,
    playerEvents: record.bridge.playerEvents,
    publicActionLedger: record.publicActionLedger,
  });
}
