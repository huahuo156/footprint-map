import { describe, expect, it, vi } from 'vitest'
import { createImageDimensionStore } from '../src/journal/images/imageDimensionStore.js'

function setup(options = {}) {
  const frames = []
  const store = createImageDimensionStore({ ...options, requestFrame: callback => (frames.push(callback), frames.length), cancelFrame: () => {} })
  return { store, flush: () => frames.splice(0).forEach(callback => callback()) }
}

describe('image dimension store', () => {
  it('continues publishing dimensions to other subscribers when one throws', () => {
    const { store, flush } = setup()
    const observed = []
    const error = new Error('broken subscriber')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      store.subscribe(() => { throw error })
      store.subscribe(() => observed.push(store.get('a')))
      store.set('a', { width: 10, height: 20 })
      expect(flush).not.toThrow()
      expect(observed).toEqual([{ width: 10, height: 20 }])
      expect(logged).toHaveBeenCalledWith('Image dimension listener failed', error)
      store.set('a', { width: 30, height: 40 })
      flush()
      expect(observed).toEqual([{ width: 10, height: 20 }, { width: 30, height: 40 }])
    } finally {
      logged.mockRestore()
      store.dispose()
    }
  })

  it('canonicalizes private thumbnails and publishes once per frame with immutable dimensions', () => {
    const { store, flush } = setup()
    const observed = []
    store.subscribe(() => observed.push(store.get('/uploads/a.jpg')))
    const input = { width: 800, height: 600, blob: new Blob(['ignored']) }
    store.set('/uploads/a.jpg?thumbnail=1', input)
    input.width = 1
    store.set('https://example.org/photo.jpg', { width: 30, height: 20 })
    expect(observed).toEqual([])
    flush()
    expect(observed).toEqual([{ width: 800, height: 600 }])
    expect(Object.isFrozen(store.get('/uploads/a.jpg'))).toBe(true)
    store.set('/uploads/a.jpg', { width: 800, height: 600 })
    flush()
    expect(observed).toHaveLength(1)
    expect(store.get('https://example.org/photo.jpg')).toEqual({ width: 30, height: 20 })
  })

  it('rejects invalid identities and dimensions without publications', () => {
    const { store, flush } = setup()
    let count = 0
    store.subscribe(() => count++)
    for (const value of [0, -1, Infinity, NaN, 32769, '10']) store.set('a', { width: value, height: 10 })
    for (const src of ['', '  ', null, new Blob()]) store.set(src, { width: 10, height: 10 })
    flush()
    expect(count).toBe(0)
    expect(store.getStats().entries).toBe(0)
  })

  it('evicts least recently read entries and bounds even a requested oversized capacity', () => {
    const { store } = setup({ maxEntries: 2 })
    store.set('a', { width: 1, height: 1 })
    store.set('b', { width: 2, height: 2 })
    store.get('a')
    store.set('c', { width: 3, height: 3 })
    expect(store.get('b')).toBeUndefined()
    expect(store.get('a')).toEqual({ width: 1, height: 1 })
    const larger = setup({ maxEntries: 99999 }).store
    for (let i = 0; i < 4100; i++) larger.set(String(i), { width: 1, height: 1 })
    expect(larger.getStats().entries).toBe(4096)
    expect(larger.get('0')).toBeUndefined()
  })

  it('invalidates canonical sources and suppresses stale callbacks even when cancellation loses a race', () => {
    const { store, flush } = setup()
    const observed = []
    store.subscribe(() => observed.push(store.get('/uploads/a.jpg')))
    store.set('/uploads/a.jpg', { width: 5, height: 4 })
    store.invalidateSources(['/uploads/a.jpg?thumbnail=1'])
    flush()
    expect(observed).toEqual([undefined])
    expect(store.getStats().entries).toBe(0)
  })

  it('resets scope with one publication and never publishes after disposal', () => {
    const { store, flush } = setup({ scope: { ownerId: 1, apiEpoch: 2, mediaEpoch: 3 } })
    let count = 0
    const unsubscribe = store.subscribe(() => count++)
    store.set('a', { width: 1, height: 2 })
    store.resetScope({ ownerId: 2, apiEpoch: 2, mediaEpoch: 3 })
    expect(store.get('a')).toBeUndefined()
    flush()
    expect(count).toBe(1)
    unsubscribe()
    store.set('a', { width: 1, height: 2 })
    flush()
    expect(count).toBe(1)
    store.subscribe(() => count++)
    store.set('b', { width: 1, height: 2 })
    store.dispose()
    store.set('c', { width: 1, height: 2 })
    flush()
    expect(count).toBe(1)
    expect(store.getStats().entries).toBe(0)
  })
})
