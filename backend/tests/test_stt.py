from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.configs import settings
from src.main import app
from src.services import audio, stt
from src.services.errors import Invalid

FIXTURES = Path(__file__).parent / "fixtures"
QUESTION_WAV = (FIXTURES / "question.wav").read_bytes()  # "What is the capital of France?"
QUESTION_WEBM = (FIXTURES / "question.webm").read_bytes()  # same, as Chrome records it


# --- audio.decode -----------------------------------------------------------


@pytest.mark.parametrize("data", [QUESTION_WAV, QUESTION_WEBM], ids=["wav", "webm"])
def test_decode_gives_16k_mono_float_samples(data):
    samples = audio.decode(data)
    assert samples.dtype.name == "float32"
    assert 1.0 < len(samples) / audio.SAMPLE_RATE < 3.0
    assert samples.min() >= -1.0 and samples.max() <= 1.0


@pytest.mark.parametrize(
    "data, message",
    [(b"", "No audio received"), (b"not audio at all", "Could not read the recording")],
)
def test_decode_rejects_bad_uploads(data, message):
    with pytest.raises(Invalid, match=message):
        audio.decode(data)


def test_decode_rejects_too_long(monkeypatch):
    monkeypatch.setattr(settings, "max_audio_seconds", 0.5)
    with pytest.raises(Invalid, match="longer than 0.5 seconds"):
        audio.decode(QUESTION_WAV)


def test_decode_rejects_too_large(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 100)
    with pytest.raises(Invalid, match="too large"):
        audio.decode(QUESTION_WAV)


# --- POST /api/stt with a fake model ---------------------------------------


def post(data: bytes, mime="audio/webm"):
    with TestClient(app) as client:
        return client.post("/api/stt", files={"audio": ("rec", data, mime)})


def test_stt_returns_text_and_duration(monkeypatch):
    monkeypatch.setattr(stt, "_transcribe", lambda samples: "hello there")
    res = post(QUESTION_WEBM)
    assert res.status_code == 200
    body = res.json()
    assert body["text"] == "hello there"
    assert 1.0 < body["duration_s"] < 3.0


def test_stt_no_speech_is_422(monkeypatch):
    monkeypatch.setattr(stt, "_transcribe", lambda samples: "")
    res = post(QUESTION_WEBM)
    assert res.status_code == 422
    assert res.json() == {"detail": "No speech heard"}


def test_stt_unreadable_upload_is_422():
    res = post(b"garbage")
    assert res.status_code == 422
    assert res.json() == {"detail": "Could not read the recording"}


def test_stt_without_file_is_422():
    with TestClient(app) as client:
        res = client.post("/api/stt")
    assert res.status_code == 422


# --- the real model, when its weights are already downloaded ----------------


def _model_cached() -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:
        return False
    return isinstance(try_to_load_from_cache(settings.stt_model, "model.safetensors"), str)


@pytest.mark.skipif(not _model_cached(), reason="STT weights not downloaded")
def test_real_model_transcribes_the_fixture():
    res = post(QUESTION_WEBM)
    assert res.status_code == 200
    assert res.json()["text"].lower().rstrip("?.") == "what is the capital of france"
