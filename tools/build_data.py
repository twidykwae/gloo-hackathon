"""Build the static data files the page loads.

    python tools/build_data.py [path/to/database_5fish.db]

The database defaults to tools/database_5fish.db (not in git; it's the 5fish
apps' offline database, copied from the 2025 prototype).

Writes:
  data/languages.json      every GRN language: name, ISO code, macrolanguage code, parent,
                           sample flag, countries
  data/countries.geojson   country borders (Natural Earth 1:110m, public domain), trimmed,
                           used to turn GPS coordinates into a country code

Run it again whenever the 5fish database is updated, then run
tools/mark_samples.py: the 5fish database's sample flag says every language
has one, so the sample flag written here is replaced by GRN's.
"""

from __future__ import annotations

import json
import sqlite3
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BORDERS_URL = (
    "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson"
)


def build_languages(db_path: Path) -> list[dict]:
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

    languages = []
    for grn_id, name, iso, macro, parent_id, sample in conn.execute(
        """
        SELECT l.grn_language_id, l.default_language_name, i.iso_code, m.iso_code, l.parent_id, l.audio_sample
        FROM Languages l
        LEFT JOIN ISOList i ON i.iso_id = l.iso_id
        LEFT JOIN ISOList m ON m.iso_id = l.macro_iso_id
        ORDER BY l.grn_language_id
        """
    ):
        entry = {"id": grn_id, "name": name, "iso": iso}
        # Umbrella code such as "que" (Quechua) or "ara" (Arabic). Meta's model
        # sometimes answers with one, and it maps to these member languages.
        if macro and macro != iso:
            entry["macro"] = macro
        if parent_id is not None:
            entry["parent"] = parent_id
        if not sample:
            entry["noSample"] = True
        if countries.get(grn_id):
            entry["countries"] = countries[grn_id]
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
    if len(sys.argv) > 2:
        sys.exit(__doc__)
    db_path = Path(sys.argv[1]) if len(sys.argv) == 2 else ROOT / "tools" / "database_5fish.db"
    if not db_path.is_file():
        sys.exit(f"Database not found: {db_path}\n\n{__doc__}")
    languages = build_languages(db_path)
    (ROOT / "data" / "languages.json").write_text(
        json.dumps(languages, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    borders = build_borders()
    (ROOT / "data" / "countries.geojson").write_text(json.dumps(borders, separators=(",", ":")), encoding="utf-8")
    print(f"languages.json: {len(languages)} languages")
    print(f"countries.geojson: {len(borders['features'])} countries")


if __name__ == "__main__":
    main()
