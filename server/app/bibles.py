"""A GRN language's Bible on YouVersion, via the YouVersion Platform API.

GRN language id -> its ISO 639-3 code (data/languages.json; dialects use
their parent's) -> YouVersion's language tag (YouVersion lists 3-letter ISO
codes as aliases, e.g. "am" has alias "amh") -> that language's Bibles.

Every Bible YouVersion has comes back with a bible.com link, which opens it
in YouVersion's own app or site. `can_show_text` says whether this app's key
is also licensed to show the text itself; that changes as licenses are agreed
to in the YouVersion Platform portal, so it's re-checked every hour.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

API = "https://api.youversion.com/v1"
CACHE_SECONDS = 60 * 60


class BibleLookupError(Exception):
    """YouVersion couldn't be reached or refused the request."""


class UnknownLanguage(Exception):
    """No GRN language with this id."""


@dataclass(frozen=True)
class GrnLanguage:
    id: int
    name: str
    iso: str | None  # its own ISO 639-3 code, else its macrolanguage's or parent's


def load_grn_languages(path: Path) -> dict[int, GrnLanguage]:
    rows = {row["id"]: row for row in json.loads(path.read_text(encoding="utf-8"))}

    def iso_for(row: dict) -> str | None:
        for _ in range(6):  # walk up dialect -> parent language
            if row.get("iso") or row.get("macro"):
                return row.get("iso") or row.get("macro")
            row = rows.get(row.get("parent"))
            if row is None:
                return None
        return None

    return {id_: GrnLanguage(id_, row["name"], iso_for(row)) for id_, row in rows.items()}


class YouVersion:
    def __init__(self, app_key: str, grn_languages: dict[int, GrnLanguage], http: httpx.Client | None = None):
        self.grn_languages = grn_languages
        self.http = http or httpx.Client(timeout=20)
        self.headers = {"X-YVP-App-Key": app_key, "Accept": "application/json"}
        self._lock = threading.Lock()
        self._loaded_at = 0.0
        self._tags: dict[str, dict] = {}  # language tag or ISO alias -> YouVersion language
        self._licensed: set[int] = set()
        self._bibles: dict[str, list[dict]] = {}  # language tag -> its Bibles
        self._copyrights: dict[int, str | None] = {}

    def _get(self, path: str, params: dict | None = None) -> dict:
        # One retry: YouVersion occasionally answers 500 to a request that works a moment later.
        for attempt in (1, 2):
            try:
                response = self.http.get(f"{API}{path}", params=params, headers=self.headers)
            except httpx.HTTPError as e:
                if attempt == 2:
                    raise BibleLookupError(f"could not reach YouVersion: {e}") from e
                continue
            if response.status_code < 500 or attempt == 2:
                break
        if response.status_code in (401, 403):
            raise BibleLookupError(f"YouVersion refused the request ({response.status_code}); check the app key")
        if response.status_code not in (200, 204):  # 204: nothing found
            raise BibleLookupError(f"YouVersion returned {response.status_code} for {path}")
        # YouVersion answers a list with no matches with an empty body.
        return response.json() if response.content else {}

    def _refresh(self) -> None:
        """Load YouVersion's languages and this key's licensed Bibles, hourly."""
        if time.monotonic() - self._loaded_at < CACHE_SECONDS and self._tags:
            return
        fields = ["id", "aliases", "default_bible_id"]
        languages = self._get("/languages", {"page_size": "*", "fields[]": fields}).get("data", [])
        tags: dict[str, dict] = {lang["id"]: lang for lang in languages}
        for lang in languages:
            for alias in lang.get("aliases") or []:
                tags.setdefault(alias, lang)
        licensed = self._get("/bibles", {"language_ranges[]": "*", "page_size": "*", "fields[]": ["id"]})
        self._tags = tags
        self._licensed = {b["id"] for b in licensed.get("data", [])}
        self._bibles = {}
        self._loaded_at = time.monotonic()

    def _bibles_for(self, tag: str) -> list[dict]:
        if tag not in self._bibles:
            found = self._get("/bibles", {"language_ranges[]": tag, "all_available": "true"})
            self._bibles[tag] = found.get("data", [])
        return self._bibles[tag]

    def _copyright(self, bible_id: int) -> str | None:
        if bible_id not in self._copyrights:
            self._copyrights[bible_id] = self._get(f"/bibles/{bible_id}").get("copyright")
        return self._copyrights[bible_id]

    def bible_for(self, grn_id: int) -> dict:
        language = self.grn_languages.get(grn_id)
        if language is None:
            raise UnknownLanguage(f"no GRN language {grn_id}")
        with self._lock:
            self._refresh()
            yv_language = self._tags.get(language.iso) if language.iso else None
            bibles = self._bibles_for(yv_language["id"]) if yv_language else []
            licensed = set(self._licensed)

        result = {
            "grn_id": grn_id,
            "language": language.name,
            "iso": language.iso,
            "youversion_language": yv_language["id"] if yv_language else None,
            "bible": None,
            "bible_count": len(bibles),
        }
        if not bibles:
            return result
        default_id = yv_language.get("default_bible_id")
        # Prefer the language's default Bible, then one we can show, then any.
        chosen = (
            next((b for b in bibles if b["id"] == default_id), None)
            or next((b for b in bibles if b["id"] in licensed), None)
            or bibles[0]
        )
        copyright_ = chosen.get("copyright")
        if not copyright_ and chosen["id"] in licensed:
            # Language lists leave the copyright out; the Bible's own record has it.
            with self._lock:
                copyright_ = self._copyright(chosen["id"])
        result["bible"] = {
            "id": chosen["id"],
            "abbreviation": chosen.get("localized_abbreviation") or chosen.get("abbreviation"),
            "title": chosen.get("title"),
            "localized_title": chosen.get("localized_title"),
            # YouVersion requires the version name and copyright beside any text shown.
            "copyright": copyright_,
            "url": chosen.get("youversion_deep_link") or f"https://www.bible.com/versions/{chosen['id']}",
            "can_show_text": chosen["id"] in licensed,
        }
        return result
