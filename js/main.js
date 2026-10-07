import { createBackend } from './backend.js'
import { config } from './config.js'
import { detectCountry } from './location.js'
import { qrSvg } from './qr.js'
import { startRecording } from './recorder.js'
import {
  describeCountries,
  firstPage,
  formatPercent,
  indexLanguages,
  isInCountry,
  matchStrength,
  nearFirst,
  resourceLinks,
  shortName,
  toCandidates,
  topConfidence,
} from './results.js'

const $ = (id) => document.getElementById(id)
const el = {
  appBar: $('app-bar'),
  step: $('step'),
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
  sampleView: $('sample-view'),
  sampleBack: $('sample-back'),
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
  resourcesView: $('resources-view'),
  resourcesAll: $('resources-all'),
  resourcesHeading: $('resources-heading'),
  resourcesSubname: $('resources-subname'),
  resourcesList: $('resources-list'),
  resourcesRestart: $('resources-restart'),
  errorView: $('error-view'),
  errorMessage: $('error-message'),
  errorRetry: $('error-retry'),
  consentDialog: $('consent-dialog'),
  consentYes: $('consent-yes'),
  consentNo: $('consent-no'),
  cardTemplate: $('card-template'),
  dialectTemplate: $('dialect-template'),
  sampleDialectTemplate: $('sample-dialect-template'),
  resourceTemplate: $('resource-template'),
  testPlayback: $('test-playback'),
  testPlaybackInfo: $('test-playback-info'),
  testPlaybackAudio: $('test-playback-audio'),
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
  // One recording and everything about it: { id, recording, seconds, consent, results, controller }
  session: null,
  candidates: [], // the guesses the catalog knows, in the model's order
  topConfidence: 0, // the best guess's score: a full-strength match ring
  shown: config.pageSize,
  expanded: new Set(), // labels of guesses whose dialect list is open
  nearMe: false, // the "Near me" chip is on
  location: null, // { code, name } once "Near me" has found it
  sampleIndex: 0, // the guess on the Sample screen, in state.candidates
  seen: new Set(), // guesses opened on the Sample screen, by index
  played: new Set(), // GRN IDs whose sample was played, this recording
  playbackUrl: null, // the last recording, when showTestPlayback is on
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
  consent: 'detectView', // behind the consent popup
  waiting: 'detectView',
  sample: 'sampleView',
  results: 'resultsView',
  resources: 'resourcesView',
  error: 'errorView',
}

// The Sample and Resources screens have their own toolbar instead.
const STEP_FOR_PHASE = {
  idle: 'Step 1 of 3',
  recording: 'Step 1 of 3',
  consent: 'Step 2 of 3',
  waiting: 'Step 2 of 3',
  results: 'Step 3 of 3',
  sample: '',
  resources: '',
  error: '',
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
  el.step.textContent = STEP_FOR_PHASE[phase]
  el.appBar.hidden = !STEP_FOR_PHASE[phase]
  const recording = phase === 'recording'
  el.recordButton.dataset.recording = String(recording)
  el.recordButton.setAttribute('aria-label', recording ? 'Stop recording' : 'Start recording')
  if (phase === 'idle') {
    el.recordTime.textContent = formatTime(0)
    el.recordHint.textContent = RECORD_HINTS.idle
  }
  if (recording) el.recordHint.textContent = RECORD_HINTS.recording
  el.testPlayback.hidden = !(state.playbackUrl && ['waiting', 'sample', 'results', 'error'].includes(phase))
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
  clearTestPlayback()
  state.recorder?.cancel()
  state.recorder = null
  state.session?.controller.abort()
  state.session = null
  state.candidates = []
  state.shown = config.pageSize
  state.sampleIndex = 0
  state.seen.clear()
  state.played.clear()
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
  setPhase('consent')
  setDetectStep('prepare')
  const recorder = state.recorder
  state.recorder = null
  const { blob: recording, seconds } = await recorder.stop()
  showTestPlayback(recording, seconds) // before the length check, so short ones can be heard too

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
    seconds: Math.round(seconds * 10) / 10,
    consent: null,
    controller: new AbortController(),
  }
  state.session = session // before identifying: progress updates only count for the current session
  const onStage = (stage) => {
    if (state.session === session) setDetectStep(stage)
  }
  // Send for identification right away; the consent question covers the wait.
  session.results = Promise.all([
    backend.identify(recording, { signal: session.controller.signal, onStage }),
    languagesReady,
  ]).then(([raw, languages]) => {
    console.info('Raw model response', raw)
    onStage('match')
    return toCandidates(raw, languages)
  })
  session.results.catch(() => {}) // reported in showResultsWhenReady
  el.consentDialog.showModal()
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

