# NullCity 技術審查報告

**審查日期：** 2026-08-07  
**審查對象：** `NullCity-pack.zip`  
**結論：** **FAIL — 目前不可公開發佈，也不可宣稱 hidden-information、可靠 snapshot/resume 或不可竄改 replay 已成立。**

---

## 1. 執行摘要

NullCity 不是空殼。它已經具備清楚的 monorepo 分層、事件鏈、種子式 PRNG、scenario schema、simulation engine、REST / WebSocket server、snapshot、replay，以及一批有內容的測試。架構方向是對的，而且程式碼的可讀性與命名大致良好。

但這一版的核心問題不是「還缺幾個邊角功能」，而是三項主要產品承諾目前都可被實際反例打破：

1. **玩家不可讀 truth**：server 的 events、snapshot 與 WebSocket 直接送出完整 truth。
2. **snapshot/resume 必須 deterministic**：鏈式事件後做 snapshot，續跑分數與 event hash 會分叉。
3. **完成結果必須封存**：到 tick 540、phase 已是 completed 後，仍能接受命令並修改分數、狀態與 event hash。

因此這包適合定義為：**有實質骨架的 M0 / alpha prototype**，不適合定義為 release candidate。

---

## 2. 審查範圍與限制

### 已完成

- ZIP 結構與 path traversal 檢查。
- 原始碼、schema、server、snapshot、replay、scoring 與測試靜態審查。
- 常見憑證、private key 與非文字檔掃描。
- 針對核心 invariant 撰寫並執行重現案例。
- 執行專案內建的 simulation/server verify entrypoints。

### 限制

審查環境沒有可直接使用的 `pnpm`，且無法從 registry 安裝鎖定依賴，因此 **沒有在正式 zod/ws/vitest/eslint 依賴下完成原始的 `pnpm verify`**。

為了執行核心程式路徑，我只在獨立審查副本中加入最小 Zod / WebSocket audit shim，並用現有 Node + ts-node 執行專案自己的 verify scripts 與重現腳本。這足以重現 engine/RPC 的邏輯缺陷，但不能替代正式依賴環境下的完整 lint、typecheck、Vitest 與 build gate。

---

## 3. Gate 結果

| Gate | 結果 | 說明 |
|---|---:|---|
| Archive safety | PASS | 104 entries，未發現 ZIP path traversal；無二進位 payload。 |
| Secret hygiene | PASS* | 未發現常見 access key、private key、明文 credential pattern；不是完整 secret-scanner 保證。 |
| Fresh-run determinism | PASS* | 專案內建 verify 的同 seed、不同 seed、replay checks 通過；使用 audit shim。 |
| Hidden-information boundary | **FAIL** | REST events、snapshot、WS replay/live event 全部洩漏 truth。 |
| Snapshot immutability | **FAIL** | `snapshot().world` 是 live reference。 |
| Snapshot/resume equivalence | **FAIL** | chain 後續跑分數與 hash 分叉。 |
| Finalization integrity | **FAIL** | completed 後仍可接受命令與改分。 |
| Route correctness | **FAIL** | weighted graph 會回傳非最短路徑。 |
| Event-chain invariants | **FAIL** | 可接受任意 anchor、序號跳號、跨 session、tick 倒退。 |
| Scenario semantic integrity | **FAIL** | 僅做結構驗證，缺 reference/uniqueness/cycle 等語意檢查。 |
| Public-release packaging | **FAIL** | 無 README、LICENSE file、CI、start script；build 產物未被 exports 使用。 |

---

# 4. 阻斷級問題

## P0-01 — Hidden-information 模型被 transport 完整繞過

### 證據

`buildPlayerView()` 明確宣稱 truth 不會洩漏：

- `packages/server/src/player-view.ts:53-60`

但 server 同時公開：

- 原始事件流：`packages/server/src/rpc.ts:190-201`
- 完整 snapshot：`packages/server/src/rpc.ts:204-207`
- WebSocket live raw events：`packages/server/src/ws.ts:55-58`
- WebSocket hello catch-up raw events：`packages/server/src/ws.ts:68-77`

engine 每 tick 把完整 district truth、teams、routes 與 resources 放進 `SystemStateChanged`：

- `packages/simulation/src/engine.ts:241`
- `packages/simulation/src/engine.ts:313-330`

真實事件發生時，也會立即發出 `TrueIncidentOccurred`：

