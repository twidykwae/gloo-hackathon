import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  filterCandidates,
  firstPage,
  formatPercent,
  indexLanguages,
  isInCountry,
  sliderToConfidence,
  summarize,
  toCandidates,
  topConfidence,
} from '../js/results.js'

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

// A tiny catalog: Tzotzil with two varieties, Mam, two Quechua languages
// under the umbrella code "que", and Sindhi with a variety that has no sample.
const LANGUAGES = [
  { id: 100, name: 'Tzotzil', iso: 'tzo', countries: ['MX'] },
  { id: 101, name: 'Tzotzil: Chamula', iso: 'tzo', parent: 100 },
  { id: 102, name: 'Tzotzil: Huixtan', iso: 'tzo', parent: 100, countries: ['MX'] },
  { id: 200, name: 'Mam', iso: 'mam', countries: ['GT', 'MX'] },
  { id: 300, name: 'Quechua, Cusco', iso: 'quz', macro: 'que', countries: ['PE'] },
  { id: 301, name: 'Quechua, Ayacucho', iso: 'quy', macro: 'que', countries: ['PE'] },
  { id: 400, name: 'Sindhi', iso: 'snd' },
  { id: 401, name: 'Charan', iso: 'snd', parent: 400, noSample: true },
]
const index = indexLanguages(LANGUAGES)

// Shaped like the service's POST /predict running Meta's model.
const MMS_RESPONSE = {
  model: 'mms:facebook/mms-lid-4017',
  label_kind: 'iso639_3',
  duration: 5,
  predictions: [
    { label: 'tzo', probability: 0.6 },
    { label: 'mam', probability: 0.25 },
    { label: 'zzz', probability: 0.1 },
    { label: 'que', probability: 0.05 },
  ],
}
const labels = (rows) => rows.map((c) => c.label)
const ids = (languages) => languages.map((lang) => lang.id)

describe('toCandidates with ISO codes (Meta’s model)', () => {
  const [tzo, mam, zzz, que] = toCandidates(MMS_RESPONSE, index)

  it('keeps the model order and numbers it', () => {
    assert.deepEqual(
      toCandidates(MMS_RESPONSE, index).map((c) => [c.rank, c.label]),
      [
        [1, 'tzo'],
        [2, 'mam'],
        [3, 'zzz'],
        [4, 'que'],
      ],
    )
  })

  it('expands a code into every language it covers, shortest name first', () => {
    assert.deepEqual(ids(tzo.languages), [100, 101, 102])
  })

  it('names the guess after the language its varieties belong to', () => {
    assert.equal(tzo.name, 'Tzotzil')
    const [snd] = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'snd', probability: 1 }] }, index)
    assert.equal(snd.name, 'Sindhi') // not the shorter variety name "Charan"
  })

  it('names a guess with no common parent after its shortest name', () => {
    assert.equal(que.name, 'Quechua, Cusco')
  })

  it('fills in each language’s links and countries', () => {
    assert.deepEqual(tzo.languages[1], {
      id: 101,
      name: 'Tzotzil: Chamula',
      iso: 'tzo',
      contentUrl: 'https://5fish.mobi/101',
      hasSample: true,
      countries: [],
      parentCountries: ['MX'],
    })
  })

  it('marks languages without a sample recording', () => {
    const [snd] = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'snd', probability: 1 }] }, index)
    assert.deepEqual(
      snd.languages.map((lang) => [lang.name, lang.hasSample]),
      [
        ['Charan', false],
        ['Sindhi', true],
      ],
    )
  })

  it('keeps the confidence and a rounded percent', () => {
    assert.equal(mam.confidence, 0.25)
    assert.equal(mam.percent, 25)
  })

  it('maps an umbrella code to its member languages', () => {
    assert.deepEqual(ids(que.languages), [300, 301]) // shortest name first
  })

  it('marks codes the catalog lacks as unknown', () => {
    assert.equal(zzz.known, false)
    assert.deepEqual(zzz.languages, [])
    assert.equal(zzz.name, null)
  })

  it('treats a response without predictions as empty', () => {
    assert.deepEqual(toCandidates({}, index), [])
    assert.deepEqual(toCandidates(null, index), [])
  })
})

