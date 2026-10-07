import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bibleResource } from '../js/bible.js'

const amharic = { id: 1, name: 'Amharic' }

test('a Bible becomes a resource link with its name and copyright', () => {
  const link = bibleResource(
    {
      grn_id: 1,
      bible: {
        id: 1260,
        abbreviation: 'NASV',
        title: 'New Amharic Standard Version',
        localized_title: 'አዲሱ መደበኛ ትርጒም',
        copyright: '© Bible Society of Ethiopia',
        url: 'https://www.bible.com/versions/1260',
        can_show_text: true,
      },
    },
    amharic,
  )
  assert.deepEqual(link, {
    title: 'Read the Bible in Amharic',
    url: 'https://www.bible.com/versions/1260',
    domain: 'bible.com',
    note: 'አዲሱ መደበኛ ትርጒም (NASV) · © Bible Society of Ethiopia',
  })
})

test('the note falls back to the English title, and skips a missing copyright', () => {
  const link = bibleResource({ bible: { title: 'Berean Standard Bible', abbreviation: 'BSB', url: 'https://www.bible.com/versions/3034' } }, amharic)
  assert.equal(link.note, 'Berean Standard Bible (BSB)')
})

test('no repeated abbreviation when it is the only name', () => {
  assert.equal(bibleResource({ bible: { abbreviation: 'jit', url: 'https://www.bible.com/versions/3689' } }, amharic).note, 'jit')
})

test('no Bible, no link', () => {
  assert.equal(bibleResource({ grn_id: 9, bible: null }, amharic), null)
  assert.equal(bibleResource(null, amharic), null)
})
