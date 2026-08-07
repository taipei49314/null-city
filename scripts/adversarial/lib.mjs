/**
 * Shared harness for the M8 adversarial release-candidate review.
 *
 * Design rule for this directory: an attack must observe the *production*
 * surface (the real `createServer()` REST/WS transport, the real SDK, the
 * real MCP adapter) and judge it against an oracle derived independently of
 * the code under test. Nothing here may import a test-only shim.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createServer } from "../../packages/server/dist/index.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Resolves `ws` the same way the server package does, without guessing a path. */
export function loadWs() {
  const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
  const loaded = require("ws");
  return loaded.WebSocket ?? loaded.default ?? loaded;
}

export { REPO_ROOT };

export const P0 = "P0";
export const P1 = "P1";
export const P2 = "P2";
export const P3 = "P3";

/** A defence held. */
export const DEFENDED = "DEFENDED";
/** The attack succeeded — the claim under test is falsified. */
export const VULNERABLE = "VULNERABLE";
/** The attack could not be executed in this environment. */
export const BLOCKED = "BLOCKED";
/**
 * The attack succeeded, the behaviour is real and reproduced here, and the
 * owner has accepted it as a documented limitation rather than a defect.
 * Distinct from DEFENDED so it can never be read as "we found nothing", and
 * distinct from VULNERABLE so a real regression still stands out.
 */
export const ACCEPTED = "ACCEPTED";

export class Findings {
  constructor() {
    this.items = [];
  }

  add(finding) {
    if (!finding.id || !finding.title || !finding.category) {
      throw new Error(`malformed finding: ${JSON.stringify(finding)}`);
    }
    if (![DEFENDED, VULNERABLE, BLOCKED, ACCEPTED].includes(finding.status)) {
      throw new Error(`bad status ${finding.status} on ${finding.id}`);
    }
    if (this.items.some((item) => item.id === finding.id)) {
      throw new Error(`duplicate finding id ${finding.id}`);
    }
    this.items.push(finding);
    const marks = { [DEFENDED]: "ok  ", [BLOCKED]: "skip", [ACCEPTED]: "note", [VULNERABLE]: "FAIL" };
    process.stdout.write(`  [${marks[finding.status]}] ${finding.id} ${finding.title}\n`);
    if (finding.status === VULNERABLE) {
      process.stdout.write(`         severity=${finding.severity} observed=${finding.observed}\n`);
    }
    if (finding.status === ACCEPTED) {
      process.stdout.write(`         severity=${finding.severity} accepted: ${finding.rationale}\n`);
    }
    if (finding.status === BLOCKED) {
      process.stdout.write(`         reason=${finding.observed}\n`);
    }
    return finding;
  }

  /** Records DEFENDED when `held` is true, VULNERABLE otherwise. */
  assert(id, category, title, severity, claim, held, observed) {
    return this.add({
      id,
      category,
      title,
      severity,
      claim,
      status: held ? DEFENDED : VULNERABLE,
      observed,
    });
  }

  blocked(id, category, title, severity, claim, reason) {
    return this.add({ id, category, title, severity, claim, status: BLOCKED, observed: reason });
  }

  /**
   * Records a reproduced-but-accepted behaviour. `held` exists so that if the
   * behaviour ever changes (the attack starts failing), the entry flips to
   * DEFENDED rather than silently continuing to claim an accepted risk.
   */
  accept(id, category, title, severity, claim, held, observed, rationale) {
    if (!rationale) {
      throw new Error(`accepted finding ${id} needs a rationale`);
    }
    return this.add({
      id,
      category,
      title,
      severity,
      claim,
      status: held ? DEFENDED : ACCEPTED,
      observed,
      rationale,
    });
  }

  get vulnerable() {
    return this.items.filter((item) => item.status === VULNERABLE);
  }

  get acceptedItems() {
    return this.items.filter((item) => item.status === ACCEPTED);
  }

  get blockedItems() {
    return this.items.filter((item) => item.status === BLOCKED);
  }

