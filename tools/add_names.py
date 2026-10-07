"""Add each language's name in other languages to data/languages.json.

The page shows language names in the device's language ("Tzotzil de Chamula"
on a Spanish phone), so each language gets a `names` map: {"es": "Tzotzil de
Chamula", "fr": ...}. English isn't in it: that's `name`. Names come from GRN's
languageNames export (the GraphQL API's language names, each tagged with the
language it's written in); where a language has several in one, the one GRN
marks best wins, else the first.

    python tools/add_names.py path/to/languageNames.json

Run it again after tools/build_data.py, which rewrites languages.json without them.
"""

import json
import sys
from pathlib import Path

LANGUAGES = Path(__file__).resolve().parents[1] / "data" / "languages.json"


def translated_names(rows: list[dict], ids: set[int]) -> dict[int, dict[str, str]]:
    """{GRN ID: {language tag: name}} for these languages, English left out."""
    names: dict[int, dict[str, str]] = {}
    for row in rows:
        tag, grn_id, name = row.get("langTag"), row.get("langNo"), " ".join(str(row.get("name") or "").split())
        if not tag or tag == "en" or grn_id not in ids or not name:
            continue
        own = names.setdefault(grn_id, {})
        if tag not in own or row.get("best"):
            own[tag] = name
    return names


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    export = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["data"]
    rows = export if isinstance(export, list) else [row for chunk in export.values() for row in chunk]
    languages = json.loads(LANGUAGES.read_text(encoding="utf-8"))
    names = translated_names(rows, {lang["id"] for lang in languages})
    for lang in languages:
        lang.pop("names", None)
        # Only names that say something the English one doesn't.
        own = {tag: name for tag, name in names.get(lang["id"], {}).items() if name != lang["name"]}
        if own:
            lang["names"] = own
    LANGUAGES.write_text(json.dumps(languages, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"languages.json: {sum('names' in lang for lang in languages)} of {len(languages)} languages have names in other languages")


if __name__ == "__main__":
    main()
