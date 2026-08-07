/**
 * Truth-side contract surface (`@null-city/contracts/truth`).
 *
 * Re-exports the public contract plus everything a trusted internal package
 * needs: truth world state, truth event envelopes/payloads, and the truth
 * stream verifier. Importing this subpath from a player-facing workspace is a
 * boundary violation and is asserted against in each player package's
 * `forbidden-imports` test.
 */
export * from "./index.js";
export * from "./truth-state.js";
export * from "./events.js";
export * from "./truth.js";

export { eventHash, verifyEventStream, verifyEventChain } from "./canonical.js";
export { TruthPayloadSchemaError, validateTruthEventPayload } from "./truth-payloads.js";
