import type { OwnTeamState, PublicResources } from "@null-city/contracts";
import { districtLabel, TEAM_TYPE_LABELS } from "../topology/registry";
import "./TeamsPanel.css";

export interface TeamsPanelProps {
  teams: readonly OwnTeamState[];
  resources: PublicResources;
}

export function TeamsPanel({ teams, resources }: TeamsPanelProps) {
  return (
    <div className="teams-panel">
      <div className="teams-resources">
        <div className="resource-chip">
          <span className="resource-value">{resources.backupGenerators}</span>
          <span className="resource-label">Backup generators</span>
        </div>
        <div className="resource-chip">
          <span className="resource-value">{resources.advisoryUses}</span>
          <span className="resource-label">Advisory uses</span>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="panel-empty">No team telemetry yet.</div>
      ) : (
        <ul className="teams-list">
          {teams.map((team) => (
            <li key={team.teamId} className="team-row">
              <span className={`nc-tag team-status-${team.status}`}>{team.status}</span>
              <span className="team-id">{team.teamId}</span>
              <span className="team-type">{TEAM_TYPE_LABELS[team.type] ?? team.type}</span>
              <span className="team-location">
                @ {districtLabel(team.location)}
                {team.orderTarget && team.orderTarget !== team.location ? ` → ${districtLabel(team.orderTarget)}` : ""}
              </span>
              {team.etaTick !== null && <span className="team-eta">ETA T{team.etaTick}</span>}
              {team.orderTask && <span className="team-task">{team.orderTask}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
