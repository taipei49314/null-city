import { writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  canonicalJson,
  sha256,
  verifyEventStream,
  type EventEnvelope,
} from "@null-city/contracts/truth";
import type { RunResult } from "./engine.js";

export const RECEIPT_FORMAT = "null-city-run-receipt";
export const RECEIPT_VERSION = 1 as const;

export interface RunReceipt {
  format: typeof RECEIPT_FORMAT;
  version: typeof RECEIPT_VERSION;
  sessionId: string;
  scenarioId: string;
  seed: number;
  finalTick: number;
  eventCount: number;
  eventLogHash: string;
  playerLogHash: string;
  truthLogHash: string;
  stateDigest: string;
  scoreDigest: string;
  scoreTotal: number;
  handledIncidents: string[];
  activeIncidents: string[];
  events: EventEnvelope[];
  receiptHash: string;
}

export interface BuildReceiptInput {
  result: RunResult;
  events: readonly EventEnvelope[];
  playerEvents: readonly EventEnvelope[];
}

function scoreDigest(score: RunResult["score"]): string {
  return sha256(canonicalJson(score));
}

function omitReceiptHash(receipt: Omit<RunReceipt, "receiptHash">): string {
  return sha256(canonicalJson(receipt));
}

export function buildRunReceipt(input: BuildReceiptInput): RunReceipt {
  const { result, events, playerEvents } = input;
  const truth = verifyEventStream([...events], {
    expectedSessionId: result.sessionId,
    requireNonEmpty: true,
  });
  if (!truth.validChain) {
    throw new Error(`cannot build receipt: truth stream invalid (${truth.reason ?? "unknown"})`);
  }
  // Player log is a filtered projection of the truth stream; sequences are not contiguous.
  // Integrity is the digest of the selected envelopes (each must exist in the truth log).
  const truthBySeq = new Map(events.map((event) => [event.sequence, event]));
  for (const event of playerEvents) {
    const source = truthBySeq.get(event.sequence);
    if (!source || source.hash !== event.hash || source.kind !== event.kind) {
      throw new Error(`cannot build receipt: player event seq ${event.sequence} not in truth log`);
    }
  }
  const playerLogHash = sha256(canonicalJson(playerEvents.map((event) => event.hash)));

  const body: Omit<RunReceipt, "receiptHash"> = {
    format: RECEIPT_FORMAT,
    version: RECEIPT_VERSION,
    sessionId: result.sessionId,
    scenarioId: result.scenarioId,
    seed: result.seed,
    finalTick: result.finalTick,
    eventCount: result.eventCount,
    eventLogHash: result.eventLogHash,
    playerLogHash,
    truthLogHash: truth.hash,
    stateDigest: sha256(result.finalStateDigest),
    scoreDigest: scoreDigest(result.score),
    scoreTotal: result.score.total,
    handledIncidents: [...result.handledIncidents],
    activeIncidents: [...result.activeIncidents],
    events: structuredClone(events) as EventEnvelope[],
  };
  return { ...body, receiptHash: omitReceiptHash(body) };
}

export function serializeReceipt(receipt: RunReceipt): string {
  return canonicalJson(receipt);
}

export function saveReceipt(path: string, receipt: RunReceipt): void {
  writeFileSync(path, serializeReceipt(receipt), { encoding: "utf8" });
}

export function loadReceipt(path: string): RunReceipt {
  if (!existsSync(path)) {
    throw new Error(`receipt file does not exist: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as RunReceipt;
  return parsed;
}

export interface ReceiptVerifyResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Independently verifies a receipt artifact. This checks integrity of the
 * embedded event stream and digests; it does not prove authenticity without
 * an external trusted root or signature.
 */
export function verifyReceipt(receipt: RunReceipt): ReceiptVerifyResult {
  const reasons: string[] = [];
  if (receipt.format !== RECEIPT_FORMAT) {
    reasons.push(`unknown format ${receipt.format}`);
  }
  if (receipt.version !== RECEIPT_VERSION) {
    reasons.push(`unsupported version ${String(receipt.version)}`);
  }

  const { receiptHash, ...body } = receipt;
  const expectedHash = omitReceiptHash(body);
  if (receiptHash !== expectedHash) {
    reasons.push("receiptHash mismatch");
  }

  const stream = verifyEventStream(receipt.events, {
    expectedSessionId: receipt.sessionId,
    expectedTerminalHash: receipt.truthLogHash,
    requireNonEmpty: true,
  });
  if (!stream.validChain) {
    reasons.push(`event stream invalid: ${stream.reason ?? "unknown"}`);
  }
  if (receipt.eventCount !== receipt.events.length) {
    reasons.push("eventCount mismatch");
  }
  if (receipt.eventLogHash !== receipt.truthLogHash) {
    reasons.push("eventLogHash/truthLogHash mismatch");
  }
  if (stream.hash && stream.hash !== receipt.eventLogHash) {
    reasons.push("eventLogHash does not match stream tip");
  }

  const completed = [...receipt.events].reverse().find((event) => event.kind === "ScenarioCompleted");
  if (!completed) {
    reasons.push("missing ScenarioCompleted terminal event");
  } else if (typeof completed.payload === "object" && completed.payload !== null) {
    const finalScore = (completed.payload as { finalScore?: RunResult["score"] }).finalScore;
    if (!finalScore) {
      reasons.push("ScenarioCompleted missing finalScore");
    } else {
      if (scoreDigest(finalScore) !== receipt.scoreDigest) {
        reasons.push("scoreDigest mismatch vs ScenarioCompleted");
      }
      if (finalScore.total !== receipt.scoreTotal) {
        reasons.push("scoreTotal mismatch vs ScenarioCompleted");
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
