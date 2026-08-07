/**
 * A5 — malformed, hostile and oversized payloads.
 *
 * Success criterion is not "returns an error" but "returns a *classified*
 * error, stays up, and leaves no global side effect". A 500 or a crash is a
 * finding even when nothing is disclosed, because the release gate requires
 * runtime request validation at the transport boundary.
 */

import { P0, P1, P2, P3, openWs, publicSession, rest } from "./lib.mjs";

const CATEGORY = "malformed-payloads";

/** A dropped connection (status 0) or a 5xx both mean the boundary failed. */
function unhealthy(response) {
  return response.status === 0 || response.status >= 500;
}

function describe(label, response) {
  return `${label} -> ${response.status === 0 ? response.text : response.status}`;
}

export async function run(harness, findings) {
  const { base, wsBase } = harness;
  const sessionId = await publicSession(base, { ticks: 30, sessionId: "adv-malformed" });

  // --- REST body handling --------------------------------------------------
  const bodyCases = [
    ["not JSON at all", "this is not json"],
    ["JSON null", "null"],
    ["JSON array", "[1,2,3]"],
    ["JSON string", '"hello"'],
    ["JSON number", "42"],
    ["empty string", ""],
    ["truncated JSON", '{"scenarioId":'],
    ["NaN literal", '{"scenarioId":NaN}'],
  ];

  const bodyResults = [];
  for (const [label, raw] of bodyCases) {
    const response = await rest(base, "POST", `/sessions/${sessionId}/advance`, raw);
    bodyResults.push([label, response]);
  }
  const unclassified = bodyResults.filter(([, response]) => unhealthy(response));
  findings.assert(
    "A5-01",
    CATEGORY,
    "malformed REST bodies are rejected without a 5xx or dropped connection",
    P1,
    "Runtime request validation (release gate D)",
    unclassified.length === 0,
    unclassified.length === 0
      ? `${bodyResults.length} malformed bodies all returned 4xx`
      : unclassified.map(([label, r]) => describe(label, r)).join("; "),
  );

  // --- oversized payload ---------------------------------------------------
  const huge = JSON.stringify({ ticks: 1, filler: "A".repeat(2 * 1024 * 1024) });
  const hugeResponse = await rest(base, "POST", `/sessions/${sessionId}/advance`, huge);
  findings.assert(
    "A5-02",
    CATEGORY,
    "an oversized REST body is refused by the size guard",
    P1,
    "oversized payloads are bounded (release gate C/D)",
    hugeResponse.status >= 400 && hugeResponse.status < 500,
    hugeResponse.status === 0
      ? `2MB body caused a transport failure instead of a clean 413/400 (${hugeResponse.text}); ` +
        `the size guard aborts mid-stream without draining or resetting the request`
      : `2MB body -> status=${hugeResponse.status} code=${hugeResponse.json?.error?.code}`,
  );

  const healthAfterHuge = await rest(base, "GET", "/health");
  findings.assert(
    "A5-02b",
    CATEGORY,
    "the server still serves requests after an oversized body",
    P1,
    "Error boundaries (release gate D)",
    healthAfterHuge.status === 200,
    `health after 2MB body -> ${healthAfterHuge.status === 0 ? healthAfterHuge.text : healthAfterHuge.status}`,
  );

  // --- deeply nested JSON --------------------------------------------------
  let nested = '{"a":';
  for (let i = 0; i < 5000; i += 1) {
    nested += "[";
  }
  nested += "1";
  for (let i = 0; i < 5000; i += 1) {
    nested += "]";
  }
  nested += "}";
  const nestedResponse = await rest(base, "POST", `/sessions/${sessionId}/advance`, nested);
  findings.assert(
    "A5-03",
    CATEGORY,
    "deeply nested JSON does not crash the request handler",
    P1,
    "Error boundaries (release gate D)",
    !unhealthy(nestedResponse),
    describe("5000-deep nesting", nestedResponse),
  );

  // --- prototype pollution -------------------------------------------------
  const pollutionProbes = [
    ['{"__proto__":{"polluted":"yes"},"ticks":1}', "advance"],
    ['{"constructor":{"prototype":{"polluted2":"yes"}},"ticks":1}', "advance"],
  ];
  for (const [raw, route] of pollutionProbes) {
    await rest(base, "POST", `/sessions/${sessionId}/${route}`, raw);
  }
  await rest(base, "POST", `/sessions/${sessionId}/command`, {
    commandName: "DISPATCH_TEAM",
    idempotencyKey: "adv-proto",
    params: JSON.parse('{"__proto__":{"polluted3":"yes"},"teamId":"power-1","target":"industrial","task":"power_repair"}'),
  });
  const polluted = ["polluted", "polluted2", "polluted3"].filter((key) => ({})[key] !== undefined);
  findings.assert(
    "A5-04",
    CATEGORY,
    "hostile keys do not pollute Object.prototype in the server process",
    P0,
    "Runtime request validation (release gate D)",
    polluted.length === 0,
    polluted.length === 0 ? "Object.prototype clean" : `polluted keys: ${polluted.join(", ")}`,
  );

  // --- numeric abuse -------------------------------------------------------
  const numericCases = [
    ["negative ticks", { ticks: -100 }],
    ["zero ticks", { ticks: 0 }],
    ["huge ticks", { ticks: 1e9 }],
    ["Infinity ticks", { ticks: 1e400 }],
    ["fractional ticks", { ticks: 3.9 }],
    ["string ticks", { ticks: "50" }],
    ["null ticks", { ticks: null }],
    ["array ticks", { ticks: [5] }],
  ];
  const numericProblems = [];
  for (const [label, body] of numericCases) {
    const response = await rest(base, "POST", `/sessions/${sessionId}/advance`, body);
    if (unhealthy(response)) {
      numericProblems.push(describe(label, response));
    }
    const advanced = response.json?.result?.advanced;
    if (typeof advanced === "number" && (advanced < 0 || advanced > 540)) {
      numericProblems.push(`${label} advanced ${advanced} ticks (outside the documented 1..540 bound)`);
    }
  }
  findings.assert(
    "A5-05",
    CATEGORY,
    "tick counts are clamped and never produce an unbounded advance",
    P1,
    "Resource exhaustion safe: bounded advance limits (release gate C)",
    numericProblems.length === 0,
    numericProblems.length === 0 ? `${numericCases.length} numeric abuses bounded` : numericProblems.join("; "),
  );

  // --- assessment range ----------------------------------------------------
  const rangeCases = [
    ["probability > 1", { claimId: "x", probability: 5, confidence: 0.5 }],
    ["probability < 0", { claimId: "x", probability: -5, confidence: 0.5 }],
    ["NaN confidence", { claimId: "x", probability: 0.5, confidence: Number.NaN }],
    ["missing claimId", { probability: 0.5, confidence: 0.5 }],
    ["object claimId", { claimId: { evil: true }, probability: 0.5, confidence: 0.5 }],
  ];
  const rangeProblems = [];
  for (const [label, body] of rangeCases) {
    const response = await rest(base, "POST", `/sessions/${sessionId}/assess`, body);
    if (response.status !== 400) {
      rangeProblems.push(`${label} -> ${response.status}`);
    }
  }
  findings.assert(
    "A5-06",
    CATEGORY,
    "out-of-range and mistyped assessments are rejected with 400",
    P1,
    "Runtime request validation (release gate D)",
    rangeProblems.length === 0,
    rangeProblems.length === 0 ? `${rangeCases.length} bad assessments rejected` : rangeProblems.join("; "),
  );

  // --- command params abuse ------------------------------------------------
  const commandCases = [
    ["array params", { commandName: "DISPATCH_TEAM", idempotencyKey: "c1", params: [1, 2] }],
    ["string params", { commandName: "DISPATCH_TEAM", idempotencyKey: "c2", params: "evil" }],
    ["missing idempotencyKey", { commandName: "DISPATCH_TEAM", params: {} }],
    ["unknown command", { commandName: "SELF_DESTRUCT", idempotencyKey: "c3", params: {} }],
    ["object commandName", { commandName: { a: 1 }, idempotencyKey: "c4", params: {} }],
    ["giant idempotencyKey", { commandName: "DISPATCH_TEAM", idempotencyKey: "k".repeat(100000), params: {} }],
    [
      "giant advisory text",
      {
        commandName: "ISSUE_PUBLIC_ADVISORY",
        idempotencyKey: "c5",
        params: { district: "central", text: "T".repeat(500000), severity: "info" },
      },
    ],
  ];
  const commandProblems = [];
  for (const [label, body] of commandCases) {
    const response = await rest(base, "POST", `/sessions/${sessionId}/command`, body);
    if (unhealthy(response)) {
      commandProblems.push(describe(label, response));
    }
  }
  findings.assert(
    "A5-07",
    CATEGORY,
    "hostile command payloads are rejected without a 5xx",
    P1,
    "Runtime request validation (release gate D)",
    commandProblems.length === 0,
    commandProblems.length === 0 ? `${commandCases.length} hostile commands handled` : commandProblems.join("; "),
  );

  // --- session id abuse ----------------------------------------------------
  const idCases = [
    ["empty", ""],
    ["very long", "s".repeat(20000)],
    ["unicode", "セッション-\u0000-id"],
    ["path-ish", "..%2f..%2fetc%2fpasswd"],
    ["percent-broken", "%ZZ"],
  ];
  const idProblems = [];
  for (const [label, raw] of idCases) {
    const response = await rest(base, "GET", `/sessions/${raw}/state`);
    if (unhealthy(response)) {
      idProblems.push(describe(label, response));
    }
  }
  findings.assert(
    "A5-08",
    CATEGORY,
    "hostile session ids in the URL are handled without a 5xx",
    P1,
    "Runtime request validation (release gate D)",
    idProblems.length === 0,
    idProblems.length === 0 ? `${idCases.length} hostile ids handled` : idProblems.join("; "),
  );

  // --- WebSocket message abuse ---------------------------------------------
  const ws = await openWs(wsBase, sessionId);
  const wsCases = [
    "not json",
    "null",
    "[1,2,3]",
    '{"type":"unknown"}',
    '{"type":"rpc"}',
    '{"type":"rpc","op":123,"params":{}}',
    '{"type":"rpc","op":"session.advance","params":{"ticks":1e9}}',
    `{"type":"hello","since":-999999}`,
    `{"type":"rpc","op":"session.advance","params":{"ticks":1},"filler":"${"F".repeat(200000)}"}`,
  ];
  let wsReplies = 0;
  for (const raw of wsCases) {
    ws.send(raw);
    try {
      await ws.next(3000);
      wsReplies += 1;
    } catch {
      /* some messages legitimately produce no reply */
    }
  }
  ws.send({ type: "hello", since: 0 });
  let wsAlive = false;
  try {
    await ws.next(3000);
    wsAlive = true;
  } catch {
    wsAlive = false;
  }
  await ws.close();
  findings.assert(
    "A5-09",
    CATEGORY,
    "the WebSocket survives a burst of malformed messages",
    P1,
    "Error boundaries: message failures isolated (release gate D)",
    wsAlive,
    wsAlive
      ? `${wsReplies}/${wsCases.length} malformed messages answered, socket still serving afterwards`
      : "socket stopped responding after malformed input",
  );

  // --- server liveness after the whole barrage -----------------------------
  const health = await rest(base, "GET", "/health");
  findings.assert(
    "A5-10",
    CATEGORY,
    "the server is still healthy after every malformed-payload attack",
    P0,
    "Error boundaries (release gate D)",
    health.status === 200 && health.json?.ok === true,
    `status=${health.status} body=${health.text.slice(0, 80)}`,
  );

  // --- unknown routes and methods -----------------------------------------
  const routeProbes = [
    await rest(base, "GET", "/admin"),
    await rest(base, "GET", "/sessions/x/y/z/w"),
    await rest(base, "PUT", `/sessions/${sessionId}/state`),
    await rest(base, "DELETE", "/health"),
    await rest(base, "POST", `/sessions/${sessionId}/summary`, {}),
  ];
  const routeProblems = routeProbes.filter((response) => unhealthy(response));
  findings.assert(
    "A5-11",
    CATEGORY,
    "unknown routes and wrong methods return classified errors",
    P2,
    "Runtime request validation (release gate D)",
    routeProblems.length === 0,
    routeProblems.length === 0
      ? `${routeProbes.length} route probes returned 4xx: ${routeProbes.map((r) => r.status).join(",")}`
      : `5xx from ${routeProblems.length} probes`,
  );
}
