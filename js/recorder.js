const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']


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
  const startedAt = performance.now()
  return {
    stop() {
      stopped ??= new Promise((resolve) => {
        recorder.onstop = () => {
          release()
          resolve({
            blob: new Blob(chunks, { type: recorder.mimeType }),
            seconds: (performance.now() - startedAt) / 1000,
          })
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
