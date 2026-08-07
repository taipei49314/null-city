/**
 * A7 — adapter parity and adapter-specific privilege.
 *
 * The public claim is that the browser, SDK, benchmark policies and MCP tools
 * all consume one `PlayerSession` contract with no agent-only endpoint. The
 * attack is therefore to look for *asymmetry*: any field an adapter can see
 * that raw REST cannot, and any truth reachable through an adapter.
 */

import { createPlayerSession } from "../../packages/sdk/dist/index.js";

import { P0, P1, P2, publicSession, rest, scanForTruth, truthOracle } from "./lib.mjs";

const CATEGORY = "adapter-parity";

export async function run(harness, findings) {
  const { base, hub } = harness;

  // --- SDK vs raw REST -----------------------------------------------------
  const session = await createPlayerSession({
    baseUrl: base,
    scenarioId: "black-river",
    seed: 49314,
  });
  const sessionId = session.sessionId;

  await session.advance(120);
  const sdkState = await session.getState();
  const restState = (await rest(base, "GET", `/sessions/${sessionId}/state`)).json.result.state;

  const oracle = truthOracle(hub, sessionId);

  const sdkLeaks = scanForTruth(oracle, "sdk getState", sdkState);
  findings.assert(
    "A7-01",
    CATEGORY,
    "SDK player state carries no truth",
    P0,
    "No active-run truth leak through the SDK (release gate A)",
    sdkLeaks.length === 0,
    sdkLeaks.length === 0 ? "clean" : sdkLeaks.join("; "),
  );

  const sdkKeys = Object.keys(sdkState).sort();
  const restKeys = Object.keys(restState).sort();
  const sdkOnly = sdkKeys.filter((key) => !restKeys.includes(key));
  findings.assert(
    "A7-02",
    CATEGORY,
    "the SDK sees no field the raw public REST view does not",
    P0,
    "Human/agent parity: no agent-only privilege (release gate A)",
    sdkOnly.length === 0,
    sdkOnly.length === 0
      ? `identical key sets (${sdkKeys.length} keys)`
      : `SDK-only fields: ${sdkOnly.join(", ")}`,
  );

  // --- SDK cannot reach a privileged op ------------------------------------
  const privilegedProbes = [];
  for (const op of ["admin.snapshot", "session.snapshot"]) {
    const response = await rest(base, "POST", "/sessions", { op });
    privilegedProbes.push([op, response.status]);
  }
  const snapshotViaRest = await rest(base, "GET", `/sessions/${sessionId}/snapshot`);
  findings.assert(
    "A7-03",
    CATEGORY,
    "no adapter can reach a privileged snapshot op over the network",
    P0,
    "no adapter-specific truth endpoint (public contract rule)",
    snapshotViaRest.status === 403 && !snapshotViaRest.text.includes("prngState"),
    `GET snapshot -> ${snapshotViaRest.status}; op-injection probes -> ${JSON.stringify(privilegedProbes)}`,
  );

  // --- SDK response validation --------------------------------------------
  // The SDK claims runtime validation of server responses. Point it at a
  // server that answers with a well-formed-but-wrong payload and confirm it
  // refuses rather than passing garbage to the caller.
  const { createServer: createRawServer } = await import("node:http");
  const liar = createRawServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { sessionId: "x", nonsense: true } }));
  });
  const liarPort = await new Promise((resolve) => {
    liar.listen(0, "127.0.0.1", () => resolve(liar.address().port));
  });
  let sdkRejected = false;
  let sdkMessage = "";
  try {
    await createPlayerSession({
      baseUrl: `http://127.0.0.1:${liarPort}`,
      scenarioId: "black-river",
      seed: 1,
    });
  } catch (error) {
    sdkRejected = true;
    sdkMessage = error?.constructor?.name ?? String(error);
  }
  liar.closeAllConnections?.();
  await new Promise((resolve) => liar.close(resolve));
  findings.assert(
    "A7-04",
    CATEGORY,
    "the SDK validates server responses at runtime instead of trusting them",
    P1,
    "Public responses require runtime validation (public contract rule)",
    sdkRejected,
    sdkRejected ? `rejected with ${sdkMessage}` : "the SDK accepted a structurally invalid server response",
  );

  // --- MCP adapter ---------------------------------------------------------
  const mcpModule = await import("../../packages/mcp-server/dist/index.js");
  const exported = Object.keys(mcpModule);
  const privilegedExports = exported.filter((name) => /snapshot|truth|admin|internal/i.test(name));
  findings.assert(
    "A7-05",
    CATEGORY,
    "the MCP package exports no privileged truth surface",
    P0,
    "no adapter-specific truth endpoint (public contract rule)",
    privilegedExports.length === 0,
    privilegedExports.length === 0
      ? `exports: ${exported.join(", ")}`
      : `privileged exports: ${privilegedExports.join(", ")}`,
  );

  // Drive the real tool registry and scan every tool result.
  const registered = [];
  const fakeMcpServer = {
    registerTool(name, config, handler) {
      registered.push({ name, config, handler });
    },
  };
  mcpModule.registerNullCityTools(fakeMcpServer, session);

  const toolNames = registered.map((tool) => tool.name).sort();
  findings.assert(
    "A7-06",
    CATEGORY,
    "no MCP tool is named for a privileged or truth operation",
    P0,
    "no adapter-specific truth endpoint (public contract rule)",
    !toolNames.some((name) => /snapshot|truth|admin|internal|debug/i.test(name)),
    `tools: ${toolNames.join(", ")}`,
  );

  const toolLeaks = [];
  const readOnlyTools = registered.filter((tool) => tool.config?.annotations?.readOnlyHint === true);
  for (const tool of readOnlyTools) {
    let result;
    try {
      result = await tool.handler({}, {});
    } catch (error) {
      result = { error: String(error) };
    }
    toolLeaks.push(...scanForTruth(oracle, `mcp ${tool.name}`, result));
  }
  findings.assert(
    "A7-07",
    CATEGORY,
    "every read-only MCP tool result is free of truth",
    P0,
    "No active-run truth leak through MCP (release gate A)",
    toolLeaks.length === 0,
    toolLeaks.length === 0
      ? `${readOnlyTools.length} read-only tools scanned clean`
      : toolLeaks.join("; "),
  );

  // --- MCP bounded outputs -------------------------------------------------
  const listTool = registered.find((tool) => tool.name === "get_events");
  if (!listTool) {
    findings.blocked(
      "A7-08",
      CATEGORY,
      "MCP list tools bound their output",
      P2,
      "Resource exhaustion safe (release gate C)",
      `get_events tool not registered; available tools: ${toolNames.join(", ")}`,
    );
  } else {
    const listed = await listTool.handler({ since: 0, limit: 100000 }, {});
    const text = listed.content?.[0]?.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    const returned = Array.isArray(parsed.events)
      ? parsed.events.length
      : Array.isArray(parsed.items)
        ? parsed.items.length
        : Number.NaN;
    findings.assert(
      "A7-08",
      CATEGORY,
      "MCP event listing is bounded regardless of the requested limit",
      P2,
      "Resource exhaustion safe (release gate C)",
      Number.isFinite(returned) && returned <= 200,
      `requested limit=100000, returned ${returned} events (cap is 200)`,
    );
  }

  // --- benchmark: a hostile policy trying to observe truth -----------------
  // A policy is the benchmark's untrusted code. This one records every byte it
  // is ever handed, so the scan below is over exactly what a cheating policy
  // could see.
  const { runOne } = await import("../../packages/benchmark/dist/index.js");
  const observed = [];
  const hostilePolicy = {
    id: "adversarial-observer",
    async reset(context) {
      observed.push(["reset context", JSON.stringify(context)]);
    },
    async decide(input) {
      observed.push(["decide input", JSON.stringify(input)]);
      observed.push(["decide input keys", JSON.stringify(Object.keys(input))]);
      observed.push(["globalThis probe", JSON.stringify(Object.keys(globalThis).filter((k) => /truth|engine|hub/i.test(k)))]);
      return { commands: [], assessments: [] };
    },
  };

  const record = await runOne({
    scenarioId: "black-river",
    seed: 49314,
    policy: hostilePolicy,
    tickStep: 90,
  });

  // Generic markers only: this run has its own server and its own secrets, so
  // the session-specific oracle from above does not apply to it.
  const genericOracle = {
    secretKinds: oracle.secretKinds,
    corruptionSecrets: [],
    undisclosedIncidentIds: [],
  };
  const policyLeaks = [];
  for (const [label, text] of observed) {
    policyLeaks.push(...scanForTruth(genericOracle, label, text));
  }
  policyLeaks.push(...scanForTruth(genericOracle, "benchmark run record", JSON.stringify(record)));

  findings.assert(
    "A7-09",
    CATEGORY,
    "a hostile benchmark policy is never handed truth",
    P0,
    "no policy or MCP tool ever receives truth (README claim)",
    policyLeaks.length === 0 && observed.length > 1,
    policyLeaks.length === 0
      ? `${observed.length} policy observations + the run record scanned clean ` +
        `(policy saw only keys: ${observed.find(([l]) => l === "decide input keys")?.[1]})`
      : policyLeaks.join("; "),
  );

  findings.assert(
    "A7-10",
    CATEGORY,
    "the benchmark independently verifies the player log hash chain",
    P1,
    "benchmark scores are computed from a verified log (release gate A)",
    record.playerLogVerified === true,
    `playerLogVerified=${record.playerLogVerified} playerEventCount=${record.playerEventCount} ` +
      `phase=${record.phase}`,
  );

  await session.close?.();
}
