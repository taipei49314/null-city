/**
 * Connection configuration for the MCP adapter. Every field here maps to a
 * plain env var (or CLI flag, parsed in `cli.ts`) so the process can be
 * pointed at any already-running `@null-city/server` instance — there is
 * no in-process shortcut and no truth-side configuration knob.
 */
export interface McpConnectionConfig {
  /** e.g. `http://127.0.0.1:8787` — no trailing slash. */
  baseUrl: string;
  scenarioId: string;
  seed: number;
  /** Server generates one when omitted. */
  sessionId?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_SCENARIO_ID = "black-river";
const DEFAULT_SEED = 49314;

/** Reads connection config from environment variables, with safe defaults matching the reference CLI player/benchmark. */
export function readConfigFromEnv(env: Record<string, string | undefined> = process.env): McpConnectionConfig {
  const seedRaw = env["NULLCITY_SEED"];
  const seed = seedRaw === undefined ? DEFAULT_SEED : Number.parseInt(seedRaw, 10);
  if (!Number.isFinite(seed)) {
    throw new Error(`NULLCITY_SEED must be an integer, got ${JSON.stringify(seedRaw)}`);
  }

  const timeoutRaw = env["NULLCITY_TIMEOUT_MS"];
  const maxRetriesRaw = env["NULLCITY_MAX_RETRIES"];

  return {
    baseUrl: env["NULLCITY_BASE_URL"] ?? DEFAULT_BASE_URL,
    scenarioId: env["NULLCITY_SCENARIO_ID"] ?? DEFAULT_SCENARIO_ID,
    seed,
    ...(env["NULLCITY_SESSION_ID"] === undefined ? {} : { sessionId: env["NULLCITY_SESSION_ID"] }),
    ...(timeoutRaw === undefined ? {} : { timeoutMs: Number.parseInt(timeoutRaw, 10) }),
    ...(maxRetriesRaw === undefined ? {} : { maxRetries: Number.parseInt(maxRetriesRaw, 10) }),
  };
}
