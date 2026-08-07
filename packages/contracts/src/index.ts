/**
 * Public (player-facing) contract surface.
 *
 * This is the package's main entry point and it deliberately exports **no**
 * truth type, truth event type, or truth-stream verifier. Trusted internals
 * (`@null-city/simulation`, `@null-city/server`, `@null-city/epistemics`)
 * import `@null-city/contracts/truth` instead, which is a separately
 * resolvable subpath. A player-facing workspace that only depends on this
 * entry point cannot name a truth symbol at all — the boundary is enforced by
 * package resolution, not only by lint/test convention (audit finding P1-09).
 */
export * from "./types.js";
export * from "./commands.js";
export * from "./ids.js";
export * from "./util.js";
export * from "./public.js";

export { canonicalJson, sha256, playerEventHash, verifyPlayerEventStream, GENESIS_PREVIOUS_HASH } from "./canonical.js";
export type { EventHashResult, VerifyEventStreamOptions } from "./canonical.js";
export { PlayerPayloadSchemaError, validatePlayerEventPayload } from "./player-payloads.js";
