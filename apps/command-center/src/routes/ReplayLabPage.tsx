import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { restApi } from "../api/rest";
import { ApiError } from "../api/types";
import { MAX_ARTIFACT_BYTES, ReplayArtifactParseError, parseReplayArtifact, unwrapArtifactEnvelope, type ReplayArtifact } from "../replay/schema";
import { FULL_VERIFY_CLI_HINT, verifyReplayArtifact, type ReplayVerifyResult } from "../replay/verify";
import { buildActionTimeline, buildEvidenceProvenance, buildScoreSeries, projectPlayerAtTick, projectTruthAtTick } from "../replay/project";
import { buildMarkdownReport } from "../replay/report";
import { buildDebriefMarkdown } from "../replay/debrief";
import { useLocale } from "../i18n/LocaleContext";
import { ArtifactLoader } from "../components/replay/ArtifactLoader";
import { TimelineScrubber, type TimelineMark } from "../components/replay/TimelineScrubber";
import { DualStatePanel } from "../components/replay/DualStatePanel";
import { EvidenceProvenancePanel } from "../components/replay/EvidenceProvenancePanel";
import { ActionTimelinePanel, ScoreTimelinePanel } from "../components/replay/TimelinePanels";
import { CompareRunsPanel } from "../components/replay/CompareRunsPanel";
import "./ReplayLabPage.css";
import "../components/replay/ReplayPanels.css";

interface LoadedArtifact {
  artifact: ReplayArtifact;
  verify: ReplayVerifyResult;
}

type AutoLoadState = { kind: "idle" } | { kind: "loading" } | { kind: "not-completed" } | { kind: "error"; message: string };

