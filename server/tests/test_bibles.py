import httpx
import pytest
from fastapi.testclient import TestClient

from app.bibles import BibleLookupError, GrnLanguage, YouVersion, load_grn_languages
from app.config import PAGE_DIR, Settings
from app.identifiers import StubIdentifier
from app.main import create_app

GRN = {
    1: GrnLanguage(1, "Amharic", "amh"),
    2973: GrnLanguage(2973, "Mixtec, Metlatonoc", "mxv"),
    171: GrnLanguage(171, "Kijita", "jit"),
    9: GrnLanguage(9, "No code", None),
}

LANGUAGES = [
    {"id": "am", "aliases": ["amh"], "default_bible_id": 1260},
    {"id": "mxv", "aliases": [], "default_bible_id": 1790},
    {"id": "jit", "aliases": [], "default_bible_id": None},
]
BIBLES = {
    "am": [
        {"id": 2000, "abbreviation": "OTHER", "youversion_deep_link": "https://www.bible.com/versions/2000"},
        {"id": 1260, "abbreviation": "NASV", "localized_title": "አዲሱ መደበኛ ትርጒም", "copyright": "©",
         "youversion_deep_link": "https://www.bible.com/versions/1260"},
    ],
    "mxv": [{"id": 1790, "abbreviation": "mxvNT", "youversion_deep_link": "https://www.bible.com/versions/1790"}],
}
LICENSED = [{"id": 1790}]


def fake_youversion(calls=None, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        assert request.headers["X-YVP-App-Key"] == "test-key"
        if status != 200:
            return httpx.Response(status)
        if request.url.path == "/v1/languages":
            return httpx.Response(200, json={"data": LANGUAGES})
        if request.url.path == "/v1/bibles/1790":  # one Bible's own record carries its copyright
            return httpx.Response(200, json={"id": 1790, "copyright": "© 1995, Wycliffe"})
        tag = request.url.params["language_ranges[]"]
        if tag == "*":
            return httpx.Response(200, json={"data": LICENSED})
        found = BIBLES.get(tag)
        # YouVersion answers "nothing found" with an empty body.
        return httpx.Response(200, json={"data": found}) if found else httpx.Response(204)

    return YouVersion("test-key", GRN, http=httpx.Client(transport=httpx.MockTransport(handler)))


def test_finds_the_default_bible_through_the_iso_alias():
    result = fake_youversion().bible_for(1)
    assert result["youversion_language"] == "am"
    assert result["bible_count"] == 2
    bible = result["bible"]
    assert bible["id"] == 1260
    assert bible["url"] == "https://www.bible.com/versions/1260"
    assert bible["copyright"] == "©"
    assert bible["can_show_text"] is False  # 1260 isn't licensed


def test_reports_when_the_text_can_be_shown():
    bible = fake_youversion().bible_for(2973)["bible"]
    assert bible["can_show_text"] is True
    # The language's Bible list leaves the copyright out; it's fetched from the Bible itself.
    assert bible["copyright"] == "© 1995, Wycliffe"


def test_language_without_a_bible():
    result = fake_youversion().bible_for(171)
    assert result["youversion_language"] == "jit"
    assert result["bible"] is None
    assert result["bible_count"] == 0


def test_language_without_an_iso_code():
    result = fake_youversion().bible_for(9)
    assert result["youversion_language"] is None
    assert result["bible"] is None


def test_caches_lookups():
    calls = []
    yv = fake_youversion(calls)
    yv.bible_for(1)
    yv.bible_for(1)
    yv.bible_for(2973)
    yv.bible_for(2973)
    # Languages + licensed list once, one Bible list per language, and one
    # copyright lookup for the licensed Bible 1790.
    assert len(calls) == 5


def test_refused_key_is_an_error():
    with pytest.raises(BibleLookupError):
        fake_youversion(status=403).bible_for(1)


def test_dialects_use_their_parent_languages_code():
    languages = load_grn_languages(PAGE_DIR / "data" / "languages.json")
    dialect = next(l for l in languages.values() if l.iso and l.name == "Vietnamese: South")
    assert dialect.iso == "vie"


def client(youversion=None):
    settings = Settings(youversion_app_key="")  # no real YouVersion calls from tests
    return TestClient(create_app(settings=settings, identifier=StubIdentifier(["spa"]), youversion=youversion))


def test_endpoint():
    resp = client(fake_youversion()).get("/bible/1")
    assert resp.status_code == 200
    assert resp.json()["bible"]["id"] == 1260


def test_endpoint_unknown_language():
    assert client(fake_youversion()).get("/bible/424242").status_code == 404


def test_endpoint_youversion_down():
    assert client(fake_youversion(status=500)).get("/bible/1").status_code == 502


def test_endpoint_without_a_key():
    assert client().get("/bible/1").status_code == 503


def test_retries_once_when_youversion_hiccups():
    failures = {"left": 1}

    def handler(request: httpx.Request) -> httpx.Response:
        if failures["left"]:
            failures["left"] -= 1
            return httpx.Response(500)
        if request.url.path == "/v1/languages":
            return httpx.Response(200, json={"data": LANGUAGES})
        tag = request.url.params.get("language_ranges[]")
        if tag == "*":
            return httpx.Response(200, json={"data": LICENSED})
        return httpx.Response(200, json={"data": BIBLES.get(tag, [])})

    yv = YouVersion("test-key", GRN, http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert yv.bible_for(1)["bible"]["id"] == 1260
