import "./TimelineScrubber.css";

export interface TimelineMark {
  tick: number;
  label: string;
  kind: "score" | "evidence" | "command" | "incident";
}

export interface TimelineScrubberProps {
  tick: number;
  maxTick: number;
  marks: TimelineMark[];
  onChange: (tick: number) => void;
}

const KIND_CLASS: Record<TimelineMark["kind"], string> = {
  score: "timeline-mark-score",
  evidence: "timeline-mark-evidence",
  command: "timeline-mark-command",
  incident: "timeline-mark-incident",
};

export function TimelineScrubber({ tick, maxTick, marks, onChange }: TimelineScrubberProps) {
  const safeMax = Math.max(maxTick, 1);
  const step = (delta: number) => onChange(Math.min(safeMax, Math.max(0, tick + delta)));

  return (
    <div className="timeline-scrubber nc-panel" aria-label="Replay timeline">
      <div className="timeline-scrubber-controls">
        <button type="button" className="nc-btn" onClick={() => step(-10)} aria-label="Back 10 ticks">
          «10
        </button>
        <button type="button" className="nc-btn" onClick={() => step(-1)} aria-label="Back 1 tick">
          ‹
        </button>
        <input
          type="range"
          className="timeline-range"
          min={0}
          max={safeMax}
          value={tick}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button type="button" className="nc-btn" onClick={() => step(1)} aria-label="Forward 1 tick">
          ›
        </button>
        <button type="button" className="nc-btn" onClick={() => step(10)} aria-label="Forward 10 ticks">
          10»
        </button>
        <div className="timeline-tick-readout">
          T{tick} <span className="timeline-tick-max">/ {safeMax}</span>
        </div>
      </div>
      <div className="timeline-marks-track">
        {marks.map((mark, index) => (
          <button
            key={`${mark.tick}-${mark.kind}-${index}`}
            type="button"
            className={`timeline-mark ${KIND_CLASS[mark.kind]}`}
            style={{ left: `${(mark.tick / safeMax) * 100}%` }}
            title={`T${mark.tick} — ${mark.label}`}
            onClick={() => onChange(mark.tick)}
          />
        ))}
        <div className="timeline-cursor" style={{ left: `${(tick / safeMax) * 100}%` }} />
      </div>
    </div>
  );
}
