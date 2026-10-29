import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NotebookPrint from '../src/journal/NotebookPrint'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('prints the cover, title and all ordered pages, waiting for images first', async () => {
  const originalTitle = document.title
  const print = vi.spyOn(window, 'print').mockImplementation(() => {})
  const data = { trips: [], entries: [{ id: 'e', components: [], photos: [{ id: 'p', url: '/lake.jpg', components: [{ type: 'description', value: '留住湖边的风' }] }] }], marks: [], notebook_pages: [
    { id: 'last', notebook_id: 'b', sort_order: 2 }, { id: 'first', notebook_id: 'b', sort_order: 0 }, { id: 'foreign', notebook_id: 'other', sort_order: 0 },
  ], notebook_items: [{ id: 'p', kind: 'photo', page_id: 'last', x: 600, y: 800 }] }
  const { unmount } = render(<NotebookPrint book={{ id: 'b', name: '湖边手札', cover_text: '写给未来' }} data={data} onClose={() => {}} />)
  expect([...document.querySelectorAll('[data-print-page]')].map(node => node.dataset.printPage)).toEqual(['cover', 'title', 'first', 'last'])
  expect(screen.getByText('留住湖边的风')).toBeInTheDocument()
  const button = screen.getByRole('button', { name: '打印 / 保存为 PDF' })
  expect(button).toBeDisabled()
  fireEvent.load(screen.getByAltText('旅行照片'))
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  expect(print).toHaveBeenCalledTimes(1)
  expect(document.title).toBe('湖边手札 — 留念册')
  unmount()
  expect(document.title).toBe(originalTitle)
})

it('uses full private images in an explicit print preview rather than printing thumbnails', () => {
  const data = { trips: [], entries: [{ id: 'e', entry_date: '2026-10-27', components: [], photos: [{ id: 'p', url: '/uploads/p.jpg', components: [] }] }], marks: [], notebook_pages: [{ id: 'page', notebook_id: 'book', sort_order: 0 }], notebook_items: [{ id: 'p', kind: 'photo', page_id: 'page', x: 600, y: 800 }] }
  render(<NotebookPrint book={{ id: 'book', name: '打印', cover_mode: 'photo', cover_url: '/uploads/cover.jpg' }} data={data} onClose={() => {}} />)
  expect(screen.getByAltText('旅行照片')).toHaveAttribute('src', '/uploads/p.jpg')
  expect(screen.getByAltText('手帐封面')).toHaveAttribute('src', '/uploads/cover.jpg')
})

it('lets an unavailable image finish with a visible warning instead of hanging', async () => {
  render(<NotebookPrint book={{ id: 'b', name: '手札', cover_mode: 'photo', cover_url: '/missing.jpg' }} data={{ entries: [], trips: [], notebook_pages: [], notebook_items: [] }} onClose={() => {}} />)
  fireEvent.error(screen.getByAltText('手帐封面'))
  await waitFor(() => expect(screen.getByRole('button', { name: '打印 / 保存为 PDF' })).toBeEnabled())
  expect(screen.getByRole('status')).toHaveTextContent('1 张照片未能加载')
})
