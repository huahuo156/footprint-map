import { afterEach, expect, it, vi } from 'vitest'
import { createImageResourceCache } from '../src/journal/images/imageResourceCache.js'

afterEach(vi.restoreAllMocks)
const blob = bytes => new Blob([new Uint8Array(bytes)], { type: 'image/webp' })
const createCache = (options = {}) => {
  const fetcher = vi.fn(async () => blob(options.bytes ?? 2))
  const cache = createImageResourceCache({
    scope: { ownerId: 'owner', apiEpoch: 1, mediaEpoch: 1 },
    limits: { maxFetch: 2, maxDecode: 1, maxEntries: 4, maxBytes: options.maxBytes ?? 1024, reserveFetchBytes: options.reserveFetchBytes ?? 4 },
    fetchMedia: fetcher,
    decode: options.decode,
    clock: options.clock,
    ...options.cache,
  })
  return { cache, fetcher }
}

it('shares one fetch between consumers of the same key', async () => {
  const { cache, fetcher } = createCache({ decode: async () => ({ width: 2, height: 1 }) })
  const first = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  const second = cache.acquire({ src: '/uploads/a.jpg?thumbnail=1', role: 'display' })
  await vi.waitFor(() => expect(first.getSnapshot()).toMatchObject({ status: 'ready', width: 2, height: 1 }))
  expect(second.getSnapshot()).toMatchObject({ status: 'ready', objectUrl: first.getSnapshot().objectUrl })
  expect(fetcher).toHaveBeenCalledOnce()
  first.release(); second.release()
  expect(cache.getStats().objectUrlCount).toBe(0)
})

it('reuses the resident blob without a new network request', async () => {
  const { cache, fetcher } = createCache({ decode: async () => ({ width: 2, height: 1 }) })
  const first = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  await vi.waitFor(() => expect(first.getSnapshot().status).toBe('ready'))
  const url = first.getSnapshot().objectUrl
  first.release()
  const second = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  expect(second.getSnapshot().status).toBe('loading')
  await vi.waitFor(() => expect(second.getSnapshot()).toMatchObject({ status: 'ready', width: 2, height: 1 }))
  expect(second.getSnapshot().objectUrl).not.toBe(url)
  expect(fetcher).toHaveBeenCalledOnce()
  second.release()
})

it('does not create URLs or decode for prefetch-only consumers', async () => {
  const decode = vi.fn(async () => ({ width: 2, height: 1 }))
  const { cache } = createCache({ decode })
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  await vi.waitFor(() => expect(lease.getSnapshot()).toMatchObject({ status: 'ready' }))
  expect(lease.getSnapshot().objectUrl).toBeUndefined()
  expect(decode).not.toHaveBeenCalled()
  expect(cache.getStats().activeDisplayLeases).toBe(0)
  lease.release()
})

it('shares a fetch across display and prefetch roles and keeps the other role alive', async () => {
  const { cache, fetcher } = createCache({ decode: async () => ({ width: 2, height: 1 }) })
  const prefetch = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  const display = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  await vi.waitFor(() => expect(display.getSnapshot()).toMatchObject({ status: 'ready', width: 2, height: 1 }))
  expect(fetcher).toHaveBeenCalledOnce()
  prefetch.release()
  expect(display.getSnapshot().status).toBe('ready')
  display.release()
})

it('defers a new fetch instead of evicting active leases', async () => {
  const { cache, fetcher } = createCache({ maxBytes: 4, reserveFetchBytes: 4, decode: async () => ({ width: 2, height: 1 }) })
  const first = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  await vi.waitFor(() => expect(first.getSnapshot().status).toBe('ready'))
  const second = cache.acquire({ src: '/uploads/b.jpg', role: 'display' })
  expect(second.getSnapshot().status).toBe('queued')
  expect(fetcher).toHaveBeenCalledOnce()
  first.release()
  await vi.waitFor(() => expect(second.getSnapshot().status).toBe('ready'))
  expect(fetcher).toHaveBeenCalledTimes(2)
  first.release(); second.release()
})

