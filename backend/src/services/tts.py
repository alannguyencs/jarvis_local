"""Text to speech with Kokoro-82M.

The model loads once (at startup, or on first use) and speaks one answer at
a time, in a worker thread so the event loop stays free.
"""

import asyncio
import io
import logging
import os

import numpy as np
import soundfile as sf
from fastapi.concurrency import run_in_threadpool

from src.configs import settings

log = logging.getLogger(__name__)

SAMPLE_RATE = 24_000  # Kokoro's output rate

_pipeline = None
_lock = asyncio.Lock()


def _device() -> str:
    if settings.tts_device != "auto":
        return settings.tts_device
    import torch

    return "mps" if torch.backends.mps.is_available() else "cpu"


def load() -> None:
    """Load the weights (downloaded to the Hugging Face cache on first use),
    then speak a word once: the first run on a device is slow."""
    global _pipeline
    if _pipeline is not None:
        return
    # A few ops Kokoro uses have no Apple GPU version; run those on the CPU.
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    from kokoro import KPipeline  # heavy import: only when needed

    device = _device()
    log.info("Loading TTS model %s on %s", settings.tts_repo, device)
    pipeline = KPipeline(lang_code=settings.tts_lang, repo_id=settings.tts_repo, device=device)
    list(pipeline("Ready.", voice=settings.tts_voice))
    _pipeline = pipeline


def is_loaded() -> bool:
    return _pipeline is not None


def _synthesize(text: str) -> np.ndarray:
    load()
    chunks = [
        result.audio.numpy()
        for result in _pipeline(text, voice=settings.tts_voice, speed=settings.tts_speed)
        if result.audio is not None
    ]
    return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)


def to_wav(samples: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, samples, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


async def synthesize(text: str) -> bytes:
    """`text` spoken by the configured voice, as a 24 kHz 16-bit mono WAV."""
    async with _lock:
        samples = await run_in_threadpool(_synthesize, text)
    return to_wav(samples)
