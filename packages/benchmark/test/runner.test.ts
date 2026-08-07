import { describe, expect, it } from "vitest";

import { createReactiveGreedyPolicy, createVerificationFirstPolicy, createNoopPolicy } from "../src/policies/index.js";
import { runOne } from "../src/runner.js";

describe("runOne — end-to-end integration", () => {
  it("completes a full run, verifies the player log, and produces sane bounded metrics", async () => {
    const record = await runOne({
      scenarioId: "black-river",
      seed: 49314,
      policy: createReactiveGreedyPolicy(),
      tickStep: 10,
    });

    expect(record.playerLogVerified).toBe(true);
    expect(record.phase).toBe("completed");
    expect(Number.isFinite(record.metrics.scoreTotal)).toBe(true);
    expect(record.metrics.invalidCommandRate).toBeGreaterThanOrEqual(0);
    expect(record.metrics.invalidCommandRate).toBeLessThanOrEqual(1);
    expect(record.errors.filter((e) => e.phase === "advance")).toHaveLength(0);
  }, 30_000);

  it("is deterministic: the same scenario/seed/policy produces the same score and event count twice", async () => {
    const a = await runOne({ scenarioId: "black-river", seed: 100, policy: createReactiveGreedyPolicy(), tickStep: 10 });
    const b = await runOne({ scenarioId: "black-river", seed: 100, policy: createReactiveGreedyPolicy(), tickStep: 10 });
    expect(a.metrics.scoreTotal).toBe(b.metrics.scoreTotal);
    expect(a.playerEventCount).toBe(b.playerEventCount);
    expect(a.finalTick).toBe(b.finalTick);
  }, 30_000);

  it("the noop policy never issues a command and scores no better than an active policy", async () => {
    const noop = await runOne({ scenarioId: "black-river", seed: 49314, policy: createNoopPolicy(), tickStep: 10 });
    expect(noop.commands).toHaveLength(0);
    expect(noop.assessments).toHaveLength(0);
    expect(noop.playerLogVerified).toBe(true);

    const active = await runOne({ scenarioId: "black-river", seed: 49314, policy: createVerificationFirstPolicy(), tickStep: 10 });
    expect(active.metrics.scoreTotal).toBeGreaterThanOrEqual(noop.metrics.scoreTotal);
  }, 30_000);

  it("a policy that always throws is recorded as a decide error but the run still completes", async () => {
    const throwingPolicy = {
      id: "throwing",
      async reset(): Promise<void> {},
      async decide(): Promise<never> {
        throw new Error("boom");
      },
    };
    const record = await runOne({ scenarioId: "black-river", seed: 49314, policy: throwingPolicy, tickStep: 20 });
    expect(record.phase).toBe("completed");
    expect(record.errors.length).toBeGreaterThan(0);
    expect(record.errors.every((e) => e.phase === "decide")).toBe(true);
  }, 30_000);

  it("a policy that returns too many commands has its output bounded and truncation recorded", async () => {
    const spammyPolicy = {
      id: "spammy",
      async reset(): Promise<void> {},
      async decide() {
        return {
          commands: Array.from({ length: 50 }, () => ({
            commandName: "DISPATCH_TEAM" as const,
            params: { teamId: "power-1", target: "industrial", task: "power_repair" },
          })),
          assessments: [],
        };
      },
    };
    const record = await runOne({ scenarioId: "black-river", seed: 49314, policy: spammyPolicy, tickStep: 540 });
    expect(record.boundedOutputTruncations).toBeGreaterThan(0);
    expect(record.commands.length).toBeLessThanOrEqual(10);
  }, 30_000);

  it("a policy that times out on every decide() still lets the run complete via advance", async () => {
    const slowPolicy = {
      id: "slow",
      async reset(): Promise<void> {},
      async decide() {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { commands: [], assessments: [] };
      },
    };
    const record = await runOne({
      scenarioId: "black-river",
      seed: 49314,
      policy: slowPolicy,
      tickStep: 540,
      decisionTimeoutMs: 10,
    });
    expect(record.decisionTimeouts).toBeGreaterThan(0);
    expect(record.phase).toBe("completed");
  }, 30_000);
});
