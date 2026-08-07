import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CommandName } from "@null-city/contracts";
import { ApiError, type PlayerSession } from "@null-city/sdk";

import { bound, clampInt, MAX_EVENTS_PER_CALL, MAX_LIST_ITEMS, MAX_RATIONALE_LENGTH } from "./limits.js";

/**
 * The exact `CommandName` union from `@null-city/contracts`, restated as a
 * runtime array so the tool's input schema can validate it (and so a
 * client can discover the allowed values without guessing). Keep in sync
 * with `packages/contracts/src/commands.ts`; `test/parity.test.ts` fails
 * if a command name here would be rejected by the server.
 */
const COMMAND_NAMES = [
  "DISPATCH_TEAM",
  "REROUTE_POWER",
  "ACTIVATE_BACKUP_GENERATOR",
  "CLOSE_ROUTE",
  "REOPEN_ROUTE",
  "REQUEST_VERIFICATION",
  "INSPECT_DISTRICT",
  "ISSUE_PUBLIC_ADVISORY",
  "PRIORITIZE_COMMUNICATION",
  "CANCEL_ORDER",
] as const satisfies readonly CommandName[];

function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiError ? error.code : "tool_error";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: code, message }, null, 2) }],
  };
}

/**
 * Registers every NullCity tool against a single, already-created
 * `PlayerSession`. This is the *only* thing the adapter is built on: no
 * tool here reaches for `@null-city/simulation`, `@null-city/epistemics`,
 * or any truth-shaped payload. `test/forbidden-imports.test.ts` and
 * `test/parity.test.ts` both police that boundary.
 */
