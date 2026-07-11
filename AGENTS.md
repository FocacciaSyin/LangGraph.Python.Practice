# 儲存庫指引

## 環境與結構

- 使用 Python 3.12 與 `uv`；首次準備環境：`uv sync`
- `src/langgraph_python_practice/` — Graph 實作；`examples/` — 可直接執行 (`uv run python examples/...`)；`tests/` — pytest 行為測試
- 不需 LLM API key 或 `.env`

## 驗證（依序執行）

```powershell
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

- 單一測試檔：`uv run pytest tests/test_basic_graph.py -q`
- 單一測試函式：`uv run pytest tests/test_basic_graph.py::test_payment_question_routes_to_payment_answer -q`
- **注意：** Windows PowerShell 不支援 `&&` 鏈結指令，請逐行執行

## LangGraph 慣例

- node 只回傳要更新的 state 欄位，不要回傳整個 state
- `path` 與 `history` 使用 `Annotated[list[str], operator.add]` reducer 累積，不需手動 append
- Checkpoint 使用 `InMemorySaver`，資料僅在當前程序有效，由 `thread_id` 隔離，非持久化儲存
- Conditional edge 回傳 Literal[node_name] 字串，LangGraph 自動路由
