import type { Policy } from "../policy.js";
import { createNoopPolicy } from "./noop.js";
import { createReactiveGreedyPolicy } from "./reactiveGreedy.js";
import { createVerificationFirstPolicy } from "./verificationFirst.js";

export { createNoopPolicy } from "./noop.js";
export { createReactiveGreedyPolicy } from "./reactiveGreedy.js";
export { createVerificationFirstPolicy } from "./verificationFirst.js";

export const BASELINE_POLICY_IDS = ["noop", "reactive-greedy", "verification-first"] as const;
export type BaselinePolicyId = (typeof BASELINE_POLICY_IDS)[number];

export function createBaselinePolicy(id: BaselinePolicyId): Policy {
  switch (id) {
    case "noop":
      return createNoopPolicy();
    case "reactive-greedy":
      return createReactiveGreedyPolicy();
    case "verification-first":
      return createVerificationFirstPolicy();
    default: {
      const exhaustive: never = id;
      throw new Error(`unknown baseline policy ${String(exhaustive)}`);
    }
  }
}
