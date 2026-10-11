from fastapi.testclient import TestClient

from src.main import app


def test_health():
    with TestClient(app) as client:
        res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    # True once any test has loaded the real model.
    assert isinstance(body["stt_loaded"], bool)
    assert isinstance(body["tts_loaded"], bool)


def test_unknown_api_path_is_json_404():
    with TestClient(app) as client:
        res = client.get("/api/nope")
    assert res.status_code == 404
    assert res.json() == {"detail": "Not Found"}
