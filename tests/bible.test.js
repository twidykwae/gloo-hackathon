import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bibleResource } from '../js/bible.js'

const amharic = { id: 1, name: 'Amharic' }

test('a Bible becomes a resource link with a "Go to YouVersion" button', () => {
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
    button: 'Go to YouVersion',
    logo: 'images/youversion.png',
    url: 'https://www.bible.com/versions/1260',
  })
})

test('no Bible, no link', () => {
  assert.equal(bibleResource({ grn_id: 9, bible: null }, amharic), null)
  assert.equal(bibleResource(null, amharic), null)
})
