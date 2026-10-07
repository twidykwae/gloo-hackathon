import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  describeCountries,
  firstPage,
  formatPercent,
  indexLanguages,
  isInCountry,
  languageTags,
  matchStrength,
  nameIn,
  nearFirst,
  resourceLinks,
  shortName,
  toCandidates,
  topConfidence,
} from '../js/results.js'

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

// A tiny catalog: Tzotzil with two varieties, Mam, two Quechua languages
// under the umbrella code "que", Sindhi with a variety that has no sample,
// and Ixil with no sample at all.
const LANGUAGES = [
  { id: 100, name: 'Tzotzil', native: 'Batsʼi kʼop', iso: 'tzo', countries: ['MX'] },
  { id: 101, name: 'Tzotzil: Chamula', iso: 'tzo', parent: 100 },
  { id: 102, name: 'Tzotzil: Huixtan', iso: 'tzo', parent: 100, countries: ['MX'] },
  { id: 200, name: 'Mam', iso: 'mam', countries: ['GT', 'MX'] },
  { id: 300, name: 'Quechua, Cusco', iso: 'quz', macro: 'que', countries: ['PE'] },
  { id: 301, name: 'Quechua, Ayacucho', iso: 'quy', macro: 'que', countries: ['PE'] },
  { id: 400, name: 'Sindhi', iso: 'snd' },
  { id: 401, name: 'Charan', iso: 'snd', parent: 400, noSample: true },
  // Headings (tools/mark_samples.py): no recording, only varieties that have one.
  { id: 500, name: 'English', iso: 'eng', countries: ['GB', 'US'], noSample: true, heading: true },
  { id: 501, name: 'English: USA', iso: 'eng', parent: 500 },
  { id: 502, name: 'English: British', iso: 'eng', parent: 500 },
  { id: 600, name: 'Kilega', iso: 'lea', countries: ['CD'], noSample: true, heading: true },
  { id: 601, name: 'Kisonga', iso: 'lea', parent: 600 },
  { id: 700, name: 'Ixil', iso: 'ixl', countries: ['GT'], noSample: true },
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

  it('fills in each language’s details and countries', () => {
    assert.deepEqual(tzo.languages[1], {
      id: 101,
      name: 'Tzotzil: Chamula',
      native: null,
      names: {},
      iso: 'tzo',
      hasSample: true,
      countries: [],
      parentCountries: ['MX'],
    })
  })

  it('leaves headings out of a guess’s languages, but names the guess after them', () => {
    const [eng] = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'eng', probability: 1 }] }, index)
    assert.equal(eng.name, 'English')
    assert.deepEqual(ids(eng.languages), [501, 502]) // shortest name first
    // Varieties are still local where the heading is listed.
    assert.deepEqual(eng.languages[0].parentCountries, ['GB', 'US'])
  })

  it('turns a heading with one variety into a single-language guess', () => {
    const [lea] = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'lea', probability: 1 }] }, index)
    assert.equal(lea.name, 'Kilega')
    assert.deepEqual(ids(lea.languages), [601])
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

  it('gives the guess the native name of the language it is named after', () => {
    assert.equal(tzo.native, 'Batsʼi kʼop')
    assert.equal(tzo.languages[0].native, 'Batsʼi kʼop')
    assert.equal(mam.native, null) // none known
  })

  it('keeps the GRN ID of the language the guess is named after, even a heading', () => {
    assert.equal(tzo.leadId, 100)
    const [eng] = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'eng', probability: 1 }] }, index)
    assert.equal(eng.leadId, 500) // English, a heading, though not one of its listed languages
    assert.equal(zzz.leadId, null)
  })

  it('picks the sample for the guess as a whole: the language it is named after', () => {
    assert.equal(tzo.sampleId, 100)
    const [snd] = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'snd', probability: 1 }] }, index)
    assert.equal(snd.sampleId, 400)
  })

  it('for a heading, picks the first listed variety with a sample', () => {
    const [eng, lea] = toCandidates(
      { label_kind: 'iso639_3', predictions: [{ label: 'eng', probability: 0.5 }, { label: 'lea', probability: 0.5 }] },
      index,
    )
    assert.equal(eng.sampleId, 501) // English: USA
    assert.equal(lea.sampleId, 601)
  })

  it('has no sample for the guess when none of its languages has one', () => {
    const [ixl] = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'ixl', probability: 1 }] }, index)
    assert.equal(ixl.sampleId, null)
    assert.equal(zzz.sampleId, null)
    assert.equal(zzz.native, null)
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

  it('never rounds up to 100%', () => {
    assert.equal(formatPercent(99.62), '>99%')
    assert.equal(formatPercent(98.7), '99%')
    assert.equal(formatPercent(100), '100%')
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

describe('nearFirst', () => {
  const [tzo] = toCandidates(MMS_RESPONSE, index)

  it('puts languages listed for the country first, then ones local through their parent', () => {
    assert.deepEqual(ids(nearFirst(tzo.languages, 'MX')), [100, 102, 101])
  })

  it('keeps every language, in the original order when none is local', () => {
    assert.deepEqual(ids(nearFirst(tzo.languages, 'GT')), [100, 101, 102])
    assert.deepEqual(ids(nearFirst(tzo.languages, null)), [100, 101, 102])
  })

  it('does not change the list it was given', () => {
    nearFirst(tzo.languages, 'MX')
    assert.deepEqual(ids(tzo.languages), [100, 101, 102])
  })
})

describe('topConfidence and matchStrength', () => {
  it('topConfidence is the best known guess’s score', () => {
    const candidates = toCandidates(MMS_RESPONSE, index)
    assert.equal(topConfidence(candidates), 0.6)
    // An unknown label scoring higher doesn't count.
    const unknownFirst = toCandidates({ label_kind: 'iso639_3', predictions: [{ label: 'zzz', probability: 0.9 }, ...MMS_RESPONSE.predictions] }, index)
    assert.equal(topConfidence(unknownFirst), 0.6)
    assert.equal(topConfidence([]), 0)
  })

  it('matchStrength is 1 for the best guess and the square root of the ratio below it', () => {
    assert.equal(matchStrength(0.6, 0.6), 1)
    assert.equal(matchStrength(0.15, 0.6), 0.5)
    assert.equal(matchStrength(0, 0.6), 0)
  })

  it('matchStrength is 0 without a best score, and never over 1', () => {
    assert.equal(matchStrength(0.3, 0), 0)
    assert.equal(matchStrength(0.9, 0.6), 1)
  })
})

describe('languageTags and nameIn', () => {
  const chamula = { name: 'Tzotzil: Chamula', names: { es: 'Tzotzil de Chamula', 'zh-Hant': '佐齊爾語' } }

  it('looks a name up by the full tag, then the language alone', () => {
    assert.deepEqual(languageTags('es-MX'), ['es-MX', 'es'])
    assert.deepEqual(languageTags('es'), ['es'])
    assert.deepEqual(languageTags(''), ['en'])
  })

  it('names a language in the device language when GRN has that name, else in English', () => {
    assert.equal(nameIn(chamula, languageTags('es-MX')), 'Tzotzil de Chamula')
    assert.equal(nameIn(chamula, languageTags('zh-Hant')), '佐齊爾語')
    assert.equal(nameIn(chamula, languageTags('fr-FR')), 'Tzotzil: Chamula')
    assert.equal(nameIn(chamula, languageTags('en-US')), 'Tzotzil: Chamula')
    assert.equal(nameIn({ name: 'Seneca' }, languageTags('es')), 'Seneca')
  })
})

describe('shortName', () => {
  it('drops the guess’s name from the front of a dialect’s name', () => {
    assert.equal(shortName({ name: 'Tzotzil: Chamula' }, 'Tzotzil'), 'Chamula')
    assert.equal(shortName({ name: 'English: USA' }, 'English'), 'USA')
  })

  it('keeps names that don’t start with it', () => {
    assert.equal(shortName({ name: 'Tzotzil' }, 'Tzotzil'), 'Tzotzil')
    assert.equal(shortName({ name: 'Charan' }, 'Sindhi'), 'Charan')
    assert.equal(shortName({ name: 'Quechua, Ayacucho' }, 'Quechua, Cusco'), 'Quechua, Ayacucho')
    assert.equal(shortName({ name: 'Tzotzil: Chamula' }, null), 'Tzotzil: Chamula')
  })
})

describe('describeCountries', () => {
  it('names a few countries', () => {
    assert.equal(describeCountries(['MX']), 'Mexico')
    assert.equal(describeCountries(['GT', 'MX']), 'Guatemala, Mexico')
  })

  it('counts many', () => {
    assert.equal(describeCountries(['AU', 'GB', 'NZ', 'US']), '4 countries')
  })

  it('is empty for none', () => {
    assert.equal(describeCountries([]), '')
  })
})

describe('resourceLinks', () => {
  const language = { id: 101, name: 'Tzotzil: Chamula' }

  it('fills in the GRN ID and name, and keeps the button label and logo', () => {
    const resources = [{ title: 'Listen to recordings in {name}', button: 'Go to 5fish', logo: 'images/5fish.png', url: 'https://5fish.mobi/{id}' }]
    assert.deepEqual(resourceLinks(language, resources), [
      { title: 'Listen to recordings in Tzotzil: Chamula', button: 'Go to 5fish', logo: 'images/5fish.png', url: 'https://5fish.mobi/101' },
    ])
  })

  it('leaves the logo out when there is none', () => {
    const [link] = resourceLinks(language, [{ title: 'A', button: 'Go', url: 'https://example.org/{id}' }])
    assert.equal('logo' in link, false)
  })

  it('labels the button with the domain, without "www.", when it has no label, and keeps the order', () => {
    const resources = [
      { title: 'A', url: 'https://www.example.org/lang/{id}?ref={id}' },
      { title: 'B', url: 'https://5fish.mobi/{id}' },
    ]
    assert.deepEqual(
      resourceLinks(language, resources).map((link) => [link.url, link.button]),
      [
        ['https://www.example.org/lang/101?ref=101', 'Go to example.org'],
        ['https://5fish.mobi/101', 'Go to 5fish.mobi'],
      ],
    )
  })
})

describe('firstPage', () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ label: String(i), known: true }))

  it('shows the first page and says whether there are more', () => {
    assert.equal(firstPage(rows, 10).rows.length, 10)
    assert.equal(firstPage(rows, 10).hasMore, true)
    assert.equal(firstPage(rows, 30).hasMore, false)
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

  it('English clip: the guess plays a variety’s sample, since English itself has none', () => {
    const [top] = load('mms-english.json')
    const sample = top.languages.find((lang) => lang.id === top.sampleId)
    assert.ok(sample?.hasSample)
    assert.match(sample.name, /^English/)
  })

  it('native names from the 5fish database: tagged ones, and untagged ones in other scripts', () => {
    const guess = (label) => toCandidates({ label_kind: 'iso639_3', predictions: [{ label, probability: 1 }] }, languages)[0]
    assert.equal(guess('rus').native, 'Русский') // tagged "ru"
    assert.equal(guess('amh').native, 'አማርኛ') // untagged, Ethiopic script
    assert.equal(guess('eng').native, null) // the same as the English name
  })

  it('English clip near the US: English: USA comes early among the dialects', () => {
    const [top] = load('mms-english.json')
    assert.ok(nearFirst(top.languages, 'US').slice(0, 3).some((lang) => lang.name === 'English: USA'))
  })

  it('Tsimshian clip: ranked deep overall, and marked as near you in Canada', () => {
    const tsi = load('mms-tsimshian.json').find((c) => c.label === 'tsi')
    assert.ok(tsi.rank > 40)
    assert.ok(tsi.languages.some((lang) => isInCountry(lang, 'CA')))
  })

  it('the LAMP-format illustration still converts', () => {
    const candidates = load('lamp-illustrative.json')
    assert.equal(candidates[0].name, 'Chol: Tumbala')
    assert.equal(candidates.filter((c) => !c.known).length, 1) // GRN ID 0, "no speech"
  })
})
