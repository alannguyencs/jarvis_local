"""Speech to text API: POST /api/stt."""

import logging
import time

from fastapi import APIRouter, File, UploadFile
from fastapi.concurrency import run_in_threadpool

from src.schemas.voice import SttOut
from src.services import audio, stt

log = logging.getLogger(__name__)
router = APIRouter()


@router.post("/stt", response_model=SttOut)
async def speech_to_text(audio_file: UploadFile = File(..., alias="audio")):
    """The words in a browser recording (webm/ogg/mp4/wav). 422 when it is
    empty, unreadable, too short or too long, or has no speech."""
    data = await audio_file.read()
    started = time.monotonic()
    samples = await run_in_threadpool(audio.decode, data)
    text = await stt.transcribe(samples)
    duration_ms = int((time.monotonic() - started) * 1000)
    seconds = round(len(samples) / audio.SAMPLE_RATE, 2)
    log.info("stt took %d ms for %.1f s of audio", duration_ms, seconds)
    return SttOut(text=text, duration_s=seconds, duration_ms=duration_ms)
