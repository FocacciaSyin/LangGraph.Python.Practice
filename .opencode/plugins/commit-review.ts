/** git commit 檢查結果：
 *  - { isCommit: false } 表示不是 git commit 指令
 *  - { isCommit: true } 表示是 commit，若有 unsupportedFlag 則代表含有不支援的選項 */
export type CommitInspection =
  | { isCommit: false }
  | { isCommit: true; unsupportedFlag?: string }

/** 將一個 shell 命令字串依照分隔符（;、\n、&、|）拆成多個 segment。
 *  每個 segment 是邏輯上獨立執行的命令區塊。 */
function shellSegments(command: string): string[] {
  const segments: string[] = []
  let segment = ""
  let quote: "'" | '"' | undefined
  let escaped = false
  let comment = false
  let tokenStart = true

  /** 處理 shell 跳脫與引號解析，支援：
   *   - 反斜線／反引號跳脫
   *   - 單引號與雙引號括住的字串（內部空白不分詞）
   *   - 以 # 開頭的行內註解（僅在 token 開頭時觸發）
   *   - 分隔符：; \n & | */
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (comment) {
      if (character === "\n") {
        segments.push(segment) // 遇到換行結束註解
        segment = ""
        comment = false
        tokenStart = true
      }
      continue
    }
    if (escaped) {
      segment += character // 跳脫後的字元直接附加
      escaped = false
      tokenStart = false
      continue
    }
    if (character === "\\" || character === "`") {
      segment += character // 記錄跳脫字元本身
      escaped = true
      continue
    }
    if (quote) {
      segment += character // 引號內的字元一律保留
      if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') {
      segment += character // 引號本身也保留在 segment 中
      quote = character
      tokenStart = false
      continue
    }
    if (character === "#" && tokenStart) {
      comment = true // token 開頭遇到 # 視為註解開始
      continue
    }

    const separator =
      character === ";" ||
      character === "\n" ||
      character === "&" ||
      character === "|"
    if (separator) {
      segments.push(segment) // 遇到分隔符表示 segment 結束
      segment = ""
      if ((character === "&" || character === "|") && command[index + 1] === character) index += 1 // 跳過 && / || 的第二個字元
      tokenStart = true
      continue
    }

    segment += character
    tokenStart = /\s/.test(character)
  }
  segments.push(segment) // 推入最後一個 segment
  return segments
}

/** 將一個 segment 依照空白拆成獨立的 shell words。
 *  支援引號包覆（單／雙引號內的空白不分詞）與反斜線／反引號跳脫。 */
