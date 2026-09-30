# Language ID (web)

Record someone speaking, ask for consent to keep the recording, send it to the
language-ID model, and show a ranked list of languages with play buttons. It's
all on one page and one URL.

Plain HTML, JavaScript and CSS. There's no build step and no dependencies; the
only tools are a static file server and, for tests, Node.

**Status:** the whole flow works against a **mock server** that returns sample
model output. The real model server and storage aren't decided yet. When they
are, only `js/config.js` and `js/backend.js` change.

## Run it

The page uses JavaScript modules and loads JSON files, so it has to be served
over HTTP; opening `index.html` directly won't work.

```bash
python -m http.server 8080
```

Then open <http://localhost:8080> in Chrome, Edge or Firefox. The microphone
and GPS work on `localhost` without HTTPS. On any other address they need
HTTPS.

Add `?backend=http` to the URL to use the real server settings in
`js/config.js` instead of the mock.

## Tests

```bash
node --test
```

These cover converting model output, the filters, and GPS-to-country
(22 tests, Node 20+).

## Files

| File | Job |
| --- | --- |
| `index.html` | All the markup: record button, loading spinner, results, consent popup, and a `<template>` for one results row |
| `css/styles.css` | Design. Almost empty; it belongs to the designer. See "Styling hooks" |
| `js/main.js` | Wires everything together and runs the flow |
| `js/recorder.js` | Microphone recording (`MediaRecorder`) |
| `js/backend.js` | **Every server call**: identify, save consent, keep recording. Mock and real versions |
| `js/config.js` | Settings: mock or real server, URLs, page size, recording limit |
| `js/results.js` | **Converts raw model output into rows**, and filters them. No DOM, fully tested |
| `js/location.js` | Browser GPS to country code |
| `js/player.js` | Plays one sample at a time |
| `data/languages.json` | All 6,816 GRN languages: name, ISO code, parent, whether a sample exists, countries |
| `data/countries.geojson` | Country borders (Natural Earth, public domain) for GPS to country, offline |
| `data/sample-model-response.json` | Sample model output (see below) |
| `tools/build_data.py` | Rebuilds the two data files from the 5fish database |

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

## Model output and how it's converted

**Raw model output.** This is LAMP's `serve.py` format; see
`data/sample-model-response.json`:

```json
{ "duration": 7.3,
  "predictions": [ { "id": 14, "probability": 0.412, "iso": "ctu", "url": "..." }, ... ] }
```

`id` is a GRN language ID, and the list is sorted best first. The sample uses
real GRN IDs from LAMP's label list, but **the probabilities are made up**:
LAMP's trained weights aren't available yet. Replace it with a real response
once the model runs.

**Converted row** (`toCandidates` in `js/results.js`), one per prediction:

```js
{ rank: 1, id: 14, name: "Chol: Tumbala", iso: "ctu",
  confidence: 0.412, percent: 41.2,
  sampleUrl: "https://media.globalrecordings.net/GOKit_MP3/sample-14.mp3",
  contentUrl: "https://5fish.mobi/14",
  countries: ["MX"], parentCountries: [...], known: true }
```

- **The name, countries and sample flag come from `data/languages.json`.**
  The model only returns IDs.
- **`known: false`** means the 5fish catalog doesn't have that ID, for example
  `0`, which LAMP uses for "no speech". Those rows are never shown; the summary
  line counts them.
- **Sample links follow a pattern** from the ID. About 1 in 7 is broken; the
  play button then becomes disabled and gets `data-unavailable`.

**If the team picks a different model server,** its output may be shaped
differently. For example, Meta's model returns ISO codes, not GRN IDs. Then
only `toCandidates` needs a new version.

## Filters

| Control | What it does |
| --- | --- |
| **All results / Near me** | "All" is the model's raw ranking. "Near me" asks for GPS permission (the first time only), finds the country, and keeps only languages the 5fish data lists there. A variety counts if its parent language is listed. |
| **Minimum confidence** | Hides guesses below 1%, 5% or 10% |
| **Show more** | Shows 10 more rows. The first page is 10 (`pageSize` in `js/config.js`) |

Rows keep the model's rank, so a filtered list can read 1, 3, 4, 7…

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
| `#results-list > li.result` | One row: `.result-rank`, `.result-name`, `.result-iso`, `.result-confidence`, `.result-local` ("Near you" badge), `.result-play` |
| `.result-play[data-playing="true"]` | That sample is playing (also `aria-pressed="true"`) |
| `.result-play[data-unavailable="true"]` | No sample, or the link is broken (the button is disabled) |
| `#results-summary`, `#location-status`, `#results-empty` | Status text |

Views are hidden with the HTML `hidden` attribute. If the CSS gives a view
`display: flex` or similar, add `[hidden] { display: none !important; }` so
hiding still works.

## Still to decide

- **Model server.** Where `identify` posts, and whether the audio needs
  converting first. The browser records WebM/Opus (MP4 on Safari). LAMP's
  `serve.py` needs ffmpeg installed to read those. It reads WAV without
  ffmpeg; converting to WAV in the browser is about 40 lines (there's an
  example in `language-id-ux/widget/src/wav.ts`).
- **Storage for consent answers and kept recordings.** For example, SQLite on
  the model server: set `consentUrl` and `recordingUrl` in `js/config.js`.
  Each consent answer is
  `{ sessionId, consent, answeredAt, recordingType, recordingBytes, recordingSeconds }`,
  and a kept recording is posted with the same data as `meta`.
- **How to ask for consent without relying on reading.** The popup text is a
  placeholder.
- **GPS at the site.** Border towns can land in the wrong country (the
  borders are simplified). A migrant's location may not say much about their
  language. The browser's permission prompt is text.
