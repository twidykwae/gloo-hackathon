import { createBackend } from './backend.js'
import { config } from './config.js'
import { detectCountry } from './location.js'
import { startRecording } from './recorder.js'
import {
  filterCandidates,
  firstPage,
  formatPercent,
  indexLanguages,
  isInCountry,
  sliderToConfidence,
  summarize,
  toCandidates,
  topConfidence,
} from './results.js'

const $ = (id) => document.getElementById(id)
const el = {
  recordView: $('record-view'),
  recordButton: $('record-button'),
  recordTimer: $('record-timer'),
  recordSeconds: $('record-seconds'),
  loading: $('loading'),
  resultsView: $('results-view'),
  filters: $('results-filters'),
  minConfidence: $('min-confidence'),
  minConfidenceValue: $('min-confidence-value'),
  locationStatus: $('location-status'),
  summary: $('results-summary'),
  list: $('results-list'),
  empty: $('results-empty'),
  showMore: $('show-more'),
  recordAgain: $('record-again'),
  errorView: $('error-view'),
  errorMessage: $('error-message'),
  errorRetry: $('error-retry'),
  consentDialog: $('consent-dialog'),
  consentYes: $('consent-yes'),
  consentNo: $('consent-no'),
  rowTemplate: $('result-row'),
  languageTemplate: $('language-row'),
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
  recorder: null,
  seconds: 0,
  // One recording and everything about it: { id, recording, seconds, consent, results }
  session: null,
  candidates: [],
  filters: { scope: 'all', minConfidence: 0 },
  topConfidence: 0, // the best guess's score, the confidence slider's upper end
  shown: config.pageSize,
  location: null, // { code, name } once the "Near me" filter has found it
  playbackUrl: null, // the last recording, when showTestPlayback is on
  sampleButton: null, // the "Play sample" button whose sample is playing
}

// One player for language samples, so only one plays at a time.
const samplePlayer = new Audio()

// ------------------------------------------------------------------ phases

const VIEW_FOR_PHASE = {
  idle: 'recordView',
  recording: 'recordView',
  consent: 'recordView', // stays behind the consent popup
  waiting: 'loading',
  results: 'resultsView',
  error: 'errorView',
}

function setPhase(phase) {
  state.phase = phase
  document.body.dataset.phase = phase
  for (const view of new Set(Object.values(VIEW_FOR_PHASE))) {
    el[view].hidden = VIEW_FOR_PHASE[phase] !== view
  }
  const recording = phase === 'recording'
  el.recordButton.dataset.recording = String(recording)
  el.recordButton.textContent = recording ? 'Stop recording' : 'Start recording'
  el.recordButton.disabled = phase === 'consent'
  el.recordTimer.hidden = !recording
  el.testPlayback.hidden = !(state.playbackUrl && ['waiting', 'results', 'error'].includes(phase))
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
  state.session = null
  state.candidates = []
  state.shown = config.pageSize
  setPhase('idle')
}

// --------------------------------------------------------------- recording

async function beginRecording() {
  try {
    state.recorder = await startRecording({
      maxSeconds: config.maxRecordingSeconds,
      onTick: (seconds) => {
        state.seconds = seconds
        el.recordSeconds.textContent = String(seconds)
      },
      onLimit: finishRecording,
    })
  } catch (err) {
    showError(
      err.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow the microphone for this page, then try again.'
        : `Could not start recording: ${err.message}`,
    )
    return
  }
  state.seconds = 0
  el.recordSeconds.textContent = '0'
  setPhase('recording')
}

async function finishRecording() {
  if (state.phase !== 'recording') return // the button and the time limit can both fire
  setPhase('consent')
  const recorder = state.recorder
  state.recorder = null
  const { blob: recording, seconds } = await recorder.stop()
  showTestPlayback(recording, seconds) // before the length check, so short ones can be heard too

  // A very short recording holds little or no audio: under about 0.3 s the
  // browser can't even read it back, and the model needs a few seconds of speech.
  if (seconds < config.minRecordingSeconds) {
    showError(
      `That recording was only ${seconds.toFixed(1)} seconds long. ` +
        `Speak for at least ${config.minRecordingSeconds} seconds, then tap Stop.`,
    )
    return
  }

  const session = { id: crypto.randomUUID(), recording, seconds: Math.round(seconds * 10) / 10, consent: null }
  // Send for identification right away; the consent question covers the wait.
  session.results = Promise.all([backend.identify(recording), languagesReady]).then(([raw, languages]) => {
    console.info('Raw model response', raw)
    return toCandidates(raw, languages)
  })
  session.results.catch(() => {}) // reported in showResultsWhenReady
  state.session = session
  el.consentDialog.showModal()
}

el.recordButton.addEventListener('click', () => {
  if (state.phase === 'idle') beginRecording()
  else if (state.phase === 'recording') finishRecording()
})

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
  state.candidates = candidates
  state.shown = config.pageSize
  // Each recording gets its own slider range, starting at "Any".
  state.topConfidence = topConfidence(candidates)
  el.minConfidence.value = '0'
  setMinConfidence(0)
  renderResults()
  setPhase('results')
}

function visibleCandidates() {
  return filterCandidates(state.candidates, { ...state.filters, country: state.location?.code ?? null })
}