it('closes leases when a source is invalidated', async () => {
  const { cache, fetcher } = createCache({ decode: async () => ({ width: 2, height: 1 }) })
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  await vi.waitFor(() => expect(lease.getSnapshot().status).toBe('ready'))
  const listener = vi.fn()
  lease.subscribe(listener)
  cache.invalidateSources(['/uploads/a.jpg'])
  expect(lease.getSnapshot()).toMatchObject({ status: 'closed' })
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }))
  expect(cache.getStats().entryCount).toBe(0)
  lease.release()
  expect(fetcher).toHaveBeenCalledOnce()
})

it('rejects decode failures without retrying the transport', async () => {
  const { cache, fetcher } = createCache({ decode: async () => { throw new Error('decode failed') } })
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  await vi.waitFor(() => expect(lease.getSnapshot()).toMatchObject({ status: 'error' }))
  expect(fetcher).toHaveBeenCalledOnce()
  lease.release()
})

it('rejects new leases after dispose and zeroes observable counters', () => {
  const { cache } = createCache({ decode: async () => ({ width: 2, height: 1 }) })
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'display' })
  cache.dispose()
  expect(cache.isClosed()).toBe(true)
  expect(lease.getSnapshot()).toMatchObject({ status: 'closed' })
  expect(() => cache.acquire({ src: '/uploads/b.jpg' })).toThrow('图片资源池已关闭。')
  expect(cache.getStats()).toMatchObject({ residentBlobBytes: 0, entryCount: 0, activeFetch: 0, activeDecode: 0, queuedKeys: 0, activeDisplayLeases: 0, objectUrlCount: 0 })
  lease.release()
})

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }

it('starts queued work after a fetch completes without exceeding byte reservations', async () => {
  const jobs = [deferred(), deferred(), deferred()]
  let calls = 0
  const { cache } = createCache({ cache: {
    limits: { maxFetch: 2, maxBytes: 8, reserveFetchBytes: 4 },
    fetchMedia: () => jobs[calls++].promise,
  } })
  const leases = ['a', 'b', 'c'].map(id => cache.acquire({ src: `/uploads/${id}.jpg`, role: 'prefetch' }))
  await flush()
  expect(calls).toBe(2)
  jobs[0].resolve(blob(4))
  await flush()
  expect(calls).toBe(2)
  expect(cache.getStats().residentBlobBytes + cache.getStats().reservedFetchBytes).toBeLessThanOrEqual(8)
  leases[0].release()
  await flush()
  expect(calls).toBe(3)
  jobs[1].resolve(blob(4)); jobs[2].resolve(blob(4))
  await flush()
  expect(cache.getStats().residentBlobBytes + cache.getStats().reservedFetchBytes).toBeLessThanOrEqual(8)
  cache.dispose()
})

it('automatically drains a concurrency-limited queue', async () => {
  const first = deferred()
  let calls = 0
  const { cache } = createCache({ cache: {
    limits: { maxFetch: 1, reserveFetchBytes: 4 },
    fetchMedia: () => ++calls === 1 ? first.promise : Promise.resolve(blob(2)),
  } })
  cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  const second = cache.acquire({ src: '/uploads/b.jpg', role: 'prefetch' })
  await flush(); first.resolve(blob(2)); await flush()
  expect(second.getSnapshot().status).toBe('ready')
  cache.dispose()
})

it('does not publish an old decode into a reacquired display lease', async () => {
  const jobs = [deferred(), deferred()]
  let calls = 0
  const { cache } = createCache({ decode: () => jobs[calls++].promise })
  const first = cache.acquire({ src: '/uploads/a.jpg' })
  await flush(); first.release()
  const second = cache.acquire({ src: '/uploads/a.jpg' })
  jobs[0].resolve({ width: 99, height: 99 }); await flush()
  expect(second.getSnapshot().status).toBe('loading')
  jobs[1].resolve({ width: 2, height: 1 }); await flush()
  expect(second.getSnapshot()).toMatchObject({ status: 'ready', width: 2 })
  cache.dispose()
})

it('keeps disposed counters zero when uncancellable jobs settle late', async () => {
  const job = deferred()
  const { cache } = createCache({ cache: { fetchMedia: () => job.promise } })
  cache.acquire({ src: '/uploads/a.jpg' })
  await flush(); cache.dispose(); job.resolve(blob(2)); await flush()
  expect(cache.getStats()).toMatchObject({ activeFetch: 0, activeDecode: 0, residentBlobBytes: 0 })
})

