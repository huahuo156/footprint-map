import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import NotebookCover from '../src/journal/NotebookCover.jsx'
import { ImageResourceProvider } from '../src/journal/images/ImageResourceProvider.jsx'

afterEach(cleanup)
const book = { name: '杭州游记', cover_url: '/uploads/book.jpg', cover_text: '秋天', cover_label: 'TRAVEL' }

it('retains cover layout and text while a nonresident photo has no image element', () => {
  const view = render(<NotebookCover book={book} pageCount={12} imageResident={false} />)
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('.nb-cover-photo.j-image-placeholder')?.getAttribute('aria-hidden')).toBe('true')
  expect(screen.getByText('杭州游记')).toBeTruthy()
  expect(screen.getByText('秋天')).toBeTruthy()
  expect(screen.getByText('TRAVEL')).toBeTruthy()
  expect(screen.getByText('12 页')).toBeTruthy()
})

it('defaults to a resident photo and forwards the canvas resource policy', () => {
  const createSession = () => ({ getCache: () => null, subscribe: () => () => {}, validate: () => {}, dispose: () => {} })
  const view = render(<NotebookCover book={book} />)
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/uploads/book.jpg?thumbnail=1')
  view.rerender(<ImageResourceProvider ownerId="owner" createSession={createSession}><NotebookCover book={book} imageResourcePolicy="canvas" /></ImageResourceProvider>)
  expect(view.container.querySelector('img')).toBeNull()
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('正在加载')
})
