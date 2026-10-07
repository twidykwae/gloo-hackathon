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

  // Where what happens to each recording is stored: the server in server/
  // keeps one row per sessionId (server/app/store.py). null stops sending one.
  // The model's guesses, as soon as they're back.
  predictionUrl: '/sessions/prediction',
  // Consent answers, and the audio after a "Yes".
  consentUrl: '/sessions/consent',
  recordingUrl: '/sessions/recording',
  // "This is my language" choices, on reaching Resources. With a kept
  // recording (same sessionId), a choice says which language it is in.
  choiceUrl: '/sessions/choice',
  // "None, enter new dialect" reports: a language or dialect the
  // catalog doesn't have. With a kept recording (same sessionId) it's training
  // data; without one, a lead for the team to follow up.
  dialectUrl: '/sessions/dialect',

  // Links on the last screen, for the chosen language. {id} is its GRN
  // language ID and {name} its name; `button` is the button's label and `logo`
  // the picture above it (optional). Add more here.
  resources: [
    { title: 'Listen to recordings in {name}', button: 'Go to 5fish', logo: 'images/5fish.png', url: 'https://5fish.mobi/{id}' },
  ],
  // The language's Bible on YouVersion (the server's GET /bible/{id}), added
  // after the links above when there is one. null turns it off, for example
  // in mock mode without the server.
  bibleUrl: '/bible/{id}',
  // Gloo AI on the same screen: a short guide note, and a chat for questions
  // (the server's POST /assistant/guide and /assistant/chat). null hides them.
  guideUrl: '/assistant/guide',
  chatUrl: '/assistant/chat',

  minRecordingSeconds: 2, // shorter recordings aren't sent
  maxRecordingSeconds: 20,
  pageSize: 10,
  compareCount: 5, // the Sample screen's dots cover this many top guesses
  // After this many taps on the Sample screen's Next, a check-in asks whether
  // to keep going, speak again or enter a new dialect. 0 turns it off.
  checkInEvery: 4,
  mockDelayMs: 2500,
  // Real responses saved from the model server; see data/samples/.
  mockResponse: 'data/samples/mms-english.json',
}
