import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KnownRouteState, OwnTeamState } from "@null-city/contracts";
import { CommandComposer } from "../src/components/CommandComposer";
import { getTopology } from "../src/topology/registry";

afterEach(() => {
  cleanup();
});

const TOPOLOGY = getTopology("black-river");
const TEAMS: OwnTeamState[] = [
  { teamId: "power-1", type: "power", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
  { teamId: "verify-1", type: "verification", location: "central", status: "idle", etaTick: null, orderTarget: null, orderTask: null },
];
const ROUTES: KnownRouteState[] = [];

describe("CommandComposer", () => {
  it("shows dispatch fields for the default DISPATCH_TEAM command", () => {
    render(<CommandComposer topology={TOPOLOGY} teams={TEAMS} routes={ROUTES} disabled={false} feedback={null} onSubmit={vi.fn()} />);
    expect(screen.getByText("Task")).toBeTruthy();
    expect(screen.getByText("District")).toBeTruthy();
    expect(screen.queryByText("Advisory text")).toBeFalsy();
  });

  it("switches fields when the command changes to ISSUE_PUBLIC_ADVISORY", () => {
    render(<CommandComposer topology={TOPOLOGY} teams={TEAMS} routes={ROUTES} disabled={false} feedback={null} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "ISSUE_PUBLIC_ADVISORY" } });
    expect(screen.getByText("Advisory text")).toBeTruthy();
    expect(screen.getByText("Severity")).toBeTruthy();
    expect(screen.queryByText("Task")).toBeFalsy();
  });

  it("blocks submission and shows a local error when advisory text is empty", async () => {
    const onSubmit = vi.fn();
    render(<CommandComposer topology={TOPOLOGY} teams={TEAMS} routes={ROUTES} disabled={false} feedback={null} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "ISSUE_PUBLIC_ADVISORY" } });
    fireEvent.click(screen.getByRole("button", { name: /Issue command/i }));
    expect(await screen.findByText(/Advisory text cannot be empty/i)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits DISPATCH_TEAM with the selected team, district, and task", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CommandComposer topology={TOPOLOGY} teams={TEAMS} routes={ROUTES} disabled={false} feedback={null} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Issue command/i }));
    expect(onSubmit).toHaveBeenCalledWith("DISPATCH_TEAM", { teamId: "power-1", target: "central", task: "power_repair" });
  });

  it("disables the submit button while disabled=true", () => {
    render(<CommandComposer topology={TOPOLOGY} teams={TEAMS} routes={ROUTES} disabled={true} feedback={null} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Issue command/i })).toBeDisabled();
  });
});
