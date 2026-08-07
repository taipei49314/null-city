import { describe, expect, it } from "vitest";
import type { PlayerEventEnvelope, PlayerEventKind } from "@null-city/contracts";

import { computeMetrics } from "../src/metrics.js";

let seq = 0;
function ev(tick: number, kind: PlayerEventKind, payload: unknown): PlayerEventEnvelope {
  seq += 1;
  return {
    stream: "player",
    sessionId: "s1",
    sequence: seq - 1,
    tick,
    kind,
    payload,
    previousHash: "irrelevant-for-metrics",
    hash: "irrelevant-for-metrics",
  };
}

describe("computeMetrics", () => {
  it("sums score-breakdown categories from PublicScoreChanged events", () => {
    seq = 0;
    const events = [
      ev(1, "PublicScoreChanged", { delta: 5, reason: "r", category: "events_handled", total: 5 }),
      ev(2, "PublicScoreChanged", { delta: -2, reason: "r", category: "wasted_dispatch", total: 3 }),
      ev(3, "PublicScoreChanged", { delta: -3, reason: "r", category: "wasted_dispatch", total: 0 }),
    ];
    const metrics = computeMetrics(events);
    expect(metrics.scoreTotal).toBe(0);
    expect(metrics.eventsHandledScoreContribution).toBe(5);
    expect(metrics.wastedDispatchPenalty).toBe(-5);
  });

  it("computes invalid command rate from CommandResult events", () => {
    seq = 0;
    const events = [
      ev(1, "CommandResult", { commandId: "c1", commandName: "DISPATCH_TEAM", idempotencyKey: "k1", state: "accepted", errorCode: null, detail: "ok", etaTick: 10, target: "industrial" }),
      ev(2, "CommandResult", { commandId: "c2", commandName: "DISPATCH_TEAM", idempotencyKey: "k2", state: "rejected", errorCode: "task_incompatible", detail: "no", etaTick: null, target: "industrial" }),
    ];
    const metrics = computeMetrics(events);
    expect(metrics.totalCommandsSubmitted).toBe(2);
    expect(metrics.invalidCommandCount).toBe(1);
    expect(metrics.invalidCommandRate).toBeCloseTo(0.5);
    expect(metrics.commandsByName).toEqual([{ commandName: "DISPATCH_TEAM", accepted: 1, rejected: 1 }]);
  });

  it("computes response latency from claim first-observed tick to first accepted command on its district", () => {
    seq = 0;
    const events = [
      ev(5, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 5, status: "reported" }, reason: "reported" }),
      ev(12, "CommandResult", { commandId: "cmd1", commandName: "DISPATCH_TEAM", idempotencyKey: "k1", state: "accepted", errorCode: null, detail: "ok", etaTick: 20, target: "industrial" }),
    ];
    const metrics = computeMetrics(events);
    expect(metrics.responseLatencies).toHaveLength(1);
    expect(metrics.responseLatencies[0]!.latencyTicks).toBe(7);
    expect(metrics.meanResponseLatencyTicks).toBe(7);
  });

  it("leaves latency null for a claim with no matching accepted command", () => {
    seq = 0;
    const events = [ev(5, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 5, status: "reported" }, reason: "reported" })];
    const metrics = computeMetrics(events);
    expect(metrics.responseLatencies[0]!.latencyTicks).toBeNull();
    expect(metrics.meanResponseLatencyTicks).toBeNull();
  });

  it("computes Brier score and calibration bins from assessments paired with verification outcomes", () => {
    seq = 0;
    const events = [
      ev(1, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 1, status: "reported" }, reason: "reported" }),
      ev(2, "AssessmentSubmitted", { assessment: { id: "a1", claimId: "c1", probability: 0.9, confidence: 0.5, submittedTick: 2 } }),
      ev(5, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 1, status: "verified" }, reason: "verified" }),
    ];
    const metrics = computeMetrics(events);
    expect(metrics.verifiedClaimCount).toBe(1);
    expect(metrics.refutedClaimCount).toBe(0);
    // outcome = 1 (verified), probability 0.9 -> squared error 0.01
    expect(metrics.brierScore).toBeCloseTo(0.01);
    expect(metrics.calibrationBins).toHaveLength(1);
    expect(metrics.calibrationBins[0]!.empiricalFrequency).toBe(1);
  });

  it("returns null Brier score when no claim has a resolved outcome", () => {
    seq = 0;
    const events = [ev(1, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 1, status: "reported" }, reason: "reported" })];
    const metrics = computeMetrics(events);
    expect(metrics.brierScore).toBeNull();
    expect(metrics.calibrationBins).toEqual([]);
  });

  it("computes verification info gain as the error reduction between pre- and post-verification assessments", () => {
    seq = 0;
    const events = [
      ev(1, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 1, status: "reported" }, reason: "reported" }),
      ev(2, "AssessmentSubmitted", { assessment: { id: "a1", claimId: "c1", probability: 0.5, confidence: 0.3, submittedTick: 2 } }),
      ev(10, "VerificationResolved", { claimId: "c1", teamId: "verify-1", outcome: "verified", resolvedTick: 10 }),
      ev(11, "AssessmentSubmitted", { assessment: { id: "a2", claimId: "c1", probability: 0.95, confidence: 0.9, submittedTick: 11 } }),
      ev(12, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 1, status: "verified" }, reason: "verified" }),
    ];
    const metrics = computeMetrics(events);
    // errorBefore = (0.5-1)^2=0.25; errorAfter=(0.95-1)^2=0.0025; gain=0.2475
    expect(metrics.verificationInfoGain).toBeCloseTo(0.2475, 4);
  });

  it("returns null verification info gain with no pre/post assessment pairs", () => {
    seq = 0;
    const events = [ev(1, "ClaimUpdated", { claim: { id: "c1", districtId: "industrial", firstObservedTick: 1, status: "reported" }, reason: "reported" })];
    const metrics = computeMetrics(events);
    expect(metrics.verificationInfoGain).toBeNull();
  });

  it("marks phase completed only after a RunCompleted event", () => {
    seq = 0;
    expect(computeMetrics([ev(1, "PublicScoreChanged", { delta: 0, reason: "r", category: "resource_efficiency", total: 0 })]).phase).toBe(
      "running",
    );
    expect(computeMetrics([ev(1, "RunCompleted", { finalTick: 540, scoreTotal: 10, claimCount: 1, evidenceCount: 1 })]).phase).toBe("completed");
  });
});