- `packages/simulation/src/engine.ts:440-479`

### 實際重現

在 tick 12，尚未等待 observation delivery，就能從 `/events` 讀到：

```json
{
  "incidentId": "substation_fault",
  "district": "industrial",
  "severity": 45
}
```

同時可從 event 或 snapshot 讀到 Industrial 的完整 truth，例如 `power: 98`、`communications: 82` 等。

### 影響

這不是一般資訊洩漏，而是直接破壞遊戲／模擬的核心機制。任何 player client 都能跳過 delayed/noisy observations，取得 omniscient view。

### 必須修正

- 將內部 `TruthEvent` 與外部 `PlayerEvent` 分成不同型別與不同 event store/API。
- player transport 永遠不得回傳 raw snapshot 或 raw event log。
- snapshot 應是 admin/server-only capability，且至少具備授權與範圍控制。
- 對 REST、WS hello、WS live broadcast 建立相同的 redaction gate。
- 加入「所有公開 endpoint 不得出現 `TrueIncidentOccurred`、truth district values、internal state」的黑箱測試。

---

## P0-02 — Snapshot/resume 並不 deterministic，且 snapshot 不是 snapshot

### 缺失一：`chainedCount` 未序列化

`chainedCount` 影響 scoring：

- 欄位：`packages/simulation/src/engine.ts:133`
- scoring 使用：`packages/simulation/src/engine.ts:842-850`

但 `EngineSnapshotData` 沒有該欄位，constructor 也未恢復：

- snapshot interface：`packages/simulation/src/engine.ts:28-50`
- resume constructor：`packages/simulation/src/engine.ts:142-160`
- snapshot output：`packages/simulation/src/engine.ts:1299-1322`

### 實際重現

在第一個 chained incident 發生後的 tick 108 snapshot：

| 路徑 | 最終分數 | 最終 event hash |
|---|---:|---|
| uninterrupted | -95.1 | `68b00c…fe01` |
| resumed | -70.1 | `3d0eff…5395` |

同一 scenario、seed、session、同一 snapshot 起點，結果分叉。

內建 snapshot verify 沒抓到，是因為它固定使用 golden path 的 tick 200，而該路徑在 snapshot 時 `IncidentChained` 數量為 0：

- `packages/simulation/src/cli/verify.ts:8-10,121-155`
- `packages/simulation/test/snapshot-resume.test.ts:24-41`

### 缺失二：snapshot world 是 live reference

`snapshot()` 直接回傳：

- `world: this.world` — `packages/simulation/src/engine.ts:1310`

constructor resume 也直接接手同一物件：

- `this.world = options.resume.world` — `packages/simulation/src/engine.ts:143-145`

實測原 engine 從 tick 1 前進到 tick 2 時，先前取得的 snapshot 也自行從 tick 1 變成 tick 2。

### 缺失三：server 接受未驗證的任意 resume

- `packages/server/src/rpc.ts:105-116`
- `packages/server/src/hub.ts:76-91`

沒有呼叫 `validateSnapshot()`，也沒有 schema 驗證或確認 snapshot 的 `sessionId/scenarioId/seed` 與 create request 一致。實測可把 `original-session / seed 123` 的 snapshot 以 `forged-session / seed 999` 啟動，之後 event log 同時包含兩個 sessionId，現有 chain verifier仍判定 valid。

### 必須修正

- Snapshot schema 必須包含每一個影響未來輸出的 state/counter；建議建立明確的 versioned `EngineStateV2`，不要手工漏欄位。
- snapshot 建立時使用深拷貝或 immutable state；resume 也必須 clone/deserialize。
- server resume 必須先做 runtime schema validation、`validateSnapshot()`、identity binding、scenario hash binding。
- 建立 property test：每個 tick、每種事件狀態、每個 command 邊界做 snapshot/resume equivalence。
- 測試 snapshot 本身在原 engine 繼續執行後必須 byte-identical。

---

## P0-03 — Scenario 完成後仍能接受命令並改寫最終結果

`step()` 在 final tick 設定 completed 並發出 `ScenarioCompleted`：

- `packages/simulation/src/engine.ts:226-252`

但 `submitCommand()` 沒有 phase guard：

- `packages/simulation/src/engine.ts:875-940`

### 實際重現

在 tick 540、phase=`completed` 後送出 `REROUTE_POWER`：

