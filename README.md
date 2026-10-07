# Language ID (web)

Record someone speaking, ask for consent to keep the recording, send it to the
language-ID model, and show a ranked list of languages. It's
all on one page and one URL.

Plain HTML, JavaScript and CSS for the page, with no build step. A small
Python server in `server/` runs the language-ID model and serves the page.

**Status:** the whole flow works with **real results from Meta's
language-ID model** (`facebook/mms-lid-4017`). Storing consent answers and kept
recordings isn't built yet (see "Still to decide").

## Run it

One command starts everything: the model and the page, on one address.

```bash
cd C:\dev\language-id-web\server
.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8080
```

Wait for `Application startup complete` (about 10 seconds while the model
loads), then open <http://localhost:8080> in Chrome, Edge or Firefox. Press
Ctrl+C to stop it.

The microphone and GPS work on `localhost` without HTTPS. On any other address
they need HTTPS.

**Faster start for UI work.** Set `LID_IDENTIFIER=stub` before starting, and
the server skips loading the model and returns fixed answers instantly. In
PowerShell:

```powershell
$env:LID_IDENTIFIER = "stub"
```

**The page without the server** (for example, for the designer). Serve just
the page files and add `?backend=mock`. The page then uses a saved real
response instead of calling the model:

```bash
npm run serve-page
```

Then open <http://localhost:8081/?backend=mock>. VS Code's Live Server works
too. Don't open `index.html` directly; browsers block its JavaScript modules
from `file://`.

**Seeing old behaviour after a code change?** The browser may be running a
cached copy of the JavaScript. The model server tells browsers to always
check for newer files, but `npm run serve-page` doesn't. Press **Ctrl+F5** to
reload with fresh files, or keep DevTools open with **Disable cache** ticked
(Network tab).

### First-time setup on a new machine

You need Python 3.11+ and, for the page tests, Node 20+.

```bash
cd server
python -m venv .venv
```

```bash
.venv\Scripts\python -m pip install -r requirements-dev.txt
```

This installs PyTorch, a large download. The first server start also downloads
Meta's model, a few GB.

## Tests

Page (36 tests: converting model output including real saved responses,
filters, GPS-to-country, WAV encoding):

```bash
npm test
```

Server (`/predict`, audio decoding, serving the page, LAMP wiring):

```bash
cd server
.venv\Scripts\python -m pytest
```

## Files

| File | Job |
| --- | --- |
| `index.html` | All the markup: record button, loading spinner, results, consent popup, and `<template>`s for a results row and a variety row |
| `css/styles.css` | Design. Almost empty; it belongs to the designer. See "Styling hooks" |
| `js/main.js` | Wires everything together and runs the flow |
| `js/recorder.js` | Microphone recording (`MediaRecorder`) |
| `js/wav.js` | Converts the recording to the 16 kHz WAV the model server reads |
| `js/backend.js` | **Every server call**: identify, save consent, keep recording. Mock and real versions |
| `js/config.js` | Settings: real or mock server, URLs, page size, recording limit |
| `js/results.js` | **Converts raw model output into rows**, and filters them. No DOM, fully tested |
| `js/location.js` | Browser GPS to country code |
| `data/languages.json` | All 6,816 GRN languages: name, ISO code, macrolanguage code, parent, whether a sample exists, countries |
| `data/countries.geojson` | Country borders (Natural Earth, public domain) for GPS to country, offline |
| `data/samples/` | Saved model responses: real ones from Meta's model, plus a made-up LAMP-format one (see below) |
| `tools/build_data.py` | Rebuilds the two data files from the 5fish database |
| `tools/mark_samples.py` | Marks languages with no sample, and "headings", in `data/languages.json` from GRN's data export. Run it after `build_data.py` |
| `tools/database_5fish.db` | The 5fish apps' offline database (not in git), read by `build_data.py` |
| `server/app/main.py` | The server: `POST /predict` runs the model; also serves the page (`/`, `css/`, `js/`, `data/` only) |
| `server/app/identifiers.py` | The models: Meta's MMS (default), LAMP (over HTTP), and a stub |
| `server/app/audio.py` | Reads the uploaded WAV |
| `server/app/config.py` | Server settings, from environment variables (see below) |
| `server/app/samples.py` | Downloads a language's sample MP3 from GRN once and keeps it (see "Playing language samples") |
| `scripts/fetch_samples.py` | Downloads sample MP3s ahead of time, from the command line (see "Playing language samples") |
| `data/sample-audio/` | Downloaded sample MP3s (not in git) |
| `server/tools/fake_lamp.py` | A stand-in for LAMP's server, for testing LAMP mode without its weights |

