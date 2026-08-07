import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { restApi } from "../api/rest";
import { ApiError, type SummaryResult } from "../api/types";
import "./SummaryPanel.css";

export interface SummaryPanelProps {
  sessionId: string;
}

type SummaryLoadState =
  | { kind: "loading" }
  | { kind: "ready"; summary: SummaryResult }
  | { kind: "error"; message: string };

export function SummaryPanel({ sessionId }: SummaryPanelProps) {
  const [state, setState] = useState<SummaryLoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    restApi
      .summary(sessionId)
      .then((summary) => {
        if (!cancelled) {
          setState({ kind: "ready", summary });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof ApiError ? `${error.code}: ${error.message}` : "could not load summary";
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <section className="summary-panel nc-panel" aria-label="Run summary">
      <div className="nc-panel-title">Run complete</div>
      <div className="summary-body">
        {state.kind === "loading" && <p className="panel-empty">Loading final summary…</p>}
        {state.kind === "error" && (
          <p className="summary-error" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && (
          <>
            <div className="summary-grid">
              <SummaryStat label="Final tick" value={state.summary.finalTick} />
              <SummaryStat label="Score" value={state.summary.scoreTotal.toFixed(1)} />
              <SummaryStat label="Claims" value={state.summary.claimCount} />
              <SummaryStat label="Evidence" value={state.summary.evidenceCount} />
              <SummaryStat label="Assessments" value={state.summary.assessmentCount} />
            </div>
            <p className="summary-hash">Player log hash: {state.summary.playerLogHash}</p>
          </>
        )}
        <Link className="nc-btn nc-btn-primary summary-replay-link" to={`/replay/${encodeURIComponent(sessionId)}`}>
          Enter Replay Lab
        </Link>
      </div>
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="summary-stat">
      <span className="summary-stat-value">{value}</span>
      <span className="summary-stat-label">{label}</span>
    </div>
  );
}
