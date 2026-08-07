import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { OwnTeamState, PublicResources } from "@null-city/contracts";
import { TeamsPanel } from "../src/components/TeamsPanel";

afterEach(() => {
  cleanup();
});

const RESOURCES: PublicResources = { backupGenerators: 2, advisoryUses: 1 };

describe("TeamsPanel", () => {
  it("renders an empty state when no team telemetry has arrived yet", () => {
    render(<TeamsPanel teams={[]} resources={RESOURCES} />);
    expect(screen.getByText(/No team telemetry yet/i)).toBeTruthy();
  });

  it("renders resource counts and each known team with its status and location", () => {
    const teams: OwnTeamState[] = [
      { teamId: "power-1", type: "power", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
      {
        teamId: "fire-2",
        type: "fire",
        location: "north",
        status: "transit",
        etaTick: 42,
        orderTarget: "riverside",
        orderTask: "hazard_control",
      },
    ];
    render(<TeamsPanel teams={teams} resources={RESOURCES} />);

    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("power-1")).toBeTruthy();
    expect(screen.getByText("fire-2")).toBeTruthy();
    expect(screen.getByText("idle")).toBeTruthy();
    expect(screen.getByText("transit")).toBeTruthy();
    expect(screen.getByText("ETA T42")).toBeTruthy();
    expect(screen.getByText("hazard_control")).toBeTruthy();
  });
});