describe('toCandidates with GRN IDs (LAMP)', () => {
  it('reads label_kind "grn_language_id": one language per guess', () => {
    const [c] = toCandidates({ label_kind: 'grn_language_id', predictions: [{ label: '101', probability: 0.4 }] }, index)
    assert.equal(c.name, 'Tzotzil: Chamula')
    assert.deepEqual(ids(c.languages), [101])
  })

  it('reads LAMP serve.py’s own format, predictions with `id`', () => {
    const [c] = toCandidates({ predictions: [{ id: 200, probability: 0.4, iso: 'mam' }] }, index)
    assert.equal(c.label, '200')
    assert.deepEqual(ids(c.languages), [200])
  })
})

describe('formatPercent', () => {
  it('uses enough digits to tell low scores apart', () => {
    assert.equal(formatPercent(50.46), '50%')
    assert.equal(formatPercent(5.86), '5.9%')
    assert.equal(formatPercent(0.14), '0.14%')
  })
})

describe('isInCountry', () => {
  const [tzo] = toCandidates(MMS_RESPONSE, index)

  it('counts a variety as local where its parent is listed', () => {
    assert.equal(isInCountry(tzo.languages[1], 'MX'), true)
    assert.equal(isInCountry(tzo.languages[1], 'GT'), false)
  })

  it('is false without a country', () => {
    assert.equal(isInCountry(tzo.languages[0], null), false)
  })
})

describe('filterCandidates', () => {
  const candidates = toCandidates(MMS_RESPONSE, index)

  it('"all" shows every known guess, dropping unknown codes', () => {
    assert.deepEqual(labels(filterCandidates(candidates)), ['tzo', 'mam', 'que'])
  })

  it('"local" keeps guesses with a language listed for the country', () => {
    assert.deepEqual(labels(filterCandidates(candidates, { scope: 'local', country: 'GT' })), ['mam'])
    assert.deepEqual(labels(filterCandidates(candidates, { scope: 'local', country: 'PE' })), ['que'])
  })

  it('"local" lists varieties listed for the country before ones local through their parent', () => {
    const [tzo] = filterCandidates(candidates, { scope: 'local', country: 'MX' })
    assert.deepEqual(ids(tzo.languages), [100, 102, 101])
  })

  it('"local" drops a guess’s languages from other countries', () => {
    const tzo = { ...candidates[0], languages: [...candidates[0].languages, { ...candidates[1].languages[0], countries: ['GT'] }] }
    const [filtered] = filterCandidates([tzo], { scope: 'local', country: 'MX' })
    assert.deepEqual(ids(filtered.languages), [100, 102, 101])
  })

  it('"local" without a country shows nothing', () => {
    assert.deepEqual(filterCandidates(candidates, { scope: 'local' }), [])
  })

  it('drops guesses below the minimum confidence', () => {
    assert.deepEqual(labels(filterCandidates(candidates, { minConfidence: 0.2 })), ['tzo', 'mam'])
  })

  it('keeps the model rank after filtering', () => {
    assert.equal(filterCandidates(candidates, { scope: 'local', country: 'PE' })[0].rank, 4)
  })

  it('does not change the guesses it was given', () => {
    filterCandidates(candidates, { scope: 'local', country: 'MX' })
    assert.equal(candidates[0].languages[0].id, 100)
    assert.equal(candidates[0].languages.length, 3)
  })
})

