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
