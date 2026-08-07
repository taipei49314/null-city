import { emptyDecision, type Policy, type PolicyContext, type PolicyDecision, type PolicyInput } from "../policy.js";

/**
 * The neglect/failure baseline: never issues a command or an assessment.
 * Every other policy's score should exceed this one on every scenario
 * where doing nothing is not the correct decision.
 */
export function createNoopPolicy(): Policy {
  return {
    id: "noop",
    async reset(context: PolicyContext): Promise<void> {
      void context; // stateless
    },
    async decide(input: PolicyInput): Promise<PolicyDecision> {
      void input; // stateless: acts on no information whatsoever
      return emptyDecision;
    },
  };
}