## The flow

```
idle ──tap──▶ recording ──tap, or 20 s limit──▶ consent popup ──answer──▶ waiting ──▶ results
                                  │                                     (spinner, only if
                                  └── recording sent to the model now    results aren't back)
```

- **The recording goes to the model as soon as recording stops.** The model
  works while the person answers the consent question, so the spinner often
  never appears.
- **The consent answer is always saved** (`backend.saveConsent`). The
  recording is only kept (`backend.saveRecording`) after a "yes". Identifying
  the language happens either way.
- **An answer is required:** Escape doesn't close the popup.
- **Recordings under 2 seconds aren't sent** (`minRecordingSeconds` in
  `js/config.js`). The person sees a message asking them to speak longer.
  Under about 0.3 seconds, the browser can't even read the recording back,
  which caused "Unable to decode audio data" before this check existed.

## Model output and how it's converted

**Sending.** When recording stops, `js/backend.js` converts the recording to
16 kHz mono WAV (`js/wav.js`) and posts it to `/predict` on the server that
served the page, in a form field named `file`. The server needs no ffmpeg because
the browser does the conversion.

**Raw model output.** `POST /predict` returns every one of the model's 4,017
guesses, best first, with probabilities that add up to 1. Real examples are
in `data/samples/`:

```json
{ "model": "mms:facebook/mms-lid-4017", "label_kind": "iso639_3", "duration": 11.0,
  "predictions": [ { "label": "eng", "probability": 0.505 }, { "label": "sco", "probability": 0.059 }, ... ] }
```

- **Labels are ISO 639-3 codes** (`label_kind: "iso639_3"`), not GRN
  languages. One code can mean several GRN languages: `eng` covers 18 English
  varieties.
- **Some labels are umbrella "macrolanguage" codes** (`ara`, `que`, `zho`).
  These map to their member languages.
- **The full list matters.** A low-resource language can rank far down the
  list overall but near the top for its country (see Filters).

**Converted guess** (`toCandidates` in `js/results.js`), one per prediction:

```js
{ rank: 1, label: "eng", name: "English", confidence: 0.505, percent: 50.46, known: true,
  languages: [
    { id: 5185, name: "English", iso: "eng",
      contentUrl: "https://5fish.mobi/5185", countries: [...], parentCountries: [...] },
    { id: 25, name: "English: USA", ... },
    ...
  ] }
```

- **Each guess lists the GRN languages it could mean,** from
  `data/languages.json`, shortest name first. On the page, a guess with one
  language is a single row with its "Play sample" button; one with several
  gets a "varieties" list.
- **"Headings" aren't listed.** A heading is a language with no recording of
  its own whose varieties have recordings: "English" (#5185) has none, but
  "English: USA" does. `tools/mark_samples.py` marks the 336 headings
  (`"heading": true`). A guess is still named after its heading, and its
  varieties are still local where the heading is listed, but the heading
  isn't one of its languages. So a heading with one variety (Kilega, with
  Kisonga) becomes a single row.
- **The guess is named after the language its varieties belong to**
  ("Sindhi", not its variety "Charan").
- **`known: false`** means no GRN language matches the label. 151 of the
  model's 4,017 codes don't match. Those guesses are never shown.
