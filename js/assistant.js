// Gloo AI on the Resources screen: the guide note and the chat. No DOM here,
// so it's fully tested; main.js draws it.

// Every word on the end screen, until the guide brings them in the person's
// language (the server's LABELS in server/app/assistant.py). goTo keeps
// {site}: the site's name isn't translated.
export const DEFAULT_LABELS = {
  choice: 'Your choice:',
  closest: 'Thank you! The closest we have',
  prompt: 'Point a camera or visit directly',
  goTo: 'Go to {site}',
  restart: 'Start over with a new recording',
  note: 'A note for you',
  chatTitle: 'Have a question?',
  chatLede: 'Ask about listening, sharing, or the Bible. Type in any language.',
  placeholder: 'Ask a question…',
  send: 'Send',
}

// Shown before the guide's own suggestions arrive, or if it fails.
export const DEFAULT_QUESTIONS = [
  'How do I listen without internet?',
  'How can I share this with my family?',
  'Where should I start listening?',
]

/**
 * The request body for POST /assistant/chat: the conversation so far, ending
 * with the question. deviceLanguage (navigator.language) is the fallback.
 */
export function chatRequest(languageId, country, log, question, deviceLanguage) {
  return {
    grn_id: languageId,
    country: country ?? null,
    device_language: deviceLanguage ?? null,
    messages: [...log, { role: 'user', content: question }].map(({ role, content }) => ({ role, content })),
  }
}

/** What to tell the person when the assistant can't answer. */
export function assistantError(status) {
  if (status === 429) return "The assistant has answered all it can for today. Please try again tomorrow."
  if (status === 503) return 'The assistant is not available here.'
  return "Sorry, I couldn't answer just now. Please try again."
}

/** A question worth sending: trimmed, not empty, not overly long. */
export function cleanQuestion(text, maxChars = 600) {
  return String(text ?? '').trim().slice(0, maxChars)
}
