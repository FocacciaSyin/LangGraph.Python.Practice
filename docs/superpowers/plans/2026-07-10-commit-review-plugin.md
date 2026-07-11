# 提交前自動審查外掛實作計畫

> **給代理工作者：** 必要的子技能：使用 superpowers:subagent-driven-development（建議）或 superpowers:executing-plans，逐項實作本計畫。各步驟使用核取方塊（`- [ ]`）追蹤進度。

**目標：** 建立專案本機 OpenCode 外掛，在一般 staged commit 首次嘗試遭取消後，自動於同一 session 呼叫內建 `/review`，並讓相同 staged fingerprint 取得一次提交授權。

**架構：** 純函式解析器辨識直接 commit 與不支援旗標；可注入相依項目的狀態機處理 Bash hook、session idle、review 開始與 `command.executed`。Bun runtime adapter 計算 staged diff 的 SHA-256 fingerprint，OpenCode SDK adapter 呼叫內建 review 並回報錯誤。

**技術棧：** TypeScript、OpenCode plugin hooks、OpenCode SDK、Bun runtime 與 test runner、Git CLI

## 全域限制

- 外掛路徑固定為 `.opencode/plugins/commit-review.ts`。
- 測試路徑固定為 `tests/opencode/commit-review.test.ts`，避免 OpenCode 將測試檔誤載為外掛。
- 使用原有內建 `/review`，不得覆寫其提示詞或輸出格式。
- 僅支援一般 staged commit；拒絕 `-a`、`-am`、`--all`、`--amend` 與 `--allow-empty`。
- 不解析 review 自然語言結果，也不自動重放 commit。
- 狀態依 `sessionID` 隔離、只存在記憶體，授權僅使用一次。
- fingerprint 或自動 review 失敗時必須 fail closed。
- 不新增 npm 相依套件或專案 `package.json`。
- 除非使用者明確要求，否則不得建立 Git commit。

---

## 檔案結構

- 建立 `.opencode/plugins/commit-review.ts`：命令解析、狀態機、Git fingerprint、OpenCode SDK adapter 與預設外掛 export。
- 建立 `tests/opencode/commit-review.test.ts`：Bun 單元測試與暫存 Git repository 整合測試。
- 修改 `docs/superpowers/plans/2026-07-10-commit-review-plugin.md`：僅在實作發現規格歧義時同步修正計畫。

### Task 1：解析 Git Commit 與不支援模式

**檔案：**
- 建立：`.opencode/plugins/commit-review.ts`
- 建立：`tests/opencode/commit-review.test.ts`

**介面：**
- 產出：`inspectGitCommit(command: string): CommitInspection`
- 產出型別：`CommitInspection = { isCommit: false } | { isCommit: true; unsupportedFlag?: string }`

- [ ] **步驟 1：撰寫失敗測試**

建立 `tests/opencode/commit-review.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { inspectGitCommit } from "../../.opencode/plugins/commit-review"

describe("inspectGitCommit", () => {
  test.each([
    "git commit",
    'git commit -m "message"',
    "git -C . commit -m test",
    "uv run pytest; git commit -m test",
    "uv run pytest && git commit",
  ])("辨識直接 commit：%s", (command) => {
    expect(inspectGitCommit(command)).toEqual({ isCommit: true })
  })

  test.each([
    ["git commit -a -m test", "-a"],
    ["git commit -am test", "-am"],
    ["git commit --all -m test", "--all"],
    ["git commit --amend", "--amend"],
    ["git commit --allow-empty -m test", "--allow-empty"],
  ])("拒絕不支援模式：%s", (command, unsupportedFlag) => {
    expect(inspectGitCommit(command)).toEqual({ isCommit: true, unsupportedFlag })
  })

  test.each([
    "git status",
    "git log --grep=commit",
    'echo "git commit"',
    "# git commit",
    'echo "done; git commit"',
  ])("忽略非 commit：%s", (command) => {
    expect(inspectGitCommit(command)).toEqual({ isCommit: false })
  })
})
```

- [ ] **步驟 2：確認測試因缺少 module 而失敗**

執行：

