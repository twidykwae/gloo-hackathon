export const config = {
  // 'mock': fake server, returns data/sample-model-response.json after a delay.
  // 'http': real server at the URLs below.
  // Override for one visit by adding ?backend=http or ?backend=mock to the page URL.
  backend: 'mock',

  // Where recordings are sent for identification. This default is LAMP's
  // serve.py (lid_finetune/scripts/model/serve.py) on port 8001; it expects the
  // audio in a form field named "file".
  identifyUrl: 'http://127.0.0.1:8001/predict?top_k=50',
  
  // Where consent answers and kept recordings go.
  consentUrl: null,
  recordingUrl: null,

  maxRecordingSeconds: 20,
  pageSize: 10,
  mockDelayMs: 2500,
}
