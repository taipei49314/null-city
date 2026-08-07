import { describe, expect, it } from "vitest";
import { buildDebriefMarkdown } from "../src/replay/debrief";
import type { EvidenceProvenanceEntry } from "../src/replay/project";

const provenance: EvidenceProvenanceEntry[] = [
  {
    evidenceId: "e1",
    claimId: "claim:south",
    sourceId: "south-sensor",
    category: "telemetry",
    reliability: 0.9,
    verified: false,
    observationId: "obs-1",
    incidentId: "mirror_hoax",
    sourceDistrict: "south-mirror",
    observedTick: 12,
    deliveredTick: 18,
    delayTicks: 6,
    distorted: true,
    isFalseReport: true,
    corruptionType: "spoof",
    reportedContent: "South Mirror CRITICAL spill",
    originalContent: "levels within baseline",
  },
];

const stubArtifact = {
  identity: {
    sessionId: "debrief-stub",
    scenarioId: "mirror-district",
    scenarioDigest: "a".repeat(64),
    engineProtocolVersion: 1,
    seed: 49314,
    totalTicks: 420,
  },
  finalTick: 420,
  scoreTotal: 12.5,
  handledIncidents: ["north_spill"],
  activeIncidents: [] as string[],
  commandTrace: [
    {
      issuedTick: 10,
      commandName: "REQUEST_VERIFICATION",
      outcome: "accepted",
      target: "north-mirror",
      errorMessage: null,
    },
  ],
} as Parameters<typeof buildDebriefMarkdown>[0];

describe("buildDebriefMarkdown", () => {
  it("emits Traditional Chinese debrief with false-report callouts", () => {
    const md = buildDebriefMarkdown(stubArtifact, provenance, "zh-TW");
    expect(md).toContain("戰後簡報");
    expect(md).toContain("假報");
    expect(md).toContain("mirror-district");
  });

  it("emits English twin without inventing scores", () => {
    const md = buildDebriefMarkdown({ ...stubArtifact, scoreTotal: 3.14 }, [], "en");
    expect(md).toContain("After-Action Debrief");
    expect(md).toContain("3.14");
    expect(md).not.toContain("戰後簡報");
  });
});
