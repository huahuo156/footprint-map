import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createCanvasImageCache } from './imageResourceProfiles.js'
import { createImageResourceSession } from './imageResourceSession.js'

const ImageResourceContext = createContext(undefined)
const EMPTY_SOURCES = Object.freeze([])
const DEFERRED = Object.freeze({ status: 'deferred' })
const isPrivate = src => typeof src === 'string' && /^\/uploads\/[\w-]+\.(jpg|png|webp)(\?thumbnail=1)?$/.test(src)
const privateSources = sources => new Set(sources.filter(isPrivate).map(src => src.split('?')[0]))

export function ImageResourceProvider({ enabled = true, ownerId, mediaEpoch = 0, profile = 'desktop', mediaSources = EMPTY_SOURCES, children, createSession = createImageResourceSession }) {
  const token = useMemo(() => ({}), [enabled, ownerId, mediaEpoch, profile, createSession])
  const [state, setState] = useState(null)
  const sources = useRef(privateSources(mediaSources))
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const session = createSession({ ownerId, createCache: scope => createCanvasImageCache({ scope: { ...scope, mediaEpoch: `${mediaEpoch}:${scope.mediaEpoch}` }, profile }) })
    const update = () => {
      if (!alive) return
      const cache = session.getCache()
      setState({ token, ownerId, mediaEpoch, profile, createSession, cache })
      if (!cache) void session.validate()
    }
    const unsubscribe = session.subscribe(update)
    update()
    const focus = () => { if (alive) void session.validate() }
    const visible = () => { if (document.visibilityState === 'visible') focus() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    return () => {
      alive = false
      unsubscribe()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visible)
      session.dispose()
    }
  }, [token, enabled, ownerId, mediaEpoch, profile, createSession])
  const cache = !enabled ? undefined : state?.token === token && state?.ownerId === ownerId && state?.mediaEpoch === mediaEpoch && state?.profile === profile && state?.createSession === createSession ? state.cache : null
  useEffect(() => {
    const next = privateSources(mediaSources)
    const removed = [...sources.current].filter(src => !next.has(src))
    sources.current = next
    if (removed.length) cache?.invalidateSources(removed)
  }, [mediaSources, cache])
  return <ImageResourceContext.Provider value={cache}>{children}</ImageResourceContext.Provider>
}

export function useImageResource({ src, fullSize = false, enabled = true, priority = 'normal', role = 'display' } = {}) {
  const cache = useContext(ImageResourceContext)
  const [state, setState] = useState(null)
  const activeLease = useRef(null)
  const eligible = cache !== undefined && enabled && !fullSize && isPrivate(src)
  useEffect(() => {
    if (!eligible || !cache) return
    let alive = true
    const lease = cache.acquire({ src, priority, role })
    activeLease.current = lease
    const unsubscribe = lease.subscribe(snapshot => {
      if (alive) setState({ cache, src, priority, role, lease, snapshot })
    })
    return () => { alive = false; activeLease.current = null; unsubscribe(); lease.release() }
  }, [eligible, cache, src, priority, role])
  if (!eligible) return null
  if (!cache || !activeLease.current || state?.lease !== activeLease.current || state?.cache !== cache || state?.src !== src || state?.priority !== priority || state?.role !== role) return DEFERRED
  return state.snapshot
}
