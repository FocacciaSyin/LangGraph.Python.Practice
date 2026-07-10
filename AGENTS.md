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
