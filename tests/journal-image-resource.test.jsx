import { afterEach, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import JournalImage from '../src/journal/JournalImage.jsx'
import { ImageResourceProvider } from '../src/journal/images/ImageResourceProvider.jsx'
import { createImageResourceCache } from '../src/journal/images/imageResourceCache.js'

afterEach(cleanup)
const setup = () => {
  let cache = createImageResourceCache({ scope: { ownerId: 'a' }, fetchMedia: async () => new Blob(['photo']), decode: async () => ({ width: 2, height: 1 }) })
  const listeners = new Set()
  const createSession = () => ({ getCache: () => cache, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }, validate: async () => false, dispose: () => { cache?.dispose(); listeners.clear() } })
  return { createSession, reset: () => { cache.dispose(); cache = null; for (const listener of listeners) listener() } }
}
const flush = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }

it('uses the optional canvas resource strategy and blocks direct private requests during reset', async () => {
  const h = setup()
  render(<ImageResourceProvider ownerId="a" createSession={h.createSession}><JournalImage src="/uploads/a.jpg" alt="cached" resourcePolicy="canvas" /></ImageResourceProvider>)
  await flush()
  expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/))
  act(h.reset)
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByRole('img')).toHaveAccessibleName('cached，照片正在加载')
})

it('keeps no-provider, full-size and public paths on existing behavior', async () => {
  const h = setup()
  const { rerender } = render(<JournalImage src="/uploads/a.jpg" alt="image" resourcePolicy="canvas" />)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/a.jpg?thumbnail=1')
  rerender(<ImageResourceProvider ownerId="a" createSession={h.createSession}><JournalImage src="/uploads/a.jpg" alt="image" fullSize resourcePolicy="canvas" /></ImageResourceProvider>)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/a.jpg')
  rerender(<ImageResourceProvider ownerId="a" createSession={h.createSession}><JournalImage src="/journal-demo/wuzhen.jpg" alt="image" resourcePolicy="canvas" /></ImageResourceProvider>)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/journal-demo/wuzhen.jpg')
  await flush()
})
