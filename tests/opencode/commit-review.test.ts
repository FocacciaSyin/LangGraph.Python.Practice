import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import commitReviewPlugin, {
  createCommitReviewHooks,
  inspectGitCommit,
  stagedFingerprint,
} from "../../.opencode/plugins/commit-review"

async function run(cwd: string, args: string[]) {
  const process = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
  const stderr = new Response(process.stderr).text()
  if ((await process.exited) !== 0) throw new Error(await stderr)
}

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

describe("inspectGitCommit", () => {
  test.each([
    "git commit",
    'git commit -m "message"',
    "git -C . commit -m test",
    "uv run pytest; git commit -m test",
    "uv run pytest && git commit",
    'printf "message" | git commit -F -',
    "echo ok & git commit -m test",
    "git commit -m -amazing",
    "git commit -F -afile",
    "git commit -- -a",
    "echo ok # not a commit\ngit commit -m test",
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
    "echo ok # ; git commit -m test",
    "echo value#part",
  ])("忽略非 commit：%s", (command) => {
    expect(inspectGitCommit(command)).toEqual({ isCommit: false })
  })
})

describe("createCommitReviewHooks", () => {
  test("阻擋 pipeline 中的 commit", async () => {
    const context = harness()

    await expect(
      context.hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        bash('printf "message" | git commit -F -'),
      ),
    ).rejects.toThrow("自動執行 /review")
  })

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

    context.setFingerprint("staged-b")
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

  test("session.idle 會啟動 pending review 且重複事件不重複呼叫", async () => {
    const context = harness()
    await context.hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s1", callID: "c1" },
      bash("git commit"),
    ).catch(() => {})

    await context.hooks.event({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    })
    await context.hooks.event({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
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

  test("review A 未完成時拒絕 review B，A completion 不授權 B", async () => {
    const context = harness()
    await context.hooks["command.execute.before"](
      { command: "review", sessionID: "s1", arguments: "" },
      { parts: [] },
    )

    context.setFingerprint("staged-b")
    await expect(
      context.hooks["command.execute.before"](
        { command: "review", sessionID: "s1", arguments: "" },
        { parts: [] },
      ),
    ).rejects.toThrow("正在執行")

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

  test("並行開始的同 session review 只允許一個進入 reviewing", async () => {
    let releaseFingerprint: () => void = () => {}
    const fingerprintGate = new Promise<void>((resolve) => {
      releaseFingerprint = resolve
    })
    const hooks = createCommitReviewHooks({
      fingerprint: async () => {
        await fingerprintGate
        return "staged-a"
      },
      runReview: async () => {},
      reportError: async () => {},
    })

    const reviewA = hooks["command.execute.before"]({ command: "review", sessionID: "s1" })
    const reviewB = hooks["command.execute.before"]({ command: "review", sessionID: "s1" })
    releaseFingerprint()

    const results = await Promise.allSettled([reviewA, reviewB])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected?.status === "rejected" ? rejected.reason.message : undefined).toContain("正在執行")
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

  test("event fingerprint 失敗會回報、清除該 session 並允許重新排程", async () => {
    let fingerprintCalls = 0
    const errors: string[] = []
    const hooks = createCommitReviewHooks({
      fingerprint: async () => {
        fingerprintCalls += 1
        if (fingerprintCalls !== 2) return "staged-a"
        throw new Error("git failed")
      },
      runReview: async () => {},
      reportError: async (message) => {
        errors.push(message)
      },
    })

    await hooks["command.execute.before"]({ command: "review", sessionID: "s1" })
    await expect(
      hooks.event({
        event: { type: "command.executed", properties: { name: "review", sessionID: "s1" } },
      }),
    ).resolves.toBeUndefined()
    expect(errors).toEqual(["處理 commit review event 失敗：git failed"])
    await expect(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        bash("git commit"),
      ),
    ).rejects.toThrow("session idle 後將自動執行 /review")
  })
})

describe("stagedFingerprint", () => {
  test("staged binary 內容改變時 fingerprint 改變", async () => {
    const directory = await mkdtemp(join(tmpdir(), "commit-review-"))
    try {
      await run(directory, ["git", "init"])
      const empty = await stagedFingerprint(directory)
      expect(empty).toMatch(/^[a-f0-9]{64}$/)

      await Bun.write(join(directory, "sample.bin"), new Uint8Array([0, 255, 1]))
      await run(directory, ["git", "add", "sample.bin"])
      const first = await stagedFingerprint(directory)
      expect(first).not.toBe(empty)

      await Bun.write(join(directory, "sample.bin"), new Uint8Array([0, 255, 2]))
      await run(directory, ["git", "add", "sample.bin"])
      expect(await stagedFingerprint(directory)).not.toBe(first)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("非 Git directory 會 fail closed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "commit-review-not-git-"))
    try {
      await expect(stagedFingerprint(directory)).rejects.toThrow("git diff --cached failed")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

test("default export 使用 OpenCode v1 plugin object contract", () => {
  expect(commitReviewPlugin.id).toBe("commit-review")
  expect(commitReviewPlugin.server).toBeFunction()
})

describe("commitReviewPlugin", () => {
  test("idle 時透過 session.command 執行 review", async () => {
    const commands: unknown[] = []
    const hooks = await commitReviewPlugin.server({
      worktree: ".",
      client: {
        session: {
          command: async (options) => {
            commands.push(options)
            return { data: {} }
          },
        },
        tui: { showToast: async () => ({ data: true }) },
        app: { log: async () => ({ data: true }) },
      },
    })
    await expect(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        bash("git commit --dry-run"),
      ),
    ).rejects.toThrow()
    await hooks.event({
      event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
    })

    expect(commands).toEqual([
      { path: { id: "s1" }, body: { command: "review", arguments: "" } },
    ])
  })

  test("session.command error 會以 toast 與 log 回報且 event 不 reject", async () => {
    const commands: unknown[] = []
    const toasts: unknown[] = []
    const logs: unknown[] = []
    const hooks = await commitReviewPlugin.server({
      worktree: ".",
      client: {
        session: {
          command: async (options) => {
            commands.push(options)
            return { error: { message: "busy" } }
          },
        },
        tui: {
          showToast: async (options) => {
            toasts.push(options)
            throw new Error("TUI unavailable")
          },
        },
        app: {
          log: async (options) => {
            logs.push(options)
            return { data: true }
          },
        },
      },
    })
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s1", callID: "c1" },
      bash("git commit --dry-run"),
    ).catch(() => {})

    await expect(
      hooks.event({
        event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
      }),
    ).resolves.toBeUndefined()
    expect(commands).toEqual([
      { path: { id: "s1" }, body: { command: "review", arguments: "" } },
    ])
    expect(toasts).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect((toasts[0] as { body: { message: string } }).body.message).toContain("busy")
    expect((logs[0] as { body: { message: string } }).body.message).toContain("busy")
  })
})
