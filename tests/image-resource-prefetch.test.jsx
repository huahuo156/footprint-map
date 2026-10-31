import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ImageResourcePrefetch from '../src/journal/images/ImageResourcePrefetch.jsx'
import { ImageResourceProvider, useImageResource } from '../src/journal/images/ImageResourceProvider.jsx'
import { createImageResourceCache } from '../src/journal/images/imageResourceCache.js'

afterEach(cleanup)
function fixture(fetchMedia = vi.fn(async () => new Blob(['image']))) {
  const decode = vi.fn(async () => ({ width: 10, height: 10 }))
  const cache = createImageResourceCache({ scope: { ownerId: 'owner' }, fetchMedia, decode })
  const createSession = () => ({ getCache: () => cache, subscribe: () => () => {}, dispose: () => cache.dispose() })
  const wrap = children => <ImageResourceProvider ownerId="owner" createSession={createSession}>{children}</ImageResourceProvider>
  return { cache, fetchMedia, decode, wrap }
}
function Display() { useImageResource({ src: '/uploads/a.jpg' }); return null }

it('prefetches normalized private sources without DOM images, decode, or display leases and shares display fetch', async () => {
  const h = fixture()
  const node = display => h.wrap(<><ImageResourcePrefetch enabled sources={['/uploads/a.jpg', '/uploads/a.jpg?thumbnail=1', '/public/a.jpg', 'blob:preview']} />{display && <Display />}</>)
  const view = render(node(false))
  await vi.waitFor(() => expect(h.cache.getStats().entryCount).toBe(1))
  expect(h.fetchMedia).toHaveBeenCalledTimes(1)
  expect(h.decode).not.toHaveBeenCalled()
  expect(h.cache.getStats().objectUrlCount).toBe(0)
  expect(h.cache.getStats().activeDisplayLeases).toBe(0)
  expect(view.container.querySelector('img')).toBeNull()
  view.rerender(node(true))
  await vi.waitFor(() => expect(h.decode).toHaveBeenCalledOnce())
  expect(h.fetchMedia).toHaveBeenCalledTimes(1)
})

it.each([['desktop', 8], ['tablet', 4]])('bounds %s unique prefetch leases to %i', async (profile, count) => {
  const h = fixture()
  render(h.wrap(<ImageResourcePrefetch enabled profile={profile} sources={Array.from({ length: 20 }, (_, i) => `/uploads/${i}.jpg`)} />))
  await vi.waitFor(() => expect(h.cache.getStats().entryCount).toBe(count))
  expect(h.fetchMedia).toHaveBeenCalledTimes(count)
})

it('releases obsolete candidates and cancels in-flight work on policy changes', async () => {
  const signals = []
  const h = fixture(vi.fn((_src, { signal }) => { signals.push(signal); return new Promise(() => {}) }))
  const node = (sources, enabled = true) => h.wrap(<ImageResourcePrefetch enabled={enabled} sources={sources} />)
  const view = render(node(['/uploads/a.jpg']))
  await act(async () => {})
  expect(signals).toHaveLength(1)
  view.rerender(node(['/uploads/b.jpg']))
  await act(async () => {})
  expect(signals[0].aborted).toBe(true)
  view.rerender(node(['/uploads/b.jpg'], false))
  expect(signals[1].aborted).toBe(true)
})

it('bypasses absent or disabled providers and disabled prefetch', () => {
  const h = fixture()
  const view = render(<ImageResourcePrefetch enabled sources={['/uploads/a.jpg']} />)
  view.rerender(h.wrap(<ImageResourcePrefetch sources={['/uploads/a.jpg']} />))
  view.rerender(<ImageResourceProvider enabled={false} createSession={() => { throw Error('disabled') }}><ImageResourcePrefetch enabled sources={['/uploads/a.jpg']} /></ImageResourceProvider>)
  expect(h.fetchMedia).not.toHaveBeenCalled()
})

it('cancels the previous owner scope and the remaining lease on unmount', async () => {
  const signals = []
  const createSession = ({ ownerId }) => {
    const cache = createImageResourceCache({ scope: { ownerId },
      fetchMedia: (_src, { signal }) => { signals.push(signal); return new Promise(() => {}) },
    })
    return { getCache: () => cache, subscribe: () => () => {}, dispose: () => cache.dispose() }
  }
  const node = ownerId => <ImageResourceProvider ownerId={ownerId} createSession={createSession}><ImageResourcePrefetch enabled sources={['/uploads/a.jpg']} /></ImageResourceProvider>
  const view = render(node('first'))
  await act(async () => {})
  view.rerender(node('second'))
  await act(async () => {})
  expect(signals).toHaveLength(2)
  expect(signals[0].aborted).toBe(true)
  expect(signals[1].aborted).toBe(false)
  view.unmount()
  expect(signals[1].aborted).toBe(true)
})
