import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assistantError, chatRequest, cleanQuestion, DEFAULT_QUESTIONS } from '../js/assistant.js'

test('chatRequest sends the conversation ending with the new question', () => {
  const log = [
    { role: 'user', content: '¿Es gratis?', pending: false },
    { role: 'assistant', content: 'Sí.' },
  ]
  assert.deepEqual(chatRequest(2641, 'MX', log, '¿Y sin internet?'), {
    grn_id: 2641,
    country: 'MX',
    messages: [
      { role: 'user', content: '¿Es gratis?' },
      { role: 'assistant', content: 'Sí.' },
      { role: 'user', content: '¿Y sin internet?' },
    ],
  })
  assert.equal(chatRequest(1, undefined, [], 'Hi').country, null)
})

test('assistantError explains limits and outages', () => {
  assert.match(assistantError(429), /today/)
  assert.match(assistantError(503), /not available/)
  assert.match(assistantError(502), /try again/)
})

test('cleanQuestion trims and caps', () => {
  assert.equal(cleanQuestion('  hola  '), 'hola')
  assert.equal(cleanQuestion('   '), '')
  assert.equal(cleanQuestion('x'.repeat(700)).length, 600)
})

test('there are three starter questions', () => {
  assert.equal(DEFAULT_QUESTIONS.length, 3)
})
