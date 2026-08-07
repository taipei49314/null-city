import type { ReplayArtifact } from "./schema";
import type { EvidenceProvenanceEntry } from "./project";

/**
 * Heuristic after-action debrief (no LLM). Built only from artifact + provenance.
 */
export function buildDebriefMarkdown(
  artifact: ReplayArtifact,
  provenance: EvidenceProvenanceEntry[],
  locale: "zh-TW" | "en" = "zh-TW",
): string {
  const distorted = provenance.filter((entry) => entry.distorted);
  const falseReports = distorted.filter((entry) => entry.isFalseReport);
  const lateOnly = distorted.filter((entry) => !entry.isFalseReport && entry.delayTicks > 5);
  const verifyCmds = artifact.commandTrace.filter((c) => c.commandName === "REQUEST_VERIFICATION");
  const advisoryCmds = artifact.commandTrace.filter((c) => c.commandName === "ISSUE_PUBLIC_ADVISORY");
  const firstCmdTick = artifact.commandTrace[0]?.issuedTick ?? null;
  const verificationFirst =
    verifyCmds.length > 0 &&
    (firstCmdTick === null || (verifyCmds[0]!.issuedTick <= (firstCmdTick ?? 0) + 15));

  if (locale === "en") {
    return buildEn(artifact, falseReports, lateOnly, verifyCmds.length, advisoryCmds.length, verificationFirst);
  }
  return buildZh(artifact, falseReports, lateOnly, verifyCmds.length, advisoryCmds.length, verificationFirst);
}

function buildZh(
  artifact: ReplayArtifact,
  falseReports: EvidenceProvenanceEntry[],
  lateOnly: EvidenceProvenanceEntry[],
  verifyCount: number,
  advisoryCount: number,
  verificationFirst: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# 戰後簡報 — ${artifact.identity.sessionId}`);
  lines.push("");
  lines.push(`- 場景：\`${artifact.identity.scenarioId}\``);
  lines.push(`- 種子：${artifact.identity.seed}`);
  lines.push(`- 終局分數：${artifact.scoreTotal.toFixed(2)}`);
  lines.push(`- 已處置事件：${artifact.handledIncidents.join(", ") || "（無）"}`);
  lines.push(`- 仍未解決：${artifact.activeIncidents.join(", ") || "（無）"}`);
  lines.push("");
  lines.push("## 情報扭曲");
  lines.push("");
  if (falseReports.length === 0 && lateOnly.length === 0) {
    lines.push("本次未偵測到明顯假報或嚴重延遲通報。");
  } else {
    lines.push(`- 假報／錯置歸因：${falseReports.length} 則`);
    lines.push(`- 明顯延遲通報：${lateOnly.length} 則`);
    for (const entry of falseReports.slice(0, 5)) {
      lines.push(
        `- T${entry.deliveredTick} 假報影響主張 \`${entry.claimId}\`：${entry.reportedContent.slice(0, 80)}`,
      );
    }
  }
  lines.push("");
  lines.push("## 行動節奏");
  lines.push("");
  lines.push(`- 現場驗證指令：${verifyCount}`);
  lines.push(`- 公共勸告指令：${advisoryCount}`);
  lines.push(
    verificationFirst
      ? "- 節奏判斷：偏「先驗證」——較符合高誤報場景的穩健策略。"
      : "- 節奏判斷：偏「先行動」——在鏡像／偽造情報場景可能過早投入資源。",
  );
  lines.push("");
  lines.push("## 若採驗證優先策略");
  lines.push("");
  lines.push(
    "啟發式建議（非重跑）：在首批行動前，先對互相矛盾的行政區各派一組驗證小隊；確認真源後再投入消防／醫療。對宣稱「全部安全」或「對方才是災區」的新聞，預設不採信，直到現場結果回來。",
  );
  lines.push("");
  lines.push("> 本簡報由產物欄位推導，不含 LLM 生成，也不證明產物來源真實性。");
  lines.push("");
  return lines.join("\n");
}

function buildEn(
  artifact: ReplayArtifact,
  falseReports: EvidenceProvenanceEntry[],
  lateOnly: EvidenceProvenanceEntry[],
  verifyCount: number,
  advisoryCount: number,
  verificationFirst: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# After-Action Debrief — ${artifact.identity.sessionId}`);
  lines.push("");
  lines.push(`- Scenario: \`${artifact.identity.scenarioId}\``);
  lines.push(`- Seed: ${artifact.identity.seed}`);
  lines.push(`- Final score: ${artifact.scoreTotal.toFixed(2)}`);
  lines.push(`- Handled: ${artifact.handledIncidents.join(", ") || "(none)"}`);
  lines.push(`- Still active: ${artifact.activeIncidents.join(", ") || "(none)"}`);
  lines.push("");
  lines.push("## Distortion");
  lines.push("");
  if (falseReports.length === 0 && lateOnly.length === 0) {
    lines.push("No clear false or severely delayed reports detected.");
  } else {
    lines.push(`- False / misattributed reports: ${falseReports.length}`);
    lines.push(`- Severely delayed reports: ${lateOnly.length}`);
    for (const entry of falseReports.slice(0, 5)) {
      lines.push(
        `- T${entry.deliveredTick} false report on claim \`${entry.claimId}\`: ${entry.reportedContent.slice(0, 80)}`,
      );
    }
  }
  lines.push("");
  lines.push("## Tempo");
  lines.push("");
  lines.push(`- Verification commands: ${verifyCount}`);
  lines.push(`- Public advisories: ${advisoryCount}`);
  lines.push(
    verificationFirst
      ? "- Tempo read: verification-leaning — usually safer under mirrored/spoofed intel."
      : "- Tempo read: action-leaning — may over-commit before settling contradictory twins.",
  );
  lines.push("");
  lines.push("## If verification-first");
  lines.push("");
  lines.push(
    "Heuristic (not a re-sim): verify both contradictory districts before committing fire/medical; treat \"all clear\" / \"the other twin is the crisis\" news as untrusted until on-site outcomes return.",
  );
  lines.push("");
  lines.push("> Derived from artifact fields only. No LLM. Not a proof of provenance.");
  lines.push("");
  return lines.join("\n");
}
