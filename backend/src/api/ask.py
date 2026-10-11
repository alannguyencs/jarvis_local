"""Ask Claude API: POST /api/ask."""

from fastapi import APIRouter

from src.schemas.voice import AskIn, AskOut
from src.services import claude_cli
from src.services.errors import Invalid

router = APIRouter()


@router.post("/ask", response_model=AskOut)
async def ask(body: AskIn):
    """Claude's answer to `text`; a follow-up when `session_id` is given.
    404 if that conversation is gone, 502 if Claude fails, 504 on timeout."""
    text = body.text.strip()
    if not text:
        raise Invalid("Question is empty")
    session_id = str(body.session_id) if body.session_id else None
    answer = await claude_cli.ask(text, session_id)
    return AskOut(
        answer=answer.text, session_id=answer.session_id, duration_ms=answer.duration_ms, warm=answer.warm
    )
