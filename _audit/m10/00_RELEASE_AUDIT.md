# NullCity M9 — Red Ledger 發版級審查

**審查日期：2026-08-07**  
**審查對象：** `null-city-m9-red-ledger.zip`  
**裁決：** **FAIL — 不得建立 `v0.1.0` 或 RC release tag**  
**可接受狀態：** 可推上 GitHub 作為 **Alpha / development milestone**，但必須保留 `NOT READY TO TAG`，不得宣稱 player history 已可完整重播驗證。

---

## 1. 執行摘要

M9 並不是退步版。前一輪兩個最危險的問題已有實質修正：

1. 公開 REST／WebSocket surface 不再接受 caller-supplied raw snapshot resume；resume 被縮到 in-process admin boundary。
2. `RunCompleted` 的 terminal ordering 已在 server hub 修正，完成後 mutation 也有更完整的拒絕路徑。
3. release archive 已改為 allowlist；本次審查實際執行 canary，結果為：

```text
PASS release-archive-canary: 5 canary file(s) planted,
349 archive entries checked, 3 candidate(s) denied by policy
(selection source: allowlist)
```

4. Docker host ports 已限制在 `127.0.0.1`。
5. 第五個場景 Red Ledger 的 JSON、fixture、golden receipt 與文件都存在；五份 golden receipt 的事件鏈、tip、receipt hash 均可自洽，Red Ledger 為 1,217 events、score 40.12、terminal `ScenarioCompleted`。

但 NullCity 的核心產品主張不是「有很多 package 和場景」，而是：

> 玩家在不完整資訊下做決策，而系統能可信地重建 truth、player knowledge、belief 與 action。

M9 目前仍可讓重新封裝過的 artifact 改寫玩家歷史；官方 CLI 又會在沒有 scenario replay 的情況下輸出 `PASS`。同時，官方 `verification-first` policy 雖然送出驗證命令，卻沒有把命令綁到 claim，導致附帶 benchmark 的 resolved claims 全部為 0。

因此這次不是要再加第六個場景，也不是再補 UI，而是必須進入一次純粹的 **M10 Integrity Closure**。

---

## 2. 審查方法與限制

本次完成：

- 解壓與路徑安全檢查。
- release boundary、RPC、artifact、receipt、benchmark policy、evidence chain 的原始碼審查。
- 對 artifact／receipt 進行重新計算 hash 後的 adversarial reseal。
- release archive canary 實際執行。
- 五份 golden receipt 的獨立 hash-chain／tip／receiptHash 檢查。
- ZIP 內時間順序、最終 source tree、benchmark report 與附帶 verify transcript 交叉比對。

本環境有 Node.js 22 與 TypeScript，但沒有可用的 pnpm workspace dependencies，且網路下載失敗。因此：

> **我沒有宣稱已重新執行附帶的 413 tests。**

附帶 transcript 可作為歷史證據，但不能替代對最終 ZIP tree 的重新驗證；尤其本次已證明 transcript 與最終樹不是同一個狀態。

---

# 3. Release blockers

## P0-01 — `verification-first` 並沒有真正驗證 claim

### 原因

`packages/benchmark/src/policies/verificationFirst.ts:97-107` 送出：

```ts
{
  commandName: "REQUEST_VERIFICATION",
  params: { teamId: team.teamId, target: claim.districtId }
}
```

但 `packages/server/src/rpc.ts:259-281` 只有在收到 `claimId` 時，才會建立 `verificationRequest`、呼叫 claim-targeting bridge，並在 command accepted 後保存 claim mapping。

因此 `{ teamId, target }` 只會派出一支 generic verification team，不會把結果綁到任何 claim。

### 現成證據

`data/benchmark-smoke/report.md` 的四個 `verification-first` run 都有 accepted verification request，但全部是：

| Scenario | 驗證命令數 | Resolved claims | Info gain |
|---|---:|---:|---:|
| black-river | 1 | 0 | `—` |
| glass-harbor | 1 | 0 | `—` |
| signal-zero | 2 | 0 | `—` |
| mirror-district | 2 | 0 | `—` |

也就是說，README 所說「驗證錯誤歸因、再改變決策」並沒有在官方 benchmark 發生。分數差異主要來自派遣策略，而不是 epistemic verification。

