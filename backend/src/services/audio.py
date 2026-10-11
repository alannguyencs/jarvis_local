"""Decode a browser recording (webm/ogg/mp4/wav) into 16 kHz mono samples."""

import subprocess
import tempfile

import numpy as np

from src.configs import settings
from src.services.errors import Invalid

SAMPLE_RATE = 16_000  # what Parakeet expects
# Under a quarter second there is nothing to transcribe.
MIN_SAMPLES = SAMPLE_RATE // 4


def decode(data: bytes) -> np.ndarray:
    """float32 samples in [-1, 1] at 16 kHz mono. Raises Invalid when the
    upload is empty, too big, unreadable, too short or too long.

    Goes through a temp file, not a pipe: Safari's mp4 keeps its index at the
    end, which ffmpeg can only reach in a file it can seek.
    """
    if not data:
        raise Invalid("No audio received")
    if len(data) > settings.max_upload_bytes:
        raise Invalid("Recording is too large")
    with tempfile.NamedTemporaryFile() as src:
        src.write(data)
        src.flush()
        cmd = [
            "ffmpeg", "-nostdin", "-loglevel", "error", "-i", src.name,
            "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
        ]  # fmt: skip
        result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise Invalid("Could not read the recording")
    samples = np.frombuffer(result.stdout, np.int16).astype(np.float32) / 32768.0
    if len(samples) < MIN_SAMPLES:
        raise Invalid("Recording is too short")
    if len(samples) > settings.max_audio_seconds * SAMPLE_RATE:
        raise Invalid(f"Recording is longer than {settings.max_audio_seconds:g} seconds")
    return samples
