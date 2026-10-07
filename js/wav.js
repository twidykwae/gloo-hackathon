// Convert a browser recording to the 16 kHz mono WAV the model server reads.
//
// Browsers record compressed audio (WebM on Chrome/Edge/Firefox/Android, MP4
// on Safari). Converting here means the server needs no ffmpeg, and every
// browser sends the same format. 16 kHz is what Meta's model was trained on.

export const MODEL_SAMPLE_RATE = 16000

/** Decode any recording the browser can play and return a 16 kHz mono WAV blob. */
export async function toWav(recording, sampleRate = MODEL_SAMPLE_RATE) {
  // decodeAudioData on an OfflineAudioContext resamples to that context's rate.
  const context = new OfflineAudioContext(1, 1, sampleRate)
  let audio
  try {
    audio = await context.decodeAudioData(await recording.arrayBuffer())
  } catch (err) {
    // The browser's own message ("Unable to decode audio data") doesn't say what to do.
    throw new Error('The recording could not be read. Please speak again, for a few seconds.', {
      cause: err,
    })
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  return new Blob([encodeWav(downmix(channels), audio.sampleRate)], { type: 'audio/wav' })
}

/** Average several channels into one. */
export function downmix(channels) {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length
  }
  return out
}

/** Encode mono samples in [-1, 1] as a 16-bit PCM WAV file. */
export function encodeWav(samples, sampleRate) {
  const dataSize = samples.length * 2
  const view = new DataView(new ArrayBuffer(44 + dataSize))
  const text = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))

  text(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // size of this "fmt " section
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per sample
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return view.buffer
}