### 為什麼是 P0

這不是一個小 metric bug，而是 NullCity 最重要差異化功能在官方 benchmark 中實際斷線。若此時發布，會把「有 REQUEST_VERIFICATION 命令」錯當成「claim 已被驗證」。

### 必修

- 公開 `REQUEST_VERIFICATION` contract 應統一為 `{ teamId, claimId }`。
- district 由 server 根據 claim 解出，不讓 policy／client 同時傳 `target` 與 `claimId` 形成雙重真相。
- generic district inspection 若仍需要，另立不同 command，不得與 claim verification 共用名字。
- `verification-first` 必須送 `claimId`。
- 加入 server + benchmark E2E：至少產生一個 `VerificationResolved`，claim 進入 verified/refuted，`resolvedClaimCount > 0`，並在有 pre/post assessment 時產生非空 Brier／information gain。

---

## P0-02 — Full replay 只重播 truth，玩家歷史仍可被重寫

### 原因

`packages/simulation/src/artifact.ts:669-718` 的 `verifyByReplay()` 只比較：

- truth log hash
- truth event count
- terminal state digest
- score
- final tick

它沒有從 truth + public actions 重新生成 player event stream，也沒有把 player-side `CommandResult`、`ClaimUpdated`、`EvidenceRecorded`、`VerificationResolved` 與 truth outcome 逐一交叉綁定。

### 已建立的反例

我從 `data/m4-run-a.artifact.json`：

1. 保留 truth stream，其中 `cmd-1` 是 `CommandAccepted`。
2. 把 player stream 中同一個 `cmd-1` 的 `CommandResult` 從 `accepted` 改成 `rejected`。
3. 使用合法 schema 值補上 error code/detail。
4. 重新鏈結整條 player hash chain。
5. 更新 `playerLogHash` 並重新計算 `artifactHash`。

結果：

```text
truth_outcome_kind=CommandAccepted
original_player_state=accepted
forged_player_state=rejected
truth_log_hash_unchanged=true
state_digest_unchanged=true
forged_artifact_hash_self_consistent=true
```

這表示同一份 truth 與同一個 terminal state，可以配上一個被改寫過的「玩家當時被告知什麼」故事。

### 為什麼是 P0

Replay Lab 的價值不只是證明世界 deterministic，而是比較：

- 真正發生什麼
- 玩家當時看見什麼
- 玩家相信什麼
- 玩家因此做了什麼

如果 player history 只要整條重新 hash 就能改寫，artifact 只能證明「這份 JSON 內部自洽」，不能證明它對應到該 truth execution。

### 必修

建議升級 artifact format，而不是繼續在 v1 疊 patch：

- 新增 canonical public-action trace，記錄原始 player command intent、claimId、assessments 與 idempotency identity。
- command action 必須與 truth `CommandIssued`／accepted-or-rejected outcome 交叉綁定。
- 以 scenario + truth + public-action trace 重新執行 deterministic player projection。
- 比較完整 regenerated player event hash，而不只驗證提供者自行附上的 player chain。
- 驗證 `RunCompleted.claimCount`、`evidenceCount` 與重建後 terminal public state 相同。
- verifier 結果應分開顯示：`truthReplayChecked`、`playerReplayChecked`、`authenticityChecked`；沒有外部 trust root 時不可把 tamper evidence 稱為 authenticity。

---

## P0-03 — 官方 `null-city-run verify` 把 hash-only 檢查印成 `PASS`

### 原因

`packages/simulation/src/cli/run.ts:29-45`：

```ts
const result = verifyRunArtifact(artifact);
...
PASS run artifact ...
```

沒有傳入 compiled scenario，也沒有使用 `requireReplay: true`。

`compare` 在 `packages/simulation/src/cli/run.ts:99-102` 同樣把這種結果稱為 `independent verify PASS`。

artifact verifier 自己其實已在註解中承認：沒有 scenario 就無法重算 state digest；但 CLI 並未把這個限制呈現給使用者。

### 已建立的反例

我修改 artifact 的：

- `identity.scenarioDigest`
- `stateDigest`

兩者仍是合法 64 字元 SHA-256 hex，然後重新計算 `artifactHash`。所有內嵌 hash chain 保持不變，forge 後 artifact 自洽。

