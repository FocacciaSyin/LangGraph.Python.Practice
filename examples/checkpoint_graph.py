from langgraph_python_practice.checkpoint_graph import create_checkpoint_graph


def main() -> None:
    graph = create_checkpoint_graph()
    thread_a = {"configurable": {"thread_id": "thread-a"}}
    thread_b = {"configurable": {"thread_id": "thread-b"}}

    graph.invoke({"count": 1, "history": []}, thread_a)
    graph.invoke({"count": 1, "history": []}, thread_a)
    graph.invoke({"count": 1, "history": []}, thread_b)

    print(f"thread-a：{graph.get_state(thread_a).values}")
    print(f"thread-b：{graph.get_state(thread_b).values}")


if __name__ == "__main__":
    main()