it('never reports blob bytes and their completed fetch reservation together', async () => {
  const { cache } = createCache({ maxBytes: 4, reserveFetchBytes: 4, bytes: 4 })
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  const samples = []
  lease.subscribe(() => {
    const stats = cache.getStats()
    samples.push(stats.residentBlobBytes + stats.reservedFetchBytes)
  })
  await flush()
  expect(Math.max(...samples)).toBeLessThanOrEqual(4)
  cache.dispose()
})

it('clears cache-owned blob references before notifying closed leases', async () => {
  const { cache } = createCache()
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  await flush()
  expect(lease.resource.blob).toBeInstanceOf(Blob)
  let retainedAtClose
  lease.subscribe(snapshot => {
    if (snapshot.status === 'closed') retainedAtClose = lease.resource.blob
  })
  cache.invalidateSources(['/uploads/a.jpg'])
  expect(retainedAtClose).toBeNull()
  expect(lease.resource.blob).toBeNull()
  expect(lease.resource.leases).toHaveLength(0)
  lease.release()
  cache.dispose()
})

it('reserves entry slots for in-flight requests and defers while entries are leased', async () => {
  const jobs = [deferred(), deferred()]
  let calls = 0
  const { cache } = createCache({ cache: {
    limits: { maxEntries: 1, maxFetch: 2, reserveFetchBytes: 4 },
    fetchMedia: () => jobs[calls++].promise,
  } })
  const first = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  const second = cache.acquire({ src: '/uploads/b.jpg', role: 'prefetch' })
  await flush()
  expect(calls).toBe(1)
  jobs[0].resolve(blob(2)); await flush()
  expect(first.getSnapshot().status).toBe('ready')
  expect(second.getSnapshot().status).toBe('queued')
  expect(cache.getStats().entryCount).toBe(1)
  first.release(); await flush()
  expect(calls).toBe(2)
  expect(cache.getStats().entryCount).toBe(0)
  jobs[1].resolve(blob(2)); await flush()
  expect(second.getSnapshot().status).toBe('ready')
  expect(cache.getStats().entryCount).toBe(1)
  cache.dispose()
})

it('disposal clears blob and subscription references held by outstanding leases', async () => {
  const { cache } = createCache()
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  await flush()
  const listener = vi.fn()
  lease.subscribe(listener)
  cache.dispose()
  expect(lease.resource.blob).toBeNull()
  expect(lease.resource.pending).toBeNull()
  expect(lease.resource.leases).toHaveLength(0)
  expect(lease.listeners.size).toBe(0)
  expect(listener).toHaveBeenLastCalledWith({ status: 'closed' })
  lease.release(); lease.release()
  expect(cache.getStats().activeDisplayLeases).toBe(0)
})

it('holds an aborted in-flight entry reservation until the adapter settles', async () => {
  const jobs = [deferred(), deferred()]
  let calls = 0
  const { cache } = createCache({ cache: {
    limits: { maxEntries: 1, maxFetch: 2, reserveFetchBytes: 4 },
    fetchMedia: () => jobs[calls++].promise,
  } })
  const first = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  await flush(); first.release()
  const second = cache.acquire({ src: '/uploads/b.jpg', role: 'prefetch' })
  await flush()
  expect(calls).toBe(1)
  jobs[0].resolve(blob(2)); await flush()
  expect(calls).toBe(2)
  expect(cache.getStats().entryCount).toBe(0)
  jobs[1].resolve(blob(2)); await flush()
  expect(second.getSnapshot().status).toBe('ready')
  cache.dispose()
})

it('does not invalidate a replacement lease acquired by a closed subscriber', async () => {
  const { cache } = createCache()
  const first = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  await flush()
  let replacement
  first.subscribe(snapshot => {
    if (snapshot.status === 'closed') replacement = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  })
  cache.invalidateSources(['/uploads/a.jpg'])
  await flush()
  expect(replacement.getSnapshot().status).toBe('ready')
  cache.dispose()
})

