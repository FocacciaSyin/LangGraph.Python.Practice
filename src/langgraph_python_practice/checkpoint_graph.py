import operator
from typing import Annotated

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class CounterState(TypedDict):
    count: Annotated[int, operator.add]
    history: Annotated[list[str], operator.add]


def record_count(state: CounterState) -> dict[str, list[str]]:
    return {"history": [f"目前計數：{state['count']}"]}


def create_checkpoint_graph():
    builder = StateGraph(CounterState)
    builder.add_node("record_count", record_count)
    builder.add_edge(START, "record_count")
    builder.add_edge("record_count", END)
    return builder.compile(checkpointer=InMemorySaver())