function answerConsent(consented) {
  const session = state.session
  el.consentDialog.close()
  session.consent = consented

  const answer = {
    sessionId: session.id,
    consent: consented,
    answeredAt: new Date().toISOString(),
    recordingType: session.recording.type,
    recordingBytes: session.recording.size,
    recordingSeconds: session.seconds,
  }
  backend.saveConsent(answer).catch((err) => console.error('Saving the consent answer failed', err))
  if (consented) {
    backend
      .saveRecording(session.recording, answer)
      .catch((err) => console.error('Keeping the recording failed', err))
  } else {
    session.recording = null // not kept
  }
  showResultsWhenReady(session)
}

el.consentYes.addEventListener('click', () => answerConsent(true))
el.consentNo.addEventListener('click', () => answerConsent(false))
// An answer is required: Escape doesn't close the popup.
el.consentDialog.addEventListener('cancel', (e) => e.preventDefault())

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
  // The best guess starts with its dialects showing.
  state.expanded = new Set(state.candidates.slice(0, 1).map((c) => c.label))
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

  // The name in the language itself when we know it, with the English name below.
  if (candidate.native) {
    part('name').textContent = candidate.native
    if (/^[a-z]{3}$/.test(candidate.label)) part('name').lang = candidate.label
    part('subname').textContent = candidate.name
  } else {
    part('name').textContent = candidate.name
    part('subname').remove()
  }
  part('local').hidden = !candidate.languages.some((lang) => isInCountry(lang, country))

  showMatch(card.querySelector('.match'), candidate)

  const play = part('play')
  if (candidate.sampleId == null) markSampleMissing(play, 'No sample')
  else play.dataset.id = String(candidate.sampleId)

  const dialects = card.querySelector('.dialects')
  if (candidate.languages.length > 1) {
    dialects.id = `dialects-${candidate.label}`
    part('toggle').setAttribute('aria-controls', dialects.id)
    // When every dialect is local, the card's own tag says so; one per row would be noise.
    const tagDialects = !candidate.languages.every((lang) => isInCountry(lang, country))
    dialects.replaceChildren(
      ...nearFirst(candidate.languages, country).map((lang) =>
        renderDialect(lang, candidate.name, tagDialects ? country : null),
      ),
    )
    setExpanded(card, state.expanded.has(candidate.label))
  } else {
    part('toggle').remove()
    dialects.remove()
  }
  return card
}

function renderDialect(language, groupName, country) {
  const item = el.dialectTemplate.content.firstElementChild.cloneNode(true)
  item.dataset.id = String(language.id)
  item.querySelector('.dialect-name').textContent = shortName(language, groupName)
  const region = item.querySelector('.dialect-region')
  region.textContent = describeCountries(language.countries)
  if (!region.textContent) region.remove()
  item.querySelector('.dialect-local').hidden = !isInCountry(language, country)
  if (!language.hasSample) markSampleMissing(item.querySelector('.play-button'), 'No sample')
  return item
}

function setExpanded(card, open) {
  card.querySelector('.card-toggle').setAttribute('aria-expanded', String(open))
  card.querySelector('.card-toggle-label').textContent = open ? 'Hide dialects' : `${card.dataset.count} dialects`
  card.querySelector('.dialects').hidden = !open
}

