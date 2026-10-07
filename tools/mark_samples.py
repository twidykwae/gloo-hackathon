"""Mark which languages have a sample recording, and which are only headings.

    python tools/mark_samples.py [path/to/grn-export/languages.json]

Updates data/languages.json (from tools/build_data.py) in place, using GRN's
own data export. The export defaults to ../data/languages.json, next to this
project (not in git; about 85 MB, and GRN's to share). Run it after every
build_data.py run.

  noSample: true   GRN has no sample recording. The 5fish database says every
                   language has one, but GRN's media server agrees with the
                   export's "sample" field instead.
  heading: true    No recording of its own, and other languages name it as
                   their parent. "English" (#5185) is one: GRN records its
                   varieties, such as "English: USA". The page names a guess
                   after it but doesn't list it as a variety.

Languages missing from the export are left as they are.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGUAGES_JSON = ROOT / "data" / "languages.json"
DEFAULT_EXPORT = ROOT.parent / "data" / "languages.json"


def mark(languages: list[dict], export: list[dict]) -> list[dict]:
    has_sample = {int(lang["id"]): bool(lang.get("sample")) for lang in export}
    parents = {lang["parent"] for lang in languages if lang.get("parent") is not None}
    for lang in languages:
        lang.pop("noSample", None)
        lang.pop("heading", None)
        if has_sample.get(lang["id"], True):
            continue
        lang["noSample"] = True
        if lang["id"] in parents:
            lang["heading"] = True
    return languages


def main() -> None:
    if len(sys.argv) > 2:
        sys.exit(__doc__)
    export_path = Path(sys.argv[1]) if len(sys.argv) == 2 else DEFAULT_EXPORT
    if not export_path.is_file():
        sys.exit(f"GRN export not found: {export_path}\n\n{__doc__}")
    export = json.loads(export_path.read_text(encoding="utf-8"))["data"]["languages"]
    languages = mark(json.loads(LANGUAGES_JSON.read_text(encoding="utf-8")), export)
    LANGUAGES_JSON.write_text(json.dumps(languages, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"languages.json: {len(languages)} languages")
    print(f"  no sample: {sum(1 for lang in languages if lang.get('noSample'))}")
    print(f"  headings:  {sum(1 for lang in languages if lang.get('heading'))}")


if __name__ == "__main__":
    main()
