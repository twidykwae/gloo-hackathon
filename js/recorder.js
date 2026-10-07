const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']


export async function startRecording({ maxSeconds = 20, onTick, onLimit, onLevel } = {}) {
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
  const stopLevels = onLevel ? watchLevel(stream, onLevel) : () => {}

  const release = () => {
    clearInterval(ticker)
    stopLevels()
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

/**
 * Calls onLevel with how loud the microphone is, 0 (silence) to 1 (loud
 * speech), about 12 times a second. Only for show: if the browser can't
 * measure it, recording works the same without it. Returns a stop function.
 */
function watchLevel(stream, onLevel) {
  let context
  try {
    context = new AudioContext()
    context.resume().catch(() => {})
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      const rms = Math.sqrt(sum / samples.length)
      // Speech is roughly 0.02 to 0.2 RMS; the square root spreads that out.
      onLevel(Math.min(1, Math.sqrt(rms) * 2.5))
    }, 80)
    return () => {
      clearInterval(timer)
      context.close().catch(() => {})
    }
  } catch {
    context?.close().catch(() => {})
    return () => {}
  }
}
