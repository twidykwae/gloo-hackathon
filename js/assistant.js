// Gloo AI on the Resources screen: the guide note and the chat. No DOM here,
// so it's fully tested; main.js draws it.

// The note and chat's own words, until the guide brings them in the person's
// language (the server's LABELS in server/app/assistant.py).
export const DEFAULT_LABELS = {
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

/** The request body for POST /assistant/chat: the conversation so far, ending with the question. */
export function chatRequest(languageId, country, log, question) {
  return {
    grn_id: languageId,
    country: country ?? null,
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
