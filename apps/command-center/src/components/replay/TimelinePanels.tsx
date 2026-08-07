import type { ActionTimelineEntry, ScoreSeriesPoint } from "../../replay/project";
import "./ReplayPanels.css";

export interface ActionTimelinePanelProps {
  entries: ActionTimelineEntry[];
  currentTick: number;
  onJumpToTick: (tick: number) => void;
}

/** Command issuance plus team dispatch/arrival, merged into one chronological timeline. */
export function ActionTimelinePanel({ entries, currentTick, onJumpToTick }: ActionTimelinePanelProps) {
  const visible = entries.filter((e) => e.tick <= currentTick);
  return (
    <section className="nc-panel replay-subpanel" aria-label="Action and team movement timeline">
      <div className="nc-panel-title">Actions &amp; team movement</div>
      <div className="replay-subpanel-body">
        <ul className="replay-list">
          {visible.map((entry, index) => (
            <li key={index} className="replay-list-row">
              <button type="button" className="nc-btn replay-clickable" onClick={() => onJumpToTick(entry.tick)}>
                T{entry.tick}
              </button>
              {entry.kind === "command" && (
                <>
                  <span className={`nc-tag ${entry.outcome === "accepted" ? "nc-tag-green" : "nc-tag-red"}`}>{entry.commandName}</span>
                  <span>{entry.outcome}</span>
                  {entry.target && <span className="replay-mono">{entry.target}</span>}
                  {entry.detail && <span className="replay-list-eta">{entry.detail}</span>}
                </>
              )}
              {entry.kind === "dispatch" && (
                <>
                  <span className="nc-tag nc-tag-amber">dispatch</span>
                  <span className="replay-mono">{entry.teamId}</span>
                  <span>
                    {entry.from} → {entry.to}
                  </span>
                  <span className="replay-list-eta">ETA T{entry.etaTick}</span>
                </>
              )}
              {entry.kind === "arrived" && (
                <>
                  <span className="nc-tag nc-tag-green">arrived</span>
                  <span className="replay-mono">{entry.teamId}</span>
                  <span>{entry.district}</span>
                </>
              )}
            </li>
          ))}
          {visible.length === 0 && <li className="panel-empty">No actions taken yet at this tick.</li>}
        </ul>
      </div>
    </section>
  );
}

export interface ScoreTimelinePanelProps {
  points: ScoreSeriesPoint[];
  currentTick: number;
  onJumpToTick: (tick: number) => void;
}

/** Every scored event, in order, linked back to the tick that produced it. */
export function ScoreTimelinePanel({ points, currentTick, onJumpToTick }: ScoreTimelinePanelProps) {
  const visible = points.filter((p) => p.tick <= currentTick);
  const runningTotal = visible.length > 0 ? visible[visible.length - 1]!.total : 0;
  return (
    <section className="nc-panel replay-subpanel" aria-label="Score deltas linked to events">
      <div className="nc-panel-title">
        Score deltas <span className="nc-tag">{runningTotal.toFixed(1)} so far</span>
      </div>
      <div className="replay-subpanel-body">
        <ul className="replay-list">
          {visible
            .slice()
            .reverse()
            .map((point, index) => (
              <li key={index} className="replay-list-row">
                <button type="button" className="nc-btn replay-clickable" onClick={() => onJumpToTick(point.tick)}>
                  T{point.tick}
                </button>
                <span className={point.delta >= 0 ? "replay-score-delta-positive" : "replay-score-delta-negative"}>
                  {point.delta >= 0 ? "+" : ""}
                  {point.delta.toFixed(2)}
                </span>
                <span className="nc-tag">{point.category}</span>
                <span className="replay-list-eta">{point.reason}</span>
              </li>
            ))}
          {visible.length === 0 && <li className="panel-empty">No score changes yet at this tick.</li>}
        </ul>
      </div>
    </section>
  );
}
