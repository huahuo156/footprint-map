import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NotebookReader from '../src/journal/NotebookReader.jsx'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const book = { id: 'book', name: '湖边散步', last_read_page_id:'page1' }
const data = { trips: [], marks: [], entries: [{ id: 'entry', entry_date: '2026-10-23', components: [], photos: [{ id: 'photo', url: '/lake.jpg', components: [{ type: 'description', value: '那天下午的风很好。' }] }] }], notebook_pages: [0, 1, 2, 3].map(i => ({ id: 'page' + i, notebook_id: 'book', sort_order: i })), notebook_items: [{ kind: 'photo', id: 'photo', page_id: 'page0', x: 400, y: 500, rotation: 0 }] }

it('renders original photo components, keeps only page count below book and uses existing open callback', () => {
  const onOpen = vi.fn()
  render(<NotebookReader book={book} data={data} onOpen={onOpen} onClose={() => {}} onError={() => {}} />)
  expect(screen.getByText('那天下午的风很好。')).toBeInTheDocument()
  expect(screen.queryByText('移回画布')).not.toBeInTheDocument()
  expect(screen.queryByText('放入选中页')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('1–2 / 4')
  expect(screen.getByRole('button', { name: '放大纸页' })).toHaveAttribute('title', '放大纸页')
  expect(screen.getByText('放大')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '从画布挑选内容' })).not.toBeInTheDocument()
  fireEvent.click(document.querySelector('.nb-paper [data-photo-id="photo"]'))
  expect(onOpen.mock.calls[0][1]).toBe('photo')
})

it('flips through corners with reduced motion and exposes shared composer from a collapsed menu', () => {
  const onAdd = vi.fn()
  render(<NotebookReader book={book} data={data} onAdd={onAdd} onClose={() => {}} onError={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '翻到下一张纸' }))
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('3–4 / 4')
  fireEvent.click(screen.getByRole('button', { name: '翻到上一张纸' }))
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('1–2 / 4')
  fireEvent.click(screen.getByText('添加照片、文字或贴纸'))
  expect(onAdd).toHaveBeenCalledWith('page1')
})

it('opens a virtual flyleaf using the existing name and dedication without changing content numbering', () => {
  render(<NotebookReader book={{...book,last_read_page_id:null,cover_text:'把平凡的日子留下。'}} data={data} onClose={()=>{}} />)
  const flyleaf=document.querySelector('.nb-spread .nb-flyleaf')
  expect(flyleaf).toHaveTextContent('湖边散步')
  expect(flyleaf).toHaveTextContent('把平凡的日子留下。')
  expect(document.querySelector('.nb-spread [data-notebook-page]')).toBeNull()
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('扉页 / 4')
  fireEvent.click(screen.getByRole('button',{name:'翻到下一张纸'}))
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('1–2 / 4')
  expect(document.querySelector('.nb-spread [data-photo-id="photo"]')).not.toBeNull()
})

it('keeps an unwritten dedication blank and opens actual paper when adding from the flyleaf', () => {
  const onAdd=vi.fn()
  render(<NotebookReader book={{...book,last_read_page_id:null,cover_text:''}} data={data} onAdd={onAdd} onClose={()=>{}} />)
  expect(document.querySelector('.nb-spread .nb-flyleaf p')).toBeNull()
  fireEvent.click(screen.getByText('添加照片、文字或贴纸'))
  expect(onAdd).toHaveBeenCalledWith('page0')
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('1–2 / 4')
})

it('resumes a page by ID and lets the ribbon be placed and removed without a panel', async () => {
  const onReadingChange=vi.fn(async()=>{})
  const props={book:{...book,last_read_page_id:'page2'},data,onReadingChange,onClose:()=>{}}
  const {rerender}=render(<NotebookReader {...props} />)
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('3–4 / 4')
  fireEvent.click(screen.getByRole('button',{name:'夹住第3页'}))
  await waitFor(()=>expect(onReadingChange).toHaveBeenCalledWith({bookmark_page_id:'page2'}))
  rerender(<NotebookReader {...props} book={{...props.book,bookmark_page_id:'page2'}} />)
  await waitFor(()=>expect(screen.getByRole('button',{name:'取下第3页的书签'})).toBeEnabled())
  fireEvent.click(screen.getByRole('button',{name:'取下第3页的书签'}))
  await waitFor(()=>expect(onReadingChange).toHaveBeenCalledWith({bookmark_page_id:null}))
})

it('turns to a saved ribbon and remembers the settled page', async () => {
  const onReadingChange=vi.fn(async()=>{})
  render(<NotebookReader book={{...book,bookmark_page_id:'page2'}} data={data} onReadingChange={onReadingChange} onClose={()=>{}} />)
  fireEvent.click(screen.getByRole('button',{name:'翻到书签，第3页'}))
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('3–4 / 4')
  await waitFor(()=>expect(onReadingChange).toHaveBeenCalledWith({last_read_page_id:'page2'}))
})

