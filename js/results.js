export const contentUrl = (id) => `https://5fish.mobi/${id}`

/** Index data/languages.json by GRN ID, ISO code and macrolanguage code. */
export function indexLanguages(languages) {
  const byId = new Map()
  const byIso = new Map()
  const byMacro = new Map()
  const add = (map, key, lang) => {
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(lang)
  }
  for (const lang of languages) {
    byId.set(lang.id, lang)
    add(byIso, lang.iso, lang)
    add(byMacro, lang.macro, lang)
  }
  return { byId, byIso, byMacro }
}

/** Every GRN language a model label could mean. */
function resolve(label, kind, index) {
  if (kind === 'grn_language_id') {
    const lang = index.byId.get(Number(label))
    return lang ? [lang] : []
  }
  // An umbrella code such as "que" (Quechua) has no languages of its own:
  // fall back to its member languages.
  return index.byIso.get(label) ?? index.byMacro.get(label) ?? []
}

function toLanguage(lang, index) {
  const parent = lang.parent != null ? index.byId.get(lang.parent) : undefined
  return {
    id: lang.id,
    name: lang.name,
    iso: lang.iso ?? null,
    contentUrl: contentUrl(lang.id),
    countries: lang.countries ?? [],
    // A variety counts as local where its parent language is listed.
    parentCountries: parent?.countries ?? [],
  }
}

const byName = (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)


function groupName(langs) {
  const ids = new Set(langs.map((lang) => lang.id))
  const children = new Map()
  for (const lang of langs) {
    if (ids.has(lang.parent)) children.set(lang.parent, (children.get(lang.parent) ?? 0) + 1)
  }
  const top = langs
    .filter((lang) => !ids.has(lang.parent))
    .sort((a, b) => (children.get(b.id) ?? 0) - (children.get(a.id) ?? 0) || a.name.length - b.name.length)
  return top[0]?.name ?? null
}

/** Convert a raw model response into guesses, keeping the model's order. */
export function toCandidates(response, index) {
  const predictions = Array.isArray(response?.predictions) ? response.predictions : []
  const kind = response?.label_kind ?? (predictions[0]?.id !== undefined ? 'grn_language_id' : 'iso639_3')

  return predictions.map((prediction, i) => {
    const label = String(prediction.label ?? prediction.id)
    const confidence = Number(prediction.probability) || 0
    const matches = resolve(label, kind, index)
    const languages = matches.map((lang) => toLanguage(lang, index)).sort(byName)
    return {
      rank: i + 1,
      label,
      confidence,
      percent: Math.round(confidence * 10000) / 100,
      name: groupName(matches),
      // false for labels the 5fish catalog doesn't have.
      known: languages.length > 0,
      languages,
    }
  })
}

/** "50%", "5.9%", "0.14%": enough digits to tell low scores apart. */
export function formatPercent(percent) {
  if (percent >= 10) return `${Math.round(percent)}%`
  if (percent >= 1) return `${percent.toFixed(1)}%`
  return `${percent.toFixed(2)}%`
}

/** 2 = listed for the country itself, 1 = local through its parent, 0 = not local. */
function localLevel(language, countryCode) {
  if (!countryCode) return 0
  if (language.countries.includes(countryCode)) return 2
  return language.parentCountries.includes(countryCode) ? 1 : 0
}

/** Is this language listed for the country (ISO 3166-1 alpha-2), directly or through its parent? */
export function isInCountry(language, countryCode) {
  return localLevel(language, countryCode) > 0
}

export function filterCandidates(candidates, { scope = 'all', country = null, minConfidence = 0 } = {}) {
  const visible = candidates.filter((c) => c.known && c.confidence >= minConfidence)
  if (scope !== 'local') return visible
  return visible
    .map((c) => ({
      ...c,
      languages: c.languages
        .filter((lang) => isInCountry(lang, country))
        .sort((a, b) => localLevel(b, country) - localLevel(a, country)),
    }))
    .filter((c) => c.languages.length > 0)
}

/** The highest confidence among guesses the catalog knows; 0 if none. */
export function topConfidence(candidates) {
  return candidates.reduce((top, c) => (c.known && c.confidence > top ? c.confidence : top), 0)
}


export function sliderToConfidence(position, top, { steps = 100, decades = 3 } = {}) {
  if (position <= 0 || !(top > 0)) return 0
  return top * 10 ** (-decades * (1 - Math.min(position, steps) / steps))
}

/** The first `count` rows, and whether there are more to show. */
export function firstPage(rows, count) {
  return { rows: rows.slice(0, count), hasMore: rows.length > count }
}

/** Counts for a summary line such as "Showing 10 of 21". */
export function summarize(candidates, visible, shown) {
  return {
    total: candidates.length,
    unknown: candidates.filter((c) => !c.known).length,
    matching: visible.length,
    shown: Math.min(shown, visible.length),
  }
}
