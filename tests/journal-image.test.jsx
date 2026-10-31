import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import JournalImage from '../src/journal/JournalImage'
import PhotoViewer from '../src/journal/PhotoViewer'

vi.mock('../src/journal/Modal', () => ({ default: ({ children }) => <div role="dialog">{children}</div> }))
afterEach(() => { cleanup(); vi.useRealTimers() })

it('requests a thumbnail for a private list image and never falls back to the large image on error', () => {
  render(<JournalImage src="/uploads/photo.jpg" alt="small photo" />)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/photo.jpg?thumbnail=1')
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('img')).toHaveAccessibleName('small photo，照片暂时无法显示')
  expect(document.querySelector('img')).toBeNull()
})

it('uses the original URL only for an explicit full image and preserves local/public URLs', () => {
  const { rerender } = render(<JournalImage src="/uploads/photo.jpg" fullSize alt="full" />)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/photo.jpg')
  for (const src of ['/journal-demo/wuzhen.jpg', '/notebook-covers/alpine-lake.jpg', 'blob:preview', 'data:image/png;base64,abc']) {
    rerender(<JournalImage src={src} alt="public" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', src)
  }
})

it('retries a failed thumbnail at most twice without ever falling back to the original', async () => {
  vi.useFakeTimers()
  render(<JournalImage src="/uploads/retry.jpg" alt="retry" />)
  for (const delay of [800, 1600]) {
    fireEvent.error(screen.getByRole('img'))
    expect(document.querySelector('img')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(delay) })
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/retry.jpg?thumbnail=1')
  }
  fireEvent.error(screen.getByRole('img'))
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByRole('img')).toHaveAccessibleName('retry，照片暂时无法显示')
})

it('shows a small placeholder while the explicitly opened original loads, without requesting other originals', () => {
  const data = { trips: [], entries: [{ id: 'entry', entry_date: '2026-10-27', components: [], photos: [{ id: 'a', url: '/uploads/a.jpg' }, { id: 'b', url: '/uploads/b.jpg' }] }] }
  render(<PhotoViewer selection={{ entryId: 'entry', photoId: 'a' }} data={data} onClose={() => {}} />)
  const original = document.querySelector('img[src="/uploads/a.jpg"]')
  expect(original).toBeInTheDocument()
  expect(document.querySelector('img[src="/uploads/a.jpg?thumbnail=1"]')).toBeInTheDocument()
  expect(document.querySelector('img[src="/uploads/b.jpg"]')).toBeNull()
  expect(original).toHaveStyle({ opacity: '0' })
  fireEvent.load(original)
  expect(original).toHaveStyle({ opacity: '1' })
})
