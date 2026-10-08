// Paste as-is into one `javascript_tool` call: audits the current page state in one round trip.
// Re-run it on each meaningful state (menu open, dialog open, after an action).
(() => {
  const text = el => (el ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 90) : null)
  const accessibleName = el => {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const target = document.getElementById(labelledBy)
      return target ? text(target) : `MISSING #${labelledBy}`
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
  const buttonNames = [...document.querySelectorAll('button,a[href],[role=button]')]
    .filter(visible)
    .map(accessibleName)
  const duplicatedNames = [...new Set(buttonNames.filter((name, index) => name && buttonNames.indexOf(name) !== index))]
  const unnamed = [...document.querySelectorAll('button,a[href],[role=button]')]
    .filter(el => visible(el) && !accessibleName(el))
    .map(el => el.outerHTML.slice(0, 120))

  return {
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
