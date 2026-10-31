import { afterEach, expect, it } from 'vitest'
import { notebookDragPosition, notebookDropPage, planNotebookDrop } from '../src/journal/notebookDrop'

afterEach(() => { document.body.innerHTML = '' })
it('repacks a centered existing photo when another large photo can fit on the page', () => {
  const existing=[{id:'a',kind:'photo',width:560,height:700,x:600,y:800,rotation:0}]
  const result=planNotebookDrop([{id:'b',kind:'photo',width:560,height:700,rotation:0}],existing,{x:600,y:800})
  expect(result).toHaveLength(2)
  expect(new Set(result.map(i=>i.id))).toEqual(new Set(['a','b']))
  expect(Math.abs(result[0].x-result[1].x)>=560 || Math.abs(result[0].y-result[1].y)>=700).toBe(true)
  expect(existing[0]).toMatchObject({x:600,y:800})
})
it('finds the visible paper geometrically even when a dragged element covers it', () => {
  document.body.innerHTML = '<div class="nb-reader"><div class="nb-spread"><div data-notebook-page="page"></div></div><div class="nb-snapshots"><div data-notebook-page="hidden"></div></div></div>'
  const paper=document.querySelector('.nb-spread>div')
  paper.getBoundingClientRect=()=>({left:400,top:80,right:800,bottom:700,width:400,height:620})
  expect(notebookDropPage({x:600,y:300})?.dataset.notebookPage).toBe('page')
  expect(notebookDropPage({x:200,y:300})).toBeNull()
})

it('preserves a corner grab in page coordinates at different zoom levels', () => {
  for (const scale of [.25, .5, 1]) {
    const source = { left:100, top:50, width:1200*scale, height:1600*scale }
    const target = { ...source, left:100+source.width }
    const position = notebookDragPosition({ x:400, y:500 }, source, target, {x:100+450*scale,y:50+550*scale}, {x:target.left+650*scale,y:50+950*scale})
    expect(position).toEqual({x:600,y:900})
  }
})