- **The same code reads LAMP's GRN-ID output** (`label_kind:
  "grn_language_id"`, or LAMP `serve.py`'s own format), where each guess is
  exactly one language. `data/samples/lamp-illustrative.json` shows that
  format; its scores are made up.

**What real scores look like.** On a clear English clip, English came first
at about 50%. On a Coast Tsimshian recording, a low-resource language, nothing
scored above 1.4%, and Tsimshian itself ranked about 45th to 170th. With
"Near me" in Canada, Tsimshian moved up to about 9th. Expect the second
pattern for many of the languages GRN serves.

## Filters

| Control | What it does |
| --- | --- |
| **All results / Near me** | "All" is the model's raw ranking. "Near me" asks for GPS permission (the first time only), finds the country, and keeps only languages the 5fish data lists there. A variety counts if its parent language is listed. Within each guess, varieties listed for the country itself come first. |
| **Minimum confidence** | A slider whose range adapts to each recording. Far left shows everything; far right shows only the top guess. In between it's logarithmic, covering the three powers of ten below the top score, so it's as useful when the top guess is 50% (clear English) as when it's 0.7% (Tsimshian). The value after it shows the current minimum. While dragging, only that value and the "Showing X of Y" count change; the list updates when the slider is let go, so the page doesn't jump around. It resets to "Any" for each new recording |
| **Show more** | Shows 10 more rows. The first page is 10 (`pageSize` in `js/config.js`) |

The list's numbering is the browser's own (1, 2, 3…). The model's rank is
kept on each row as `data-rank`; it can skip numbers, because guesses the
catalog doesn't have are dropped.

## Styling hooks

For the designer. The page works unstyled, and nothing in the JS depends on
CSS.

| Hook | Meaning |
| --- | --- |
| `body[data-phase]` | `idle`, `recording`, `consent`, `waiting`, `results` or `error` |
| `#record-button[data-recording="true"]` | Recording in progress (the text also changes: Start/Stop recording) |
| `#record-timer`, `#record-seconds` | Seconds recorded, shown only while recording |
| `#loading .spinner` | The loading spinner (a placeholder spin rule is in `styles.css`) |
| `#consent-dialog` | A native `<dialog>`; style its backdrop with `#consent-dialog::backdrop` |
| `#results-list > li.result` | One guess: `.result-name`, `.result-iso` (the model's code), `.result-confidence`, `.result-local` ("Near you" badge). `data-count` is how many languages it covers; `data-label` is the model's code; `data-rank` is the model's rank |
| `li.result[data-count="1"] .result-play` | A guess that means one language gets a "Play sample" button (see "Playing language samples") |
| `.result-play[data-playing="true"]`, `.language-play[data-playing="true"]` | That button's sample is playing (the text also changes: Play/Stop sample) |
| `.result-play[data-sample="missing"]`, `.language-play[data-sample="missing"]` | No sample to play: the button is disabled and says "No sample" or "Sample unavailable" |
| `.result-varieties` | A guess covering several languages gets a native `<details>` instead: `<summary>` with `.result-variety-count`, then `ul.result-languages` |
| `li.language` | One variety in that list: `.language-name`, `.language-local`, `.language-play` |
| `#min-confidence`, `#min-confidence-value` | The confidence slider (`<input type="range">`) and the `<output>` showing its value |
| `#results-summary`, `#location-status`, `#results-empty` | Status text |
| `#test-playback` | **Testing only:** a player for the last recording, with `#test-playback-info` (length, size, format). Shown after recording when `showTestPlayback` is on in `js/config.js`; turn it off before real use |

Views are hidden with the HTML `hidden` attribute. If the CSS gives a view
`display: flex` or similar, add `[hidden] { display: none !important; }` so
hiding still works.

## Still to decide

- **Where the server runs** for real use: a field laptop or a cloud server.
  It needs about 8 GB of RAM; a GPU makes it faster but isn't required (about
  3 seconds per clip on this laptop's CPU). Phones reaching it over a network
  need HTTPS for the microphone.
- **An "unsure" state.** When the top guess is very low (under a few
  percent), the model doesn't really know; the page could say so and lean on
  location and the helper.
- **Storage for consent answers and kept recordings.** For example, SQLite on
  the model server: set `consentUrl` and `recordingUrl` in `js/config.js`.
  Each consent answer is
  `{ sessionId, consent, answeredAt, recordingType, recordingBytes, recordingSeconds }`,
  and a kept recording is posted with the same data as `meta`.
- **How to ask for consent without relying on reading.** The popup text is a
  placeholder.
- **Choosing a language without hearing its sample (future idea).** When a
  sample can't play (GRN has none, a 404, or GRN can't be reached, a 502),
  gray out the "Play sample" button and offer a "This is my language" button
  next to it. The person can then pick the language by its name alone.
