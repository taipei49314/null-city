import type { Evidence } from "@null-city/contracts";
import { districtLabel } from "../topology/registry";
import "./EvidenceTimeline.css";

export interface EvidenceTimelineProps {
  evidence: readonly Evidence[];
  selectedClaimId: string | null;
  onSelectClaim: (claimId: string) => void;
}

export function EvidenceTimeline({ evidence, selectedClaimId, onSelectClaim }: EvidenceTimelineProps) {
  const ordered = [...evidence].sort((a, b) => a.deliveredTick - b.deliveredTick);

  if (ordered.length === 0) {
    return <div className="panel-empty">No evidence has reached command yet.</div>;
  }

  return (
    <ol className="evidence-timeline" aria-label="Evidence, in delivery order">
      {ordered.map((item) => (
        <li
          key={item.id}
          className={`evidence-item ${selectedClaimId === item.claimId ? "evidence-item-selected" : ""}`}
        >
          <button type="button" className="evidence-item-btn" onClick={() => onSelectClaim(item.claimId)}>
            <div className="evidence-item-head">
              <span className="evidence-tick">T{item.deliveredTick}</span>
              <span className="nc-tag">{item.category}</span>
              <span className="nc-tag">{item.sourceId}</span>
              <span
                className={`nc-tag ${item.reliability >= 0.7 ? "nc-tag-green" : item.reliability >= 0.4 ? "nc-tag-amber" : "nc-tag-red"}`}
                title="Source reliability as known to command; not a truth guarantee"
              >
                reliability {Math.round(item.reliability * 100)}%
              </span>
              {item.verified && <span className="nc-tag nc-tag-green">verified</span>}
            </div>
            <p className="evidence-item-content">{item.content}</p>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function claimLocationLabel(districtId?: string): string {
  return districtId ? districtLabel(districtId) : "Unknown district";
}
