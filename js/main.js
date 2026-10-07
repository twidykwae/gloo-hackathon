import { createBackend } from './backend.js'
import { config } from './config.js'
import { detectCountry } from './location.js'
import { assistantError, chatRequest, cleanQuestion, DEFAULT_LABELS, DEFAULT_QUESTIONS } from './assistant.js'
import { bibleResource } from './bible.js'
import { qrSvg } from './qr.js'
import { startRecording } from './recorder.js'
import { countryList, countrySearch, exactMatch, fold, languageSearch } from './search.js'
import { attachSuggestions } from './suggest.js'
import {
  describeCountries,
  firstPage,
  formatPercent,
  indexLanguages,
  isInCountry,
  languageTags,
  matchStrength,
  nameIn,
  nearFirst,
  resourceLinks,
  shortName,
  toCandidates,
  topConfidence,
} from './results.js'

// Language names are shown in the device's language, as far as GRN has them,
// else in English. Only the end screen tries the chosen language first.
const deviceTags = languageTags(navigator.language)
const shownName = (language) => nameIn(language, deviceTags)

/** Fills a name and the language's own name below it (when known and different). */
function showNames(nameEl, subnameEl, language, ownLang) {
  const shown = shownName(language)
  nameEl.textContent = shown
  const own = language.native && language.native !== shown ? language.native : ''
  subnameEl.textContent = own
  subnameEl.lang = own ? ownLang : ''
  return own
}