it('bounds queued unique keys and promotes overflow after capacity returns', async () => {
  const job = deferred()
  const { cache } = createCache({ cache: {
    limits: { maxFetch: 1, maxQueued: 1, reserveFetchBytes: 4 },
    fetchMedia: () => job.promise,
  } })
  cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  cache.acquire({ src: '/uploads/b.jpg', role: 'prefetch' })
  const overflow = cache.acquire({ src: '/uploads/c.jpg', role: 'prefetch' })
  expect(cache.getStats().queuedKeys).toBe(1)
  expect(overflow.getSnapshot().status).toBe('deferred')
  cache.dispose()
  job.resolve(blob(2)); await flush()
})

it('defers display leases beyond their hard cap and promotes on release', async () => {
  const { cache } = createCache({ cache: { limits: { maxDisplayLeases: 1, reserveFetchBytes: 4 } } })
  const first = cache.acquire({ src: '/uploads/a.jpg' })
  const second = cache.acquire({ src: '/uploads/a.jpg' })
  await flush()
  expect(cache.getStats().activeDisplayLeases).toBe(1)
  expect(second.getSnapshot().status).toBe('deferred')
  first.release(); await flush()
  expect(second.getSnapshot().status).toBe('ready')
  cache.dispose()
})

it('shares transport retry backoff across consumers and cancels on last release', async () => {
  vi.useFakeTimers()
  try {
    let calls = 0
    const { cache } = createCache({ cache: { fetchMedia: async () => {
      calls += 1
      if (calls < 3) throw Object.assign(new Error('busy'), { status: 503 })
      return blob(2)
    } } })
    const first = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
    const second = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
    await flush()
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(800)
    expect(calls).toBe(2)
    first.release(); second.release()
    await vi.advanceTimersByTimeAsync(1600)
    expect(calls).toBe(2)
    cache.dispose()
  } finally { vi.useRealTimers() }
})

it('aborts decode probes when their last display consumer leaves', async () => {
  const job = deferred()
  let signal
  const { cache } = createCache({ decode: (_blob, options) => {
    signal = options?.signal
    return job.promise
  } })
  const lease = cache.acquire({ src: '/uploads/a.jpg' })
  await flush()
  expect(signal).toBeInstanceOf(AbortSignal)
  lease.release()
  expect(signal.aborted).toBe(true)
  job.resolve({ width: 2, height: 1 }); await flush()
  expect(cache.getStats()).toMatchObject({ activeDecode: 0, objectUrlCount: 0 })
  cache.dispose()
})

it('yields active prefetch to display demand without releasing its reservation before settlement', async () => {
  const job = deferred()
  let prefetchSignal
  const { cache } = createCache({ cache: {
    limits: { maxFetch: 1, maxBytes: 8, reserveFetchBytes: 4 },
    fetchMedia: (src, { signal }) => {
      if (src.includes('prefetch')) { prefetchSignal = signal; return job.promise }
      return Promise.resolve(blob(2))
    },
  } })
  const prefetch = cache.acquire({ src: '/uploads/prefetch.jpg', role: 'prefetch' })
  await flush()
  const display = cache.acquire({ src: '/uploads/visible.jpg' })
  expect(prefetchSignal.aborted).toBe(true)
  expect(prefetch.getSnapshot().status).toBe('closed')
  expect(cache.getStats().activeFetch).toBe(1)
  job.resolve(blob(2)); await flush()
  expect(display.getSnapshot().status).toBe('ready')
  cache.dispose()
})

it('reclaims prefetched blobs before deferring visible images on byte pressure', async () => {
  const { cache } = createCache({ maxBytes: 4, reserveFetchBytes: 4, bytes: 4 })
  const prefetch = cache.acquire({ src: '/uploads/prefetch.jpg', role: 'prefetch' })
  await flush()
  const display = cache.acquire({ src: '/uploads/visible.jpg' })
  await flush()
  expect(prefetch.getSnapshot().status).toBe('closed')
  expect(display.getSnapshot().status).toBe('ready')
  expect(cache.getStats().residentBlobBytes).toBe(4)
  cache.dispose()
})

it('passes its display URL to the probe for the same browser image resource identity', async () => {
  let probeUrl
  const { cache } = createCache({ decode: async (_blob, options) => { probeUrl = options.objectUrl; return { width: 2, height: 1 } } })
  const lease = cache.acquire({ src: '/uploads/a.jpg' })
  await flush()
  expect(probeUrl).toBe(lease.getSnapshot().objectUrl)
  expect(probeUrl).toMatch(/^blob:/)
  cache.dispose()
})
