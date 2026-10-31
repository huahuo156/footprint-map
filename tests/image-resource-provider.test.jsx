import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImageResourceProvider, useImageResource } from '../src/journal/images/ImageResourceProvider.jsx'
import { createImageResourceCache } from '../src/journal/images/imageResourceCache.js'
import { createImageResourceSession } from '../src/journal/images/imageResourceSession.js'

afterEach(() => { cleanup(); vi.useRealTimers() })
function Probe(props) {
  const resource = useImageResource({ src: '/uploads/a.jpg', ...props })
  props.observe?.(resource)
  return <span data-testid={props.id ?? 'result'}>{resource ? resource.objectUrl ?? resource.status : 'bypass'}</span>
}
function fixture() {
  const sessions = [], fetchMedia = vi.fn(async () => new Blob(['a'], { type: 'image/webp' }))
  const createSession = vi.fn(() => {
    let cache = createImageResourceCache({ scope: { ownerId: 'owner' }, fetchMedia,
      decode: async () => ({ width: 1, height: 1 }) })
    const original = cache
    const listeners = new Set()
    const session = { getCache: () => cache,
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      validate: vi.fn(async () => false),
      dispose: vi.fn(() => { original.dispose(); cache = null; for (const fn of listeners) fn() }),
      reset: () => { original.dispose(); cache = null; for (const fn of listeners) fn() },
      cache: original,
    }
    sessions.push(session)
    return session
  })
  return { sessions, createSession, fetchMedia }
}

it('shares same URL resources and disposes every StrictMode session', async () => {
  const h = fixture()
  const view = render(<StrictMode><ImageResourceProvider ownerId="owner" createSession={h.createSession}><Probe id="a" /><Probe id="b" /></ImageResourceProvider></StrictMode>)
  await vi.waitFor(() => expect(screen.getByTestId('a').textContent).toMatch(/^blob:/))
  expect(screen.getByTestId('b').textContent).toBe(screen.getByTestId('a').textContent)
  expect(h.sessions.at(-1).cache.getStats().activeDisplayLeases).toBe(2)
  view.unmount()
  for (const session of h.sessions) expect(session.dispose).toHaveBeenCalledOnce()
})

it('bypasses outside provider, fullSize, disabled, and public URLs', () => {
  const h = fixture()
  const view = render(<Probe />)
  expect(screen.getByTestId('result')).toHaveTextContent('bypass')
  for (const props of [{ fullSize: true }, { enabled: false }, { src: '/journal-demo/a.jpg' }]) {
    view.rerender(<ImageResourceProvider ownerId="owner" createSession={h.createSession}><Probe {...props} /></ImageResourceProvider>)
    expect(screen.getByTestId('result')).toHaveTextContent('bypass')
  }
  expect(h.fetchMedia).not.toHaveBeenCalled()
})

it('blocks old images on reset and on owner changes without fallback', async () => {
  const h = fixture()
  const view = render(<ImageResourceProvider ownerId="owner" createSession={h.createSession}><Probe /></ImageResourceProvider>)
  await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toMatch(/^blob:/))
  act(() => h.sessions[0].reset())
  expect(screen.getByTestId('result')).toHaveTextContent('deferred')
  expect(h.sessions[0].validate).toHaveBeenCalled()
  view.rerender(<ImageResourceProvider ownerId="next" createSession={h.createSession}><Probe /></ImageResourceProvider>)
  expect(screen.getByTestId('result').textContent).not.toMatch(/^blob:/)
  await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toMatch(/^blob:/))
  expect(h.sessions[0].dispose).toHaveBeenCalledOnce()
})

it('invalidates removed membership only and validates on focus and visibility', () => {
  const h = fixture()
  const view = render(<ImageResourceProvider ownerId="owner" mediaSources={['/uploads/a.jpg', '/uploads/b.jpg']} createSession={h.createSession}><Probe enabled={false} /></ImageResourceProvider>)
  const invalidate = vi.spyOn(h.sessions[0].cache, 'invalidateSources')
  view.rerender(<ImageResourceProvider ownerId="owner" mediaSources={['/uploads/a.jpg', '/uploads/b.jpg']} createSession={h.createSession}><Probe enabled={false} /></ImageResourceProvider>)
  expect(invalidate).not.toHaveBeenCalled()
  view.rerender(<ImageResourceProvider ownerId="owner" mediaSources={['/uploads/a.jpg']} createSession={h.createSession}><Probe enabled={false} /></ImageResourceProvider>)
  expect(invalidate).toHaveBeenCalledWith(['/uploads/b.jpg'])
  act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
  expect(h.sessions[0].validate).toHaveBeenCalledTimes(2)
  view.unmount()
  window.dispatchEvent(new Event('focus'))
  expect(h.sessions[0].validate).toHaveBeenCalledTimes(2)
})