```powershell
bun test tests/opencode/commit-review.test.ts
```

預期：FAIL，指出 `.opencode/plugins/commit-review.ts` 或 `inspectGitCommit` 不存在。

- [ ] **步驟 3：實作最小解析器**

建立 `.opencode/plugins/commit-review.ts`：

```ts
export type CommitInspection =
  | { isCommit: false }
  | { isCommit: true; unsupportedFlag?: string }

function shellSegments(command: string): string[] {
  const segments: string[] = []
  let start = 0
  let quote: "'" | '"' | undefined
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\" || character === "`") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }

    const separator =
      character === ";" ||
      character === "\n" ||
      (character === "&" && command[index + 1] === "&") ||
      (character === "|" && command[index + 1] === "|")
    if (!separator) continue

    segments.push(command.slice(start, index))
    if ((character === "&" || character === "|") && command[index + 1] === character) index += 1
    start = index + 1
  }
  segments.push(command.slice(start))
  return segments
}

function shellWords(segment: string): string[] {
  const words: string[] = []
  let word = ""
  let quote: "'" | '"' | undefined
  let escaped = false
  const push = () => {
    if (!word) return
    words.push(word)
    word = ""
  }

  for (const character of segment.trim()) {
    if (escaped) {
      word += character
      escaped = false
      continue
    }
    if (character === "\\" || character === "`") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else word += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      push()
      continue
    }
    word += character
  }
  push()
  return words
}

function inspectSegment(segment: string): CommitInspection {
  const words = shellWords(segment)
  if (words[0] !== "git") return { isCommit: false }

  let commandIndex = 1
  while (commandIndex < words.length && words[commandIndex] !== "commit") {
    const option = words[commandIndex]
    if (["-C", "-c", "--git-dir", "--work-tree"].includes(option)) {
      commandIndex += 2
      continue
    }
    if (/^(?:-C|-c|--git-dir=|--work-tree=)/.test(option)) {
      commandIndex += 1
      continue
    }
    return { isCommit: false }
  }
  if (words[commandIndex] !== "commit") return { isCommit: false }

  for (const option of words.slice(commandIndex + 1)) {
    if (["--all", "--amend", "--allow-empty"].includes(option)) {
      return { isCommit: true, unsupportedFlag: option }
    }
    if (/^-[^-]*a/.test(option)) return { isCommit: true, unsupportedFlag: option }
  }
  return { isCommit: true }
}

export function inspectGitCommit(command: string): CommitInspection {
  for (const segment of shellSegments(command)) {
    const inspection = inspectSegment(segment)
    if (inspection.isCommit) return inspection
  }
  return { isCommit: false }
}
```

- [ ] **步驟 4：確認解析器測試通過**

執行：

```powershell
bun test tests/opencode/commit-review.test.ts
```

預期：15 個案例全部 PASS。

- [ ] **步驟 5：檢查階段成果**

執行：

```powershell
git diff -- .opencode/plugins/commit-review.ts tests/opencode/commit-review.test.ts
git status --short
```

預期：只出現預定的新外掛、測試與文件變更；不得建立 commit。

### Task 2：實作 Idle-Event Review 狀態機

**檔案：**
- 修改：`.opencode/plugins/commit-review.ts`
- 修改：`tests/opencode/commit-review.test.ts`

**介面：**
- 使用：`inspectGitCommit(command: string): CommitInspection`
- 產出：`createCommitReviewHooks(dependencies: CommitReviewDependencies): CommitReviewHooks`
- 相依介面：`fingerprint(): Promise<string>`、`runReview(sessionID: string): Promise<void>`、`reportError(message: string): Promise<void>`

- [ ] **步驟 1：新增狀態機失敗測試**

在測試檔的 import 加入 `createCommitReviewHooks`，再附加：

```ts
import { createCommitReviewHooks } from "../../.opencode/plugins/commit-review"

function bash(command: string) {
  return { args: { command } }
}

