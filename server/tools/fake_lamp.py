"""A stand-in for LAMP's serve.py, for testing the wiring without model weights.

It speaks the same API as ``lid_finetune/scripts/model/serve.py`` in the LAMP
repo, but its answers are made up: a fixed ranking of real GRN IDs for Mexico,
or GRN ID 0 ("no linguistic content") first when the clip is near-silent.

    .venv/Scripts/python tools/fake_lamp.py      # from server/; listens on http://127.0.0.1:8001

Then start the server with LID_IDENTIFIER=lamp (README, "Switching to LAMP").
Replace this with the real serve.py once LAMP's trained weights are available.
"""

from __future__ import annotations

import io
import wave

import numpy as np
import uvicorn
from fastapi import FastAPI, File, HTTPException, Query, UploadFile

# Real GRN IDs that are in LAMP's label map.
RANKING = [
    (52, "spa"),  # Spanish: Mexico
    (2641, "tzo"),  # Tzotzil: Chamula
    (6028, "ngu"),  # Nahuatl, Guerrero: Chilapa
    (4808, "zab"),  # Zapotec, Guelavia
    (25, "eng"),  # English: USA
]
NO_SPEECH = (0, "zxx")

app = FastAPI(title="Fake LAMP (serve.py contract)")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "languages": len(RANKING) + 1, "fake": True}


@app.post("/predict")
def predict(file: UploadFile = File(...), top_k: int = Query(5, ge=1, le=50)) -> dict:
    try:
        with wave.open(io.BytesIO(file.file.read())) as w:
            rate = w.getframerate()
            audio = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    except wave.Error as e:
        raise HTTPException(400, f"Could not decode audio (the fake only reads WAV): {e}")

    rms = float(np.sqrt(np.mean(audio**2))) if audio.size else 0.0
    ranking = [NO_SPEECH, *RANKING] if rms < 0.005 else [*RANKING, NO_SPEECH]
    weights = [0.5**i for i in range(len(ranking))]
    total = sum(weights)
    predictions = [
        {"id": gid, "probability": w / total, "iso": iso, "url": f"https://globalrecordings.net/en/language/{gid}"}
        for (gid, iso), w in zip(ranking, weights)
    ]
    return {"duration": audio.size / rate if rate else 0.0, "predictions": predictions[:top_k]}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