  counts() {
    const out = {
      total: this.items.length,
      defended: 0,
      vulnerable: 0,
      accepted: 0,
      blocked: 0,
      P0: 0,
      P1: 0,
      P2: 0,
      P3: 0,
    };
    for (const item of this.items) {
      if (item.status === DEFENDED) out.defended += 1;
      if (item.status === BLOCKED) out.blocked += 1;
      if (item.status === ACCEPTED) out.accepted += 1;
      if (item.status === VULNERABLE) {
        out.vulnerable += 1;
        out[item.severity] += 1;
      }
    }
    return out;
  }
}

/** Boots a real server on an ephemeral loopback port. */
export async function startHarness() {
  const app = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;

  return {
    app,
    hub: app.hub,
    port,
    base,
    wsBase: `ws://127.0.0.1:${port}`,
    async close() {
      // Force idle keep-alive sockets shut so the harness always terminates.
      // A6-09 separately reports whether the production close() can do this
      // on its own — the harness working around it must not hide that.
      app.server.closeAllConnections?.();
      await app.close();
    },
  };
}

/**
 * REST client for attacks.
 *
 * A transport-level failure is itself an interesting result (it can mean the
 * server dropped or reset the connection), so it is reported as `status: 0`
 * with the cause rather than thrown — otherwise one hostile request would
 * abort the whole suite and hide every later finding.
 */