const $ = (id) => document.getElementById(id)
const el = {
  appBar: $('app-bar'),
  recordView: $('record-view'),
  recordButton: $('record-button'),
  recordTime: $('record-time'),
  recordHint: $('record-hint'),
  recordLevel: $('record-level'),
  detectView: $('detect-view'),
  detectSteps: $('detect-steps'),
  detectCancel: $('detect-cancel'),
  resultsView: $('results-view'),
  nearMe: $('near-me'),
  locationStatus: $('location-status'),
  list: $('results-list'),
  empty: $('results-empty'),
  showMore: $('show-more'),
  recordAgain: $('record-again'),
  newDialect: $('new-dialect'),
  sampleView: $('sample-view'),
  sampleDots: $('sample-dots'),
  sampleAll: $('sample-all'),
  samplePosition: $('sample-position'),
  sampleName: $('sample-name'),
  sampleSubname: $('sample-subname'),
  sampleMatch: $('sample-match'),
  sampleSingle: $('sample-single'),
  samplePlay: $('sample-play'),
  sampleWave: $('sample-wave'),
  sampleChoose: $('sample-choose'),
  sampleDialectsBlock: $('sample-dialects-block'),
  sampleDialectCount: $('sample-dialect-count'),
  sampleDialects: $('sample-dialects'),
  samplePrev: $('sample-prev'),
  sampleNext: $('sample-next'),
  sampleNextHint: $('sample-next-hint'),
  sampleNextMatch: $('sample-next-match'),
  sampleNextName: $('sample-next-name'),
  checkinView: $('checkin-view'),
  checkinHeading: $('checkin-heading'),
  checkinNext: $('checkin-next'),
  checkinNextName: $('checkin-next-name'),
  checkinRecord: $('checkin-record'),
  checkinDialect: $('checkin-dialect'),
  resourcesView: $('resources-view'),
  resourcesBack: $('resources-back'),
  resourcesEyebrow: $('resources-eyebrow'),
  guide: $('guide'),
  guideText: $('guide-text'),
  chatHeading: $('chat-heading'),
  chatLede: $('chat-lede'),
  chat: $('chat'),
  chatLog: $('chat-log'),
  chatSuggestions: $('chat-suggestions'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  chatSend: $('chat-send'),
  resourcesHeading: $('resources-heading'),
  resourcesSubname: $('resources-subname'),
  resourcesList: $('resources-list'),
  resourcesRestart: $('resources-restart'),
  resourcesPrompt: $('resources-prompt'),
  dialectView: $('dialect-view'),
  dialectHeading: $('dialect-heading'),
  dialectBack: $('dialect-back'),
  dialectNote: $('dialect-note'),
  dialectForm: $('dialect-form'),
  dialectParent: $('dialect-parent'),
  dialectParentList: $('dialect-parent-list'),
  dialectName: $('dialect-name'),
  dialectCountry: $('dialect-country'),
  dialectCountryList: $('dialect-country-list'),
  dialectSubmit: $('dialect-submit'),
  thanksView: $('thanks-view'),
  thanksHeading: $('thanks-heading'),
  thanksText: $('thanks-text'),
  thanksRestart: $('thanks-restart'),
  thanksBack: $('thanks-back'),
  errorView: $('error-view'),
  errorMessage: $('error-message'),
  errorRetry: $('error-retry'),
  consentBanner: $('consent-banner'),
  consentYes: $('consent-yes'),
  consentNo: $('consent-no'),
  cardTemplate: $('card-template'),
  sampleDialectTemplate: $('sample-dialect-template'),
  resourceTemplate: $('resource-template'),
}

const backend = createBackend(config)
// Name, ISO code, parent and countries for every GRN language (tools/build_data.py).
const languagesReady = fetch('data/languages.json')
  .then((r) => {
    if (!r.ok) throw new Error(`Could not load language data: ${r.status}`)
    return r.json()
  })
  .then(indexLanguages)

const state = {
  phase: 'idle',
  starting: false, // waiting for microphone permission
  recorder: null,
  startedAt: 0,
  // One recording and everything about it: { id, recording, recordingType, recordingBytes, seconds, consent, results, controller }
  session: null,
  candidates: [], // the guesses the catalog knows, in the model's order
  topConfidence: 0, // the best guess's score: a full-strength match ring
  shown: config.pageSize,
  nearMe: false, // the "Near me" chip is on
  location: null, // { code, name } once "Near me" has found it
  // Gloo AI on the Resources screen, for one language at a time.
  assistant: { languageId: null, log: [], busy: false },
  // Where Resources' back button goes: the Sample screen, or the new-dialect form.
  resourcesFrom: 'sample',
  resourcesEyebrow: 'choice', // the label above the title: 'choice', or 'closest' after a new dialect
  sampleIndex: 0, // the guess on the Sample screen, in state.candidates
  nextTaps: 0, // taps on the Sample screen's Next since the last check-in
  dialectFrom: 'rankings', // where the new-dialect form's back button goes: 'rankings' or 'sample'
  seen: new Set(), // guesses opened on the Sample screen, by index
  played: new Set(), // GRN IDs whose sample was played, this recording
  sampleButton: null, // the play button whose sample is playing
}

// One player for language samples, so only one plays at a time.
const samplePlayer = new Audio()

// The recording ring fills over the recording limit.
document.documentElement.style.setProperty('--max-recording', `${config.maxRecordingSeconds}s`)

// ------------------------------------------------------------------ phases

const VIEW_FOR_PHASE = {
  idle: 'recordView',
  recording: 'recordView',
  waiting: 'detectView',
  sample: 'sampleView',
  checkin: 'checkinView',
  results: 'resultsView',
  resources: 'resourcesView',
  dialect: 'dialectView',
  thanks: 'thanksView',
  error: 'errorView',
}

const RECORD_HINTS = {
  idle: 'Tap and say a few sentences about anything',
  recording: 'Keep talking, then tap to finish',
  tooShort: `Keep talking, at least ${config.minRecordingSeconds} seconds`,
}

function setPhase(phase) {
  state.phase = phase
  document.body.dataset.phase = phase
  for (const view of new Set(Object.values(VIEW_FOR_PHASE))) {
    el[view].hidden = VIEW_FOR_PHASE[phase] !== view
  }
  el.appBar.hidden = phase !== 'results' // Speak again; the Sample screen's toolbar has its own
  const recording = phase === 'recording'
  el.recordButton.dataset.recording = String(recording)
  el.recordButton.setAttribute('aria-label', recording ? 'Stop recording' : 'Start recording')
  if (phase === 'idle') {
    el.recordTime.textContent = formatTime(0)
    el.recordHint.textContent = RECORD_HINTS.idle
  }
  if (recording) el.recordHint.textContent = RECORD_HINTS.recording
}

/** Moves keyboard and screen-reader focus to a new screen's heading. */
function focusHeading(heading) {
  heading.tabIndex = -1
  heading.focus({ preventScroll: true })
}

function showError(message) {
  el.errorMessage.textContent = message
  setPhase('error')
}

function reset() {
  stopSample()
  hideConsentBanner({ animate: false }) // a new recording asks again
  state.recorder?.cancel()
  state.recorder = null
  state.session?.controller.abort()
  state.session = null
  state.candidates = []
  state.shown = config.pageSize
  state.sampleIndex = 0
  state.nextTaps = 0
  state.seen.clear()
  state.played.clear()
  clearDialectForm()
  setPhase('idle')
}

const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// --------------------------------------------------------------- recording

// Microphone level bars, newest on the right.
const levels = new Array(30).fill(0)
el.recordLevel.replaceChildren(...levels.map(() => document.createElement('span')))

function showLevel(level) {
  levels.shift()
  levels.push(level)
  ;[...el.recordLevel.children].forEach((bar, i) => bar.style.setProperty('--level', levels[i].toFixed(2)))
}

async function beginRecording() {
  state.starting = true
  try {
    state.recorder = await startRecording({
      maxSeconds: config.maxRecordingSeconds,
      onTick: (seconds) => {
        el.recordTime.textContent = formatTime(seconds)
        // Long enough now: drop any "keep talking" request.
        if (seconds >= config.minRecordingSeconds) el.recordHint.textContent = RECORD_HINTS.recording
      },
      onLimit: finishRecording,
      onLevel: showLevel,
    })
  } catch (err) {
    showError(
      err.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow the microphone for this page, then try again.'
        : `Could not start recording: ${err.message}`,
    )
    return
  } finally {
    state.starting = false
  }
  state.startedAt = performance.now()
  levels.fill(0)
  showLevel(0)
  el.recordTime.textContent = formatTime(0)
  setPhase('recording')
}

async function finishRecording() {
  if (state.phase !== 'recording') return // the button and the time limit can both fire
  setPhase('waiting')
  setDetectStep('prepare')
  const recorder = state.recorder
  state.recorder = null
  const { blob: recording, seconds } = await recorder.stop()

  // A very short recording holds little or no audio: under about 0.3 s the
  // browser can't even read it back, and the model needs a few seconds of speech.
  // The button asks for more before then; this catches anything that slips past.
  if (seconds < config.minRecordingSeconds) {
    showError(
      `That recording was only ${seconds.toFixed(1)} seconds long. ` +
        `Speak for at least ${config.minRecordingSeconds} seconds, then tap Stop.`,
    )
    return
  }

  const session = {
    id: crypto.randomUUID(),
    recording,
    recordingType: recording.type, // kept after a "No" clears the recording
    recordingBytes: recording.size,
    seconds: Math.round(seconds * 10) / 10,
    consent: null,
    controller: new AbortController(),
  }
  state.session = session // before identifying: progress updates only count for the current session
  const onStage = (stage) => {
    if (state.session === session) setDetectStep(stage)
  }
  // Send for identification right away.
  session.results = Promise.all([
    backend.identify(recording, { signal: session.controller.signal, onStage }),
    languagesReady,
  ]).then(([raw, languages]) => {
    console.info('Raw model response', raw)
    onStage('match')
    const candidates = toCandidates(raw, languages)
    savePrediction(session, raw, candidates)
    return candidates
  })
  session.results.catch(() => {}) // reported in showResultsWhenReady
  showConsentBanner() // until answered; results don't wait for it
  showResultsWhenReady(session)
}

el.recordButton.addEventListener('click', () => {
  if (state.phase === 'idle' && !state.starting) beginRecording()
  else if (state.phase === 'recording') {
    if ((performance.now() - state.startedAt) / 1000 < config.minRecordingSeconds) {
      el.recordHint.textContent = RECORD_HINTS.tooShort
      return
    }
    finishRecording()
  }
})

// ------------------------------------------------------------------ detect

const DETECT_STEPS = ['prepare', 'identify', 'match']

/** Marks earlier steps done, this one active and later ones pending. */
function setDetectStep(current) {
  const at = DETECT_STEPS.indexOf(current)
  for (const item of el.detectSteps.children) {
    const i = DETECT_STEPS.indexOf(item.dataset.step)
    item.dataset.state = i < at ? 'done' : i === at ? 'active' : 'pending'
  }
}

el.detectCancel.addEventListener('click', reset)

// ----------------------------------------------------------------- consent

function showConsentBanner() {
  el.consentBanner.classList.remove('leaving')
  el.consentBanner.hidden = false
}

/** Animates the banner away (see .leaving in styles.css), or just hides it. */
function hideConsentBanner({ animate = true } = {}) {
  const banner = el.consentBanner
  if (!animate) {
    banner.classList.remove('leaving')
    banner.hidden = true
    return
  }
  if (banner.hidden || banner.classList.contains('leaving')) return
  banner.style.setProperty('--banner-height', `${banner.offsetHeight}px`)
  banner.classList.add('leaving')
  const done = () => {
    if (!banner.classList.contains('leaving')) return // shown again meanwhile
    banner.classList.remove('leaving')
    banner.hidden = true
  }
  banner.addEventListener('animationend', done, { once: true })
  setTimeout(done, 300) // in case the animation doesn't run (a hidden tab)
}

/**
 * The banner's answer, whenever it comes: during Detect or after choosing a
 * language. With no answer, the recording isn't kept.
 */
function answerConsent(consented) {
  const session = state.session
  hideConsentBanner()
  if (!session || session.consent !== null) return
  session.consent = consented

  const answer = {
    sessionId: session.id,
    consent: consented,
    answeredAt: new Date().toISOString(),
    recordingType: session.recording.type,
    recordingBytes: session.recording.size,
    recordingSeconds: session.seconds,
  }
  const saved = backend.saveConsent(answer)
  saved.catch((err) => console.error('Saving the consent answer failed', err))
  if (consented) {
    // Only once the "Yes" is stored: the server refuses audio without one.
    saved
      .then(() => backend.saveRecording(session.recording, session.id))
      .catch((err) => console.error('Keeping the recording failed', err))
  } else {
    session.recording = null // not kept
  }
  updateDialectNote()
}

/** Stores the model's guesses for every recording, as soon as they're back; a choice later adds to it (same sessionId). */
function savePrediction(session, raw, candidates) {
  const prediction = {
    sessionId: session.id,
    recordingType: session.recordingType,
    recordingBytes: session.recordingBytes,
    recordingSeconds: session.seconds,
    model: raw.model ?? 'unknown',
    guesses: candidates
      .slice(0, 10)
      .map((c) => ({ rank: c.rank, label: c.label, name: c.name, confidence: c.confidence })),
    predictedAt: new Date().toISOString(),
  }
  backend.savePrediction(prediction).catch((err) => console.error('Saving the prediction failed', err))
}

el.consentYes.addEventListener('click', () => answerConsent(true))
el.consentNo.addEventListener('click', () => answerConsent(false))

// ----------------------------------------------------------------- results

async function showResultsWhenReady(session) {
  setPhase('waiting') // if results are already back, this is replaced before the next paint
  let candidates
  try {
    candidates = await session.results
  } catch (err) {
    if (state.session === session) showError(`Could not identify the language: ${err.message}`)
    return
  }
  if (state.session !== session) return // started over meanwhile
  state.candidates = candidates.filter((c) => c.known)
  state.topConfidence = topConfidence(candidates)
  state.shown = config.pageSize
  renderResults()
  // Straight to hearing the best guess; all the rankings are a tap away.
  if (state.candidates.length > 0) showSample(0)
  else setPhase('results')
  window.scrollTo(0, 0)
}

/** Back to the ranked list, scrolled to the guess the Sample screen was on. */
function showRankings() {
  stopSample()
  if (state.sampleIndex >= state.shown) {
    state.shown = Math.ceil((state.sampleIndex + 1) / config.pageSize) * config.pageSize
    renderResults()
  }
  setPhase('results')
  const label = state.candidates[state.sampleIndex]?.label
  const card = [...el.list.children].find((c) => c.dataset.label === label)
  if (card && state.sampleIndex > 0) card.scrollIntoView({ block: 'center' })
  else window.scrollTo(0, 0)
  focusHeading($('results-heading'))
}

const nearCountry = () => (state.nearMe ? (state.location?.code ?? null) : null)

function renderResults() {
  const country = nearCountry()
  const page = firstPage(state.candidates, state.shown)
  stopSample() // its button is about to be replaced
  el.list.replaceChildren(...page.rows.map((c, i) => renderCard(c, i, country)))
  el.empty.hidden = state.candidates.length > 0
  el.showMore.hidden = !page.hasMore
}

function renderCard(candidate, index, country) {
  const card = el.cardTemplate.content.firstElementChild.cloneNode(true)
  const part = (name) => card.querySelector(`.card-${name}`)

  card.dataset.label = candidate.label
  card.dataset.rank = String(candidate.rank)
  card.dataset.count = String(candidate.languages.length)
  card.style.setProperty('--i', String(index % config.pageSize)) // staggers the fade-in

  // The name in the device's language, with the language's own name below when we know it.
  const ownLang = /^[a-z]{3}$/.test(candidate.label) ? candidate.label : ''
  if (!showNames(part('name'), part('subname'), candidate, ownLang)) part('subname').remove()
  part('local').hidden = !candidate.languages.some((lang) => isInCountry(lang, country))

  showMatch(card.querySelector('.match'), candidate)

  // Rankings show only the languages; a guess's dialects are listed on the Sample screen.
  const count = candidate.languages.length
  if (count > 1) part('count').textContent = `${count} dialects`
  else part('count').remove()
  return card
}

// Anywhere on a card opens it on the Sample screen.
el.list.addEventListener('click', (e) => {
  const card = e.target.closest('.card')
  if (card) showSample(state.candidates.findIndex((c) => c.label === card.dataset.label))
})

async function useLocation() {
  if (state.location) return true
  el.locationStatus.textContent = 'Finding your location…'
  try {
    const found = await detectCountry()
    if (!found.code) throw new Error('Your location is not inside a known country')
    state.location = found
    return true
  } catch (err) {
    el.locationStatus.textContent = `Could not use your location: ${err.message}`
    return false
  }
}

el.nearMe.addEventListener('click', async () => {
  if (!state.nearMe) {
    el.nearMe.disabled = true
    const found = await useLocation()
    el.nearMe.disabled = false
    if (!found) return
  }
  state.nearMe = !state.nearMe
  el.nearMe.setAttribute('aria-pressed', String(state.nearMe))
  el.locationStatus.textContent = state.nearMe ? `Marking languages spoken in ${state.location.name}` : ''
  renderResults()
})

el.showMore.addEventListener('click', () => {
  state.shown += config.pageSize
  renderResults()
})
el.recordAgain.addEventListener('click', reset)
// The Speak again button at the top left of Rankings and the Sample screen.
for (const button of document.querySelectorAll('.record-again-button')) button.addEventListener('click', reset)
el.newDialect.addEventListener('click', () => showDialectForm({ from: 'rankings' }))
el.errorRetry.addEventListener('click', reset)

// ------------------------------------------------------------- sample screen

// Playback progress on the Sample screen's big player: bars fill in as it plays.
// The shape is only a pattern, not the sample's own waveform.
const WAVE_BARS = Array.from({ length: 42 }, (_, i) =>
  Math.round(18 + 70 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21 + 1)) + ((i * 17) % 9)),
)
el.sampleWave.replaceChildren(
  ...WAVE_BARS.map((height) => {
    const bar = document.createElement('span')
    bar.style.setProperty('--height', `${height}%`)
    return bar
  }),
)

