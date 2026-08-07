import type { CommandName } from "@null-city/contracts";
import type { PlayerSession } from "../src/index.js";

/**
 * Translates engine-oriented golden-script verification params into the public
 * `{ teamId, claimId }` / `INSPECT_DISTRICT` contract (M10 P0-01).
 */
export async function toPublicCommand(
  session: PlayerSession,
  commandName: CommandName,
  params: Record<string, unknown>,
): Promise<{ commandName: CommandName; params: Record<string, unknown> }> {
  if (commandName !== "REQUEST_VERIFICATION") {
    return { commandName, params };
  }
  if (typeof params["claimId"] === "string" && params["claimId"].length > 0) {
    const { target: _ignored, ...rest } = params;
    void _ignored;
    return { commandName: "REQUEST_VERIFICATION", params: rest };
  }
  const target = typeof params["target"] === "string" ? params["target"] : undefined;
  const teamId = params["teamId"];
  if (!target || typeof teamId !== "string") {
    return { commandName, params };
  }
  const state = await session.getState();
  const claim = state.claims.find((item) => item.districtId === target);
  if (claim) {
    return { commandName: "REQUEST_VERIFICATION", params: { teamId, claimId: claim.id } };
  }
  return { commandName: "INSPECT_DISTRICT", params: { teamId, target } };
}
