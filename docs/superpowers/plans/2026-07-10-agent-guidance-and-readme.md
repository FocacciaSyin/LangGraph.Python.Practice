# Agent 指引與 README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增精簡的 OpenCode 儲存庫指引，並將 README 改寫為首次使用者可循序完成兩個 LangGraph 範例與驗證的教學。

**Architecture:** 文件維持於儲存庫根目錄，`AGENTS.md` 僅保留執行代理時容易遺漏的操作與限制；`README.md` 則使用編號步驟引導使用者完成環境同步、範例執行與驗證。兩者共用現有 `pyproject.toml`、範例程式與測試作為可執行的事實來源。

**Tech Stack:** Python 3.12、uv、LangGraph、pytest、Ruff、Markdown。

## Global Constraints

- Python 版本必須是 `>=3.12,<3.13`，相依套件以 `uv.lock` 鎖定。
- 所有環境、範例與驗證指令使用 `uv run` 或 `uv sync`。
- README 範圍僅包含目前的 Basic Graph、Checkpoint Graph 與驗證，不新增程式修改練習。
- `InMemorySaver` 的 checkpoint 僅在目前程序存活期間有效，文件不得描述為持久化儲存。
- 除非使用者明確要求，勿建立 Git commit。

---

## File Structure

- Create: `AGENTS.md`：供後續 OpenCode 工作階段使用的專案操作指引。
- Modify: `README.md`：供首次使用者操作的繁體中文教學。

### Task 1: 新增高訊號 AGENTS 指引

**Files:**
- Create: `AGENTS.md`
- Verify: `pyproject.toml:1-26`, `src/langgraph_python_practice/checkpoint_graph.py:1-23`, `tests/test_basic_graph.py:1-20`, `tests/test_checkpoint_graph.py:1-38`

**Interfaces:**
- Consumes: `pyproject.toml` 定義的 Python、Ruff 與測試工具設定。
- Produces: 根目錄 `AGENTS.md`，供 OpenCode 工作階段載入。

- [ ] **Step 1: 建立 `AGENTS.md`**

```markdown
# 儲存庫指引

## 環境與結構

- 使用 Python 3.12 與 `uv`；首次準備環境執行 `uv sync`。
- `src/langgraph_python_practice/` 是 LangGraph 工作流實作；`examples/` 是可直接執行的示範；`tests/` 是行為測試。
- 不需 LLM API key 或 `.env` 設定即可執行目前案例。

## 驗證

- 單一 Basic Graph 測試：`uv run pytest tests/test_basic_graph.py`
- 單一 Checkpoint Graph 測試：`uv run pytest tests/test_checkpoint_graph.py`
- 完整檢查依序執行：`uv run ruff check .`、`uv run ruff format --check .`、`uv run pytest`

## LangGraph 注意事項

- node 應只回傳要更新的 state 欄位；`path` 與 `history` 依 `operator.add` reducer 累積。
- Checkpoint 範例使用 `InMemorySaver`；資料僅在目前程序中保存，且由 `thread_id` 分隔，不可當成持久化儲存。
```

- [ ] **Step 2: 檢查指引不包含未驗證或重複資訊**

Run: `uv run python -c "from pathlib import Path; print(Path('AGENTS.md').read_text(encoding='utf-8'))"`

Expected: 內容僅提及 `pyproject.toml`、現有原始碼與測試可驗證的工具、路徑、指令和 checkpoint 限制。

### Task 2: 將 README 改為首次使用者教學

**Files:**
- Modify: `README.md`
- Verify: `examples/basic_graph.py:1-17`, `examples/checkpoint_graph.py:1-18`, `src/langgraph_python_practice/basic_graph.py:8-46`, `src/langgraph_python_practice/checkpoint_graph.py:9-23`

**Interfaces:**
- Consumes: Basic Graph CLI 接受一個整數參數；Checkpoint Graph 使用 `thread-a` 與 `thread-b` 展示隔離狀態。
- Produces: 以繁體中文說明的 `README.md`，可讓使用者依順序執行現有案例。

- [ ] **Step 1: 以編號操作流程改寫 README**

將 README 重組為下列章節及內容：

```markdown
# LangGraph Python Practice

這是不用 LLM API 的 LangGraph 學習專案。完成本教學後，你會親自執行條件分支與記憶體 checkpoint 範例，理解 state、node、edge、reducer 與 `thread_id` 的作用。

## 開始前

- 安裝 Python 3.12。
- 安裝 [uv](https://docs.astral.sh/uv/)。
- 目前範例不需要 LLM API key，也不需要設定 `.env`。

## 1. 準備環境

在儲存庫根目錄執行：

```powershell
uv sync
```

此指令會依 `pyproject.toml` 與 `uv.lock` 建立 `.venv`，並安裝 LangGraph、pytest 與 Ruff。

## 2. 執行 Basic Graph

```powershell
uv run python examples/basic_graph.py 1
```

起始值 `1` 會先經過 `increment` 變成 `2`，因此選擇 `double` 分支，最後顯示結果 `4` 與路徑 `increment -> double`。

再執行另一個輸入：

```powershell
uv run python examples/basic_graph.py 2
```

起始值 `2` 先變成 `3`，因此選擇 `square` 分支，最後顯示結果 `9` 與路徑 `increment -> square`。

這個範例中，`NumberState` 是共享狀態；node 只回傳要修改的欄位；`path` 使用 reducer 累積每個經過的 node。

## 3. 執行 Checkpoint Graph

```powershell
uv run python examples/checkpoint_graph.py
```

程式會讓 `thread-a` 執行兩次、`thread-b` 執行一次。輸出會顯示 `thread-a` 的計數為 `2`，`thread-b` 的計數為 `1`，表示相同 `thread_id` 會累積 state，不同 `thread_id` 則各自隔離。

此範例使用 `InMemorySaver`。資料只在目前程序執行期間保存；程式結束後 checkpoint 會消失，不能當作正式持久化儲存。

## 4. 驗證專案

依序執行：

```powershell
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

三個指令皆成功完成，代表 lint、格式與行為測試均通過。

## 專案地圖

```text
examples/                              # 可直接執行的案例
src/langgraph_python_practice/         # Graph workflow 實作
tests/                                 # 行為測試
pyproject.toml                         # Python 與工具設定
uv.lock                                # 精確相依版本
```
```

- [ ] **Step 2: 執行兩個教學命令，確認說明符合實際行為**

Run: `uv run python examples/basic_graph.py 1`

Expected: 輸出結果 `4` 與路徑 `increment -> double`。

Run: `uv run python examples/basic_graph.py 2`

Expected: 輸出結果 `9` 與路徑 `increment -> square`。

Run: `uv run python examples/checkpoint_graph.py`

Expected: `thread-a` 的 state 含 `count: 2`，`thread-b` 的 state 含 `count: 1`。

- [ ] **Step 3: 執行完整文件驗證**

Run: `uv run ruff check .`

Expected: 結束碼為 `0`，沒有 lint 問題。

Run: `uv run ruff format --check .`

Expected: 結束碼為 `0`，沒有格式問題。

Run: `uv run pytest`

Expected: 所有測試通過。

## 自我檢查

- Spec coverage：Task 1 實作精簡 AGENTS 指引與 checkpoint 限制；Task 2 實作兩個案例、驗證與新手逐步流程。
- Placeholder scan：計畫不含暫留項或未定義的後續工作。
- Type consistency：所有命令、檔案路徑、state 名稱與 `thread_id` 行為皆對應目前原始碼與測試。
