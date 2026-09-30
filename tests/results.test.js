import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  filterCandidates,
  firstPage,
  indexLanguages,
  isInCountry,
  summarize,
  toCandidates,
} from '../js/results.js'

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

// A tiny catalog: a parent language with one variety, plus two others.
const LANGUAGES = [
  { id: 100, name: 'Tzotzil', iso: 'tzo', countries: ['MX'] },
  { id: 101, name: 'Tzotzil: Chamula', iso: 'tzo', parent: 100 },
  { id: 200, name: 'Mam', iso: 'mam', countries: ['GT'] },
  { id: 300, name: 'Quiet', iso: 'qqq', noSample: true, countries: ['MX'] },
]
const index = indexLanguages(LANGUAGES)
const response = {
  duration: 5,
  predictions: [
    { id: 101, probability: 0.6, iso: 'tzo' },
    { id: 200, probability: 0.25, iso: 'mam' },
    { id: 0, probability: 0.1, iso: 'zxx' },
    { id: 300, probability: 0.05, iso: 'qqq' },
  ],
}

describe('toCandidates', () => {
  const candidates = toCandidates(response, index)

  it('keeps the model order and numbers it', () => {
    assert.deepEqual(
      candidates.map((c) => [c.rank, c.id]),
      [
        [1, 101],
        [2, 200],
        [3, 0],
        [4, 300],
      ],
    )
  })

  it('adds the name, confidence and links', () => {
    assert.deepEqual(candidates[0], {
      rank: 1,
      id: 101,
      name: 'Tzotzil: Chamula',
      iso: 'tzo',
      confidence: 0.6,
      percent: 60,
      sampleUrl: 'https://media.globalrecordings.net/GOKit_MP3/sample-101.mp3',
      contentUrl: 'https://5fish.mobi/101',
      countries: [],
      parentCountries: ['MX'],
      known: true,
    })
  })

  it('marks IDs the catalog lacks as unknown, keeping the model ISO code', () => {
    assert.equal(candidates[2].known, false)
    assert.equal(candidates[2].name, null)
    assert.equal(candidates[2].iso, 'zxx')
  })

  it('has no sample URL when the catalog says there is no sample', () => {
    assert.equal(candidates[3].sampleUrl, null)
  })

  it('rounds percent to one decimal', () => {
    const [c] = toCandidates({ predictions: [{ id: 100, probability: 0.00114 }] }, index)
    assert.equal(c.percent, 0.1)
  })

  it('treats a response without predictions as empty', () => {
    assert.deepEqual(toCandidates({}, index), [])
    assert.deepEqual(toCandidates(null, index), [])
  })
})

describe('isInCountry', () => {
  const [chamula, mam] = toCandidates(response, index)

  it('counts a variety as local where its parent is listed', () => {
    assert.equal(isInCountry(chamula, 'MX'), true)
    assert.equal(isInCountry(chamula, 'GT'), false)
  })

  it('checks the language’s own countries', () => {
    assert.equal(isInCountry(mam, 'GT'), true)
  })

  it('is false without a country', () => {
    assert.equal(isInCountry(mam, null), false)
  })
})

describe('filterCandidates', () => {
  const candidates = toCandidates(response, index)
  const ids = (rows) => rows.map((c) => c.id)

  it('"all" shows every known language, dropping unknown IDs', () => {
    assert.deepEqual(ids(filterCandidates(candidates)), [101, 200, 300])
  })

  it('"local" keeps only languages listed for the country', () => {
    assert.deepEqual(ids(filterCandidates(candidates, { scope: 'local', country: 'MX' })), [101, 300])
    assert.deepEqual(ids(filterCandidates(candidates, { scope: 'local', country: 'GT' })), [200])
  })

  it('"local" without a country shows nothing', () => {
    assert.deepEqual(filterCandidates(candidates, { scope: 'local' }), [])
  })

  it('drops candidates below the minimum confidence', () => {
    assert.deepEqual(ids(filterCandidates(candidates, { minConfidence: 0.2 })), [101, 200])
  })

  it('keeps the model rank after filtering', () => {
    const rows = filterCandidates(candidates, { scope: 'local', country: 'GT' })
    assert.equal(rows[0].rank, 2)
  })
})

describe('firstPage and summarize', () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: i, known: true }))

  it('shows the first page and says whether there are more', () => {
    assert.equal(firstPage(rows, 10).rows.length, 10)
    assert.equal(firstPage(rows, 10).hasMore, true)
    assert.equal(firstPage(rows, 30).hasMore, false)
  })

  it('counts totals for the summary line', () => {
    const candidates = toCandidates(response, index)
    const visible = filterCandidates(candidates)
    assert.deepEqual(summarize(candidates, visible, 10), { total: 4, unknown: 1, matching: 3, shown: 3 })
  })
})

describe('with the real data files', () => {
  const languages = indexLanguages(readJson('../data/languages.json'))
  const sample = readJson('../data/sample-model-response.json')
  const candidates = toCandidates(sample, languages)

  it('names every sample prediction except "no speech"', () => {
    assert.deepEqual(
      candidates.filter((c) => !c.known).map((c) => c.id),
      [0],
    )
  })

  it('shows Mexican languages near Mexico and Guatemalan ones near Guatemala', () => {
    const mx = filterCandidates(candidates, { scope: 'local', country: 'MX' })
    const gt = filterCandidates(candidates, { scope: 'local', country: 'GT' })
    assert.ok(mx.some((c) => c.name.startsWith('Tzotzil')))
    assert.ok(!mx.some((c) => c.name.startsWith('Mam')))
    assert.ok(gt.some((c) => c.name.startsWith('Mam')))
  })
})
