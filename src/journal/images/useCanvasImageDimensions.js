import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getApiSessionEpoch, subscribeApiSessionReset } from '../../lib/api.js'
import { createImageDimensionStore } from './imageDimensionStore.js'

const sourceKey = src => /^\/uploads\/[\w-]+\.(jpg|png|webp)\?thumbnail=1$/.test(src) ? src.split('?')[0] : src
const EMPTY = Object.freeze({})
const requestFrameDefault = callback => requestAnimationFrame(callback)
const cancelFrameDefault = handle => cancelAnimationFrame(handle)

// Dimensions are scoped independently of layout; a load event only schedules a
// batched size publication and never submits a layout command.
export function useCanvasImageDimensions({ ownerId, mediaEpoch = 0, sources = [], requestFrame = requestFrameDefault, cancelFrame = cancelFrameDefault } = {}) {
  const apiEpoch = useSyncExternalStore(subscribeApiSessionReset, getApiSessionEpoch, getApiSessionEpoch)
  const token = useMemo(() => ({ store: null }), [ownerId, apiEpoch, mediaEpoch, requestFrame, cancelFrame])
  const sourceRef = useRef(new Set(sources))
  sourceRef.current = new Set(sources)
  const [state, setState] = useState(null)
  useEffect(() => {
    let alive = true
    const store = createImageDimensionStore({ scope: { ownerId, apiEpoch, mediaEpoch }, requestFrame, cancelFrame })
    token.store = store
    const publish = () => {
      if (!alive) return
      const entries = [...sourceRef.current].flatMap(src => {
        const dimensions = store.get(src)
        return dimensions ? [[src, dimensions]] : []
      })
      setState({ token, imageSizes: Object.fromEntries(entries) })
    }
    token.publish = publish
    const unsubscribe = store.subscribe(publish)
    return () => { alive = false; unsubscribe(); store.dispose(); if (token.store === store) token.store = null }
  }, [token, ownerId, apiEpoch, mediaEpoch, requestFrame, cancelFrame])
  const previousSources = useRef(new Set())
  useEffect(() => {
    const nextKeys = new Set([...sourceRef.current].map(sourceKey))
    const removed = [...previousSources.current].filter(src => !nextKeys.has(sourceKey(src)))
    const changed = previousSources.current.size !== sourceRef.current.size || [...previousSources.current].some(src => !sourceRef.current.has(src))
    previousSources.current = new Set(sourceRef.current)
    if (removed.length) token.store?.invalidateSources(removed)
    if (changed) token.publish?.()
  }, [sources, token])
  const recordDimensions = useCallback((src, dimensions) => {
    if (sourceRef.current.has(src)) token.store?.set(src, dimensions)
  }, [token])
  return { imageSizes: state?.token === token ? state.imageSizes : EMPTY, recordDimensions }
}
