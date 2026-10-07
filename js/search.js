// Finding a language or a country by what someone typed, for the "new
// dialect" form. No DOM, fully tested.

/**
 * Lowercase and without accents, so "espanol" finds "Español". Only the
 * accents Latin, Greek and Cyrillic letters carry are dropped: in scripts such
 * as Hindi's, the marks are vowels, and dropping them would change the word.
 */
export function fold(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().trim()
}

/** 0: the name starts with it, 1: one of its words does, 2: it's inside the name, -1: no match. */
function matchRank(name, query) {
  if (name.startsWith(query)) return 0
  if (name.split(/[\s,:;()'’-]+/).some((word) => word.startsWith(query))) return 1
  return name.includes(query) ? 2 : -1
}

/**
 * A search over `items` by the names `namesOf(item)` gives. The returned
 * function takes the typed text and returns the best matches: names that
 * start with it, then names with a word that does, then names containing it;
 * `order` breaks ties.
 */
export function makeSearch(items, namesOf, { order = () => 0 } = {}) {
  const keyed = items.map((item) => ({ item, keys: namesOf(item).filter(Boolean).map(fold) }))
  return (query, { limit = 5, minLength = 1 } = {}) => {
    const q = fold(query)
    if (q.length < minLength) return []
    const hits = []
    for (const { item, keys } of keyed) {
      const ranks = keys.map((key) => matchRank(key, q)).filter((rank) => rank >= 0)
      if (ranks.length) hits.push({ item, rank: Math.min(...ranks) })
    }
    hits.sort((a, b) => a.rank - b.rank || order(a.item, b.item))
    return hits.slice(0, limit).map((hit) => hit.item)
  }
}

/**
 * Search GRN languages by English or native name, or a name in another
 * language (tools/add_names.py); main languages before their varieties, then shorter names.
 */
export function languageSearch(languages) {
  return makeSearch(languages, (lang) => [lang.name, lang.native, ...Object.values(lang.names ?? {})], {
    order: (a, b) =>
      (a.parent != null) - (b.parent != null) || a.name.length - b.name.length || a.name.localeCompare(b.name),
  })
}

// Codes the browser names that aren't countries to pick: groupings, test
// codes, and old codes for countries that have a current one (UK for GB, SU for RU).
const NOT_COUNTRIES = new Set([
  'EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ',
  'AN', 'BU', 'CS', 'DD', 'DY', 'FX', 'HV', 'NH', 'RH', 'SU', 'TP', 'UK', 'VD', 'YD', 'YU', 'ZR',
])

/** Every country and territory the browser has a name for, as { code, name }, sorted by name. */
export function countryList(locale = 'en') {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })
  const countries = []
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      if (NOT_COUNTRIES.has(code)) continue
      let name
      try {
        name = names.of(code)
      } catch {
        continue
      }
      if (name && name !== code) countries.push({ code, name })
    }
  }
  return countries.sort((a, b) => a.name.localeCompare(b.name, locale))
}

/** Search countries by name or two-letter code. */
export function countrySearch(countries) {
  return makeSearch(countries, (country) => [country.name, country.code], {
    order: (a, b) => a.name.localeCompare(b.name),
  })
}

/** The one item whose name is exactly what was typed (ignoring case and accents), or null. */
export function exactMatch(items, namesOf, query) {
  const q = fold(query)
  if (!q) return null
  return items.find((item) => namesOf(item).some((name) => name && fold(name) === q)) ?? null
}
