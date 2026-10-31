const MAX_DIMENSION = 32768
const MAX_ENTRIES = 4096

function sourceKey(src) {
  if (typeof src !== 'string' || !src.trim()) return null
  return /^\/uploads\/[\w-]+\.(jpg|png|webp)\?thumbnail=1$/.test(src) ? src.split('?')[0] : src
}

function scopeIdentity(scope) {
  return Object.freeze({ ownerId: scope?.ownerId, apiEpoch: scope?.apiEpoch, mediaEpoch: scope?.mediaEpoch })
}

// Runtime dimensions only. This store owns no image resources or persisted layout.
export function createImageDimensionStore({ scope, maxEntries = MAX_ENTRIES, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame } = {}) {
  const capacity = Number.isFinite(maxEntries) ? Math.max(1, Math.min(MAX_ENTRIES, Math.floor(maxEntries))) : MAX_ENTRIES
  const entries = new Map()
  const listeners = new Set()
  let currentScope = scopeIdentity(scope)
  let frame = null
  let generation = 0
  let disposed = false

  function cancelPublication() {
    generation++
    if (frame !== null) cancelFrame(frame)
    frame = null
  }

  function publishLater() {
    if (disposed || frame !== null) return
    const scheduledGeneration = generation
    frame = requestFrame(() => {
      if (disposed || scheduledGeneration !== generation) return
      frame = null
      // A subscriber added during publication starts on the next frame.
      const subscribers = Array.from(listeners)
      for (const listener of subscribers) {
        if (disposed || scheduledGeneration !== generation) break
        if (listeners.has(listener)) {
          try { listener() }
          catch (error) { console.error('Image dimension listener failed', error) }
        }
      }
    })
  }

  return {
    get(src) {
      if (disposed) return undefined
      const key = sourceKey(src)
      const dimensions = entries.get(key)
      if (dimensions) {
        entries.delete(key)
        entries.set(key, dimensions)
      }
      return dimensions
    },
    set(src, dimensions) {
      if (disposed) return false
      const key = sourceKey(src)
      const width = dimensions?.width
      const height = dimensions?.height
      if (!key || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) return false
      const previous = entries.get(key)
      if (previous?.width === width && previous?.height === height) return false
      entries.delete(key)
      entries.set(key, Object.freeze({ width, height }))
      while (entries.size > capacity) entries.delete(entries.keys().next().value)
      publishLater()
      return true
    },
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    invalidateSources(urls) {
      if (disposed) return
      let changed = false
      for (const src of urls ?? []) changed = entries.delete(sourceKey(src)) || changed
      if (!changed) return
      cancelPublication()
      publishLater()
    },
    resetScope(nextScope) {
      if (disposed) return
      currentScope = scopeIdentity(nextScope)
      entries.clear()
      cancelPublication()
      publishLater()
    },
    getStats() {
      return { entries: entries.size, maxEntries: capacity, scope: currentScope, pending: frame !== null, disposed }
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelPublication()
      entries.clear()
      listeners.clear()
    },
  }
}