function harness(initialFingerprint = "staged-a") {
  let fingerprint = initialFingerprint
  const reviews: string[] = []
  const errors: string[] = []
  const hooks = createCommitReviewHooks({
    fingerprint: async () => fingerprint,
    runReview: async (sessionID) => {
      reviews.push(sessionID)
    },
    reportError: async (message) => {
      errors.push(message)
    },
  })
  return {
    hooks,
    reviews,
    errors,
    setFingerprint(value: string) {
      fingerprint = value
    },
  }
}

describe("createCommitReviewHooks", () => {
  test("阻擋 commit，idle 後自動執行 review，完成後允許一次", async () => {
    const context = harness()
    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        bash("git commit -m test"),
      ),
    ).rejects.toThrow("自動執行 /review")

    expect(context.reviews).toEqual([])
    await context.hooks.event({
      event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
    })
    expect(context.reviews).toEqual(["s1"])

    await context.hooks["command.execute.before"](
      { command: "review", sessionID: "s1", arguments: "" },
      { parts: [] },
    )
    await context.hooks.event({
      event: { type: "command.executed", properties: { name: "review", sessionID: "s1" } },
    })

    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c2" },
        bash("git commit -m test"),
      ),
    ).resolves.toBeUndefined()
    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c3" },
        bash("git commit -m test"),
      ),
    ).rejects.toThrow("自動執行 /review")
  })

  test("pending 與 reviewing 期間不重複排程", async () => {
    const context = harness()
    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        bash("git commit"),
      ),
    ).rejects.toThrow()
    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c2" },
        bash("git commit"),
      ),
    ).rejects.toThrow("已排程")

    await context.hooks.event({
      event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
    })
    await context.hooks.event({
      event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
    })
    expect(context.reviews).toEqual(["s1"])
  })

  test("review 前後 fingerprint 改變時不授權", async () => {
    const context = harness()
    await context.hooks["command.execute.before"](
      { command: "review", sessionID: "s1", arguments: "" },
      { parts: [] },
    )
    context.setFingerprint("staged-b")
    await context.hooks.event({
      event: { type: "command.executed", properties: { name: "review", sessionID: "s1" } },
    })

    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        bash("git commit"),
      ),
    ).rejects.toThrow("自動執行 /review")
  })

  test("session 隔離且手動 review 可授權", async () => {
    const context = harness()
    await context.hooks["command.execute.before"](
      { command: "review", sessionID: "s1", arguments: "" },
      { parts: [] },
    )
    await context.hooks.event({
      event: { type: "command.executed", properties: { name: "review", sessionID: "s1" } },
    })

    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s2", callID: "c1" },
        bash("git commit"),
      ),
    ).rejects.toThrow()
    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c2" },
        bash("git commit"),
      ),
    ).resolves.toBeUndefined()
  })

  test("拒絕不支援模式且忽略非 commit", async () => {
    const context = harness()
    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        bash("git commit --amend"),
      ),
    ).rejects.toThrow("--amend")
    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c2" },
        bash("git status"),
      ),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **步驟 2：確認狀態機測試失敗**

執行：

```powershell
bun test tests/opencode/commit-review.test.ts
```

預期：解析器測試 PASS；狀態機測試因 `createCommitReviewHooks` 不存在而 FAIL。

- [ ] **步驟 3：實作狀態機**

附加至外掛檔：