function showWaveProgress(fraction) {
  const played = Math.round(fraction * WAVE_BARS.length)
  ;[...el.sampleWave.children].forEach((bar, i) => bar.classList.toggle('played', i < played))
}

/** Opens a guess, by its place in state.candidates, on the Sample screen. */
function showSample(index) {
  stopSample()
  state.sampleIndex = index
  state.seen.add(index)
  renderSample()
  setPhase('sample')
  window.scrollTo(0, 0)
  focusHeading(el.sampleName)
}

function renderSample() {
  const index = state.sampleIndex
  const candidate = state.candidates[index]
  const country = nearCountry()

  // Dots for the first few guesses; past them, the position line says where we are.
  const dots = Math.min(config.compareCount, state.candidates.length)
  el.sampleDots.hidden = index >= dots
  el.sampleDots.replaceChildren(
    ...Array.from({ length: dots }, (_, i) => {
      const dot = document.createElement('li')
      if (i === index) dot.dataset.current = 'true'
      else if (state.seen.has(i)) dot.dataset.seen = 'true'
      return dot
    }),
  )
  el.samplePosition.textContent = index === 0 ? 'Best match' : `Match ${index + 1}`

  showNames(el.sampleName, el.sampleSubname, candidate, /^[a-z]{3}$/.test(candidate.label) ? candidate.label : '')
  showMatch(el.sampleMatch, candidate)

  const several = candidate.languages.length > 1
  el.sampleSingle.hidden = several
  el.sampleDialectsBlock.hidden = !several
  if (several) {
    el.sampleDialectCount.textContent = `${candidate.languages.length} dialects`
    // As on the rankings: when every dialect is local, don't tag each one.
    const tagDialects = !candidate.languages.every((lang) => isInCountry(lang, country))
    el.sampleDialects.replaceChildren(
      ...nearFirst(candidate.languages, country).map((lang) =>
        renderSampleDialect(lang, shownName(candidate), tagDialects ? country : null),
      ),
    )
  } else {
    readySampleButton(el.samplePlay, candidate.sampleId)
    showWaveProgress(0)
  }

  // Next previews the following guess; the last guess has none.
  const next = state.candidates[index + 1]
  el.samplePrev.disabled = index === 0
  el.sampleNext.hidden = !next
  el.sampleNextHint.hidden = !next
  if (next) {
    showMatch(el.sampleNextMatch, next)
    el.sampleNextName.textContent = shownName(next)
    el.sampleNext.setAttribute('aria-label', `Next match: ${shownName(next)}, ${formatPercent(next.percent)}`)
  }
}