describe('the confidence slider', () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≈ ${expected}`)

  it('topConfidence is the best known guess’s score', () => {
    const candidates = toCandidates(MMS_RESPONSE, index)
    assert.equal(topConfidence(candidates), 0.6)
    // An unknown label scoring higher doesn't count.
    const unknownFirst = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'zzz', probability: 0.9 }, ...MMS_RESPONSE.predictions] }, index)
    assert.equal(topConfidence(unknownFirst), 0.6)
    assert.equal(topConfidence([]), 0)
  })

  it('position 0 means no minimum', () => {
    assert.equal(sliderToConfidence(0, 0.5), 0)
  })

  it('the far end is the top score itself', () => {
    assert.equal(sliderToConfidence(100, 0.5), 0.5)
    assert.equal(sliderToConfidence(150, 0.5), 0.5) // clamped
  })

  it('positions in between are logarithmic, over three powers of ten below the top', () => {
    close(sliderToConfidence(1, 0.5), 0.5 * 10 ** -2.97)
    close(sliderToConfidence(50, 0.5), 0.5 * 10 ** -1.5)
    close(sliderToConfidence(67, 0.5), 0.5 * 10 ** -0.99)
  })

  it('adapts to low scores the same way', () => {
    close(sliderToConfidence(100, 0.007), 0.007)
    close(sliderToConfidence(50, 0.007), 0.007 * 10 ** -1.5)
  })

  it('is 0 when there are no scores', () => {
    assert.equal(sliderToConfidence(50, 0), 0)
  })
})

describe('firstPage and summarize', () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ label: String(i), known: true }))

  it('shows the first page and says whether there are more', () => {
    assert.equal(firstPage(rows, 10).rows.length, 10)
    assert.equal(firstPage(rows, 10).hasMore, true)
    assert.equal(firstPage(rows, 30).hasMore, false)
  })

  it('counts totals for the summary line', () => {
    const candidates = toCandidates(MMS_RESPONSE, index)
    const visible = filterCandidates(candidates)
    assert.deepEqual(summarize(candidates, visible, 10), { total: 4, unknown: 1, matching: 3, shown: 3 })
  })
})

describe('with real model responses (data/samples/)', () => {
  const languages = indexLanguages(readJson('../data/languages.json'))
  const load = (name) => toCandidates(readJson(`../data/samples/${name}`), languages)

  it('English clip: top guess is English, with all its varieties', () => {
    const [top] = load('mms-english.json')
    assert.equal(top.label, 'eng')
    assert.equal(top.name, 'English')
    assert.ok(top.languages.length > 10)
    assert.ok(top.confidence > 0.4)
  })

  it('English clip near the US: English: USA is listed early among the varieties', () => {
    const [top] = filterCandidates(load('mms-english.json'), { scope: 'local', country: 'US' })
    assert.ok(top.languages.slice(0, 3).some((lang) => lang.name === 'English: USA'))
  })

  it('Tsimshian clip: ranked deep overall, but on the first page near Canada', () => {
    const all = load('mms-tsimshian.json')
    const tsi = all.find((c) => c.label === 'tsi')
    assert.ok(tsi.rank > 40)
    const nearCanada = filterCandidates(all, { scope: 'local', country: 'CA' })
    assert.ok(nearCanada.findIndex((c) => c.label === 'tsi') < 10)
  })

  it('the confidence slider narrows both a confident and a spread-out result down to the top guess', () => {
    for (const name of ['mms-english.json', 'mms-tsimshian.json']) {
      const all = load(name)
      const top = topConfidence(all)
      const counts = [0, 25, 50, 75, 100].map(
        (position) => filterCandidates(all, { minConfidence: sliderToConfidence(position, top) }).length,
      )
      assert.deepEqual([...counts].sort((a, b) => b - a), counts, `${name}: fewer guesses as the slider moves right`)
      assert.equal(counts[0], all.filter((c) => c.known).length, `${name}: far left shows everything`)
      assert.equal(counts[4], 1, `${name}: far right shows only the top guess`)
    }
  })

  it('Tsimshian is still shown three-quarters of the way along the slider', () => {
    const all = load('mms-tsimshian.json')
    const shown = filterCandidates(all, { minConfidence: sliderToConfidence(75, topConfidence(all)) })
    assert.ok(shown.some((c) => c.label === 'tsi'))
  })

  it('the LAMP-format illustration still converts', () => {
    const candidates = load('lamp-illustrative.json')
    assert.equal(candidates[0].name, 'Chol: Tumbala')
    assert.equal(candidates.filter((c) => !c.known).length, 1) // GRN ID 0, "no speech"
  })
})