```ts
type ReviewState =
  | { phase: "pending-review"; fingerprint: string }
  | { phase: "reviewing"; fingerprint: string }
  | { phase: "reviewed"; fingerprint: string }

export type CommitReviewDependencies = {
  fingerprint(): Promise<string>
  runReview(sessionID: string): Promise<void>
  reportError(message: string): Promise<void>
}

type HookEvent =
  | { type: "session.status"; properties: { sessionID: string; status: { type: string } } }
  | { type: "command.executed"; properties: { name: string; sessionID: string } }
  | { type: string; properties: Record<string, unknown> }

export function createCommitReviewHooks(dependencies: CommitReviewDependencies) {
  const states = new Map<string, ReviewState>()

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: { command?: unknown } },
    ) => {
      const command = output.args?.command
      if (input.tool !== "bash" || typeof command !== "string") return

      const inspection = inspectGitCommit(command)
      if (!inspection.isCommit) return
      if (inspection.unsupportedFlag) {
        throw new Error(`不支援 ${inspection.unsupportedFlag}；第一版僅支援一般 staged commit。`)
      }

      const fingerprint = await dependencies.fingerprint()
      const state = states.get(input.sessionID)
      if (state?.phase === "reviewed" && state.fingerprint === fingerprint) {
        states.delete(input.sessionID)
        return
      }
      if (
        (state?.phase === "pending-review" || state?.phase === "reviewing") &&
        state.fingerprint === fingerprint
      ) {
        throw new Error("Commit 已阻擋，內建 /review 已排程或正在執行。")
      }

      states.set(input.sessionID, { phase: "pending-review", fingerprint })
      throw new Error("Commit 已阻擋；session idle 後將自動執行 /review。")
    },

    "command.execute.before": async (input: { command: string; sessionID: string }) => {
      if (input.command !== "review") return
      states.set(input.sessionID, {
        phase: "reviewing",
        fingerprint: await dependencies.fingerprint(),
      })
    },

    event: async ({ event }: { event: HookEvent }) => {
      if (event.type === "session.status" && event.properties.status.type === "idle") {
        const state = states.get(event.properties.sessionID)
        if (state?.phase !== "pending-review") return
        states.set(event.properties.sessionID, { ...state, phase: "reviewing" })
        try {
          await dependencies.runReview(event.properties.sessionID)
        } catch (error) {
          states.delete(event.properties.sessionID)
          const message = error instanceof Error ? error.message : String(error)
          await dependencies.reportError(`自動執行 /review 失敗：${message}`)
        }
        return
      }

      if (event.type === "command.executed" && event.properties.name === "review") {
        const state = states.get(event.properties.sessionID)
        if (state?.phase !== "reviewing") return
        const fingerprint = await dependencies.fingerprint()
        if (fingerprint === state.fingerprint) {
          states.set(event.properties.sessionID, { phase: "reviewed", fingerprint })
        } else {
          states.delete(event.properties.sessionID)
        }
      }
    },
  }
}
```

- [ ] **步驟 4：新增 review 呼叫失敗測試**

附加至狀態機 describe：

```ts
test("自動 review 失敗時回報並維持 fail closed", async () => {
  const errors: string[] = []
  const hooks = createCommitReviewHooks({
    fingerprint: async () => "staged-a",
    runReview: async () => {
      throw new Error("session busy")
    },
    reportError: async (message) => {
      errors.push(message)
    },
  })

  await expect(
    hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s1", callID: "c1" },
      bash("git commit"),
    ),
  ).rejects.toThrow()
  await hooks.event({
    event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
  })
  expect(errors).toEqual(["自動執行 /review 失敗：session busy"])

  await expect(
    hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s1", callID: "c2" },
      bash("git commit"),
    ),
  ).rejects.toThrow("自動執行 /review")
})
```

- [ ] **步驟 5：確認狀態機測試全部通過**

執行：

```powershell
bun test tests/opencode/commit-review.test.ts
```

預期：解析器與狀態機測試全部 PASS。

### Task 3：整合 Git Fingerprint 與 OpenCode SDK

**檔案：**
- 修改：`.opencode/plugins/commit-review.ts`
- 修改：`tests/opencode/commit-review.test.ts`

**介面：**
- 產出：`stagedFingerprint(worktree: string): Promise<string>`
- 產出：預設 OpenCode plugin factory export。

- [ ] **步驟 1：新增 fingerprint 整合失敗測試**

在測試檔加入 Node imports 與 `stagedFingerprint` import，再附加：

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stagedFingerprint } from "../../.opencode/plugins/commit-review"

async function run(cwd: string, args: string[]) {
  const process = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
  const stderr = new Response(process.stderr).text()
  if ((await process.exited) !== 0) throw new Error(await stderr)
}

