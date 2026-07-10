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

## 2. 執行客服 FAQ Graph

這個範例模擬客服聊天機器人收到一段使用者問題後，先理解問題，再依關鍵字前往不同的回答 node。

```text
START -> understand_question
          |-- payment --> answer_payment --> END
          |-- return  --> answer_return  --> END
          `-- unknown --> answer_unknown --> END
```

先詢問付款方式：

```powershell
uv run python examples/basic_graph.py "如何付款？"
```

機器人會回覆「您可以使用信用卡或轉帳付款。」，路徑為 `understand_question -> answer_payment`。

再詢問退貨：

```powershell
uv run python examples/basic_graph.py "我要退貨"
```

機器人會回覆「請在收到商品後七天內申請退貨。」，路徑為 `understand_question -> answer_return`。

最後輸入未支援的問題：

```powershell
uv run python examples/basic_graph.py "門市在哪裡？"
```

機器人會說明目前只能協助付款或退貨，路徑為 `understand_question -> answer_unknown`。

`FaqState` 保存 `user_message`、`reply` 與 `path`。`understand_question` 是第一個 node；`choose_branch` 是 conditional edge，依「付款」或「退貨」關鍵字選擇下一個 node；`path` 使用 reducer 累積經過的 node。

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