/** Fills a match ring (`.match`) for a guess. */
function showMatch(ring, candidate) {
  ring.style.setProperty('--pct', String(candidate.percent))
  ring.style.setProperty('--strength', matchStrength(candidate.confidence, state.topConfidence).toFixed(3))
  ring.querySelector('.match-value').textContent = formatPercent(candidate.percent)
}

function renderSampleDialect(language, groupName, country) {
  const item = el.sampleDialectTemplate.content.firstElementChild.cloneNode(true)
  item.dataset.id = String(language.id)
  item.querySelector('.dialect-name').textContent = shortName({ name: shownName(language) }, groupName)
  const region = item.querySelector('.dialect-region')
  region.textContent = describeCountries(language.countries)
  if (!region.textContent) region.remove()
  item.querySelector('.dialect-local').hidden = !isInCountry(language, country)
  const play = item.querySelector('.play-button')
  play.dataset.played = String(state.played.has(String(language.id)))
  if (!language.hasSample) markSampleMissing(play, 'No sample')
  return item
}

/** The big play button is reused for each guess: undo the last guess's state. */
function readySampleButton(button, id) {
  delete button.dataset.playing
  if (id == null) {
    delete button.dataset.id
    markSampleMissing(button, 'No sample')
    return
  }
  button.disabled = false
  delete button.dataset.sample
  button.removeAttribute('title')
  button.setAttribute('aria-label', 'Play sample')
  button.dataset.id = String(id)
  button.dataset.played = String(state.played.has(String(id)))
}

