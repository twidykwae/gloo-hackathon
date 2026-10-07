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
    // The name in the language itself ("Русский"), for the few the database has.
    native: lang.native ?? null,
    // Its name in other languages, by tag ({ es: "Tzotzil de Chamula" }), for showing it in the device's (tools/add_names.py).
    names: lang.names ?? {},
    iso: lang.iso ?? null,
    // false when GRN has no sample recording (tools/mark_samples.py).
    hasSample: !lang.noSample,
    countries: lang.countries ?? [],
    // A variety counts as local where its parent language is listed.
    parentCountries: parent?.countries ?? [],
  }
}

const byName = (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)


/** The language a guess is named after: the one most of the others belong to. */
function groupLead(langs) {
  const ids = new Set(langs.map((lang) => lang.id))
  const children = new Map()
  for (const lang of langs) {
    if (ids.has(lang.parent)) children.set(lang.parent, (children.get(lang.parent) ?? 0) + 1)
  }
  const top = langs
    .filter((lang) => !ids.has(lang.parent))
    .sort((a, b) => (children.get(b.id) ?? 0) - (children.get(a.id) ?? 0) || a.name.length - b.name.length)
  return top[0] ?? null
}

/**
 * The sample a guess's own play button plays: its lead language's, or when
 * that has none (a heading such as English), the first listed language with one.
 */
function sampleFor(lead, languages) {
  const own = languages.find((lang) => lang.id === lead?.id)
  return (own?.hasSample ? own : languages.find((lang) => lang.hasSample))?.id ?? null
}

/**
 * The languages a guess lists: not "headings" such as English (#5185), which
 * have no recording of their own, only varieties ("English: USA") that do
 * (tools/mark_samples.py). The guess is still named after the heading.
 */
function listed(matches) {
  const varieties = matches.filter((lang) => !lang.heading)
  return varieties.length > 0 ? varieties : matches
}

/** Convert a raw model response into guesses, keeping the model's order. */
export function toCandidates(response, index) {
  const predictions = Array.isArray(response?.predictions) ? response.predictions : []
  const kind = response?.label_kind ?? (predictions[0]?.id !== undefined ? 'grn_language_id' : 'iso639_3')

  return predictions.map((prediction, i) => {
    const label = String(prediction.label ?? prediction.id)
    const confidence = Number(prediction.probability) || 0
    const matches = resolve(label, kind, index)
    const languages = listed(matches).map((lang) => toLanguage(lang, index)).sort(byName)
    const lead = groupLead(matches)
    return {
      rank: i + 1,
      label,
      confidence,
      percent: Math.round(confidence * 10000) / 100,
      name: lead?.name ?? null,
      native: lead?.native ?? null,
      names: lead?.names ?? {},
      // GRN ID of the language the guess is named after (maybe a heading, such as English).
      leadId: lead?.id ?? null,
      // GRN ID of the sample for the guess as a whole; null if none of its languages has one.
      sampleId: sampleFor(lead, languages),
      // false for labels the 5fish catalog doesn't have.
      known: languages.length > 0,
      languages,
    }
  })
}

/** "50%", "5.9%", "0.14%": enough digits to tell low scores apart. */
export function formatPercent(percent) {
  // Rounding 99.6 up would claim certainty the model doesn't have.
  if (percent > 99 && percent < 100) return '>99%'
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

/**
 * The same languages, those listed for the country first, then those local
 * through their parent, then the rest, each group in its original order.
 */
export function nearFirst(languages, countryCode) {
  return [...languages].sort((a, b) => localLevel(b, countryCode) - localLevel(a, countryCode))
}

/** The highest confidence among guesses the catalog knows; 0 if none. */
export function topConfidence(candidates) {
  return candidates.reduce((top, c) => (c.known && c.confidence > top ? c.confidence : top), 0)
}

/**
 * How strong a match looks next to the best one, 0 to 1, for coloring its
 * ring. The square root keeps weaker guesses from all looking the same.
 */
export function matchStrength(confidence, top) {
  return top > 0 ? Math.sqrt(Math.min(confidence / top, 1)) : 0
}

/** A dialect's name inside its guess: "Chamula" for "Tzotzil: Chamula" under "Tzotzil". */
/** The tags to look a name up by, most specific first: "es-MX" → ["es-MX", "es"]. */
export function languageTags(locale) {
  const tag = String(locale ?? '').trim()
  if (!tag) return ['en']
  const primary = tag.split('-')[0].toLowerCase()
  return [...new Set([tag, primary])]
}

/**
 * A language's name in the first of these languages GRN has one in, else its
 * English name: names are always shown in the device's language, as far as
 * GRN's names go.
 */
export function nameIn(language, tags) {
  for (const tag of tags) {
    if (tag === 'en' || tag.startsWith('en-')) return language.name
    if (language.names?.[tag]) return language.names[tag]
  }
  return language.name
}

/**
 * A dialect's name without its group's in front ("Chamula" in "Tzotzil:
 * Chamula"), when the name starts with it. `language` and `groupName` are as
 * shown, so in the device's language.
 */
export function shortName(language, groupName) {
  const prefix = groupName ? `${groupName}: ` : null
  return prefix && language.name.startsWith(prefix) && language.name.length > prefix.length
    ? language.name.slice(prefix.length)
    : language.name
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })

/** "Mexico, Guatemala" for a few countries, "12 countries" for many, "" for none. */
export function describeCountries(codes, { max = 3 } = {}) {
  if (codes.length === 0) return ''
  if (codes.length > max) return `${codes.length} countries`
  return codes.map((code) => regionNames.of(code)).join(', ')
}

/**
 * The Resources screen's links for a language, from config.resources:
 * {id} and {name} filled in. The button label defaults to "Go to" the domain
 * ("Go to 5fish.mobi").
 */
export function resourceLinks(language, resources) {
  return resources.map(({ title, button, logo, url }) => {
    const href = url.replaceAll('{id}', encodeURIComponent(language.id))
    return {
      title: title.replaceAll('{name}', language.name),
      button: button ?? `Go to ${new URL(href).hostname.replace(/^www\./, '')}`,
      ...(logo && { logo }),
      url: href,
    }
  })
}

/** The first `count` rows, and whether there are more to show. */
export function firstPage(rows, count) {
  return { rows: rows.slice(0, count), hasMore: rows.length > count }
}