function shellWords(segment: string): string[] {
  const words: string[] = []
  let word = ""
  let quote: "'" | '"' | undefined
  let escaped = false
  /** 將當前累積的 word 推入 words 陣列，空字串則略過 */
  const push = () => {
    if (!word) return
    words.push(word)
    word = ""
  }

  for (const character of segment.trim()) {
    if (escaped) {
      word += character // 跳脫後的字元直接附加
      escaped = false
      continue
    }
    if (character === "\\" || character === "`") {
      escaped = true // 進入跳脫狀態，跳脫字元本身不加入 word
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined // 引號閉合
      else word += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character // 引號本身不加入 word（與 segment 層級不同）
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

/** 檢查一個 segment 是否為 `git commit` 指令，並回傳檢查結果。
 *  規則：
 *   - command 必須以 `git` 開頭，中間可穿插目錄選項（-C、--git-dir 等）
 *   - 找到 `commit` 子命令後，掃描其後的選項
 *   - 若遇到 --all / --amend / --allow-empty 或 -a 短選項，則標記為不支援 */
function inspectSegment(segment: string): CommitInspection {
  const words = shellWords(segment)
  if (words[0] !== "git") return { isCommit: false }

  let commandIndex = 1
  while (commandIndex < words.length && words[commandIndex] !== "commit") {
    // 跳過 git 的全域選項，只關心 commit 子命令
    const option = words[commandIndex]
    if (["-C", "-c", "--git-dir", "--work-tree"].includes(option)) {
      commandIndex += 2
      continue
    }
    if (/^(?:-C|-c|--git-dir=|--work-tree=)/.test(option)) {
      commandIndex += 1
      continue
    }
    return { isCommit: false } // 遇到不在白名單中的選項則非 commit
  }
  if (words[commandIndex] !== "commit") return { isCommit: false }

  const commitOptions = words.slice(commandIndex + 1)
  for (let index = 0; index < commitOptions.length; index += 1) {
    const option = commitOptions[index]
    if (option === "--") break // -- 之後的參數不再檢查
    // 跳過需要參數值的選項（-m msg / -F file 等）
    if (["-m", "--message", "-F", "--file"].includes(option)) {
      index += 1
      continue
    }
    if (/^(?:-m|-F).+/.test(option) || /^(?:--message|--file)=/.test(option)) continue
    // 偵測不支援的旗標
    if (["--all", "--amend", "--allow-empty"].includes(option)) {
      return { isCommit: true, unsupportedFlag: option }
    }
    if (/^-[^-]*a/.test(option)) return { isCommit: true, unsupportedFlag: option }
  }
  return { isCommit: true } // 通過檢查，為標準的 git commit
}

/** 對完整命令字串逐一拆解 segment，直到找到第一個 git commit 為止。 */
export function inspectGitCommit(command: string): CommitInspection {
  for (const segment of shellSegments(command)) {
    const inspection = inspectSegment(segment)
    if (inspection.isCommit) return inspection
  }
  return { isCommit: false } // 無任何 segment 為 git commit
}

/** 表示 commit review 流程的各階段狀態 */
type ReviewState =
  | { phase: "pending-review"; fingerprint: string }
  | { phase: "launching"; fingerprint: string }
  | { phase: "reviewing"; fingerprint: string }
  | { phase: "reviewed"; fingerprint: string }

/** 提供給 commit review hook 的外部依賴 */
export type CommitReviewDependencies = {
  /** 計算當前 staged 變更的 SHA256 指紋 */
  fingerprint(): Promise<string>
  /** 觸發指定 session 的內建 /review 命令 */
  runReview(sessionID: string): Promise<void>
  /** 向使用者回報錯誤（toast + 日誌） */
  reportError(message: string): Promise<void>
}

/** OpenCode 事件回呼傳入的 event 物件結構 */
type HookEvent = {
  type: string
  properties: {
    sessionID?: unknown
    status?: unknown
    name?: unknown
    [key: string]: unknown
  }
}

/** 將未知型別的錯誤轉換為可讀的字串訊息 */
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

/** 建立 commit review 所需的 OpenCode hook 集合。
 *  包含三個 hook：
 *   1. tool.execute.before：攔截 bash 執行，阻擋 git commit 並排程 /review
 *   2. command.execute.before：攔截 /review 命令，防止重疊執行
 *   3. event：監聽 session idle / command.executed 事件，管理狀態轉換 */
export function createCommitReviewHooks(dependencies: CommitReviewDependencies) {
  /** sessionID → 當前 review 狀態 */
  const states = new Map<string, ReviewState>()
  /** 包裝 reportError，確保即使回報失敗也不會拋出 unhandled rejection */
  const reportError = async (message: string) => {
    try {
      await dependencies.reportError(message)
    } catch {
      // OpenCode 不等待 event hook；錯誤回報失敗也不可產生 unhandled rejection。
    }
  }

  return {
    /** 在 bash 工具執行前攔截 git commit 指令 */
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

      // 計算當前 staged diff 指紋，用於後續比對
      const fingerprint = await dependencies.fingerprint()
      const state = states.get(input.sessionID)
      if (state?.phase === "reviewed" && state.fingerprint === fingerprint) {
        // 先前已 review 過相同 diff，直接放行
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

    /** 在 /review 命令執行前標記為 reviewing 狀態，防止重疊 */
    "command.execute.before": async (input: { command: string; sessionID: string }) => {
      if (input.command !== "review") return
      if (states.get(input.sessionID)?.phase === "reviewing") {
        throw new Error("已有 /review 正在執行，拒絕重疊 review。") // 防重入
      }
      const fingerprint = await dependencies.fingerprint()
      if (states.get(input.sessionID)?.phase === "reviewing") {
        throw new Error("已有 /review 正在執行，拒絕重疊 review。") // 競態條件再次檢查
      }
      states.set(input.sessionID, {
        phase: "reviewing",
        fingerprint,
      })
    },

    /** 監聽事件，處理狀態轉換：
     *   - session.idle / session.status(idle)：pending-review → launching → 觸發 runReview
     *   - command.executed(review)：確認 /review 完成後標記為 reviewed */
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
          states.set(sessionID, { ...state, phase: "launching" }) // 轉為 launching 防止重複觸發
          try {
            await dependencies.runReview(sessionID)
          } catch (error) {
            states.delete(sessionID) // 失敗則清除狀態，允許使用者重試
            await reportError(`自動執行 /review 失敗：${errorMessage(error)}`)
          }
          return
        }

        if (event.type === "command.executed" && event.properties.name === "review") {
          const state = states.get(sessionID)
          if (state?.phase !== "reviewing") return
          let fingerprint: string // 重新計算指紋以確認 diff 未在 review 期間變更
          try {
            fingerprint = await dependencies.fingerprint()
          } catch (error) {
            if (states.get(sessionID) === state) states.delete(sessionID) // 只在狀態未被其他操作改變時清除
            await reportError(`處理 commit review event 失敗：${errorMessage(error)}`)
            return
          }
          if (fingerprint === state.fingerprint) {
            states.set(sessionID, { phase: "reviewed", fingerprint }) // 指紋相符，標記為已審查
          } else {
            states.delete(sessionID) // 指紋不同（diff 已變更），清除狀態讓下次 commit 重新觸發
          }
        }
      } catch (error) {
        await reportError(`處理 commit review event 失敗：${errorMessage(error)}`)
      }
    },
  }
}

/** 計算指定工作目錄中 staged 變更（git diff --cached）的 SHA256 指紋。
 *  指紋用於判斷 commit 內容是否與前次 review 相同。 */
export async function stagedFingerprint(worktree: string): Promise<string> {
  const process = Bun.spawn(["git", "diff", "--cached", "--binary"], {
    cwd: worktree,
    stdout: "pipe",
    stderr: "pipe",
  })
  // 同時讀取 stdout 與 stderr，避免子行程因 pipe 滿而阻塞
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

/** OpenCode 插件所需的輸入參數 */
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

/** 插件進入點，組裝依賴並建立 commit review hooks */
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
