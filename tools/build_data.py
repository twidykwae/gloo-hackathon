"""Build the static data files the page loads.

    python tools/build_data.py [--borders] [path/to/database_5fish.db]

The database defaults to tools/database_5fish.db (not in git; it's the 5fish
apps' offline database, copied from the 2025 prototype).

Writes:
  data/languages.json      every GRN language: name, native name (when known), ISO code,
                           macrolanguage code, parent, countries, sample flags
  data/countries.geojson   country borders (Natural Earth 1:110m, public domain), trimmed,
                           used to turn GPS coordinates into a country code. Only written
                           when it's missing or with --borders; it downloads the borders.

Run it again whenever the 5fish database is updated, then run
tools/mark_samples.py: the 5fish database's sample flag says every language
has one, and GRN's own data says otherwise. Until then, the sample flags
mark_samples.py wrote last time are kept for languages already in the file.
"""

from __future__ import annotations

import json
import sqlite3
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BORDERS_URL = (
    "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson"
)


LANGUAGES_JSON = ROOT / "data" / "languages.json"
BORDERS_GEOJSON = ROOT / "data" / "countries.geojson"
SAMPLE_FLAGS = ("noSample", "heading")  # written by tools/mark_samples.py

# The language tags the database's alternate names are written in, as ISO 639-3
# codes. Macrolanguage codes ("zho", "ara") match through a language's macro code.
TAG_TO_ISO = {
    "af": "afr", "am": "amh", "ar": "ara", "bn": "ben", "de": "deu", "el": "ell", "en": "eng",
    "es": "spa", "fa": "fas", "fr": "fra", "he": "heb", "hi": "hin", "hr": "hrv", "hu": "hun",
    "id": "ind", "it": "ita", "ja": "jpn", "ka": "kat", "km": "khm", "ko": "kor", "my": "mya",
    "ne": "nep", "nl": "nld", "pl": "pol", "pt": "por", "qu": "que", "ru": "rus", "sr": "srp",
    "sw": "swa", "ta": "tam", "te": "tel", "th": "tha", "tl": "tgl", "ur": "urd", "vi": "vie",
    "zh": "zho",
}


def tag_language(tag: str | None) -> str | None:
    """ "zh-Hant" -> "zho", "tzm" -> "tzm", "" -> None."""
    primary = (tag or "").split("-")[0].lower()
    return TAG_TO_ISO.get(primary, primary if len(primary) == 3 else None)


def has_non_latin_letters(name: str) -> bool:
    """True for "አማርኛ" or "Русский"; false for "Sm'algyax" or "olelo paʻi ʻai"."""
    for ch in name:
        if not ch.isalpha():
            continue
        char_name = unicodedata.name(ch, "")
        if "LATIN" not in char_name and "MODIFIER" not in char_name:
            return True
    return False


def native_names(conn: sqlite3.Connection, codes: dict[int, tuple[str | None, str | None]]) -> dict[int, str]:
    """Each language's name in the language itself, where the database has it.

    The database's alternate names mix three kinds: names in the language
    itself, the name translated into big languages, and other English names
    and spellings. Only some carry a tag saying what language they're in, so:
      1. a name tagged with the language's own code ("Русский", tagged "ru",
         for Russian), else
      2. an untagged name in a non-Latin script ("አማርኛ" for Amharic). Untagged
         Latin-script names are mostly other English spellings, so they're skipped.
    """
    tagged: dict[int, str] = {}
    untagged: dict[int, str] = {}
    for grn_id, name, tag in conn.execute(
        "SELECT grn_language_id, language_name, name_in FROM AlternateLanguageName ORDER BY rowid"
    ):
        if grn_id not in codes or not name:
            continue
        # "官話; 北方話" lists two names; keep the first.
        name = " ".join(name.split(";")[0].split())
        if not name:
            continue
        if tag:
            if tag_language(tag) in codes[grn_id]:
                tagged.setdefault(grn_id, name)
        elif has_non_latin_letters(name):
            untagged.setdefault(grn_id, name)
    return {**untagged, **tagged}


