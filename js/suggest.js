/**
 * A list of suggestions under a text box (an ARIA combobox). Up and Down move
 * through them, Enter or a tap picks one, Escape closes the list. Anything
 * typed is still allowed: picking only fills in a known value.
 *
 * - find(text): the suggestions for what's typed, or for nothing typed yet.
 * - describe(item): { label, detail?, lang? } to show for it; `lang` is the detail's language.
 * - onPick(item): called after the box is filled with its label.
 */
export function attachSuggestions(input, list, { find, describe, onPick }) {
  let items = []
  let active = -1

  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', list.id)
  input.setAttribute('aria-expanded', 'false')
  list.setAttribute('role', 'listbox')

  function close() {
    items = []
    active = -1
    list.replaceChildren()
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }

  function open() {
    items = find(input.value)
    active = -1
    list.replaceChildren(
      ...items.map((item, i) => {
        const { label, detail, lang } = describe(item)
        const option = document.createElement('li')
        option.id = `${list.id}-${i}`
        option.className = 'suggestion'
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', 'false')
        const name = document.createElement('span')
        name.className = 'suggestion-label'
        name.textContent = label
        option.append(name)
        if (detail) {
          const more = document.createElement('span')
          more.className = 'suggestion-detail'
          more.textContent = detail
          if (lang) more.lang = lang
          option.append(more)
        }
        return option
      }),
    )
    list.hidden = items.length === 0
    input.setAttribute('aria-expanded', String(items.length > 0))
    input.removeAttribute('aria-activedescendant')
  }

  function highlight(i) {
    active = i
    ;[...list.children].forEach((option, j) => option.setAttribute('aria-selected', String(j === i)))
    input.setAttribute('aria-activedescendant', list.children[i].id)
    list.children[i].scrollIntoView({ block: 'nearest' })
  }

  function pick(i) {
    const item = items[i]
    input.value = describe(item).label
    close()
    onPick(item)
  }

  input.addEventListener('focus', open)
  input.addEventListener('input', open)
  input.addEventListener('blur', close)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && list.hidden) {
      e.preventDefault()
      open()
      return
    }
    if (list.hidden) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlight((active + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlight(active <= 0 ? items.length - 1 : active - 1)
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault() // picks; doesn't submit the form
      pick(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  // Pressing on a suggestion would blur the box (and close the list) before the click lands.
  list.addEventListener('pointerdown', (e) => e.preventDefault())
  list.addEventListener('click', (e) => {
    const option = e.target.closest('[role="option"]')
    if (option) pick([...list.children].indexOf(option))
  })

  return { close }
}
