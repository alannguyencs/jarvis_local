import pytest

from src.services.speech_text import clean


@pytest.mark.parametrize(
    "markdown, spoken",
    [
        ("The capital of France is Paris.", "The capital of France is Paris."),
        ("**Paris** is the _capital_.", "Paris is the capital."),
        ("## Answer\nIt is Paris", "Answer. It is Paris."),
        ("Three options:\n- red\n- green\n- blue", "Three options: red. green. blue."),
        ("1. First\n2) Second", "First. Second."),
        ("See [the docs](https://example.com) for more.", "See the docs for more."),
        ("Go to https://example.com/x?y=1 now.", "Go to a link now."),
        ("Run `ls -la` here.", "Run ls -la here."),
        ("Like this:\n```python\nprint(1)\n```\nDone.", "Like this: (code omitted). Done."),
        ("| City | People |\n|---|---|\n| Paris | 2.1M |", "City, People. Paris, 2.1M."),
        ("> quoted text", "quoted text."),
        ("Great question! 🎉🚀", "Great question!"),
        ("snake_case_name stays", "snake_case_name stays."),
        ("2 * 3 * 4 = 24", "2 * 3 * 4 = 24."),
        ("---\n\n   \n", ""),
    ],
)
def test_clean(markdown, spoken):
    assert clean(markdown) == spoken