it('never writes reading state in demo mode and falls back to the flyleaf for a deleted page', () => {
  const onReadingChange=vi.fn()
  render(<NotebookReader book={{...book,last_read_page_id:'deleted'}} data={data} readOnly onReadingChange={onReadingChange} onClose={()=>{}} />)
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('扉页 / 4')
  fireEvent.click(screen.getByRole('button',{name:'翻到下一张纸'}))
  expect(document.querySelector('.nb-ribbon')).toBeNull()
  expect(onReadingChange).not.toHaveBeenCalled()
})

function dragSetup(props = {}) {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const onMove = vi.fn(async () => {}), onOpen = vi.fn(), onError = vi.fn()
  const view = render(<NotebookReader book={book} data={data} onMove={onMove} onOpen={onOpen} onClose={() => {}} onError={onError} {...props} />)
  const left = document.querySelector('.nb-spread [data-notebook-page="page0"]'), right = document.querySelector('.nb-spread [data-notebook-page="page1"]')
  left.getBoundingClientRect = () => ({ left:100, top:100, right:400, bottom:500, width:300, height:400 })
  right.getBoundingClientRect = () => ({ left:400, top:100, right:700, bottom:500, width:300, height:400 })
  const photo = left.querySelector('[data-photo-id="photo"]')
  photo.setPointerCapture = vi.fn()
  // Captured/dragged content can cover the destination: hit-test geometry instead.
  document.elementFromPoint = vi.fn(() => photo)
  return { ...view, photo, onMove, onOpen, onError }
}

it('previews across the gutter and drops on the destination while preserving the grab offset', async () => {
  const { photo, onMove, onError } = dragSetup()
  fireEvent.pointerDown(photo, { button:0, clientX:220, clientY:230 })
  fireEvent.pointerMove(photo, { clientX:550, clientY:300 })
  expect(document.querySelector('.nb-drag-layer [data-photo-id="photo"]')).not.toBeNull()
  expect(document.querySelector('[data-notebook-page="page1"]')).toHaveClass('is-drop-target')
  fireEvent.pointerUp(photo, { clientX:550, clientY:300 })
  await waitFor(() => expect(onMove).toHaveBeenCalledWith('page1', [{ id:'photo', kind:'photo', x:520, y:780, rotation:0 }]))
  expect(onError).not.toHaveBeenCalled()
  expect(document.querySelector('.nb-drag-layer [data-photo-id]')).toBeNull()
})

it('cancels a drag without saving or leaving a hidden source photo', () => {
  const { photo, onMove, onOpen } = dragSetup()
  fireEvent.pointerDown(photo, { button:0, clientX:220, clientY:230 })
  fireEvent.pointerMove(photo, { clientX:550, clientY:300 })
  fireEvent.pointerCancel(photo, { clientX:550, clientY:300 })
  expect(onMove).not.toHaveBeenCalled()
  expect(onOpen).not.toHaveBeenCalled()
  expect(photo.style.opacity).toBe('')
  expect(document.querySelector('.is-drop-target')).toBeNull()
  expect(document.querySelector('.nb-drag-layer [data-photo-id]')).toBeNull()
})

it('keeps the spread stable during dragging and cancels on lost pointer capture', () => {
  const { photo, onMove } = dragSetup()
  fireEvent.pointerDown(photo, { button:0, clientX:220, clientY:230 })
  fireEvent.pointerMove(photo, { clientX:550, clientY:300 })
  fireEvent.keyDown(photo, { key:'ArrowRight' })
  expect(screen.getByLabelText('手帐页码')).toHaveTextContent('1–2 / 4')
  fireEvent.lostPointerCapture(photo)
  expect(document.querySelector('.nb-drag-layer [data-photo-id]')).toBeNull()
  expect(document.querySelector('.is-drop-target')).toBeNull()
  expect(photo.style.opacity).toBe('')
  expect(onMove).not.toHaveBeenCalled()
})

it('clears the drag copy and restores the source when persisting the drop fails', async () => {
  const onMove = vi.fn(async () => { throw new Error('保存失败') })
  const { photo, onError } = dragSetup({ onMove })
  fireEvent.pointerDown(photo, { button:0, clientX:220, clientY:230 })
  fireEvent.pointerMove(photo, { clientX:550, clientY:300 })
  fireEvent.pointerUp(photo, { clientX:550, clientY:300 })
  await waitFor(() => expect(onError).toHaveBeenCalledWith('保存失败'))
  expect(photo.style.opacity).toBe('')
  expect(document.querySelector('.nb-drag-layer [data-photo-id]')).toBeNull()
})

it('never creates a moving copy or writes placement in read-only mode', () => {
  const { photo, onMove } = dragSetup({ readOnly:true })
  fireEvent.pointerDown(photo, { button:0, clientX:220, clientY:230 })
  fireEvent.pointerMove(photo, { clientX:550, clientY:300 })
  fireEvent.pointerUp(photo, { clientX:550, clientY:300 })
  expect(document.querySelector('.nb-drag-layer [data-photo-id]')).toBeNull()
  expect(onMove).not.toHaveBeenCalled()
})
