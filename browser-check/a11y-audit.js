// Paste as-is into one `javascript_tool` call: audits the current page state in one round trip.
// Re-run it on each meaningful state (menu open, dialog open, after an action).
// Set SCOPE to the feature's container to keep duplicated / unnamed controls to what the change touches.
(() => {
  const SCOPE = 'body'
  const scope = document.querySelector(SCOPE) || document.body
  // Skips aria-hidden descendants: BaseIcon renders its glyph as text inside an aria-hidden span
  const text = el => {
    if (!el) return null
    const clone = el.cloneNode(true)
    clone.querySelectorAll('[aria-hidden="true"]').forEach(hidden => hidden.remove())
    return clone.textContent.trim().replace(/\s+/g, ' ').slice(0, 90)
  }
  const accessibleName = el => {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const names = labelledBy
        .split(/\s+/)
        .filter(Boolean)
        .map(id => {
          const target = document.getElementById(id)
          return target ? text(target) : `MISSING #${id}`
        })
      return names.join(' ')
    }
    return el.getAttribute('aria-label') || text(el) || null
  }
  const visible = el => el.offsetParent !== null || el.getClientRects().length > 0
  const active = document.activeElement

  const dialogs = [...document.querySelectorAll('[role=dialog],[role=alertdialog],dialog')]
    .filter(visible)
    .map(dialog => ({
      role: dialog.getAttribute('role') || dialog.tagName,
      modal: dialog.getAttribute('aria-modal'),
      name: accessibleName(dialog),
      focusInside: dialog.contains(active),
      fields: [...dialog.querySelectorAll('input,textarea,select')].map(field => ({
        label: field.labels && field.labels.length ? text(field.labels[0]) : field.getAttribute('aria-label'),
        required: field.required || field.getAttribute('aria-required') === 'true',
      })),
    }))

  const menus = [...document.querySelectorAll('[role=menu],[role=menubar]')].filter(visible).map(menu => ({
    role: menu.getAttribute('role'),
    items: [...menu.querySelectorAll('[role^=menuitem],[role=separator]')].map(item =>
      item.getAttribute('role') === 'separator' ? '---' : accessibleName(item),
    ),
  }))

  const popupTriggers = [...document.querySelectorAll('[aria-haspopup]')].filter(visible)
  const controls = [...scope.querySelectorAll('button,a[href],[role=button]')].filter(visible)
  const nameCounts = controls.map(accessibleName).reduce((counts, name) => {
    if (name) counts[name] = (counts[name] || 0) + 1
    return counts
  }, {})
  const duplicatedNames = Object.fromEntries(Object.entries(nameCounts).filter(([, count]) => count > 1))
  const unnamed = controls.filter(el => !accessibleName(el)).map(el => el.outerHTML.slice(0, 120))

  return {
    scope: SCOPE,
    focus: `${active.tagName} ${accessibleName(active) || ''}`.slice(0, 100),
    dialogs,
    menus,
    popupTriggersWithoutExpanded: popupTriggers.filter(el => !el.hasAttribute('aria-expanded')).length,
    duplicatedNames,
    unnamed,
    liveRegions: [...document.querySelectorAll('[role=alert],[role=status],[aria-live]')]
      .map(el => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: text(el) }))
      .filter(region => region.text),
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')]
      .filter(visible)
      .map(heading => `${heading.tagName} ${text(heading)}`),
  }
})()
