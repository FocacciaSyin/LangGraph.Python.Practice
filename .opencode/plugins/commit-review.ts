export type CommitInspection =
  | { isCommit: false }
  | { isCommit: true; unsupportedFlag?: string }

function shellSegments(command: string): string[] {
  const segments: string[] = []
  let segment = ""
  let quote: "'" | '"' | undefined
  let escaped = false
  let comment = false
  let tokenStart = true

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (comment) {
      if (character === "\n") {
        segments.push(segment)
        segment = ""
        comment = false
        tokenStart = true
      }
      continue
    }
    if (escaped) {
      segment += character
      escaped = false
      tokenStart = false
      continue
    }
    if (character === "\\" || character === "`") {
      segment += character
      escaped = true
      continue
    }
    if (quote) {
      segment += character
      if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') {
      segment += character
      quote = character
      tokenStart = false
      continue
    }
    if (character === "#" && tokenStart) {
      comment = true
      continue
    }

    const separator =
      character === ";" ||
      character === "\n" ||
      character === "&" ||
      character === "|"
    if (separator) {
      segments.push(segment)
      segment = ""
      if ((character === "&" || character === "|") && command[index + 1] === character) index += 1
      tokenStart = true
      continue
    }

    segment += character
    tokenStart = /\s/.test(character)
  }
  segments.push(segment)
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

  const commitOptions = words.slice(commandIndex + 1)
  for (let index = 0; index < commitOptions.length; index += 1) {
    const option = commitOptions[index]
    if (option === "--") break
    if (["-m", "--message", "-F", "--file"].includes(option)) {
      index += 1
      continue
    }
    if (/^(?:-m|-F).+/.test(option) || /^(?:--message|--file)=/.test(option)) continue
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

type ReviewState =
  | { phase: "pending-review"; fingerprint: string }
  | { phase: "launching"; fingerprint: string }
  | { phase: "reviewing"; fingerprint: string }
  | { phase: "reviewed"; fingerprint: string }

export type CommitReviewDependencies = {
  fingerprint(): Promise<string>
  runReview(sessionID: string): Promise<void>
  reportError(message: string): Promise<void>
}

type HookEvent = {
  type: string
  properties: {
    sessionID?: unknown
    status?: unknown
    name?: unknown
    [key: string]: unknown
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  try {
    const serialized = JSON.stringify(error)
    if (serialized !== undefined) return serialized
  } catch {
    // 循環物件等無法序列化的值退回一般字串轉換。
  }
  return String(error)
}

export function createCommitReviewHooks(dependencies: CommitReviewDependencies) {
  const states = new Map<string, ReviewState>()
  const reportError = async (message: string) => {
    try {
      await dependencies.reportError(message)
    } catch {
      // OpenCode 不等待 event hook；錯誤回報失敗也不可產生 unhandled rejection。
    }
  }

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
        state?.phase === "pending-review" ||
        state?.phase === "launching" ||
        state?.phase === "reviewing"
      ) {
        throw new Error("Commit 已阻擋，內建 /review 已排程或正在執行。")
      }

      states.set(input.sessionID, { phase: "pending-review", fingerprint })
      throw new Error("Commit 已阻擋；session idle 後將自動執行 /review。")
    },

    "command.execute.before": async (input: { command: string; sessionID: string }) => {
      if (input.command !== "review") return
      if (states.get(input.sessionID)?.phase === "reviewing") {
        throw new Error("已有 /review 正在執行，拒絕重疊 review。")
      }
      const fingerprint = await dependencies.fingerprint()
      if (states.get(input.sessionID)?.phase === "reviewing") {
        throw new Error("已有 /review 正在執行，拒絕重疊 review。")
      }
      states.set(input.sessionID, {
        phase: "reviewing",
        fingerprint,
      })
    },

    event: async ({ event }: { event: HookEvent }) => {
      try {
        const sessionID = event.properties.sessionID
        if (typeof sessionID !== "string") return

        const status = event.properties.status
        const isIdle =
          event.type === "session.idle" ||
          (event.type === "session.status" &&
            typeof status === "object" &&
            status !== null &&
            "type" in status &&
            status.type === "idle")
        if (isIdle) {
          const state = states.get(sessionID)
          if (state?.phase !== "pending-review") return
          states.set(sessionID, { ...state, phase: "launching" })
          try {
            await dependencies.runReview(sessionID)
          } catch (error) {
            states.delete(sessionID)
            await reportError(`自動執行 /review 失敗：${errorMessage(error)}`)
          }
          return
        }

        if (event.type === "command.executed" && event.properties.name === "review") {
          const state = states.get(sessionID)
          if (state?.phase !== "reviewing") return
          let fingerprint: string
          try {
            fingerprint = await dependencies.fingerprint()
          } catch (error) {
            if (states.get(sessionID) === state) states.delete(sessionID)
            await reportError(`處理 commit review event 失敗：${errorMessage(error)}`)
            return
          }
          if (fingerprint === state.fingerprint) {
            states.set(sessionID, { phase: "reviewed", fingerprint })
          } else {
            states.delete(sessionID)
          }
        }
      } catch (error) {
        await reportError(`處理 commit review event 失敗：${errorMessage(error)}`)
      }
    },
  }
}

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

type PluginInput = {
  worktree: string
  client: {
    session: {
      command(options: {
        path: { id: string }
        body: { command: string; arguments: string }
      }): Promise<{ error?: unknown }>
    }
    tui: {
      showToast(options: {
        body: {
          title: string
          message: string
          variant: "error"
          duration: number
        }
      }): Promise<unknown>
    }
    app: {
      log(options: {
        body: { service: string; level: "error"; message: string }
      }): Promise<unknown>
    }
  }
}

export async function commitReviewPlugin(input: PluginInput) {
  return createCommitReviewHooks({
    fingerprint: () => stagedFingerprint(input.worktree),
    runReview: async (sessionID) => {
      const result = await input.client.session.command({
        path: { id: sessionID },
        body: { command: "review", arguments: "" },
      })
      if (result.error !== undefined) throw new Error(errorMessage(result.error))
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
