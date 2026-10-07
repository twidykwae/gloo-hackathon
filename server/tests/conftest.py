"""Shared test helpers."""

from __future__ import annotations

import io
import wave

import numpy as np


def make_wav(seconds: float = 1.0, rate: int = 16_000, channels: int = 1, width: int = 2) -> bytes:
    """A WAV file with a 220 Hz tone (or silence, for widths other than 16-bit)."""
    t = np.linspace(0, seconds, int(seconds * rate), endpoint=False)
    tone = (0.3 * np.sin(2 * np.pi * 220 * t) * 32767).astype("<i2")
    frames = np.repeat(tone[:, None], channels, axis=1).tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(frames if width == 2 else b"\x00" * (len(t) * channels * width))
    return buf.getvalue()