在 CLI 現行控制流下，沒有 scenario replay 能反駁這兩個新值，卻仍會輸出 `PASS`。

### 必修

- `run verify` 預設必須解析 artifact 對應 scenario，compile 後呼叫：

```ts
verifyRunArtifact(artifact, { scenario, requireReplay: true })
```

- 找不到 scenario 時只能輸出 `PARTIAL / INTEGRITY-ONLY`，不得輸出 `PASS`。
- 建議明確提供 `--integrity-only`，並使用不同 exit code，例如 2。
- `run compare` 也必須完整 replay；否則只能標示兩個未完全驗證的輸入。
- CLI 輸出必須明示 truth replay、player replay、signature/authenticity 三個獨立狀態。

---

# 4. 其他高優先問題

## P1-01 — Legacy `RunReceipt` 可改寫身份與終局 metadata

`packages/simulation/src/receipt.ts:114-164` 會檢查：

- receipt hash
- event stream chain/tip
- event count
- score digest／score total

但不會把以下欄位與 genesis、terminal 或 deterministic replay 綁定：

- `scenarioId`
- `seed`
- `finalTick`
- `stateDigest`
- handled/active incident summary

我保留整條 Red Ledger event stream，只把 metadata 改成：

```text
scenarioId: red-ledger → attacker-scenario
seed: 49314 → -777
finalTick: 450 → 1
stateDigest: replaced
```

再重算 receiptHash，receipt 仍是完整自洽格式。

**建議：** 不要同時維護兩個看似都能「完整驗證」的公開格式。將 `RunReceipt v1` 明確標示 legacy integrity receipt，移除 standalone full-verify 宣稱；或要求 scenario 並做 deterministic replay。主公開格式集中在新版 `.ncrun`。

---

## P1-02 — `verify-audit-repro` 沒有測到真正的 resealed forgery

`scripts/verify-audit-repro.mjs:109-125`：

- 改 `scenarioId` 後沒有重新計算 chain／artifactHash。
- 刪 `RunCompleted` 後也沒有重新封裝 artifactHash。

它得到的：

```text
forged identity rejected: PASS (artifactHash mismatch)
```

只證明 checksum 能抓到「改 JSON 後忘記重算 hash」，並沒有重現前一輪 audit 所描述的 attacker：**能重新計算所有非秘密 hash 的人**。

**必修：** adversarial tests 必須共用 production canonicalization／reseal helper，修改後重建所有可由攻擊者重算的 hash，並要求 verifier 以特定 semantic reason 拒絕；不能只接受任意 failure。

---

## P1-03 — 最終交付樹不是附帶 full verify 所驗的樹

ZIP 內的時間順序顯示：

| 項目 | ZIP timestamp |
|---|---|
| `data/evidence/m9-baseline-verify.txt` | 08:27 |
| `workpacks/M9-product-depth.md` | 08:28 |
| `data/benchmark-smoke/report.md` | 08:34 |
| `scenarios/red-ledger.json` | 08:46 |
| current `package.json` | 08:47 |
| `STATUS.md` | 08:47 |

附帶 baseline transcript 的 verify command 沒有 `verify:audit-repro`；目前 `package.json` 已有該 stage。

附帶 benchmark report 是：

- 4 scenarios × 3 policies = 12 runs
- 沒有 Red Ledger

目前 `verify:benchmark` 則宣告：

- 5 scenarios × 3 policies = 15 runs

附帶 test transcript 是 62 test files；最終 source tree 有 63 個 `*.test.ts[x]`。

因此可以判定：

> 413 tests 的 transcript 屬於較早的 tree，不能當成這份最終 ZIP 已完整通過的證據。

這不是說那些測試一定失敗，而是 release evidence chain 不成立。

### 必修

- 先 freeze 一個真實 Git commit。
- 在 exact commit 執行 `pnpm install --frozen-lockfile && pnpm verify`。
- evidence 必須寫入 commit SHA、tree hash、Node/pnpm versions、完整命令與 exit code。
- verify 完成後執行 `git diff --exit-code` 與 `git status --porcelain`；任何 source/docs/generated artifact 改動都使證據失效。
- release archive 必須從同一 commit 產生。
- 沒有 Git repository 時，不能假裝完成 fresh-clone／tag gate。

---

