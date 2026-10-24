import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import JourneyCanvas from '../src/journal/JourneyCanvas.jsx'

vi.mock('../src/journal/Modal', () => ({ default: ({ children }) => <div role="dialog">{children}</div> }))
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  localStorage.setItem('shitu-camera-v1', JSON.stringify({ x: 0, y: 0, scale: 1, detail: true }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

it('shows a notebook as a canvas element and opens it with the shared canvas gesture', () => {
  const onNotebook = vi.fn()
  render(<JourneyCanvas data={{ trips: [], entries: [], notebooks: [{ id: 'book', name: '湖边的日子', canvas_x: 0, canvas_y: 0 }] }} onNotebook={onNotebook} />)
  fireEvent.click(screen.getByRole('button', { name: '打开手帐：湖边的日子' }))
  expect(onNotebook).toHaveBeenCalledWith('book')
})

it('shows a cover for a folded parent, selects all hidden members and unfolds without moving photos', async () => {
  const data = { trips: [], marks: [], entries: [{ id: 'e', entry_date: '2026-10-17', components: [], photos: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, url: '/' + id + '.png', components: [], canvas_absolute: 1, canvas_x: i * 100, canvas_y: 0, rotation: 0 })) }], canvas_groups: [
    { id: 'inner', name: '内层', color: 'sky', photo_ids: ['a', 'b'], parent_id: 'outer', collapsed: true },
    { id: 'outer', name: '外层', color: 'sand', photo_ids: ['c', 'd'], collapsed: true },
  ] }
  const onSaveGroup = vi.fn(async () => {})
  const { rerender } = render(<JourneyCanvas data={data} onSaveGroup={onSaveGroup} />)
  expect(document.querySelectorAll('[data-photo-id]')).toHaveLength(0)
  expect(document.querySelector('[data-group-id="inner"]')).toBeNull()
  expect(document.querySelectorAll('.j-group-cover img')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '移动分组：外层', exact: true }))
  expect(screen.getByText('已选 4 项')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '展开分组：外层', exact: true }))
  await waitFor(() => expect(onSaveGroup).toHaveBeenCalledWith('outer', { collapsed: false }))
  const updated = { ...data, canvas_groups: data.canvas_groups.map(group => group.id === 'outer' ? { ...group, collapsed: false } : group) }
  rerender(<JourneyCanvas data={updated} onSaveGroup={onSaveGroup} />)
  expect(screen.getByRole('button', { name: '展开分组：内层', exact: true })).toBeInTheDocument()
  expect(document.querySelector('[data-photo-id="a"]')).toBeNull()
  expect(document.querySelector('[data-photo-id="c"]')).toHaveStyle({ transform: 'translate3d(200px,0px,0) translate(-50%,-50%) rotate(0deg)' })
})

it('keeps the previous cover and reports a failed fold state save', async () => {
  const data = { trips: [], entries: [{ id: 'e', entry_date: '2026-10-17', components: [], photos: [{ id: 'a', url: '/a.png', canvas_absolute: 1, canvas_x: 0, canvas_y: 0 }] }], canvas_groups: [{ id: 'g', name: '回忆', photo_ids: ['a'], collapsed: true }] }
  const onSaveGroup = vi.fn(async () => { throw new Error('保存失败') }), onError = vi.fn()
  render(<JourneyCanvas data={data} onSaveGroup={onSaveGroup} onError={onError} />)
  fireEvent.click(screen.getByRole('button', { name: '展开分组：回忆', exact: true }))
  await waitFor(() => expect(onError).toHaveBeenCalledWith('保存失败'))
  expect(screen.getByRole('button', { name: '展开分组：回忆', exact: true })).toBeEnabled()
  expect(document.querySelector('[data-photo-id="a"]')).toBeNull()
})

it('selecting one member selects its outer block and allows nesting it with another block', async () => {
  const data = {
    trips: [], marks: [],
    entries: [{ id: 'entry', entry_date: '2026-10-17', components: [], photos: ['a', 'b', 'c'].map((id, index) => ({ id, url: '/' + id + '.png', components: [], canvas_absolute: 1, canvas_x: index * 100, canvas_y: 0 })) }],
    canvas_groups: [{ id: 'inner', name: '内层', color: 'sage', photo_ids: ['a'], parent_id: 'outer' }, { id: 'outer', name: '外层', color: 'sand', photo_ids: ['b'] }, { id: 'other', name: '另一组', color: 'sky', photo_ids: ['c'] }],
  }
  const onSaveGroup = vi.fn(async () => {})
  render(<JourneyCanvas data={data} onSaveGroup={onSaveGroup} onViewPosition={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '多选内容', exact: true }))
  const photo = id => document.querySelector(`[data-photo-id="${id}"]`)
  fireEvent.click(photo('a'))
  expect(photo('a')).toHaveAttribute('aria-pressed', 'true')
  expect(photo('b')).toHaveAttribute('aria-pressed', 'true')
  expect(photo('c')).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(photo('b'))
  expect(photo('a')).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: '移动分组：外层' }))
  expect(photo('a')).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(photo('c'))
  const add = screen.getByRole('button', { name: '添加色块分组', exact: true })
  expect(add).toBeEnabled()
  fireEvent.click(add)
  fireEvent.click(screen.getByRole('button', { name: '保存分组', exact: true }))
  await waitFor(() => expect(onSaveGroup).toHaveBeenCalledTimes(1))
  expect(onSaveGroup.mock.calls[0][1].positions.map(position => position.id)).toEqual(['a', 'b', 'c'])
})
