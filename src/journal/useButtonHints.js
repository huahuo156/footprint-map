import { useEffect } from 'react'

export function addButtonHints(root) {
  root.querySelectorAll('button[aria-label],a[aria-label],summary[aria-label]').forEach(control => {
    if (!control.hasAttribute('title')) control.title = control.getAttribute('aria-label')
  })
}

export default function useButtonHints() {
  useEffect(() => {
    const update = () => document.querySelectorAll('.journal-app,.journal-modal').forEach(addButtonHints)
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [])
}