export function registerNullCityTools(server: McpServer, session: PlayerSession): void {
  server.registerTool(
    "get_state",
    {
      title: "Get player state",
      description:
        "Returns the current player-visible session state: tick, phase, claims, evidence, " +
        "assessments, own teams, known routes, resources, and score. Rebuilt server-side from " +
        "player events alone — never truth. Large sub-lists are capped; call the more specific " +
        "list_* tools with pagination for full detail.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const state = await session.getState();
        const claims = bound(state.claims, MAX_LIST_ITEMS);
        const evidence = bound(state.evidence, MAX_LIST_ITEMS);
        const assessments = bound(state.assessments, MAX_LIST_ITEMS);
        return textResult({
          sessionId: state.sessionId,
          scenarioId: state.scenarioId,
          tick: state.tick,
          phase: state.phase,
          resources: state.resources,
          score: state.score,
          playerEventCount: state.playerEventCount,
          playerLogHash: state.playerLogHash,
          claims: claims.items,
          claimsTotal: claims.total,
          claimsTruncated: claims.truncated,
          evidence: evidence.items,
          evidenceTotal: evidence.total,
          evidenceTruncated: evidence.truncated,
          assessments: assessments.items,
          assessmentsTotal: assessments.total,
          assessmentsTruncated: assessments.truncated,
          teamCount: state.teams.length,
          routeCount: state.routes.length,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_events",
    {
      title: "Get player events",
      description:
        "Returns player events strictly after `afterSequence` (default 0 = from genesis), the " +
        `same hash-chained public event log the SDK/browser read. Bounded to ${MAX_EVENTS_PER_CALL} ` +
        "events per call; pass `afterSequence` set to the last returned event's `sequence` to page.",
      inputSchema: {
        afterSequence: z.number().int().min(0).default(0).describe("Return only events with sequence > this value."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_EVENTS_PER_CALL)
          .default(MAX_EVENTS_PER_CALL)
          .describe(`Maximum events to return (<= ${MAX_EVENTS_PER_CALL}).`),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ afterSequence, limit }) => {
      try {
        const events = await session.getEvents(afterSequence);
        const capped = bound(events, limit);
        return textResult({
          events: capped.items,
          total: capped.total,
          truncated: capped.truncated,
          nextAfterSequence: capped.items.length > 0 ? capped.items[capped.items.length - 1]!.sequence : afterSequence,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_claims",
    {
      title: "List claims",
      description:
        "Lists the player-visible epistemic claims (reported/corroborated/contested/verified/" +
        "refuted/stale), optionally filtered by status and/or district. Paginated with `offset`/`limit`.",
      inputSchema: {
        status: z
          .enum(["reported", "corroborated", "contested", "verified", "refuted", "stale"])
          .optional()
          .describe("Only return claims with this status."),
        districtId: z.string().optional().describe("Only return claims in this district."),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(MAX_LIST_ITEMS).default(MAX_LIST_ITEMS),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ status, districtId, offset, limit }) => {
      try {
        const state = await session.getState();
        let claims = state.claims;
        if (status !== undefined) {
          claims = claims.filter((claim) => claim.status === status);
        }
        if (districtId !== undefined) {
          claims = claims.filter((claim) => claim.districtId === districtId);
        }
        const page = bound(claims.slice(offset), limit);
        return textResult({ claims: page.items, total: claims.length, truncated: page.truncated, offset, limit });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_teams",
    {
      title: "List own teams",
      description: "Lists the player's own response teams: id, type, location, status, current order.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const state = await session.getState();
        const page = bound(state.teams, MAX_LIST_ITEMS);
        return textResult({ teams: page.items, total: page.total, truncated: page.truncated });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_routes",
    {
      title: "List known routes",
      description: "Lists routes the player currently knows about: id, closed flag, and when closure was learned.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const state = await session.getState();
        const page = bound(state.routes, MAX_LIST_ITEMS);
        return textResult({ routes: page.items, total: page.total, truncated: page.truncated });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "submit_command",
    {
      title: "Submit command",
      description:
        "Submits one operational command (dispatch a team, reroute power, close/reopen a route, " +
        "request verification, issue a public advisory, etc). Safe to retry: an `idempotencyKey` " +
        "is generated when omitted, and a retried call that hits the engine's duplicate-command " +
        "check is reported back as `deduplicated: true` rather than a fresh rejection.",
      inputSchema: {
        commandName: z.enum(COMMAND_NAMES),
        params: z.record(z.string(), z.unknown()).describe("Command-specific parameters; see contracts for each commandName's shape."),
        idempotencyKey: z.string().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ commandName, params, idempotencyKey }) => {
      try {
        const outcome = await session.submitCommand({ commandName, params, idempotencyKey });
        return textResult({
          commandId: outcome.commandId,
          idempotencyKey: outcome.idempotencyKey,
          state: outcome.state,
          etaTick: outcome.etaTick,
          validation: outcome.validation,
          result: outcome.result,
          deduplicated: outcome.deduplicated,
          newEventCount: outcome.events.length,
          tick: outcome.publicState.tick,
          scoreTotal: outcome.publicState.score.total,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "submit_assessment",
    {
      title: "Submit assessment",
      description:
        "Submits a probability/confidence assessment against an existing claim (both in [0,1]). " +
        "Not auto-retried by the SDK — a lost response must not risk recording the same belief twice.",
      inputSchema: {
        claimId: z.string().min(1),
        probability: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
        rationale: z.string().max(MAX_RATIONALE_LENGTH).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ claimId, probability, confidence, rationale }) => {
      try {
        const outcome = await session.submitAssessment({ claimId, probability, confidence, rationale });
        return textResult({
          assessment: outcome.assessment,
          newEventCount: outcome.events.length,
          tick: outcome.publicState.tick,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "advance_time",
    {
      title: "Advance time",
      description:
        "Advances the deterministic clock by up to `ticks` (server-clamped to [1,540]). This is " +
        "the same call every client — human, benchmark policy, or MCP agent — uses to move time " +
        "forward; the kernel never advances on a wall-clock timer. Not auto-retried by the SDK. " +
        "`tick` is the player-observed tick (the same field `get_state` returns, which can lag " +
        "the clock while newsworthy events are still in flight); `clockAdvancedTo` is the raw " +
        "count of ticks the deterministic clock itself moved, for bookkeeping only.",
      inputSchema: {
        ticks: z.number().int().min(1).max(540),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ticks }) => {
      try {
        const bounded = clampInt(ticks, 1, 540);
        const outcome = await session.advance(bounded);
        return textResult({
          tick: outcome.publicState.tick,
          clockAdvancedTo: outcome.tick,
          advanced: outcome.advanced,
          completed: outcome.completed,
          newEventCount: outcome.events.length,
          scoreTotal: outcome.publicState.score.total,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_completed_summary",
    {
      title: "Get completed run summary",
      description:
        "Returns the terminal run summary (final tick, total score, claim/evidence/assessment " +
        "counts, player log hash, and claims) once the run has completed, or `{ completed: false }` " +
        "while it is still active. No truth is ever exposed here or anywhere else in this adapter.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const summary = await session.getCompletedRun();
        if (summary === null) {
          return textResult({ completed: false });
        }
        const claims = bound(summary.claims, MAX_LIST_ITEMS);
        return textResult({
          completed: true,
          sessionId: summary.sessionId,
          scenarioId: summary.scenarioId,
          finalTick: summary.finalTick,
          scoreTotal: summary.scoreTotal,
          claimCount: summary.claimCount,
          evidenceCount: summary.evidenceCount,
          assessmentCount: summary.assessmentCount,
          playerLogHash: summary.playerLogHash,
          claims: claims.items,
          claimsTruncated: claims.truncated,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
