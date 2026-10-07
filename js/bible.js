// The Bible card on the resources screen, from the server's GET /bible/{id}
// (YouVersion). No DOM here, so it's fully tested.

/**
 * A resource link for the language's Bible, in the same shape as
 * resourceLinks() in results.js, or null when YouVersion has no Bible for it.
 * `note` carries the version name and copyright, which YouVersion requires
 * wherever its Bibles are shown.
 */
export function bibleResource(body, language) {
  const bible = body?.bible
  if (!bible?.url) return null
  // The Bible's name in the language itself, when YouVersion has one.
  const version = bible.localized_title || bible.title || bible.abbreviation || ''
  const abbreviation = bible.abbreviation && bible.abbreviation !== version ? ` (${bible.abbreviation})` : ''
  return {
    title: `Read the Bible in ${language.name}`,
    url: bible.url,
    domain: new URL(bible.url).hostname.replace(/^www\./, ''),
    note: [version + abbreviation, bible.copyright].filter(Boolean).join(' · '),
  }
}
