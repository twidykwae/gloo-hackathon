"""GRN language sample MP3s, downloaded once and kept in a local folder.

The same download and cache as scripts/fetch_samples.py in the main branch:
files are named sample-{grn_id}.mp3, so a folder that script filled ahead of
time (for a field laptop with no internet) works here as-is.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx

SAMPLE_URL = "https://media.globalrecordings.net/GOKit_MP3/sample-{}.mp3"


class SampleNotFound(Exception):
    """GRN has no sample for this language."""


class SampleUnavailable(Exception):
    """GRN couldn't be reached, so the sample couldn't be downloaded."""


def get_sample(grn_id: int, cache_dir: Path) -> Path:
    """The cached MP3 for this GRN language, downloading it first if needed."""
    path = cache_dir / f"sample-{grn_id}.mp3"
    if path.exists() and path.stat().st_size > 0:
        return path
    cache_dir.mkdir(parents=True, exist_ok=True)
    try:
        response = httpx.get(SAMPLE_URL.format(grn_id), timeout=30, follow_redirects=True)
    except httpx.HTTPError as e:
        raise SampleUnavailable(f"could not download the sample for {grn_id}: {e}") from e
    if response.status_code == 404:
        raise SampleNotFound(f"GRN has no sample for language {grn_id}")
    if response.status_code != 200:
        raise SampleUnavailable(f"GRN returned {response.status_code} for the sample for {grn_id}")
    content_type = response.headers.get("content-type", "")
    if not content_type.startswith("audio/"):
        raise SampleNotFound(f"expected audio for language {grn_id}, got {content_type or 'nothing'}")
    # Write under a unique name, then rename, so two requests for the same
    # language at once never leave a half-written file behind.
    fd, tmp = tempfile.mkstemp(dir=cache_dir, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(response.content)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return path
