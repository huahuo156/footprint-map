import { afterEach, expect, it, vi } from 'vitest'
import { createImageResourceSession } from '../src/journal/images/imageResourceSession.js'

afterEach(() => vi.useRealTimers())

it('never extends cache lifetime when validation succeeds halfway through its TTL', async () => {
  const h = setup()
  await vi.advanceTimersByTimeAsync(30000)
  expect(await h.session.validate()).toBe(true)
  await vi.advanceTimersByTimeAsync(30000)
  expect(h.caches[0].dispose).toHaveBeenCalledOnce()
  expect(h.session.getCache()).not.toBe(h.caches[0])
  h.session.dispose()
})

it('closes expired caches before starting a hanging check when the timer was delayed', async () => {
  const h = setup(() => new Promise(() => {}))
  vi.setSystemTime(Date.now() + 60001)
  void h.session.validate()
  expect(h.caches[0].dispose).toHaveBeenCalledOnce()
  h.session.dispose()
})

it.each(['dispose', 'reset'])('rejects success when a cache subscriber triggers %s reentrantly', async action => {
  const h = setup()
  h.reset()
  h.session.subscribe(() => {
    if (h.session.getCache()) {
      if (action === 'dispose') h.session.dispose()
      else h.reset()
    }
  })
  expect(await h.session.validate()).toBe(false)
  expect(h.session.getCache()).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  h.session.dispose()
})
function setup(checkSession = async () => ({ user: { id: 'owner' } })) {
  vi.useFakeTimers()
  let epoch = 1, reset
  const caches = []
  const unsubscribe = vi.fn()
  const check = vi.fn(checkSession)
  const session = createImageResourceSession({ ownerId: 'owner', checkSession: check,
    getEpoch: () => epoch, subscribeReset: callback => { reset = callback; return unsubscribe },
    createCache: scope => { const cache = { scope, dispose: vi.fn() }; caches.push(cache); return cache },
  })
  return { session, caches, check, unsubscribe, reset: () => { epoch++; reset() } }
}

it('denies resources on reset until the owner is confirmed, and cleans up once', async () => {
  const h = setup()
  expect(h.session.getCache()).toBe(h.caches[0])
  h.reset()
  expect(h.caches[0].dispose).toHaveBeenCalledOnce()
  expect(h.session.getCache()).toBeNull()
  expect(h.caches).toHaveLength(1)
  expect(await h.session.validate()).toBe(true)
  expect(h.session.getCache()).toBe(h.caches[1])
  expect(h.caches[1].scope).toMatchObject({ ownerId: 'owner', apiEpoch: 2 })
  h.session.dispose(); h.session.dispose()
  expect(h.unsubscribe).toHaveBeenCalledOnce()
  expect(h.caches[1].dispose).toHaveBeenCalledOnce()
  expect(h.session.getCache()).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('shares checks and reuses validation only within its TTL', async () => {
  let resolve
  const h = setup(() => new Promise(done => { resolve = done }))
  const first = h.session.validate()
  expect(h.session.validate()).toBe(first)
  await Promise.resolve()
  resolve({ user: { id: 'owner' } })
  expect(await first).toBe(true)
  expect(await h.session.validate()).toBe(true)
  expect(h.check).toHaveBeenCalledOnce()
  h.session.dispose()
})

it('expires held resources with one timer and requires explicit recovery after failure', async () => {
  const h = setup(async () => { throw new Error('offline') })
  await vi.advanceTimersByTimeAsync(60000)
  expect(h.session.getCache()).toBeNull()
  expect(h.caches[0].dispose).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  h.check.mockResolvedValue({ user: { id: 'owner' } })
  expect(await h.session.validate()).toBe(true)
  expect(h.session.getCache()).toBe(h.caches[1])
  expect(vi.getTimerCount()).toBe(1)
  h.session.dispose()
})

it.each(['reject', 'resolve'])('ignores old validation %s after a reset', async outcome => {
  let resolve, reject
  const h = setup(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  const pending = h.session.validate()
  await Promise.resolve()
  h.reset()
  if (outcome === 'reject') reject(Object.assign(new Error('expired'), { status: 401 }))
  else resolve({ user: { id: 'owner' } })
  expect(await pending).toBe(false)
  expect(h.session.getCache()).toBeNull()
  expect(h.caches).toHaveLength(1)
  h.session.dispose()
})

it('notifies subscribers after cache changes and releases listeners on disposal', async () => {
  const h = setup()
  const snapshots = []
  const unsubscribe = h.session.subscribe(() => snapshots.push(h.session.getCache()))
  h.reset()
  expect(snapshots).toEqual([null])
  await h.session.validate()
  expect(snapshots).toEqual([null, h.caches[1]])
  unsubscribe()
  h.session.dispose()
  expect(snapshots).toHaveLength(2)
})

it('rejects a different owner and prevents late validation after disposal', async () => {
  const h = setup(async () => ({ user: { id: 'other' } }))
  expect(await h.session.validate()).toBe(false)
  expect(h.session.getCache()).toBeNull()
  h.session.dispose()
  expect(await h.session.validate()).toBe(false)
  expect(h.check).toHaveBeenCalledOnce()
})

it('does not let an old unauthorized result clear a newly validated cache', async () => {
  let reject
  const h = setup(() => new Promise((_, no) => { reject = no }))
  const oldCheck = h.session.validate()
  await Promise.resolve()
  h.reset()
  h.check.mockResolvedValue({ user: { id: 'owner' } })
  expect(await h.session.validate()).toBe(true)
  const next = h.session.getCache()
  reject(Object.assign(new Error('unauthorized'), { status: 401 }))
  expect(await oldCheck).toBe(false)
  expect(h.session.getCache()).toBe(next)
  expect(next.dispose).not.toHaveBeenCalled()
  h.session.dispose()
})

it('closes resources at expiry even while validation hangs, and ignores late disposal results', async () => {
  let resolve
  const h = setup(() => new Promise(done => { resolve = done }))
  const pending = h.session.validate()
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(60000)
  expect(h.session.getCache()).toBeNull()
  expect(h.caches[0].dispose).toHaveBeenCalledOnce()
  h.session.dispose()
  resolve({ user: { id: 'owner' } })
  expect(await pending).toBe(false)
  expect(h.caches).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
})
