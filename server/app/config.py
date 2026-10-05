"""Server settings, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


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


def load_settings() -> Settings:
    env = os.environ.get
    defaults = Settings()
    return Settings(
        identifier=env("LID_IDENTIFIER", defaults.identifier),
        stub_labels=env("LID_STUB_LABELS", defaults.stub_labels),
        lamp_url=env("LID_LAMP_URL", defaults.lamp_url),
        max_audio_seconds=float(env("LID_MAX_AUDIO_SECONDS", defaults.max_audio_seconds)),
        cors_origins=[o.strip() for o in env("LID_CORS_ORIGINS", "").split(",") if o.strip()],
    )
