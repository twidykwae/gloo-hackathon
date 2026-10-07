"""Download GRN language sample MP3s into a local cache.

Usage:
    python scripts/fetch_samples.py 1 51 92          # specific GRN language IDs
    python scripts/fetch_samples.py --random 10      # random languages that have a sample

Files are saved as data/sample-audio/sample-{grn_id}.mp3. Existing files are
skipped, so the folder works as a cache: call it with the top-k IDs from the
ranked list. It's the same folder the server's /samples route uses, so running
this ahead of time lets the page play samples without internet.

From Python:
    from fetch_samples import fetch_samples
    paths = fetch_samples(["1", "51", "92"])   # {grn_id: Path or None}
"""

import argparse
import json
import random
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGUAGES_JSON = ROOT / "data" / "languages.json"
# Not data/samples/: that holds saved model responses.
SAMPLES_DIR = ROOT / "data" / "sample-audio"
SAMPLE_URL = "https://media.globalrecordings.net/GOKit_MP3/sample-{}.mp3"


def load_languages() -> dict[str, dict]:
    """{grn_id: language}, from tools/build_data.py's data/languages.json."""
    data = json.loads(LANGUAGES_JSON.read_text())
    return {str(lang["id"]): {**lang, "sample": not lang.get("noSample")} for lang in data}


def fetch_one(grn_id: str, dest: Path) -> Path | None:
    if not grn_id.isdigit():
        print(f"  failed {grn_id}: not a numeric GRN ID", file=sys.stderr)
        return None
    path = dest / f"sample-{grn_id}.mp3"
    if path.exists() and path.stat().st_size > 0:
        return path
    tmp = path.with_suffix(".part")
    try:
        with urllib.request.urlopen(SAMPLE_URL.format(grn_id), timeout=30) as resp:
            content_type = resp.headers.get_content_type()
            if not content_type.startswith("audio/"):
                raise ValueError(f"expected audio, got {content_type}")
            tmp.write_bytes(resp.read())
        tmp.rename(path)
        return path
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(f"  failed {grn_id}: {e}", file=sys.stderr)
        return None


def fetch_samples(grn_ids: list[str], dest: Path = SAMPLES_DIR) -> dict[str, Path | None]:
    """Download samples for the given IDs (in parallel), returning {id: path or None}."""
    dest.mkdir(parents=True, exist_ok=True)
    ids = list(dict.fromkeys(str(i) for i in grn_ids))  # dedupe so no two threads share a .part file
    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(zip(ids, pool.map(lambda i: fetch_one(i, dest), ids)))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*", help="GRN language IDs")
    parser.add_argument("--random", type=int, metavar="N", help="also fetch N random languages with samples")
    args = parser.parse_args()

    languages = load_languages()
    ids = list(args.ids)
    if args.random:
        with_sample = [i for i, lang in languages.items() if lang.get("sample")]
        ids += random.sample(with_sample, args.random)
    if not ids:
        parser.error("give some IDs or --random N")

    for grn_id in ids:
        lang = languages.get(grn_id)
        if lang is None:
            print(f"  warning: {grn_id} is not in languages.json", file=sys.stderr)
        elif not lang.get("sample"):
            print(f"  warning: {grn_id} ({lang['name']}) is not flagged as having a sample", file=sys.stderr)

    results = fetch_samples(ids)
    for grn_id, path in results.items():
        name = languages.get(grn_id, {}).get("name", "?")
        print(f"{grn_id:>6}  {name:<30}  {path.relative_to(ROOT) if path else 'FAILED'}")
    if None in results.values():
        sys.exit(1)


if __name__ == "__main__":
    main()
