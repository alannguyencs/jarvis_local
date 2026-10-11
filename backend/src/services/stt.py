"""Speech to text with Parakeet TDT 0.6B v2, run on the Apple GPU by parakeet-mlx.

The model loads once (at startup, or on first use) and runs one recording at
a time, in a worker thread so the event loop stays free.
"""

import asyncio
import logging

import numpy as np
from fastapi.concurrency import run_in_threadpool

from src.configs import settings
from src.services.errors import Invalid

log = logging.getLogger(__name__)

_model = None
_lock = asyncio.Lock()


def load() -> None:
    """Load the weights (downloaded to the Hugging Face cache on first use)."""
    global _model
    if _model is not None:
        return
    from parakeet_mlx import from_pretrained  # heavy import: only when needed

    log.info("Loading STT model %s", settings.stt_model)
    model = from_pretrained(settings.stt_model)
    # The first run is slow (the GPU kernels get built), so do it now on a
    # second of quiet noise instead of on the user's first question.
    _run(model, np.random.default_rng(0).normal(0, 0.01, 16_000).astype(np.float32))
    _model = model


def is_loaded() -> bool:
    return _model is not None


def _run(model, samples: np.ndarray) -> str:
    import mlx.core as mx
    from parakeet_mlx.audio import get_logmel

    mel = get_logmel(mx.array(samples), model.preprocessor_config)
    return model.generate(mel)[0].text.strip()


def _transcribe(samples: np.ndarray) -> str:
    load()
    return _run(_model, samples)


async def transcribe(samples: np.ndarray) -> str:
    """The words in 16 kHz mono `samples`. Raises Invalid when there are none."""
    async with _lock:
        text = await run_in_threadpool(_transcribe, samples)
    if not text:
        raise Invalid("No speech heard")
    return text