el.sampleAll.addEventListener('click', showRankings)
el.samplePrev.addEventListener('click', () => showSample(state.sampleIndex - 1))
el.sampleNext.addEventListener('click', () => {
  // Every few Nexts, check in: they may not find their language this way.
  state.nextTaps += 1
  if (config.checkInEvery > 0 && state.nextTaps >= config.checkInEvery) showCheckIn()
  else showSample(state.sampleIndex + 1)
})

// --------------------------------------------------------------- check-in

function showCheckIn() {
  stopSample()
  state.nextTaps = 0
  el.checkinNextName.textContent = shownName(state.candidates[state.sampleIndex + 1])
  setPhase('checkin')
  window.scrollTo(0, 0)
  focusHeading(el.checkinHeading)
}

el.checkinNext.addEventListener('click', () => showSample(state.sampleIndex + 1))
el.checkinRecord.addEventListener('click', reset)
el.checkinDialect.addEventListener('click', () => showDialectForm({ from: 'sample' }))

el.sampleChoose.addEventListener('click', () => {
  const candidate = state.candidates[state.sampleIndex]
  choose(candidate.languages[0], candidate)
})
el.sampleDialects.addEventListener('click', (e) => {
  const button = e.target.closest('.choose-button')
  if (!button) return
  const candidate = state.candidates[state.sampleIndex]
  const id = Number(button.closest('[data-id]').dataset.id)
  choose(
    candidate.languages.find((lang) => lang.id === id),
    candidate,
  )
})

// ----------------------------------------------------------- choice and resources

/** "This is my language": save the choice (added to the stored prediction), then show what's there for it. */
function choose(language, candidate) {
  stopSample()
  const session = state.session
  const choice = {
    sessionId: session?.id ?? null,
    consent: session?.consent ?? null, // with a "yes", the kept recording has the same sessionId
    languageId: language.id,
    languageName: language.name,
    languageIso: language.iso ?? null,
    modelLabel: candidate.label,
    modelRank: candidate.rank,
    modelConfidence: candidate.confidence,
    chosenAt: new Date().toISOString(),
  }
  backend.saveChoice(choice).catch((err) => console.error('Saving the choice failed', err))
  state.resourcesFrom = 'sample'
  showResources(language)
}

/**
 * The end screen tries the chosen language first: the title is the language's
 * own name when we know it, else its name in the device's language, and every
 * word on the screen comes in the guide's language (see showLabels). `eyebrow`
 * is a key in the labels: 'choice', or 'closest' after a new dialect.
 */
function showResources(language, { eyebrow = 'choice' } = {}) {
  state.resourcesEyebrow = eyebrow
  const deviceName = shownName(language)
  el.resourcesHeading.textContent = language.native || deviceName
  el.resourcesHeading.lang = language.native ? (language.iso ?? '') : ''
  el.resourcesSubname.textContent = language.native && language.native !== deviceName ? deviceName : ''
  el.resourcesList.replaceChildren(...resourceLinks(language, config.resources).map(renderResource))
  el.resourcesList.dataset.languageId = String(language.id)
  setPhase('resources')
  window.scrollTo(0, 0)
  focusHeading(el.resourcesHeading)
  addBible(language)
  startAssistant(language)
  showLabels(endLabels.words, endLabels.lang) // the eyebrow, and the words kept when it's the same language again
}

