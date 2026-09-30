// Microphone recording with MediaRecorder.
//
// The browser picks the format: Chrome, Edge, Firefox and Android record
// WebM/Opus; Safari records MP4/AAC. The blob's `type` says which.

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

/**
 * Start recording. Resolves once the microphone is live.
 *   maxSeconds: stop by itself after this long (onLimit is called)
 *   onTick:     called every second with seconds elapsed
 * Returns { stop(): Promise<Blob>, cancel() }.
 * Rejects if there's no microphone or permission is denied.
 */
export async function startRecording({ maxSeconds = 20, onTick, onLimit } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot record audio (it needs https or localhost)')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  })
  const mimeType = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  let seconds = 0
  const ticker = setInterval(() => {
    seconds += 1
    onTick?.(seconds)
    if (seconds >= maxSeconds) onLimit?.()
  }, 1000)

  const release = () => {
    clearInterval(ticker)
    stream.getTracks().forEach((track) => track.stop())
  }

  let stopped = null
  recorder.start()
  return {
    stop() {
      stopped ??= new Promise((resolve) => {
        recorder.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: recorder.mimeType }))
        }
        recorder.stop()
      })
      return stopped
    },
    cancel() {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}
