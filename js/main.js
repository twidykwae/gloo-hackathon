// Wires the page together. The flow, all on one URL:
//
//   idle --tap--> recording --tap or time limit--> consent popup
//     (the recording is sent for identification the moment recording stops,
//      so the model works while the person answers the consent question)
//   consent answered --> waiting (spinner, only if results aren't back yet) --> results
//
// <body data-phase="..."> always shows the current phase, for styling.

import { createBackend } from './backend.js'
import { config } from './config.js'
import { detectCountry } from './location.js'
import { stopPlayback, toggle } from './player.js'
import { startRecording } from './recorder.js'
import { filterCandidates, firstPage, indexLanguages, isInCountry, summarize, toCandidates } from './results.js'

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
}

const backend = createBackend(config)
// Name, ISO code, sample flag and countries for every GRN language (tools/build_data.py).
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
  shown: config.pageSize,
  location: null, // { code, name } once the "Near me" filter has found it
}

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
}

function showError(message) {
  el.errorMessage.textContent = message
  setPhase('error')
}

function reset() {
  stopPlayback()
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
  const recording = await recorder.stop()

  const session = { id: crypto.randomUUID(), recording, seconds: state.seconds, consent: null }
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
  renderResults()
  setPhase('results')
}

function renderResults() {
  stopPlayback()
  const country = state.location?.code ?? null
  const visible = filterCandidates(state.candidates, { ...state.filters, country })
  const page = firstPage(visible, state.shown)

  el.list.replaceChildren(...page.rows.map((c) => renderRow(c, country)))
  el.empty.hidden = visible.length > 0
  el.showMore.hidden = !page.hasMore

  const s = summarize(state.candidates, visible, state.shown)
  el.summary.textContent =
    `Showing ${s.shown} of ${s.matching} ${s.matching === 1 ? 'language' : 'languages'}` +
    (s.unknown === 1
      ? " (1 model result isn't in the 5fish catalog)"
      : s.unknown > 1
        ? ` (${s.unknown} model results aren't in the 5fish catalog)`
        : '')
}

function renderRow(candidate, country) {
  const row = el.rowTemplate.content.firstElementChild.cloneNode(true)
  const part = (name) => row.querySelector(`.result-${name}`)
  row.dataset.id = String(candidate.id)
  part('rank').textContent = String(candidate.rank)
  part('name').textContent = candidate.name
  part('iso').textContent = candidate.iso ?? ''
  part('confidence').textContent = `${candidate.percent}%`
  part('local').hidden = !(country && isInCountry(candidate, country))

  const play = part('play')
  if (candidate.sampleUrl) {
    play.addEventListener('click', () => toggle(play, candidate.sampleUrl))
  } else {
    play.disabled = true
    play.dataset.unavailable = 'true'
    play.textContent = 'No sample'
  }
  return row
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
  if (e.target.name === 'scope') {
    if (e.target.value === 'local' && !(await useLocation())) {
      el.filters.elements.scope.value = 'all'
      return
    }
    state.filters.scope = e.target.value
  } else if (e.target === el.minConfidence) {
    state.filters.minConfidence = Number(el.minConfidence.value)
  }
  state.shown = config.pageSize
  renderResults()
})
el.filters.addEventListener('submit', (e) => e.preventDefault())

el.showMore.addEventListener('click', () => {
  state.shown += config.pageSize
  renderResults()
})
el.recordAgain.addEventListener('click', reset)
el.errorRetry.addEventListener('click', reset)

setPhase('idle')
console.info(`Language ID: using the ${backend.name} backend`)
