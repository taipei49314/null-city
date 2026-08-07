import { describe, expect, it } from "vitest";

import { SessionHub } from "../src/hub.js";
import { handleRpc } from "../src/rpc.js";

function hub(): SessionHub {
  return new SessionHub(() => {
    throw new Error("unexpected scenario load");
  });
}

describe("rpc dispatch", () => {
  it("rejects unknown operations", () => {
    const result = handleRpc(hub(), { op: "nope", params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_op");
    }
  });

  it("rejects create requests without a scenarioId", () => {
    const result = handleRpc(hub(), { op: "session.create", params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("rejects malformed parameters", () => {
    const result = handleRpc(hub(), { op: "session.advance", params: { sessionId: "x", ticks: "lots" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("lists sessions and reports a missing session as not_found", () => {
    const h = hub();
    const list = handleRpc(h, { op: "session.list", params: {} });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.result).toEqual({ sessions: [] });
    }
    const missing = handleRpc(h, { op: "session.state", params: { sessionId: "ghost" } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("not_found");
    }
  });
});