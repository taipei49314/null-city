import { useState } from "react";
import type { Claim, CommandName, KnownRouteState, OwnTeamState } from "@null-city/contracts";
import type { ScenarioTopology } from "../topology/registry";
import type { CommandFeedback } from "../state/sessionReducer";
import "./CommandComposer.css";

export interface CommandComposerProps {
  topology: ScenarioTopology;
  teams: readonly OwnTeamState[];
  routes: readonly KnownRouteState[];
  claims?: readonly Claim[];
  disabled: boolean;
  feedback: CommandFeedback | null;
  onSubmit: (commandName: CommandName, params: Record<string, unknown>) => Promise<void>;
}

const COMPOSER_COMMANDS: { value: CommandName; label: string }[] = [
  { value: "DISPATCH_TEAM", label: "Dispatch team" },
  { value: "ACTIVATE_BACKUP_GENERATOR", label: "Activate backup generator" },
  { value: "PRIORITIZE_COMMUNICATION", label: "Prioritize communication" },
  { value: "CLOSE_ROUTE", label: "Close route" },
  { value: "REOPEN_ROUTE", label: "Reopen route" },
  { value: "REQUEST_VERIFICATION", label: "Request verification" },
  { value: "ISSUE_PUBLIC_ADVISORY", label: "Issue public advisory" },
];

const TASKS = [
  { value: "power_repair", label: "Power repair (power team)" },
  { value: "comms_repair", label: "Communications repair (comms team)" },
  { value: "hazard_control", label: "Hazard control (fire team)" },
  { value: "medical_support", label: "Medical support (medical team)" },
  { value: "water_restore", label: "Water restore (power/fire team)" },
  { value: "verify", label: "Verify (verification team)" },
];

export function CommandComposer({
  topology,
  teams,
  routes,
  claims = [],
  disabled,
  feedback,
  onSubmit,
}: CommandComposerProps) {
  const [commandName, setCommandName] = useState<CommandName>("DISPATCH_TEAM");
  const [teamId, setTeamId] = useState(teams[0]?.teamId ?? "");
  const [target, setTarget] = useState(topology.districts[0]!.id);
  const [claimId, setClaimId] = useState(claims[0]?.id ?? "");
  const [task, setTask] = useState(TASKS[0]!.value);
  const [route, setRoute] = useState(topology.routes[0]!.id);
  const [ticks, setTicks] = useState("30");
  const [advisoryText, setAdvisoryText] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "evacuation">("info");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLocalError(null);

    let params: Record<string, unknown>;
    switch (commandName) {
      case "DISPATCH_TEAM":
        if (!teamId) {
          setLocalError("Select a team to dispatch.");
          return;
        }
        params = { teamId, target, task };
        break;
      case "ACTIVATE_BACKUP_GENERATOR":
        params = { district: target };
        break;
      case "PRIORITIZE_COMMUNICATION": {
        const parsedTicks = Number(ticks);
        if (!Number.isFinite(parsedTicks) || parsedTicks <= 0) {
          setLocalError("Ticks must be a positive number.");
          return;
        }
        params = { district: target, ticks: Math.trunc(parsedTicks) };
        break;
      }
      case "CLOSE_ROUTE":
      case "REOPEN_ROUTE":
        params = { route };
        break;
      case "REQUEST_VERIFICATION":
        if (!teamId) {
          setLocalError("Select a verification team.");
          return;
        }
        if (!claimId) {
          setLocalError("Select a claim to verify.");
          return;
        }
        params = { claimId, teamId };
        break;
      case "ISSUE_PUBLIC_ADVISORY":
        if (advisoryText.trim().length === 0) {
          setLocalError("Advisory text cannot be empty.");
          return;
        }
        params = { district: target, text: advisoryText.trim(), severity };
        break;
      default:
        setLocalError(`Unsupported command ${commandName}`);
        return;
    }

    setSubmitting(true);
    try {
      await onSubmit(commandName, params);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="command-composer" onSubmit={handleSubmit} aria-label="Command composer">
      <label className="composer-field">
        Command
        <select
          className="nc-select"
          value={commandName}
          onChange={(event) => setCommandName(event.target.value as CommandName)}
        >
          {COMPOSER_COMMANDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {(commandName === "DISPATCH_TEAM" || commandName === "REQUEST_VERIFICATION") && (
        <label className="composer-field">
          Team
          <select className="nc-select" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">Select a team</option>
            {(commandName === "REQUEST_VERIFICATION" ? teams.filter((t) => t.type === "verification") : teams).map(
              (team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.teamId} ({team.type}, {team.status})
                </option>
              ),
            )}
          </select>
        </label>
      )}

      {commandName === "DISPATCH_TEAM" && (
        <label className="composer-field">
          Task
          <select className="nc-select" value={task} onChange={(event) => setTask(event.target.value)}>
            {TASKS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {commandName === "REQUEST_VERIFICATION" && (
        <label className="composer-field">
          Claim
          <select className="nc-select" value={claimId} onChange={(event) => setClaimId(event.target.value)}>
            <option value="">Select a claim</option>
            {claims.map((claim) => (
              <option key={claim.id} value={claim.id}>
                {claim.id}
                {claim.districtId ? ` @ ${claim.districtId}` : ""} ({claim.status})
              </option>
            ))}
          </select>
        </label>
      )}

      {(commandName === "DISPATCH_TEAM" ||
        commandName === "ACTIVATE_BACKUP_GENERATOR" ||
        commandName === "PRIORITIZE_COMMUNICATION" ||
        commandName === "ISSUE_PUBLIC_ADVISORY") && (
        <label className="composer-field">
          District
          <select className="nc-select" value={target} onChange={(event) => setTarget(event.target.value)}>
            {topology.districts.map((district) => (
              <option key={district.id} value={district.id}>
                {district.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {commandName === "PRIORITIZE_COMMUNICATION" && (
        <label className="composer-field">
          Ticks
          <input className="nc-input" value={ticks} onChange={(event) => setTicks(event.target.value)} inputMode="numeric" />
        </label>
      )}

      {(commandName === "CLOSE_ROUTE" || commandName === "REOPEN_ROUTE") && (
        <label className="composer-field">
          Route
          <select className="nc-select" value={route} onChange={(event) => setRoute(event.target.value)}>
            {topology.routes.map((r) => {
              const known = routes.find((known) => known.id === r.id);
              return (
                <option key={r.id} value={r.id}>
                  {r.id} {known ? (known.closed ? "(closed)" : "(open)") : ""}
                </option>
              );
            })}
          </select>
        </label>
      )}

      {commandName === "ISSUE_PUBLIC_ADVISORY" && (
        <>
          <label className="composer-field composer-field-wide">
            Advisory text
            <textarea
              className="nc-textarea"
              value={advisoryText}
              onChange={(event) => setAdvisoryText(event.target.value)}
              rows={2}
            />
          </label>
          <label className="composer-field">
            Severity
            <select className="nc-select" value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="evacuation">Evacuation</option>
            </select>
          </label>
        </>
      )}

      <button type="submit" className="nc-btn nc-btn-primary composer-submit" disabled={disabled || submitting}>
        {submitting ? "Issuing…" : "Issue command"}
      </button>

      {localError && (
        <p className="composer-feedback composer-feedback-error" role="alert">
          {localError}
        </p>
      )}
      {!localError && feedback && (
        <p
          className={`composer-feedback ${feedback.ok ? "composer-feedback-ok" : "composer-feedback-error"}`}
          role="status"
          key={feedback.key}
        >
          [{feedback.commandName}] {feedback.message}
        </p>
      )}
    </form>
  );
}
