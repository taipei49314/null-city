import { useState } from "react";
import type { ConnectionState } from "../api/ws";
import "./ClockBar.css";

export interface ClockBarProps {
  sessionId: string;
  scenarioLabel: string;
  tick: number;
  totalTicks: number | null;
  phase: "running" | "completed";
  connection: ConnectionState | "idle";
  autoAdvance: boolean;
  advancing: boolean;
  onToggleAutoAdvance: () => void;
  onAdvance: (ticks: number) => void;
}

const CONNECTION_LABEL: Record<ClockBarProps["connection"], string> = {
  idle: "Connecting…",
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

export function ClockBar({
  sessionId,
  scenarioLabel,
  tick,
  totalTicks,
  phase,
  connection,
  autoAdvance,
  advancing,
  onToggleAutoAdvance,
  onAdvance,
}: ClockBarProps) {
  const [stepInput, setStepInput] = useState("10");
  const progress = totalTicks ? Math.min(100, Math.round((tick / totalTicks) * 100)) : null;

  function handleAdvance(): void {
    const n = Math.max(1, Math.min(540, Math.trunc(Number(stepInput) || 1)));
    onAdvance(n);
  }

  return (
    <header className="clock-bar nc-panel">
      <div className="clock-bar-identity">
        <span className="clock-bar-scenario">{scenarioLabel}</span>
        <span className="clock-bar-session">session {sessionId}</span>
      </div>

      <div className="clock-bar-tick">
        <span className="clock-bar-tick-value">
          T{tick}
          {totalTicks !== null ? ` / ${totalTicks}` : ""}
        </span>
        {progress !== null && (
          <div className="clock-bar-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="clock-bar-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
        <span className={`nc-tag ${phase === "completed" ? "nc-tag-green" : ""}`}>{phase}</span>
      </div>

      <div className="clock-bar-controls">
        <label className="clock-bar-step">
          <span className="nc-visually-hidden">Ticks per advance</span>
          <input
            className="nc-input clock-bar-step-input"
            value={stepInput}
            onChange={(event) => setStepInput(event.target.value)}
            inputMode="numeric"
            aria-label="Ticks per advance"
            disabled={phase === "completed"}
          />
        </label>
        <button
          type="button"
          className="nc-btn"
          onClick={handleAdvance}
          disabled={phase === "completed" || advancing}
        >
          {advancing ? "Advancing…" : "Advance ticks"}
        </button>
        <button
          type="button"
          className={`nc-btn ${autoAdvance ? "nc-btn-primary" : ""}`}
          onClick={onToggleAutoAdvance}
          disabled={phase === "completed"}
          aria-pressed={autoAdvance}
        >
          {autoAdvance ? "Pause" : "Auto-advance"}
        </button>
      </div>

      <div className="clock-bar-connection">
        <span className={`connection-dot connection-${connection}`} aria-hidden="true" />
        {CONNECTION_LABEL[connection]}
      </div>
    </header>
  );
}
