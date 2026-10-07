// QR codes for links, drawn as SVG. The encoder is qrcode-generator
// (MIT, Kazuhiko Arase), copied into js/vendor/ so it works offline.
import qrcode from './vendor/qrcode.mjs'

/**
 * An <svg> string for a QR code of `text`, one unit per module, with a
 * `margin`-module quiet zone. Dark modules are drawn in currentColor; give it
 * a light background, since scanners need light around the code.
 */
export function qrSvg(text, { margin = 2, level = 'M' } = {}) {
  const qr = qrcode(0, level) // 0: the smallest size that fits
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`
    }
  }
  const size = count + margin * 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<path fill="currentColor" d="${path}"/></svg>`
  )
}
