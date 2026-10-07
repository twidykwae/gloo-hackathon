"""Server settings, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# The project folder holding index.html: server/app/config.py -> project root.
PAGE_DIR = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    # Which language-ID model to run: "mms" (Meta's MMS-LID, the team's choice
    # for now), "lamp" (GRN's model, run separately; see tools/fake_lamp.py),
    # or "stub" (fixed answers, no model: starts instantly, for UI work).
    identifier: str = "mms"
    stub_labels: str = "tzo,mim,spa,ngu,eng"
    # Where LAMP's serve.py listens, when identifier is "lamp".
    lamp_url: str = "http://127.0.0.1:8001"

    # Longer recordings are trimmed to this.
    max_audio_seconds: float = 20.0

    # Other websites allowed to call /predict. The page served by this server
    # doesn't need this; it's for a page served from somewhere else.
    cors_origins: list[str] = field(default_factory=list)

    # Where GRN sample MP3s are kept once downloaded. scripts/fetch_samples.py
    # (main branch) names files the same way, so it can fill this ahead of time.
    samples_dir: Path = PAGE_DIR / "data" / "sample-audio"

    # YouVersion Platform app key, for GET /bible/{id}. The team's key for now;
    # YVP_APP_KEY overrides it, and an empty value turns the endpoint off.
    youversion_app_key: str = "caf5vTyeQhy1lLHtQjaAS5oKqnpssGB2DGRi2fl7ASSVIZus"


    # Gloo AI, for the Resources screen's guide and chat. The key costs money
    # per call, so it is never in git: set GLOO_API_KEY (server/.env). Empty
    # turns both off.
    gloo_api_key: str = ""
    # Named explicitly so Gloo never routes to a pricier model. Its price per
    # million tokens (input, output) counts spending against the daily budget.
    gloo_model: str = "gloo-google-gemini-2.5-flash-lite"
    gloo_price_per_m: tuple[float, float] = (0.10, 0.40)
    gloo_daily_budget_usd: float = 1.0
    gloo_usage_file: Path = PAGE_DIR / "server" / "gloo-usage.json"
    gloo_labels_file: Path = PAGE_DIR / "server" / "gloo-labels.json"

def load_settings() -> Settings:
    env = os.environ.get
    defaults = Settings()
    return Settings(
        identifier=env("LID_IDENTIFIER", defaults.identifier),
        stub_labels=env("LID_STUB_LABELS", defaults.stub_labels),
        lamp_url=env("LID_LAMP_URL", defaults.lamp_url),
        max_audio_seconds=float(env("LID_MAX_AUDIO_SECONDS", defaults.max_audio_seconds)),
        cors_origins=[o.strip() for o in env("LID_CORS_ORIGINS", "").split(",") if o.strip()],
        samples_dir=Path(env("LID_SAMPLES_DIR", defaults.samples_dir)),
        youversion_app_key=env("YVP_APP_KEY", defaults.youversion_app_key),
        gloo_api_key=env("GLOO_API_KEY", defaults.gloo_api_key),
        gloo_model=env("GLOO_MODEL", defaults.gloo_model),
        gloo_daily_budget_usd=float(env("GLOO_DAILY_BUDGET_USD", defaults.gloo_daily_budget_usd)),
    )
