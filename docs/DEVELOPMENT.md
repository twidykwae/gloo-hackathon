# Language ID: developer guide

How the page and server work, for the team. To install and run the project,
see the [README](../README.md).

Record someone speaking, ask for consent to keep the recording, send it to the
language-ID model, then let the person listen to samples of the best matches,
choose their language, and get links for it. It's all on one page and one
URL.

Plain HTML, JavaScript and CSS for the page, with no build step. A small
Python server in `server/` runs the language-ID model and serves the page.

**Status:** the whole flow works with **real results from Meta's
language-ID model** (`facebook/mms-lid-4017`). Storing consent answers, kept
recordings and choices isn't built yet (see "Still to decide").

## Run it

One command starts everything: the model and the page, on one address.

```bash
cd C:\dev\language-id-web\server
.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8080
```

Wait for `Application startup complete` (about 10 seconds while the model
loads), then open <http://localhost:8080> in Chrome, Edge or Firefox. Press
Ctrl+C to stop it.

The Resources screen's Bible links use the team's YouVersion app key, set in
`server/app/config.py`. See "Bibles from YouVersion".

The microphone and GPS work on `localhost` without HTTPS. On any other address
they need HTTPS.

**Faster start for UI work.** Set `LID_IDENTIFIER=stub` before starting, and
the server skips loading the model and returns fixed answers instantly. In
PowerShell:

```powershell
$env:LID_IDENTIFIER = "stub"
```

**The page without the server** (for example, for styling work). Serve just
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

