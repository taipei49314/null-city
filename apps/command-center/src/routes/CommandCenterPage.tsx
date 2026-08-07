import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CommandName } from "@null-city/contracts";
import { restApi } from "../api/rest";
import { ApiError } from "../api/types";
import { openSessionSocket } from "../api/ws";
import { initialSessionViewState, sessionReducer } from "../state/sessionReducer";
import { TopologyMap } from "../components/TopologyMap";
import { EvidenceTimeline } from "../components/EvidenceTimeline";
import { ClaimBoard } from "../components/ClaimBoard";
import { TeamsPanel } from "../components/TeamsPanel";
import { CommandComposer } from "../components/CommandComposer";
import { ClockBar } from "../components/ClockBar";
import { SummaryPanel } from "../components/SummaryPanel";
import { getTopology } from "../topology/registry";
import "./CommandCenterPage.css";

function apiErrorShape(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  return { code: "unknown_error", message: error instanceof Error ? error.message : "unknown error" };
}

const AUTO_ADVANCE_TICKS = 5;
const AUTO_ADVANCE_INTERVAL_MS = 2000;

export function CommandCenterPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [state, dispatch] = useReducer(sessionReducer, undefined, initialSessionViewState);
  const [sessionExists, setSessionExists] = useState<boolean | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const advancingRef = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    dispatch({ type: "LOAD_START" });
    restApi
      .events(sessionId, 0)
      .then((result) => {
        if (cancelled) {
          return;
        }
        dispatch({ type: "EVENTS", events: result.events });
        setSessionExists(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const shaped = apiErrorShape(error);
        if (shaped.code === "not_found") {
          dispatch({ type: "LOAD_NOT_FOUND" });
          setSessionExists(false);
        } else {
          dispatch({ type: "ERROR", error: shaped });
          setSessionExists(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !sessionExists) {
      return;
    }
    const socket = openSessionSocket(sessionId, {
      onEvents: (events) => dispatch({ type: "EVENTS", events }),
      onState: (connectionState) => dispatch({ type: "CONNECTION", state: connectionState }),
      onError: (error) => dispatch({ type: "ERROR", error }),
    });
    return () => socket.close();
  }, [sessionId, sessionExists]);

  async function handleAdvance(ticks: number): Promise<void> {
    if (!sessionId || advancingRef.current) {
      return;
    }
    advancingRef.current = true;
    setAdvancing(true);
    try {
      const result = await restApi.advance(sessionId, ticks);
      dispatch({ type: "EVENTS", events: result.events });
      if (result.completed) {
        setAutoAdvance(false);
      }
    } catch (error) {
      dispatch({ type: "ERROR", error: apiErrorShape(error) });
      setAutoAdvance(false);
    } finally {
      advancingRef.current = false;
      setAdvancing(false);
    }
  }

  useEffect(() => {
    if (!autoAdvance || !sessionId) {
      return;
    }
    if (state.player?.phase === "completed") {
      return;
    }
    const id = setInterval(() => {
      void handleAdvance(AUTO_ADVANCE_TICKS);
    }, AUTO_ADVANCE_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, sessionId, state.player?.phase]);

  async function handleCommand(commandName: CommandName, params: Record<string, unknown>): Promise<void> {
    if (!sessionId) {
      return;
    }
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentTick = state.player?.tick ?? 0;
    try {
      const result = await restApi.command(sessionId, { commandName, params, idempotencyKey });
      dispatch({ type: "EVENTS", events: result.events });
      const ok = result.state === "accepted" && result.validation.valid;
      const message = result.validation.valid
        ? result.result?.detail || "Command accepted."
        : result.validation.errorMessage || "Command rejected.";
      dispatch({ type: "COMMAND_FEEDBACK", commandName, ok, message, tick: currentTick });
    } catch (error) {
      const shaped = apiErrorShape(error);
      dispatch({
        type: "COMMAND_FEEDBACK",
        commandName,
        ok: false,
        message: `${shaped.code}: ${shaped.message}`,
        tick: currentTick,
      });
    }
  }

  async function handleAssessment(
    claimId: string,
    probability: number,
    confidence: number,
    rationale: string,
  ): Promise<void> {
    if (!sessionId) {
      return;
    }
    try {
      const result = await restApi.assess(sessionId, claimId, probability, confidence, rationale || undefined);
      dispatch({ type: "EVENTS", events: result.events });
    } catch (error) {
      const shaped = apiErrorShape(error);
      throw new Error(`${shaped.code}: ${shaped.message}`);
    }
  }

  async function handleRequestVerification(claimId: string, teamId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const result = await restApi.command(sessionId, {
        commandName: "REQUEST_VERIFICATION",
        params: { claimId, teamId },
        idempotencyKey,
      });
      dispatch({ type: "EVENTS", events: result.events });
      if (!result.validation.valid) {
        throw new Error(`${result.validation.errorCode}: ${result.validation.errorMessage}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      const shaped = apiErrorShape(error);
      throw new Error(`${shaped.code}: ${shaped.message}`);
    }
  }

  if (!sessionId) {
    return null;
  }

  if (state.phase === "loading") {
    return (
      <main className="command-center-loading">
        <p>Connecting to command center…</p>
      </main>
    );
  }

  if (state.phase === "not-found") {
    return (
      <main className="command-center-not-found">
        <div>
          <h1>Session not found</h1>
          <p>
            <code>{sessionId}</code> does not exist on this server.
          </p>
          <p>
            <Link to="/">Start a new session</Link>
          </p>
        </div>
      </main>
    );
  }

  if (state.phase === "error" && !state.player) {
    return (
      <main className="command-center-not-found">
        <div>
          <h1>Server error</h1>
          <p>{state.lastError?.message ?? "Could not reach the NULL CITY server."}</p>
          <p>
            <Link to="/">Return to launch</Link>
          </p>
        </div>
      </main>
    );
  }

  const player = state.player;
  if (!player) {
    return null;
  }

  const evidenceForClaim = selectedClaimId ? player.evidence.filter((e) => e.claimId === selectedClaimId) : player.evidence;
  const topology = getTopology(player.scenarioId);

  return (
    <main className="command-center nc-scanlines">
      <ClockBar
        sessionId={sessionId}
        scenarioLabel={player.scenarioId.replace(/-/g, " ").toUpperCase()}
        tick={player.tick}
        totalTicks={state.totalTicks}
        phase={player.phase}
        connection={state.connection}
        autoAdvance={autoAdvance}
        advancing={advancing}
        onToggleAutoAdvance={() => setAutoAdvance((v) => !v)}
        onAdvance={(ticks) => void handleAdvance(ticks)}
      />

      {state.lastError && (
        <div className="command-center-error-banner" role="alert">
          <span>
            {state.lastError.code}: {state.lastError.message}
          </span>
          <button type="button" className="nc-btn" onClick={() => dispatch({ type: "CLEAR_ERROR" })}>
            Dismiss
          </button>
        </div>
      )}

      {player.phase === "completed" && <SummaryPanel sessionId={sessionId} />}

      <div className="command-center-grid">
        <section className="nc-panel command-center-panel panel-topology" aria-label="Topology">
          <div className="nc-panel-title">Topology</div>
          <div className="command-center-panel-body">
            <TopologyMap
              topology={topology}
              routes={player.routes}
              teams={player.teams}
              claims={player.claims}
              selectedDistrict={selectedDistrict}
              onSelectDistrict={setSelectedDistrict}
            />
          </div>
        </section>

        <section className="nc-panel command-center-panel panel-evidence" aria-label="Evidence timeline">
          <div className="nc-panel-title">
            Evidence
            {selectedClaimId && (
              <button type="button" className="nc-btn" onClick={() => setSelectedClaimId(null)}>
                Show all
              </button>
            )}
          </div>
          <div className="command-center-panel-body">
            <EvidenceTimeline
              evidence={evidenceForClaim}
              selectedClaimId={selectedClaimId}
              onSelectClaim={setSelectedClaimId}
            />
          </div>
        </section>

        <section className="nc-panel command-center-panel panel-teams" aria-label="Teams and resources">
          <div className="nc-panel-title">Teams &amp; resources</div>
          <div className="command-center-panel-body">
            <TeamsPanel teams={player.teams} resources={player.resources} />
          </div>
        </section>

        <section className="nc-panel command-center-panel panel-claims" aria-label="Claim and assessment board">
          <div className="nc-panel-title">Claims &amp; assessments</div>
          <div className="command-center-panel-body">
            <ClaimBoard
              claims={player.claims}
              assessments={player.assessments}
              teams={player.teams}
              selectedClaimId={selectedClaimId}
              onSelectClaim={setSelectedClaimId}
              onSubmitAssessment={handleAssessment}
              onRequestVerification={handleRequestVerification}
              disabled={player.phase === "completed"}
            />
          </div>
        </section>

        <section className="nc-panel command-center-panel panel-composer" aria-label="Command composer">
          <div className="nc-panel-title">Command composer</div>
          <div className="command-center-panel-body">
            <CommandComposer
              topology={topology}
              teams={player.teams}
              routes={player.routes}
              claims={player.claims}
              disabled={player.phase === "completed"}
              feedback={state.feedback}
              onSubmit={handleCommand}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