def previous_sample_flags() -> dict[int, dict]:
    """The sample flags tools/mark_samples.py last wrote, by GRN ID."""
    if not LANGUAGES_JSON.is_file():
        return {}
    return {
        lang["id"]: {flag: lang[flag] for flag in SAMPLE_FLAGS if flag in lang}
        for lang in json.loads(LANGUAGES_JSON.read_text(encoding="utf-8"))
    }


def build_languages(db_path: Path, sample_flags: dict[int, dict]) -> list[dict]:
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    countries: dict[int, list[str]] = defaultdict(list)
    for language_id, code in conn.execute(
        """
        SELECT DISTINCT ll.language_id, loc.country_code
        FROM LocationLanguages ll JOIN Location loc ON loc.grn_location_id = ll.location_id
        WHERE loc.location_type = 3 AND loc.country_code IS NOT NULL AND loc.country_code != ''
        ORDER BY loc.country_code
        """
    ):
        countries[language_id].append(code)

    rows = conn.execute(
        """
        SELECT l.grn_language_id, l.default_language_name, i.iso_code, m.iso_code, l.parent_id, l.audio_sample
        FROM Languages l
        LEFT JOIN ISOList i ON i.iso_id = l.iso_id
        LEFT JOIN ISOList m ON m.iso_id = l.macro_iso_id
        ORDER BY l.grn_language_id
        """
    ).fetchall()
    natives = native_names(conn, {row[0]: (row[2], row[3]) for row in rows})

    languages = []
    for grn_id, name, iso, macro, parent_id, sample in rows:
        entry = {"id": grn_id, "name": name}
        native = natives.get(grn_id)
        # "English" is no news next to the English name.
        if native and native.casefold() != name.casefold():
            entry["native"] = native
        entry["iso"] = iso
        # Umbrella code such as "que" (Quechua) or "ara" (Arabic). Meta's model
        # sometimes answers with one, and it maps to these member languages.
        if macro and macro != iso:
            entry["macro"] = macro
        if parent_id is not None:
            entry["parent"] = parent_id
        if countries.get(grn_id):
            entry["countries"] = countries[grn_id]
        if grn_id in sample_flags:
            entry.update(sample_flags[grn_id])
        elif not sample:
            entry["noSample"] = True
        languages.append(entry)
    conn.close()
    return languages


def round_coords(coords, places=2):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], places), round(coords[1], places)]
    return [round_coords(c, places) for c in coords]


def build_borders() -> dict:
    with urllib.request.urlopen(BORDERS_URL) as resp:
        source = json.load(resp)
    features = []
    for f in source["features"]:
        # ISO_A2 is "-99" for France and Norway in this release; ISO_A2_EH is filled in.
        code = f["properties"]["ISO_A2_EH"]
        if code == "-99":
            continue
        geometry = f["geometry"]
        features.append(
            {
                "type": "Feature",
                "properties": {"code": code, "name": f["properties"]["NAME"]},
                "geometry": {"type": geometry["type"], "coordinates": round_coords(geometry["coordinates"])},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    args = sys.argv[1:]
    with_borders = "--borders" in args
    paths = [arg for arg in args if arg != "--borders"]
    if len(paths) > 1 or any(arg.startswith("-") for arg in paths):
        sys.exit(__doc__)
    db_path = Path(paths[0]) if paths else ROOT / "tools" / "database_5fish.db"
    if not db_path.is_file():
        sys.exit(f"Database not found: {db_path}\n\n{__doc__}")
    languages = build_languages(db_path, previous_sample_flags())
    LANGUAGES_JSON.write_text(json.dumps(languages, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"languages.json: {len(languages)} languages, {sum('native' in lang for lang in languages)} with a native name")
    if with_borders or not BORDERS_GEOJSON.is_file():
        borders = build_borders()
        BORDERS_GEOJSON.write_text(json.dumps(borders, separators=(",", ":")), encoding="utf-8")
        print(f"countries.geojson: {len(borders['features'])} countries")


if __name__ == "__main__":
    main()
