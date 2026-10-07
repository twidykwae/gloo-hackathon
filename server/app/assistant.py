"""Gloo AI on the Resources screen: a short guide to the chosen language's
resources, and a chat for questions.

Both run through Gloo's guarded (values-aligned) Completions API. The server,
not the page, writes what the model is told about the language and its
resources, so answers only describe resources that exist.

Gloo calls cost money, so:
- the model is named (no auto-routing to a pricier one) and answers are capped;
- each language's guide is generated once and cached;
- spending is counted from Gloo's token usage and stops at a daily budget,
  with the running total saved to disk so a restart doesn't reset it.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx

logger = logging.getLogger("language_id")

API = "https://platform.ai.gloo.com/ai/v2/guarded/chat/completions"
# No guardrails or values layer: only for plain translation of the page's labels, which the
# guarded layer answers as if they were a chat ("What can I help you with today?").
DIRECT_API = "https://platform.ai.gloo.com/ai/v2/direct/chat/completions"

# Chat limits: what the page may send per question.
MAX_MESSAGES = 12
MAX_MESSAGE_CHARS = 600
MAX_HISTORY_CHARS = 5000


# Each country's national or most widely understood language: {"countries": {"MX": "es"},
# "languages": {"es": {"name": "Spanish", "iso": ["es", "spa"]}}}. Built from YouVersion's language data.
_TABLE = json.loads((Path(__file__).with_name("country_languages.json")).read_text(encoding="utf-8"))
_BY_ISO = {code: tag for tag, lang in _TABLE["languages"].items() for code in lang["iso"]}


def note_languages(iso: str | None, language: str, device: str | None) -> list[tuple[str, str]]:
    """(BCP-47 tag, name) of the languages to write to this person in, best first.

    Always the chosen language first: by its short tag when it has one
    (Amharic: am), else its ISO 639-3 code under its GRN name (Tzotzil:
    Chamula, tzo). Then the device's language setting (es-MX: Spanish), for
    when the model can't write a note in the chosen one that passes; English
    when the device didn't say. Where the person is never picks the language.
    """
    names = _TABLE["languages"]
    own = (_BY_ISO.get(iso) or iso) if iso else ""
    candidates = [(own, names[own]["name"] if own in names else language)]
    primary = (device or "").split("-")[0].lower()
    fallback = _BY_ISO.get(primary, primary) if re.fullmatch(r"[a-z]{2,3}", primary) else "en"
    candidates.append((fallback, names[fallback]["name"] if fallback in names else fallback))
    # The device's language is the chosen one: one entry, not two.
    return list({tag or name: (tag, name) for tag, name in candidates}.values())


def note_language(iso: str | None, language: str, device: str | None) -> tuple[str, str]:
    """The best of note_languages(): the chosen language."""
    return note_languages(iso, language, device)[0]


def looks_broken(text: str, max_chars: int = 900) -> bool:
    """A runaway answer: far too long, or the same few words over and over."""
    if len(text) > max_chars:
        return True
    words = text.lower().split()
    grams = [" ".join(words[i : i + 4]) for i in range(len(words) - 3)]
    return any(grams.count(g) > 2 for g in set(grams))


class AssistantError(Exception):
    """Gloo couldn't be reached or refused the request."""


class OverBudget(Exception):
    """Today's Gloo budget is spent."""


@dataclass(frozen=True)
class Resources:
    """What the chosen language has, as facts for the model."""

    language: str
    native: str | None
    iso: str | None
    countries: list[str]
    content_url: str
    bible: str | None  # e.g. "Tzotzil de Huixtán (tzoA), in the YouVersion Bible App"
    country: str | None = None  # where the person is, when the page knows
    device_language: str | None = None  # the device's language setting, e.g. es-MX

    def facts(self) -> str:
        lines = [
            f"Language chosen: {self.language}"
            + (f" (its own name: {self.native})" if self.native else "")
            + (f", ISO 639-3 {self.iso}" if self.iso else ""),
            f"Countries where it is spoken (ISO codes): {', '.join(self.countries[:12]) or 'unknown'}",
        ]
        if self.country:
            lines.append(f"The person is in country {self.country} right now.")
        lines.append(
            f"Resource 1: 5fish ({self.content_url}). Free audio Bible stories, Gospel messages and songs "
            "recorded by Global Recordings Network in this language. They can be played online, downloaded "
            "to listen offline, and shared with others."
        )
        lines.append(
            f"Resource 2: a Bible, {self.bible}. Free to read on bible.com or in the YouVersion Bible App."
            if self.bible
            else "There is no Bible in this language on YouVersion yet; do not suggest one."
        )
        return "\n".join(lines)


