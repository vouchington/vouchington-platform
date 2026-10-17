/**
 * Remove `aria-activedescendant` and `aria-controls` from a combobox input when they reference ids
 * that are not in the document (cmdk can leave them dangling while its list is unmounted).
 * Runs once, then on attribute changes and on subtree changes of the closest `[cmdk-root]`.
 * Returns a function that stops watching.
 */
export function watchStaleAriaReferences(input: HTMLElement): () => void {
  const removeStale = () => {
    const activeDescendant = input.getAttribute('aria-activedescendant')
    if (activeDescendant && !input.ownerDocument.getElementById(activeDescendant)) {
      input.removeAttribute('aria-activedescendant')
    }
    const controls = input.getAttribute('aria-controls')
    if (controls && !input.ownerDocument.getElementById(controls)) {
      input.removeAttribute('aria-controls')
      input.setAttribute('aria-expanded', 'false')
    }
  }

  removeStale()
  const observer = new MutationObserver(removeStale)
  observer.observe(input, {
    attributes: true,
    attributeFilter: ['aria-activedescendant', 'aria-controls'],
  })
  const root = input.closest('[cmdk-root]')
  if (root) observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}