export async function rest(base, method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${base}${path}`, init);
  } catch (error) {
    const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error);
    return { status: 0, text: `<transport error: ${cause}>`, json: undefined, transportError: cause };
  }
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, json };
}

/**
 * Independent truth oracle.
 *
 * Reaches into the in-process engine (which no player-facing code may do) to
 * collect the exact secret values for this run, so leak checks compare public
 * payloads against real truth rather than against a keyword denylist that the
 * implementation could have been written to satisfy.
 */
export function truthOracle(hub, sessionId) {
  const record = hub.get(sessionId);
  if (!record) {
    throw new Error(`no session ${sessionId}`);
  }
  const engine = record.engine;
  const world = engine.worldState;

  const secretKinds = [
    "TrueIncidentOccurred",
    "IncidentChained",
    "IncidentResolved",
    "SystemStateChanged",
    "ObservationCorrupted",
    "ObservationLost",
    "ObservationDelayed",
    "ActionApplied",
    "CommandIssued",
    "CommandAccepted",
    "CommandRejected",
    "ScoreChanged",
    "ScenarioStarted",
    "ScenarioCompleted",
  ];

  /** Numeric district attributes that are pure truth. */
  const districtSecrets = [];
  for (const [districtId, attrs] of Object.entries(world.districts ?? {})) {
    for (const key of ["power", "communications", "water", "hazardLevel", "populationRisk"]) {
      if (typeof attrs?.[key] === "number") {
        districtSecrets.push({ districtId, key, value: attrs[key] });
      }
    }
  }

  /** Observation content before corruption, plus the corruption verdict itself. */
  const corruptionSecrets = [];
  for (const event of engine.eventLog) {
    if (event.kind === "ObservationCorrupted") {
      corruptionSecrets.push({
        observationId: event.payload.observationId,
        original: event.payload.original,
        isFalse: event.payload.false,
        corruptionType: event.payload.corruptionType,
      });
    }
  }

  /** Incidents that exist in truth but have produced no delivered observation. */
  const deliveredIncidentIds = new Set();
  for (const event of engine.eventLog) {
    if (event.kind === "ObservationDelivered") {
      const created = engine.eventLog.find(
        (candidate) =>
          candidate.kind === "ObservationCreated" &&
          candidate.payload.observationId === event.payload.observationId,
      );
      if (created) {
        deliveredIncidentIds.add(created.payload.incidentId);
      }
    }
  }
  const undisclosedIncidentIds = Object.keys(world.internal?.incidents ?? {}).filter(
    (id) => !deliveredIncidentIds.has(id),
  );

  return {
    sessionId,
    engine,
    secretKinds,
    districtSecrets,
    corruptionSecrets,
    undisclosedIncidentIds,
    prngState: engine.snapshot().prngState,
    idempotencyKeys: engine.snapshot().idempotencyKeys,
    truthEventCount: engine.eventLog.length,
    truthLogHash: engine.eventLogHash,
  };
}

/**
 * Scans one public payload against the oracle. Returns an array of leak
 * descriptions (empty when clean).
 */
export function scanForTruth(oracle, label, payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (!text) {
    return [];
  }
  const leaks = [];

  for (const kind of oracle.secretKinds) {
    if (text.includes(`"${kind}"`)) {
      leaks.push(`${label}: truth event kind ${kind}`);
    }
  }
  if (text.includes('"stream":"truth"')) {
    leaks.push(`${label}: truth stream marker`);
  }
  for (const key of ["prngState", "idempotencyKeys", "corruptionType", "internallyFalse", "hazardLevel", "populationRisk"]) {
    if (text.includes(`"${key}"`)) {
      leaks.push(`${label}: internal field ${key}`);
    }
  }
  for (const secret of oracle.corruptionSecrets) {
    if (typeof secret.original === "string" && secret.original.length > 12 && text.includes(secret.original)) {
      leaks.push(`${label}: pre-corruption observation text for ${secret.observationId}`);
    }
  }
  for (const incidentId of oracle.undisclosedIncidentIds) {
    if (text.includes(`"${incidentId}"`)) {
      leaks.push(`${label}: undisclosed incident id ${incidentId}`);
    }
  }
  return leaks;
}

/** Minimal promise-based WS client over the `ws` package the server itself uses. */
export async function openWs(wsBase, sessionId) {
  const WebSocket = loadWs();
  const socket = new WebSocket(`${wsBase}/ws/${encodeURIComponent(sessionId)}`);
  const inbox = [];
  const waiters = [];

  socket.on("message", (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      parsed = { type: "__unparseable", raw: raw.toString("utf8") };
    }
    const waiter = waiters.shift();
    if (waiter) {
      waiter(parsed);
    } else {
      inbox.push(parsed);
    }
  });

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return {
    socket,
    send(payload) {
      socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    },
    next(timeoutMs = 3000) {
      if (inbox.length > 0) {
        return Promise.resolve(inbox.shift());
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws receive timeout")), timeoutMs);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        socket.once("close", resolve);
        socket.close();
      });
    },
  };
}

/** Creates a session and advances it to `tick` through the public REST surface. */
export async function publicSession(base, { scenarioId = "black-river", seed = 49314, sessionId, ticks = 0 } = {}) {
  const created = await rest(base, "POST", "/sessions", {
    scenarioId,
    seed,
    ...(sessionId ? { sessionId } : {}),
  });
  if (created.status !== 200) {
    throw new Error(`session create failed: ${created.status} ${created.text}`);
  }
  const id = created.json.result.sessionId;
  let remaining = ticks;
  while (remaining > 0) {
    const step = Math.min(540, remaining);
    const advanced = await rest(base, "POST", `/sessions/${id}/advance`, { ticks: step });
    if (advanced.status !== 200) {
      throw new Error(`advance failed: ${advanced.status} ${advanced.text}`);
    }
    remaining -= step;
    if (advanced.json.result.completed) {
      break;
    }
  }
  return id;
}

/** Runs a session all the way to `completed` through the public surface. */
export async function completedSession(base, options = {}) {
  const id = await publicSession(base, options);
  for (let guard = 0; guard < 40; guard += 1) {
    const advanced = await rest(base, "POST", `/sessions/${id}/advance`, { ticks: 540 });
    if (advanced.status !== 200) {
      throw new Error(`advance failed: ${advanced.status} ${advanced.text}`);
    }
    if (advanced.json.result.completed) {
      return id;
    }
    if (advanced.json.result.advanced === 0) {
      break;
    }
  }
  throw new Error(`session ${id} did not complete`);
}