function renderResults() {
  const country = state.location?.code ?? null
  const visible = visibleCandidates()
  const page = firstPage(visible, state.shown)
  stopSample() // its button is about to be replaced

  // Guesses whose "varieties" list was open stay open after rebuilding.
  const open = new Set(
    [...el.list.querySelectorAll('li.result')]
      .filter((row) => row.querySelector('.result-varieties')?.open)
      .map((row) => row.dataset.label),
  )
  el.list.replaceChildren(...page.rows.map((c) => renderRow(c, country)))
  for (const row of el.list.querySelectorAll('li.result')) {
    const varieties = row.querySelector('.result-varieties')
    if (varieties && open.has(row.dataset.label)) varieties.open = true
  }
  el.empty.hidden = visible.length > 0
  el.showMore.hidden = !page.hasMore
  updateSummary(visible)
}

function updateSummary(visible) {
  const s = summarize(state.candidates, visible, state.shown)
  const count = (n) => n.toLocaleString()
  el.summary.textContent = `Showing ${count(s.shown)} of ${count(s.matching)} ${s.matching === 1 ? 'result' : 'results'}`
}

function renderRow(candidate, country) {
  const row = el.rowTemplate.content.firstElementChild.cloneNode(true)
  const part = (name) => row.querySelector(`.result-${name}`)
  const [only] = candidate.languages
  // One language (for example a heading with a single variety): a plain row
  // with its "Play sample" button, and no varieties list.
  const single = candidate.languages.length === 1

  row.dataset.label = candidate.label
  row.dataset.count = String(candidate.languages.length)
  row.dataset.rank = String(candidate.rank)
  part('name').textContent = candidate.name
  part('iso').textContent = single ? (only.iso ?? '') : candidate.label
  part('confidence').textContent = formatPercent(candidate.percent)
  part('local').hidden = !candidate.languages.some((lang) => isInCountry(lang, country))

  if (single) {
    row.dataset.id = String(only.id)
    if (!only.hasSample) markSampleMissing(part('play'), 'No sample')
    part('varieties').remove()
  } else {
    part('play').remove()
    part('variety-count').textContent = String(candidate.languages.length)
    part('languages').replaceChildren(...candidate.languages.map((lang) => renderLanguage(lang, country)))
  }
  return row
}

function renderLanguage(language, country) {
  const item = el.languageTemplate.content.firstElementChild.cloneNode(true)
  item.dataset.id = String(language.id)
  item.querySelector('.language-name').textContent = language.name
  item.querySelector('.language-local').hidden = !isInCountry(language, country)
  if (!language.hasSample) markSampleMissing(item.querySelector('.language-play'), 'No sample')
  return item
}

async function useLocation() {
  if (state.location) return true
  el.locationStatus.textContent = 'Finding your location…'
  try {
    const found = await detectCountry()
    if (!found.code) throw new Error('Your location is not inside a known country')
    state.location = found
    el.locationStatus.textContent = `Near me: ${found.name}`
    return true
  } catch (err) {
    el.locationStatus.textContent = `Could not use your location: ${err.message}`
    return false
  }
}

el.filters.addEventListener('change', async (e) => {
  if (e.target.name !== 'scope') return
  if (e.target.value === 'local' && !(await useLocation())) {
    el.filters.elements.scope.value = 'all'
    return
  }
  state.filters.scope = e.target.value
  state.shown = config.pageSize
  renderResults()
})

function setMinConfidence(confidence) {
  state.filters.minConfidence = confidence
  el.minConfidenceValue.textContent = confidence ? `${formatPercent(confidence * 100)} or more` : 'Any'
}

// While dragging, only the value and the count update; rebuilding the list on
// every step made the page jump. The list is rebuilt when the slider is let go.
el.minConfidence.addEventListener('input', () => {
  setMinConfidence(sliderToConfidence(Number(el.minConfidence.value), state.topConfidence))
  state.shown = config.pageSize
  updateSummary(visibleCandidates())
})
el.minConfidence.addEventListener('change', renderResults)
el.filters.addEventListener('submit', (e) => e.preventDefault())

// ------------------------------------------------------------ sample playback

function markSampleMissing(button, text) {
  button.disabled = true
  button.dataset.sample = 'missing'
  button.textContent = text
}

function setSampleButton(button, playing) {
  button.dataset.playing = String(playing)
  button.textContent = playing ? 'Stop sample' : 'Play sample'
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

el.list.addEventListener('click', (e) => {
  const button = e.target.closest('.result-play, .language-play')
  if (button && !button.disabled) playSample(button)
})
samplePlayer.addEventListener('ended', stopSample)
// No sample on GRN (404) or GRN unreachable (502): the server answers with an error, not audio.
samplePlayer.addEventListener('error', () => {
  const button = state.sampleButton
  if (!button || !samplePlayer.getAttribute('src')) return // from stopSample clearing the source
  state.sampleButton = null
  markSampleMissing(button, 'Sample unavailable')
  console.warn('Could not play the sample', samplePlayer.src, samplePlayer.error)
})

el.showMore.addEventListener('click', () => {
  state.shown += config.pageSize
  renderResults()
})
el.recordAgain.addEventListener('click', reset)
el.errorRetry.addEventListener('click', reset)

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