- **GPS at the site.** Border towns can land in the wrong country (the
  borders are simplified). A migrant's location may not say much about their
  language. The browser's permission prompt is text.

## Server settings

Set these as environment variables before starting the server (in PowerShell,
`$env:NAME = "value"`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `LID_IDENTIFIER` | `mms` | `mms` (Meta's model), `stub` (fixed answers, no model), or `lamp` (see below) |
| `LID_MAX_AUDIO_SECONDS` | `20` | Longer recordings are trimmed |
| `LID_CORS_ORIGINS` | none | Comma-separated addresses of other websites allowed to call `/predict`. Not needed for the page this server serves |
| `LID_LAMP_URL` | `http://127.0.0.1:8001` | Where LAMP's server listens, in `lamp` mode |
| `LID_SAMPLES_DIR` | `data/sample-audio` | Where downloaded sample MP3s are kept |

### Switching to LAMP

The team chose Meta's model for now. To try GRN's LAMP model later, run LAMP's
own server (`lid_finetune/scripts/model/serve.py` in the LAMP repo) on port
8001, or the stand-in `server/tools/fake_lamp.py`. Then start this server with
`LID_IDENTIFIER=lamp`. The page needs no changes: `js/results.js` already
reads LAMP's GRN-ID output.

## Playing language samples

Each "Play sample" button plays GRN's sample recording of that language, so
the person can listen and pick the language they speak. Samples come from
`https://media.globalrecordings.net/GOKit_MP3/sample-{id}.mp3`, where `{id}`
is the GRN language ID (the `id` in `data/languages.json`, not an ISO code).

### On the page

- **The buttons.** `.result-play` is on a guess that means one language;
  `.language-play` is on each variety in a guess's list. A button finds its
  language from the nearest list item: `button.closest('[data-id]')`.
- **One sample at a time.** Tapping another button stops the one playing.
  Tapping the playing button again stops it. Playback also stops when the
  list is rebuilt (filters, "Show more") or on "Record again".
- **No sample.** Languages marked `"noSample": true` get a disabled "No
  sample" button. That flag comes from GRN's data export, set by
  `tools/mark_samples.py` (682 languages); the 5fish database says every
  language has a sample, which isn't so. A sample that fails to load gets a disabled
  "Sample unavailable" button. Both are marked `data-sample="missing"`.
- **Where samples come from** is `sampleUrl` in `js/config.js`:
  `/samples/{id}.mp3` on the server. For the page without the server
  (`?backend=mock`), set it to the GRN address above instead.

### On the server

`GET /samples/{id}.mp3` (`server/app/samples.py`) serves the sample from
`data/sample-audio/sample-{id}.mp3`. If it isn't there yet, the server
downloads it from GRN first and keeps it, so each sample is downloaded only
once.

| Response | When |
| --- | --- |
| 200 with the MP3 | The sample was already kept, or downloaded now |
| 404 | GRN has no sample for that language |
| 502 | GRN couldn't be reached, so nothing was downloaded |

### Downloading samples ahead of time: `scripts/fetch_samples.py`

Without internet (on a field laptop, for example), the server can only play
samples it already has. This script downloads them ahead of time into the
same folder. Files already there are skipped, so running it again is cheap.

```bash
python scripts/fetch_samples.py 1 51 92      # specific GRN language IDs
python scripts/fetch_samples.py --random 10  # random languages that have a sample
```

It needs only Python 3.10+, with no packages. It prints each language's name
and file, and warns about IDs that aren't in `data/languages.json` or have no
sample (it still tries to download those). It exits with status 1 if any
download fails, so other scripts can tell.

It can also be used from Python:

```python
from fetch_samples import fetch_samples
paths = fetch_samples(["1", "51", "92"])  # {id: Path, or None if the download failed}
```