- command：`accepted`
- score：`-95.1 → -145.17`
- Central power：`96 → 86`
- Medical power：`96 → 100`
- event count：`3264 → 3270`
- final event hash 改變

phase 與 tick 仍維持 completed / 540，且不會再發出新的 `ScenarioCompleted`。

### 影響

最終分數與封存 hash 可以在比賽／模擬結束後任意改寫。任何 leaderboard、replay receipt 或結果簽章都失去意義。

### 必須修正

- `submitCommand()` 第一層檢查 `world.phase === "completed"`，只允許 deterministic rejection，禁止任何 mutation。
- `ScenarioCompleted` 後凍結 final result、terminal hash 與 world state。
- 加入所有 command 的 post-completion parameterized test。

---

# 5. 高優先問題

## P1-01 — 加權路徑演算法不是 Dijkstra，會選錯路

`shortestTravelPath()` 使用 FIFO queue，並在節點第一次出隊時標記 visited：

- `packages/simulation/src/graph.ts:39-69`

這只適用於等權 BFS，不適用於 weighted graph。

### 重現

關閉 `central-riverside` 與 `central-north` 後：

- 現行演算法：Central → Industrial → Riverside，13 ticks
- 真正最短：Central → Medical → North → Riverside，12 ticks

### 修正

使用 min-priority queue 的 Dijkstra；只有在節點以目前最小距離 pop 時才能 finalize。加入隨機 graph 與 reference implementation 對照測試。

---

## P1-02 — Event-chain verifier 只驗 hash link，沒有驗「同一條合法事件鏈」

- `packages/contracts/src/canonical.ts:55-81`

它：

- 以第一筆事件自己提供的 `previousHash` 當可信 anchor；
- 不要求第一筆 sequence=0；
- 不要求 sequence 連續；
- 不要求 sessionId 一致；
- 不要求 tick 單調；
- 不驗 event kind/payload schema。

實測兩筆事件可使用 sequence `7 → 99`、session `A → B`、tick `100 → 2`、attacker-chosen anchor，重新計算 hash 後仍得到 `validChain: true`。

此外 `replayEventLog()` 沒有先驗證傳入 event log；它只抽出 `CommandIssued` 重新跑 scenario：

- `packages/simulation/src/replay.ts:14-41`

因此它實際上是「command schedule re-simulation」，不是把已給事件作為可信 replay source。

### 修正

建立 `verifyEventLog(events, trustedRoot)`：驗 genesis、sequence、session、tick、schema、terminal hash。若需要 authenticity，必須有外部可信 terminal hash、MAC 或 signature；單純重新 hash 全鏈不能阻止攻擊者重算。

---

## P1-03 — WebSocket 的 session scope 可被 RPC params 繞過

文件稱 socket 綁定 `/ws/:sessionId`：

- `packages/server/src/ws.ts:16-27`

但 RPC message 直接把 client 提供的 params 丟給全域 `handleRpc()`：

- `packages/server/src/ws.ts:80-94`

連到 session A 的 socket 可以送 `{ params: { sessionId: "B" } }` 操作 B，甚至執行 list/create/delete。即使目前沒有 auth，這仍違反 transport 自己宣告的 scope，也會讓未來加 auth 時留下 confused-deputy 漏洞。

另有 robustness 問題：

- malformed percent encoding 可讓 `decodeURIComponent()` throw：`packages/server/src/ws.ts:38-53`
- JSON `null` 解析成功後存取 `message.type` 會 throw：`packages/server/src/ws.ts:60-68`
- 未設定明確 `maxPayload`：`packages/server/src/ws.ts:29-30`

### 修正

socket-level RPC 僅允許 session-local op，並由 server 強制覆寫 sessionId；對 message 做 runtime schema；upgrade/message callback 全部做 error boundary；設定 payload、rate、advance/session 上限。

---

## P1-04 — Scenario schema 只有結構檢查，沒有語意完整性

- `packages/scenario-schema/src/index.ts:153-193`

缺少：

- district/team/route/incident/source/observation ID uniqueness；
- team start district、route endpoints、incident/effect district 必須存在於 scenario districts；
- observation sourceId/incidentId reference；
- chain source existence、self-cycle、cycle detection；
- supported schemaVersion 精確比對；
- corruption probability sum ≤ 1；
- totalTicks、陣列長度、effect count 等上限。

