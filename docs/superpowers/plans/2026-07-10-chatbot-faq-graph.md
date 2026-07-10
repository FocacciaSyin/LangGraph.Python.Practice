# 客服 FAQ Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Basic Graph 改為可執行且可測試的客服 FAQ 聊天機器人，展示訊息路由與固定回覆。

**Architecture:** `FaqState` 保存單次使用者問題、機器人回覆與累積路徑。`understand_question` 後的 conditional edge 依付款、退貨或未知問題分流至回覆 node；CLI 與 README 使用相同對話輸入示範此流程。

**Tech Stack:** Python 3.12、LangGraph、pytest、Ruff、uv。

## Global Constraints

- 使用 Python `>=3.12,<3.13`、`uv` 與既有 LangGraph 相依套件。
- 不使用 LLM API 或 `.env`；FAQ 路由由固定關鍵字決定。
- 付款關鍵字優先於退貨關鍵字；未知問題必須有固定回覆。
- `path` 必須使用 `Annotated[list[str], operator.add]` 累積 node 名稱。
- 不調整 Checkpoint Graph。
- 除非使用者明確要求，勿建立 Git commit。

---

## File Structure

- Modify: `src/langgraph_python_practice/basic_graph.py`：FAQ state、node、路由與執行入口。
- Modify: `tests/test_basic_graph.py`：付款、退貨、未知與無效輸入行為測試。
- Modify: `examples/basic_graph.py`：單一使用者問題 CLI。
- Modify: `README.md`：客服 FAQ 的逐步操作與解釋。

### Task 1: 以測試驅動實作 FAQ 工作流

**Files:**
- Modify: `tests/test_basic_graph.py`
- Modify: `src/langgraph_python_practice/basic_graph.py`

**Interfaces:**
- Produces: `run_basic_graph(user_message: str) -> FaqState`。
- Produces: `FaqState`，包含 `user_message: str`、`reply: str` 與累積的 `path`。

- [ ] **Step 1: 用 FAQ 行為取代既有數字測試**

```python
import pytest

from langgraph_python_practice.basic_graph import run_basic_graph


def test_payment_question_routes_to_payment_answer() -> None:
    assert run_basic_graph("如何付款？") == {
        "user_message": "如何付款？",
        "reply": "您可以使用信用卡或轉帳付款。",
        "path": ["understand_question", "answer_payment"],
    }


def test_return_question_routes_to_return_answer() -> None:
    assert run_basic_graph("我要退貨") == {
        "user_message": "我要退貨",
        "reply": "請在收到商品後七天內申請退貨。",
        "path": ["understand_question", "answer_return"],
    }


def test_unknown_question_routes_to_unknown_answer() -> None:
    assert run_basic_graph("門市在哪裡？") == {
        "user_message": "門市在哪裡？",
        "reply": "我目前可以協助付款或退貨問題。",
        "path": ["understand_question", "answer_unknown"],
    }


@pytest.mark.parametrize("user_message", ["", "   ", 1])
def test_empty_or_non_string_question_is_rejected(user_message: object) -> None:
    with pytest.raises(TypeError, match="user_message must be a non-empty string"):
        run_basic_graph(user_message)  # type: ignore[arg-type]
```

- [ ] **Step 2: 執行測試確認尚未符合新介面**

Run: `uv run pytest tests/test_basic_graph.py`

Expected: FAIL，因目前 `run_basic_graph` 仍要求整數並回傳數字 state。

- [ ] **Step 3: 實作 FAQ state、node、路由與入口**

將 `src/langgraph_python_practice/basic_graph.py` 替換為：

