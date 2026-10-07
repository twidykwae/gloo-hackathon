"""The Language ID server: runs the model and serves the page.

Run from the server/ folder:
    .venv\\Scripts\\python -m uvicorn app.main:create_app --factory --port 8080
then open http://localhost:8080.

    GET  /             the page (index.html, css/, js/, data/ from the project folder)
    GET  /health       which model is loaded
    POST /predict      a recording in, the model's ranked guesses out
    GET  /samples/{id}.mp3   a GRN language's sample recording, downloaded once then cached
    GET  /bible/{id}   a GRN language's Bible on YouVersion: name, copyright, bible.com link
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .audio import TARGET_RATE, AudioError, read_wav
from .bibles import BibleLookupError, UnknownLanguage, YouVersion, load_grn_languages
from .config import Settings, load_settings
from .identifiers import Identifier, IdentifierError, make_identifier
from .samples import SampleNotFound, SampleUnavailable, get_sample

logger = logging.getLogger("language_id")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # ~2.5 min of 16 kHz 16-bit mono; far above the 20 s cap
# /predict returns every guess unless asked for fewer (MMS has 4,017 labels).
ALL_LABELS = 10_000
# The project folder holding index.html: server/app/main.py -> project root.
PAGE_DIR = Path(__file__).resolve().parents[2]


def create_app(
    settings: Settings | None = None, identifier: Identifier | None = None, youversion: YouVersion | None = None
) -> FastAPI:
    settings = settings or load_settings()
    identifier = identifier or make_identifier(settings.identifier, settings.stub_labels, settings.lamp_url)
    if youversion is None and settings.youversion_app_key:
        youversion = YouVersion(settings.youversion_app_key, load_grn_languages(PAGE_DIR / "data" / "languages.json"))

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
    for folder in ("css", "js", "data"):
        app.mount(f"/{folder}", StaticFiles(directory=PAGE_DIR / folder), name=folder)

    @app.get("/", include_in_schema=False)
    def page() -> FileResponse:
        return FileResponse(PAGE_DIR / "index.html")

    return app
