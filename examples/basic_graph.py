import argparse

from langgraph_python_practice.basic_graph import run_basic_graph


def main() -> None:
    parser = argparse.ArgumentParser(description="執行基本 LangGraph 條件分支案例")
    parser.add_argument("value", type=int, help="graph 的起始整數")
    args = parser.parse_args()

    result = run_basic_graph(args.value)
    print(f"結果：{result['value']}")
    print(f"路徑：{' -> '.join(result['path'])}")


if __name__ == "__main__":
    main()
