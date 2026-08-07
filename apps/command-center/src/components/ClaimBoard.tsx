import { useState } from "react";
import type { Assessment, Claim, OwnTeamState } from "@null-city/contracts";
import { claimLocationLabel } from "./EvidenceTimeline";
import "./ClaimBoard.css";

export interface ClaimBoardProps {
  claims: readonly Claim[];
  assessments: readonly Assessment[];
  teams: readonly OwnTeamState[];
  selectedClaimId: string | null;
  onSelectClaim: (claimId: string | null) => void;
  onSubmitAssessment: (claimId: string, probability: number, confidence: number, rationale: string) => Promise<void>;
  onRequestVerification: (claimId: string, teamId: string) => Promise<void>;
  disabled: boolean;
}

const STATUS_TAG: Record<Claim["status"], string> = {
  reported: "nc-tag",
  corroborated: "nc-tag nc-tag-amber",
  contested: "nc-tag nc-tag-red",
  verified: "nc-tag nc-tag-green",
  refuted: "nc-tag nc-tag-red",
  stale: "nc-tag",
};

export function ClaimBoard({
  claims,
  assessments,
  teams,
  selectedClaimId,
  onSelectClaim,
  onSubmitAssessment,
  onRequestVerification,
  disabled,
}: ClaimBoardProps) {
  if (claims.length === 0) {
    return <div className="panel-empty">No claims have formed yet.</div>;
  }

  const verificationTeams = teams.filter((team) => team.type === "verification");
  const ordered = [...claims].sort((a, b) => b.lastUpdatedTick - a.lastUpdatedTick);

  return (
    <ul className="claim-board" aria-label="Claims and assessments">
      {ordered.map((claim) => (
        <ClaimRow
          key={claim.id}
          claim={claim}
          assessments={assessments.filter((a) => a.claimId === claim.id)}
          verificationTeams={verificationTeams}
          expanded={selectedClaimId === claim.id}
          onToggle={() => onSelectClaim(selectedClaimId === claim.id ? null : claim.id)}
          onSubmitAssessment={onSubmitAssessment}
          onRequestVerification={onRequestVerification}
          disabled={disabled}
        />
      ))}
    </ul>
  );
}

function ClaimRow({
  claim,
  assessments,
  verificationTeams,
  expanded,
  onToggle,
  onSubmitAssessment,
  onRequestVerification,
  disabled,
}: {
  claim: Claim;
  assessments: Assessment[];
  verificationTeams: OwnTeamState[];
  expanded: boolean;
  onToggle: () => void;
  onSubmitAssessment: ClaimBoardProps["onSubmitAssessment"];
  onRequestVerification: ClaimBoardProps["onRequestVerification"];
  disabled: boolean;
}) {
  const [probability, setProbability] = useState("0.5");
  const [confidence, setConfidence] = useState("0.5");
  const [rationale, setRationale] = useState("");
  const [teamId, setTeamId] = useState(verificationTeams[0]?.teamId ?? "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submitAssessment(): Promise<void> {
    const p = Number(probability);
    const c = Number(confidence);
    if (!Number.isFinite(p) || p < 0 || p > 1 || !Number.isFinite(c) || c < 0 || c > 1) {
      setLocalError("Probability and confidence must be between 0 and 1.");
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await onSubmitAssessment(claim.id, p, c, rationale);
      setRationale("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "assessment failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitVerification(): Promise<void> {
    if (!teamId) {
      setLocalError("Select a verification team.");
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await onRequestVerification(claim.id, teamId);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "verification request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="claim-row">
      <button type="button" className="claim-row-head" onClick={onToggle} aria-expanded={expanded}>
        <span className={STATUS_TAG[claim.status]}>{claim.status}</span>
        <span className="claim-summary">
          {claim.subject} {claim.predicate} {String(claim.value)}
        </span>
        <span className="claim-district">{claimLocationLabel(claim.districtId)}</span>
        <span className="claim-tick">as of T{claim.asOfTick}</span>
      </button>

      {expanded && (
        <div className="claim-detail">
          <p className="claim-detail-line">
            Evidence: {claim.evidenceIds.length} · first observed T{claim.firstObservedTick} · updated T
            {claim.lastUpdatedTick}
          </p>

          {assessments.length > 0 && (
            <ul className="claim-assessments">
              {assessments.map((assessment) => (
                <li key={assessment.id}>
                  p={assessment.probability.toFixed(2)} conf={assessment.confidence.toFixed(2)} (T
                  {assessment.submittedTick}){assessment.rationale ? ` — "${assessment.rationale}"` : ""}
                </li>
              ))}
            </ul>
          )}

          <div className="claim-form">
            <div className="claim-form-row">
              <label>
                Probability
                <input
                  className="nc-input"
                  value={probability}
                  onChange={(event) => setProbability(event.target.value)}
                  inputMode="decimal"
                  aria-label={`Assessed probability for claim ${claim.id}`}
                />
              </label>
              <label>
                Confidence
                <input
                  className="nc-input"
                  value={confidence}
                  onChange={(event) => setConfidence(event.target.value)}
                  inputMode="decimal"
                  aria-label={`Assessment confidence for claim ${claim.id}`}
                />
              </label>
            </div>
            <label className="claim-form-rationale">
              Rationale (optional)
              <textarea
                className="nc-textarea"
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                rows={2}
              />
            </label>
            <div className="claim-form-actions">
              <button type="button" className="nc-btn" disabled={disabled || busy} onClick={submitAssessment}>
                Submit assessment
              </button>
              {claim.districtId && verificationTeams.length > 0 && (
                <>
                  <select
                    className="nc-select"
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                    aria-label="Verification team"
                  >
                    {verificationTeams.map((team) => (
                      <option key={team.teamId} value={team.teamId}>
                        {team.teamId} ({team.status})
                      </option>
                    ))}
                  </select>
                  <button type="button" className="nc-btn" disabled={disabled || busy} onClick={submitVerification}>
                    Request verification
                  </button>
                </>
              )}
            </div>
            {localError && (
              <p className="claim-form-error" role="alert">
                {localError}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