重複 ID 會在建 world 時被 object assignment / `Object.fromEntries` 靜默覆蓋：

- `packages/simulation/src/world.ts:46-76`
- `packages/simulation/src/engine.ts:139`

### 修正

Zod structural parse 後增加 `superRefine` 或獨立 semantic compiler，將 scenario 編譯成已解 reference、不可變、ID 唯一的 internal model。

---

## P1-05 — `session.advance` 最後一 tick 回報少 1

- `packages/server/src/rpc.ts:169-187`

`step()` 在確實完成 final tick 後回傳 false，因此 while body 不會累加 `advanced`。

實測請求 540 ticks：

```json
{ "tick": 540, "advanced": 539, "completed": true }
```

應以 before/after tick 差計算，或改變 `step()` 回傳語意。

---

## P1-06 — Player view 本身仍過度揭露 truth

即使移除 raw event/snapshot bypass，現有 masking 邏輯仍過寬：

- team 只要「被下令去某 district」，目標 district 立即變 known：`packages/server/src/player-view.ts:75-79`
- known 後直接顯示七項 **當下精確 truth**：`packages/server/src/player-view.ts:82-89`
- 任一 observation 到達就揭露該 district 所有屬性，不只 observation 涵蓋資訊：`packages/server/src/player-view.ts:68-73,82-89`

這使 noisy/partial information 模型退化成「收到一份報告後解鎖 omniscient district dashboard」。

verification 也只按 incident district 批次把所有 report 標成 verified：

- `packages/simulation/src/engine.ts:826-837`

它不驗 observation content、claim 或 corruption，且沒有 verification event。

### 修正

Player view 應由 observations 的 claim/evidence 投影，不可直接讀 truth state。每個 attribute 應有 known/estimated/confidence/as-of tick；verification 必須針對 claim，並產生可審計事件。

---

## P1-07 — Decision-delay scoring 會漏罰或用到事件發生前的 action

- `packages/simulation/src/engine.ts:1271-1295`

問題：

- 只記 `firstActionTickByDistrict`，不是 per incident；同 district 後來事件可能沿用事件發生前的 action。
- 沒有 action 的 incident 直接 `continue`，反而不會產生 delay penalty。
- dispatch issued tick 就算 action，不是 arrival / effect tick。
- `updateDecisionDelay()` 只在 action 發生時重算，不隨時間累積。

同時 `ScoreState` 名稱與實際值不一致：

- `eventsHandled/eventsMissed` 存的是加權分數，不是事件數。
- `decisionDelayTicks` 存的是 penalty points，不是 ticks。
- `packages/simulation/src/score.ts:55-82`

### 修正

建立 per-incident response timeline，明確定義 acknowledged/dispatched/arrived/effective 四種時間，score 欄位名稱與單位要一致。

---

## P1-08 — Build / release packaging 尚未成立

原始包沒有：

- README
- LICENSE file（雖然 root package 宣告 MIT）
- CI workflow
- SECURITY / CHANGELOG
- production start script
- API / threat model / scenario authoring docs

`docs/`、`apps/`、`data/` 皆為空目錄。

各 package 的 `build` 輸出到 `dist`，但 `main/types/exports` 仍指向 `src/index.ts`：

- 例如 `packages/server/package.json:6-13`
- `packages/server/tsconfig.json` 的 outDir 是 `dist`

因此 build artifact 沒有被 package exports 使用；一般 Node production runtime 也不能在沒有 TS loader 的情況下直接執行 exported `.ts`。

### 修正

- exports 指到 `dist/index.js` / `dist/index.d.ts`。
- 加入 clean/build/start/pack smoke test。
- 在乾淨 temp dir 安裝 tarball 後啟動 server 做 health + scenario smoke test。
- 補 README、LICENSE、架構圖、API 與安全邊界說明。

---

# 6. 其他中低優先問題

