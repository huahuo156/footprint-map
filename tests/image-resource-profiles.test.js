import { expect, it } from 'vitest'
import { desktop, tablet, chooseImageResourceProfile, createCanvasImageCache } from '../src/journal/images/imageResourceProfiles.js'

it('exports immutable desktop and tablet resource budgets', () => {
  expect(desktop).toEqual({ maxBytes: 24 * 1024 ** 2, maxEntries: 512, maxFetch: 4, maxDecode: 2, maxQueued: 64, maxDisplayLeases: 48, maxDecodedBytes: 64 * 1024 ** 2, decodeBytesPerLease: 1024 ** 2, reserveFetchBytes: 2 * 1024 ** 2 })
  expect(tablet).toEqual({ maxBytes: 12 * 1024 ** 2, maxEntries: 256, maxFetch: 2, maxDecode: 1, maxQueued: 32, maxDisplayLeases: 24, maxDecodedBytes: 32 * 1024 ** 2, decodeBytesPerLease: 1024 ** 2, reserveFetchBytes: 2 * 1024 ** 2 })
  expect(Object.isFrozen(desktop)).toBe(true)
  expect(Object.isFrozen(tablet)).toBe(true)
})

it.each([[1024, false, 'tablet'], [1025, false, 'desktop'], [1920, true, 'tablet'], [400, false, 'tablet']])('selects a profile for width %s and coarse pointer %s', (width, coarsePointer, expected) => {
  expect(chooseImageResourceProfile({ width, coarsePointer })).toBe(expected)
})

it('creates a cache with injected adapters and a chosen fixed profile', async () => {
  const blob = new Blob(['image'])
  let calls = 0
  const cache = createCanvasImageCache({
    scope: { ownerId: 'test' }, profile: 'tablet',
    fetchMedia: async () => { calls++; return blob },
    decode: async () => ({ width: 100, height: 100 }),
  })
  const lease = cache.acquire({ src: '/uploads/a.jpg', role: 'prefetch' })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(calls).toBe(1)
  expect(lease.getSnapshot().status).toBe('ready')
  cache.dispose()
})
