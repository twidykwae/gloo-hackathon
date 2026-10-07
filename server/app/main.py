"""The Language ID server: runs the model and serves the page.

Run from the server/ folder:
    .venv\\Scripts\\python -m uvicorn app.main:create_app --factory --port 8080
then open http://localhost:8080.

    GET  /             the page (index.html, css/, js/, data/ from the project folder)
    GET  /health       which model is loaded
    POST /predict      a recording in, the model's ranked guesses out
    GET  /samples/{id}.mp3   a GRN language's sample recording, downloaded once then cached
    GET  /bible/{id}   a GRN language's Bible on YouVersion: name, copyright, bible.com link
    POST /assistant/guide   Gloo AI: a short note about the chosen language's resources
    POST /assistant/chat    Gloo AI: answers questions about them
    POST /sessions/prediction  the model's guesses for a recording, as soon as they're back
    POST /sessions/consent     the answer to "May we keep your recording?"
    POST /sessions/recording   a kept recording's audio, only once a "Yes" is stored
    POST /sessions/choice      the language they chose, on reaching Resources
    POST /sessions/dialect     a new dialect they typed in
These five fill in one row per recording in server/storage/sessions.db
(app/store.py).
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .assistant import Assistant, AssistantError, Budget, OverBudget, Resources, clean_messages

from .audio import TARGET_RATE, AudioError, read_wav
from .bibles import BibleLookupError, UnknownLanguage, YouVersion, load_grn_languages
from .config import Settings, load_settings
from .identifiers import Identifier, IdentifierError, make_identifier
from .samples import SampleNotFound, SampleUnavailable, get_sample
from .store import NoConsent, Store

logger = logging.getLogger("language_id")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # ~2.5 min of 16 kHz 16-bit mono; far above the 20 s cap
# /predict returns every guess unless asked for fewer (MMS has 4,017 labels).
ALL_LABELS = 10_000
# The project folder holding index.html: server/app/main.py -> project root.
PAGE_DIR = Path(__file__).resolve().parents[2]


# What the page sends about a recording (js/main.js). Limits keep what anyone
# can post small; extra fields are dropped.
SessionId = Annotated[str, Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
Text = Annotated[str, Field(max_length=200)]
# The audio a kept recording may be, and the file extension it's saved with.
AUDIO_EXTENSIONS = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav"}


class Guess(BaseModel):
    rank: int
    label: Text
    name: Text | None = None
    confidence: float


class Prediction(BaseModel):
    sessionId: SessionId
    recordingType: Text
    recordingBytes: int
    recordingSeconds: float
    model: Text
    guesses: list[Guess] = Field(max_length=20)
    predictedAt: Text


class Consent(BaseModel):
    sessionId: SessionId
    consent: bool
    answeredAt: Text


class Choice(BaseModel):
    sessionId: SessionId
    languageId: int
    languageName: Text
    languageIso: Text | None = None
    modelLabel: Text
    modelRank: int
    modelConfidence: float
    chosenAt: Text


class Dialect(BaseModel):
    sessionId: SessionId
    parentLanguageId: int | None = None
    parentLanguageName: Text
    dialectName: Text
    countryCode: Text | None = None
    countryName: Text
    modelGuesses: list[dict] = Field(default_factory=list, max_length=20)
    guessesViewed: int = 0
    submittedAt: Text


class GuideRequest(BaseModel):
    grn_id: int
    country: str | None = Field(default=None, description="ISO 3166 code of where the person is, if known")
    device_language: str | None = Field(
        default=None, description="The device's language setting (navigator.language), e.g. es-MX: the fallback"
    )


class ChatRequest(GuideRequest):
    messages: list[dict] = Field(description="The conversation so far, ending with the person's question")


def create_app(
    settings: Settings | None = None,
    identifier: Identifier | None = None,
    youversion: YouVersion | None = None,
    assistant: Assistant | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    identifier = identifier or make_identifier(settings.identifier, settings.stub_labels, settings.lamp_url)
    if youversion is None and settings.youversion_app_key:
        youversion = YouVersion(settings.youversion_app_key, load_grn_languages(PAGE_DIR / "data" / "languages.json"))
    if assistant is None and settings.gloo_api_key:
        assistant = Assistant(
            settings.gloo_api_key,
            settings.gloo_model,
            Budget(settings.gloo_usage_file, settings.gloo_daily_budget_usd, *settings.gloo_price_per_m),
            labels_file=settings.gloo_labels_file,
        )
    store = Store(settings.storage_dir)
    grn_rows = {row["id"]: row for row in json.loads((PAGE_DIR / "data" / "languages.json").read_text(encoding="utf-8"))}

    app = FastAPI(title="Language ID", version="0.2.0")
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"], allow_headers=["*"]
        )

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "identifier": identifier.name}

    # A plain `def` endpoint runs in FastAPI's thread pool, so model inference
    # doesn't block other requests.
    @app.post("/predict")
    def predict(
        file: Annotated[UploadFile, File(description="16 kHz mono 16-bit PCM WAV")],
        top_k: Annotated[int | None, Query(ge=1, le=ALL_LABELS, description="Guesses to return; all by default")] = None,
    ) -> dict:
        """The model's ranked guesses, best first. The page does its own
        language lookups and filtering (js/results.js)."""
        data = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "audio upload too large")
        try:
            samples = read_wav(data, settings.max_audio_seconds)
        except AudioError as e:
            raise HTTPException(400, str(e)) from e
        try:
            label_scores = identifier.identify(samples, TARGET_RATE, limit=top_k or ALL_LABELS)
        except IdentifierError as e:
            logger.error("Identifier failed: %s", e)
            raise HTTPException(502, str(e)) from e
        return {
            "model": identifier.name,
            # "iso639_3" (MMS) or "grn_language_id" (LAMP): what each label means.
            "label_kind": identifier.label_kind,
            "duration": round(samples.size / TARGET_RATE, 2),
            "predictions": [{"label": s.label, "probability": s.score} for s in label_scores],
        }

    @app.get("/samples/{grn_id}.mp3")
    def sample(grn_id: int) -> FileResponse:
        """A GRN language's sample recording, from the local cache or GRN."""
        try:
            path = get_sample(grn_id, settings.samples_dir)
        except SampleNotFound as e:
            raise HTTPException(404, str(e)) from e
        except SampleUnavailable as e:
            logger.warning("Sample download failed: %s", e)
            raise HTTPException(502, str(e)) from e
        return FileResponse(path, media_type="audio/mpeg")

    @app.get("/bible/{grn_id}")
    def bible(grn_id: int) -> dict:
        """The language's Bible on YouVersion, or "bible": null if it has none.
        "can_show_text" says whether this app is licensed to show its text;
        the bible.com link works either way."""
        if youversion is None:
            raise HTTPException(503, "YouVersion isn't set up: set YVP_APP_KEY")
        try:
            return youversion.bible_for(grn_id)
        except UnknownLanguage as e:
            raise HTTPException(404, str(e)) from e
        except BibleLookupError as e:
            logger.warning("Bible lookup failed: %s", e)
            raise HTTPException(502, str(e)) from e

    @app.post("/sessions/prediction", status_code=204)
    def save_prediction(prediction: Prediction) -> None:
        store.save_prediction(prediction.model_dump())

    @app.post("/sessions/consent", status_code=204)
    def save_consent(consent: Consent) -> None:
        store.save_consent(consent.model_dump())

    @app.post("/sessions/recording", status_code=204)
    def save_recording(
        session_id: Annotated[SessionId, Form(alias="sessionId")],
        file: Annotated[UploadFile, File(description="The recording as the browser made it")],
    ) -> None:
        """Kept only once POST /sessions/consent has stored a "Yes" for this
        sessionId (409 otherwise): no answer means no audio. A later "No"
        deletes it."""
        audio_type = (file.content_type or "").split(";")[0]
        if audio_type not in AUDIO_EXTENSIONS:
            raise HTTPException(415, f"not a recording type this server keeps: {audio_type or 'none'}")
        data = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "audio upload too large")
        try:
            store.save_recording(session_id, data, AUDIO_EXTENSIONS[audio_type])
        except NoConsent as e:
            raise HTTPException(409, str(e)) from e

    @app.post("/sessions/choice", status_code=204)
    def save_choice(choice: Choice) -> None:
        store.save_choice(choice.model_dump())

    @app.post("/sessions/dialect", status_code=204)
    def save_dialect(dialect: Dialect) -> None:
        store.save_dialect(dialect.model_dump())

    def resources_for(request: GuideRequest) -> Resources:
        """The facts the model is given, built here so the page can't change them."""
        row = grn_rows.get(request.grn_id)
        if row is None:
            raise HTTPException(404, f"no GRN language {request.grn_id}")
        bible = None
        if youversion is not None:
            try:
                found = youversion.bible_for(request.grn_id)["bible"]
            except (BibleLookupError, UnknownLanguage):
                found = None
            if found:
                names = [found.get("localized_title"), found.get("title")]
                bible = " / ".join(dict.fromkeys(n for n in names if n)) + f" ({found.get('abbreviation')})"
        country = (request.country or "").upper()
        device = request.device_language or ""
        return Resources(
            language=row["name"],
            native=row.get("native"),
            iso=row.get("iso") or row.get("macro"),
            countries=row.get("countries") or [],
            content_url=f"https://5fish.mobi/{request.grn_id}",
            bible=bible,
            country=country if re.fullmatch(r"[A-Z]{2}", country) else None,
            device_language=device if re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*", device) else None,
        )

    def ask(call):
        if assistant is None:
            raise HTTPException(503, "Gloo AI isn't set up: set GLOO_API_KEY")
        try:
            return call()
        except OverBudget as e:
            raise HTTPException(429, str(e)) from e
        except AssistantError as e:
            logger.warning("Gloo failed: %s", e)
            raise HTTPException(502, str(e)) from e

    @app.post("/assistant/guide")
    def guide(request: GuideRequest) -> dict:
        """A short note, in the language the person most likely reads, about their resources."""
        resources = resources_for(request)
        return ask(lambda: assistant.guide(resources))

    @app.post("/assistant/chat")
    def chat(request: ChatRequest) -> dict:
        """The assistant's answer to the last question in the conversation."""
        resources = resources_for(request)
        try:
            messages = clean_messages(request.messages)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {"reply": ask(lambda: assistant.chat(resources, messages))}

    @app.middleware("http")
    async def always_check_for_newer_files(request, call_next):
        # Without this, browsers can keep running an old copy of the page's
        # JavaScript after it changes. "no-cache" still lets them reuse a file
        # when the server confirms it's unchanged.
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-cache")
        return response

    # The page. Only these folders are served, so the server's own code and
    # tools/ (with the 5fish database) stay private.
    for folder in ("css", "js", "data", "images"):
        app.mount(f"/{folder}", StaticFiles(directory=PAGE_DIR / folder), name=folder)

    @app.get("/", include_in_schema=False)
    def page() -> FileResponse:
        return FileResponse(PAGE_DIR / "index.html")

    return app
