import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { qrSvg } from '../js/qr.js'

describe('qrSvg', () => {
  const svg = qrSvg('https://5fish.mobi/20141')

  it('draws the smallest code that fits, with a quiet zone', () => {
    // A 24-character URL at level M needs version 2: 25 modules, plus 2 on each side.
    assert.match(svg, /viewBox="0 0 29 29"/)
  })

  it('starts with a finder pattern in the top-left corner', () => {
    // The finder's top-left module, offset by the quiet zone.
    assert.match(svg, /d="M2 2h1v1h-1z/)
  })

  it('draws in currentColor, so CSS sets the color', () => {
    assert.match(svg, /fill="currentColor"/)
  })

  it('gets bigger for longer text', () => {
    const long = qrSvg(`https://example.org/${'x'.repeat(120)}`)
    const size = Number(long.match(/viewBox="0 0 (\d+)/)[1])
    assert.ok(size > 29)
  })
})
