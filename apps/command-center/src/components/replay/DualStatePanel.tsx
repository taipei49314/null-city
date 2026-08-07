import type { PlayerProjection, TruthProjection } from "../../replay/project";
import "./ReplayPanels.css";

export interface DualStatePanelProps {
  player: PlayerProjection;
  truth: TruthProjection;
}

/**
 * Side-by-side player-visible state vs. truth state at the current tick.
 * The truth column is always labelled as a post-run reveal — it only ever
 * renders data pulled from an already-completed, independently verified
 * artifact.
 */
export function DualStatePanel({ player, truth }: DualStatePanelProps) {
  return (
    <div className="dual-state-grid">
      <section className="nc-panel replay-subpanel" aria-label="Player-visible state at tick">
        <div className="nc-panel-title">
          Player-visible state <span className="nc-tag nc-tag-green">as reported</span>
        </div>
        <div className="replay-subpanel-body">
          <div className="replay-stat-row">
            <Stat label="Score" value={player.score.total.toFixed(1)} />
            <Stat label="Phase" value={player.phase} />
            <Stat label="Claims" value={player.claims.length} />
            <Stat label="Evidence" value={player.evidence.length} />
            <Stat label="Assessments" value={player.assessments.length} />
          </div>
          <h4 className="replay-subheading">Teams (as known)</h4>
          <ul className="replay-list">
            {player.teams.map((team) => (
              <li key={team.teamId} className="replay-list-row">
                <span className="replay-mono">{team.teamId}</span>
                <span>{team.status}</span>
                <span>{team.location}</span>
                {team.etaTick !== null && <span className="replay-list-eta">ETA T{team.etaTick}</span>}
              </li>
            ))}
            {player.teams.length === 0 && <li className="panel-empty">No team reports yet.</li>}
          </ul>
          <h4 className="replay-subheading">Known routes</h4>
          <ul className="replay-list replay-list-inline">
            {player.routes.map((route) => (
              <li key={route.id} className={`nc-tag ${route.closed ? "nc-tag-red" : "nc-tag-green"}`}>
                {route.id}
              </li>
            ))}
            {player.routes.length === 0 && <li className="panel-empty">No route reports yet.</li>}
          </ul>
        </div>
      </section>

      <section className="nc-panel replay-subpanel replay-truth-panel" aria-label="Truth state at tick">
        <div className="nc-panel-title">
          Truth state <span className="nc-tag nc-tag-amber">post-run reveal</span>
        </div>
        <div className="replay-subpanel-body">
          <p className="replay-truth-notice">
            Ground truth is only ever unlocked here, after the run is complete. It was never available to the
            commander during the live session.
          </p>
          <h4 className="replay-subheading">Districts</h4>
          <table className="replay-table">
            <thead>
              <tr>
                <th>District</th>
                <th>Power</th>
                <th>Comms</th>
                <th>Water</th>
                <th>Hazard</th>
                <th>Pop. risk</th>
              </tr>
            </thead>
            <tbody>
              {truth.districts.map((d) => (
                <tr key={d.id}>
                  <td className="replay-mono">{d.id}</td>
                  <td>{d.power}</td>
                  <td>{d.communications}</td>
                  <td>{d.water}</td>
                  <td>{d.hazardLevel}</td>
                  <td>{d.populationRisk}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="replay-subheading">Incidents</h4>
          <ul className="replay-list">
            {truth.incidents.map((incident) => (
              <li key={incident.id} className="replay-list-row">
                <span className={`nc-tag ${incident.active ? "nc-tag-red" : "nc-tag-green"}`}>
                  {incident.active ? "active" : "resolved"}
                </span>
                <span className="replay-mono">{incident.id}</span>
                <span>{incident.district}</span>
                <span>severity {incident.severity}</span>
              </li>
            ))}
            {truth.incidents.length === 0 && <li className="panel-empty">No incidents have occurred yet.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="replay-stat">
      <span className="replay-stat-value">{value}</span>
      <span className="replay-stat-label">{label}</span>
    </div>
  );
}
