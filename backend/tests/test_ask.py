import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.configs import settings
from src.main import app
from src.services import claude_cli

FAKE_CLAUDE = Path(__file__).parent / "fixtures" / "fake_claude.py"
NEW_SESSION = "11111111-1111-1111-1111-111111111111"
OLD_SESSION = "22222222-2222-2222-2222-222222222222"
GONE_SESSION = "00000000-0000-0000-0000-000000000000"


@pytest.fixture(autouse=True)
def fake_claude(monkeypatch, tmp_path):
    """Every test runs the fake CLI, never the real `claude`."""
    FAKE_CLAUDE.chmod(0o755)
    monkeypatch.setattr(settings, "ask_cli", str(FAKE_CLAUDE))
    monkeypatch.setattr(settings, "ask_workdir", tmp_path / "workspace")


def ask(body):
    with TestClient(app) as client:
        return client.post("/api/ask", json=body)


# --- build_command ------------------------------------------------------------


def test_command_flags():
    cmd = claude_cli.build_command(None)
    assert cmd[:2] == [str(FAKE_CLAUDE), "-p"]
    flags = {flag: cmd[i + 1] for i, flag in enumerate(cmd[:-1]) if flag.startswith("--")}
    assert flags["--model"] == "sonnet"
    assert flags["--effort"] == "low"
    assert flags["--input-format"] == "stream-json"
    assert flags["--output-format"] == "stream-json"
    assert flags["--tools"] == ""
    assert "--resume" not in cmd
    # Isolated by default: the user's hooks, MCP servers and skills stay out.
    assert "--setting-sources" in cmd and "--strict-mcp-config" in cmd


def test_command_resumes_and_can_skip_isolation(monkeypatch):
    monkeypatch.setattr(settings, "ask_isolated", False)
    cmd = claude_cli.build_command(OLD_SESSION)
    assert cmd[-2:] == ["--resume", OLD_SESSION]
    assert "--setting-sources" not in cmd


def test_child_env_drops_the_parent_claude_session(monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "parent")
    monkeypatch.setenv("CLAUDE_EFFORT", "medium")
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", "/keep/me")
    env = claude_cli.child_env()
    assert "CLAUDE_CODE_SESSION_ID" not in env and "CLAUDE_EFFORT" not in env
    assert env["CLAUDE_CONFIG_DIR"] == "/keep/me"
    assert env["PATH"]


# --- POST /api/ask ------------------------------------------------------------------


def test_first_question_starts_a_session():
    res = ask({"text": "  What is the capital of France?  "})
    assert res.status_code == 200
    body = res.json()
    # The question went in on stdin, trimmed.
    assert body["answer"] == "echo: What is the capital of France?"
    assert body["session_id"] == NEW_SESSION
    assert body["duration_ms"] >= 0


def test_follow_up_resumes_the_session():
    res = ask({"text": "And Germany?", "session_id": OLD_SESSION})
    assert res.status_code == 200
    assert res.json()["session_id"] == OLD_SESSION


def test_question_starting_with_dashes_is_not_a_flag():
    res = ask({"text": "--help"})
    assert res.status_code == 200
    assert res.json()["answer"] == "echo: --help"


def test_runs_in_the_workdir(tmp_path):
    ask({"text": "hi"})
    assert (tmp_path / "workspace").is_dir()


@pytest.mark.parametrize("body", [{"text": ""}, {"text": "   "}, {"text": "hi", "session_id": "not-a-uuid"}])
def test_bad_requests_are_422(body):
    assert ask(body).status_code == 422


def test_gone_session_is_404():
    res = ask({"text": "hi", "session_id": GONE_SESSION})
    assert res.status_code == 404
    assert res.json() == {"detail": "Conversation not found"}


@pytest.mark.parametrize(
    "text, detail",
    [
        ("CRASH", "Claude failed: boom"),
        ("ERROR", "Claude failed: Not logged in · Please run /login"),
        ("GARBAGE", "Claude gave an answer that could not be read"),
    ],
)
def test_claude_failures_are_502(text, detail):
    res = ask({"text": text})
    assert res.status_code == 502
    assert res.json() == {"detail": detail}


def test_missing_cli_is_502(monkeypatch):
    monkeypatch.setattr(settings, "ask_cli", "/nonexistent/claude")
    res = ask({"text": "hi"})
    assert res.status_code == 502
    assert res.json() == {"detail": "Claude CLI not found: /nonexistent/claude"}


def test_timeout_is_504_and_kills_the_process(monkeypatch):
    monkeypatch.setattr(settings, "ask_timeout_seconds", 0.5)
    res = ask({"text": "SLEEP"})
    assert res.status_code == 504
    assert res.json() == {"detail": "Claude took longer than 0.5 seconds"}


# --- parsing ------------------------------------------------------------------


def test_parse_result_rejects_empty_answer():
    with pytest.raises(Exception, match="empty answer"):
        claude_cli.parse_result({"subtype": "success", "is_error": False, "result": " ", "session_id": NEW_SESSION})


def test_find_result_skips_other_events_and_junk():
    out = b'{"type":"system","subtype":"init"}\nnot json\n{"type":"result","result":"hi"}\n'
    assert claude_cli.find_result(out) == {"type": "result", "result": "hi"}
    assert claude_cli.find_result(b"nothing here") is None


# --- processes started ahead of time --------------------------------------------


@pytest.fixture
def prewarm(monkeypatch):
    monkeypatch.setattr(settings, "ask_prewarm", True)


def test_cold_without_prewarm():
    res = ask({"text": "hi"})
    assert res.json()["warm"] is False


def test_prewarmed_processes_answer_new_and_follow_up_questions(prewarm):
    with TestClient(app) as client:
        # Startup prepared one for a new conversation.
        time.sleep(0.3)
        first = client.post("/api/ask", json={"text": "first"}).json()
        assert first["warm"] is True
        assert first["answer"] == "echo: first"
        # The answer prepared one resuming its session...
        time.sleep(0.3)
        follow = client.post("/api/ask", json={"text": "again", "session_id": first["session_id"]}).json()
        assert follow["warm"] is True
        assert follow["session_id"] == first["session_id"]
        # ...but a session nobody prepared for runs cold.
        other = client.post("/api/ask", json={"text": "x", "session_id": OLD_SESSION}).json()
        assert other["warm"] is False
    # Shutdown stopped every waiting process.
    assert claude_cli._ready == {}


def test_only_the_latest_conversation_keeps_a_ready_process(prewarm):
    with TestClient(app) as client:
        time.sleep(0.3)
        for session in (OLD_SESSION, "33333333-3333-3333-3333-333333333333", NEW_SESSION):
            client.portal.call(claude_cli._prepare, session)
        time.sleep(0.2)
        assert sorted(claude_cli._ready) == ["", NEW_SESSION]
        procs = [r.proc for r in claude_cli._ready.values()]
    assert all(p.returncode is not None for p in procs)


def test_a_stale_ready_process_is_replaced(prewarm, monkeypatch):
    monkeypatch.setattr(settings, "ask_warm_max_age_seconds", 0)
    with TestClient(app) as client:
        time.sleep(0.2)
        assert client.post("/api/ask", json={"text": "hi"}).json()["warm"] is False


def test_gone_session_is_404_even_when_prepared(prewarm):
    """The prepared --resume process exits at once; the cold retry reports it."""
    with TestClient(app) as client:
        client.portal.call(claude_cli._prepare, GONE_SESSION)  # on the app's event loop
        time.sleep(0.2)
        res = client.post("/api/ask", json={"text": "hi", "session_id": GONE_SESSION})
    assert res.status_code == 404
