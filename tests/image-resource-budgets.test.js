import { afterEach, expect, it, vi } from 'vitest'
import { createImageResourceCache } from '../src/journal/images/imageResourceCache.js'

const caches = []
afterEach(() => { caches.splice(0).forEach(cache => cache.dispose()); vi.restoreAllMocks() })
const blob = () => new Blob(['image'], { type: 'image/webp' })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve() }
const setup = (limits = {}, adapters = {}) => {
  const cache = createImageResourceCache({
    scope: { ownerId: 'budget-owner', apiEpoch: 1, mediaEpoch: 1 },
    limits: { maxFetch: 1, maxDecode: 1, reserveFetchBytes: 8, ...limits },
    fetchMedia: async () => blob(), ...adapters,
  })
  caches.push(cache)
  return cache
}
const acquire = (cache, id, options = {}) => cache.acquire({ src: `/uploads/${id}.jpg`, role: 'display', ...options })

it('keeps the unique queue bounded during acquisitions from admission subscribers', () => {
  const cache = setup({ maxDisplayLeases: 1, maxQueued: 1 }, { fetchMedia: () => new Promise(() => {}) })
  const first = acquire(cache, 'first')
  const waiting = acquire(cache, 'waiting')
  let acquired = false
  const samples = []
  waiting.subscribe(() => {
    if (acquired || first.getSnapshot().status !== 'closed') return
    acquired = true
    for (let index = 0; index < 5; index += 1) {
      acquire(cache, `prefetch-${index}`, { role: 'prefetch' })
      samples.push(cache.getStats().queuedKeys)
    }
  })
  first.release()
  expect(samples).toHaveLength(5)
  expect(Math.max(...samples)).toBeLessThanOrEqual(1)
  expect(cache.getStats().queuedKeys).toBeLessThanOrEqual(1)
})

it('does not admit a waiting lease released by another admission subscriber', async () => {
  const cache = setup({ maxDisplayLeases: 2 })
  const prefetch = acquire(cache, 'resident', { role: 'prefetch' })
  await flush()
  prefetch.release()
  acquire(cache, 'active-a')
  acquire(cache, 'active-b')
  const promoted = acquire(cache, 'promoted', { priority: 'visible' })
  const released = acquire(cache, 'resident')
  promoted.subscribe(() => {
    if (cache.getStats().activeDisplayLeases === 1) released.release()
  })
  cache.invalidateSources(['/uploads/active-a.jpg', '/uploads/active-b.jpg'])
  await flush()
  expect(released.getSnapshot().status).toBe('closed')
  expect(promoted.getSnapshot().status).toBe('ready')
  expect(cache.getStats()).toMatchObject({ activeDisplayLeases: 1, objectUrlCount: 1 })
  const next = acquire(cache, 'next')
  await flush()
  expect(next.getSnapshot().status).toBe('ready')
})

it('defaults to 48 admitted display leases and one MiB reservation per lease', async () => {
  const cache = setup()
  const leases = Array.from({ length: 49 }, (_, index) => acquire(cache, `default-${index}`))
  await flush()
  expect(cache.getStats()).toMatchObject({ activeDisplayLeases: 48, estimatedDecodedBytes: 48 * 1024 * 1024 })
  expect(leases[48].getSnapshot().status).toBe('deferred')
})

it('promotes waiting display leases after invalidation and skips released waiters', async () => {
  const cache = setup({ maxDisplayLeases: 1 })
  const first = acquire(cache, 'first')
  const released = acquire(cache, 'released')
  const next = acquire(cache, 'next')
  released.release()
  cache.invalidateSources(['/uploads/first.jpg'])
  await flush()
  expect(first.getSnapshot().status).toBe('closed')
  expect(released.getSnapshot().status).toBe('closed')
  expect(next.getSnapshot().status).toBe('ready')
  expect(cache.getStats().activeDisplayLeases).toBe(1)
})

it('counts shared-URL display leases separately and promotes excess demand after release', async () => {
  const cache = setup({ maxDisplayLeases: 2 })
  const first = acquire(cache, 'same')
  const second = acquire(cache, 'same')
  const third = acquire(cache, 'same')
  await flush()
  expect(first.getSnapshot().status).toBe('ready')
  expect(second.getSnapshot().objectUrl).toBe(first.getSnapshot().objectUrl)
  expect(third.getSnapshot().status).toBe('deferred')
  expect(cache.getStats()).toMatchObject({ activeDisplayLeases: 2, objectUrlCount: 1 })
  first.release()
  await flush()
  expect(third.getSnapshot().status).toBe('ready')
  expect(cache.getStats().activeDisplayLeases).toBe(2)
})

