import { afterEach, describe, expect, it, vi } from "vitest";
import { restApi } from "../src/api/rest";
import { ApiError } from "../src/api/types";

/**
 * The client contract for the epistemic boundary: an active session must
 * never hand back the truth bundle. The server enforces this (see
 * `packages/server/src/cli/verify-artifact.ts` test A), and the Command
 * Center's own transport must surface that denial as a distinguishable,
 * actionable error rather than silently returning something the UI could
 * mistake for a real artifact.
 */
describe("restApi.artifactRaw — early truth-bundle denial", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a not_completed ApiError when the server denies an active session's artifact", async () => {
    const body = JSON.stringify({ ok: false, error: { code: "not_completed", message: "session has not completed" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 409 })),
    );

    await expect(restApi.artifactRaw("active-session")).rejects.toMatchObject({ code: "not_completed" });
    await expect(restApi.artifactRaw("active-session")).rejects.toBeInstanceOf(ApiError);
  });

  it("returns the raw envelope text on a genuine 200 so the strict parser can run over it", async () => {
    const body = JSON.stringify({ ok: true, result: { format: "null-city-run-artifact" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    const text = await restApi.artifactRaw("completed-session");
    expect(text).toBe(body);
  });

  it("surfaces a network error distinctly from a not_completed denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    await expect(restApi.artifactRaw("any-session")).rejects.toMatchObject({ code: "network_error" });
  });
});
