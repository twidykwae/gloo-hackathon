"""LAMP wiring, tested against a fake of the LAMP repo's serve.py contract:

    POST /predict?top_k=N   multipart field "file"
    -> {"duration": 7.3, "predictions": [{"id": 22, "probability": 0.91, "iso": "eng", "url": ...}]}
"""

import io
import wave

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.identifiers import IdentifierError, LampIdentifier
from app.main import create_app

from .conftest import make_wav

# Real GRN IDs, plus 0 ("no linguistic content").
PREDICTIONS = [
    {"id": 2641, "probability": 0.6, "iso": "tzo", "url": "https://globalrecordings.net/en/language/2641"},
    {"id": 0, "probability": 0.2, "iso": "zxx", "url": "https://globalrecordings.net/en/language/0"},
    {"id": 52, "probability": 0.1, "iso": "spa", "url": "https://globalrecordings.net/en/language/52"},
]


def fake_lamp(requests: list[httpx.Request] | None = None, status: int = 200, body: dict | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        if status != 200:
            return httpx.Response(status, json={"detail": "boom"})
        top_k = int(request.url.params["top_k"])
        return httpx.Response(200, json=body or {"duration": 1.0, "predictions": PREDICTIONS[:top_k]})

    return httpx.MockTransport(handler)


def samples(seconds: float = 1.0) -> np.ndarray:
    return np.zeros(int(16_000 * seconds), dtype=np.float32)


def test_sends_a_16k_wav_and_parses_predictions():
    requests: list[httpx.Request] = []
    lamp = LampIdentifier("http://lamp.test", transport=fake_lamp(requests))
    scores = lamp.identify(samples(), 16_000, limit=10)

    assert [(s.label, s.score) for s in scores] == [("2641", 0.6), ("0", 0.2), ("52", 0.1)]
    [req] = requests
    assert req.url.path == "/predict"
    body = req.read()
    assert b'name="file"; filename="clip.wav"' in body
    with wave.open(io.BytesIO(body[body.index(b"RIFF") :])) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16_000, 1, 2)


def test_top_k_is_capped_at_servers_limit():
    requests: list[httpx.Request] = []
    LampIdentifier("http://lamp.test", transport=fake_lamp(requests)).identify(samples(), 16_000, limit=100)
    assert requests[0].url.params["top_k"] == "50"


def test_server_error_raises_identifier_error():
    lamp = LampIdentifier("http://lamp.test", transport=fake_lamp(status=500))
    with pytest.raises(IdentifierError, match="500"):
        lamp.identify(samples(), 16_000, limit=5)


def test_unexpected_body_raises_identifier_error():
    lamp = LampIdentifier("http://lamp.test", transport=fake_lamp(body={"nope": []}))
    with pytest.raises(IdentifierError, match="unexpected"):
        lamp.identify(samples(), 16_000, limit=5)


def test_unreachable_server_raises_identifier_error():
    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    lamp = LampIdentifier("http://lamp.test", transport=httpx.MockTransport(refuse))
    with pytest.raises(IdentifierError, match="not reachable"):
        lamp.identify(samples(), 16_000, limit=5)


def make_client(transport):
    return TestClient(
        create_app(settings=Settings(), identifier=LampIdentifier("http://lamp.test", transport=transport))
    )


def test_predict_passes_lamp_guesses_through_as_grn_ids():
    body = make_client(fake_lamp()).post("/predict", files={"file": ("a.wav", make_wav(), "audio/wav")}).json()
    assert body["label_kind"] == "grn_language_id"
    assert [p["label"] for p in body["predictions"]] == ["2641", "0", "52"]


def test_predict_returns_502_when_lamp_is_down():
    resp = make_client(fake_lamp(status=500)).post("/predict", files={"file": ("a.wav", make_wav(), "audio/wav")})
    assert resp.status_code == 502
    assert "LAMP" in resp.json()["detail"]
