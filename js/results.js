// Turns raw model output into rows the page can show, and filters them.
// No DOM or network here, so everything in this file is unit tested
// (tests/results.test.js).
//
// Raw model output (LAMP's serve.py format; see data/sample-model-response.json):
//   { duration: 7.3, predictions: [{ id: 14, probability: 0.412, iso: "ctu", url: "..." }, ...] }
// `id` is a GRN language ID. `predictions` is already sorted, best first.
//
// Usable format, one "candidate" per prediction:
//   { rank, id, name, iso, confidence, percent, sampleUrl, contentUrl,
//     countries, parentCountries, known }

export const sampleUrl = (id) => `https://media.globalrecordings.net/GOKit_MP3/sample-${id}.mp3`
export const contentUrl = (id) => `https://5fish.mobi/${id}`

/** Index data/languages.json by GRN language ID. */
export function indexLanguages(languages) {
  return new Map(languages.map((lang) => [lang.id, lang]))
}

/** Convert a raw model response into candidates, keeping the model's order. */
export function toCandidates(response, languageIndex) {
  const predictions = Array.isArray(response?.predictions) ? response.predictions : []
  return predictions.map((prediction, i) => {
    const id = Number(prediction.id)
    const lang = languageIndex.get(id)
    const parent = lang?.parent != null ? languageIndex.get(lang.parent) : undefined
    const confidence = Number(prediction.probability) || 0
    return {
      rank: i + 1,
      id,
      name: lang?.name ?? null,
      iso: lang?.iso ?? prediction.iso ?? null,
      confidence,
      percent: Math.round(confidence * 1000) / 10,
      sampleUrl: lang && !lang.noSample ? sampleUrl(id) : null,
      contentUrl: contentUrl(id),
      countries: lang?.countries ?? [],
      // A variety counts as local where its parent language is listed.
      parentCountries: parent?.countries ?? [],
      // false for IDs the 5fish catalog doesn't have, like 0 ("no speech").
      known: Boolean(lang),
    }
  })
}

/** Is this language listed for the country (ISO 3166-1 alpha-2), directly or through its parent? */
export function isInCountry(candidate, countryCode) {
  if (!countryCode) return false
  return candidate.countries.includes(countryCode) || candidate.parentCountries.includes(countryCode)
}

/**
 * Filter candidates for display.
 *   scope:         'all' = the model's raw ranking, 'local' = only languages listed for `country`
 *   country:       ISO 3166-1 alpha-2 code, needed for scope 'local'
 *   minConfidence: drop candidates below this probability (0..1)
 * Unknown IDs are always dropped: there's no name or sample to show.
 * The model's rank is kept, so a filtered list can read 1, 3, 4, 7...
 */
export function filterCandidates(candidates, { scope = 'all', country = null, minConfidence = 0 } = {}) {
  return candidates.filter(
    (c) => c.known && c.confidence >= minConfidence && (scope !== 'local' || isInCountry(c, country)),
  )
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
