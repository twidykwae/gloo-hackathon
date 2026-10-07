// The Bible card on the resources screen, from the server's GET /bible/{id}
// (YouVersion). No DOM here, so it's fully tested.

/**
 * A resource link for the language's Bible, in the same shape as
 * resourceLinks() in results.js, or null when YouVersion has no Bible for it.
 * It only links to bible.com, which shows the version name and copyright itself.
 * bible.com links open the YouVersion app when it's installed (iOS universal
 * links and Android app links), and the website otherwise.
 */
export function bibleResource(body, language) {
  const bible = body?.bible
  if (!bible?.url) return null
  return {
    title: `Read the Bible in ${language.name}`,
    button: 'Go to YouVersion',
    logo: 'images/youversion.png',
    url: bible.url,
  }
}
