import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { countryList, countrySearch, exactMatch, fold, languageSearch, makeSearch } from '../js/search.js'

const LANGUAGES = [
  { id: 1, name: 'Portuguese', native: 'Português' },
  { id: 2, name: 'Portuguese: Brazilian Portuguese', parent: 1 },
  { id: 3, name: 'Creole, Portuguese' },
  { id: 4, name: 'Galician' },
  { id: 5, name: 'Spanish', native: 'Español' },
  { id: 6, name: 'Mam' },
  { id: 7, name: 'Tzotzil: Chamula', parent: 8 },
  { id: 8, name: 'Tzotzil' },
]
const names = (found) => found.map((lang) => lang.name)

describe('fold', () => {
  it('ignores case and accents', () => {
    assert.equal(fold('  Español '), 'espanol')
    assert.equal(fold('PORTUGUÊS'), 'portugues')
  })

  it('keeps the vowel signs of scripts such as Hindi and Amharic', () => {
    assert.equal(fold('हिन्दी'), 'हिन्दी')
    assert.equal(fold('አማርኛ'), 'አማርኛ')
  })

  it('folds Cyrillic accents too, so й and и match', () => {
    assert.equal(fold('Русский'), fold('русскии'))
  })
})

describe('languageSearch', () => {
  const find = languageSearch(LANGUAGES)

  it('puts names that start with the text first, then a word that does, then the rest', () => {
    assert.deepEqual(names(find('portu')), ['Portuguese', 'Portuguese: Brazilian Portuguese', 'Creole, Portuguese'])
    assert.deepEqual(names(find('cham')), ['Tzotzil: Chamula'])
    assert.deepEqual(names(find('ici')), ['Galician'])
  })

  it('puts main languages before their varieties', () => {
    assert.deepEqual(names(find('tzo')), ['Tzotzil', 'Tzotzil: Chamula'])
  })

  it('finds native names, without needing the accents', () => {
    assert.deepEqual(names(find('espanol')), ['Spanish'])
    assert.deepEqual(names(find('Portugues')).slice(0, 1), ['Portuguese'])
  })

  it('needs a minimum length, and limits the results', () => {
    assert.deepEqual(find('p', { minLength: 2 }), [])
    assert.equal(find('a', { limit: 3 }).length, 3)
  })

  it('finds nothing for nothing typed', () => {
    assert.deepEqual(find('   '), [])
  })

  it('works on the real catalog', () => {
    const catalog = JSON.parse(readFileSync(new URL('../data/languages.json', import.meta.url), 'utf8'))
    const [first] = languageSearch(catalog)('portuguese')
    assert.equal(first.name, 'Portuguese')
    assert.equal(languageSearch(catalog)('Русск')[0].name, 'Russian') // by its native name
  })
})

describe('countryList and countrySearch', () => {
  const countries = countryList('en')
  const codes = new Set(countries.map((c) => c.code))

  it('has the countries, by their current codes', () => {
    for (const code of ['BR', 'GB', 'MX', 'RU', 'US', 'XK']) assert.ok(codes.has(code), code)
    assert.ok(countries.length > 240)
  })

  it('leaves out groupings, test codes and old codes', () => {
    for (const code of ['EU', 'UN', 'ZZ', 'XA', 'UK', 'SU', 'BU', 'YU']) assert.ok(!codes.has(code), code)
  })

  it('is sorted by name, each name once', () => {
    const list = countries.map((c) => c.name)
    assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b, 'en')))
    assert.equal(new Set(list).size, list.length)
  })

  it('searches by name or by code', () => {
    const find = countrySearch(countries)
    assert.equal(find('bra')[0].name, 'Brazil')
    assert.equal(find('mexi')[0].code, 'MX')
    assert.equal(find('gb')[0].name, 'United Kingdom')
    assert.ok(find('united').some((c) => c.code === 'US'))
  })

  it('can name countries in another language', () => {
    assert.equal(countryList('es').find((c) => c.code === 'MX').name, 'México')
  })
})

describe('exactMatch', () => {
  const namesOf = (lang) => [lang.name, lang.native]

  it('finds an item typed out in full, ignoring case and accents', () => {
    assert.equal(exactMatch(LANGUAGES, namesOf, 'spanish').id, 5)
    assert.equal(exactMatch(LANGUAGES, namesOf, 'espanol').id, 5)
  })

  it('is null for a partial name or nothing', () => {
    assert.equal(exactMatch(LANGUAGES, namesOf, 'span'), null)
    assert.equal(exactMatch(LANGUAGES, namesOf, ''), null)
  })
})

describe('makeSearch', () => {
  it('breaks ties with the order given', () => {
    const find = makeSearch(['bb', 'ba', 'bc'], (x) => [x], { order: (a, b) => a.localeCompare(b) })
    assert.deepEqual(find('b'), ['ba', 'bb', 'bc'])
  })
})
