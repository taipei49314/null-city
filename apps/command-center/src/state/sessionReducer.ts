import type { PlayerEventEnvelope, PlayerSessionState } from "@null-city/contracts";
import type { ConnectionState } from "../api/ws";
import { applyPlayerEvent, emptyPlayerState } from "./projector";
import { describeEvent, type ActivityEntry } from "./activity";

export type LoadPhase = "loading" | "ready" | "not-found" | "error";

export interface CommandFeedback {
  commandName: string;
  ok: boolean;
  message: string;
  tick: number;
  key: number;
}

export interface SessionViewState {
  phase: LoadPhase;
  connection: ConnectionState | "idle";
  player: PlayerSessionState | null;
  totalTicks: number | null;
  lastAppliedSequence: number;
  activity: ActivityEntry[];
  lastError: { code: string; message: string } | null;
  feedback: CommandFeedback | null;
  feedbackCounter: number;
}

export type SessionAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_NOT_FOUND" }
  | { type: "HYDRATE"; player: PlayerSessionState; events?: PlayerEventEnvelope[] }
  | { type: "EVENTS"; events: PlayerEventEnvelope[] }
  | { type: "CONNECTION"; state: ConnectionState }
  | { type: "ERROR"; error: { code: string; message: string } }
  | { type: "CLEAR_ERROR" }
  | { type: "COMMAND_FEEDBACK"; commandName: string; ok: boolean; message: string; tick: number };

const ACTIVITY_LIMIT = 500;

export function initialSessionViewState(): SessionViewState {
  return {
    phase: "loading",
    connection: "idle",
    player: null,
    totalTicks: null,
    lastAppliedSequence: -1,
    activity: [],
    lastError: null,
    feedback: null,
    feedbackCounter: 0,
  };
}

function applyNewEvents(state: SessionViewState, events: readonly PlayerEventEnvelope[]): SessionViewState {
  const fresh = events.filter((event) => event.sequence > state.lastAppliedSequence);
  if (fresh.length === 0) {
    return state;
  }
  let player = state.player ?? emptyPlayerState(fresh[0]!.sessionId);
  let totalTicks = state.totalTicks;
  const newEntries: ActivityEntry[] = [];
  let lastAppliedSequence = state.lastAppliedSequence;
  for (const event of fresh) {
    player = applyPlayerEvent(player, event);
    if (event.kind === "SessionStarted") {
      totalTicks = (event.payload as { totalTicks: number }).totalTicks;
    }
    newEntries.push(describeEvent(event));
    lastAppliedSequence = Math.max(lastAppliedSequence, event.sequence);
  }
  const activity = [...state.activity, ...newEntries].slice(-ACTIVITY_LIMIT);
  return { ...state, player, totalTicks, activity, lastAppliedSequence, phase: "ready" };
}

export function sessionReducer(state: SessionViewState, action: SessionAction): SessionViewState {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, phase: "loading", lastError: null };
    case "LOAD_NOT_FOUND":
      return { ...state, phase: "not-found" };
    case "HYDRATE": {
      const hydrated: SessionViewState = {
        ...state,
        phase: "ready",
        player: action.player,
        lastError: null,
      };
      if (action.events && action.events.length > 0) {
        return applyNewEvents(hydrated, action.events);
      }
      return hydrated;
    }
    case "EVENTS":
      return applyNewEvents(state, action.events);
    case "CONNECTION":
      return { ...state, connection: action.state };
    case "ERROR":
      return { ...state, lastError: action.error, phase: state.player ? state.phase : "error" };
    case "CLEAR_ERROR":
      return { ...state, lastError: null };
    case "COMMAND_FEEDBACK":
      return {
        ...state,
        feedbackCounter: state.feedbackCounter + 1,
        feedback: {
          commandName: action.commandName,
          ok: action.ok,
          message: action.message,
          tick: action.tick,
          key: state.feedbackCounter + 1,
        },
      };
    default:
      return state;
  }
}
