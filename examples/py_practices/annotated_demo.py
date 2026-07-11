import operator
from typing import Annotated
from typing_extensions import TypedDict


def merge_state(old: list[str], new: list[str]) -> list[str]:
    return old + new


def sum(first: int, second: int) -> int:
    return first + second


class FaqState(TypedDict):
    user_message: str
    reply: str
    path: Annotated[list[str], operator.add]


def sample_hello_world() -> None:
    print("Hello, LangGraph!")
    result = sum(1, 2)
    print("1 + 2 =", result)


def sample_FaqState() -> None:
    state_1: FaqState = {"user_message": "如何付款？", "reply": "", "path": []}
    print("初始狀態:", state_1)
    state_1["reply"] = "您可以使用信用卡或轉帳付款。"
    print("更新後狀態:", state_1)

    state_1["path"] = ["first_node"]
    print("加入第一個", state_1)
    # 可以用 append() 方法把新的節點加入 path 清單
    state_1["path"].append("second_node")
    # 可以用 +
    state_1["path"] = state_1["path"] + ["third_node"]

    print("加入結果", state_1)


def main() -> None:
    # sample_hello_world()
    sample_FaqState()


if __name__ == "__main__":
    main()
