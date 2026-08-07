import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";
import { verifyEventStream } from "@null-city/contracts/truth";
import {
  ENGINE_PROTOCOL_VERSION,
  type EngineSnapshotData,
} from "./engine.js";

const SNAPSHOT_FORMAT = "null-city-snapshot";

export interface SnapshotFile {
  format: string;
  version: number;
  savedAtEpochMs: number;
  data: EngineSnapshotData;
}

/**
 * Serializes a snapshot. The snapshot contains the full engine state:
 * world, prng state, event log, observation buffers and counters.
 */
export function serializeSnapshot(data: EngineSnapshotData): string {
  const file: SnapshotFile = {
    format: SNAPSHOT_FORMAT,
    version: ENGINE_PROTOCOL_VERSION,
    // Wall-clock stamp is metadata only and is never fed into the engine.
    savedAtEpochMs: 0,
    data,
  };
  return JSON.stringify(file);
}

export function parseSnapshot(json: string): EngineSnapshotData {
  let file: SnapshotFile;
  try {
    file = JSON.parse(json) as SnapshotFile;
  } catch {
    throw new Error("snapshot is not valid JSON");
  }
  if (file === null || typeof file !== "object" || Array.isArray(file)) {
    throw new Error("snapshot root must be an object");
  }
  if (file.format !== SNAPSHOT_FORMAT) {
    throw new Error(`snapshot has unknown format ${file.format}`);
  }
  if (file.version !== ENGINE_PROTOCOL_VERSION || typeof file.data?.sessionId !== "string") {
    throw new Error("snapshot version or structure is not supported");
  }
  if (
    file.data.protocolVersion !== ENGINE_PROTOCOL_VERSION ||
    file.data.version !== ENGINE_PROTOCOL_VERSION
  ) {
    throw new Error("snapshot protocol version is not supported");
  }
  if (typeof file.data.scenarioDigest !== "string" || file.data.scenarioDigest.length === 0) {
    throw new Error("snapshot missing scenarioDigest");
  }
  if (typeof file.data.chainedCount !== "number") {
    throw new Error("snapshot missing chainedCount");
  }
  return file.data;
}

/** integrity check on a parsed snapshot: event hash chain + tick consistency */
export function validateSnapshot(data: EngineSnapshotData): void {
  const chain = verifyEventStream(data.events, {
    expectedSessionId: data.sessionId,
    requireNonEmpty: data.tick > 0 || data.sequence > 0,
  });
  if (!chain.validChain) {
    throw new Error(
      `snapshot event stream invalid at sequence ${String(chain.brokenAt)} (${chain.reason ?? "unknown"})`,
    );
  }
  if (data.tick !== data.world.tick) {
    throw new Error(`snapshot tick mismatch: header=${data.tick} world=${data.world.tick}`);
  }
  if (data.sequence !== data.events.length) {
    throw new Error(
      `snapshot sequence counter mismatch: header=${data.sequence} events=${data.events.length}`,
    );
  }
}

/**
 * Best-effort atomic replace: write a temp file, then rename over the target.
 *
 * This is NOT a durable fsync barrier. A power loss between write and rename
 * (or before the directory entry is flushed) can still lose the latest save.
 * Crash-safe durability would require explicit fsync of file and parent dir.
 */
export function saveSnapshotAtomically(targetPath: string, data: EngineSnapshotData): void {
  const tmpPath = `${targetPath}.tmp`;
  const json = serializeSnapshot(data);
  writeFileSync(tmpPath, json, { encoding: "utf8" });
  renameSync(tmpPath, targetPath);
}

export function loadSnapshotFromFile(path: string): EngineSnapshotData {
  if (!existsSync(path)) {
    throw new Error(`snapshot file does not exist: ${path}`);
  }
  const json = readFileSync(path, { encoding: "utf8" });
  const data = parseSnapshot(json);
  validateSnapshot(data);
  return data;
}