el.list.addEventListener('click', (e) => {
  const toggle = e.target.closest('.card-toggle')
  if (toggle) {
    const card = toggle.closest('.card')
    const open = toggle.getAttribute('aria-expanded') !== 'true'
    if (open) state.expanded.add(card.dataset.label)
    else state.expanded.delete(card.dataset.label)
    setExpanded(card, open)
    return
  }
  // Anywhere on a card's top row but its play button opens it on the Sample screen.
  const main = e.target.closest('.card-main')
  if (main && !e.target.closest('.play-button')) {
    const label = main.closest('.card').dataset.label
    showSample(state.candidates.findIndex((c) => c.label === label))
  }
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

  if (candidate.native) {
    el.sampleName.textContent = candidate.native
    el.sampleName.lang = /^[a-z]{3}$/.test(candidate.label) ? candidate.label : ''
    el.sampleSubname.textContent = candidate.name
  } else {
    el.sampleName.textContent = candidate.name
    el.sampleName.lang = ''
    el.sampleSubname.textContent = ''
  }
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
        renderSampleDialect(lang, candidate.name, tagDialects ? country : null),
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
    el.sampleNextName.textContent = next.name
    el.sampleNext.setAttribute('aria-label', `Next match: ${next.name}, ${formatPercent(next.percent)}`)
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
  item.querySelector('.dialect-name').textContent = shortName(language, groupName)
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

el.sampleBack.addEventListener('click', showRankings)
el.sampleAll.addEventListener('click', showRankings)
el.samplePrev.addEventListener('click', () => showSample(state.sampleIndex - 1))
el.sampleNext.addEventListener('click', () => showSample(state.sampleIndex + 1))

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

/** "This is my language": save the choice, then show what's there for it. */
function choose(language, candidate) {
  stopSample()
  const session = state.session
  const choice = {
    sessionId: session?.id ?? null,
    consent: session?.consent ?? null, // with a "yes", the kept recording has the same sessionId
    languageId: language.id,
    languageName: language.name,
    modelLabel: candidate.label,
    modelRank: candidate.rank,
    modelConfidence: candidate.confidence,
    chosenAt: new Date().toISOString(),
  }
  backend.saveChoice(choice).catch((err) => console.error('Saving the choice failed', err))
  showResources(language)
}

function showResources(language) {
  if (language.native) {
    el.resourcesHeading.textContent = language.native
    el.resourcesHeading.lang = language.iso ?? ''
    el.resourcesSubname.textContent = language.name
  } else {
    el.resourcesHeading.textContent = language.name
    el.resourcesHeading.lang = ''
    el.resourcesSubname.textContent = ''
  }
  el.resourcesList.replaceChildren(...resourceLinks(language, config.resources).map(renderResource))
  setPhase('resources')
  window.scrollTo(0, 0)
  focusHeading(el.resourcesHeading)
}

function renderResource(link) {
  const item = el.resourceTemplate.content.firstElementChild.cloneNode(true)
  item.querySelector('.resource-link').href = link.url
  item.querySelector('.resource-initial').textContent = link.title.charAt(0)
  item.querySelector('.resource-title').textContent = link.title
  item.querySelector('.resource-domain').textContent = link.domain
  item.querySelector('.resource-qr-domain').textContent = link.domain
  const qr = item.querySelector('.qr')
  qr.innerHTML = qrSvg(link.url) // built from the URL by qr.js, not from page content
  qr.setAttribute('aria-label', `QR code for ${link.url}`)
  return item
}

el.resourcesAll.addEventListener('click', showRankings)
el.resourcesRestart.addEventListener('click', reset)

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
console.info(`Language ID: using the ${backend.name} backend`)

// ---------------------------------------------------- test playback (testing only)

function showTestPlayback(recording, seconds) {
  if (!config.showTestPlayback) return
  clearTestPlayback()
  // A temporary browser-only address for the recording; nothing is uploaded.
  state.playbackUrl = URL.createObjectURL(recording)
  el.testPlaybackAudio.src = state.playbackUrl
  el.testPlaybackInfo.textContent = `(${seconds.toFixed(1)} s, ${Math.round(recording.size / 1024)} KB, ${recording.type})`
}

function clearTestPlayback() {
  el.testPlaybackAudio.pause()
  el.testPlaybackAudio.removeAttribute('src')
  el.testPlaybackInfo.textContent = ''
  if (state.playbackUrl) URL.revokeObjectURL(state.playbackUrl)
  state.playbackUrl = null
}
