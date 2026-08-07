# NullCity M10 Integrity Closure — Cursor 工作包

這不是新功能 milestone。

M9 已有足夠產品深度；M10 的唯一任務，是讓 NullCity 的公開驗證主張與實際控制流一致。

## 本輪只能處理

1. `REQUEST_VERIFICATION` 必須真正綁到 claim。
2. `.ncrun` full verification 必須同時重建 truth 與 player history。
3. 官方 CLI 不得把 hash-only 檢查稱為 PASS。
4. legacy receipt 必須降級／淘汰，或補上 scenario replay。
5. adversarial reproduction 必須在重新封裝所有可重算 hash 後仍能抓到 semantic forgery。
6. 重新產生五場景 benchmark、README、fixtures 與 exact-commit evidence。

## 明確禁止

- 不新增第六個 scenario。
- 不改視覺主題、不重做 Command Center。
- 不新增 database、auth、cloud、multiplayer。
- 不改 simulation scoring，除非為修復本包 finding 所不可避免，且需獨立 ADR。
- 不以「測試總數增加」代替反例被消滅的證據。
- 不把 Docker／CI／fresh clone 的 BLOCKED 寫成 PASS。

## 開工順序

1. 閱讀 `00_RELEASE_AUDIT.md`。
2. 在 Cursor Plan Mode 貼入 `01_CURSOR_M10_KICKOFF.md`。
3. 先重現 `repro/nullcity-m9-adversarial-reproduction.mjs` 所描述的四條問題。
4. 每個 finding 必須有一個 before-fail／after-pass regression test。
5. 完成後逐項跑 `03_ACCEPTANCE_GATES.md`，任何一條不成立都不得寫 READY TO TAG。
