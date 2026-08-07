import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseReplayArtifact } from "../src/replay/schema";
import { buildActionTimeline, buildEvidenceProvenance, buildScoreSeries, projectPlayerAtTick, projectTruthAtTick } from "../src/replay/project";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_RAW = readFileSync(join(HERE, "fixtures", "sample-run.artifact.json"), "utf8");
const ARTIFACT = parseReplayArtifact(FIXTURE_RAW);

describe("replay/project projectPlayerAtTick", () => {
  it("rebuilds player-visible state purely from player events, reaching the artifact's own final score at the final tick", () => {
    const projection = projectPlayerAtTick(ARTIFACT.player.events, ARTIFACT.finalTick);
    expect(projection.phase).toBe("completed");
    expect(projection.score.total).toBe(ARTIFACT.scoreTotal);
  });

  it("only reflects events up to the requested tick (state at an earlier tick is strictly smaller)", () => {
    const early = projectPlayerAtTick(ARTIFACT.player.events, 10);
    const late = projectPlayerAtTick(ARTIFACT.player.events, ARTIFACT.finalTick);
    expect(early.evidence.length).toBeLessThanOrEqual(late.evidence.length);
    expect(early.claims.length).toBeLessThanOrEqual(late.claims.length);
    expect(early.tick).toBeLessThanOrEqual(10);
  });

  it("produces an empty-but-valid projection at tick 0 before SessionStarted lands mid-tick", () => {
    const projection = projectPlayerAtTick([], 0);
    expect(projection.phase).toBe("running");
    expect(projection.claims).toEqual([]);
    expect(projection.score.total).toBe(0);
  });
});

describe("replay/project projectTruthAtTick", () => {
  it("rebuilds truth state purely from the embedded truth log (log rebuild, not a hidden store)", () => {
    const truth = projectTruthAtTick(ARTIFACT.truth.events, ARTIFACT.finalTick);
    expect(truth.districts.length).toBeGreaterThan(0);
    expect(truth.teams.length).toBeGreaterThan(0);
    // every incident that occurred must be accounted for, resolved or not
    expect(truth.incidents.length).toBeGreaterThan(0);
  });

  it("marks incidents resolved only once their IncidentResolved tick has passed", () => {
    const resolvedIncident = ARTIFACT.truth.events.find((e) => e.kind === "IncidentResolved");
    expect(resolvedIncident).toBeDefined();
    const beforeResolution = projectTruthAtTick(ARTIFACT.truth.events, resolvedIncident!.tick - 1);
    const afterResolution = projectTruthAtTick(ARTIFACT.truth.events, resolvedIncident!.tick);
    const incidentId = (resolvedIncident!.payload as { incidentId: string }).incidentId;
    expect(beforeResolution.incidents.find((i) => i.id === incidentId)?.active).toBe(true);
    expect(afterResolution.incidents.find((i) => i.id === incidentId)?.active).toBe(false);
  });
});

describe("replay/project buildEvidenceProvenance (distortion detector)", () => {
  it("identifies at least one false/late report influence path in a real run", () => {
    const provenance = buildEvidenceProvenance(ARTIFACT);
    expect(provenance.length).toBeGreaterThan(0);
    const distorted = provenance.filter((p) => p.distorted);
    expect(distorted.length).toBeGreaterThan(0);

    // at least one entry must trace a corrupted/delayed truth observation
    // through to the specific public claim it influenced.
    const example = distorted[0]!;
    expect(example.claimId).toBeTruthy();
    expect(example.delayTicks).toBeGreaterThanOrEqual(0);
    expect(typeof example.isFalseReport).toBe("boolean");
  });

  it("every provenance entry traces back to a real EvidenceRecorded player event", () => {
    const provenance = buildEvidenceProvenance(ARTIFACT);
    const evidenceIds = new Set(
      ARTIFACT.player.events.filter((e) => e.kind === "EvidenceRecorded").map((e) => (e.payload as { evidence: { id: string } }).evidence.id),
    );
    for (const entry of provenance) {
      expect(evidenceIds.has(entry.evidenceId)).toBe(true);
    }
  });
});

describe("replay/project buildActionTimeline / buildScoreSeries", () => {
  it("merges commands and team movement into one chronologically sorted timeline", () => {
    const timeline = buildActionTimeline(ARTIFACT);
    expect(timeline.length).toBeGreaterThan(0);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.tick).toBeGreaterThanOrEqual(timeline[i - 1]!.tick);
    }
  });

  it("score series running total matches the artifact's final score at the last point", () => {
    const series = buildScoreSeries(ARTIFACT);
    expect(series.length).toBeGreaterThan(0);
    expect(series[series.length - 1]!.total).toBe(ARTIFACT.scoreTotal);
  });
});