it('never publishes a released URL when a consumer is re-enabled', async () => {
  const h = fixture(), observe = vi.fn()
  const node = enabled => <ImageResourceProvider ownerId="owner" createSession={h.createSession}><Probe enabled={enabled} observe={observe} /></ImageResourceProvider>
  const view = render(node(true))
  await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toMatch(/^blob:/))
  view.rerender(node(false))
  observe.mockClear()
  view.rerender(node(true))
  expect(observe.mock.calls[0][0]).toEqual({ status: 'deferred' })
})

it('normalizes private memberships and ignores public, preview, and demo sources', () => {
  const h = fixture()
  const node = mediaSources => <ImageResourceProvider ownerId="owner" createSession={h.createSession} mediaSources={mediaSources}><Probe enabled={false} /></ImageResourceProvider>
  const view = render(node(['/uploads/a.jpg', '/uploads/b.jpg?thumbnail=1', 'blob:preview', '/journal-demo/demo.jpg']))
  const invalidate = vi.spyOn(h.sessions[0].cache, 'invalidateSources')
  view.rerender(node(['/uploads/a.jpg?thumbnail=1', '/uploads/b.jpg', '/public/c.jpg']))
  expect(invalidate).not.toHaveBeenCalled()
  view.rerender(node(['/uploads/a.jpg']))
  expect(invalidate).toHaveBeenCalledExactlyOnceWith(['/uploads/b.jpg'])
})

function realSessionFixture(checkSession) {
  vi.useFakeTimers()
  let epoch = 1, reset, session
  const caches = []
  const createSession = options => {
    session = createImageResourceSession({ ...options, checkSession, getEpoch: () => epoch,
      subscribeReset: fn => { reset = fn; return () => {} },
      createCache: scope => {
        const cache = createImageResourceCache({ scope, fetchMedia: async () => new Blob(['a']), decode: async () => ({ width: 1, height: 1 }) })
        vi.spyOn(cache, 'dispose')
        caches.push(cache)
        return cache
      },
    })
    return session
  }
  return { createSession, caches, getSession: () => session, reset: () => { epoch++; reset() } }
}

it('shares offline checks after a real controller reset without validation loops', async () => {
  const check = vi.fn(async () => { throw new Error('offline') })
  const h = realSessionFixture(check)
  render(<ImageResourceProvider ownerId="owner" createSession={h.createSession}><Probe /></ImageResourceProvider>)
  await act(async () => h.reset())
  expect(screen.getByTestId('result')).toHaveTextContent('deferred')
  expect(check).toHaveBeenCalledOnce()
  expect(h.caches[0].dispose).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')) })
  expect(check).toHaveBeenCalledTimes(2)
  expect(h.getSession().getCache()).toBeNull()
})

it('focus checks never extend the real controller cache hard deadline', async () => {
  const check = vi.fn(async () => ({ user: { id: 'owner' } }))
  const h = realSessionFixture(check)
  render(<ImageResourceProvider ownerId="owner" createSession={h.createSession}><Probe enabled={false} /></ImageResourceProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(59000); window.dispatchEvent(new Event('focus')) })
  expect(check).toHaveBeenCalledOnce()
  expect(h.caches[0].dispose).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(h.caches[0].dispose).toHaveBeenCalledOnce()
  expect(h.caches).toHaveLength(2)
  expect(check).toHaveBeenCalledTimes(2)
})

it('creates no session when disabled and preserves child edits through strategy toggles', async () => {
  const h = fixture()
  const node = enabled => <ImageResourceProvider ownerId="owner" enabled={enabled} createSession={h.createSession}><input aria-label="draft" defaultValue="draft" /><Probe /></ImageResourceProvider>
  const view = render(node(false))
  expect(h.createSession).not.toHaveBeenCalled()
  expect(screen.getByTestId('result')).toHaveTextContent('bypass')
  screen.getByRole('textbox').value = 'unsaved edit'
  view.rerender(node(true))
  await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toMatch(/^blob:/))
  expect(screen.getByRole('textbox')).toHaveValue('unsaved edit')
  view.rerender(node(false))
  expect(screen.getByTestId('result')).toHaveTextContent('bypass')
  expect(screen.getByRole('textbox')).toHaveValue('unsaved edit')
  expect(h.sessions[0].dispose).toHaveBeenCalledOnce()
})

it('does not reuse a disposed cache when re-enabled with the same owner', async () => {
  const h = fixture()
  const node = enabled => <ImageResourceProvider ownerId="owner" enabled={enabled} createSession={h.createSession}><Probe /></ImageResourceProvider>
  const view = render(node(true))
  await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toMatch(/^blob:/))
  view.rerender(node(false))
  view.rerender(node(true))
  await vi.waitFor(() => expect(screen.getByTestId('result').textContent).toMatch(/^blob:/))
  expect(h.sessions).toHaveLength(2)
})
