"""Request and response bodies for the voice loop."""

import uuid

from pydantic import BaseModel, Field


class SttOut(BaseModel):
    text: str
    duration_s: float  # length of the recording
    duration_ms: int  # time to decode and transcribe it


class AskIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    # Claude Code's session id from the previous answer; omit to start fresh.
    session_id: uuid.UUID | None = None


class AskOut(BaseModel):
    answer: str
    session_id: str
    duration_ms: int  # from sending the question to the answer
    warm: bool  # answered by a Claude process started ahead of time
    first_text_ms: int | None = None  # from sending the question to the first words


class TtsIn(BaseModel):
    text: str = Field(min_length=1)