describe("stagedFingerprint", () => {
  test("staged 內容改變時 fingerprint 改變", async () => {
    const directory = await mkdtemp(join(tmpdir(), "commit-review-"))
    try {
      await run(directory, ["git", "init"])
      const empty = await stagedFingerprint(directory)
      expect(empty).toMatch(/^[a-f0-9]{64}$/)

      await Bun.write(join(directory, "sample.txt"), "first\n")
      await run(directory, ["git", "add", "sample.txt"])
      const first = await stagedFingerprint(directory)
      expect(first).toMatch(/^[a-f0-9]{64}$/)
      expect(first).not.toBe(empty)

      await Bun.write(join(directory, "sample.txt"), "second\n")
      await run(directory, ["git", "add", "sample.txt"])
      expect(await stagedFingerprint(directory)).not.toBe(first)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("非 Git directory 會回報錯誤", async () => {
    const directory = await mkdtemp(join(tmpdir(), "commit-review-not-git-"))
    try {
      await expect(stagedFingerprint(directory)).rejects.toThrow("git diff --cached failed")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
```

- [ ] **步驟 2：確認 fingerprint 測試失敗**

執行：

```powershell
bun test tests/opencode/commit-review.test.ts
```

預期：既有測試 PASS；新測試因 `stagedFingerprint` 不存在而 FAIL。

- [ ] **步驟 3：實作 fingerprint 與預設外掛**

附加至外掛檔：

```ts
export async function stagedFingerprint(worktree: string): Promise<string> {
  const process = Bun.spawn(["git", "diff", "--cached", "--binary"], {
    cwd: worktree,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdoutPromise = new Response(process.stdout).arrayBuffer()
  const stderrPromise = new Response(process.stderr).text()
  const exitCode = await process.exited
  const stdout = new Uint8Array(await stdoutPromise)
  const stderr = await stderrPromise
  if (exitCode !== 0) {
    throw new Error(`git diff --cached failed: ${stderr.trim() || `exit code ${exitCode}`}`)
  }
  return new Bun.CryptoHasher("sha256").update(stdout).digest("hex")
}

export async function commitReviewPlugin(input: {
  worktree: string
  client: {
    session: {
      command(options: {
        path: { id: string }
        body: { command: string; arguments: string }
      }): Promise<{ error?: unknown }>
    }
    tui: { showToast(options: Record<string, unknown>): Promise<unknown> }
    app: { log(options: Record<string, unknown>): Promise<unknown> }
  }
}) {
  return createCommitReviewHooks({
    fingerprint: () => stagedFingerprint(input.worktree),
    runReview: async (sessionID) => {
      const result = await input.client.session.command({
        path: { id: sessionID },
        body: { command: "review", arguments: "" },
      })
      if (result.error) throw new Error(String(result.error))
    },
    reportError: async (message) => {
      await Promise.allSettled([
        input.client.tui.showToast({
          body: { title: "Commit review", message, variant: "error", duration: 8000 },
        }),
        input.client.app.log({
          body: { service: "commit-review", level: "error", message },
        }),
      ])
    },
  })
}

export default {
  id: "commit-review",
  server: commitReviewPlugin,
}
```

- [ ] **步驟 4：執行完整外掛測試**

執行：

```powershell
bun test tests/opencode/commit-review.test.ts
```

預期：所有解析器、狀態機與 Git 整合測試 PASS。

- [ ] **步驟 5：執行專案既有檢查**

執行：

```powershell
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

預期：三個命令皆以 exit code 0 結束，所有 Python 測試 PASS。

- [ ] **步驟 6：驗證 OpenCode 載入外掛**

完全結束並重新啟動 OpenCode，再執行：

```powershell
opencode debug config
```

預期：exit code 0，沒有 plugin import 或初始化錯誤。

- [ ] **步驟 7：以 dry run 手動驗證完整流程**

Stage 外掛與測試變更後，在 OpenCode 要求代理執行 `git commit --dry-run`：

1. 第一次 dry run 遭阻擋。
2. session idle 後，同 session 自動出現內建 `/review` 結果。
3. 確認 review 無需調整後，再次執行相同 dry run，應允許一次。
4. 第三次 dry run 再次遭阻擋並排程 review。

預期：全程不建立實際 commit，且狀態轉移符合規格。

- [ ] **步驟 8：最終檢查**

執行：

```powershell
git diff --check
git status --short
```

預期：`git diff --check` 無輸出且 exit code 0；僅列出外掛、測試、規格與計畫文件。不得建立 commit。