it('budgets admitted display reservations and active decode probes together', async () => {
  const decodeJob = deferred()
  const decode = vi.fn(() => decodeJob.promise)
  const cache = setup({ maxDecodedBytes: 30, decodeBytesPerLease: 10, maxDisplayLeases: 10 }, { decode })
  const leases = ['a', 'b', 'c'].map(id => acquire(cache, id))
  await flush()
  expect(cache.getStats()).toMatchObject({ activeDisplayLeases: 2, activeDecode: 1, estimatedDecodedBytes: 30 })
  expect(leases[2].getSnapshot().status).toBe('deferred')
  decodeJob.resolve({ width: 2, height: 2 })
  await flush()
  expect(cache.getStats().estimatedDecodedBytes).toBeLessThanOrEqual(30)
  leases[0].release()
  await flush()
  expect(leases[2].getSnapshot().status).toBe('ready')
  expect(cache.getStats().estimatedDecodedBytes).toBeLessThanOrEqual(30)
})

it('honors decode concurrency while reserving bytes for every active probe', async () => {
  const jobs = [deferred(), deferred(), deferred()]
  const decode = vi.fn(() => jobs[decode.mock.calls.length - 1].promise)
  const cache = setup({ maxFetch: 3, maxDecode: 2, maxDecodedBytes: 50, decodeBytesPerLease: 10 }, { decode })
  const leases = ['a', 'b', 'c'].map(id => acquire(cache, id))
  await flush()
  expect(decode).toHaveBeenCalledTimes(2)
  expect(cache.getStats()).toMatchObject({ activeDisplayLeases: 3, activeDecode: 2, estimatedDecodedBytes: 50 })
  jobs[0].resolve({ width: 2, height: 2 })
  await flush()
  expect(decode).toHaveBeenCalledTimes(3)
  expect(cache.getStats().estimatedDecodedBytes).toBeLessThanOrEqual(50)
  jobs[1].resolve({ width: 2, height: 2 }); jobs[2].resolve({ width: 2, height: 2 })
  await flush()
  expect(leases.every(lease => lease.getSnapshot().status === 'ready')).toBe(true)
})

it('bounds unique queued keys, shares queued demand, and promotes overflow', async () => {
  const job = deferred()
  const fetchMedia = vi.fn(() => fetchMedia.mock.calls.length === 1 ? job.promise : Promise.resolve(blob()))
  const cache = setup({ maxQueued: 1 }, { fetchMedia })
  acquire(cache, 'active', { role: 'prefetch' })
  const queued = acquire(cache, 'queued', { role: 'prefetch' })
  const shared = acquire(cache, 'queued', { role: 'prefetch' })
  const overflow = acquire(cache, 'overflow', { role: 'prefetch' })
  await flush()
  expect(cache.getStats().queuedKeys).toBe(1)
  expect(queued.getSnapshot().status).toBe('queued')
  expect(shared.getSnapshot().status).toBe('queued')
  expect(overflow.getSnapshot().status).toBe('deferred')
  job.resolve(blob())
  await flush()
  expect(overflow.getSnapshot().status).toBe('ready')
  expect(fetchMedia).toHaveBeenCalledTimes(3)
})

it('gives visible display demand priority over a full prefetch queue', async () => {
  const job = deferred()
  const fetchMedia = vi.fn(() => fetchMedia.mock.calls.length === 1 ? job.promise : Promise.resolve(blob()))
  const cache = setup({ maxQueued: 1 }, { fetchMedia })
  acquire(cache, 'active', { role: 'prefetch' })
  acquire(cache, 'prefetch', { role: 'prefetch', priority: 'prefetch' })
  const visible = acquire(cache, 'visible', { priority: 'visible' })
  await flush()
  expect(cache.getStats().queuedKeys).toBeLessThanOrEqual(1)
  job.resolve(blob())
  await flush()
  expect(visible.getSnapshot().status).toBe('ready')
  // Preemption may abort the active adapter before its first microtask starts.
  const requested = fetchMedia.mock.calls.map(([src]) => src)
  expect(requested.findIndex(src => src.includes('/uploads/visible.jpg'))).toBeLessThan(requested.findIndex(src => src.includes('/uploads/prefetch.jpg')))
})

it('removes released and invalidated queued demand before promoting live overflow', async () => {
  const job = deferred()
  const fetchMedia = vi.fn(() => fetchMedia.mock.calls.length === 1 ? job.promise : Promise.resolve(blob()))
  const cache = setup({ maxQueued: 1 }, { fetchMedia })
  acquire(cache, 'active', { role: 'prefetch' })
  const released = acquire(cache, 'released', { role: 'prefetch' })
  const invalidated = acquire(cache, 'invalidated', { role: 'prefetch' })
  const live = acquire(cache, 'live', { role: 'prefetch' })
  released.release()
  cache.invalidateSources(['/uploads/invalidated.jpg'])
  await flush()
  expect(invalidated.getSnapshot().status).toBe('closed')
  expect(cache.getStats().queuedKeys).toBeLessThanOrEqual(1)
  job.resolve(blob())
  await flush()
  expect(live.getSnapshot().status).toBe('ready')
  expect(fetchMedia).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(fetchMedia.mock.calls)).not.toMatch(/released|invalidated/)
})