Page (79 tests: converting model output including real saved responses,
names, samples and dialects, links, QR codes, language and country search,
GPS-to-country, WAV encoding, the Bible and Gloo AI helpers):

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
| `index.html` | All the markup: the Record, Detect, Rankings, Sample, Resources and error screens, the consent banner, and `<template>`s for the repeated parts |
| `css/styles.css` | The look, from the team's Claude Design prototype: colors, fonts and sizes as tokens at the top, then one section per screen. See "Styling hooks" |
| `js/main.js` | Wires everything together and runs the flow |
| `js/recorder.js` | Microphone recording (`MediaRecorder`), and the microphone level for the bars |
| `js/wav.js` | Converts the recording to the 16 kHz WAV the model server reads |
| `js/backend.js` | **Every server call**: identify, save consent, keep recording, save choice. Mock and real versions |
| `js/config.js` | Settings: real or mock server, URLs, the Resources screen's links, page size, recording limit |
| `js/results.js` | **Converts raw model output into guesses**, plus small helpers for showing them. No DOM, fully tested |
| `js/location.js` | Browser GPS to country code |
| `js/qr.js` | QR codes for the Resources screen's links, as SVG |
| `js/search.js` | Finding a language or country by what was typed, for the new-dialect form. No DOM, fully tested |
| `js/suggest.js` | The suggestion list under a text box (an accessible combobox) |
| `js/bible.js` | Turns the server's `/bible/{id}` answer into a Resources screen link. No DOM, fully tested |
| `js/vendor/qrcode.mjs` | The QR encoder, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 (MIT), copied in so it works offline |
| `data/languages.json` | All 6,816 GRN languages: name, native name (173 of them), ISO code, macrolanguage code, parent, whether a sample exists, countries |
| `images/` | The Resources screen's logos: the 5fish and YouVersion app icons, 128 px |
| `data/countries.geojson` | Country borders (Natural Earth, public domain) for GPS to country, offline |
| `data/samples/` | Saved model responses: real ones from Meta's model, plus a made-up LAMP-format one (see below) |
| `tools/build_data.py` | Rebuilds `data/languages.json` from the 5fish database, keeping the sample flags `mark_samples.py` wrote. Downloads the country borders only if the file is missing, or with `--borders` |
| `tools/mark_samples.py` | Marks languages with no sample, and "headings", in `data/languages.json` from GRN's data export. Run it after `build_data.py` |
| `tools/add_names.py` | Adds each language's names in other languages (`names`) to `data/languages.json` from GRN's languageNames export. Run it after `build_data.py` |
| `tools/database_5fish.db` | The 5fish apps' offline database (not in git), read by `build_data.py` |
| `server/app/main.py` | The server: `POST /predict` runs the model; also serves the page (`/`, `css/`, `js/`, `data/` only) |
| `server/app/identifiers.py` | The models: Meta's MMS (default), LAMP (over HTTP), and a stub |
| `server/app/audio.py` | Reads the uploaded WAV |
| `server/app/store.py` | Stores predictions, consent answers, kept recordings, choices and new dialects in SQLite (see [Stored sessions](#stored-sessions)) |
| `server/app/config.py` | Server settings, from environment variables (see below) |
| `server/app/bibles.py` | Finds a GRN language's Bible on YouVersion (see "Bibles from YouVersion") |
| `server/app/samples.py` | Downloads a language's sample MP3 from GRN once and keeps it (see "Playing language samples") |
| `scripts/fetch_samples.py` | Downloads sample MP3s ahead of time, from the command line (see "Playing language samples") |
| `data/sample-audio/` | Downloaded sample MP3s (not in git) |
| `server/tools/fake_lamp.py` | A stand-in for LAMP's server, for testing LAMP mode without its weights |

## The flow

The screens follow the team's Claude Design prototype.

```
Record ──▶ recording ──tap, or 20 s──▶ Detect ─────────────────▶ Sample (best match) ──"This is my language"──▶ Resources
                                            │ Cancel                 ▲   │ Show all rankings
                                            ▼                        │   ▼
                                          Record                     └─ Rankings
                                                                    (tap a guess)
```

- **Record.** The big button starts and stops recording. While recording, a
  ring around it fills over the time limit (`maxRecordingSeconds` in
  `js/config.js`, 20 seconds), bars show the microphone level, and a timer
  counts up.
- **Recordings under 2 seconds aren't sent** (`minRecordingSeconds`).
  Tapping Stop earlier asks the person to keep talking instead. Under about
  0.3 seconds, the browser can't even read a recording back, which caused
  "Unable to decode audio data" before this check existed.
- **Detect.** The recording goes to the model as soon as recording stops. The
  screen shows the real progress: *Preparing your recording* (converting it to
  WAV), *Identifying the language* (the model), *Finding it in our catalog*
  (matching to GRN languages). **Cancel** stops the request and goes back to
  Record. The model's guesses are stored as soon as they're back, for every
  recording (`backend.savePrediction`; see [Stored sessions](#stored-sessions)).
- **Consent.** A banner at the top of the app, "May we keep your
  recording?", from when recording stops until it's answered. It doesn't
  block anything: results come as soon as the model is done, and the banner
  stays in view (pinned to the top as the page scrolls, never covering a
  button) on every screen until "Yes, keep it" or "No thanks". The answer is
  saved when given (`backend.saveConsent`), and the recording is kept
  (`backend.saveRecording`) only after a "Yes", which can come late, even
  after choosing a language: it has the same `sessionId` as the choice. No
  answer means the recording isn't kept. Identifying the language happens
  either way. A new recording asks again.
- **Sample.** Results open on the best match, one guess at a time: its name,
  match ring and sample. A guess with one language has a big player (bars
  fill in as it plays) and a "This is my language" button. A guess with
  several lists its dialects, each with its own sample and a choose button.
  Under it, "No match? Tap next", a square Previous button, and a Next
  button that previews the next guess: its match ring and "Next – {name}".
  On the last guess there's no Next. Dots show the first five
  (`compareCount`). Samples turn grey once heard. "Show all rankings" and the
  back button go to Rankings.
- **Check-in.** Every 4th tap on Next (`checkInEvery` in `js/config.js`; 0
  turns it off) shows "It looks like you are having trouble finding your
  language." instead of the next guess, with three choices: "Keep going"
  (on to that guess; the count starts again), "Try again" (back to Record)
  and "This is a new dialect" (the new-dialect form, whose back button then
  returns to the guess they were on). Only Next counts: not Previous, not
  opening a guess from Rankings. The count starts again with each recording.
- **Rankings.** Every guess as a card (see "The rankings screen"). Tapping a
  card opens it on the Sample screen. At the bottom, "No match, record
  again" and "None, enter new dialect".
- **New dialect.** "Tell us about your dialect": parent language, dialect
  name and country, all three needed. The parent language box suggests the
  model's top guesses before anything is typed, then searches the whole GRN
  catalog by English or native name. The country box suggests from every
  country the browser knows, filled in from "Near me" if it found one. Both
  still take anything typed. Submitting always saves a report
  (`backend.saveNewDialect`, see "Still to decide"). Then it opens Resources
  for the parent language ("Thank you! The closest we have"), or, if the
  parent isn't in the catalog either, a thank-you screen. Unless they've
  said "Yes, keep it", a note on the form says so: after "No thanks", only
  what's typed is saved, so the report is a lead for the team; with no answer
  yet, it points to the banner to include the recording.
- **Choosing** a language or dialect saves the choice (`backend.saveChoice`,
  see "Still to decide") and opens Resources.
- **Resources.** Links for the chosen language, from `resources` in
  `js/config.js`, each a QR code so it can be opened on the person's own
  phone and a "Go to …" button, with the site's logo above it, to open it
  here. For now that's the language's 5fish page, plus its YouVersion Bible
  when there is one. "Start over" goes back to Record.
- **Errors** (no microphone permission, server down) get their own screen with
  "Try again".

Body has `data-phase`: `idle`, `recording`, `waiting`, `sample`,
`checkin`, `results`, `resources`, `dialect`, `thanks` or `error`.

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
  list overall; "Near me" marks it when it's spoken in the person's country.

**Converted guess** (`toCandidates` in `js/results.js`), one per prediction:

```js
{ rank: 1, label: "eng", name: "English", native: null, sampleId: 25,
  confidence: 0.505, percent: 50.46, known: true,
  languages: [
    { id: 25, name: "English: USA", native: null, iso: "eng", hasSample: true,
      countries: [...], parentCountries: [...] },
    ...
  ] }
```

- **`native`** is the name in the language itself ("Русский", "አማርኛ"), or
  `null`. The 5fish database has one for only 173 languages, mostly larger
  ones. `tools/build_data.py` picks it from the database's alternate names: a
  name tagged as written in the language itself, else an untagged name in a
  non-Latin script. The second rule is a good guess, not a guarantee, and a
  few are odd ("简体中文", "Simplified Chinese", for Mandarin).
- **`names`** is the name in other languages, by tag (`{ "es": "Tzotzil de
  Chamula" }`), from GRN's languageNames export (`tools/add_names.py`):
  2,537 of 6,816 languages have some, Spanish 599, French 533.
- **Which name is shown.** Everywhere, a language's name is shown in the
  device's language (`navigator.language`: `es-MX`, then `es`) when GRN has
  it, else in English, with the language's own name (`native`) below when
  known. The end screen is the exception: it tries the chosen language first,
  so its title is the `native` name when known, and every word on it
  ("Your choice:", the buttons, "Start over…") comes in the guide note's
  language (see "Gloo AI"), which is the chosen language or else the device's.
- **`sampleId`** is the GRN ID whose sample plays for the guess as a whole:
  the language it's named after, or, when that has no sample (a heading such
  as English), its first listed language that has one. `null` if none has.
- **Each guess lists the GRN languages it could mean,** from
  `data/languages.json`, shortest name first. On the page, each guess is a
  card with a play button; one with several languages also gets a "dialects"
  list under it.
- **"Headings" aren't listed.** A heading is a language with no recording of
  its own whose varieties have recordings: "English" (#5185) has none, but
  "English: USA" does. `tools/mark_samples.py` marks the 336 headings
  (`"heading": true`). A guess is still named after its heading, and its
  varieties are still local where the heading is listed, but the heading
  isn't one of its languages. So a heading with one variety (Kilega, with
  Kisonga) becomes a guess with one language.
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
scored above 1.4%, and Tsimshian itself ranked about 45th to 170th. Expect
the second pattern for many of the languages GRN serves. (GRN's own Amharic
sample, played in as the microphone, came out as Amharic at over 99%, but
studio recordings are the easy case.)

## The rankings screen

| Part | What it does |
| --- | --- |
| **Cards** | One per guess, in the model's order, numbered 01, 02, … by their place in the list. The model's rank is kept as `data-rank`; it can skip numbers, because guesses the catalog doesn't have are dropped |
| **Names** | The name in the device's language when GRN has it, else in English, with the language's own name under it when known (see "Which name is shown") |
| **Match ring** | The model's confidence for the guess. Its color deepens with how close the guess is to the best one, so the top guess is always the strongest blue |
| **Dialects** | Only counted: "9 dialects" under the name of a guess covering several GRN languages. The rankings show the languages, not their dialects; those are listed, with samples, on the Sample screen. No play button either, since a guess with several dialects has no sample of its own |
| **Near me** | Asks for the location the first time, then marks guesses spoken in that country "Near you". It doesn't hide or reorder guesses. A variety counts if its parent language is listed. Tap again to turn it off |
| **Show more** | Shows 10 more cards. The first page is 10 (`pageSize` in `js/config.js`) |
| **Tapping a card** | Anywhere on it: opens that guess on the Sample screen |
| **No match, speak again** | Back to Record |
| **None, enter new dialect** | The new-dialect form (see "The flow") |

## Styling hooks

All styles are in `css/styles.css`, none in the markup. The JS only sets
attributes and a few custom properties, listed here.

| Hook | Meaning |
| --- | --- |
| `body[data-phase]` | `idle`, `recording`, `waiting`, `sample`, `checkin`, `results`, `resources`, `dialect`, `thanks` or `error` |
| `.checkin-actions .choice-button` | The check-in's three choices: a `.choice-icon` (`.arrow-icon`, `.dot-icon` or `.plus-icon`), `.choice-title` and `.choice-detail`. `.choice-main` is "Keep going", filled in |
| `.results-end .outline-button` | The two buttons at the bottom of Rankings, each with an `.outline-icon` (`.dot-icon` or `.plus-icon`) |
| `#dialect-form` | The new-dialect form: `.field`s with a `label` and an `input`. `#dialect-note` shows after a "No" to keeping the recording |
| `.suggest > ul.suggestions` | A suggestion list under a box: `li.suggestion` with `.suggestion-label` and an optional `.suggestion-detail`; `[aria-selected="true"]` is the one picked with the arrow keys |
| `#resources-eyebrow` | "Your choice:", centered in the toolbar row with the back button, or "Thank you! The closest we have" after a new dialect |
| `#record-button[data-recording="true"]` | Recording in progress; shows `.stop-icon` instead of `.mic-icon` |
| `.mic-ring-fill` | The ring that fills while recording, over `--max-recording` (set on `:root` from `maxRecordingSeconds`) |
| `#record-level > span` | One bar each; `--level` is 0 to 1 |
| `#detect-steps > li[data-state]` | `pending`, `active` or `done` |
| `#near-me[aria-pressed="true"]` | "Near me" is on |
| `#results-list > li.card` | One guess: `.card-open` (a button around `.card-name` and `.card-subname` that opens it on the Sample screen), `.card-name` (in the device's language), `.card-subname` (the language's own name, only when known and different), `.card-count` ("9 dialects", only with several; plain text, not a dropdown), `.card-local` ("Near you"), `.match`. `data-label` is the model's code, `data-rank` its rank, `data-count` how many languages it covers. `--i` is its place on the page, for staggering the fade-in |
| `.match` | The match ring: `--pct` (0 to 100) fills it, `--strength` (0 to 1) colors it |
| `#sample-dots > li` | `data-current="true"` for the guess on screen, `data-seen="true"` for ones already opened |
| `#sample-single`, `#sample-dialects-block` | The Sample screen's two layouts: one language (big `#sample-play` and `#sample-wave`), or several (`li.sample-dialect` rows with `.choose-button`) |
| `#sample-prev`, `#sample-next` | Previous (arrow only) and Next. Next holds `#sample-next-match` (a small `.match` ring) and `.nav-next-label`; it and `#sample-next-hint` are hidden on the last guess |
| `#sample-wave > span` | Progress bars: `--height` is the bar's height; `.played` once playback has passed it |
| `.sample-play[data-played="true"]` | That sample was already heard |
| `#resources-list > li.resource` | One link: `.qr` (an inline SVG drawn in `currentColor`) in a white box, and beside it `.resource-action`: `.resource-logo` above `.resource-button` |
| `.play-button[data-playing="true"]` | Its sample is playing; the CSS draws a square stop icon instead of the play triangle. `--icon` on a button sets the icon size |
| `.play-button[data-sample="missing"]` | No sample to play: disabled, labelled "No sample" or "Sample unavailable" |
| `#consent-banner` | The consent banner: `.consent-title`, `.consent-body` and `.consent-actions`. `position: sticky` at the top of `#app` |

Views are hidden with the HTML `hidden` attribute; `[hidden]` is forced to
`display: none` so it wins over `display: flex` rules.

## Still to decide

- **Where the server runs** for real use: a field laptop or a cloud server.
  It needs about 8 GB of RAM; a GPU makes it faster but isn't required (about
  3 seconds per clip on this laptop's CPU). Phones reaching it over a network
  need HTTPS for the microphone.
- **An "unsure" state.** When the top guess is very low (under a few
  percent), the model doesn't really know; the page could say so and lean on
  location and the helper.
- **Who can post to `/sessions/…`.** Anyone who can reach the server can, with
  no sign-in, so the stored data can include junk. Limits keep each post small
  (see [Stored sessions](#stored-sessions)), but nothing stops a flood of them.
- **Who can read the stored recordings, and for how long they're kept.**
- **Reviewing new dialects.** They're typed freely ("Mineiro", "mineiro",
  "Minas"), so someone should check them before they're used for training.
- **More resources.** The Resources screen only has the 5fish link so far.
  Add links to `resources` in `js/config.js`.
- **How to ask for consent without relying on reading.** The banner's text
  is a placeholder.
- **Unanswered consent.** No answer counts as no, so recordings from people
  who ignore the banner aren't kept. If too few people answer, the banner
  could come back once more at the end, for example on Resources.
- **Fonts without internet.** The fonts (Geist, Geist Mono, Instrument
  Serif) load from Google Fonts. Offline, the page falls back to system
  fonts and still works. For a field laptop, copy the font files into the
  project. Instrument Serif has only Latin letters, so native names in other
  scripts (Русский, አማርኛ) always use a fallback serif.
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
| `LID_STORAGE_DIR` | `server/storage` | Where `sessions.db` and kept recordings go (see below). Not under `data/`, which is public |
| `YVP_APP_KEY` | the team's key | YouVersion Platform app key, for `GET /bible/{id}`. Empty turns the Bible links off |

### Switching to LAMP

The team chose Meta's model for now. To try GRN's LAMP model later, run LAMP's
own server (`lid_finetune/scripts/model/serve.py` in the LAMP repo) on port
8001, or the stand-in `server/tools/fake_lamp.py`. Then start this server with
`LID_IDENTIFIER=lamp`. The page needs no changes: `js/results.js` already
reads LAMP's GRN-ID output.

## Stored sessions

The server keeps what happens to each recording in SQLite:
`server/storage/sessions.db`, one row per recording in the `sessions` table,
keyed by the page's `sessionId`. It and `server/storage/recordings/` are
created on first use, and git ignores them. The page sends each part as it
happens, without waiting for the others, so the server fills in the row in
whatever order they arrive (`server/app/store.py`). The one exception is the
audio: the page sends it only after the server has stored a "Yes", and the
server refuses it otherwise.

| When | Page sends | Endpoint | Fills in |
| --- | --- | --- | --- |
| The model's guesses are back | `savePrediction` | `POST /sessions/prediction` | `model`, `model_guesses` (top 10, JSON), `top_label`, `top_name`, `top_confidence`, recording type, size and length |
| "Yes, keep it" or "No thanks" | `saveConsent` | `POST /sessions/consent` | `consent` (1 or 0), `consent_at`. A "No" deletes any audio |
| After the "Yes" is stored | `saveRecording` | `POST /sessions/recording` | `audio_file`: the audio as the browser made it, in `recordings/`. Refused (409) unless the row has `consent = 1`, so with no answer there's never any audio |
| Reaching Resources from a choice | `saveChoice` | `POST /sessions/choice` | `chosen_language_id`, `_name`, `_iso`, and the guess it came from: `chosen_model_label`, `_rank`, `_confidence`. Choosing again replaces it |
| Submitting a new dialect | `saveNewDialect` | `POST /sessions/dialect` | `dialect`: the report as sent (JSON) |

A row with `consent = 1`, an `audio_file` and a chosen language is a labelled
training example. Comparing `top_label` with `chosen_model_label` shows how
often the model's first guess was right. To look:

```sh
sqlite3 server/storage/sessions.db \
  "SELECT created_at, top_label, top_confidence, chosen_language_name, chosen_model_rank, consent, audio_file FROM sessions ORDER BY created_at DESC LIMIT 20"
```

The server checks what's posted: `sessionId` must be a UUID (it names the
audio file), text fields are at most 200 characters, guess lists at most 20,
and audio must be WebM, Ogg, MP4 or WAV and at most 5 MB. Set any URL in
`js/config.js` to `null` to stop sending that part.

## Playing language samples

Each "Play sample" button plays GRN's sample recording of that language, so
the person can listen and pick the language they speak. Samples come from
`https://media.globalrecordings.net/GOKit_MP3/sample-{id}.mp3`, where `{id}`
is the GRN language ID (the `id` in `data/languages.json`, not an ISO code).

### On the page

- **The buttons.** The rankings have none: they only list the languages,
  with "9 dialects" under one that has several, and a guess with several
  dialects (a heading such as English) has no sample of its own. On the
  Sample screen, `#sample-play` plays a one-language guess, and each
  `.sample-dialect` row has its own. All are `.play-button`. A button finds
  its language with `button.closest('[data-id]')`: a guess's button carries
  `data-id` itself, a dialect's is on its list item.
- **One sample at a time.** Tapping another button stops the one playing.
  Tapping the playing button again stops it. Playback also stops on changing
  screens or guesses, when the list is rebuilt ("Near me", "Show more"), and
  on "Speak again".
- **No sample.** Languages marked `"noSample": true` get a disabled play
  button labelled "No sample". That flag comes from GRN's data export, set by
  `tools/mark_samples.py` (682 languages); the 5fish database says every
  language has a sample, which isn't so. A sample that fails to load gets a disabled
  button labelled "Sample unavailable". Both are marked `data-sample="missing"`.
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

## Bibles from YouVersion

After "This is my language", the Resources screen adds the language's Bible
on YouVersion below the 5fish link, when YouVersion has one: a QR code and a
"Go to YouVersion" button to `bible.com/versions/<id>`. The page only links
there, and bible.com shows the version name and copyright itself.

bible.com links open the YouVersion app when it's installed, and the website
when it isn't: bible.com lists the app for every path in its
`/.well-known/apple-app-site-association` (iOS) and `assetlinks.json`
(Android). That covers both the button and the QR code. Links tapped inside
some in-app browsers (WhatsApp, Facebook) may still open the website.

**On the server**, `GET /bible/{id}` (`server/app/bibles.py`) maps the GRN
language to its ISO 639-3 code (dialects use their parent's), then to
YouVersion's language through the 3-letter ISO codes YouVersion lists as
aliases (Amharic is `am`, alias `amh`), and returns that language's Bible:

```json
{ "grn_id": 2641, "language": "Tzotzil: Chamula", "iso": "tzo", "youversion_language": "tzo",
  "bible": { "id": 837, "abbreviation": "tzoA", "localized_title": "Tzotzil de Huixtán",
             "copyright": "© 1995, Wycliffe Bible Translators, Inc. All rights reserved.",
             "url": "https://www.bible.com/versions/837", "can_show_text": true },
  "bible_count": 3 }
```

`"bible": null` means YouVersion has none. `can_show_text` says whether our app
key is licensed to show the Bible's text itself; the bible.com link works
either way. It's a 404 for an unknown GRN id, 502 if YouVersion can't be
reached (after one retry), and 503 when the key is empty. YouVersion's
language list and our licenses are cached for an hour, so newly agreed
licenses show up without a restart.

**Setup:** none. The team's app key (from platform.youversion.com) is the
default in `server/app/config.py`. To use another key, set `YVP_APP_KEY`.

**Coverage** (October 2026): 1,918 of the 6,816 GRN languages (28%) have a
Bible on YouVersion. With the Wycliffe, Biblica and SIL "Fast-track" licenses
agreed in the YouVersion portal, our key can show the text of all of them.
Most of the rest have no Bible translation anywhere yet; for them, GRN's
recordings on 5fish are the content.

## Gloo AI: the guide note and the chat

On the Resources screen, Gloo AI adds a short note above the links (what
5fish and the Bible are, and how to use them) and a "Have a question?" chat
below them. Both are hidden if Gloo isn't set up or fails.

- **Which language.** The server picks it, not the model: always the chosen
  language first (Tzotzil gets Tzotzil), tried twice. If neither note passes
  (it loops, runs long, or leaves out 5fish or YouVersion), the device's
  language setting (`navigator.language`, sent as `device_language`), tried
  once; English when the device doesn't say. Where the person is never picks
  the language. Models write badly in many minority languages (one looped on
  a Tzotzil phrase), and the checks only catch a note that's plainly broken,
  not one that's merely poor, so a speaker should look over the notes for
  small languages. `server/app/country_languages.json` now only supplies
  language names and short tags. Chat answers follow the language the person
  types in, else the chosen language.
- **Only real facts.** The server tells the model the language, the 5fish
  link and the YouVersion Bible; the page can't add to them. Answers that
  loop or run long are rejected, and markdown is stripped.
- **Labels too.** The note's label and the chat's title, hint and placeholder
  come back with the guide in the same language. They're translated once per
  language and kept in `server/gloo-labels.json` (not in git). The chat stays
  hidden until the guide arrives, so it doesn't flash in English first.
- **Endpoints:** `POST /assistant/guide {grn_id, country?}` and
  `POST /assistant/chat {grn_id, country?, messages}` (`server/app/assistant.py`).

**Cost.** Gloo's guarded API adds about 11,500 tokens of its own instructions
to every call, so each call costs about $0.0012 with the default model
(`gloo-google-gemini-2.5-flash-lite`, $0.10 / $0.40 per million tokens,
about 2 seconds). Guides are cached per language. Spending is counted from
Gloo's token usage in `server/gloo-usage.json` (not in git) and stops at
`GLOO_DAILY_BUDGET_USD` (default $1/day, about 800 calls).

**Setup.** The Gloo key spends money, so unlike the YouVersion key it is never
in git. Put it in `server/.env` and start the server with `--env-file .env`:

```powershell
"GLOO_API_KEY=sk_..." | Out-File -Encoding ascii -Append .env
.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8080 --env-file .env
```
