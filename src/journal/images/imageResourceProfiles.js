import { fetchPrivateMedia } from '../../lib/privateMedia.js'
import { createImageResourceCache } from './imageResourceCache.js'
import { decodeMedia } from './decodeMedia.js'

const MiB = 1024 ** 2
export const desktop = Object.freeze({
  maxBytes: 24 * MiB, maxEntries: 512, maxFetch: 4, maxDecode: 2,
  maxQueued: 64, maxDisplayLeases: 48, maxDecodedBytes: 64 * MiB,
  decodeBytesPerLease: MiB, reserveFetchBytes: 2 * MiB,
})
export const tablet = Object.freeze({
  maxBytes: 12 * MiB, maxEntries: 256, maxFetch: 2, maxDecode: 1,
  maxQueued: 32, maxDisplayLeases: 24, maxDecodedBytes: 32 * MiB,
  decodeBytesPerLease: MiB, reserveFetchBytes: 2 * MiB,
})

export function chooseImageResourceProfile({ width, coarsePointer } = {}) {
  return coarsePointer || width <= 1024 ? 'tablet' : 'desktop'
}

// Choose once when constructing a cache; viewport changes do not mutate budgets.
export function createCanvasImageCache({ scope, profile = 'desktop', ...adapters } = {}) {
  const profiles = { desktop, tablet }
  if (!Object.hasOwn(profiles, profile)) throw new TypeError('Unknown image resource profile')
  return createImageResourceCache({
    scope, limits: profiles[profile],
    fetchMedia: fetchPrivateMedia, decode: decodeMedia,
    ...adapters,
  })
}
