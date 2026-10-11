"""Ask Claude by running the `claude -p` CLI, one subprocess per question.

The CLI keeps each conversation's history itself: the first answer comes
with a session id, and passing it back with `--resume` makes the next
question a follow-up.

Starting the CLI takes about 2 s before it even sends the question, so
processes are started ahead of time: one for a new conversation and one
resuming the current conversation. They wait in `--input-format stream-json`
mode (the plain stdin mode gives up after 3 s) until the question arrives.
A question with no matching process waiting starts one on the spot.

`ask_stream()` yields the answer's text as Claude writes it (the CLI's
partial messages), so the page can start speaking at the first sentence.
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
    first_text_ms: int | None = None  # from sending the question to the first words


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
        # Text deltas as Claude writes, so speech can start at the first sentence.
        "--include-partial-messages",
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


def parse_event(line: bytes) -> dict | None:
    """One stream-json output line as a dict; None for anything else."""
    try:
        event = json.loads(line)
    except ValueError:
        return None
    return event if isinstance(event, dict) else None


def text_delta(event: dict) -> str:
    """The new answer text in a partial-message event, else ""."""
    if event.get("type") != "stream_event":
        return ""
    inner = event.get("event") or {}
    delta = inner.get("delta") or {}
    if inner.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
        return delta.get("text") or ""
    return ""


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
            limit=4 * 1024 * 1024,  # one event per line, and a long answer is one event
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


async def ask_stream(text: str, session_id: str | None = None):
    """Claude's answer to `text` as it is written, as a follow-up in
    `session_id` if given. Yields ("session", id) once the CLI has started,
    then ("delta", text) for each piece of the answer, then ("done", Answer).

    Raises NotFound (the session is gone), Timeout, or Upstream (the CLI is
    missing, fails, or returns an error). Stopping early (e.g. the browser
    went away) kills the CLI; the conversation can still be resumed.
    """
    ready = _ready.pop(session_id or "", None)
    warm = bool(ready and ready.usable())
    if ready and not warm:
        _kill(ready.proc)
    proc = ready.proc if warm else await _spawn(session_id)
    stderr = asyncio.create_task(proc.stderr.read())
    new_session_id = session_id
    started = time.monotonic()
    first_text_ms = None
    result = None
    try:
        try:
            proc.stdin.write(user_message(text))
            await proc.stdin.drain()
            proc.stdin.close()
        except (BrokenPipeError, ConnectionResetError):
            pass  # it exited before taking the question; its stderr says why
        try:
            async with asyncio.timeout(settings.ask_timeout_seconds):
                async for line in proc.stdout:
                    event = parse_event(line)
                    if event is None:
                        continue
                    if event.get("type") == "system" and event.get("session_id") and not new_session_id:
                        new_session_id = event["session_id"]
                        yield "session", new_session_id
                    elif delta := text_delta(event):
                        if first_text_ms is None:
                            first_text_ms = int((time.monotonic() - started) * 1000)
                        yield "delta", delta
                    elif event.get("type") == "result":
                        result = event
                        break
                await proc.wait()
        except TimeoutError:
            raise Timeout(f"Claude took longer than {settings.ask_timeout_seconds:g} seconds") from None
        duration_ms = int((time.monotonic() - started) * 1000)

        if result is None:
            message = (await stderr).decode(errors="replace").strip()
            if session_id and "No conversation found" in message:
                raise NotFound("Conversation not found")
            if proc.returncode != 0:
                log.warning("claude exited %s: %s", proc.returncode, message)
                raise Upstream(f"Claude failed: {message or f'exit code {proc.returncode}'}")
            raise Upstream("Claude gave an answer that could not be read")
        answer, new_session_id = parse_result(result)
        log.info(
            "claude answered in %d ms, first words at %s ms (%s, session %s)",
            duration_ms, first_text_ms, "warm" if warm else "cold", new_session_id,
        )  # fmt: skip
        yield "done", Answer(answer, new_session_id, duration_ms, warm, first_text_ms)
    finally:
        _kill(proc)
        stderr.cancel()
        # Ready for a follow-up (also after a stop partway: it still resumes),
        # and for a fresh start ("New conversation").
        if new_session_id:
            prepare(new_session_id)
        prepare(None)


async def ask(text: str, session_id: str | None = None) -> Answer:
    """Claude's whole answer to `text` (see ask_stream)."""
    async for kind, value in ask_stream(text, session_id):
        if kind == "done":
            return value
    raise Upstream("Claude gave no answer")  # not reached: ask_stream raises first
