import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { downmix, encodeWav } from '../js/wav.js'

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit PCM header', () => {
    const view = new DataView(encodeWav(new Float32Array(160), 16000))
    const text = (offset) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4))
    assert.equal(text(0), 'RIFF')
    assert.equal(text(8), 'WAVE')
    assert.equal(view.getUint16(20, true), 1) // PCM
    assert.equal(view.getUint16(22, true), 1) // mono
    assert.equal(view.getUint32(24, true), 16000)
    assert.equal(view.getUint16(34, true), 16)
    assert.equal(view.getUint32(40, true), 320) // 160 samples × 2 bytes
    assert.equal(view.byteLength, 44 + 320)
  })

  it('scales and clips samples', () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2]), 16000))
    const samples = [0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))
    assert.deepEqual(samples, [0, 32767, -32768, 32767, -32768])
  })
})

describe('downmix', () => {
  it('averages channels', () => {
    assert.deepEqual([...downmix([new Float32Array([1, 0]), new Float32Array([0, 1])])], [0.5, 0.5])
  })

  it('passes mono through', () => {
    const mono = new Float32Array([0.25])
    assert.equal(downmix([mono]), mono)
  })
})
