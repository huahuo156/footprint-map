import { createRetryMedia } from './retryMedia.js'

// Session-scoped display-resource cache for private canvas thumbnails.
// This is intentionally a pure scheduler: network and decode adapters are
// injected so tests can assert state transitions without real media.

const mediaSource = src => {
  if (typeof src !== 'string' || !/^\/uploads\/[\w-]+\.(jpg|png|webp)(\?thumbnail=1)?$/.test(src)) throw new TypeError('不支持的私有图片地址。')
  return src.split('?')[0] + '?thumbnail=1'
}

export function createImageResourceCache({
  scope, limits = {}, fetchMedia, decode, clock = () => Date.now(),
} = {}) {
  if (typeof fetchMedia !== 'function') throw new TypeError('fetchMedia adapter is required')
  const fetchWithRetry = createRetryMedia(fetchMedia)
  const ownerId = scope?.ownerId ?? ''
  const scopeEpoch = `${ownerId}:${scope?.apiEpoch ?? ''}:${scope?.mediaEpoch ?? ''}:`
  const maxFetch = limits.maxFetch ?? 4
  const maxDecode = limits.maxDecode ?? 2
  const maxEntries = limits.maxEntries ?? 512
  const maxBytes = limits.maxBytes ?? 24 * 1024 * 1024
  const maxDisplayLeases = limits.maxDisplayLeases ?? 48
  const maxDecodedBytes = limits.maxDecodedBytes ?? 64 * 1024 * 1024
  const decodeBytesPerLease = limits.decodeBytesPerLease ?? 512 * 512 * 4
  const maxQueued = limits.maxQueued ?? 64
  const reserveFetchBytes = limits.reserveFetchBytes ?? 2 * 1024 * 1024
  if (![maxFetch, maxDecode, maxEntries, maxBytes, reserveFetchBytes, maxQueued, maxDisplayLeases, maxDecodedBytes, decodeBytesPerLease].every(Number.isSafeInteger) || maxFetch < 1 || maxDecode < 1 || maxEntries < 1 || maxBytes < 1 || reserveFetchBytes < 1 || maxQueued < 1 || maxDisplayLeases < 1 || maxDecodedBytes < 1 || decodeBytesPerLease < 1) throw new TypeError('Invalid cache limits')

  const resources = new Map()
  const queue = []
  const decodeQueue = []
  const stats = { residentBlobBytes: 0, reservedFetchBytes: 0, entryCount: 0, activeFetch: 0, activeDecode: 0, queuedKeys: 0, activeDisplayLeases: 0, objectUrlCount: 0, estimatedDecodedBytes: 0, hit: 0, miss: 0, abort: 0, evict: 0 }
  let activeFetch = 0, activeDecode = 0, closed = false, nextOrder = 0

  const refreshStats = () => {
    let bytes = 0, entries = 0, displayLeases = 0, urls = 0
    for (const resource of resources.values()) {
      if (resource.blob) { bytes += resource.blob.size; entries += 1 }
      displayLeases += resource.displayLeases
      if (resource.display?.objectUrl) urls += 1
    }
    stats.residentBlobBytes = bytes
    stats.entryCount = entries
    stats.reservedFetchBytes = activeFetch * reserveFetchBytes
    stats.activeFetch = activeFetch
    stats.activeDecode = activeDecode
    stats.estimatedDecodedBytes = (displayLeases + activeDecode) * decodeBytesPerLease
    stats.queuedKeys = queue.length
    stats.activeDisplayLeases = displayLeases
    stats.objectUrlCount = urls
  }
  const notify = resource => { for (const lease of resource.leases) for (const listener of lease.listeners) { try { listener(snapshot(lease)) } catch (error) { console.error('Image resource listener failed', error) } } }
  const snapshot = lease => {
    const resource = lease.resource
    if (lease.released || resource.status === 'closed') return { status: 'closed' }
    if (lease.role === 'display' && !lease.admitted) return { status: 'deferred' }
    if (resource.status === 'error') return { status: 'error', error: resource.error }
    if (resource.status !== 'ready') return { status: resource.status }
    if (lease.role === 'prefetch') return { status: 'ready', blob: resource.blob }
    const display = resource.display
    if (!display || !display.objectUrl || !display.decoded) return { status: 'loading' }
    return { status: 'ready', blob: resource.blob, objectUrl: display.objectUrl, width: display.width, height: display.height }
  }
  const closeResource = resource => {
    if (resource.status === 'closed') return
    resource.status = 'closed'
    if (resource.controller) resource.controller.abort()
    if (resource.display?.objectUrl) { URL.revokeObjectURL(resource.display.objectUrl); resource.display.objectUrl = null; resource.display.canceled = true; resource.display.controller.abort() }
    resource.blob = null
    resource.pending = null
    resource.size = 0
    for (const lease of resource.leases) lease.closed = true
    resources.delete(resource.key)
    refreshStats()
    notify(resource)
    for (const lease of resource.leases) lease.listeners.clear()
    resource.leases = []
    resource.displayLeases = 0
  }
  const evict = neededBytes => {
    while (stats.residentBlobBytes + neededBytes > maxBytes) {
      const candidates = [...resources.values()].filter(resource => resource.blob && !resource.leases.length)
      if (!candidates.length) return false
      candidates.sort((a, b) => a.lastUsed - b.lastUsed || (a.key < b.key ? -1 : 1))
      const resource = candidates[0]
      resource.blob = null; resource.size = 0
      stats.evict += 1
      closeResource(resource)
      refreshStats()
    }
    return true
  }
  const scheduleDecode = () => {
    while (!closed && activeDecode < maxDecode && decodeQueue.length) {
      const item = decodeQueue.shift()
      if (item.display.canceled || item.resource.display !== item.display || item.resource.status !== 'ready') continue
      activeDecode += 1; refreshStats()
      void Promise.resolve().then(() => decode(item.resource.blob, { signal: item.display.controller.signal, objectUrl: item.display.objectUrl })).then(({ width, height } = {}) => {
        if (closed || item.resource.status !== 'ready' || item.display.canceled || item.resource.display !== item.display) return
        item.resource.display.width = width; item.resource.display.height = height; item.resource.display.decoded = true
        notify(item.resource)
      }).catch(error => {
        if (closed || item.resource.status !== 'ready' || item.display.canceled || item.resource.display !== item.display) return
        item.resource.status = 'error'; item.resource.error = error
        notify(item.resource)
      }).finally(() => { if (!closed) { activeDecode -= 1; refreshStats(); scheduleDecode(); scheduleFetch() } })
    }
    refreshStats()
  }
  const ensureDisplay = resource => {
    if ((!resource.display || resource.display.canceled) && resource.blob) {
      if (resource.display?.objectUrl) URL.revokeObjectURL(resource.display.objectUrl)
      resource.display = { objectUrl: URL.createObjectURL(resource.blob), width: undefined, height: undefined, decoded: !decode, canceled: false, controller: new AbortController() }
      if (decode) decodeQueue.push({ resource, display: resource.display }); else notify(resource)
      scheduleDecode()
    }
  }
  const startFetch = resource => {
    activeFetch += 1
    resource.status = 'loading'
    const controller = new AbortController()
    resource.controller = controller
    const generation = resource.currentGeneration
    let settled = false
    const settle = () => {
      if (closed || settled) return
      settled = true
      activeFetch -= 1
      resource.controller = null
      refreshStats()
    }
    refreshStats()
    void Promise.resolve().then(() => fetchWithRetry(resource.src, { signal: controller.signal })).then(blob => {
      if (closed || resource.status === 'closed' || generation !== resource.currentGeneration) return
      if (!(blob instanceof Blob) || blob.size > reserveFetchBytes) throw new Error('图片响应超过预留预算。')
      settle()
      resource.blob = blob
      resource.lastUsed = clock()
      resource.status = 'ready'
      if (resource.displayLeases) ensureDisplay(resource)
      refreshStats()
      notify(resource)
    }).catch(error => {
      if (closed || resource.status === 'closed' || generation !== resource.currentGeneration) return
      resource.status = 'error'; resource.error = error
      notify(resource)
    }).finally(() => {
      if (closed) return
      settle()
      scheduleFetch()
    })
  }
  const reserveEntry = () => {
    while (stats.entryCount + activeFetch >= maxEntries) {
      const candidates = [...resources.values()].filter(item => item.blob && !item.leases.length)
      if (!candidates.length) return false
      candidates.sort((a, b) => a.lastUsed - b.lastUsed || (a.key < b.key ? -1 : 1))
      stats.evict += 1
      closeResource(candidates[0])
      refreshStats()
    }
    return true
  }
  const admitDisplays = () => {
    refreshStats()
    const waiting = [...resources.values()].flatMap(resource => resource.leases)
      .filter(lease => lease.role === 'display' && !lease.admitted && !lease.closed)
      .sort((a, b) => ({ interaction: 3, visible: 2, normal: 1 }[b.priority] ?? 0) - ({ interaction: 3, visible: 2, normal: 1 }[a.priority] ?? 0))
    for (const lease of waiting) {
      if (closed || lease.released || lease.closed || resources.get(lease.resource.key) !== lease.resource || !lease.resource.leases.includes(lease)) continue
      // Keep room for all probe slots to avoid admission starving decode work.
      const probeSlots = decode ? maxDecode : 0
      if (stats.activeDisplayLeases >= maxDisplayLeases ||
          (stats.activeDisplayLeases + 1 + probeSlots) * decodeBytesPerLease > maxDecodedBytes) break
      lease.admitted = true
      lease.resource.displayLeases += 1
      refreshStats()
      if (lease.resource.blob) ensureDisplay(lease.resource)
      notify(lease.resource)
    }
  }
  const yieldPrefetch = (activeOnly = false) => {
    const victim = [...resources.values()].filter(resource =>
      resource.leases.length && resource.leases.every(lease => lease.role === 'prefetch') && (activeOnly ? resource.controller : (resource.blob || resource.controller)))
      .sort((a, b) => a.lastUsed - b.lastUsed || a.order - b.order)[0]
    if (!victim) return false
    if (victim.controller) stats.abort += 1
    closeResource(victim)
    refreshStats()
    return true
  }
  const priorityOf = resource => Math.max(...resource.leases.map(lease =>
    (lease.role === 'display' ? 10 : 0) + ({ interaction: 3, visible: 2, normal: 1, prefetch: 0 }[lease.priority] ?? 1)))
  let scheduling = false, reschedule = false
  const scheduleFetch = () => {
    if (closed) return
    if (scheduling) { reschedule = true; return }
    scheduling = true
    try {
      do {
        reschedule = false
        admitDisplays()
        const pending = [...resources.values()].filter(resource =>
          !resource.blob && !resource.controller && ['queued', 'deferred'].includes(resource.status))
        for (const resource of pending.filter(item => !item.leases.length)) closeResource(resource)
        const candidates = pending.filter(item => item.leases.length && item.status !== 'closed')
          .sort((a, b) => priorityOf(b) - priorityOf(a) || a.order - b.order)
        const changes = []
        queue.length = 0
        for (const resource of candidates) {
          const hasDemand = resource.displayLeases || resource.leases.some(lease => lease.role === 'prefetch')
          const status = hasDemand && queue.length < maxQueued ? 'queued' : 'deferred'
          if (resource.status !== status) changes.push(resource)
          resource.status = status
          if (status === 'queued') queue.push(resource)
        }
        refreshStats()
        if (activeFetch >= maxFetch && queue[0]?.displayLeases) yieldPrefetch(true)
        while (!closed && activeFetch < maxFetch && queue.length) {
          const resource = queue[0]
          if (resources.get(resource.key) !== resource || !resource.leases.length) { queue.shift(); continue }
          if (!reserveEntry()) { if (resource.displayLeases && yieldPrefetch()) reschedule = true; break }
          const needed = stats.reservedFetchBytes + reserveFetchBytes
          if (!evict(needed)) { if (resource.displayLeases && yieldPrefetch()) reschedule = true; break }
          queue.shift()
          startFetch(resource)
          // Refill the bounded queue from deferred demand after taking a slot.
          reschedule = true
        }
        refreshStats()
        for (const resource of changes) if (resources.get(resource.key) === resource) notify(resource)
      } while (reschedule && !closed)
    } finally { scheduling = false }
  }

  function acquire({ src, priority = 'normal', role = 'display' } = {}) {
    if (closed) throw new Error('图片资源池已关闭。')
    if (role !== 'display' && role !== 'prefetch') throw new TypeError('资源角色必须是 display 或 prefetch。')
    const normalized = mediaSource(src)
    const key = scopeEpoch + normalized
    let resource = resources.get(key)
    if (resource?.status === 'error' && !resource.leases.length) { resources.delete(key); resource = null }
    if (!resource) {
      stats.miss += 1
      resource = { order: nextOrder++, key, src: normalized, status: 'queued', blob: null, size: 0, error: null, display: null, displayLeases: 0, leases: [], generation: 0, currentGeneration: 0, pending: null, controller: null, lastUsed: clock(), priority }
      resources.set(key, resource)
    } else if (resource.blob) stats.hit += 1
    resource.lastUsed = clock()
    resource.priority = priority
    const lease = {
      resource, role, priority, admitted: false, listeners: new Set(), released: false, closed: false,
      getSnapshot: () => snapshot(lease),
      subscribe: listener => { if (typeof listener !== 'function') throw new TypeError('listener must be a function'); lease.listeners.add(listener); listener(snapshot(lease)); return () => lease.listeners.delete(listener) },
      release: () => {
        if (lease.released) return
        lease.released = true
        lease.listeners.clear()
        if (lease.closed) return
        resource.leases = resource.leases.filter(item => item !== lease)
        if (role === 'display' && lease.admitted) {
          resource.displayLeases -= 1
          if (!resource.displayLeases && resource.display?.objectUrl) {
            URL.revokeObjectURL(resource.display.objectUrl)
            resource.display.objectUrl = null; resource.display.canceled = true; resource.display.controller.abort()
          }
        }
        if (!resource.leases.length && !resource.blob && resource.controller) {
          resource.currentGeneration += 1
          resource.controller.abort()
          stats.abort += 1
          resources.delete(resource.key)
        }
        refreshStats()
        scheduleFetch()
      }
    }
    resource.leases.push(lease)
    scheduleFetch()
    refreshStats()
    return lease
  }

  function invalidateSources(urls) {
    if (closed) return
    const targets = new Set((Array.isArray(urls) ? urls : [urls]).map(mediaSource))
    // Subscribers may reacquire during notification; only invalidate the initial set.
    const invalidated = [...resources.values()].filter(resource => targets.has(resource.src))
    for (const resource of invalidated) {
      resource.currentGeneration += 1
      stats.abort += resource.controller ? 1 : 0
      closeResource(resource)
    }
    scheduleFetch()
  }

  function dispose() {
    if (closed) return
    closed = true
    for (const resource of resources.values()) closeResource(resource)
    queue.length = 0; decodeQueue.length = 0; activeFetch = 0; activeDecode = 0
    for (const key of Object.keys(stats)) stats[key] = 0
  }

  refreshStats()
  return {
    acquire, invalidateSources, dispose,
    getStats: () => ({ ...stats }),
    isClosed: () => closed,
  }
}