GUIDE_PROMPT = """You write a short, warm note for someone who has just found recordings in their own language.
Write only in {name} (language tag {tag}), even if the chosen language is a different one.
Use plain words and short sentences for a reader with little schooling. No lists, no bold, no headings, no emoji.
Only mention the resources in the facts. Do not invent features, links, or numbers, and do not say whether \
the Bible is complete.
Keep the whole note under 35 words. Write exactly these sentences, in this order:
1. One short sentence: a warm welcome, and that on 5fish they can listen to Bible stories and songs in their \
own language, even without internet.
{bible_step}
Then a line with only ---. Then 3 short questions, one per line, in {name}, that the person would tap to ask \
you, an assistant, for help. Write them in the person's own voice (I, my), about using these resources or about \
the Bible, for example: How do I listen without internet? / Can I share this with my family? / Where should I \
start listening? Never ask the person about themselves or their feelings."""

BIBLE_STEP = "2. One short sentence inviting them to read the Bible in their own language in the free \
YouVersion Bible App."
NO_BIBLE_STEP = "There is no Bible in their language on YouVersion yet, so do not mention any Bible app."


def mentions_resources(text: str, has_bible: bool) -> bool:
    """The note names 5fish, and YouVersion when there's a Bible: the point of the note."""
    lower = text.lower()
    return "5fish" in lower and (not has_bible or "youversion" in lower)


CHAT_PROMPT = """You help someone who has just found Bible recordings in their own language, often with a \
helper or field worker beside them. Answer questions about the resources below, how to use them (listening, \
downloading for offline use, sharing), and about the Christian faith.
Reply in the language the person writes in; if you can't tell, reply in {name}. Write plain text without markdown (no asterisks, no bold, no headings). Keep answers short (at most about 90 words), plain and kind. \
If you do not know something about these resources, say so instead of guessing, and never invent links.

Facts about this person's language and resources:
{facts}"""


def plain(text: str) -> str:
    """Markdown the page would show as symbols, removed: bold, headings, bullets."""
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"^\s{0,3}#+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[*•-]\s+", "• ", text, flags=re.MULTILINE)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_guide(content: str, max_chars: int = 280) -> tuple[str, list[str]]:
    """(note, questions) from the model's reply: the asked-for "note --- questions"
    format, JSON, or prose with a list of questions at the end."""
    try:
        reply = _json_reply(content)
        note, questions = str(reply.get("text") or ""), [str(q) for q in reply.get("questions") or []]
    except AssistantError:
        if "---" in content:
            note, _, rest = content.partition("---")
            questions = rest.splitlines()
        else:
            # Prose: trailing lines that are questions are the questions.
            lines = content.strip().splitlines()
            questions = []
            while lines and (lines[-1].strip().endswith("?") or not lines[-1].strip()):
                questions.insert(0, lines.pop())
            if lines and lines[-1].strip().endswith(":"):
                lines.pop()  # a "Questions:" heading
            note = "\n".join(lines)
    questions = [re.sub(r"^\s*([*•-]|\d+[.)])\s*", "", plain(q)).strip() for q in questions]
    questions = [q for q in questions if q.endswith("?")][:3]
    # One flowing paragraph of whole sentences, short enough to read at a glance.
    note = " ".join(line.lstrip("• ").strip() for line in plain(note).splitlines() if line.strip())
    if len(note) > max_chars:
        sentences = re.split(r"(?<=[.!?。])\s+", note)
        note = ""
        for sentence in sentences:
            if note and len(note) + len(sentence) + 1 > max_chars:
                break
            note = f"{note} {sentence}".strip()
    return note, questions


