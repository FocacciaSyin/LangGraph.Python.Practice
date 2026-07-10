import operator
from typing import Annotated, Literal, cast

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class NumberState(TypedDict):
    value: int
    path: Annotated[list[str], operator.add]


def increment(state: NumberState) -> dict[str, object]:
    return {"value": state["value"] + 1, "path": ["increment"]}


def choose_branch(state: NumberState) -> Literal["double", "square"]:
    return "double" if state["value"] % 2 == 0 else "square"


def double(state: NumberState) -> dict[str, object]:
    return {"value": state["value"] * 2, "path": ["double"]}


def square(state: NumberState) -> dict[str, object]:
    return {"value": state["value"] ** 2, "path": ["square"]}


def create_basic_graph():
    builder = StateGraph(NumberState)
    builder.add_node("increment", increment)
    builder.add_node("double", double)
    builder.add_node("square", square)
    builder.add_edge(START, "increment")
    builder.add_conditional_edges("increment", choose_branch)
    builder.add_edge("double", END)
    builder.add_edge("square", END)
    return builder.compile()


def run_basic_graph(value: int) -> NumberState:
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError("value must be an integer")

    result = create_basic_graph().invoke({"value": value, "path": []})
    return cast(NumberState, result)
