import { useRef, useState } from "react";
import { restApi } from "../../api/rest";
import { ApiError } from "../../api/types";
import { MAX_ARTIFACT_BYTES, ReplayArtifactParseError, parseReplayArtifact, unwrapArtifactEnvelope, type ReplayArtifact } from "../../replay/schema";
import { verifyReplayArtifact, type ReplayVerifyResult } from "../../replay/verify";
import "./ArtifactLoader.css";

export interface ArtifactLoaderProps {
  title: string;
  description: string;
  onLoaded: (artifact: ReplayArtifact, verify: ReplayVerifyResult) => void;
  defaultSessionId?: string;
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

/**
 * Loads a run artifact either from a completed session (server export) or
 * from a dropped/selected `.artifact.json` file. Both paths run the exact
 * same strict, bounded-size parser and independent client-side
 * verification — the browser never trusts a file (or a server response)
 * just because it parsed as JSON.
 */
export function ArtifactLoader({ title, description, onLoaded, defaultSessionId }: ArtifactLoaderProps) {
  const [sessionId, setSessionId] = useState(defaultSessionId ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function finish(artifact: ReplayArtifact) {
    let verify: ReplayVerifyResult;
    try {
      verify = verifyReplayArtifact(artifact);
    } catch (error) {
      setStatus({
        kind: "error",
        message: `rejected: verification aborted — ${error instanceof Error ? error.message : "unknown error"}`,
      });
      return;
    }
    if (verify.status !== "PARTIAL") {
      setStatus({
        kind: "error",
        message: `rejected: browser verify ${verify.status} — ${verify.reasons.join("; ") || "integrity/semantic bindings failed"}`,
      });
      return;
    }
    setStatus({ kind: "idle" });
    onLoaded(artifact, verify);
  }

  async function loadFromSession(): Promise<void> {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      setStatus({ kind: "error", message: "enter a session id" });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const envelopeText = await restApi.artifactRaw(trimmed);
      const artifactJson = unwrapArtifactEnvelope(envelopeText);
      finish(parseReplayArtifact(artifactJson));
    } catch (error) {
      setStatus({ kind: "error", message: describeError(error) });
    }
  }

  async function loadFromFile(file: File): Promise<void> {
    if (file.size > MAX_ARTIFACT_BYTES) {
      setStatus({
        kind: "error",
        message: `file is ${file.size.toLocaleString()} bytes, exceeding the ${MAX_ARTIFACT_BYTES.toLocaleString()} byte limit — rejected before reading`,
      });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const text = await file.text();
      finish(parseReplayArtifact(text));
    } catch (error) {
      setStatus({ kind: "error", message: describeError(error) });
    }
  }

  return (
    <section className="artifact-loader nc-panel" aria-label={title}>
      <div className="nc-panel-title">{title}</div>
      <div className="artifact-loader-body">
        <p className="artifact-loader-description">{description}</p>

        <div
          className={`artifact-dropzone ${dragOver ? "artifact-dropzone-active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files[0];
            if (file) {
              void loadFromFile(file);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          Drop a <code>.artifact.json</code> file here, or click to browse.
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="nc-visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void loadFromFile(file);
              }
              event.target.value = "";
            }}
          />
        </div>

        <div className="artifact-loader-divider">or</div>

        <div className="artifact-loader-session-row">
          <input
            type="text"
            className="nc-input"
            placeholder="completed session id"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void loadFromSession();
              }
            }}
          />
          <button type="button" className="nc-btn nc-btn-primary" disabled={status.kind === "loading"} onClick={() => void loadFromSession()}>
            {status.kind === "loading" ? "Loading…" : "Load artifact"}
          </button>
        </div>

        {status.kind === "error" && (
          <p className="artifact-loader-error" role="alert">
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ReplayArtifactParseError) {
    return `rejected: ${error.message}`;
  }
  if (error instanceof ApiError) {
    if (error.code === "not_completed") {
      return "that session has not completed yet — the truth bundle is never released early.";
    }
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "could not load artifact";
}