def _json_reply(content: str) -> dict:
    """The model's JSON, tolerating a ```json fence around it."""
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise AssistantError("Gloo's answer had no JSON in it")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as e:
        raise AssistantError(f"Gloo's answer wasn't valid JSON: {e}") from e


# The chat and note's own words on the page, in English. The page shows these
# until the translated ones arrive with the guide.
LABELS = {
    "note": "A note for you",
    "chatTitle": "Have a question?",
    "chatLede": "Ask about listening, sharing, or the Bible. Type in any language.",
    "placeholder": "Ask a question…",
    "send": "Send",
}

LABELS_PROMPT = """Translate the text after each colon into {name} (language tag {tag}). These are labels \
on a screen for people with little schooling, so use plain, natural words, and keep each label's meaning.
Reply with exactly the same lines in the same "key: text" form: keep each key in English exactly as given, \
and translate only the text after the colon. No other text."""


def parse_labels(content: str) -> dict | None:
    """{key: translation} from "key: text" lines, or None unless every label came back."""
    found = {}
    for line in content.splitlines():
        key, sep, text = line.partition(":")
        key = key.strip().strip("*`- ")
        if sep and key in LABELS and text.strip():
            found[key] = plain(text).strip().strip('"')
    return found if set(found) == set(LABELS) else None


class Budget:
    """Today's spend in dollars, counted from token usage, kept in a small JSON file."""

    def __init__(self, path: Path, daily_usd: float, input_per_m: float, output_per_m: float):
        self.path = path
        self.daily_usd = daily_usd
        self.input_per_m = input_per_m
        self.output_per_m = output_per_m
        self._lock = threading.Lock()

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        today = date.today().isoformat()
        if data.get("date") != today:
            data = {"date": today, "spent_usd": 0.0, "calls": 0, "total_usd": data.get("total_usd", 0.0)}
        return data

    def check(self) -> None:
        with self._lock:
            if self._load()["spent_usd"] >= self.daily_usd:
                raise OverBudget(f"today's Gloo budget of ${self.daily_usd:.2f} is spent")

    def record(self, usage: dict) -> float:
        cost = (
            (usage.get("prompt_tokens") or 0) * self.input_per_m
            + (usage.get("completion_tokens") or 0) * self.output_per_m
        ) / 1_000_000
        with self._lock:
            data = self._load()
            data["spent_usd"] = round(data["spent_usd"] + cost, 6)
            data["total_usd"] = round(data.get("total_usd", 0.0) + cost, 6)
            data["calls"] += 1
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(data), encoding="utf-8")
        return cost


