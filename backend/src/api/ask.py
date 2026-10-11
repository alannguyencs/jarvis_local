"""Ask Claude API: POST /api/ask and POST /api/ask/stream."""

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from src.schemas.voice import AskIn, AskOut
from src.services import claude_cli
from src.services.errors import Invalid, NotFound, Timeout, Upstream

router = APIRouter()

# The status each failure would have had as a plain response.
_STATUS = {NotFound: 404, Upstream: 502, Timeout: 504}


def _question(body: AskIn) -> tuple[str, str | None]:
    text = body.text.strip()
    if not text:
        raise Invalid("Question is empty")
    return text, str(body.session_id) if body.session_id else None


def _done(answer: claude_cli.Answer) -> dict:
    return AskOut(
        answer=answer.text,
        session_id=answer.session_id,
        duration_ms=answer.duration_ms,
        warm=answer.warm,
        first_text_ms=answer.first_text_ms,
    ).model_dump()


@router.post("/ask", response_model=AskOut)
async def ask(body: AskIn):
    """Claude's answer to `text`; a follow-up when `session_id` is given.
    404 if that conversation is gone, 502 if Claude fails, 504 on timeout."""
    return _done(await claude_cli.ask(*_question(body)))


@router.post("/ask/stream")
async def ask_stream(body: AskIn):
    """Claude's answer as it is written, as newline-delimited JSON events:

    - {"type": "session", "session_id"}: the conversation, before any text
    - {"type": "delta", "text"}: the next piece of the answer
    - {"type": "done", ...}: the whole answer, as POST /api/ask returns it
    - {"type": "error", "status", "detail"}: what went wrong, with the status
      POST /api/ask would have answered (404, 502, 504)

    An empty question is a plain 422. Closing the request stops Claude.
    """
    text, session_id = _question(body)

    async def events():
        try:
            async for kind, value in claude_cli.ask_stream(text, session_id):
                if kind == "session":
                    event = {"type": "session", "session_id": value}
                elif kind == "delta":
                    event = {"type": "delta", "text": value}
                else:
                    event = {"type": "done", **_done(value)}
                yield json.dumps(event) + "\n"
        except (NotFound, Upstream, Timeout) as e:
            yield json.dumps({"type": "error", "status": _STATUS[type(e)], "detail": str(e)}) + "\n"

    # no-transform: keep proxies from buffering the stream.
    return StreamingResponse(
        events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache, no-transform"}
    )
