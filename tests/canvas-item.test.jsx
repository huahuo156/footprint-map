import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CanvasItem from '../src/journal/CanvasItem'
afterEach(cleanup)
it('uses shared photo components and image events, and routes keyboard selection and opening',()=>{
 const entry={entry_date:'2026-10-23',components:[{type:'date',value:'2026-10-23'},{type:'title',value:'Title'},{type:'description',value:'Full description'}]}, item={id:'a',kind:'photo',entry,url:'/a',x:20,y:30,width:260,height:300,imageHeight:214,rotation:3}
 const onOpen=vi.fn(), onToggle=vi.fn(),onPointerDown=vi.fn(),onImageLoad=vi.fn()
 const {rerender}=render(<CanvasItem item={item} onOpen={onOpen} onPointerDown={onPointerDown} onImageLoad={onImageLoad} componentLimit={Infinity}/> )
 expect(screen.getByText('Full description')).toBeInTheDocument()
 const button=document.querySelector('[data-photo-id="a"]')
 fireEvent.click(button);expect(onOpen).toHaveBeenCalledWith(entry,'a')
 fireEvent.pointerDown(button);expect(onPointerDown.mock.calls[0][1]).toBe(item)
 fireEvent.load(screen.getByRole('img'));expect(onImageLoad.mock.calls[0][1]).toBe(item)
 rerender(<CanvasItem item={item} selecting selected onToggle={onToggle}/> )
 fireEvent.click(button);expect(onToggle).toHaveBeenCalledWith('a')
 expect(button).toHaveAttribute('aria-pressed','true')
})
it('reuses real text and sticker mark components',()=>{
 const {rerender}=render(<CanvasItem item={{kind:'mark',id:'m',entry:{mark:{kind:'text',text:'Shared text',size:1}}}}/> )
 expect(screen.getByText('Shared text')).toBeInTheDocument()
 rerender(<CanvasItem item={{kind:'mark',id:'m',entry:{mark:{kind:'sticker',sticker:'leaf',size:1}}}}/> )
 expect(document.querySelector('.j-mark-content svg')).toBeInTheDocument()
})
