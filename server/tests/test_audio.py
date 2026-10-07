import pytest

from app.audio import AudioError, read_wav

from .conftest import make_wav


def test_reads_16k_mono():
    samples = read_wav(make_wav(seconds=1.0), max_seconds=20)
    assert samples.dtype.name == "float32"
    assert samples.size == 16_000
    assert abs(samples).max() <= 1.0


def test_downmixes_and_resamples():
    samples = read_wav(make_wav(seconds=1.0, rate=48_000, channels=2), max_seconds=20)
    assert samples.size == 16_000


def test_trims_to_max_seconds():
    samples = read_wav(make_wav(seconds=3.0), max_seconds=2)
    assert samples.size == 32_000


def test_rejects_non_wav():
    with pytest.raises(AudioError):
        read_wav(b"not audio at all", max_seconds=20)


def test_rejects_8_bit():
    with pytest.raises(AudioError, match="16-bit"):
        read_wav(make_wav(width=1), max_seconds=20)
