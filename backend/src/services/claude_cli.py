"""Ask Claude by running the `claude -p` CLI, one subprocess per question.

The CLI keeps each conversation's history itself: the first answer comes
with a session id, and passing it back with `--resume` makes the next
question a follow-up.

Starting the CLI takes about 2 s before it even sends the question, so
processes are started ahead of time: one for a new conversation and one
resuming the current conversation. They wait in `--input-format stream-json`
mode (the plain stdin mode gives up after 3 s) until the question arrives.
A question with no matching process waiting starts one on the spot.
"""

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass

from src.configs import settings
from src.services.errors import NotFound, Timeout, Upstream

log = logging.getLogger(__name__)

# The answer is read aloud, so it must sound right when spoken.
VOICE_PROMPT = """\
You are Jarvis, a voice assistant. The user speaks to you, their words are \
transcribed, and your reply is read aloud by a text-to-speech voice.
- Answer in plain spoken sentences: no markdown, headings, bullet points, \
tables, code blocks, URLs or emoji.
- Keep it short, about two to five sentences, unless the user asks for more.
- Write numbers, dates, units and symbols the way they are said aloud.
- When a list is needed, say how many items there are and name them in one \
or two sentences.
- The transcript may have small speech-recognition mistakes; read past them. \
If the question is unclear, ask one short question back."""


@dataclass
class Answer:
    text: str
    session_id: str
    duration_ms: int  # from sending the question to the answer
    warm: bool  # a process started ahead of time answered


@dataclass
class _Ready:
    """A CLI process started ahead of time, waiting for its question."""

    proc: asyncio.subprocess.Process
    started: float  # time.monotonic()

    def usable(self) -> bool:
        fresh = time.monotonic() - self.started < settings.ask_warm_max_age_seconds
        return self.proc.returncode is None and fresh


# Keyed by the session the process resumes ("" = a new conversation); at
# most one conversation besides "" (see _prepare).
_ready: dict[str, _Ready] = {}
_tasks: set[asyncio.Task] = set()


def child_env() -> dict[str, str]:
    """This process's environment without the variables a parent Claude Code
    session sets (CLAUDE_CODE_SESSION_ID, its messaging socket, CLAUDE_EFFORT,
    ...). When the app is started from inside Claude Code they would make
    every question look like part of that session."""
    return {
        k: v
        for k, v in os.environ.items()
        if not k.startswith("CLAUDE_CODE_") and k not in ("CLAUDE_PID", "CLAUDE_EFFORT")
    }


def build_command(session_id: str | None) -> list[str]:
    """The argv for one question. The question itself goes in on stdin, as a
    stream-json message, so text starting with "-" is never read as a flag."""
    cmd = [
        settings.ask_cli, "-p",
        "--model", settings.ask_model,
        "--effort", settings.ask_effort,
        "--input-format", "stream-json",
        "--output-format", "stream-json", "--verbose",
        "--append-system-prompt", VOICE_PROMPT,
        "--tools", settings.ask_tools,
    ]  # fmt: skip
    if settings.ask_isolated:
        cmd += ["--setting-sources", "project", "--strict-mcp-config", "--disable-slash-commands"]
    if session_id:
        cmd += ["--resume", session_id]
    return cmd


def user_message(text: str) -> bytes:
    """The question as one stream-json input line."""
    return (json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n").encode()


def find_result(stdout: bytes) -> dict | None:
    """The `result` event among the stream-json output lines, if any."""
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and event.get("type") == "result":
            return event
    return None


def parse_result(result: dict) -> tuple[str, str]:
    """(answer, session_id) from the CLI's result event. Raises Upstream."""
    if result.get("is_error") or result.get("subtype") != "success":
        detail = result.get("result") or result.get("subtype") or "unknown error"
        raise Upstream(f"Claude failed: {detail}")
    answer = (result.get("result") or "").strip()
    if not answer or not result.get("session_id"):
        raise Upstream("Claude gave an empty answer")
    return answer, result["session_id"]


async def _spawn(session_id: str | None) -> asyncio.subprocess.Process:
    workdir = settings.ask_workdir_path
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        return await asyncio.create_subprocess_exec(
            *build_command(session_id),
            cwd=workdir,
            env=child_env(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        raise Upstream(f"Claude CLI not found: {settings.ask_cli}") from None


def _kill(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is None:
        proc.kill()


async def _prepare(session_id: str | None) -> None:
    key = session_id or ""
    # At most two wait: one for a new conversation and one for the latest
    # conversation. An older conversation's process would never be used.
    if key:
        for old in [k for k in _ready if k and k != key]:
            _kill(_ready.pop(old).proc)
    if key in _ready and _ready[key].usable():
        return
    if key in _ready:
        _kill(_ready.pop(key).proc)
    try:
        proc = await _spawn(session_id)
    except Upstream as e:
        log.warning("could not start a ready Claude process: %s", e)
        return
    if key in _ready:  # another prepare won the race
        _kill(proc)
    else:
        _ready[key] = _Ready(proc, time.monotonic())


def prepare(session_id: str | None) -> None:
    """Start a process for the next question in `session_id` (None = a new
    conversation) in the background, unless one is already waiting."""
    if not settings.ask_prewarm:
        return
    task = asyncio.create_task(_prepare(session_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def shutdown() -> None:
    """Stop every waiting process (on app shutdown)."""
    for task in list(_tasks):
        task.cancel()
    for ready in _ready.values():
        _kill(ready.proc)
        await ready.proc.wait()
    _ready.clear()


async def ask(text: str, session_id: str | None = None) -> Answer:
    """Claude's answer to `text`, as a follow-up in `session_id` if given.

    Raises NotFound (the session is gone), Timeout, or Upstream (the CLI is
    missing, fails, or returns an error).
    """
    ready = _ready.pop(session_id or "", None)
    warm = bool(ready and ready.usable())
    if ready and not warm:
        _kill(ready.proc)
    proc = ready.proc if warm else await _spawn(session_id)

    started = time.monotonic()
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(user_message(text)), settings.ask_timeout_seconds
        )
    except asyncio.TimeoutError:
        _kill(proc)
        await proc.wait()
        raise Timeout(f"Claude took longer than {settings.ask_timeout_seconds:g} seconds") from None
    duration_ms = int((time.monotonic() - started) * 1000)

    # A process that exited before taking the question (e.g. an unknown
    # --resume id) leaves no result; communicate() ignores the broken pipe.
    result = find_result(stdout)
    if proc.returncode != 0 and result is None:
        message = stderr.decode(errors="replace").strip()
        if session_id and "No conversation found" in message:
            raise NotFound("Conversation not found")
        log.warning("claude exited %s: %s", proc.returncode, message)
        raise Upstream(f"Claude failed: {message or f'exit code {proc.returncode}'}")
    if result is None:
        raise Upstream("Claude gave an answer that could not be read")

    answer, new_session_id = parse_result(result)
    log.info(
        "claude answered in %d ms (%s, session %s)", duration_ms, "warm" if warm else "cold", new_session_id
    )
    # Ready for a follow-up, and for a fresh start ("New conversation").
    prepare(new_session_id)
    prepare(None)
    return Answer(text=answer, session_id=new_session_id, duration_ms=duration_ms, warm=warm)
