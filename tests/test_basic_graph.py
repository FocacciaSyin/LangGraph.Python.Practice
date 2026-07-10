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
