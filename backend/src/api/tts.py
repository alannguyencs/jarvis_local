"""Text to speech API: POST /api/tts."""

import logging
import time

from fastapi import APIRouter, Response

from src.configs import settings
from src.schemas.voice import TtsIn
from src.services import speech_text, tts
from src.services.errors import Invalid, Upstream

log = logging.getLogger(__name__)
router = APIRouter()


@router.post("/tts", response_class=Response, responses={200: {"content": {"audio/wav": {}}}})
async def text_to_speech(body: TtsIn):
    """`text` read aloud, as audio/wav. Markdown is stripped first. 422 when
    nothing speakable is left or the text is too long."""
    text = speech_text.clean(body.text)
    if not text:
        raise Invalid("Nothing to speak")
    if len(text) > settings.max_tts_chars:
        raise Invalid(f"Text is longer than {settings.max_tts_chars} characters")
    started = time.monotonic()
    wav = await tts.synthesize(text)
    duration_ms = int((time.monotonic() - started) * 1000)
    if len(wav) <= 44:  # a WAV header and no samples
        raise Upstream("Could not speak this text")
    seconds = (len(wav) - 44) / 2 / tts.SAMPLE_RATE  # 16-bit mono after the header
    log.info("tts took %d ms for %d chars (%.1f s of speech)", duration_ms, len(text), seconds)
    # The browser reads this to show how long the voice took.
    return Response(content=wav, media_type="audio/wav", headers={"Server-Timing": f"tts;dur={duration_ms}"})
