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
