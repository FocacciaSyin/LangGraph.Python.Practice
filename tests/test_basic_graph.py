import pytest

from langgraph_python_practice.basic_graph import run_basic_graph


def test_even_value_after_increment_uses_double_branch() -> None:
    result = run_basic_graph(1)

    assert result == {"value": 4, "path": ["increment", "double"]}


def test_odd_value_after_increment_uses_square_branch() -> None:
    result = run_basic_graph(2)

    assert result == {"value": 9, "path": ["increment", "square"]}


def test_non_integer_input_is_rejected() -> None:
    with pytest.raises(TypeError, match="value must be an integer"):
        run_basic_graph("2")  # type: ignore[arg-type]
