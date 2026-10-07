"""What the page sends about each recording, kept in SQLite.

One row per recording (its sessionId), filled in as things happen and in any
order, since the page sends them without waiting for each other:

    prediction  the model's guesses, as soon as they're back (every recording)
    consent     the answer to "May we keep your recording?"
    recording   the audio, refused unless the row already has a "Yes"; kept as
                a file, its name in the row. No answer means no audio
    choice      the language they chose, on reaching Resources (the latest counts)
    dialect     a new dialect they typed in, instead of choosing

A row with consent = 1, an audio file and a chosen language is a labelled
training example. The database and the audio files are created on first use.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

COLUMNS = """
    session_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    recording_type TEXT,
    recording_bytes INTEGER,
    recording_seconds REAL,
    -- prediction
    model TEXT,
    model_guesses TEXT,           -- JSON: the top guesses, best first
    top_label TEXT,
    top_name TEXT,
    top_confidence REAL,
    predicted_at TEXT,
    -- consent
    consent INTEGER,              -- 1 yes, 0 no, NULL not answered
    consent_at TEXT,
    audio_file TEXT,              -- in the recordings folder; only with consent = 1
    -- choice
    chosen_language_id INTEGER,
    chosen_language_name TEXT,
    chosen_language_iso TEXT,
    chosen_model_label TEXT,      -- the guess they chose it from
    chosen_model_rank INTEGER,
    chosen_model_confidence REAL,
    chosen_at TEXT,
    -- dialect
    dialect TEXT,                 -- JSON: what they typed, as the page sent it
    dialect_at TEXT
"""


class NoConsent(Exception):
    """Audio for a recording whose speaker hasn't said "Yes" (yet)."""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, folder: Path):
        self.db_path = folder / "sessions.db"
        self.recordings_dir = folder / "recordings"
        self._lock = threading.Lock()  # one writer at a time; requests run in a thread pool
        self._ready = False

    def _ensure(self) -> None:
        """Creates the folder, the database and its table the first time."""
        if self._ready:
            return
        self.recordings_dir.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(f"CREATE TABLE IF NOT EXISTS sessions ({COLUMNS})")
        self._ready = True

    def _connect(self) -> sqlite3.Connection:
        self._ensure()
        return sqlite3.connect(self.db_path)

    def _update(self, session_id: str, values: dict) -> None:
        """Creates the session's row if it's new, then sets these columns."""
        stamp = now()
        names = list(values)
        sets = ", ".join(f"{n} = excluded.{n}" for n in names)
        sql = (
            f"INSERT INTO sessions (session_id, created_at, updated_at, {', '.join(names)}) "
            f"VALUES (?, ?, ?, {', '.join('?' for _ in names)}) "
            f"ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at, {sets}"
        )
        with self._lock, closing(self._connect()) as db, db:
            db.execute(sql, [session_id, stamp, stamp, *values.values()])

    def get(self, session_id: str) -> dict | None:
        with self._lock, closing(self._connect()) as db, db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM sessions WHERE session_id = ?", [session_id]).fetchone()
        return dict(row) if row else None

    def save_prediction(self, p: dict) -> None:
        guesses = p["guesses"]
        top = guesses[0] if guesses else {}
        self._update(
            p["sessionId"],
            {
                "recording_type": p["recordingType"],
                "recording_bytes": p["recordingBytes"],
                "recording_seconds": p["recordingSeconds"],
                "model": p["model"],
                "model_guesses": json.dumps(guesses),
                "top_label": top.get("label"),
                "top_name": top.get("name"),
                "top_confidence": top.get("confidence"),
                "predicted_at": p["predictedAt"],
            },
        )

    def save_consent(self, c: dict) -> None:
        values = {"consent": int(c["consent"]), "consent_at": c["answeredAt"]}
        if not c["consent"]:
            self._delete_audio(c["sessionId"])
            values["audio_file"] = None
        self._update(c["sessionId"], values)

    def save_recording(self, session_id: str, audio: bytes, extension: str) -> None:
        row = self.get(session_id)
        if not row or row["consent"] != 1:
            raise NoConsent(f"no \"Yes\" stored for {session_id}")
        name = f"{session_id}.{extension}"
        (self.recordings_dir / name).write_bytes(audio)
        self._update(session_id, {"audio_file": name})

    def save_choice(self, c: dict) -> None:
        self._update(
            c["sessionId"],
            {
                "chosen_language_id": c["languageId"],
                "chosen_language_name": c["languageName"],
                "chosen_language_iso": c.get("languageIso"),
                "chosen_model_label": c["modelLabel"],
                "chosen_model_rank": c["modelRank"],
                "chosen_model_confidence": c["modelConfidence"],
                "chosen_at": c["chosenAt"],
            },
        )

    def save_dialect(self, d: dict) -> None:
        self._update(d["sessionId"], {"dialect": json.dumps(d), "dialect_at": d["submittedAt"]})

    def _delete_audio(self, session_id: str) -> None:
        for path in self.recordings_dir.glob(f"{session_id}.*"):
            path.unlink(missing_ok=True)
