import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.identifiers import StubIdentifier
from app.main import create_app

from .conftest import make_wav


@pytest.fixture
def client():
    return TestClient(create_app(settings=Settings(), identifier=StubIdentifier(["vie", "tzo", "spa"])))


def predict(client, **params):
    return client.post("/predict", files={"file": ("clip.wav", make_wav(), "audio/wav")}, params=params)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok", "identifier": "stub"}


def test_predict_returns_every_guess_best_first(client):
    body = predict(client).json()
    assert body["model"] == "stub"
    assert body["label_kind"] == "iso639_3"
    assert body["duration"] == 1.0
    assert [p["label"] for p in body["predictions"]] == ["vie", "tzo", "spa"]
    probabilities = [p["probability"] for p in body["predictions"]]
    assert probabilities == sorted(probabilities, reverse=True)


def test_predict_top_k(client):
    assert [p["label"] for p in predict(client, top_k=2).json()["predictions"]] == ["vie", "tzo"]


def test_predict_rejects_audio_it_cannot_read(client):
    resp = client.post("/predict", files={"file": ("clip.webm", b"nope", "audio/webm")})
    assert resp.status_code == 400


def test_serves_the_page(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert '<script type="module" src="js/main.js">' in resp.text
    assert client.get("/js/main.js").status_code == 200
    assert client.get("/data/languages.json").status_code == 200


def test_browsers_always_check_for_newer_page_files(client):
    for path in ("/", "/js/main.js", "/data/languages.json"):
        assert client.get(path).headers["cache-control"] == "no-cache"


def test_does_not_serve_server_code_or_tools(client):
    assert client.get("/server/app/main.py").status_code == 404
    assert client.get("/tools/database_5fish.db").status_code == 404


def test_no_cross_site_access_unless_configured():
    origin = {"Origin": "http://example.test"}
    closed = TestClient(create_app(settings=Settings(), identifier=StubIdentifier(["spa"])))
    assert "access-control-allow-origin" not in closed.get("/health", headers=origin).headers
    opened = TestClient(
        create_app(settings=Settings(cors_origins=["http://example.test"]), identifier=StubIdentifier(["spa"]))
    )
    assert opened.get("/health", headers=origin).headers["access-control-allow-origin"] == "http://example.test"