## P1-04 — README benchmark 數字與場景數已失真

README 仍寫「Three distinct scenarios」，但 repo 已有五個。

README 又宣稱表格是從 `data/benchmark-smoke/report.md` 原樣複製，但實際數值不同。例如：

| 項目 | README | 附帶 report |
|---|---:|---:|
| black-river / noop | -95.10 | -295.10 |
| black-river / verification-first | -44.76 | -144.76 |
| glass-harbor / verification-first | +14.51 | -15.49 |
| signal-zero / verification-first | -35.16 | -49.16 |

README 還宣稱 Glass Harbor 的優勢來自「debunking a false attribution」，但 report 顯示該 run 的 resolved claims 是 0。

**必修：** benchmark table 與 README excerpt 必須由同一份 machine-readable report 自動產生；CI 加一致性檢查。修好 claim verification 後，重新跑完整 15-run matrix，再更新敘事。

---

## P2-01 — Command Center 的 sample artifact fixture 仍保留舊 terminal ordering

`apps/command-center/test/fixtures/sample-run.artifact.json` 的最後三個 player events 是：

```text
287 PublicScoreChanged
288 RunCompleted
289 OwnTeamUpdated
```

這正是 M9 已宣稱修掉的舊錯誤。它可能只是 UI fixture，不直接代表 runtime 回歸，但表示 fixture lineage 與現行 artifact invariant 不一致。應重新生成，並要求所有 artifact fixture 先通過 production verifier。

---

# 5. Red Ledger 本身的判定

Red Ledger 作為第五個 scenario，**內容層面可以保留**：

- scenario JSON 存在。
- registry／fixtures／golden receipt 有接線。
- receipt 事件鏈、tip、receiptHash 自洽。
- terminal 為 `ScenarioCompleted`。
- golden score 40.12。

但它目前還不能被稱為完整 benchmark-validated scenario，因為：

1. 附帶 benchmark report 沒有它。
2. 最終 Red Ledger tree 沒有一份對應的 full verify transcript。
3. `verification-first` 的 claim-resolution 路徑本身仍斷線。

因此標籤應是：

> **Scenario candidate: accepted. Release evidence: incomplete.**

---

# 6. 做得好的部分

這一輪值得肯定，且不應被下一輪重寫掉：

- 公開 snapshot resume boundary 已被正確縮小。
- server completed-run immutability 與 terminal ordering 有明顯進步。
- artifact 已補上 singleton genesis/terminal、identity cross-binding、command trace anomaly detection、truth state replay。
- release archive 改為 allowlist，且本次 canary 實跑通過。
- Docker host exposure 已限 loopback。
- `STATUS.md` 明確寫 `NOT READY TO TAG`，沒有再把 Docker/CI blocked 偷換成 PASS。
- Red Ledger 具備完整 scenario 交付物，而不是只有 README 宣告。
- 專案產品感、repo 結構與展示能力已達 GitHub Alpha 檯面。

這也是為什麼結論不是重寫，而是**停止產品擴張，收掉完整性缺口**。

---

# 7. 最終裁決

| 項目 | 判定 |
|---|---|
| 可否保留 M9 Red Ledger 工作 | **可以** |
| 可否推 GitHub development branch | **可以** |
| 可否標示 Alpha | **可以** |
| 可否建立 RC release tag | **不可以** |
| 可否發布 stable `v0.1.0` | **不可以** |
| 前一輪 public resume P0 | **主要修正成立** |
| 前一輪 terminal ordering P0 | **主要修正成立** |
| artifact truth replay | **有進步，但 CLI 預設未啟用** |
| artifact player-history verification | **FAIL** |
| verification-first epistemic loop | **FAIL** |
| final-tree release evidence | **FAIL** |
| release archive hygiene | **PASS（本次實跑）** |
| Docker runtime smoke | **仍未驗證** |

NullCity 現在缺的不是更多功能，而是讓以下三句第一次同時成立：

1. **官方 verify 說 PASS 時，真的做過 full replay。**
2. **truth 與 player history 不能各自重新封裝後講兩個不同故事。**
3. **verification-first 的「verification」真的會解決 claim，而不只是派一台車出去。**

修完 M10、在 exact Git commit 上重新產生完整證據後，才值得再談 `v0.1.0-rc.1`。