class Assistant:
    def __init__(
        self,
        api_key: str,
        model: str,
        budget: Budget,
        tradition: str = "evangelical",
        http: httpx.Client | None = None,
        labels_file: Path | None = None,
    ):
        self.model = model
        self.labels_file = labels_file  # translated labels, kept so each language is paid for once
        self.budget = budget
        self.tradition = tradition
        self.http = http or httpx.Client(timeout=45)
        self.headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        self._guides: dict[tuple, dict] = {}

    def _complete(self, messages: list[dict], max_tokens: int, temperature: float, guarded: bool = True) -> str:
        self.budget.check()
        body = {"model": self.model, "max_tokens": max_tokens, "temperature": temperature, "messages": messages}
        if guarded:
            body["auto_routing"] = False  # never let Gloo pick a pricier model
            body["tradition"] = self.tradition
        try:
            response = self.http.post(API if guarded else DIRECT_API, json=body, headers=self.headers)
        except httpx.HTTPError as e:
            raise AssistantError(f"could not reach Gloo: {e}") from e
        if response.status_code != 200:
            raise AssistantError(f"Gloo returned {response.status_code}: {response.text[:200]}")
        data = response.json()
        self.budget.record(data.get("usage") or {})
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError) as e:
            raise AssistantError("Gloo's answer had no message") from e

    def labels(self, tag: str, name: str) -> dict:
        """The page's labels in this language, translated once and then read from labels_file."""
        if tag == "en" or tag.startswith("en-"):
            return dict(LABELS)
        saved = {}
        if self.labels_file and self.labels_file.exists():
            try:
                saved = json.loads(self.labels_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                saved = {}
        if tag not in saved:
            content = self._complete(
                [
                    {"role": "system", "content": LABELS_PROMPT.format(name=name, tag=tag, count=len(LABELS))},
                    {"role": "user", "content": "\n".join(f"{key}: {text}" for key, text in LABELS.items())},
                ],
                max_tokens=200,
                temperature=0.2,
                guarded=False,
            )
            translated = parse_labels(content)
            if translated is None or looks_broken(content, max_chars=800):
                logger.warning("Labels rejected for %s: %.200s", tag, content)
                return dict(LABELS)
            saved[tag] = translated
            if self.labels_file:
                self.labels_file.parent.mkdir(parents=True, exist_ok=True)
                self.labels_file.write_text(json.dumps(saved, ensure_ascii=False, indent=1), encoding="utf-8")
        return {**LABELS, **saved[tag]}

    def guide(self, resources: Resources) -> dict:
        """{language, tag, text, questions, labels}: cached per language, resources and country."""
        key = (resources.language, resources.bible, resources.country, resources.device_language)
        if key not in self._guides:
            bible_step = BIBLE_STEP if resources.bible else NO_BIBLE_STEP
            # The chosen language first (two tries), then the device's (one), if a note doesn't pass.
            attempts = []
            for i, (tag, name) in enumerate(note_languages(resources.iso, resources.language, resources.device_language)):
                attempts += [(tag, name, 0.4), (tag, name, 0.2)] if i == 0 else [(tag, name, 0.3)]
            for tag, name, temperature in attempts:
                prompt = GUIDE_PROMPT.format(name=name, tag=tag, bible_step=bible_step)
                content = self._complete(
                    [{"role": "system", "content": prompt}, {"role": "user", "content": resources.facts()}],
                    max_tokens=450,
                    temperature=temperature,
                )
                text, questions = parse_guide(content)
                if text and not looks_broken(content, max_chars=2000) and mentions_resources(text, bool(resources.bible)):
                    break
                logger.warning("Guide rejected (%s): %.200s", tag, content)
            else:
                raise AssistantError("Gloo's guide didn't describe the resources")
            try:
                labels = self.labels(tag or name, name)  # a language without an ISO code is kept by name
            except (AssistantError, OverBudget) as e:
                logger.warning("Labels stay in English: %s", e)
                labels = dict(LABELS)
            self._guides[key] = {
                "language": name,
                "tag": tag,
                "text": text,
                "questions": questions,
                "labels": labels,
            }
        return self._guides[key]

    def chat(self, resources: Resources, messages: list[dict]) -> str:
        _, name = note_language(resources.iso, resources.language, resources.device_language)
        reply = self._complete(
            [{"role": "system", "content": CHAT_PROMPT.format(facts=resources.facts(), name=name)}, *messages],
            max_tokens=400,
            temperature=0.5,
        ).strip()
        if not reply or looks_broken(reply, max_chars=1500):
            logger.warning("Chat answer rejected: %.200s", reply)
            raise AssistantError("Gloo's answer was empty or broken")
        return plain(reply)


def clean_messages(messages: list[dict]) -> list[dict]:
    """The page's conversation, trimmed to what we're willing to send (and pay for)."""
    cleaned = [
        {"role": m.get("role"), "content": str(m.get("content") or "").strip()[:MAX_MESSAGE_CHARS]}
        for m in messages[-MAX_MESSAGES:]
        if m.get("role") in ("user", "assistant") and str(m.get("content") or "").strip()
    ]
    # Drop the oldest turns until the whole conversation fits.
    while cleaned and sum(len(m["content"]) for m in cleaned) > MAX_HISTORY_CHARS:
        cleaned.pop(0)
    if not cleaned or cleaned[-1]["role"] != "user":
        raise ValueError("the conversation must end with the person's question")
    return cleaned
