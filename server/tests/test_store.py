import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.identifiers import StubIdentifier
from app.main import MAX_UPLOAD_BYTES, create_app
from app.store import Store

SESSION = "0b6f4f0e-6a1d-4d1e-9c55-3f2a1c9e7b10"


@pytest.fixture
def storage(tmp_path):
    return tmp_path / "storage"


@pytest.fixture
def client(storage):
    return TestClient(create_app(settings=Settings(storage_dir=storage), identifier=StubIdentifier(["spa"])))


def row(storage):
    return Store(storage).get(SESSION)


def prediction(**changes):
    return {
        "sessionId": SESSION,
        "recordingType": "audio/webm;codecs=opus",
        "recordingBytes": 4,
        "recordingSeconds": 3.2,
        "model": "mms",
        "guesses": [
            {"rank": 1, "label": "tzo", "name": "Tzotzil", "confidence": 0.7},
            {"rank": 2, "label": "spa", "name": "Spanish", "confidence": 0.2},
        ],
        "predictedAt": "2026-10-07T18:00:00Z",
        **changes,
    }


def choice(**changes):
    return {
        "sessionId": SESSION,
        "consent": True,  # sent by the page; not stored twice
        "languageId": 1234,
        "languageName": "Tzotzil, Chamula",
        "languageIso": "tzo",
        "modelLabel": "tzo",
        "modelRank": 1,
        "modelConfidence": 0.7,
        "chosenAt": "2026-10-07T18:01:00Z",
        **changes,
    }


def keep(client, data=b"opus", type="audio/webm;codecs=opus"):
    return client.post("/sessions/recording", data={"sessionId": SESSION}, files={"file": ("r.webm", data, type)})


def consent(client, answer):
    return client.post(
        "/sessions/consent", json={"sessionId": SESSION, "consent": answer, "answeredAt": "2026-10-07T18:00:05Z"}
    )


def test_nothing_is_created_until_something_is_saved(client, storage):
    client.get("/health")
    assert not storage.exists()


def test_prediction_then_choice_fill_in_one_row(client, storage):
    assert client.post("/sessions/prediction", json=prediction()).status_code == 204
    saved = row(storage)
    assert saved["top_label"] == "tzo"
    assert saved["top_confidence"] == 0.7
    assert json.loads(saved["model_guesses"])[1]["label"] == "spa"
    assert saved["chosen_language_id"] is None

    assert client.post("/sessions/choice", json=choice()).status_code == 204
    saved = row(storage)
    assert saved["top_label"] == "tzo"  # still there
    assert (saved["chosen_language_id"], saved["chosen_language_iso"]) == (1234, "tzo")


def test_choosing_again_replaces_the_choice(client, storage):
    client.post("/sessions/choice", json=choice())
    client.post("/sessions/choice", json=choice(languageId=99, modelRank=3))
    assert (row(storage)["chosen_language_id"], row(storage)["chosen_model_rank"]) == (99, 3)


def test_kept_recording_is_a_file_named_in_the_row(client, storage):
    consent(client, True)
    assert keep(client).status_code == 204
    saved = row(storage)
    assert saved["consent"] == 1
    assert saved["audio_file"] == f"{SESSION}.webm"
    assert (storage / "recordings" / saved["audio_file"]).read_bytes() == b"opus"


def test_no_audio_without_a_yes(client, storage):
    client.post("/sessions/prediction", json=prediction())
    assert keep(client).status_code == 409  # not answered
    consent(client, False)
    assert keep(client).status_code == 409  # "No"
    assert row(storage)["audio_file"] is None
    assert list((storage / "recordings").iterdir()) == []


def test_order_does_not_matter(client, storage):
    client.post("/sessions/choice", json=choice())  # the choice can land before the prediction
    consent(client, True)
    keep(client)
    client.post("/sessions/prediction", json=prediction())
    saved = row(storage)
    assert (saved["audio_file"], saved["chosen_language_id"], saved["top_label"], saved["consent"]) == (
        f"{SESSION}.webm",
        1234,
        "tzo",
        1,
    )


def test_a_later_no_deletes_the_audio(client, storage):
    consent(client, True)
    keep(client)
    consent(client, False)
    assert row(storage)["audio_file"] is None
    assert list((storage / "recordings").iterdir()) == []


def test_dialect_is_kept_as_sent(client, storage):
    report = {
        "sessionId": SESSION,
        "parentLanguageId": None,
        "parentLanguageName": "Mineiro",
        "dialectName": "Mineiro",
        "countryCode": "BR",
        "countryName": "Brazil",
        "modelGuesses": [{"label": "por", "name": "Portuguese", "confidence": 0.9}],
        "guessesViewed": 2,
        "submittedAt": "2026-10-07T18:02:00Z",
    }
    assert client.post("/sessions/dialect", json=report).status_code == 204
    assert json.loads(row(storage)["dialect"])["countryCode"] == "BR"


def test_rejects_a_session_id_that_is_not_a_uuid(client):
    # It names the audio file, so nothing like "../x" gets through.
    assert client.post("/sessions/prediction", json=prediction(sessionId="../x")).status_code == 422
    resp = client.post("/sessions/recording", data={"sessionId": "../x"}, files={"file": ("r", b"a", "audio/webm")})
    assert resp.status_code == 422


def test_rejects_uploads_that_are_not_recordings_or_too_big(client):
    consent(client, True)
    assert keep(client, type="text/html").status_code == 415
    assert keep(client, data=b"x" * (MAX_UPLOAD_BYTES + 1)).status_code == 413


def test_rejects_long_text(client):
    assert client.post("/sessions/choice", json=choice(languageName="x" * 201)).status_code == 422
