import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/session.js";
import { ValidationError } from "../src/errors.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("runtime validation — the SDK never hands an unvalidated payload to the caller", () => {
  it("rejects a response envelope that is well-formed JSON but the wrong shape", async () => {
    const fetchImpl = (async () => jsonResponse({ ok: true, result: { totally: "wrong shape" } })) as unknown as typeof fetch;
    await expect(
      createPlayerSession({ baseUrl: "http://example.invalid", scenarioId: "black-river", seed: 1, fetchImpl }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a response body that is not valid JSON", async () => {
    const fetchImpl = (async () => new Response("not json at all", { status: 200 })) as unknown as typeof fetch;
    await expect(
      createPlayerSession({ baseUrl: "http://example.invalid", scenarioId: "black-river", seed: 1, fetchImpl }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a response whose declared content-length exceeds the bound", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ ok: true, result: {} }, { headers: { "content-length": String(64 * 1024 * 1024) } })) as unknown as typeof fetch;
    await expect(
      createPlayerSession({ baseUrl: "http://example.invalid", scenarioId: "black-river", seed: 1, fetchImpl }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a server-reported error envelope with an ApiError carrying the real code", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ ok: false, error: { code: "conflict", message: "session already exists" } })) as unknown as typeof fetch;
    await expect(
      createPlayerSession({ baseUrl: "http://example.invalid", scenarioId: "black-river", seed: 1, fetchImpl }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
