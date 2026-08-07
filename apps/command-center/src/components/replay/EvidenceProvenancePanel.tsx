import type { EvidenceProvenanceEntry } from "../../replay/project";
import type { ReplayAssessmentTraceEntry } from "../../replay/schema";
import "./ReplayPanels.css";

export interface EvidenceProvenancePanelProps {
  entries: EvidenceProvenanceEntry[];
  assessments: ReplayAssessmentTraceEntry[];
  onJumpToTick: (tick: number) => void;
}

/**
 * Evidence provenance and the distortion detector: every piece of public
 * evidence, traced back to the truth observation that produced it, with any
 * corruption or delay applied on the way flagged explicitly. This is what
 * lets a commander point at a specific false or late report after the run.
 */
export function EvidenceProvenancePanel({ entries, assessments, onJumpToTick }: EvidenceProvenancePanelProps) {
  const distorted = entries.filter((e) => e.distorted);

  return (
    <section className="nc-panel replay-subpanel" aria-label="Evidence provenance and distortion detector">
      <div className="nc-panel-title">
        Evidence provenance <span className="nc-tag nc-tag-amber">post-run reveal</span>
      </div>
      <div className="replay-subpanel-body">
        <p className="replay-truth-notice">
          {distorted.length > 0
            ? `${distorted.length} of ${entries.length} evidence item(s) were corrupted, exaggerated, or delayed before reaching the commander.`
            : "No corrupted or delayed observations were recorded for this run."}
        </p>

        <table className="replay-table">
          <thead>
            <tr>
              <th>Evidence</th>
              <th>Claim</th>
              <th>Observed → delivered</th>
              <th>Distortion</th>
              <th>Reported vs. truth</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.evidenceId} className={entry.distorted ? "replay-distortion-row" : undefined}>
                <td className="replay-mono">{entry.evidenceId}</td>
                <td className="replay-mono">{entry.claimId}</td>
                <td>
                  T{entry.observedTick} → T{entry.deliveredTick}
                  {entry.delayTicks > 0 && <span className="nc-tag nc-tag-amber"> +{entry.delayTicks}t</span>}
                </td>
                <td>
                  {entry.isFalseReport ? (
                    <span className="nc-tag nc-tag-red">false report</span>
                  ) : entry.corruptionType ? (
                    <span className="nc-tag nc-tag-amber">{entry.corruptionType}</span>
                  ) : entry.delayTicks > 0 ? (
                    <span className="nc-tag nc-tag-amber">delayed</span>
                  ) : (
                    <span className="nc-tag nc-tag-green">clean</span>
                  )}
                </td>
                <td>
                  <div className="replay-content-diff">
                    {entry.originalContent && entry.originalContent !== entry.reportedContent && (
                      <span className="replay-content-diff-original">{entry.originalContent}</span>
                    )}
                    <span className="replay-content-diff-reported">{entry.reportedContent}</span>
                  </div>
                </td>
                <td>
                  <button type="button" className="nc-btn replay-clickable" onClick={() => onJumpToTick(entry.deliveredTick)}>
                    Jump ↦
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="panel-empty">
                  No evidence recorded yet at this tick.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h4 className="replay-subheading">Assessment probabilities over time</h4>
        {assessments.length === 0 ? (
          <p className="panel-empty">No assessments were submitted this run.</p>
        ) : (
          <ul className="replay-list">
            {assessments
              .slice()
              .sort((a, b) => a.submittedTick - b.submittedTick)
              .map((assessment) => (
                <li key={assessment.id} className="replay-list-row">
                  <button type="button" className="nc-btn replay-clickable" onClick={() => onJumpToTick(assessment.submittedTick)}>
                    T{assessment.submittedTick}
                  </button>
                  <span className="replay-mono">{assessment.claimId}</span>
                  <span>p={assessment.probability.toFixed(2)}</span>
                  <span>confidence={assessment.confidence.toFixed(2)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