1. `saveSnapshotAtomically()` 文件寫了 flush，但實作只有 write + rename，沒有 fsync；固定 `.tmp` 名稱也不支援並行 writer。`packages/simulation/src/snapshot.ts:60-69`
2. `parseSnapshot("null")` 會走到非預期 TypeError，而不是受控 structure error。`packages/simulation/src/snapshot.ts:28-41`
3. chain incident 已 resolved 後可能再次 activate，因為只跳過 `target.active`。`packages/simulation/src/engine.ts:391-400,440-443`
4. relative observation 到期時不確認 incident 仍 active；absolute observation 則會確認，語意不一致。`packages/simulation/src/engine.ts:736-758`
5. backup generator 與 communication priority duration 有邊界 off-by-one 風險。`packages/simulation/src/engine.ts:789-823,1115-1130,1219-1243`
6. route reopen 沒清空 `closedAtTick/closedBy`。`packages/simulation/src/engine.ts:1156-1158`
7. `ActionAppliedPayload.target` 型別是 DistrictId，但 route action 會把 routeId cast 成 DistrictId。`packages/contracts/src/events.ts:145-151`
8. `SystemStateChangedPayload` contract 與實際 payload 不一致。`packages/contracts/src/events.ts:153-158`
9. `finalStateDigest()` 名稱像 hash，但其實回傳 canonical JSON，且省略 resources、incidents、orders、observations、PRNG 與多個 internal fields。`packages/simulation/src/engine.ts:287-310`
10. 初始 score 是 0，第一 tick 或第一個 accepted command 後才重算；同一 tick-0 truth 可有不同 score presentation。`packages/simulation/src/world.ts:13-27`
11. `SessionHub.broadcast()` 不隔離 subscriber exception；單一 subscriber 可在 mutation 後中斷 request flow。`packages/server/src/hub.ts:110-118`
12. scenario loader cache 回傳同一 mutable object reference。`packages/server/src/scenarios.ts:28-38`

---

# 7. 做得好的地方

- 模組邊界清楚：contracts / schema / simulation / fixtures / server。
- TypeScript 使用 `strict`、`noUncheckedIndexedAccess`。
- simulation 沒有直接使用 `Math.random()`、`Date.now()` 等非 deterministic source。
- PRNG state 被納入 snapshot 概念。
- event payload 在 hash 前有 canonical serialization，基本 hash-link 實作清楚。
- scenario filename 有 allowlist，並有限制 scenario file size。
- REST body 有 1 MiB 上限，且拒絕非 object JSON。
- 測試不是裝飾：原包有 21 個 test TS files、約 1,803 行測試。
- 未發現常見 secret pattern、path traversal 或可疑 binary。

這些代表專案值得修，不是應該丟掉重寫；但需要先修 invariant，而不是繼續加 UI 或 scenario。

---

# 8. 建議修復順序

## M1 — Truth boundary 與 finalization

1. 拆分 truth/public event model。
2. 封鎖 player 對 raw snapshot/event 的存取。
3. completed 後禁止任何 mutation。
4. 建立黑箱 transport leak tests。

**完成條件：** player client 無法從任何 REST/WS response 推導未觀測 truth；terminal hash 在完成後不可變。

## M2 — Snapshot / replay integrity

1. 建立完整 versioned snapshot schema。
2. clone/serialize snapshot，消除 alias。
3. 綁定 session/scenario/seed/scenario hash。
4. 強化 event log verifier 與 trusted root。
5. 對每個 tick/state 做 resume equivalence matrix。

**完成條件：** 任意 tick snapshot/resume 的 final event log 必須 byte-identical；篡改或 identity mismatch 必須在 engine 建立前被拒絕。

## M3 — Simulation correctness

1. 改用真正 Dijkstra。
2. 修 decision-delay model。
3. 加 scenario semantic compiler。
4. 修 incident reactivation、observation lifecycle、duration edges。

**完成條件：** property tests/reference model 全通。

## M4 — Productionization

1. 正式依賴下跑 lint/typecheck/test/build。
2. 修 dist exports 與 production start。
3. CI + package install smoke test。
4. README/LICENSE/threat model/API docs。

**完成條件：** clean checkout 一個命令可 install、verify、build、start；新環境可重現。

---

# 9. 最終判定

**現況標籤：Alpha / architectural prototype**  
**公開 GitHub：可作為 WIP 展示，但 README 必須明確標示 prototype 與已知限制。**  
**正式 release / demo competition /可信 replay：不可放行。**

最關鍵的修正不是補更多測試數量，而是把測試改成攻擊「主張本身」：

- truth 是否真的無法從任何 surface 取得；
- snapshot 是否在所有狀態都能續跑一致；
- completed 是否真的 immutable；
- event chain 是否有可信根與合法事件序列；
- path/scoring 是否能由獨立 reference model 驗證。
