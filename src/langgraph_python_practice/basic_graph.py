# ============================================================
#  FAQ 客服 Graph 流程圖
# ============================================================
#
#              START
#                │
#                ▼
#      ┌──────────────────┐
#      │ understand_question │  ← 節點 1：讀取問題、蓋章記錄
#      └────────┬─────────┘
#               │
#               ▼
#         choose_branch       ← 條件分支：檢查 user_message 關鍵字
#        ╱      │       ╲
#    "付款"   "退貨"   其他
#      │        │        │
#      ▼        ▼        ▼
#  ┌────────┐┌────────┐┌────────┐
#  │answer_ ││answer_ ││answer_ │
#  │payment ││return  ││unknown │  ← 節點 2~4：各自回覆答案 + 蓋章
#  └───┬────┘└───┬────┘└───┬────┘
#      │         │         │
#      └────┬────┘─────────┘
#           ▼
#          END
#
#  State 結構（FaqState）：
#    user_message : str                        → 使用者原始輸入
#    reply        : str                        → 客服回覆內容
#    path         : Annotated[list[str], add]  → 節點路徑（自動累積）
#
# 執行範例：
#   uv run python examples/basic_graph.py "如何付款？"
#   → 路徑：understand_question -> answer_payment
#   → 回覆：您可以使用信用卡或轉帳付款。
# ============================================================

import operator
from typing import Annotated, Literal, cast

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


# 宣告一個 TypedDict，表示我們的狀態字典結構
class FaqState(TypedDict):
    user_message: str
    reply: str
    path: Annotated[list[str], operator.add]


# 等同 C# Metod =>
# public static FaqState understand_question(FaqState state)
# { return new FaqState { path = new List<string> { "understand_question" } }; }
def understand_question(state: FaqState) -> dict[str, list[str]]:
    return {"path": ["understand_question"]}


# Literal 是 Python 型別系統裡的限定值：這個函式只會回傳這幾個字串，不會有其他。
def choose_branch(
    state: FaqState,
) -> Literal["answer_payment", "answer_return", "answer_unknown"]:
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
    # Node
    builder.add_node("understand_question", understand_question)
    builder.add_node("answer_payment", answer_payment)
    builder.add_node("answer_return", answer_return)
    builder.add_node("answer_unknown", answer_unknown)

    # Edge
    builder.add_edge(START, "understand_question")
    # Conditional Edge 不會自動累積 path
    builder.add_conditional_edges("understand_question", choose_branch)
    builder.add_edge("answer_payment", END)
    builder.add_edge("answer_return", END)
    builder.add_edge("answer_unknown", END)

    return builder.compile()


def run_basic_graph(user_message: str) -> FaqState:
    if not isinstance(user_message, str) or not user_message.strip():
        raise TypeError("user_message must be a non-empty string")

    result = create_basic_graph().invoke(
        {"user_message": user_message, "reply": "", "path": []}
    )
    return cast(FaqState, result)
