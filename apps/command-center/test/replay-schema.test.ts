import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_ARTIFACT_BYTES, ReplayArtifactParseError, parseReplayArtifact, unwrapArtifactEnvelope } from "../src/replay/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "fixtures", "sample-run.artifact.json");
const FIXTURE_RAW = readFileSync(FIXTURE_PATH, "utf8");

describe("replay/schema parseReplayArtifact", () => {
  it("accepts a genuine, well-formed artifact", () => {
    const artifact = parseReplayArtifact(FIXTURE_RAW);
    expect(artifact.format).toBe("null-city-run-artifact");
    expect(artifact.version).toBe(2);
    expect(artifact.truth.events.length).toBe(artifact.eventCount);
    expect(artifact.player.events.length).toBe(artifact.playerEventCount);
    expect(artifact.commandTrace.length).toBeGreaterThan(0);
  });

  it("rejects input that is not a string", () => {
    // @ts-expect-error deliberately passing the wrong type at the runtime boundary
    expect(() => parseReplayArtifact(123)).toThrow(ReplayArtifactParseError);
  });

  it("rejects malformed JSON safely", () => {
    expect(() => parseReplayArtifact("{not json")).toThrow(ReplayArtifactParseError);
  });

  it("rejects a JSON value that is not an object", () => {
    expect(() => parseReplayArtifact(JSON.stringify([1, 2, 3]))).toThrow(ReplayArtifactParseError);
    expect(() => parseReplayArtifact(JSON.stringify("just a string"))).toThrow(ReplayArtifactParseError);
  });

  it("rejects an unknown format or unsupported version", () => {
    expect(() => parseReplayArtifact(JSON.stringify({ format: "something-else", version: 1 }))).toThrow(/unknown artifact format/);
    expect(() =>
      parseReplayArtifact(JSON.stringify({ format: "null-city-run-artifact", version: 999 })),
    ).toThrow(/unsupported artifact version/);
  });

  it("rejects a well-formatted object missing required fields", () => {
    expect(() => parseReplayArtifact(JSON.stringify({ format: "null-city-run-artifact", version: 2 }))).toThrow(
      ReplayArtifactParseError,
    );
  });

  it("rejects oversized input before it is fully parsed, using a bounded limit", () => {
    const small = JSON.stringify({ format: "null-city-run-artifact", version: 2, pad: "x".repeat(2000) });
    expect(() => parseReplayArtifact(small, 100)).toThrow(/maximum accepted size/);
  });

  it("enforces the default 64MB bound by construction", () => {
    expect(MAX_ARTIFACT_BYTES).toBe(64 * 1024 * 1024);
  });

  it("rejects a truth event with a non-object payload", () => {
    const parsed = JSON.parse(FIXTURE_RAW);
    parsed.truth.events[0].payload = "not-an-object";
    expect(() => parseReplayArtifact(JSON.stringify(parsed))).toThrow(/payload must be an object/);
  });

  it("rejects a player event whose stream is not \"player\"", () => {
    const parsed = JSON.parse(FIXTURE_RAW);
    parsed.player.events[0].stream = "truth";
    expect(() => parseReplayArtifact(JSON.stringify(parsed))).toThrow(/stream must be "player"/);
  });
});

describe("replay/schema unwrapArtifactEnvelope", () => {
  it("unwraps a valid REST envelope into bare artifact JSON", () => {
    const envelope = JSON.stringify({ ok: true, result: JSON.parse(FIXTURE_RAW) });
    const unwrapped = unwrapArtifactEnvelope(envelope);
    const artifact = parseReplayArtifact(unwrapped);
    expect(artifact.identity.sessionId).toBe(JSON.parse(FIXTURE_RAW).identity.sessionId);
  });

  it("rejects an envelope with ok: false", () => {
    expect(() => unwrapArtifactEnvelope(JSON.stringify({ ok: false, error: { code: "not_completed", message: "no" } }))).toThrow(
      ReplayArtifactParseError,
    );
  });

  it("rejects malformed envelope JSON", () => {
    expect(() => unwrapArtifactEnvelope("{broken")).toThrow(ReplayArtifactParseError);
  });

  it("rejects an oversized server response before parsing", () => {
    const oversized = JSON.stringify({ ok: true, result: { pad: "x".repeat(5000) } });
    expect(() => unwrapArtifactEnvelope(oversized, 100)).toThrow(/maximum accepted size/);
  });
});
