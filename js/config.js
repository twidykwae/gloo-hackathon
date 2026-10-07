export const config = {
  // 'http': the real model server at the URLs below.
  // 'mock': fake server, returns mockResponse after a delay; no server needed.
  // Override for one visit by adding ?backend=mock or ?backend=http to the page URL.
  backend: 'http',

  // Where recordings are sent for identification: the server in server/,
  // which also serves this page. Returns every guess, best first.
  identifyUrl: '/predict',

  // Where "Play sample" gets a language's recording; {id} is the GRN language
  // ID. The server in server/ downloads each one once and keeps it. Without
  // that server (mock mode on a plain file server), use GRN directly:
  // 'https://media.globalrecordings.net/GOKit_MP3/sample-{id}.mp3'
  sampleUrl: '/samples/{id}.mp3',

  // Where consent answers and kept recordings go.
  consentUrl: null,
  recordingUrl: null,

  // For testing: a player for the last recording, below the results. Turn this
  // off before real users see the page.
  showTestPlayback: true,

  minRecordingSeconds: 2, // shorter recordings aren't sent
  maxRecordingSeconds: 20,
  pageSize: 10,
  mockDelayMs: 2500,
  // Real responses saved from the model server; see data/samples/.
  mockResponse: 'data/samples/mms-english.json',
}