```python
import operator
from typing import Annotated, Literal, cast

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class FaqState(TypedDict):
    user_message: str
    reply: str
    path: Annotated[list[str], operator.add]


def understand_question(state: FaqState) -> dict[str, list[str]]:
    return {"path": ["understand_question"]}


def choose_branch(state: FaqState) -> Literal["answer_payment", "answer_return", "answer_unknown"]:
    if "付款" in state["user_message"]:
        return "answer_payment"
    if "退貨" in state["user_message"]:
        return "answer_return"
    return "answer_unknown"


def answer_payment(state: FaqState) -> dict[str, object]:
    return {"reply": "您可以使用信用卡或轉帳付款。", "path": ["answer_payment"]}


def answer_return(state: FaqState) -> dict[str, object]:
    return {"reply": "請在收到商品後七天內申請退貨。", "path": ["answer_return"]}


def answer_unknown(state: FaqState) -> dict[str, object]:
    return {"reply": "我目前可以協助付款或退貨問題。", "path": ["answer_unknown"]}


def create_basic_graph():
    builder = StateGraph(FaqState)
    builder.add_node("understand_question", understand_question)
    builder.add_node("answer_payment", answer_payment)
    builder.add_node("answer_return", answer_return)
    builder.add_node("answer_unknown", answer_unknown)
    builder.add_edge(START, "understand_question")
    builder.add_conditional_edges("understand_question", choose_branch)
    builder.add_edge("answer_payment", END)
    builder.add_edge("answer_return", END)
    builder.add_edge("answer_unknown", END)
    return builder.compile()


def run_basic_graph(user_message: str) -> FaqState:
    if not isinstance(user_message, str) or not user_message.strip():
        raise TypeError("user_message must be a non-empty string")

    result = create_basic_graph().invoke({"user_message": user_message, "reply": "", "path": []})
    return cast(FaqState, result)
```

- [ ] **Step 4: 執行聚焦測試確認工作流行為**

Run: `uv run pytest tests/test_basic_graph.py`

Expected: 6 個測試通過。

### Task 2: 將 CLI 與 README 對齊 FAQ 對話範例

**Files:**
- Modify: `examples/basic_graph.py`
- Modify: `README.md:21-37`

**Interfaces:**
- Consumes: `run_basic_graph(user_message: str) -> FaqState`。
- Produces: 一個位置參數 `user_message` 的 CLI 與三種可複製的 README 示例。

- [ ] **Step 1: 修改 CLI 接收使用者問題並輸出回覆與路徑**

```python
import argparse

from langgraph_python_practice.basic_graph import run_basic_graph


def main() -> None:
    parser = argparse.ArgumentParser(description="執行客服 FAQ LangGraph 範例")
    parser.add_argument("user_message", help="使用者的客服問題")
    args = parser.parse_args()

    result = run_basic_graph(args.user_message)
    print(f"機器人：{result['reply']}")
    print(f"路徑：{' -> '.join(result['path'])}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 將 README 的 Basic Graph 區段改為 FAQ 教學**

用下列內容取代 README 的 `## 2. 執行 Basic Graph` 區段，保留後續 Checkpoint Graph 區段：

````markdown
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
````

- [ ] **Step 3: 執行三個 README 命令確認輸出**

Run: `uv run python examples/basic_graph.py "如何付款？"`

Expected: 回覆包含 `您可以使用信用卡或轉帳付款。`，路徑為 `understand_question -> answer_payment`。

Run: `uv run python examples/basic_graph.py "我要退貨"`

Expected: 回覆包含 `請在收到商品後七天內申請退貨。`，路徑為 `understand_question -> answer_return`。

Run: `uv run python examples/basic_graph.py "門市在哪裡？"`

Expected: 回覆包含 `我目前可以協助付款或退貨問題。`，路徑為 `understand_question -> answer_unknown`。

- [ ] **Step 4: 執行完整驗證**

Run: `uv run ruff check .`

Expected: 結束碼為 `0`。

Run: `uv run ruff format --check .`

Expected: 結束碼為 `0`。

Run: `uv run pytest`

Expected: 所有測試通過。

## 自我檢查

- Spec coverage：Task 1 實作 state、路由、回覆、輸入驗證與測試；Task 2 實作 CLI 與 README 教學。
- Placeholder scan：計畫不含暫留項或未定義的後續工作。
- Type consistency：所有任務都使用 `FaqState`、`user_message` 與 `run_basic_graph(user_message: str)`。
