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
