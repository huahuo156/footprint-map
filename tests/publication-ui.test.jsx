import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import NotebookReader from '../src/journal/NotebookReader'
import PlaceAtlas from '../src/journal/PlaceAtlas'
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.stubGlobal('matchMedia', () => ({ matches:true })) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })
it('traps reader focus, isolates background and restores its opener', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus()
  const { unmount } = render(<div><button>background</button><NotebookReader book={{id:'b',name:'手札'}} data={{entries:[],trips:[],notebook_pages:[]}} onClose={() => {}} /></div>)
  const reader = screen.getByRole('dialog', {name:'手札，翻页手帐'})
  expect(reader).toHaveAttribute('aria-modal','true')
  expect(screen.getByText('background')).toHaveAttribute('inert')
  const first = screen.getByRole('button', {name:'导出 PDF'})
  first.focus(); fireEvent.keyDown(first, {key:'Tab',shiftKey:true})
  expect(reader.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(first)
  unmount(); expect(opener).toHaveFocus(); opener.remove()
})
it('uses a collapsible mobile sheet and touch hints for atlas focus', () => {
  render(<PlaceAtlas mobile userId="a" data={{entries:[{id:'e',place_name:'武汉市',photos:[{id:'p',url:'/p.jpg'}]}]}} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button',{name:'聚焦地点：武汉市 · 1 张照片'}))
  const collapse = screen.getByRole('button',{name:'收起地点详情'})
  expect(collapse).toHaveAttribute('aria-expanded','true')
  fireEvent.click(collapse)
  expect(screen.getByRole('button',{name:'展开地点详情'})).toHaveAttribute('aria-expanded','false')
  expect(screen.queryByText(/Esc 返回全景/)).not.toBeInTheDocument()
})
it('reads only the current account atlas positions', () => {
  localStorage.setItem('shitu-atlas-layout-v1:a',JSON.stringify({map:{p:{x:-1000,y:2000}}}))
  localStorage.setItem('shitu-atlas-layout-v1',JSON.stringify({map:{p:{x:1,y:2}}}))
  render(<PlaceAtlas userId="a" data={{entries:[{id:'e',place_name:'武汉市',photos:[{id:'p',url:'/p.jpg'}]}]}} onOpen={() => {}} />)
  expect(document.querySelector('[data-atlas-photo="p"]').style.top).toBe('1914px')
})
