from langgraph_python_practice.checkpoint_graph import create_checkpoint_graph


def make_config(thread_id: str) -> dict[str, dict[str, str]]:
    return {"configurable": {"thread_id": thread_id}}


def test_same_thread_accumulates_count_across_invocations() -> None:
    graph = create_checkpoint_graph()
    config = make_config("thread-a")

    graph.invoke({"count": 1, "history": []}, config)
    graph.invoke({"count": 1, "history": []}, config)

    snapshot = graph.get_state(config)
    assert snapshot.values == {
        "count": 2,
        "history": ["目前計數：1", "目前計數：2"],
    }


def test_different_threads_keep_independent_state() -> None:
    graph = create_checkpoint_graph()
    config_a = make_config("thread-a")
    config_b = make_config("thread-b")

    graph.invoke({"count": 1, "history": []}, config_a)
    graph.invoke({"count": 1, "history": []}, config_a)
    graph.invoke({"count": 1, "history": []}, config_b)

    assert graph.get_state(config_a).values == {
        "count": 2,
        "history": ["目前計數：1", "目前計數：2"],
    }
    assert graph.get_state(config_b).values == {
        "count": 1,
        "history": ["目前計數：1"],
    }
