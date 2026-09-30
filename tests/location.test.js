import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { countryAt } from '../js/location.js'

const borders = JSON.parse(readFileSync(new URL('../data/countries.geojson', import.meta.url), 'utf8'))
const codeAt = (lat, lon) => countryAt(lat, lon, borders)?.properties.code ?? null

describe('countryAt (with data/countries.geojson)', () => {
  it('finds Mexico and Guatemala, including near their border', () => {
    assert.equal(codeAt(19.43, -99.13), 'MX') // Mexico City
    assert.equal(codeAt(16.74, -92.64), 'MX') // San Cristobal de las Casas, Chiapas
    assert.equal(codeAt(30.56, -115.94), 'MX') // San Quintin Valley, Baja California
    assert.equal(codeAt(14.63, -90.51), 'GT') // Guatemala City
  })

  it('handles countries whose ISO_A2 is missing in the source data', () => {
    assert.equal(codeAt(48.86, 2.35), 'FR') // Paris
  })

  it('respects holes: Lesotho is inside South Africa', () => {
    assert.equal(codeAt(-29.31, 27.48), 'LS') // Maseru
    assert.equal(codeAt(-26.2, 28.05), 'ZA') // Johannesburg
  })

  it('returns null at sea', () => {
    assert.equal(codeAt(0, -140), null)
  })
})
