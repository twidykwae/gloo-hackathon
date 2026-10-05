"""Decode uploaded audio.

The widget converts recordings to 16 kHz mono 16-bit PCM WAV in the browser,
so the service only needs the standard library to read them — no ffmpeg.
"""

from __future__ import annotations

import io
import wave

import numpy as np

TARGET_RATE = 16_000


class AudioError(ValueError):
    """The upload is not audio the service can read."""


def read_wav(data: bytes, max_seconds: float, target_rate: int = TARGET_RATE) -> np.ndarray:
    """Return mono float32 samples in [-1, 1] at ``target_rate``, trimmed to ``max_seconds``."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            channels = w.getnchannels()
            width = w.getsampwidth()
            rate = w.getframerate()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as e:
        raise AudioError(f"expected a PCM WAV file: {e}") from e

    if width != 2:
        raise AudioError(f"expected 16-bit PCM, got {width * 8}-bit")

    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    if rate != target_rate:
        samples = _resample(samples, rate, target_rate)
    if samples.size == 0:
        raise AudioError("audio is empty")

    return samples[: int(max_seconds * target_rate)]


def to_wav_bytes(samples: np.ndarray, rate: int = TARGET_RATE) -> bytes:
    """Encode mono float samples in [-1, 1] as 16-bit PCM WAV."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def _resample(samples: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    # Linear interpolation is enough for a fallback path; the widget already
    # sends 16 kHz, where the browser does proper resampling.
    duration = samples.size / from_rate
    n_out = int(round(duration * to_rate))
    x_old = np.linspace(0.0, duration, num=samples.size, endpoint=False)
    x_new = np.linspace(0.0, duration, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, samples).astype(np.float32)