export function ReplayLabPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { locale, t } = useLocale();
  const [primary, setPrimary] = useState<LoadedArtifact | null>(null);
  const [secondary, setSecondary] = useState<LoadedArtifact | null>(null);
  const [tick, setTick] = useState(0);
  const [autoLoad, setAutoLoad] = useState<AutoLoadState>({ kind: "idle" });

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    setAutoLoad({ kind: "loading" });
    restApi
      .artifactRaw(sessionId)
      .then((envelopeText) => {
        if (cancelled) return;
        try {
          const artifact = parseReplayArtifact(unwrapArtifactEnvelope(envelopeText));
          const verify = verifyReplayArtifact(artifact);
          if (verify.status !== "PARTIAL") {
            setPrimary(null);
            setAutoLoad({
              kind: "error",
              message: `artifact rejected: browser verify ${verify.status} — ${verify.reasons.join("; ")}`,
            });
            return;
          }
          setPrimary({ artifact, verify });
          setAutoLoad({ kind: "idle" });
        } catch (error) {
          setPrimary(null);
          if (error instanceof ReplayArtifactParseError) {
            setAutoLoad({ kind: "error", message: `artifact rejected: ${error.message}` });
          } else {
            setAutoLoad({
              kind: "error",
              message: `artifact rejected: ${error instanceof Error ? error.message : "unexpected verification failure"}`,
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === "not_completed") {
          setAutoLoad({ kind: "not-completed" });
        } else if (error instanceof ApiError) {
          setAutoLoad({ kind: "error", message: `${error.code}: ${error.message}` });
        } else if (error instanceof ReplayArtifactParseError) {
          setAutoLoad({ kind: "error", message: `artifact rejected: ${error.message}` });
        } else {
          setAutoLoad({ kind: "error", message: "could not load artifact" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const derived = useMemo(() => {
    if (!primary || primary.verify.status !== "PARTIAL") {
      return null;
    }
    try {
      const { artifact } = primary;
      const evidenceProvenance = buildEvidenceProvenance(artifact);
      const actionTimeline = buildActionTimeline(artifact);
      const scoreSeries = buildScoreSeries(artifact);
      const marks: TimelineMark[] = [
        ...scoreSeries.map((p) => ({ tick: p.tick, label: `${p.category} ${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(1)}`, kind: "score" as const })),
        ...evidenceProvenance.map((e) => ({ tick: e.deliveredTick, label: e.evidenceId, kind: "evidence" as const })),
        ...artifact.commandTrace.map((c) => ({ tick: c.issuedTick, label: c.commandName, kind: "command" as const })),
      ];
      return { evidenceProvenance, actionTimeline, scoreSeries, marks };
    } catch (error) {
      return {
        fatal: error instanceof Error ? error.message : "projection failed",
      } as const;
    }
  }, [primary]);

  const projections = useMemo(() => {
    if (!primary || primary.verify.status !== "PARTIAL") return null;
    try {
      return {
        player: projectPlayerAtTick(primary.artifact.player.events, tick),
        truth: projectTruthAtTick(primary.artifact.truth.events, tick),
      };
    } catch (error) {
      return {
        fatal: error instanceof Error ? error.message : "state projection failed",
      } as const;
    }
  }, [primary, tick]);

  const projectionFailure =
    derived && "fatal" in derived
      ? derived.fatal
      : projections && "fatal" in projections
        ? projections.fatal
        : null;

  function handleLoaded(artifact: ReplayArtifact, verify: ReplayVerifyResult): void {
    // ArtifactLoader already refuses FAIL; defend in depth.
    if (verify.status !== "PARTIAL") {
      setPrimary(null);
      setAutoLoad({
        kind: "error",
        message: `artifact rejected: browser verify ${verify.status} — ${verify.reasons.join("; ")}`,
      });
      return;
    }
    setPrimary({ artifact, verify });
    setTick(0);
    setSecondary(null);
    setAutoLoad({ kind: "idle" });
  }

  function downloadMarkdown(markdown: string, filename: string): void {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportReport(): void {
    if (!primary || !derived || "fatal" in derived) return;
    const markdown = buildMarkdownReport(primary.artifact, primary.verify, derived.evidenceProvenance, secondary?.artifact);
    downloadMarkdown(markdown, `replay-report-${primary.artifact.identity.sessionId}.md`);
  }

  function handleExportDebrief(): void {
    if (!primary || !derived || "fatal" in derived) return;
    const markdown = buildDebriefMarkdown(primary.artifact, derived.evidenceProvenance, locale);
    downloadMarkdown(markdown, `debrief-${primary.artifact.identity.sessionId}.md`);
  }

  return (
    <main className="replay-lab nc-scanlines">
      <header className="replay-lab-header">
        <div>
          <span className="replay-kicker">M9 · {t.replayLab}</span>
          <h1 className="replay-title">{t.replayLab}</h1>
        </div>
        <nav className="replay-lab-nav">
          {sessionId && <Link to={`/session/${encodeURIComponent(sessionId)}`}>Back to Command Center</Link>}
          <Link to="/">Launch</Link>
        </nav>
      </header>

      {!primary && autoLoad.kind === "loading" && <p className="replay-body">Loading artifact for session {sessionId}…</p>}
      {!primary && autoLoad.kind === "not-completed" && (
        <p className="replay-body">
          Session <code>{sessionId}</code> has not completed yet — the run artifact is only released once the phase is
          <code> completed</code>. Finish the run first, or load a different completed run's artifact below.
        </p>
      )}
      {!primary && autoLoad.kind === "error" && (
        <p className="replay-body" role="alert">
          {autoLoad.message}
        </p>
      )}

      {!primary && (
        <ArtifactLoader
          title="Load a completed run"
          description={`Loads a validated run artifact from a completed session export or a dropped file. Files over ${(MAX_ARTIFACT_BYTES / (1024 * 1024)).toFixed(0)}MB are rejected before they are read.`}
          onLoaded={handleLoaded}
          defaultSessionId={sessionId}
        />
      )}

      {primary && projectionFailure && (
        <p className="replay-body" role="alert">
          Artifact rejected during projection: {projectionFailure}
          <button type="button" className="nc-btn" onClick={() => setPrimary(null)}>
            Load another run
          </button>
        </p>
      )}

      {primary &&
        derived &&
        !("fatal" in derived) &&
        projections &&
        !("fatal" in projections) &&
        (
        <div className="replay-lab-content">
          <div className="replay-lab-toolbar">
            <IdentitySummary artifact={primary.artifact} verify={primary.verify} />
            <div className="replay-lab-toolbar-actions">
              <button type="button" className="nc-btn" onClick={() => setPrimary(null)}>
                Load another run
              </button>
              <button type="button" className="nc-btn" onClick={handleExportDebrief}>
                {t.exportDebrief}
              </button>
              <button type="button" className="nc-btn nc-btn-primary" onClick={handleExportReport}>
                {t.exportReport}
              </button>
            </div>
          </div>

          <TimelineScrubber tick={tick} maxTick={primary.artifact.finalTick} marks={derived.marks} onChange={setTick} />

          <DualStatePanel player={projections.player} truth={projections.truth} />

          <EvidenceProvenancePanel
            entries={derived.evidenceProvenance.filter((e) => e.deliveredTick <= tick)}
            assessments={primary.artifact.assessmentTrace.filter((a) => a.submittedTick <= tick)}
            onJumpToTick={setTick}
          />

          <div className="replay-two-col">
            <ActionTimelinePanel entries={derived.actionTimeline} currentTick={tick} onJumpToTick={setTick} />
            <ScoreTimelinePanel points={derived.scoreSeries} currentTick={tick} onJumpToTick={setTick} />
          </div>

          <CompareRunsPanel
            primary={primary.artifact}
            secondary={secondary}
            onLoadSecondary={(artifact, verify) => {
              if (verify.status !== "PARTIAL") {
                return;
              }
              setSecondary({ artifact, verify });
            }}
            onClearSecondary={() => setSecondary(null)}
          />
        </div>
      )}
    </main>
  );
}

function IdentitySummary({ artifact, verify }: { artifact: ReplayArtifact; verify: ReplayVerifyResult }) {
  const badgeClass =
    verify.status === "FAIL" ? "nc-tag-red" : "nc-tag"; /* PARTIAL: not a green full-PASS badge */
  return (
    <div className="replay-identity">
      <span className={`nc-tag ${badgeClass}`} title="Browser scope only; CLI required for full replay">
        browser verify: {verify.status}
        {verify.status === "PARTIAL" ? " (integrity+semantics)" : ""}
      </span>
      <span className="nc-tag">Integrity: {verify.scopes.integrity}</span>
      <span className="nc-tag">Semantic bindings: {verify.scopes.semanticBindings}</span>
      <span className="nc-tag">Truth replay: {verify.scopes.truthReplay}</span>
      <span className="nc-tag">Player replay: {verify.scopes.playerReplay}</span>
      <span className="nc-tag">stateDigest: {verify.scopes.stateDigest}</span>
      <span className="nc-tag">scenarioDigest: {verify.scopes.scenarioContentDigest}</span>
      <span className="nc-tag">protocol: {verify.scopes.engineProtocolCompatibility}</span>
      <span className="nc-tag">publicActionLedger: {verify.scopes.publicActionLedger}</span>
      <span className="nc-tag">authenticity: {verify.scopes.authenticity}</span>
      <span className="replay-mono">{artifact.identity.sessionId}</span>
      <span>{artifact.identity.scenarioId}</span>
      <span>seed {artifact.identity.seed}</span>
      <span>
        T{artifact.finalTick}/{artifact.identity.totalTicks}
      </span>
      <span>score {artifact.scoreTotal.toFixed(1)}</span>
      {verify.reasons.length > 0 && <span className="replay-verify-error">{verify.reasons.join("; ")}</span>}
      <span className="replay-verify-hint" title={FULL_VERIFY_CLI_HINT}>
        Full verify: CLI <code>null-city-run verify</code> (truth + player replay)
      </span>
    </div>
  );
}
