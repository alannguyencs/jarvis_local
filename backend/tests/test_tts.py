import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from src.configs import settings
from src.main import app
from src.services import tts


def speak(text):
    with TestClient(app) as client:
        return client.post("/api/tts", json={"text": text})


@pytest.fixture
def fake_voice(monkeypatch):
    """Records what the model was asked to say; answers with 0.5 s of tone."""
    said = []

    def fake(text):
        said.append(text)
        t = np.arange(tts.SAMPLE_RATE // 2) / tts.SAMPLE_RATE
        return (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

    monkeypatch.setattr(tts, "_synthesize", fake)
    return said


def test_returns_a_24k_wav_of_the_cleaned_text(fake_voice):
    res = speak("**Paris** is the capital.")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    samples, rate = sf.read(io.BytesIO(res.content))
    assert rate == 24_000
    assert len(samples) == 12_000
    assert fake_voice == ["Paris is the capital."]


@pytest.mark.parametrize("text", ["", "---", "\n\n"])
def test_nothing_speakable_is_422(fake_voice, text):
    assert speak(text).status_code == 422
    assert fake_voice == []


def test_too_long_is_422(fake_voice, monkeypatch):
    monkeypatch.setattr(settings, "max_tts_chars", 10)
    res = speak("This sentence is longer than ten characters.")
    assert res.status_code == 422
    assert res.json() == {"detail": "Text is longer than 10 characters"}


def test_empty_audio_is_502(monkeypatch):
    monkeypatch.setattr(tts, "_synthesize", lambda text: np.zeros(0, np.float32))
    res = speak("Hello.")
    assert res.status_code == 502
    assert res.json() == {"detail": "Could not speak this text"}


# --- the real models, when their weights are already downloaded -------------


def _cached(repo, filename) -> bool:
    from huggingface_hub import try_to_load_from_cache

    return isinstance(try_to_load_from_cache(repo, filename), str)


@pytest.mark.skipif(
    not (_cached(settings.tts_repo, "kokoro-v1_0.pth") and _cached(settings.stt_model, "model.safetensors")),
    reason="TTS or STT weights not downloaded",
)
def test_round_trip_speech_is_understood():
    """Kokoro says it, Parakeet hears it: the words must survive."""
    res = speak("The capital of France is **Paris**.")
    assert res.status_code == 200
    with TestClient(app) as client:
        heard = client.post("/api/stt", files={"audio": ("answer.wav", res.content, "audio/wav")})
    assert heard.status_code == 200
    assert heard.json()["text"].lower().rstrip(".") == "the capital of france is paris"
