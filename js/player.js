// Plays one language sample at a time.

const audio = new Audio()
let currentButton = null

function setPlaying(button, playing) {
  button.dataset.playing = String(playing)
  button.setAttribute('aria-pressed', String(playing))
}

function stop() {
  audio.pause()
  if (currentButton) setPlaying(currentButton, false)
  currentButton = null
}

audio.addEventListener('ended', stop)
audio.addEventListener('error', () => {
  // About 1 in 7 sample links is broken; mark that button so the design can show it.
  if (currentButton) {
    currentButton.dataset.unavailable = 'true'
    currentButton.disabled = true
  }
  stop()
})

/** Play `url`, or stop if this button is already playing. */
export function toggle(button, url) {
  if (currentButton === button) {
    stop()
    return
  }
  stop()
  currentButton = button
  setPlaying(button, true)
  audio.src = url
  audio.play().catch((err) => {
    if (err.name !== 'AbortError') console.warn('Could not play sample', err)
  })
}

export { stop as stopPlayback }
