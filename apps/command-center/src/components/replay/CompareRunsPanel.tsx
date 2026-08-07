import type { ReplayArtifact } from "../../replay/schema";
import type { ReplayVerifyResult } from "../../replay/verify";
import { ArtifactLoader } from "./ArtifactLoader";
import "./ReplayPanels.css";

export interface CompareRunsPanelProps {
  primary: ReplayArtifact;
  secondary: { artifact: ReplayArtifact; verify: ReplayVerifyResult } | null;
  onLoadSecondary: (artifact: ReplayArtifact, verify: ReplayVerifyResult) => void;
  onClearSecondary: () => void;
}

/** Compares the loaded run against a second, independently loaded and verified artifact. */
export function CompareRunsPanel({ primary, secondary, onLoadSecondary, onClearSecondary }: CompareRunsPanelProps) {
  if (!secondary) {
    return (
      <ArtifactLoader
        title="Compare against another run"
        description="Load a second completed run's artifact (same scenario, different seed or decisions) to compare outcomes side by side."
        onLoaded={onLoadSecondary}
      />
    );
  }

  const { artifact: b, verify } = secondary;
  const sameScenario = b.identity.scenarioDigest === primary.identity.scenarioDigest;

  return (
    <section className="nc-panel replay-subpanel" aria-label="Run comparison">
      <div className="nc-panel-title">
        Comparing against <span className="replay-mono">{b.identity.sessionId}</span>
        <button type="button" className="nc-btn" onClick={onClearSecondary}>
          Clear
        </button>
      </div>
      <div className="replay-subpanel-body">
        <div className="replay-badge-row">
          <span className={`nc-tag ${verify.status === "FAIL" ? "nc-tag-red" : "nc-tag"}`}>
            run B browser verify: {verify.status}
            {verify.status === "PARTIAL" ? " (integrity+semantics)" : ""}
          </span>
          <span className={`nc-tag ${sameScenario ? "nc-tag-green" : "nc-tag-red"}`}>
            same scenario digest: {sameScenario ? "yes" : "no"}
          </span>
        </div>
        {verify.reasons.length > 0 && (
          <p className="artifact-loader-error" role="alert">
            {verify.reasons.join("; ")}
          </p>
        )}
        {!sameScenario && (
          <p className="panel-empty">Runs use different scenario content — comparison below is informational only.</p>
        )}

        <table className="replay-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>A ({primary.identity.sessionId})</th>
              <th>B ({b.identity.sessionId})</th>
              <th>Δ (B − A)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Score</td>
              <td>{primary.scoreTotal.toFixed(2)}</td>
              <td>{b.scoreTotal.toFixed(2)}</td>
              <td>{(b.scoreTotal - primary.scoreTotal).toFixed(2)}</td>
            </tr>
            <tr>
              <td>Final tick</td>
              <td>{primary.finalTick}</td>
              <td>{b.finalTick}</td>
              <td>{b.finalTick - primary.finalTick}</td>
            </tr>
            <tr>
              <td>Handled incidents</td>
              <td>{primary.handledIncidents.length}</td>
              <td>{b.handledIncidents.length}</td>
              <td>{b.handledIncidents.length - primary.handledIncidents.length}</td>
            </tr>
            <tr>
              <td>Commands issued</td>
              <td>{primary.commandTrace.length}</td>
              <td>{b.commandTrace.length}</td>
              <td>{b.commandTrace.length - primary.commandTrace.length}</td>
            </tr>
            <tr>
              <td>Assessments submitted</td>
              <td>{primary.assessmentTrace.length}</td>
              <td>{b.assessmentTrace.length}</td>
              <td>{b.assessmentTrace.length - primary.assessmentTrace.length}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
