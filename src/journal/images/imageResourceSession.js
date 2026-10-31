import { fetchSession, getApiSessionEpoch, subscribeApiSessionReset } from '../../lib/api.js'

// createCache(scope) supplies the network/decode adapters and cache budgets.
// validate() is read-only: it never accepts an AccountGate session or changes
// the API epoch. A false result denies resources until explicit recovery.
export function createImageResourceSession({
  ownerId, createCache, checkSession = fetchSession,
  getEpoch = getApiSessionEpoch, subscribeReset = subscribeApiSessionReset,
  clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  ttlMs = 60000,
} = {}) {
  if (ownerId == null || typeof createCache !== 'function') throw new TypeError('ownerId and createCache are required')
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 60000) throw new TypeError('ttlMs must be between 0 and 60000')
  let disposed = false, revision = 0, mediaEpoch = 0
  let cache = null, timer = null, pending = null, checkedAt = null
  let validUntil = clock() + ttlMs
  let cacheExpiresAt = Infinity
  const listeners = new Set()
  const notify = () => {
    // Snapshot delivery permits listeners to unsubscribe during notification.
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      try { listener() } catch (error) { console.error('Image resource session listener failed', error) }
    }
  }
  const stopTimer = () => { if (timer !== null) clearTimer(timer); timer = null }
  const closeCache = () => { const previous = cache; cache = null; cacheExpiresAt = Infinity; previous?.dispose(); if (previous) notify() }
  const newCache = () => {
    cache = createCache({ ownerId, apiEpoch: getEpoch(), mediaEpoch: ++mediaEpoch })
    cacheExpiresAt = clock() + ttlMs
    notify()
  }
  const schedule = () => {
    stopTimer()
    if (disposed || !cache) return
    const expectedRevision = revision
    timer = setTimer(() => {
      timer = null
      if (disposed || revision !== expectedRevision) return
      // Expired resources are released even if the server check hangs offline.
      closeCache()
      if (disposed || revision !== expectedRevision) return
      void validate()
    }, Math.max(0, Math.min(validUntil, cacheExpiresAt) - clock()))
  }
  function validate() {
    if (disposed) return Promise.resolve(false)
    const entryRevision = revision
    if (cache && clock() >= Math.min(validUntil, cacheExpiresAt)) closeCache()
    if (disposed || revision !== entryRevision) return Promise.resolve(false)
    if (pending) return pending
    if (checkedAt !== null && clock() < validUntil && cache) return Promise.resolve(true)
    const expectedRevision = revision, expectedEpoch = getEpoch()
    const current = () => !disposed && revision === expectedRevision && getEpoch() === expectedEpoch
    const operation = Promise.resolve().then(async () => {
      if (!current()) return false
      try {
        const result = await checkSession()
        if (!current()) return false
        if (result?.user?.id !== ownerId) throw new Error('Resource session owner changed')
        checkedAt = clock()
        validUntil = checkedAt + ttlMs
        if (!cache) newCache()
        if (!current()) return false
        schedule()
        return true
      } catch {
        if (current()) {
          checkedAt = null
          stopTimer()
          closeCache()
        }
        return false
      }
    }).finally(() => { if (pending === operation) pending = null })
    pending = operation
    return operation
  }
  newCache()
  const unsubscribe = subscribeReset(() => {
    if (disposed) return
    revision++
    pending = null
    checkedAt = null
    stopTimer()
    closeCache()
    validUntil = 0
  })
  schedule()
  return {
    subscribe(listener) {
      if (!disposed) listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getCache() {
      if (disposed) return null
      if (clock() >= Math.min(validUntil, cacheExpiresAt)) closeCache()
      return cache
    },
    validate,
    dispose() {
      if (disposed) return
      disposed = true
      revision++
      pending = null
      stopTimer()
      unsubscribe()
      closeCache()
      listeners.clear()
    },
  }
}
