// Everything that talks to a server goes through here, so the rest of the
// page doesn't change when the team picks the model server and storage.
//
//   identify(recording)            -> raw model response (see js/results.js for the format)
//   saveConsent(answer)            -> records the yes/no answer
//   saveRecording(recording, meta) -> keeps the audio for training (only after a "yes")

export function createBackend(config) {
  const mode = new URLSearchParams(location.search).get('backend') ?? config.backend
  return mode === 'http' ? httpBackend(config) : mockBackend(config)
}

/** Stand-in server: sample data after a delay; answers and recordings kept in memory. */
function mockBackend(config) {
  const saved = { consents: [], recordings: [] }
  // Inspect from the browser console: window.mockServer.consents
  window.mockServer = saved
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  return {
    name: 'mock',
    async identify(recording) {
      await wait(config.mockDelayMs)
      const response = await fetch('data/sample-model-response.json')
      if (!response.ok) throw new Error(`Could not load sample data: ${response.status}`)
      console.info('[mock] identified a %s recording (%d bytes)', recording.type, recording.size)
      return response.json()
    },
    async saveConsent(answer) {
      saved.consents.push(answer)
      console.info('[mock] consent saved', answer)
    },
    async saveRecording(recording, meta) {
      saved.recordings.push({ recording, meta })
      console.info('[mock] recording kept for training', meta)
    },
  }
}

function httpBackend(config) {
  async function post(url, body) {
    const response = await fetch(url, { method: 'POST', body })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`${url} returned ${response.status} ${detail.slice(0, 200)}`)
    }
    return response
  }
  const extension = (type) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm')

  return {
    name: 'http',
    async identify(recording) {
      const form = new FormData()
      form.append('file', recording, `recording.${extension(recording.type)}`)
      return (await post(config.identifyUrl, form)).json()
    },
    async saveConsent(answer) {
      if (!config.consentUrl) return console.warn('consentUrl not set; consent answer not saved', answer)
      await post(config.consentUrl, new Blob([JSON.stringify(answer)], { type: 'application/json' }))
    },
    async saveRecording(recording, meta) {
      if (!config.recordingUrl) return console.warn('recordingUrl not set; recording not kept', meta)
      const form = new FormData()
      form.append('file', recording, `${meta.sessionId}.${extension(recording.type)}`)
      form.append('meta', JSON.stringify(meta))
      await post(config.recordingUrl, form)
    },
  }
}
