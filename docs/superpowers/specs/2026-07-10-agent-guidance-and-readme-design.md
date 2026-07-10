# Agent 指引與 README 設計

## 目的

為 OpenCode 工作階段新增精簡的儲存庫指引，並將 README 調整為首次使用者可逐步操作的教學。

## AGENTS.md

- 說明此專案使用 Python 3.12 與 `uv` 管理。
- 提供確切的環境準備指令：`uv sync`。
- 標示 `src/langgraph_python_practice/` 是工作流實作、`examples/` 是可執行示範、`tests/` 是行為測試。
- 收錄聚焦與完整驗證指令：`uv run pytest tests/test_basic_graph.py`、`uv run pytest tests/test_checkpoint_graph.py`、`uv run ruff check .`、`uv run ruff format --check .` 與 `uv run pytest`。
- 保留 checkpoint 範例使用 `InMemorySaver` 的限制：其狀態僅存在目前程序記憶體中，無法持久保存。
- 排除通用工程建議、未設定的工具，以及沒有操作價值的重複資訊。

## README

- 範圍限制於既有兩個範例與驗證，不加入修改程式碼的練習。
- 使用編號學習路徑：環境需求、開啟儲存庫、同步相依套件、執行 Basic Graph、解讀兩種分支結果、執行 Checkpoint Graph、解讀各執行緒狀態，以及驗證專案。
- 每個操作旁提供確切的 PowerShell 指令並說明預期行為，不虛構可能受相依版本影響的終端機輸出。
- 明確說明目前學習階段不需 LLM API key，且 `InMemorySaver` 的資料會在程序結束時消失。
- 保留精簡的專案地圖，以及以原始碼為準的 graph state、node、conditional edge、reducer 與 `thread_id` 解釋。

## 驗證

完成修改後，使用 README 定義的 `uv run` 指令執行 Ruff lint、Ruff 格式檢查與完整 pytest 測試套件。