/** Adds the language's YouVersion Bible to the list, when there is one. */
async function addBible(language) {
  if (!config.bibleUrl) return
  const stillShowing = () => state.phase === 'resources' && el.resourcesList.dataset.languageId === String(language.id)
  let link
  try {
    const response = await fetch(config.bibleUrl.replace('{id}', encodeURIComponent(language.id)))
    if (!response.ok) throw new Error(`${response.status} ${await response.text().catch(() => '')}`)
    link = bibleResource(await response.json(), language)
  } catch (err) {
    console.warn('Could not look up a Bible for this language', err)
    return
  }
  if (link && stillShowing()) el.resourcesList.append(renderResource(link))
}

function renderResource(link) {
  const item = el.resourceTemplate.content.firstElementChild.cloneNode(true)
  const button = item.querySelector('.resource-button')
  button.href = link.url
  button.dataset.text = link.button // in English; showLabels translates it
  button.textContent = buttonText(link.button)
  button.title = link.title
  const logo = item.querySelector('.resource-logo')
  if (link.logo) logo.src = link.logo
  else logo.remove()
  const qr = item.querySelector('.qr')
  qr.innerHTML = qrSvg(link.url) // built from the URL by qr.js, not from page content
  qr.setAttribute('aria-label', `QR code: ${link.title}`)
  return item
}

// Back to where the language was chosen: its guess on the Sample screen, to
// choose again, or the new-dialect form.
el.resourcesBack.addEventListener('click', () =>
  state.resourcesFrom === 'dialect' ? showDialectForm() : showSample(state.sampleIndex),
)
// ------------------------------------------------- Gloo AI: guide and chat

/** The guide note and the chat for this language. Coming back to the same language keeps the conversation. */
function startAssistant(language) {
  el.guide.hidden = !config.guideUrl
  // With a guide coming, the chat waits for it, so it appears in the person's language.
  el.chat.hidden = !config.chatUrl || (Boolean(config.guideUrl) && state.assistant.languageId !== language.id)
  if (state.assistant.languageId === language.id) return
  state.assistant = { languageId: language.id, log: [], busy: false }
  el.chatLog.replaceChildren()
  el.chatInput.value = ''
  updateSendButton()
  showLabels(DEFAULT_LABELS, 'en')
  showSuggestions(config.guideUrl ? [] : DEFAULT_QUESTIONS)
  if (config.guideUrl) loadGuide(language)
}

