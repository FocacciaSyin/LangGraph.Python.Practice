# 提交前自動審查外掛設計

## 目標

新增專案本機的 OpenCode 外掛。當 OpenCode 代理嘗試執行一般 staged commit 時，外掛必須取消該次提交，等待目前 session 進入 idle，再於同一個 session 自動呼叫 OpenCode 內建的 `/review`。審查完成且 staged 內容未改變後，代理可重新執行一次提交。

## 範圍

- 將外掛安裝於 `.opencode/plugins/commit-review.ts`。
- 僅攔截透過 OpenCode Bash 工具執行的直接 `git commit` 命令。
- 使用 OpenCode 原有的內建 `/review`，不覆寫其提示詞或輸出格式。
- 僅支援先以 `git add` 建立 staged 內容的一般提交。
- 第一版不支援 `git commit -a`、`git commit -am`、`git commit --amend` 或 `git commit --allow-empty`。
- 不攔截 OpenCode 外部、Git 別名、指令碼或其他間接機制建立的提交。
- 不解析或判斷 `/review` 的自然語言結果。
- 不自動重放原本遭取消的 commit。

## 重要限制

OpenCode 內建 `/review` 沒有固定的 `PASS`、`FAIL`、JSON 或 exit code。外掛只能透過 `command.executed` 事件確認命令已完成，無法可靠判斷審查結果是否「不需調整」。

因此代理必須閱讀 `/review` 結果：

- 沒有需調整項目時，代理可重新執行 commit。
- 發現問題時，代理必須先修正並重新 stage；staged fingerprint 改變後，下一次 commit 會重新觸發 `/review`。

外掛提供流程約束，但不宣稱能以機器方式驗證所有審查問題皆已修正。

## 架構

外掛由命令偵測器、staged fingerprint 計算器，以及依 `sessionID` 隔離的狀態機組成。它註冊三類 OpenCode hooks。

### `tool.execute.before`

當 Bash 工具即將執行直接的一般 `git commit` 時：

1. 檢查是否含第一版不支援的 commit 旗標；若有，直接拒絕並說明限制。
2. 計算目前 staged 內容的 SHA-256 fingerprint。
3. 若 session 具有相同 fingerprint 的單次 `reviewed` 授權，消耗授權並允許 commit。
4. 否則取消 commit，記錄 `pending-review` 狀態，等待 session idle。
5. 若該 session 已處於 `pending-review` 或 `reviewing`，維持阻擋但不重複排程 review。

### `event`：`session.status` 與 `session.idle`

收到目前 session 的 `session.status: idle` 或 OpenCode 1.17.18 相容事件 `session.idle`，且狀態為 `pending-review` 時：

1. 先將狀態改為 `launching`，避免兩種 idle 事件或重複事件觸發多次 review。
2. 使用 `client.session.command()` 在相同 session 呼叫內建命令：

```ts
client.session.command({
  path: { id: sessionID },
  body: { command: "review", arguments: "" },
})
```

外掛不得在 `tool.execute.before` 內直接呼叫 review，因為當下 session 尚處於 busy，可能造成 `SessionBusyError` 或重入問題。

### `command.execute.before` 與 `command.executed`

`command.execute.before` 在任何 `/review` 開始前記錄當下 staged fingerprint，因此自動與手動執行的內建 `/review` 都能納入同一流程。

收到對應 session 的 `command.executed` 且命令為 `review` 時：

1. 重新計算 staged fingerprint。
2. 若 fingerprint 與 review 開始前相同，將狀態設為 `reviewed`。
3. 若 fingerprint 已改變，不建立授權；下一次 commit 必須重新 review。

## 狀態模型

每個 `sessionID` 最多保存一筆狀態：

- `pending-review`：commit 已取消，等待 session idle。
- `launching`：已收到 idle 事件，正在啟動內建 `/review`。
- `reviewing`：內建 `/review` 已開始，保存 review 開始前的 fingerprint。
- `reviewed`：內建 `/review` 已完成，保存可使用一次的 fingerprint。
- 無狀態：下一次 commit 必須重新 review。

狀態規則：

- 不同 session 不共享授權。
- 狀態只存在記憶體，不持久化至磁碟。
- OpenCode 重新啟動後，所有授權清除。
- `reviewed` 授權只能使用一次。
- commit 即使執行失敗，授權仍已消耗，下一次嘗試需要重新 review。
- staged fingerprint 改變時，既有授權立即失效。

## 資料流程

1. 代理嘗試執行 `git commit`。
2. 外掛計算 staged fingerprint，取消 commit 並記錄 `pending-review`。
3. 目前 agent turn 結束，OpenCode 發出 `session.status: idle` 與／或 `session.idle`。
4. 外掛將狀態改為 `launching`，並透過 `client.session.command()` 呼叫同 session 的內建 `/review`；`command.execute.before` 隨後將狀態改為 `reviewing`。
5. OpenCode 執行內建審查工作流程。
6. `command.executed` 確認 review 完成。
7. staged fingerprint 未改變時，外掛建立單次 `reviewed` 授權。
8. 代理閱讀 review 結果。
9. 若不需調整，代理重新執行相同 staged 內容的 commit，外掛消耗授權並允許提交。
10. 若需調整，代理修正並重新 stage；fingerprint 改變，下一次 commit 重新啟動完整 review 流程。

## 命令偵測

第一版辨識直接的一般 `git commit`，包含 `git commit -m "message"` 等 commit 引數。偵測必須避免將註解、引號字串或其他命令引數內的 `git commit` 文字誤判為提交。

若直接 commit 命令包含下列模式，外掛明確拒絕且不排程 review：

- `-a`
- `-am` 或其他包含 `a` 的短旗標組合
- `--all`
- `--amend`
- `--allow-empty`

## 錯誤處理

- staged fingerprint 計算失敗時，採取封閉式失敗並阻擋 commit。
- 自動呼叫 `client.session.command()` 失敗時，清除 `reviewing` 狀態、維持 commit 阻擋，並透過 OpenCode TUI toast 與應用程式 log 顯示錯誤。
- `/review` 執行期間若 staged 內容改變，不建立 `reviewed` 授權。
- 同一 session 重複嘗試 commit 時，不得重複啟動 `/review`。
- 外掛內部錯誤不得無聲允許 commit。
- 非 commit 命令完全不受影響。

## 驗證

驗證以下行為：

1. 第一次一般 staged commit 會遭取消。
2. session idle 後，自動在同一 session 呼叫內建 `/review`。
3. session 尚未 idle 時不會直接呼叫 `/review`。
4. `pending-review` 或 `reviewing` 期間的重複 commit 不會建立重複 review。
5. `command.executed` 確認 review 完成後，相同 staged fingerprint 可提交一次。
6. staged 內容在 review 前後改變時，不建立授權。
7. staged 內容在授權後改變時，既有授權失效並重新觸發 review。
8. 不同 session 不共享 review 狀態或授權。
9. 使用者手動執行內建 `/review` 也可授權相同 staged fingerprint。
10. `-a`、`-am`、`--all`、`--amend` 與 `--allow-empty` 會遭明確拒絕。
11. 自動 review 或 fingerprint 計算失敗時採取封閉式失敗。
12. 非 commit Bash 命令不受影響。
13. OpenCode 重新啟動後能載入專案本機外掛，且記憶體狀態已清除。