const isCurrent = (language) => state.assistant.languageId === language.id

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = new Error(`${url} returned ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

async function loadGuide(language) {
  el.guide.dataset.state = 'loading'
  el.guide.setAttribute('aria-busy', 'true')
  el.guideText.textContent = ''
  let guide
  try {
    guide = await postJson(config.guideUrl, {
      grn_id: language.id,
      country: state.location?.code ?? null,
      device_language: navigator.language ?? null, // the fallback when the chosen language doesn't work out
    })
  } catch (err) {
    console.warn('No guide note', err)
    if (!isCurrent(language)) return
    el.guide.hidden = true // the resources speak for themselves
    showSuggestions(DEFAULT_QUESTIONS)
    el.chat.hidden = !config.chatUrl
    return
  }
  if (!isCurrent(language)) return
  el.guideText.textContent = guide.text
  el.guideText.lang = guide.tag || ''
  el.guide.dataset.state = 'ready'
  if (guide.labels) showLabels(guide.labels, guide.tag)
  el.guide.setAttribute('aria-busy', 'false')
  // Starter questions in the guide's language, until the first question is asked.
  if (!state.assistant.log.length) {
    if (guide.questions?.length) showSuggestions(guide.questions, guide.tag)
    else showSuggestions(DEFAULT_QUESTIONS)
  }
  el.chat.hidden = !config.chatUrl
}

// Every word on the end screen, in the guide's language once it arrives.
let endLabels = { words: DEFAULT_LABELS, lang: 'en' }

/** The end screen's own words, in the guide's language. */
function showLabels(labels, lang) {
  const words = { ...DEFAULT_LABELS, ...labels }
  endLabels = { words, lang }
  el.resourcesEyebrow.textContent = words[state.resourcesEyebrow] ?? words.choice
  el.resourcesPrompt.textContent = words.prompt
  el.resourcesRestart.textContent = words.restart
  for (const button of el.resourcesList.querySelectorAll('.resource-button')) {
    button.textContent = buttonText(button.dataset.text)
    button.lang = lang || ''
  }
  el.guide.setAttribute('aria-label', words.note)
  el.chatHeading.textContent = words.chatTitle
  el.chatLede.textContent = words.chatLede
  el.chatInput.placeholder = words.placeholder
  el.chatSend.setAttribute('aria-label', words.send)
  const nodes = [el.resourcesEyebrow, el.resourcesPrompt, el.resourcesRestart, el.guide, el.chatHeading, el.chatLede, el.chatInput, el.chatSend]
  for (const node of nodes) node.lang = lang || ''
}

/** "Go to 5fish" in the end screen's language; the site's name stays as it is. */
function buttonText(english) {
  const site = /^Go to (.+)$/.exec(english ?? '')?.[1]
  const goTo = endLabels.words.goTo
  return site && goTo.includes('{site}') ? goTo.replace('{site}', site) : english
}

function showSuggestions(questions, lang = '') {
  el.chatSuggestions.replaceChildren(
    ...questions.map((question) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip'
      chip.lang = lang
      chip.textContent = question
      return chip
    }),
  )
}

function addMessage(role, text, { error = false } = {}) {
  const item = document.createElement('li')
  item.className = `message message-${role}${error ? ' message-error' : ''}`
  item.dir = 'auto'
  item.textContent = text
  el.chatLog.append(item)
  return item
}

function showTyping() {
  const item = document.createElement('li')
  item.className = 'message message-assistant message-typing'
  item.setAttribute('aria-label', 'Writing an answer')
  item.append(document.createElement('span'), document.createElement('span'), document.createElement('span'))
  el.chatLog.append(item)
  item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  return item
}

async function ask(question) {
  question = cleanQuestion(question)
  const assistant = state.assistant
  if (!question || assistant.busy) return
  assistant.busy = true
  el.chatSuggestions.replaceChildren() // starters are only for the first question
  el.chatInput.value = ''
  resizeInput()
  updateSendButton()
  const languageId = assistant.languageId
  const body = chatRequest(languageId, state.location?.code, assistant.log, question, navigator.language)
  assistant.log.push({ role: 'user', content: question })
  addMessage('user', question)
  const typing = showTyping()
  try {
    const { reply } = await postJson(config.chatUrl, body)
    if (state.assistant !== assistant) return // moved to another language meanwhile
    assistant.log.push({ role: 'assistant', content: reply })
    typing.replaceWith(addMessage('assistant', reply))
  } catch (err) {
    console.warn('Chat failed', err)
    if (state.assistant !== assistant) return
    assistant.log.pop() // not answered, so not part of the conversation
    typing.replaceWith(addMessage('assistant', assistantError(err.status), { error: true }))
  } finally {
    assistant.busy = false
    updateSendButton()
  }
  el.chatLog.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function updateSendButton() {
  el.chatSend.disabled = state.assistant.busy || !cleanQuestion(el.chatInput.value)
}

/** The box grows with the question, up to a few lines. */
function resizeInput() {
  el.chatInput.style.height = 'auto'
  el.chatInput.style.height = `${el.chatInput.scrollHeight}px`
}

el.chatForm.addEventListener('submit', (e) => {
  e.preventDefault()
  ask(el.chatInput.value)
})
el.chatInput.addEventListener('input', () => {
  resizeInput()
  updateSendButton()
})
// Enter sends; Shift+Enter starts a new line.
el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    ask(el.chatInput.value)
  }
})
el.chatSuggestions.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip')
  if (chip) ask(chip.textContent)
})
el.resourcesRestart.addEventListener('click', reset)

// ------------------------------------------------------------- new dialect

// "None, enter new dialect": a language or dialect the catalog doesn't have.
// Always saved: with a kept recording it's training data, without one a lead.

const countries = countryList('en')
const findCountry = countrySearch(countries)
const countryNames = (country) => [country.name, country.code]
const languageNames = (language) => [language.name, language.native, ...Object.values(language.names ?? {})]
let languageIndex = null
let allLanguages = []
let findLanguage = () => []
languagesReady
  .then((index) => {
    languageIndex = index
    allLanguages = [...index.byId.values()]
    findLanguage = languageSearch(allLanguages)
  })
  .catch(() => {}) // reported when identifying

// What was picked from the suggestions; typing over it un-picks it.
const dialectPicks = { parent: null, country: null }

/** Before anything is typed: the languages the model thought most likely. */
function topGuessLanguages() {
  const languages = state.candidates.slice(0, 5).map((c) => languageIndex?.byId.get(c.leadId))
  return [...new Set(languages.filter(Boolean))]
}

attachSuggestions(el.dialectParent, el.dialectParentList, {
  find: (text) => (fold(text) ? findLanguage(text, { minLength: 2 }) : topGuessLanguages()),
  // The native name tells similar names apart; without one, where it's spoken.
  describe: (language) => ({
    label: shownName(language),
    detail: language.native || describeCountries(language.countries ?? []),
    lang: language.native ? (language.iso ?? '') : '',
  }),
  onPick: (language) => {
    dialectPicks.parent = language
    updateDialectSubmit()
  },
})

attachSuggestions(el.dialectCountry, el.dialectCountryList, {
  find: (text) => findCountry(text),
  describe: (country) => ({ label: country.name }),
  onPick: (country) => {
    dialectPicks.country = country
    updateDialectSubmit()
  },
})

el.dialectParent.addEventListener('input', () => {
  if (dialectPicks.parent && el.dialectParent.value !== shownName(dialectPicks.parent)) dialectPicks.parent = null
})
el.dialectCountry.addEventListener('input', () => {
  if (dialectPicks.country && el.dialectCountry.value !== dialectPicks.country.name) dialectPicks.country = null
})

/** All three boxes are needed. */
function updateDialectSubmit() {
  el.dialectSubmit.disabled = ![el.dialectParent, el.dialectName, el.dialectCountry].every((box) => box.value.trim())
}
el.dialectForm.addEventListener('input', updateDialectSubmit)

/** `from`: where its back button goes. Coming back from Resources keeps the last one. */
function showDialectForm({ from = state.dialectFrom } = {}) {
  stopSample()
  state.dialectFrom = from
  el.dialectBack.setAttribute(
    'aria-label',
    from === 'sample' ? `Back to ${state.candidates[state.sampleIndex] ? shownName(state.candidates[state.sampleIndex]) : 'the last match'}` : 'Back to all rankings',
  )
  updateDialectNote()
  // The country "Near me" found, if it was used.
  if (!el.dialectCountry.value && state.location?.code) {
    const here = countries.find((country) => country.code === state.location.code)
    if (here) {
      el.dialectCountry.value = here.name
      dialectPicks.country = here
    }
  }
  updateDialectSubmit()
  setPhase('dialect')
  window.scrollTo(0, 0)
  focusHeading(el.dialectHeading)
}

/** Whether a recording goes with what they type: not after a "No", and not yet without an answer. */
function updateDialectNote() {
  const consent = state.session?.consent ?? null
  el.dialectNote.hidden = consent === true
  el.dialectNote.textContent =
    consent === false
      ? "You asked us not to keep your recording, so we'll save only what you type here."
      : "We'll save what you type here. To include your recording too, answer “Yes, keep it” above."
}

function clearDialectForm() {
  el.dialectForm.reset()
  dialectPicks.parent = null
  dialectPicks.country = null
  updateDialectSubmit()
}

el.dialectForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const parentText = el.dialectParent.value.trim()
  const dialectName = el.dialectName.value.trim()
  const countryText = el.dialectCountry.value.trim()
  if (!parentText || !dialectName || !countryText) return
  // Typed out in full instead of picked: still a known one if the name matches exactly.
  const parent = dialectPicks.parent ?? exactMatch(allLanguages, languageNames, parentText)
  const country = dialectPicks.country ?? exactMatch(countries, countryNames, countryText)
  const session = state.session
  const report = {
    sessionId: session?.id ?? null,
    // true: the kept recording has the same sessionId (training data); false: a lead, no audio.
    consent: session?.consent ?? null,
    parentLanguageId: parent?.id ?? null, // null: typed, and not in the catalog
    parentLanguageName: parent?.name ?? parentText,
    dialectName,
    countryCode: country?.code ?? null,
    countryName: country?.name ?? countryText,
    // What the model heard, for whoever reviews it.
    modelGuesses: state.candidates.slice(0, 5).map((c) => ({ label: c.label, name: c.name, confidence: c.confidence })),
    // How many guesses they opened on the Sample screen before giving up on the list.
    guessesViewed: state.seen.size,
    submittedAt: new Date().toISOString(),
  }
  backend.saveNewDialect(report).catch((err) => console.error('Saving the new dialect failed', err))
  if (parent) {
    // Until it's in the catalog, the closest we have: the language it belongs to.
    state.resourcesFrom = 'dialect'
    showResources(parent, { eyebrow: 'closest' })
  } else {
    showThanks(report)
  }
})

function showThanks(report) {
  el.thanksText.textContent =
    `We saved ${report.dialectName} (${report.parentLanguageName}, ${report.countryName}). ` +
    'It helps us recognize it for the next person.'
  setPhase('thanks')
  window.scrollTo(0, 0)
  focusHeading(el.thanksHeading)
}

el.dialectBack.addEventListener('click', () =>
  state.dialectFrom === 'sample' ? showSample(state.sampleIndex) : showRankings(),
)
el.thanksBack.addEventListener('click', showRankings)
el.thanksRestart.addEventListener('click', reset)

// ------------------------------------------------------------ sample playback

function markSampleMissing(button, text) {
  button.disabled = true
  button.dataset.sample = 'missing'
  button.setAttribute('aria-label', text)
  button.title = text
}

function setSampleButton(button, playing) {
  button.dataset.playing = String(playing)
  button.setAttribute('aria-label', playing ? 'Stop sample' : 'Play sample')
}

function stopSample() {
  const button = state.sampleButton
  state.sampleButton = null
  samplePlayer.pause()
  samplePlayer.removeAttribute('src')
  if (button) setSampleButton(button, false)
}

function playSample(button) {
  const wasPlaying = state.sampleButton === button
  stopSample()
  if (wasPlaying) return // a second tap stops it
  const id = button.closest('[data-id]').dataset.id
  state.sampleButton = button
  setSampleButton(button, true)
  samplePlayer.src = config.sampleUrl.replace('{id}', id)
  // A failed load also fires the player's error event, handled below.
  samplePlayer.play().catch(() => {})
}

// Play buttons are on the rankings and the Sample screen.
document.addEventListener('click', (e) => {
  const button = e.target.closest('.play-button')
  if (!button || button.disabled) return
  // Remembered so the Sample screen can show which samples were already heard.
  state.played.add(button.closest('[data-id]').dataset.id)
  button.dataset.played = 'true'
  playSample(button)
})
samplePlayer.addEventListener('ended', stopSample)
// Progress for the Sample screen's big player; stopSample clearing the source resets it.
samplePlayer.addEventListener('timeupdate', () => {
  if (state.sampleButton === el.samplePlay && samplePlayer.duration > 0) {
    showWaveProgress(samplePlayer.currentTime / samplePlayer.duration)
  }
})
samplePlayer.addEventListener('emptied', () => showWaveProgress(0))
// No sample on GRN (404) or GRN unreachable (502): the server answers with an error, not audio.
samplePlayer.addEventListener('error', () => {
  const button = state.sampleButton
  if (!button || !samplePlayer.getAttribute('src')) return // from stopSample clearing the source
  state.sampleButton = null
  markSampleMissing(button, 'Sample unavailable')
  console.warn('Could not play the sample', samplePlayer.src, samplePlayer.error)
})

setPhase('idle')
console.info(`Speak The Heart: using the ${backend.name} backend`)
